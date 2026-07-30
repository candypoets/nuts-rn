/**
 * Member-side order/pass derivation — port of the web reference
 * (`nuts-cash/src/lib/orders.ts` + `src/routes/notifications/notifications.ts`).
 * Truth is computed from relay events: kind-8 awards, their 30009 definitions,
 * and kind-37237 statuses (legacy kind-27237 read during the transition).
 * There is NO server-side enforcement of max uses or
 * capacity (see .qa/SPEC-GAPS.md) — this derivation is what the member sees,
 * and it must agree with what staff sees, so keep it in lockstep with the web.
 *
 * ParsedEvents stay FlatBuffer views; strings are materialized inside
 * accessors only (project convention, see src/lib/catalog.ts).
 */
import {extractTagValue, type ParsedEvent} from '@candypoets/nipworker';
import {catalogEventAddress, catalogMaxUses, catalogType, catalogUsesQrFulfillment} from './catalog';

// Statuses moved off the ephemeral range (strfry evicts those after ~300 s)
// to the addressable range: the relay itself now keeps the latest status per
// context (`d` = 'order:<ref>' | 'event:<address>'). Read BOTH kinds during
// the transition; writers (web scanner) publish 37237 only.
export const BADGE_STATUS_KIND = 37237;
export const LEGACY_BADGE_STATUS_KIND = 27237;

export const BADGE_STATUSES = [
  'pending',
  'accepted',
  'processing',
  'ready',
  'fulfilled',
  'cancelled',
] as const;

export type BadgeStatus = (typeof BADGE_STATUSES)[number];

export function isBadgeStatus(value: string | undefined): value is BadgeStatus {
  return BADGE_STATUSES.includes(value as BadgeStatus);
}

/** Latest status per fulfillment context (created_at desc, lower id breaks ties). */
export function latestStatusEvents(award: ParsedEvent, statuses: ParsedEvent[]): ParsedEvent[] {
  const awardId = award.id();
  const address = extractTagValue(award, 'a');
  const recipient = extractTagValue(award, 'p');
  if (!awardId || !address || !recipient) return [];

  const latest = new Map<string, ParsedEvent>();
  for (const event of statuses) {
    if (
      (event.kind() !== BADGE_STATUS_KIND && event.kind() !== LEGACY_BADGE_STATUS_KIND) ||
      extractTagValue(event, 'e') !== awardId ||
      extractTagValue(event, 'a') !== address ||
      extractTagValue(event, 'p') !== recipient ||
      !isBadgeStatus(extractTagValue(event, 'status'))
    ) {
      continue;
    }
    const order = extractTagValue(event, 'order');
    const eventContext = extractTagValue(event, 'event');
    if (Boolean(order) === Boolean(eventContext)) continue;
    // d carries the same context for addressability on 37237; legacy 27237
    // events have no d, so fall back to the order/event tags.
    const contextKey = extractTagValue(event, 'd') || (order ? `order:${order}` : `event:${eventContext}`);
    const current = latest.get(contextKey);
    if (
      !current ||
      event.createdAt() > current.createdAt() ||
      (event.createdAt() === current.createdAt() && (event.id() || '') < (current.id() || ''))
    ) {
      latest.set(contextKey, event);
    }
  }
  return Array.from(latest.values()).sort(
    (left, right) =>
      right.createdAt() - left.createdAt() || (left.id() || '').localeCompare(right.id() || ''),
  );
}

/** Fulfilled uses of one award: one per context whose latest status is `fulfilled`. */
export function fulfilledUseCount(award: ParsedEvent, statuses: ParsedEvent[]) {
  return latestStatusEvents(award, statuses).filter(
    event => extractTagValue(event, 'status') === 'fulfilled',
  ).length;
}

/** Remaining uses; `undefined` means the definition is unlimited. */
export function remainingAwardUses(
  award: ParsedEvent,
  definition: ParsedEvent,
  statuses: ParsedEvent[],
) {
  const maxUses = catalogMaxUses(definition);
  if (!maxUses) return undefined;
  return Math.max(0, maxUses - fulfilledUseCount(award, statuses));
}

export function isAwardExpired(award: ParsedEvent, now = Math.floor(Date.now() / 1000)) {
  const expiration = Number(extractTagValue(award, 'expiration') || 0);
  return Boolean(expiration && expiration <= now);
}

/** Human-facing order reference: status order tag → award order tag → invoice → award id. */
export function awardOrderReference(award: ParsedEvent, statuses: ParsedEvent[] = []) {
  const fromStatus = statuses.map(event => extractTagValue(event, 'order')).find(Boolean);
  const fromAward = extractTagValue(award, 'order');
  const invoice = extractTagValue(award, 'i');
  return (
    fromStatus || fromAward || invoice?.replace(/^payment-redemption:/, '') || award.id() || ''
  );
}

/**
 * Presentation context by entitlement type (web kind8.svelte `showEntitlementQr`):
 * products fulfill against their purchase order ref, tickets against the event
 * coordinate, and every pass/membership scan gets a FRESH single-use context so
 * each door scan counts exactly one use.
 */
export function presentationContextFor(
  award: ParsedEvent,
  definition: ParsedEvent | undefined,
  freshUseNonce: () => string,
): {orderId?: string; eventAddress?: string} {
  const type = definition ? catalogType(definition) : undefined;
  if (type === 'event_access') {
    const eventAddress = definition ? catalogEventAddress(definition) : '';
    if (eventAddress) return {eventAddress};
  }
  if (type === 'pass' || type === 'membership') {
    return {orderId: `use:${freshUseNonce()}`};
  }
  return {orderId: awardOrderReference(award)};
}

/**
 * Whether the QR may be presented at all (web kind8.svelte
 * `canPresentEntitlement`): nothing to present once a single-use entitlement
 * is fulfilled/cancelled, or once a pass has no remaining uses.
 */
export function canPresentEntitlement(
  award: ParsedEvent,
  definition: ParsedEvent | undefined,
  statuses: ParsedEvent[],
) {
  if (!definition) return false;
  const type = catalogType(definition);
  const latest = latestStatusEvents(award, statuses);
  const latestStatus = latest[0] ? extractTagValue(latest[0], 'status') : undefined;
  if (type === 'product') {
    // Web kind8.svelte: only QR-fulfillment products (food/drink) present a QR.
    return (
      catalogUsesQrFulfillment(definition) &&
      Boolean(awardOrderReference(award)) &&
      latestStatus !== 'fulfilled' &&
      latestStatus !== 'cancelled'
    );
  }
  if (type === 'event_access') {
    return Boolean(catalogEventAddress(definition)) && latestStatus !== 'fulfilled';
  }
  if (type === 'pass') {
    const remaining = remainingAwardUses(award, definition, statuses);
    return remaining === undefined || remaining > 0;
  }
  return type === 'membership';
}

/** The award's overall latest status value across contexts, if any. */
export function latestStatusValue(
  award: ParsedEvent,
  statuses: ParsedEvent[],
): BadgeStatus | undefined {
  const latest = latestStatusEvents(award, statuses)[0];
  const value = latest ? extractTagValue(latest, 'status') : undefined;
  return isBadgeStatus(value) ? value : undefined;
}

/** Member-facing status label (web orders board uses its own staff labels). */
export function badgeStatusLabel(status: BadgeStatus | 'none') {
  switch (status) {
    case 'pending':
      return 'Order placed';
    case 'accepted':
      return 'Accepted';
    case 'processing':
      return 'Being prepared';
    case 'ready':
      return 'Ready — show your QR';
    case 'fulfilled':
      return 'Served';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Waiting for staff';
  }
}
