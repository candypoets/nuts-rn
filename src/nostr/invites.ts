import type {
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  usePublish as publishToNostr,
} from '@candypoets/nipworker/hooks';
import { asKind0, asParsedEvent, isConnectionStatus } from '@candypoets/nipworker/utils';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { EventTemplate } from 'nostr-tools';
import { normalizeURL } from 'nostr-tools/utils';

import { INDEXER_RELAYS, useNostrStore, type RelayMarker } from '../stores';
import {subscribeUntilEose} from './subscribeUntilEose';
import { base64UrlEncode, canonicalAuthEvent, signEvent } from './upload';

/**
 * Invite redemption, ported from the web app (nuts-cash
 * src/routes/redeem/+page.svelte, src/lib/invites.ts, src/lib/adminRelays.ts).
 *
 * An invite link carries `relay` (the community invite service's HTTP base
 * URL) and an opaque server-signed `token`. Redemption POSTs to
 * `{relay}/redeem` with a NIP-98 auth header; the service then awards the
 * member badge (kind 8) on the community relay, and we publish the membership
 * index events (10012 / 30002 / 10002) plus a kind-0 replica ourselves.
 */

export type RedeemStage = 'request' | 'indexes' | 'profile';

export type CommunityInfo = {
  name?: string;
  image?: string;
};

const MEMBER_RELAY_SET_D = 'nuts-relays-member';
const RELAY_FEED_ROLES = ['admin', 'member', 'following'] as const;

function now() {
  return Math.floor(Date.now() / 1000);
}

export function normalizeRelayBaseUrl(value: string) {
  if (!value) return '';
  const normalized = value.trim().replace(/\/$/, '');
  if (normalized.startsWith('wss://')) return `https://${normalized.slice(6)}`;
  if (normalized.startsWith('ws://')) return `http://${normalized.slice(5)}`;
  return normalized;
}

export function relayUrlFromBaseUrl(value: string) {
  if (!value) return '';
  if (value.startsWith('https://')) return `wss://${value.slice(8)}`;
  if (value.startsWith('http://')) return `ws://${value.slice(7)}`;
  return value;
}

export function communityNameFromRelay(url: string) {
  try {
    const hostname = new URL(url).hostname;
    const firstLabel = hostname.split('.')[0] || hostname;
    return firstLabel
      .split(/[-_]+/)
      .filter(Boolean)
      .map(part => (part[0] ? part[0].toUpperCase() + part.slice(1) : ''))
      .join(' ');
  } catch {
    return url;
  }
}

/** NIP-11 lookup for the community's display name/image. Never throws. */
export async function fetchCommunityInfo(
  relayBaseUrl: string,
): Promise<CommunityInfo> {
  if (!relayBaseUrl) return {};
  try {
    const response = await fetch(relayBaseUrl, {
      headers: { accept: 'application/nostr+json' },
    });
    if (!response.ok) return {};
    const info = await response.json();
    const name =
      typeof info?.name === 'string' && info.name.trim()
        ? info.name.trim()
        : undefined;
    let image: string | undefined;
    for (const field of ['picture', 'image', 'icon', 'logo']) {
      const value = info?.[field];
      if (typeof value === 'string' && value.trim()) {
        image = value.trim();
        break;
      }
    }
    return { name, image };
  } catch {
    // The invite remains redeemable with the URL-derived community name.
    return {};
  }
}

function statusText(message: WorkerMessage) {
  const status = isConnectionStatus(message);
  return status?.status()?.toString().toLowerCase() ?? null;
}

/**
 * One-shot query: resolves with the latest matching event's projection after
 * the first EOSE or `timeoutMs`, whichever comes first. The projection is
 * built inside the callback so no zero-copy FlatBuffer escapes it.
 */
function fetchExistingEvent<T>(
  subId: string,
  requests: RequestObject[],
  select: (event: ParsedEvent) => T | null,
  timeoutMs = 2500,
): Promise<{ value: T; createdAt: number } | undefined> {
  return new Promise(resolve => {
    let latest: { value: T; createdAt: number } | undefined;
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(latest);
    };

    const timeout = setTimeout(finish, timeoutMs);
    unsubscribe = subscribeUntilEose(subId, requests, (message: WorkerMessage) => {
      if (statusText(message) === 'eose') {
        finish();
        return;
      }
      const event = asParsedEvent(message);
      if (!event) return;
      const value = select(event);
      if (value === null) return;
      const createdAt = event.createdAt() || 0;
      if (!latest || createdAt > latest.createdAt) {
        latest = { value, createdAt };
      }
    });
  });
}

function parsedEventTags(event: ParsedEvent): string[][] {
  const tags: string[][] = [];
  const tagsLength = event.tagsLength();
  for (let i = 0; i < tagsLength; i++) {
    const tagVec = event.tags(i);
    if (!tagVec) continue;
    const tag: string[] = [];
    const itemsLength = tagVec.itemsLength();
    for (let j = 0; j < itemsLength; j++) {
      tag.push(tagVec.items(j));
    }
    tags.push(tag);
  }
  return tags;
}

function relayUrlsFromTags(tags: string[][]) {
  const urls = tags
    .filter(tag => tag[0] === 'relay' && tag[1])
    .map(tag => normalizeURL(tag[1]));
  return Array.from(new Set(urls));
}

/**
 * Copies a kind-0 profile into fresh JSON content for replication onto the
 * community relay (ported from nuts-cash src/lib/profileReplication.ts). Runs
 * inside the subscription callback — the FlatBuffer does not escape it.
 */
function profileContentFromKind0(event: ParsedEvent): string {
  const profile = asKind0(event);
  if (!profile) return '{}';
  const metadata: Record<string, string> = {};
  const add = (key: string, value: string | null) => {
    if (value !== null && value !== undefined) metadata[key] = value;
  };
  add('name', profile.name());
  add('display_name', profile.displayName());
  add('picture', profile.picture());
  add('banner', profile.banner());
  add('about', profile.about());
  add('website', profile.website());
  add('nip05', profile.nip05());
  add('lud06', profile.lud06());
  add('lud16', profile.lud16());
  add('github', profile.github());
  add('twitter', profile.twitter());
  add('mastodon', profile.mastodon());
  add('nostr', profile.nostr());
  add('displayName', profile.displayNameAlt());
  add('username', profile.username());
  add('bio', profile.bio());
  add('image', profile.image());
  add('avatar', profile.avatar());
  add('background', profile.background());
  return JSON.stringify(metadata);
}

/** NIP-98 HTTP auth header for the invite service (`Nostr <base64url(event)>`). */
async function makeInviteAuthorization(url: string, body: string) {
  const payloadHash = bytesToHex(sha256(new TextEncoder().encode(body)));
  const signed = await signEvent({
    kind: 27235,
    created_at: now(),
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', payloadHash],
    ],
    content: '',
  });
  return `Nostr ${base64UrlEncode(JSON.stringify(canonicalAuthEvent(signed)))}`;
}

/** True when the community relay already holds a kind-8 badge award for pubkey. */
export async function checkExistingMembership(
  pubkey: string,
  communityRelayUrl: string,
): Promise<boolean> {
  if (!pubkey || !communityRelayUrl) return false;
  const award = await fetchExistingEvent(
    `invite_membership_${pubkey.slice(0, 12)}_${Date.now()}`,
    [
      {
        kinds: [8],
        tags: { '#p': [pubkey] },
        limit: 10,
        relays: [communityRelayUrl],
        cacheFirst: true,
      },
    ],
    event => {
      if (event.kind() !== 8) return null;
      const tags = parsedEventTags(event);
      return tags.some(tag => tag[0] === 'p' && tag[1] === pubkey) ? true : null;
    },
  );
  return Boolean(award);
}

/** Publishes an event, resolving on the first OK/EOSE or after `timeoutMs`. */
function publishEvent(event: EventTemplate, id: string, relays: string[]) {
  return new Promise<void>(resolve => {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve();
    };
    const timeout = setTimeout(finish, 1800);
    unsubscribe = publishToNostr(
      id,
      event,
      (message: WorkerMessage) => {
        const status = statusText(message);
        if (status === 'ok' || status === 'eose' || status === 'true') finish();
      },
      { trackStatus: true, defaultRelays: relays },
    );
  });
}

/** Publishes kind 0 to the community relay, awaiting its explicit OK. */
function publishProfileToCommunity(
  pubkey: string,
  profileEvent: EventTemplate,
  communityRelayUrl: string,
) {
  return new Promise<void>((resolve, reject) => {
    const targetRelay = normalizeURL(communityRelayUrl);
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    // The badge gate's membership cache can lag behind the just-granted
    // invite award, so a rejected OK is not final — republish until the
    // relay confirms or the window closes (a single 12s attempt failed
    // fresh redeems while the gate was cold).
    const timeout = setTimeout(
      () => finish(new Error('The community relay did not confirm your profile.')),
      30000,
    );
    const attempt = () => {
      if (settled) return;
      unsubscribe?.();
      unsubscribe = publishToNostr(
        `invite_profile_${pubkey}`,
        { ...profileEvent, created_at: now() },
        (message: WorkerMessage) => {
          const status = isConnectionStatus(message);
          const relayUrl = status?.relayUrl();
          if (!status || !relayUrl || normalizeURL(relayUrl) !== targetRelay) return;
          const value = status.status()?.toString().toLowerCase();
          if (value === 'true' || value === 'ok') {
            finish();
            return;
          }
          if (value?.startsWith('false') && !settled && !retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              attempt();
            }, 2500);
          }
        },
        { trackStatus: true, defaultRelays: [communityRelayUrl] },
      );
    };
    attempt();
  });
}

function relaySetAddress(pubkey: string, role: (typeof RELAY_FEED_ROLES)[number]) {
  return `30002:${pubkey}:nuts-relays-${role}`;
}

function mergeRelayFeedIndexTags(existingTags: string[][], pubkey: string) {
  const tags = [...existingTags];
  const seen = new Set(tags.map(tag => tag.join('')));
  for (const role of RELAY_FEED_ROLES) {
    const tag = ['a', relaySetAddress(pubkey, role)];
    const key = tag.join('');
    if (seen.has(key)) continue;
    tags.push(tag);
    seen.add(key);
  }
  return tags;
}

function buildMemberRelaySetTags(existingTags: string[][], relayUrl: string) {
  const urls = new Set(relayUrlsFromTags(existingTags));
  urls.add(normalizeURL(relayUrl));
  return [
    ['d', MEMBER_RELAY_SET_D],
    ['title', 'Nuts relays I am a member of'],
    ['description', 'Relays where this Nuts account is a member'],
    ...Array.from(urls)
      .sort()
      .map(url => ['relay', url]),
  ];
}

function buildRelayListTagsWithReadRelay(
  existingTags: string[][],
  relayUrl: string,
) {
  const relayModes = new Map<string, { read: boolean; write: boolean }>();
  const addRelay = (url: string, read = true, write = true) => {
    const normalized = normalizeURL(url);
    const existing = relayModes.get(normalized) || { read: false, write: false };
    relayModes.set(normalized, {
      read: existing.read || read,
      write: existing.write || write,
    });
  };

  for (const tag of existingTags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    const marker = tag[2];
    addRelay(tag[1], marker !== 'write', marker !== 'read');
  }
  addRelay(relayUrl, true, false);

  return Array.from(relayModes.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([url, mode]) => {
      if (mode.read && mode.write) return ['r', url];
      if (mode.read) return ['r', url, 'read'];
      return ['r', url, 'write'];
    });
}

/**
 * Redeems an invite for the logged-in pubkey. Throws with a user-displayable
 * message on failure; resolves with the community relay URL on success.
 */
export async function redeemInvite({
  token,
  relayBaseUrl,
  pubkey,
  onStage,
}: {
  token: string;
  relayBaseUrl: string;
  pubkey: string;
  onStage?: (stage: RedeemStage) => void;
}): Promise<{ communityRelayUrl: string }> {
  const communityRelayUrl = relayUrlFromBaseUrl(relayBaseUrl);
  const redeemEndpoint = `${relayBaseUrl}/redeem`;
  if (!token || !communityRelayUrl) {
    throw new Error('This invite link is missing required information.');
  }

  onStage?.('request');
  const body = JSON.stringify({ token, pubkey });
  const authorization = await makeInviteAuthorization(redeemEndpoint, body);
  const response = await fetch(redeemEndpoint, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body,
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Could not redeem invite.');
  }

  onStage?.('indexes');
  const fetchKey = `${pubkey.slice(0, 12)}_${Date.now()}`;
  const [relayFeed, memberRelaySet, relayList, existingProfile] =
    await Promise.all([
      fetchExistingEvent(
        `invite_feed_${fetchKey}`,
        [
          {
            kinds: [10012],
            authors: [pubkey],
            limit: 10,
            relays: INDEXER_RELAYS,
            noCache: true,
          },
        ],
        event => (event.kind() === 10012 ? parsedEventTags(event) : null),
      ),
      fetchExistingEvent(
        `invite_member_set_${fetchKey}`,
        [
          {
            kinds: [30002],
            authors: [pubkey],
            tags: { '#d': [MEMBER_RELAY_SET_D] },
            limit: 10,
            relays: INDEXER_RELAYS,
            noCache: true,
          },
        ],
        event => {
          if (event.kind() !== 30002 || event.pubkey() !== pubkey) return null;
          const tags = parsedEventTags(event);
          return tags.some(
            tag => tag[0] === 'd' && tag[1] === MEMBER_RELAY_SET_D,
          )
            ? tags
            : null;
        },
      ),
      fetchExistingEvent(
        `invite_relay_list_${fetchKey}`,
        [
          {
            kinds: [10002],
            authors: [pubkey],
            limit: 10,
            relays: INDEXER_RELAYS,
            cacheFirst: true,
          },
        ],
        event => (event.kind() === 10002 ? parsedEventTags(event) : null),
      ),
      fetchExistingEvent(
        `invite_profile_${fetchKey}`,
        [
          {
            kinds: [0],
            authors: [pubkey],
            limit: 10,
            relays: INDEXER_RELAYS,
            cacheFirst: true,
          },
        ],
        event => {
          if (event.kind() !== 0 || event.pubkey() !== pubkey) return null;
          return profileContentFromKind0(event);
        },
      ),
    ]);

  const timestamp = now();
  const publishRelays = Array.from(
    new Set([...INDEXER_RELAYS, communityRelayUrl]),
  );
  const relayFeedTags = mergeRelayFeedIndexTags(
    relayFeed?.value ?? [],
    pubkey,
  );
  const memberRelaySetTags = buildMemberRelaySetTags(
    memberRelaySet?.value ?? [],
    communityRelayUrl,
  );
  const relayListTags = buildRelayListTagsWithReadRelay(
    relayList?.value ?? [],
    communityRelayUrl,
  );

  await publishEvent(
    { kind: 10012, tags: relayFeedTags, content: '', created_at: timestamp },
    `invite_relay_feed_${pubkey}`,
    publishRelays,
  );
  await publishEvent(
    { kind: 30002, tags: memberRelaySetTags, content: '', created_at: timestamp },
    `invite_member_relay_set_${pubkey}`,
    publishRelays,
  );
  await publishEvent(
    { kind: 10002, tags: relayListTags, content: '', created_at: timestamp },
    `invite_relay_list_${pubkey}`,
    publishRelays,
  );

  onStage?.('profile');
  const profileContent = existingProfile?.value || '{}';
  await publishProfileToCommunity(
    pubkey,
    { kind: 0, tags: [], content: profileContent, created_at: timestamp },
    communityRelayUrl,
  );

  // Reflect the new membership in the local stores immediately; the root
  // subscriptions will confirm from the relays later.
  const store = useNostrStore.getState();
  const markers: RelayMarker[] = relayListTags.map(tag => ({
    url: tag[1],
    read: tag[2] !== 'write',
    write: tag[2] !== 'read',
  }));
  store.setRelayMarkers(markers);
  store.setKindTimestamp(10002, timestamp);
  store.setRelayDirectoryAddresses(
    relayFeedTags.filter(tag => tag[0] === 'a').map(tag => tag[1]),
  );
  store.setRelayRoleSet({
    address: relaySetAddress(pubkey, 'member'),
    createdAt: timestamp,
    d: MEMBER_RELAY_SET_D,
    relays: memberRelaySetTags
      .filter(tag => tag[0] === 'relay')
      .map(tag => tag[1]),
  });

  return { communityRelayUrl };
}
