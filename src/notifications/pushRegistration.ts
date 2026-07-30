import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import {
  base64UrlEncode,
  canonicalAuthEvent,
  signEvent,
} from '../nostr/upload';

export const PUSH_API_URL =
  process.env.EXPO_PUBLIC_PUSH_API_URL?.replace(/\/+$/, '') ||
  'https://push.nuts.cash';

export type PushPlatform = 'apns' | 'apns-sandbox' | 'fcm';

export function normalizePushRelays(relays: string[]) {
  return Array.from(
    new Set(
      relays
        .map(relay => relay.trim().replace(/\/+$/, ''))
        .filter(relay => /^wss?:\/\/[^/]/i.test(relay)),
    ),
  ).sort();
}

async function makePushAuthorization(url: string, body: string) {
  const payloadHash = bytesToHex(sha256(new TextEncoder().encode(body)));
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

async function postPushRequest(path: string, payload: unknown) {
  const url = `${PUSH_API_URL}${path}`;
  const body = JSON.stringify(payload);
  const authorization = await makePushAuthorization(url, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          `Push service returned ${response.status}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function registerPushDevice(
  platform: PushPlatform,
  token: string,
  relays: string[],
) {
  const normalizedRelays = normalizePushRelays(relays);
  if (!token || normalizedRelays.length === 0) return;
  await postPushRequest('/push/register', {
    platform,
    token,
    relays: normalizedRelays,
  });
}

export async function unregisterPushDevice(token: string) {
  if (!token) return;
  await postPushRequest('/push/unregister', { token });
}
