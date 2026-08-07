// Faithful port of the order/punch-card derivation logic from the nuts-cash
// web app to plain nostr events (no FlatBuffers, no imports from nuts-cash):
//
//   - latestStatusEvents   src/routes/notifications/notifications.ts (~76)
//   - fulfilledUseCount    src/lib/orders.ts (~132)
//   - remainingAwardUses   src/lib/orders.ts (~139)
//   - catalogMaxUses       src/lib/catalog.ts (~230)
//   - single-use vs reusable classification (orders.ts deriveOrderRecords ~96)
//
// Plus the revocation rule the apps apply client-side: a kind-5 deletion
// authored by the award's author (the badge issuer) referencing the award id
// in an e-tag removes the award from consideration (NIP-09).
//
// Everything here is small and pure; events are plain {id, pubkey, kind,
// created_at, tags, ...} objects.

export const BADGE_STATUS_KIND = 37237; // addressable — relay keeps latest per d (context)
export const BADGE_AWARD_KIND = 8;

export const BADGE_STATUSES = [
	'pending',
	'accepted',
	'processing',
	'ready',
	'fulfilled',
	'cancelled'
];

export function isBadgeStatus(value) {
	return BADGE_STATUSES.includes(value);
}

export function tagValue(tags, name) {
	return tags.find((tag) => tag[0] === name)?.[1] || '';
}

function positiveInteger(value) {
	if (value === undefined) return undefined;
	if (!/^[1-9]\d*$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

// --- catalog accessors (port of catalog.ts) --------------------------------------

export function catalogType(definition) {
	if (
		definition.kind === 30009 &&
		definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'membership')
	) {
		return 'membership';
	}
	if (definition.kind !== 30402) return undefined;
	if (definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'product')) return 'product';
	if (definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'pass')) return 'pass';
	if (definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'ticket')) return 'event_access';
	return undefined;
}

// catalog.ts catalogMaxUses: explicit positive max_uses wins; products default
// to 1; everything else is unlimited (undefined).
export function catalogMaxUses(definition) {
	const maxUses = positiveInteger(tagValue(definition.tags, 'max_uses') || undefined);
	if (maxUses) return maxUses;
	return definition.kind === 30402 ? 1 : undefined;
}

// orders.ts deriveOrderRecords: products, event tickets and max_uses=1
// definitions yield exactly one order line per award (single-use); passes and
// memberships are reusable entitlements with one line per fulfillment context.
export function isSingleUseDefinition(definition) {
	const type = catalogType(definition);
	return type === 'product' || type === 'event_access' || catalogMaxUses(definition) === 1;
}

// --- status derivation (port of notifications.ts latestStatusEvents) --------------

// The latest valid kind 37237 status per fulfillment context
// for one award. A status is valid for the award when kind/e/a/p all match
// and it carries exactly ONE context tag (order=<id> or event=<address>).
// The context key prefers the `d` tag (addressability on 37237), falling
// back to the order/event context tags on legacy events. Ties on created_at
// break by LOWER event id winning (matches the web implementation:
// candidate replaces current when its id sorts before). Result is sorted by
// created_at desc, then id asc.
export function latestStatusEvents(award, statuses) {
	const awardId = award.id;
	const address = tagValue(award.tags, 'a');
	const recipient = tagValue(award.tags, 'p');
	if (!awardId || !address || !recipient) return [];

	const latest = new Map();
	for (const event of statuses) {
		if (
			event.kind !== BADGE_STATUS_KIND ||
			tagValue(event.tags, 'e') !== awardId ||
			tagValue(event.tags, 'a') !== address ||
			tagValue(event.tags, 'p') !== recipient ||
			!isBadgeStatus(tagValue(event.tags, 'status'))
		) {
			continue;
		}
		const order = tagValue(event.tags, 'order');
		const eventContext = tagValue(event.tags, 'event');
		if (Boolean(order) === Boolean(eventContext)) continue; // exactly one context tag
		const expectedContext = order ? `order:${order}` : `event:${eventContext}`;
		const contextKey = tagValue(event.tags, 'd');
		if (contextKey !== expectedContext) continue;
		const current = latest.get(contextKey);
		if (
			!current ||
			event.created_at > current.created_at ||
			(event.created_at === current.created_at && (event.id || '') < (current.id || ''))
		) {
			latest.set(contextKey, event);
		}
	}
	return Array.from(latest.values()).sort(
		(left, right) =>
			right.created_at - left.created_at || (left.id || '').localeCompare(right.id || '')
	);
}

// --- punch card (port of orders.ts) -------------------------------------------------

// Fulfilled uses of one award: one per fulfillment context whose LATEST status
// is fulfilled. Republishing fulfilled twice against the same context counts
// once; a newer cancelled/ready status un-counts the use.
export function fulfilledUseCount(award, statuses) {
	return latestStatusEvents(award, statuses).filter(
		(event) => tagValue(event.tags, 'status') === 'fulfilled'
	).length;
}

// Remaining uses; undefined means the definition is unlimited. This is the
// scanner rule: a check-in (new fulfilled context) is allowed only while
// remaining > 0. Enforcement is client-side (scanner/board), NOT the relay —
// the relay accepts an authorized 37237 regardless of remaining uses.
export function remainingAwardUses(award, definition, statuses) {
	const maxUses = catalogMaxUses(definition);
	if (!maxUses) return undefined;
	return Math.max(0, maxUses - fulfilledUseCount(award, statuses));
}

// The scanner-side decision: would fulfilling another context for this award
// be accepted? Pure derivation-level check (no relay involved).
export function scannerWouldAccept(award, definition, statuses) {
	const remaining = remainingAwardUses(award, definition, statuses);
	return remaining === undefined || remaining > 0;
}

// --- expiration + revocation ----------------------------------------------------------

// orders.ts isAwardExpired.
export function isAwardExpired(award, now = Math.floor(Date.now() / 1000)) {
	const expiration = Number(tagValue(award.tags, 'expiration') || 0);
	return Boolean(expiration && expiration <= now);
}

// NIP-09: a kind-5 event from the award's own author (the badge issuer) with
// an e-tag naming the award id revokes it. Clients apply this on top of
// whatever the relay still serves.
export function isAwardRevoked(award, deletions) {
	return deletions.some(
		(deletion) =>
			deletion.kind === 5 &&
			deletion.pubkey === award.pubkey &&
			deletion.tags.some((tag) => tag[0] === 'e' && tag[1] === award.id)
	);
}

// Awards minus the revoked (and, by default, the expired) ones.
export function activeAwards(awards, deletions, { dropExpired = false, now } = {}) {
	return awards.filter(
		(award) =>
			!isAwardRevoked(award, deletions) && !(dropExpired && isAwardExpired(award, now))
	);
}

// --- Presentation QR (kind 27236) verification -------------------------------
// Port of nuts-cash src/lib/presentation.ts (decode + verify side), used by
// qa-verify-event.mjs to check the payload the RN Award screen logs in dev.

import {verifyEvent} from 'nostr-tools';

export const PRESENTATION_KIND = 27236;
export const PRESENTATION_PREFIX = 'nuts:present:';
export const PRESENTATION_LIFETIME_SECONDS = 90;
export const ENTITLEMENT_PRESENTATION_TYPE = 'nuts_entitlement_presentation';

function base64UrlDecode(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
	return Buffer.from(padded, 'base64').toString('utf8');
}

export function decodePresentation(value) {
	if (!value.startsWith(PRESENTATION_PREFIX)) return undefined;
	try {
		return JSON.parse(base64UrlDecode(value.slice(PRESENTATION_PREFIX.length)));
	} catch {
		return undefined;
	}
}

/**
 * Verifies the entitlement presentation the app put on screen: right kind,
 * type tag, nonce, valid signature, and inside the 90 s window (at = now).
 * Returns {event, awardId, badgeAddress, community, orderId, eventAddress}
 * or undefined.
 */
export function verifyEntitlementPresentation(payload, at = Math.floor(Date.now() / 1000)) {
	const event = decodePresentation(payload);
	if (!event || event.kind !== PRESENTATION_KIND) return undefined;
	const get = (name) => tagValue(event.tags, name);
	const expiration = Number(get('expiration'));
	if (
		get('type') !== ENTITLEMENT_PRESENTATION_TYPE ||
		!get('nonce') ||
		!verifyEvent(event) ||
		!Number.isSafeInteger(expiration) ||
		expiration < at ||
		event.created_at > at + 30 ||
		event.created_at < at - PRESENTATION_LIFETIME_SECONDS
	) {
		return undefined;
	}
	const orderId = get('order') || undefined;
	const eventAddress = get('event') || undefined;
	if (Boolean(orderId) === Boolean(eventAddress)) return undefined;
	return {
		event,
		awardId: get('e'),
		badgeAddress: get('a'),
		community: get('r'),
		orderId,
		eventAddress
	};
}
