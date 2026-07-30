/**
 * Entitlement presentation QR (kind 27236) — member-side port of the web
 * reference `nuts-cash/src/lib/presentation.ts`. The QR payload is
 * `nuts:present:<base64url(JSON(signed 27236))>` with a 90 s lifetime; staff
 * scanners (web) verify signature + window + the award on the community relay.
 *
 * Signing goes through `signEvent` (src/nostr/upload.ts), which delegates to
 * nipworker's active signer, so this works for nsec, NIP-46 and Amber logins.
 */
import type {EventTemplate} from 'nostr-tools';
import {base64UrlEncode, signEvent} from './upload';

export const PRESENTATION_KIND = 27236;
export const PRESENTATION_PREFIX = 'nuts:present:';
export const PRESENTATION_LIFETIME_SECONDS = 90;
export const ENTITLEMENT_PRESENTATION_TYPE = 'nuts_entitlement_presentation';

/** Re-sign cadence while a QR is on screen (comfortably inside the lifetime). */
export const PRESENTATION_REFRESH_MS = 60 * 1000;

export type EntitlementPresentationInput = {
  awardId: string;
  badgeAddress: string;
  community: string;
  orderId?: string;
  eventAddress?: string;
};

function isHexEventId(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

function isBadgeAddress(value: string) {
  const [kind, author, ...identifierParts] = value.split(':');
  return kind === '30009' && isHexEventId(author) && Boolean(identifierParts.join(':'));
}

function isEventAddress(value: string) {
  const [kind, author, ...identifierParts] = value.split(':');
  return (
    (kind === '31922' || kind === '31923') &&
    isHexEventId(author) &&
    Boolean(identifierParts.join(':'))
  );
}

function isCommunityRelay(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'wss:' || url.protocol === 'ws:') && Boolean(url.host);
  } catch {
    return false;
  }
}

// Hermes has no crypto.randomUUID; 16 bytes of secure randomness is plenty
// for a single-use nonce.
export function presentationNonce() {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as {crypto?: {getRandomValues?: (b: Uint8Array) => void}})
    .crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function entitlementPresentationTemplate(
  input: EntitlementPresentationInput,
  createdAt = Math.floor(Date.now() / 1000),
): EventTemplate {
  if (!isHexEventId(input.awardId)) throw new Error('Award event ID is invalid');
  if (!isBadgeAddress(input.badgeAddress)) throw new Error('Badge address is invalid');
  if (!isCommunityRelay(input.community)) throw new Error('Community relay is invalid');
  if (Boolean(input.orderId) === Boolean(input.eventAddress)) {
    throw new Error('Exactly one fulfillment context is required');
  }
  if (input.eventAddress && !isEventAddress(input.eventAddress)) {
    throw new Error('Event address is invalid');
  }
  if (input.orderId !== undefined && !input.orderId.trim()) {
    throw new Error('Order ID is invalid');
  }
  return {
    kind: PRESENTATION_KIND,
    created_at: createdAt,
    content: '',
    tags: [
      ['type', ENTITLEMENT_PRESENTATION_TYPE],
      ['expiration', String(createdAt + PRESENTATION_LIFETIME_SECONDS)],
      ['nonce', presentationNonce()],
      ['e', input.awardId],
      ['a', input.badgeAddress],
      ['r', input.community],
      ...(input.orderId ? [['order', input.orderId]] : [['event', input.eventAddress || '']]),
    ],
  };
}

/**
 * Builds a fresh signed presentation and returns the QR payload string.
 * Throws when the input is invalid or no signer is available (logged out).
 */
export async function encodeEntitlementPresentation(
  input: EntitlementPresentationInput,
): Promise<string> {
  const signed = await signEvent(entitlementPresentationTemplate(input));
  return PRESENTATION_PREFIX + base64UrlEncode(JSON.stringify(signed));
}
