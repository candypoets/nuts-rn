// Commerce/protocol builders + seeders for the nuts-rn .qa harness.
// Ports the nuts-cash protocol shapes to plain Node against provisioned
// strfry-badge communities:
//
//   - buildCatalogDefinitionTags / catalogDefinition  (30009/30402, NIP-97)
//   - communityAnchor                                 (kind 31727, root-signed)
//   - paymentRedemption                               (POST /redeem payment body,
//                                                      stripe webhook +server.ts)
//   - badgeStatus                                     (kind 37237, orders.ts)
//   - calendarEvent                                   (kind 31923)
//   - rsvp                                            (kind 31925)
//   - subscribeLive                                   (live-sub helper)
//   - publishResult                                   (OK-level accept/reject
//                                                      probe for gate tests)
//
// Everything works on plain signed nostr events (no FlatBuffers); derivation
// logic lives in qa-derive.mjs.
import { randomBytes } from 'crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { getPublicKey, verifyEvent } from 'nostr-tools';
import {
	assert,
	nip98Header,
	nowSeconds,
	signEvent,
	sleep
} from './qa-lib.mjs';

export const BADGE_DEFINITION_KIND = 30009;
export const CLASSIFIED_LISTING_KIND = 30402;
export const BADGE_AWARD_KIND = 8;
export const BADGE_STATUS_KIND = 37237; // addressable — relay keeps latest per d (context); see subscribeLive
export const CALENDAR_EVENT_KIND = 31923;
export const RSVP_KIND = 31925;
export const COMMUNITY_ANCHOR_KIND = 31727;
export const COMMUNITY_ANCHOR_D = 'community';
export const DELETION_KIND = 5;

// The payment-service key the local coordinator was started with
// (NUTS_PAYMENT_SERVICE_PUBKEY=55bd5753…c8143). The invite service only
// accepts payment redemptions NIP-98-signed by this key. The corresponding
// secret must be supplied explicitly via QA_PAYMENT_SERVICE_SECRET.
export const PAYMENT_SERVICE_PUBKEY =
	process.env.QA_PAYMENT_SERVICE_PUBKEY ||
	'55bd575372b875d8d8611d781d73c8e493226ffa401323c6974c77c7fe8c8143';
export const PAYMENT_SERVICE_SECRET = process.env.QA_PAYMENT_SERVICE_SECRET || '';

export const CATALOG_AVAILABILITIES = ['available', 'unavailable', 'archived'];
export const PRODUCT_KINDS = ['food', 'drink', 'merchandise', 'generic'];
export const MEMBERSHIP_BILLING = ['one_time', 'monthly', 'yearly'];

// --- Tag helpers -------------------------------------------------------------

export function tagValue(tags, name) {
	return tags.find((tag) => tag[0] === name)?.[1] || '';
}

export function hasTagValue(tags, name, value) {
	return tags.some((tag) => tag[0] === name && tag[1] === value);
}

export function eventAddress(event) {
	const d = tagValue(event.tags, 'd');
	return d ? `${event.kind}:${event.pubkey}:${d}` : '';
}

// --- Catalog definitions (port of nuts-cash src/lib/catalog.ts) ---------------

function positiveDecimal(value) {
	if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
	return Number(value) > 0 ? value : undefined;
}

function currencyCode(value) {
	const normalized = value?.trim().toUpperCase();
	return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}

// NIP-97/NIP-99 catalog tags. The r=<relayUrl> tag is appended by
// catalogDefinition() when relayUrl is given (mirrors the web builder caller).
export function buildCatalogDefinitionTags(definition) {
	const d = String(definition.d || '').trim();
	const name = String(definition.name || '').trim();
	if (!d) throw new Error('d is required');
	if (!name) throw new Error('name is required');
	const price = positiveDecimal(String(definition.price).trim());
	const currency = currencyCode(definition.currency);
	if (!price) throw new Error('price must be a positive decimal');
	if (!currency) throw new Error('currency must be a three-letter code');
	const availability = definition.availability ?? 'available';
	if (!CATALOG_AVAILABILITIES.includes(availability)) {
		throw new Error('availability is invalid');
	}
	const position = definition.position ?? 0;
	if (!Number.isSafeInteger(position) || position < 0) {
		throw new Error('position must be a non-negative integer');
	}

	const tags = [
		['d', d],
		['t', definition.type === 'event_access' ? 'ticket' : definition.type],
		['price', price, currency],
		['position', String(position)]
	];
	if (definition.type === 'membership') {
		tags.push(['name', name]);
		tags.push(['description', definition.description?.trim() || '']);
	} else {
		tags.push(['title', name]);
		tags.push(['summary', definition.description?.trim() || '']);
		tags.push(['status', availability === 'available' ? 'active' : 'sold']);
	}
	if (definition.image?.trim()) tags.push(['image', definition.image.trim()]);
	if (definition.section?.trim()) tags.push(['section', definition.section.trim()]);
	if (definition.priceSats !== undefined) tags.push(['price_sats', String(definition.priceSats)]);

	if (definition.type === 'product') {
		const productKind = definition.productKind ?? 'generic';
		if (!PRODUCT_KINDS.includes(productKind)) throw new Error('product kind is invalid');
		tags.push(['product_kind', productKind]);
		tags.push(['max_uses', '1']); // products are always single-use
	} else if (definition.type === 'membership') {
		const billing = definition.billing ?? 'one_time';
		if (!MEMBERSHIP_BILLING.includes(billing)) throw new Error('billing is invalid');
		tags.push(['billing', billing]);
		// max_uses is FORBIDDEN on memberships
	} else if (definition.maxUses !== undefined) {
		if (!Number.isSafeInteger(definition.maxUses) || definition.maxUses <= 0) {
			throw new Error('max uses must be a positive integer');
		}
		tags.push(['max_uses', String(definition.maxUses)]);
	}
	return tags;
}

// Memberships are 30009; products, passes and tickets are 30402.
export function catalogDefinition(definition, privHex, { relayUrl } = {}) {
	const tags = buildCatalogDefinitionTags(definition);
	if (relayUrl) tags.push(['r', relayUrl]);
	const kind =
		definition.type === 'membership' ? BADGE_DEFINITION_KIND : CLASSIFIED_LISTING_KIND;
	return signEvent({ kind, tags }, privHex);
}

// --- Community anchor -------------------------------------------------------

export function communityAnchor(
	{ admins, badgeIssuer, name = '', type, description = '', image = '' },
	privHex
) {
	const tags = [
		['d', COMMUNITY_ANCHOR_D],
		['description', description]
	];
	for (const admin of admins) tags.push(['p', admin]);
	if (badgeIssuer) tags.push(['badge_issuer', badgeIssuer]);
	if (name) tags.push(['name', name]);
	if (type) tags.push(['type', type]);
	if (/^https?:\/\//.test(image)) tags.push(['image', image]);
	return signEvent({ kind: COMMUNITY_ANCHOR_KIND, tags }, privHex);
}

// --- Payment redemption (port of the stripe webhook /redeem body) --------------

let redemptionCounter = 0;

// POST {baseUrl}/redeem with the payment body shape from
// nuts-cash src/routes/api/stripe/webhook/+server.ts, NIP-98-signed by the
// payment-service key. The invite service validates the u tag as exactly
// `{base_url}/redeem`, so this must hit base_url directly (never the proxy).
// Returns { ok, event_id } — event_id is the badge-issuer-signed kind 8 award.
export async function paymentRedemption({
	baseUrl,
	definitionEventId,
	badgeAddress,
	recipientPubkey,
	purchaseType, // product | pass | membership | event (event = event_access definition)
	paidAt = nowSeconds(),
	badgeExpiresAt,
	redemptionId,
	paymentId,
	paymentSecret = PAYMENT_SERVICE_SECRET
}) {
	if (!/^[0-9a-f]{64}$/i.test(paymentSecret)) {
		throw new Error(
			'QA_PAYMENT_SERVICE_SECRET must be set to the local coordinator payment-service key'
		);
	}
	const base = baseUrl.replace(/\/+$/, '');
	const url = `${base}/redeem`;
	const redemption = redemptionId || `qa-redemption-${Date.now().toString(36)}-${redemptionCounter++}`;
	const body = JSON.stringify({
		type: 'payment',
		redemption_id: redemption,
		payment_id: paymentId || `qa_payment_${randomBytes(8).toString('hex')}`,
		order_id: redemption,
		definition_event_id: definitionEventId,
		membership_event_id: definitionEventId,
		badge_address: badgeAddress,
		recipient_pubkey: recipientPubkey,
		purchase_type: purchaseType,
		quantity: 1,
		paid_at: paidAt,
		...(badgeExpiresAt ? { badge_expires_at: badgeExpiresAt } : {})
	});
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: nip98Header(url, 'POST', body, paymentSecret)
		},
		body
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(`payment redemption -> ${response.status}: ${result.error || 'unknown'}`);
	}
	assert(/^[0-9a-f]{64}$/i.test(result.event_id || ''), 'payment redemption returned award event id');
	return { ok: true, event_id: result.event_id, redemption_id: redemption };
}

// --- Badge status (port of orders.ts buildBadgeStatusTemplate) -----------------

// contextTag is exactly ONE of ['order', id] / ['event', address]. Kind 37237
// (addressable): the `d` tag carries the same context prefixed ('order:<id>' /
// 'event:<address>') so the relay keeps only the latest status per context.
export function badgeStatus(status, { awardId, badgeAddress, holder, contextTag }, privHex, createdAt) {
	return signEvent(
		{
			kind: BADGE_STATUS_KIND,
			...(createdAt ? { created_at: createdAt } : {}),
			tags: [
				['status', status],
				['a', badgeAddress],
				['e', awardId],
				['p', holder],
				contextTag,
				['d', `${contextTag[0]}:${contextTag[1]}`]
			]
		},
		privHex
	);
}

// Port of orders.ts checkInContextTag.
export function checkInContextTag(awardId, now = nowSeconds()) {
	return ['order', `checkin-${awardId}-${now}`];
}

// --- Calendar events + RSVP ----------------------------------------------------

// Kind 31923 (time-based). capacity is a plain integer tag — there is NO
// server-side enforcement of it (see qa-verify-commerce.mjs capacity pin).
export function calendarEvent({ d, title, start, end, capacity, summary = '', location = '', image = '' }, privHex) {
	if (!d || !title || !Number.isSafeInteger(start)) {
		throw new Error('calendar event requires d, title and a start timestamp');
	}
	const tags = [
		['d', d],
		['title', title],
		['start', String(start)],
		['end', String(end ?? start + 3600)],
		['summary', summary]
	];
	if (Number.isSafeInteger(capacity) && capacity > 0) tags.push(['capacity', String(capacity)]);
	if (location) tags.push(['location', location]);
	if (/^https?:\/\//.test(image)) tags.push(['image', image]);
	return signEvent({ kind: CALENDAR_EVENT_KIND, tags }, privHex);
}

// Kind 31925; latest-per-pubkey wins, content mirrors the status
// (modals/event.svelte submitRsvp).
export function rsvp({ eventAddress, eventAuthor, status = 'accepted' }, privHex) {
	const pub = getPublicKey(hexToBytes(privHex));
	return signEvent(
		{
			kind: RSVP_KIND,
			content: status,
			tags: [
				['a', eventAddress],
				['d', `${eventAddress}:${pub}`],
				['status', status],
				['p', eventAuthor]
			]
		},
		privHex
	);
}

// Kind 5 deletion (NIP-09), e.g. the badge issuer revoking an award.
export function deletion(eventIds, privHex, content = '') {
	return signEvent(
		{ kind: DELETION_KIND, content, tags: eventIds.map((id) => ['e', id]) },
		privHex
	);
}

// --- Relay I/O helpers -----------------------------------------------------------

// Publishes an event and resolves { accepted, reason } per the relay's OK
// message — the probe for write-gate assertions. nostr-tools resolves the
// publish promise with the OK reason on acceptance and rejects with
// Error(reason) on `OK … false <reason>`; its own publishTimeout (~4.4 s)
// bounds the wait.
export async function publishResult(pool, relayUrl, event) {
	const [settled] = await Promise.allSettled(pool.publish([relayUrl], event));
	if (settled.status === 'fulfilled') return { accepted: true, reason: String(settled.value) };
	return { accepted: false, reason: settled.reason?.message || String(settled.reason) };
}

export async function publishOk(pool, relayUrl, event, label) {
	const result = await publishResult(pool, relayUrl, event);
	assert(result.accepted, `${label || 'event'} accepted by relay (${result.reason})`);
	return result;
}

// Live subscription helper used to prove delivery to an already-open RN
// entitlement screen. Kind 37237 is also durable and queryable.
export function subscribeLive(pool, relayUrls, filter, { onevent } = {}) {
	const events = [];
	const waiters = new Set();
	const sub = pool.subscribeMany(relayUrls, filter, {
		onevent(event) {
			events.push(event);
			onevent?.(event);
			for (const waiter of [...waiters]) {
				let matched = false;
				try {
					matched = waiter.pred(events, event);
				} catch {
					matched = false;
				}
				if (matched) {
					waiters.delete(waiter);
					clearTimeout(waiter.timer);
					waiter.resolve(event);
				}
			}
		},
		oneose() {}
	});
	return {
		events,
		close: () => sub.close(),
		waitFor(pred, timeoutMs = 10000, label = 'live event') {
			return new Promise((resolve, reject) => {
				try {
					const existing = events.find((event) => pred(events, event));
					if (existing) return resolve(existing);
				} catch {}
				const waiter = { pred, resolve, timer: undefined };
				waiter.timer = setTimeout(() => {
					waiters.delete(waiter);
					reject(new Error(`timed out waiting for ${label} (got ${events.length} events)`));
				}, timeoutMs);
				waiters.add(waiter);
			});
		}
	};
}

// Publishes an event and waits until it round-trips on a query — used right
// after provisioning, when the coordinator already reports "running" but the
// container's write gate is not serving yet.
export async function publishUntilStored(pool, relayUrl, event, filter, timeoutMs = 45000) {
	const deadline = Date.now() + timeoutMs;
	let stored;
	while (Date.now() < deadline && !stored) {
		await Promise.allSettled(pool.publish([relayUrl], event));
		await sleep(1500);
		stored = await pool.get([relayUrl], filter);
	}
	assert(stored, `event kind ${event.kind} round-trips on ${relayUrl}`);
	return stored;
}

// --- NIP-98 decode (checkout shim) ----------------------------------------------

// Structural NIP-98 check for the checkout shim: decodes the auth event,
// verifies kind/method/payload hash and the Schnorr signature. Deliberately
// SKIPS the strict u-tag origin check (the app signs against
// http://10.0.2.2:7821 while production would sign against nuts.cash).
export function decodeNip98(header, body) {
	if (!header?.startsWith('Nostr ')) throw new Error('missing Nostr authorization header');
	let event;
	try {
		event = JSON.parse(Buffer.from(header.slice(6), 'base64url').toString('utf8'));
	} catch {
		throw new Error('invalid NIP-98 auth encoding');
	}
	if (event.kind !== 27235) throw new Error('NIP-98 event must be kind 27235');
	if (!/^[0-9a-f]{64}$/i.test(event.pubkey || '')) throw new Error('invalid NIP-98 pubkey');
	const age = Math.abs(nowSeconds() - Number(event.created_at || 0));
	if (age > 300) throw new Error('NIP-98 event is stale');
	if (tagValue(event.tags, 'method') !== 'POST') throw new Error('NIP-98 method must be POST');
	const payloadHash = nip98PayloadHash(body);
	if (tagValue(event.tags, 'payload') !== payloadHash) throw new Error('NIP-98 payload mismatch');
	if (!verifyEvent(event)) throw new Error('invalid NIP-98 signature');
	return event;
}

function nip98PayloadHash(body) {
	return bytesToHex(sha256(new TextEncoder().encode(body || '')));
}
// --- Commerce scenario state + process lifecycle --------------------------------

import { spawn } from 'child_process';
import { existsSync, openSync, readFileSync, writeFileSync } from 'fs';

// Two-community state file (qa-scenario-commerce.mjs). The legacy
// single-community file (/tmp/qa-rn-community.json) is still written for the
// hospitality community so qa-verify-redeem.mjs and the redeem maestro flows
// keep working unchanged.
export const COMMERCE_STATE_PATH = process.env.QA_COMMERCE_STATE || '/tmp/qa-rn-commerce.json';
export const SHIM_PORT = Number(process.env.QA_SHIM_PORT || 7821);
export const SHIM_HOST = '127.0.0.1';
export const SHIM_EMULATOR_URL = `http://10.0.2.2:${SHIM_PORT}`;
export const SHIM_PID_PATH = process.env.QA_SHIM_PID || '/tmp/qa-rn-checkout-shim.pid';
export const communityProxyPort = (key) => (key === 'sports' ? 7822 : 7820);
export const communityProxyPidPath = (key) => `/tmp/qa-rn-commerce-proxy-${key}.pid`;
export const communityProxyLogPath = (key) => `/tmp/qa-rn-commerce-proxy-${key}.log`;
export const communityProxyEmulatorUrl = (key) => `http://10.0.2.2:${communityProxyPort(key)}`;
// The maestro verifier greps this log for `[checkout] …` lines.
export const SHIM_LOG_PATH = process.env.QA_SHIM_LOG || '/tmp/qa-rn-checkout-shim.log';

export function readCommerceState() {
	if (!existsSync(COMMERCE_STATE_PATH)) return undefined;
	return JSON.parse(readFileSync(COMMERCE_STATE_PATH, 'utf8'));
}

export function writeCommerceState(data) {
	writeFileSync(
		COMMERCE_STATE_PATH,
		JSON.stringify({ ...data, state_written_at: new Date().toISOString() }, null, 2)
	);
	console.log('ok - wrote commerce state to', COMMERCE_STATE_PATH);
}

async function probe(url) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
		return response.ok ? await response.json() : undefined;
	} catch {
		return undefined;
	}
}

function spawnDetached(scriptPath, env, pidPath, logPath) {
	// stdout/stderr go to a log file (append) — the checkout shim's
	// `[checkout] …` lines are grepped from there by the maestro verifier.
	const out = logPath ? openSync(logPath, 'a') : 'ignore';
	const child = spawn(process.execPath, [scriptPath], {
		detached: true,
		stdio: ['ignore', out, out],
		env: { ...process.env, ...env }
	});
	child.unref();
	writeFileSync(pidPath, String(child.pid));
	return child.pid;
}

// Starts one qa-redeem-proxy.mjs instance for a commerce community (detached,
// survives this process) unless a proxy with the RIGHT targets is already
// answering on that port. A proxy answering with different targets (e.g. a
// stale qa-bootstrap proxy on 7820) is a hard error — run qa-teardown first.
export async function ensureCommunityProxy(key, community) {
	const port = communityProxyPort(key);
	const pidPath = communityProxyPidPath(key);
	const relayPort = Number(new URL(community.relay_url.replace(/^ws/, 'http')).port);
	const health = await probe(`http://127.0.0.1:${port}/healthz`);
	if (health) {
		if (health.targets?.relay?.port === relayPort) {
			console.log(`ok - ${key} proxy already up on :${port}`);
			return;
		}
		throw new Error(
			`port ${port} already serves a DIFFERENT proxy (targets ${JSON.stringify(health.targets)}). ` +
				'Run node .qa/qa-teardown.mjs to stop it first.'
		);
	}
	const proxyPath = new URL('./qa-redeem-proxy.mjs', import.meta.url).pathname;
	const pid = spawnDetached(
		proxyPath,
		{
			QA_PROXY_PORT: String(port),
			QA_PROXY_PID: pidPath,
			QA_COMMUNITY_KEY: key,
			QA_COMMERCE_STATE: COMMERCE_STATE_PATH
		},
		pidPath,
		communityProxyLogPath(key)
	);
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const up = await probe(`http://127.0.0.1:${port}/healthz`);
		if (up?.targets?.relay?.port === relayPort) {
			console.log(`ok - ${key} proxy started on :${port} (pid ${pid})`);
			return;
		}
		await sleep(300);
	}
	throw new Error(`${key} proxy did not come up on :${port}`);
}

// Starts qa-checkout-shim.mjs detached unless one is already answering.
export async function ensureCheckoutShim() {
	const health = await probe(`http://${SHIM_HOST}:${SHIM_PORT}/healthz`);
	if (health) {
		console.log(`ok - checkout shim already up on :${SHIM_PORT}`);
		return;
	}
	const shimPath = new URL('./qa-checkout-shim.mjs', import.meta.url).pathname;
	const pid = spawnDetached(
		shimPath,
		{
			QA_SHIM_PORT: String(SHIM_PORT),
			QA_SHIM_PID: SHIM_PID_PATH,
			QA_COMMERCE_STATE: COMMERCE_STATE_PATH
		},
		SHIM_PID_PATH,
		SHIM_LOG_PATH
	);
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await probe(`http://${SHIM_HOST}:${SHIM_PORT}/healthz`)) {
			console.log(`ok - checkout shim started on :${SHIM_PORT} (pid ${pid})`);
			return;
		}
		await sleep(300);
	}
	throw new Error(`checkout shim did not come up on :${SHIM_PORT}`);
}
