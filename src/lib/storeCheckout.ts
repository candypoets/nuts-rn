import {useSignEvent} from '@candypoets/nipworker/hooks';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';
import type {Event, EventTemplate} from 'nostr-tools';

/**
 * Stripe checkout for community store items (ported from nuts-cash
 * src/lib/invites.ts makeInviteAuthorization + CommunityStorefront.startCheckout).
 * The POST contract lives in nuts-cash src/routes/api/stripe/checkout/+server.ts:
 * body {community, eventAddress, returnTo}, NIP-98 Authorization header,
 * response {url}.
 */
export const CHECKOUT_ORIGIN = 'https://nuts.cash';
export const CHECKOUT_API_URL = `${CHECKOUT_ORIGIN}/api/stripe/checkout`;

/** Web path the buyer returns to after the hosted checkout completes. */
const CHECKOUT_RETURN_TO = '/explore';
const SIGN_TIMEOUT_MS = 20_000;

/* eslint-disable no-bitwise */
function base64Encode(value: string) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  let index = 0;

  while (index < value.length) {
    const chr1 = value.charCodeAt(index++);
    const chr2 = value.charCodeAt(index++);
    const chr3 = value.charCodeAt(index++);
    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    const enc3 = Number.isNaN(chr2) ? 64 : ((chr2 & 15) << 2) | (chr3 >> 6);
    const enc4 = Number.isNaN(chr3) ? 64 : chr3 & 63;
    output +=
      chars.charAt(enc1) +
      chars.charAt(enc2) +
      chars.charAt(enc3) +
      chars.charAt(enc4);
  }

  return output;
}
/* eslint-enable no-bitwise */

function base64UrlEncode(value: string) {
  return base64Encode(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[=]+$/g, '');
}

function canonicalAuthEvent(signed: Event) {
  if (!signed.id || !signed.pubkey || !signed.sig) {
    throw new Error('Failed to sign checkout authorization');
  }

  return {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: signed.kind,
    tags: signed.tags,
    content: signed.content,
    sig: signed.sig,
  };
}

let signQueue = Promise.resolve();

function signEventUnqueued(template: EventTemplate) {
  return new Promise<Event>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out while waiting for the Nostr signer'));
    }, SIGN_TIMEOUT_MS);
    try {
      useSignEvent(template, signedEvent => {
        clearTimeout(timeout);
        if (typeof signedEvent === 'string') {
          resolve(JSON.parse(signedEvent));
          return;
        }
        resolve(signedEvent);
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function signEvent(template: EventTemplate) {
  const next = signQueue.then(() => signEventUnqueued(template));
  signQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** NIP-98 (kind 27235) Authorization header for the checkout POST. */
export async function makeCheckoutAuthorization(url: string, body: string) {
  const payloadHash = bytesToHex(sha256(utf8ToBytes(body)));
  const signed = await signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', payloadHash],
    ],
    content: '',
  });

  return `Nostr ${base64UrlEncode(JSON.stringify(canonicalAuthEvent(signed)))}`;
}

/**
 * Starts a Stripe checkout for one catalog item and returns the hosted
 * checkout URL to open. Throws with the server's message on failure.
 */
export async function requestCheckoutUrl(options: {
  relay: string;
  eventAddress: string;
}) {
  const body = JSON.stringify({
    community: options.relay,
    eventAddress: options.eventAddress,
    returnTo: CHECKOUT_RETURN_TO,
  });
  const authorization = await makeCheckoutAuthorization(CHECKOUT_API_URL, body);
  const response = await fetch(CHECKOUT_API_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization},
    body,
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      message?: unknown;
      error?: unknown;
    };
    const message =
      typeof result.message === 'string'
        ? result.message
        : typeof result.error === 'string'
          ? result.error
          : 'Checkout unavailable';
    throw new Error(message);
  }
  const result = (await response.json().catch(() => ({}))) as {url?: unknown};
  if (typeof result.url !== 'string' || !result.url) {
    throw new Error('Checkout unavailable');
  }
  return result.url;
}
