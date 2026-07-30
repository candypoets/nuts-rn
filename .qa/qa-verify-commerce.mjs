// Commerce protocol verifier: proves the punch-card derivation, the RSVP
// capacity gap, and the write-gate behavior against the seeded QA RN Gym
// community (qa-scenario-commerce.mjs must run first). Exits non-zero on
// failure.
//
//   node .qa/qa-verify-commerce.mjs
//
//   A. gym pass punch card: award a 10-use pass to keys.users[0] via the
//      payment-redemption path, publish 10 fulfilled 27237 check-in statuses
//      (admin key, contexts checkin-<award>-<i>) observed through a LIVE
//      subscription (27237 is NIP-01-ephemeral — clients must never rely on
//      queries for it), then the derivation must say 0 remaining and the
//      scanner rule must reject an 11th fulfillment (derivation-level —
//      enforcement is client-side, the relay accepts any admin-signed 27237).
//   B. capacity pin: 3 RSVPs from 3 member keys over the capacity-2 "QA
//      Training" event — the relay ACCEPTS all 3 (pins the
//      no-server-enforcement gap; see TODO at the assertion).
//   C. gate: non-member kind 1 rejected, member kind 1 accepted, kind-5
//      revocation of the pass award by the badge issuer removes it
//      (relay-side NIP-09 + derivation-level). Also pins the observed 27237
//      relay behavior: stock strfry does NOT implement NIP-01 ephemeral
//      semantics — it stores and serves 27237 to queries (clients still
//      must treat it as ephemeral; other relays drop it).
//
// Membership for the test users is established directly from Node through the
// invite /redeem endpoint (token + pubkey, no app needed).
import {
	assert,
	getRelay,
	getRelaySecrets,
	loadKeys,
	makePool,
	randomKey,
	signEvent,
	sleep
} from './qa-lib.mjs';
import {
	activeAwards,
	fulfilledUseCount,
	isAwardRevoked,
	isSingleUseDefinition,
	remainingAwardUses,
	scannerWouldAccept
} from './qa-derive.mjs';
import {
	BADGE_STATUS_KIND,
	badgeStatus,
	checkInContextTag,
	deletion,
	paymentRedemption,
	publishOk,
	publishResult,
	readCommerceState,
	rsvp,
	subscribeLive,
	tagValue
} from './qa-commerce.mjs';

const state = readCommerceState();
const gym = state?.communities?.sports;
if (!gym?.relay_url || !gym?.base_url) {
	console.error('no commerce state at /tmp/qa-rn-commerce.json — run qa-scenario-commerce.mjs first');
	process.exit(1);
}
const keys = loadKeys();
const users = keys.users || [];
if (users.length < 4) throw new Error('keys file needs at least 4 users[]');
const pool = makePool();
const RELAY = gym.relay_url;

// The invite-token /redeem endpoint takes {token, pubkey} without NIP-98.
// Idempotent: if the invite's redemption cap is hit, an existing membership
// award for the pubkey counts as success (mirrors the app's
// checkExistingMembership short-circuit — lets the verifier re-run against
// the same community).
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
	if (existing) {
		console.log(`ok - ${pubkey.slice(0, 8)}… already a member (existing award ${existing.id.slice(0, 12)}…)`);
		return existing.id;
	}
	throw new Error(`invite redeem ${pubkey.slice(0, 8)}… -> ${response.status}: ${result.error}`);
}

async function fetchEvent(filter, label, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const event = await pool.get([RELAY], filter);
		if (event) return event;
		await sleep(1200);
	}
	throw new Error('timed out waiting for ' + label);
}

async function main() {
	console.log('gym relay:', RELAY, `(${gym.name})`);

	const relayView = await getRelay(gym.id, keys);
	const issuer = relayView.badge_issuer_pubkey;
	assert(issuer && issuer !== keys.admin.pub, 'badge issuer is the service key, not the admin');
	const secrets = await getRelaySecrets(gym.id, keys);
	assert(
		/^[0-9a-f]{64}$/i.test(secrets?.badge_issuer_secret_key || ''),
		'coordinator exposes badge_issuer_secret_key'
	);

	// --- Membership for the test users (invite /redeem from Node) -------------
	console.log('--- membership: redeem gym invite for users[0..3]');
	for (const user of users.slice(0, 4)) {
		const awardId = await redeemInvite(gym, gym.token, user.pub, issuer);
		assert(/^[0-9a-f]{64}$/i.test(awardId || ''), `membership award for ${user.pub.slice(0, 8)}…`);
	}

	// --- A. Gym pass punch card -------------------------------------------------
	console.log('--- A. 10-session pass punch card');
	const pass = gym.catalog['qa-10-session-pass'];
	assert(pass, 'commerce state has the qa-10-session-pass catalog item');
	const definition = await fetchEvent(
		{ kinds: [30009], authors: [keys.admin.pub], '#d': [pass.d] },
		'pass definition'
	);
	pass.id = definition.id; // in case a rescan re-published it
	assert(!isSingleUseDefinition(definition), 'max_uses=10 pass classifies as reusable');

	const holder = users[0];
	const redemption = await paymentRedemption({
		baseUrl: gym.base_url,
		definitionEventId: definition.id,
		badgeAddress: pass.address,
		recipientPubkey: holder.pub,
		purchaseType: 'pass'
	});
	const award = await fetchEvent({ ids: [redemption.event_id] }, 'pass award on the relay');
	assert(award.pubkey === issuer, 'pass award authored by the badge issuer');
	assert(tagValue(award.tags, 'a') === pass.address, 'award references the pass definition');
	assert(tagValue(award.tags, 'p') === holder.pub, 'award granted to the buyer');
	assert(
		tagValue(award.tags, 'i') === `payment-redemption:${redemption.redemption_id}`,
		'award carries the payment-redemption reference'
	);

	// 37237 is addressable, so statuses survive on the relay — but keep the
	// LIVE subscription open before publishing to also pin live delivery to
	// already-connected subscribers (what the RN screens rely on).
	const live = subscribeLive(pool, [RELAY], { kinds: [BADGE_STATUS_KIND], authors: [keys.admin.pub] });
	await sleep(1000); // let the REQ reach the relay before publishing
	for (let i = 0; i < 10; i += 1) {
		const status = badgeStatus(
			'fulfilled',
			{
				awardId: award.id,
				badgeAddress: pass.address,
				holder: holder.pub,
				contextTag: checkInContextTag(award.id, 1700000000 + i)
			},
			keys.admin.priv
		);
		await publishOk(pool, RELAY, status, `check-in ${i + 1}/10`);
	}
	await live.waitFor(
		(events) =>
			events.filter(
				(event) =>
					tagValue(event.tags, 'e') === award.id &&
					tagValue(event.tags, 'status') === 'fulfilled'
			).length >= 10,
		15000,
		'10 fulfilled check-ins live'
	);
	const statuses = live.events.filter((event) => tagValue(event.tags, 'e') === award.id);
	assert(fulfilledUseCount(award, statuses) === 10, 'derivation: 10 fulfilled uses (one per context)');
	assert(
		remainingAwardUses(award, definition, statuses) === 0,
		'derivation: 0 remaining uses after 10 check-ins'
	);
	// The scanner rule is derivation-level: an 11th check-in MUST be rejected by
	// the client. The relay itself has no such rule — it accepts an 11th
	// admin-signed status happily (enforcement is client-side only).
	assert(
		!scannerWouldAccept(award, definition, statuses),
		'scanner rule rejects an 11th fulfillment (derivation-level)'
	);
	const eleventh = badgeStatus(
		'fulfilled',
		{
			awardId: award.id,
			badgeAddress: pass.address,
			holder: holder.pub,
			contextTag: checkInContextTag(award.id, 1700000011)
		},
		keys.admin.priv
	);
	const eleventhResult = await publishResult(pool, RELAY, eleventh);
	assert(
		eleventhResult.accepted,
		'PIN: relay ACCEPTS an 11th fulfilled status — punch-card enforcement is client-side only'
	);
	live.close();

	// --- B. RSVP capacity pin ------------------------------------------------------
	console.log('--- B. RSVP capacity pin (capacity 2, 3 attendees)');
	const eventAddress = gym.event.address;
	const eventAuthor = keys.admin.pub;
	const rsvpKeys = users.slice(1, 4);
	for (const [index, user] of rsvpKeys.entries()) {
		const event = rsvp({ eventAddress, eventAuthor, status: 'accepted' }, user.priv);
		await publishOk(pool, RELAY, event, `RSVP ${index + 1}/3 (${user.pub.slice(0, 8)}…)`);
	}
	const rsvps = await pool.querySync([RELAY], { kinds: [31925], '#a': [eventAddress] });
	const attendees = new Set(
		rsvps
			.filter((event) => (tagValue(event.tags, 'status') || event.content) === 'accepted')
			.map((event) => event.pubkey)
	);
	// TODO(protocol-gap): strfry-badge has NO server-side capacity enforcement —
	// flip this to expect a rejection of the 3rd RSVP if/when the gate learns
	// to enforce the capacity tag. Until then this pins the gap: all 3 RSVPs
	// over a capacity-2 event are stored.
	assert(
		attendees.size >= 3,
		'PIN: relay accepted 3 RSVPs over capacity 2 (no server-side capacity enforcement)'
	);

	// --- C. Write gate ------------------------------------------------------------
	console.log('--- C. write gate');
	const outsider = randomKey();
	// The gate rejects while its membership cache is warming — retry until the
	// answer is the real membership verdict.
	let outsiderResult;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const note = signEvent({ kind: 1, content: `qa gate probe ${Date.now()}`, tags: [] }, outsider.priv);
		outsiderResult = await publishResult(pool, RELAY, note);
		if (!/warming/i.test(outsiderResult.reason)) break;
		await sleep(2000);
	}
	assert(!outsiderResult.accepted, 'non-member kind 1 rejected by the gate');
	assert(
		/required badge|blocked/i.test(outsiderResult.reason),
		`rejection reason names the missing badge (${outsiderResult.reason})`
	);

	const memberNote = signEvent({ kind: 1, content: `qa member note ${Date.now()}`, tags: [] }, holder.priv);
	const memberResult = await publishResult(pool, RELAY, memberNote);
	assert(memberResult.accepted, 'member kind 1 accepted by the gate');

	// Addressable rule: kind 37237 (30000-39999 range) is parameterized
	// replaceable — the relay keeps it indefinitely and stores only the LATEST
	// event per (kind, pubkey, d). This replaced kind 27237 (ephemeral range),
	// which strfry's RelayCron evicted ~300 s after publish, silently erasing
	// status history. Pin the new relay behavior so a regression surfaces
	// loudly.
	const queried = await pool.querySync([RELAY], { kinds: [BADGE_STATUS_KIND], authors: [keys.admin.pub] });
	assert(
		queried.length >= 11,
		'PIN: kind 37237 statuses are STORED and served to fresh queries (addressable — no ephemeral eviction)'
	);
	const replaceBase = Math.floor(Date.now() / 1000);
	const replaceProbe = (status, createdAt) =>
		badgeStatus(
			status,
			{
				awardId: award.id,
				badgeAddress: pass.address,
				holder: holder.pub,
				contextTag: ['order', 'qa-replace-probe']
			},
			keys.admin.priv,
			createdAt
		);
	await publishOk(pool, RELAY, replaceProbe('pending', replaceBase), 'replace probe v1 (pending)');
	await publishOk(pool, RELAY, replaceProbe('fulfilled', replaceBase + 1), 'replace probe v2 (fulfilled, same d)');
	const replaced = await pool.querySync([RELAY], { kinds: [BADGE_STATUS_KIND], '#d': ['order:qa-replace-probe'] });
	assert(
		replaced.length === 1 && tagValue(replaced[0].tags, 'status') === 'fulfilled',
		`PIN: republishing the same d replaces — only the latest status served (got ${replaced.length})`
	);

	// Kind-5 revocation of the pass award by the badge issuer.
	const revocation = deletion([award.id], secrets.badge_issuer_secret_key, 'qa revocation');
	const revocationResult = await publishResult(pool, RELAY, revocation);
	assert(revocationResult.accepted, 'badge-issuer kind-5 revocation accepted by the gate');
	const stillThere = await pool.querySync([RELAY], { ids: [award.id] });
	assert(stillThere.length === 0, 'revoked award no longer served by the relay (NIP-09)');
	assert(isAwardRevoked(award, [revocation]), 'derivation treats the award as revoked');
	assert(activeAwards([award], [revocation]).length === 0, 'revoked award drops out of active awards');

	pool.destroy([RELAY]);
	console.log('VERIFY PASS');
	process.exit(0);
}

main().catch((error) => {
	console.error('VERIFY FAIL:', error.message);
	try {
		pool.destroy([RELAY]);
	} catch {}
	process.exit(1);
});
