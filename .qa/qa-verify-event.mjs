#!/usr/bin/env node
// Maestro orchestrator for the commerce UI flows + their protocol-level proof.
//
// Runs the three commerce scenarios end-to-end against a provisioned commerce
// state (node .qa/qa-scenario-commerce.mjs first — it starts the community
// proxies on :7820/:7822 and the checkout shim on :7821, and Metro must be
// running with EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821):
//
//   store-beer   redeem bar invite in-app (users[0]) → menu → Buy "QA Beer"
//                → shim checkout → kind-8 award verified on the bar relay.
//   gym-pass     redeem gym invite in-app (users[1]) → store → Get pass
//                "QA 10-Session Pass" → shim → award + 10 remaining uses.
//   capacity     seeds 2 member RSVPs (users[3], users[4]) over the capacity-2
//                "QA Training" → event-capacity-full.yaml asserts Full/disabled
//                → cancels one RSVP (newer declined) → event-capacity-rsvp.yaml
//                (users[2], still logged in) asserts the freed spot and RSVPs
//                → kind 31925 verified on the gym relay.
//
// Usage: node .qa/qa-verify-event.mjs [store-beer|gym-pass|capacity|all]
// Exit code is non-zero on any failure (maestro step or protocol assertion).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import {
	assert,
	getRelay,
	getRelaySecrets,
	loadKeys,
	makePool,
	signEvent,
	sleep
} from './qa-lib.mjs';
import {
	badgeStatus,
	checkInContextTag,
	publishResult,
	readCommerceState,
	rsvp,
	SHIM_LOG_PATH
} from './qa-commerce.mjs';
import { remainingAwardUses, verifyEntitlementPresentation } from './qa-derive.mjs';

const MAESTRO = `${process.env.HOME}/.maestro/bin/maestro`;
const state = readCommerceState();
const bar = state?.communities?.hospitality;
const gym = state?.communities?.sports;
if (!bar?.relay_url || !gym?.relay_url) {
	console.error('no commerce state — run node .qa/qa-scenario-commerce.mjs first');
	process.exit(1);
}
const keys = loadKeys();
const users = keys.users || [];
if (users.length < 5) throw new Error('keys file needs at least 5 users[]');
const pool = makePool();

// --- helpers ---------------------------------------------------------------

function runMaestro(flow, env) {
	const args = ['test'];
	for (const [key, value] of Object.entries(env)) {
		args.push('-e', `${key}=${value}`);
	}
	args.push(flow);
	console.log(`\n>>> maestro ${flow}`);
	execFileSync(MAESTRO, args, {
		env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' },
		stdio: 'inherit'
	});
	console.log(`>>> ${flow} PASSED`);
}

function shimLogOffset() {
	try {
		return statSync(SHIM_LOG_PATH).size;
	} catch {
		return 0;
	}
}

function shimLogSince(offset) {
	try {
		return readFileSync(SHIM_LOG_PATH, 'utf8').slice(offset);
	} catch {
		return '';
	}
}

// The invite-token /redeem endpoint takes {token, pubkey} without NIP-98
// (same as qa-verify-commerce.mjs). Idempotent via the existing-award
// short-circuit.
async function redeemInvite(community, token, pubkey, issuer) {
	const url = `${community.base_url.replace(/\/+$/, '')}/redeem`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ token, pubkey })
	});
	const result = await response.json().catch(() => ({}));
	if (response.ok) return result.event_id;
	const existing = await pool.get([community.relay_url], {
		kinds: [8],
		authors: [issuer],
		'#p': [pubkey]
	});
	if (existing) return existing.id;
	throw new Error(`invite redeem ${pubkey.slice(0, 8)}… -> ${response.status}: ${result.error}`);
}

async function fetchEvent(relayUrl, filter, label, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const event = await pool.get([relayUrl], filter);
		if (event) return event;
		await sleep(1200);
	}
	throw new Error('timed out waiting for ' + label);
}

// The gate rejects while its membership cache is warming — retry until the
// verdict is real.
async function publishUntilAccepted(relayUrl, event, label, timeoutMs = 45000) {
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		const result = await publishResult(pool, relayUrl, event);
		last = result.reason;
		if (result.accepted) {
			console.log('ok -', label, 'accepted by relay');
			return;
		}
		await sleep(1500);
	}
	throw new Error(`${label} never accepted by relay (last: ${last})`);
}

async function verifyPurchase({ community, itemD, purchaseType, buyerPub }) {
	const issuer = (await getRelay(community.id, keys)).badge_issuer_pubkey;
	const definitionKind = purchaseType === 'membership' ? 30009 : 30402;
	const address = `${definitionKind}:${keys.admin.pub}:${itemD}`;
	// Filter by the catalog address: the same issuer also granted the buyer's
	// membership award (#p matches), so #p alone is ambiguous.
	const award = await fetchEvent(
		community.relay_url,
		{ kinds: [8], authors: [issuer], '#p': [buyerPub], '#a': [address] },
		`kind-8 award for ${buyerPub.slice(0, 8)}…`
	);
	const definition = await fetchEvent(
		community.relay_url,
		{ kinds: [definitionKind], authors: [keys.admin.pub], '#d': [itemD] },
		`catalog definition ${itemD}`
	);
	assert(
		award.tags.some((t) => t[0] === 'a' && t[1] === address),
		`award references ${address}`
	);
	if (purchaseType === 'pass') {
		assert(
			remainingAwardUses(award, definition, []) === 10,
			'pass award starts with 10 remaining uses'
		);
	}
	return award;
}

// --- scenarios -------------------------------------------------------------

async function storeBeer() {
	const buyer = users[0];
	const offset = shimLogOffset();
	runMaestro('maestro/flows/store-beer.yaml', {
		TOKEN: bar.token,
		RELAY_PORT: '7820',
		NSEC: buyer.nsec,
		COMMUNITY_NAME: bar.name
	});
	const log = shimLogSince(offset);
	assert(
		log.includes('type=product') && log.includes(`buyer=${buyer.pub}`),
		'shim logged the QA Beer checkout by the app user'
	);
	await verifyPurchase({
		community: bar,
		itemD: 'qa-beer',
		purchaseType: 'product',
		buyerPub: buyer.pub
	});
	console.log('STORE-BEER PASS');
}

async function gymPass() {
	const buyer = users[1];
	const offset = shimLogOffset();
	runMaestro('maestro/flows/store-gym-pass.yaml', {
		TOKEN: gym.token,
		RELAY_PORT: '7822',
		NSEC: buyer.nsec,
		COMMUNITY_NAME: gym.name
	});
	const log = shimLogSince(offset);
	assert(
		log.includes('type=pass') && log.includes(`buyer=${buyer.pub}`),
		'shim logged the QA 10-Session Pass checkout by the app user'
	);
	await verifyPurchase({
		community: gym,
		itemD: 'qa-10-session-pass',
		purchaseType: 'pass',
		buyerPub: buyer.pub
	});
	console.log('GYM-PASS PASS');
}

async function capacity() {
	const event = gym.event;
	assert(event?.address && event.capacity === 2, 'commerce state has the capacity-2 QA Training event');
	const issuer = (await getRelay(gym.id, keys)).badge_issuer_pubkey;
	const [seedA, seedB, appUser] = [users[3], users[4], users[2]];

	// Reset: retract every RSVP left over from a previous run (kind 31925 is
	// addressable, so a fresh declined supersedes). Existing authors are gate
	// members by definition, so their declines pass the badge gate. On a fresh
	// scenario there is nothing to retract and this is a no-op.
	const stale = await pool.querySync([gym.relay_url], {
		kinds: [31925],
		'#a': [event.address]
	});
	const staleAuthors = [...new Set(stale.map((ev) => ev.pubkey))];
	for (const pub of staleAuthors) {
		const member = users.find((u) => u.pub === pub);
		if (!member) continue; // not one of ours — leave it alone
		const retract = rsvp(
			{ eventAddress: event.address, eventAuthor: keys.admin.pub, status: 'declined' },
			member.priv
		);
		await publishUntilAccepted(gym.relay_url, retract, `retract stale RSVP ${pub.slice(0, 8)}…`);
	}
	if (staleAuthors.length) await sleep(1100);

	// Fill the event: two members RSVP accepted.
	for (const member of [seedA, seedB]) {
		await redeemInvite(gym, gym.token, member.pub, issuer);
		const accepted = rsvp(
			{ eventAddress: event.address, eventAuthor: keys.admin.pub, status: 'accepted' },
			member.priv
		);
		await publishUntilAccepted(gym.relay_url, accepted, `seed RSVP ${member.pub.slice(0, 8)}…`);
	}
	// Distinct created_at seconds for the later cancellation.
	await sleep(1100);

	// Phase A: the app user (fresh login) sees the event Full and cannot RSVP.
	runMaestro('maestro/flows/event-capacity-full.yaml', {
		TOKEN: gym.token,
		RELAY_PORT: '7822',
		NSEC: appUser.nsec,
		COMMUNITY_NAME: gym.name
	});

	// One spot frees up: seedA retracts (newer declined supersedes accepted).
	const declined = rsvp(
		{ eventAddress: event.address, eventAuthor: keys.admin.pub, status: 'declined' },
		seedA.priv
	);
	await publishUntilAccepted(gym.relay_url, declined, 'cancel RSVP');

	// Phase B: still logged in, the user re-opens the event and RSVPs.
	const eventUrl =
		`nutsrn:///CalendarEvent?relay=${encodeURIComponent('ws://10.0.2.2:7822')}` +
		`&address=${encodeURIComponent(event.address)}`;
	runMaestro('maestro/flows/event-capacity-rsvp.yaml', { EVENT_URL: eventUrl });

	// Protocol proof: the app user's accepted RSVP is on the gym relay.
	const appRsvp = await fetchEvent(
		gym.relay_url,
		{ kinds: [31925], authors: [appUser.pub], '#a': [event.address] },
		'app user RSVP (kind 31925)'
	);
	assert(
		appRsvp.tags.some((t) => t[0] === 'status' && t[1] === 'accepted') ||
			appRsvp.content === 'accepted',
		'app RSVP is accepted'
	);
	console.log('CAPACITY PASS');
}

// --- entitlement scenario ----------------------------------------------------
//
// The member-side entitlement screens (docs/entitlements.md): Store "Yours"
// strip, Award screen with its live presentation QR (kind 27236, verified
// derivation-side from the dev log line), live status updates (37237), and
// the event-ticket entry point. Idempotent: each phase seeds a FRESH
// issuer-signed award first, so reruns never depend on purchase history.

function adminCatalogAddress(itemD) {
	return `30402:${keys.admin.pub}:${itemD}`;
}

async function latestAward(relayUrl, address, pubkey) {
	const events = await pool.querySync([relayUrl], {
		kinds: [8],
		'#a': [address],
		'#p': [pubkey]
	});
	return events.sort((left, right) => right.created_at - left.created_at)[0];
}

// A fresh purchase-shaped award, signed by the relay's badge issuer (the gate
// accepts issuer writes and applies them to its membership cache directly).
async function seedPurchaseAward(community, badgeAddress, holderPub, label) {
	const secrets = await getRelaySecrets(community.id, keys);
	const issuerSecret = secrets?.badge_issuer_secret_key;
	assert(/^[0-9a-f]{64}$/i.test(issuerSecret || ''), 'coordinator exposes badge_issuer_secret_key');
	const nonce = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
	const award = signEvent(
		{
			kind: 8,
			tags: [
				['a', badgeAddress],
				['p', holderPub],
				['payment', `qa_payment_${nonce}`],
				['i', `payment-redemption:qa-redemption-entitlement-${nonce}`]
			]
		},
		issuerSecret
	);
	await publishUntilAccepted(community.relay_url, award, label);
	return award;
}

// The Award screen logs its signed 27236 as `[award-qr] <payload>` in dev
// builds; find the newest payload for the given award and verify it.
async function verifiedPresentation(awardId, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const dump = execFileSync('adb', ['logcat', '-d'], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		});
		const payloads = [...dump.matchAll(/\[award-qr\][^n]*?(nuts:present:[A-Za-z0-9_-]+)/g)].map(
			(match) => match[1]
		);
		for (const payload of payloads.reverse()) {
			const decoded = verifyEntitlementPresentation(payload);
			if (decoded?.awardId === awardId) return decoded;
		}
		await sleep(1500);
	}
	throw new Error(`no valid presentation QR logged for award ${awardId.slice(0, 12)}…`);
}

async function entitlement() {
	const issuer = (await getRelay(gym.id, keys)).badge_issuer_pubkey;
	const barIssuer = (await getRelay(bar.id, keys)).badge_issuer_pubkey;
	const passAddress = adminCatalogAddress('qa-10-session-pass');
	const beerAddress = adminCatalogAddress('qa-beer');

	// Phase 1: gym pass — Yours strip, Award QR, live 10 → 9 decrement.
	const passHolder = users[1];
	await redeemInvite(gym, gym.token, passHolder.pub, issuer);
	const passAward = await seedPurchaseAward(gym, passAddress, passHolder.pub, 'fresh pass award');
	execFileSync('adb', ['logcat', '-c']);
	runMaestro('maestro/flows/entitlement-pass.yaml', {
		TOKEN: gym.token,
		RELAY_PORT: '7822',
		NSEC: passHolder.nsec,
		COMMUNITY_NAME: gym.name
	});
	const passPresentation = await verifiedPresentation(passAward.id);
	assert(passPresentation.badgeAddress === passAddress, 'pass QR references the pass definition');
	assert(passPresentation.community?.includes(':7822'), 'pass QR points at the gym relay (proxy)');
	assert(passPresentation.orderId?.startsWith('use:'), 'pass QR carries a fresh single-use context');
	console.log('ok - pass presentation QR verified (signed 27236, use: context)');
	const checkIn = badgeStatus(
		'fulfilled',
		{
			awardId: passAward.id,
			badgeAddress: passAddress,
			holder: passHolder.pub,
			contextTag: checkInContextTag(passAward.id)
		},
		keys.admin.priv
	);
	await publishUntilAccepted(gym.relay_url, checkIn, 'staff check-in (37237 fulfilled)');
	runMaestro('maestro/flows/entitlement-pass-decrement.yaml', {});
	console.log('ok - Award screen ticked 10 → 9 from the staff check-in');

	// Phase 2: beer order — "Waiting for staff" → fulfilled → "Served".
	const buyer = users[0];
	await redeemInvite(bar, bar.token, buyer.pub, barIssuer);
	const beerAward = await seedPurchaseAward(bar, beerAddress, buyer.pub, 'fresh beer award');
	const orderRef = beerAward.tags.find((t) => t[0] === 'i')?.[1]?.replace(/^payment-redemption:/, '');
	assert(orderRef, 'beer award carries a payment-redemption reference');
	execFileSync('adb', ['logcat', '-c']);
	runMaestro('maestro/flows/entitlement-order.yaml', {
		TOKEN: bar.token,
		RELAY_PORT: '7820',
		NSEC: buyer.nsec,
		COMMUNITY_NAME: bar.name
	});
	const orderPresentation = await verifiedPresentation(beerAward.id);
	assert(orderPresentation.orderId === orderRef, 'beer QR carries the purchase order reference');
	console.log('ok - beer presentation QR verified (order context)');
	const served = badgeStatus(
		'fulfilled',
		{
			awardId: beerAward.id,
			badgeAddress: beerAddress,
			holder: buyer.pub,
			contextTag: ['order', orderRef]
		},
		keys.admin.priv
	);
	await publishUntilAccepted(bar.relay_url, served, 'staff served (37237 fulfilled)');
	runMaestro('maestro/flows/entitlement-order-served.yaml', {});
	console.log('ok - Award screen flipped to "Served"');

	// Phase 3: event ticket — entrance_badge on the 31923 + ticket award →
	// "Your ticket" on the event screen → event-context QR.
	const ticketHolder = users[2];
	const event = gym.event;
	assert(event?.address, 'commerce state has the QA Training event');
	const eventD = event.address.split(':').slice(2).join(':');
	const ticketD = `event-${eventD}-entrance`;
	const ticketAddress = adminCatalogAddress(ticketD);
	await redeemInvite(gym, gym.token, ticketHolder.pub, issuer);
	const ticketDef = signEvent(
		{
			kind: 30402,
			tags: [
				['d', ticketD],
				['t', 'ticket'],
				['title', 'QA Training entrance'],
				['summary', 'QA ticket for the entitlement scenario'],
				['status', 'active'],
				['price', '10.00', 'EUR'],
				['position', '9'],
				['a', event.address],
				['max_uses', '1']
			]
		},
		keys.admin.priv
	);
	await publishUntilAccepted(gym.relay_url, ticketDef, 'ticket definition (30402)');
	// Fetch by address, not id: the 31923 is addressable, so a previous run's
	// entrance_badge update replaced it — the state file's id is stale.
	const currentEvent = await fetchEvent(
		gym.relay_url,
		{ kinds: [31923], authors: [keys.admin.pub], '#d': [eventD] },
		'current QA Training event'
	);
	const updatedEvent = signEvent(
		{
			kind: 31923,
			tags: [
				...currentEvent.tags.filter(tag => tag[0] !== 'entrance_badge'),
				['entrance_badge', ticketAddress]
			]
		},
		keys.admin.priv
	);
	await publishUntilAccepted(gym.relay_url, updatedEvent, 'event update with entrance_badge');
	const ticketAward = await seedPurchaseAward(gym, ticketAddress, ticketHolder.pub, 'ticket award');
	execFileSync('adb', ['logcat', '-c']);
	const eventUrl =
		`nutsrn:///CalendarEvent?relay=${encodeURIComponent('ws://10.0.2.2:7822')}` +
		`&address=${encodeURIComponent(event.address)}`;
	runMaestro('maestro/flows/entitlement-ticket.yaml', {
		TOKEN: gym.token,
		RELAY_PORT: '7822',
		NSEC: ticketHolder.nsec,
		COMMUNITY_NAME: gym.name,
		EVENT_URL: eventUrl
	});
	const ticketPresentation = await verifiedPresentation(ticketAward.id);
	assert(ticketPresentation.eventAddress === event.address, 'ticket QR carries the event coordinate');
	console.log('ok - ticket presentation QR verified (event context)');
	console.log('ENTITLEMENT PASS');
}

// --- main ------------------------------------------------------------------

const target = process.argv[2] || 'all';
const scenarios = { 'store-beer': storeBeer, 'gym-pass': gymPass, capacity, entitlement };
try {
	if (target === 'all') {
		await storeBeer();
		await gymPass();
		await capacity();
		await entitlement();
		console.log('\nALL COMMERCE FLOWS PASS');
	} else if (scenarios[target]) {
		await scenarios[target]();
	} else {
		console.error(`unknown scenario "${target}" — use store-beer|gym-pass|capacity|entitlement|all`);
		process.exit(1);
	}
} finally {
	pool.destroy([bar.relay_url, gym.relay_url]);
}
