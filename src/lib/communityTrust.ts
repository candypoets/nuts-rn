/**
 * NIP-97 community trust and fulfillment-signer authorization.
 *
 * The relay's NIP-11 pubkey is the sole trust root. Its current kind-31727
 * anchor supplies admins and the delegated badge issuer. HTTP service metadata
 * is deliberately not consulted for authority.
 */
import type {ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {extractTagValue} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';

import {
  COMMUNITY_ANCHOR_D,
  COMMUNITY_ANCHOR_KIND,
  FULFILLMENT_KIND,
  ROLE_MEMBERSHIP_KIND,
  parsePermissionTag,
  permissionGrants,
} from './nip97';

export type CommunityTrust = {
  rootPubkey?: string;
  authorityPubkeys: Set<string>;
  badgeIssuer?: string;
};

type AccessEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
};

function relayHttpUrl(relay: string) {
  if (relay.startsWith('wss://')) return `https://${relay.slice(6)}`;
  if (relay.startsWith('ws://')) return `http://${relay.slice(5)}`;
  return relay;
}

function validPubkey(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function tagValue(tags: string[][], name: string) {
  return tags.find(tag => tag[0] === name)?.[1];
}

function hasTagValue(tags: string[][], name: string, value: string) {
  return tags.some(tag => tag[0] === name && tag[1] === value);
}

function isNewer(candidate: AccessEvent, current: AccessEvent) {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

function materialize(event: ParsedEvent): AccessEvent | null {
  const id = event.id();
  const pubkey = validPubkey(event.pubkey());
  if (!id || !pubkey) return null;
  const tags: string[][] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tagVec = event.tags(index);
    if (!tagVec) continue;
    const tag: string[] = [];
    for (let item = 0; item < tagVec.itemsLength(); item += 1) {
      tag.push(tagVec.items(item));
    }
    tags.push(tag);
  }
  return {
    id,
    kind: event.kind(),
    pubkey,
    created_at: event.createdAt() || 0,
    tags,
  };
}

function collectEvents(
  subId: string,
  requests: Parameters<typeof subscribeToNostr>[1],
  timeoutMs = 2500,
): Promise<AccessEvent[]> {
  return new Promise(resolve => {
    const collected: AccessEvent[] = [];
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(collected);
    };
    const timeout = setTimeout(finish, timeoutMs);
    unsubscribe = subscribeToNostr(subId, requests, (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (status) {
        if (status.status()?.toString().toLowerCase() === 'eose') finish();
        return;
      }
      const event = asParsedEvent(message);
      if (!event) return;
      const plain = materialize(event);
      if (plain) collected.push(plain);
    });
  });
}

const TRUST_CACHE_TTL_MS = 60_000;
const trustCache = new Map<
  string,
  {expiresAt: number; promise: Promise<CommunityTrust>}
>();

/** Resolve the current root-signed anchor from the community relay. */
export function fetchCommunityTrust(relay: string): Promise<CommunityTrust> {
  const cached = trustCache.get(relay);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    let rootPubkey: string | undefined;
    try {
      const response = await fetch(relayHttpUrl(relay), {
        headers: {accept: 'application/nostr+json'},
      });
      if (response.ok) rootPubkey = validPubkey((await response.json())?.pubkey);
    } catch {
      // No NIP-11 root means no authority can be established.
    }
    if (!rootPubkey) return {authorityPubkeys: new Set<string>()};

    let anchors: AccessEvent[];
    try {
      anchors = await collectEvents(
        `nip97_anchor_${Date.now().toString(36)}_${rootPubkey.slice(0, 8)}`,
        [
          {
            kinds: [COMMUNITY_ANCHOR_KIND],
            authors: [rootPubkey],
            tags: {'#d': [COMMUNITY_ANCHOR_D]},
            limit: 10,
            relays: [relay],
            noCache: true,
          },
        ],
      );
    } catch {
      return {rootPubkey, authorityPubkeys: new Set<string>()};
    }
    const current = anchors
      .filter(
        event =>
          event.kind === COMMUNITY_ANCHOR_KIND &&
          event.pubkey === rootPubkey &&
          tagValue(event.tags, 'd') === COMMUNITY_ANCHOR_D,
      )
      .reduce<AccessEvent | undefined>(
        (latest, candidate) => (!latest || isNewer(candidate, latest) ? candidate : latest),
        undefined,
      );
    if (!current) {
      return {rootPubkey, authorityPubkeys: new Set<string>()};
    }
    const authorityPubkeys = new Set(
      current.tags
        .flatMap(tag => {
          const pubkey = tag[0] === 'p' ? validPubkey(tag[1]) : undefined;
          return pubkey ? [pubkey] : [];
        }),
    );
    return {
      rootPubkey,
      authorityPubkeys,
      badgeIssuer: validPubkey(tagValue(current.tags, 'badge_issuer')),
    };
  })();
  trustCache.set(relay, {
    expiresAt: Date.now() + TRUST_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

/** NIP-97 award issuance authorization against the current anchor. */
export function awardSignerAuthorized(
  award: ParsedEvent,
  definition: ParsedEvent,
  trust: CommunityTrust,
) {
  const signer = award.pubkey()?.toLowerCase();
  if (!signer) return false;
  if (trust.authorityPubkeys.has(signer)) return true;
  return signer === trust.badgeIssuer && extractTagValue(definition, 'price') !== undefined;
}

function plainAwardAuthorized(award: AccessEvent, definition: AccessEvent, trust: CommunityTrust) {
  if (trust.authorityPubkeys.has(award.pubkey)) return true;
  return award.pubkey === trust.badgeIssuer && tagValue(definition.tags, 'price') !== undefined;
}

function roleGrantsFulfillment(
  definitions: AccessEvent[],
  awards: AccessEvent[],
  deletions: AccessEvent[],
  pubkey: string,
  trust: CommunityTrust,
) {
  const now = Math.floor(Date.now() / 1000);
  const latestDefinitions = new Map<string, AccessEvent>();
  for (const definition of definitions) {
    if (
      definition.kind !== ROLE_MEMBERSHIP_KIND ||
      !trust.authorityPubkeys.has(definition.pubkey) ||
      !hasTagValue(definition.tags, 't', 'role')
    ) {
      continue;
    }
    const d = tagValue(definition.tags, 'd');
    if (!d) continue;
    const address = `${ROLE_MEMBERSHIP_KIND}:${definition.pubkey}:${d}`;
    const current = latestDefinitions.get(address);
    if (!current || isNewer(definition, current)) {
      latestDefinitions.set(address, definition);
    }
  }

  for (const award of awards) {
    if (award.kind !== 8 || !award.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey)) {
      continue;
    }
    const address = tagValue(award.tags, 'a');
    const definition = address ? latestDefinitions.get(address) : undefined;
    if (!definition || !plainAwardAuthorized(award, definition, trust)) continue;
    const expiration = tagValue(award.tags, 'expiration');
    if (expiration !== undefined && (!/^\d+$/.test(expiration) || Number(expiration) <= now)) {
      continue;
    }
    const revoked = deletions.some(
      deletion =>
        deletion.kind === 5 &&
        (deletion.pubkey === award.pubkey || trust.authorityPubkeys.has(deletion.pubkey)) &&
        deletion.tags.some(tag => tag[0] === 'e' && tag[1] === award.id),
    );
    if (revoked) continue;
    if (
      definition.tags
        .map(parsePermissionTag)
        .some(permission => permission && permissionGrants(permission, FULFILLMENT_KIND, 'write'))
    ) {
      return true;
    }
  }
  return false;
}

const authorizationCache = new Map<
  string,
  {expiresAt: number; promise: Promise<boolean>}
>();

/** Is a signer authorized to publish NIP-97 fulfillment statuses? */
export function fetchStatusSignerAuthorized(relay: string, signer: string): Promise<boolean> {
  const normalized = signer.toLowerCase();
  const key = `${relay}|${normalized}`;
  const cached = authorizationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    const trust = await fetchCommunityTrust(relay);
    if (trust.authorityPubkeys.has(normalized) || trust.badgeIssuer === normalized) {
      return true;
    }
    if (!trust.authorityPubkeys.size) return false;
    const trustedAwardIssuers = Array.from(
      new Set([...trust.authorityPubkeys, ...(trust.badgeIssuer ? [trust.badgeIssuer] : [])]),
    );
    const nonce = Date.now().toString(36);
    try {
      const [definitions, awards, deletions] = await Promise.all([
        collectEvents(`status_auth_defs_${nonce}_${normalized.slice(0, 6)}`, [
          {
            kinds: [ROLE_MEMBERSHIP_KIND],
            authors: Array.from(trust.authorityPubkeys),
            tags: {'#t': ['role']},
            limit: 200,
            relays: [relay],
            noCache: true,
          },
        ]),
        collectEvents(`status_auth_awards_${nonce}_${normalized.slice(0, 6)}`, [
          {
            kinds: [8],
            authors: trustedAwardIssuers,
            tags: {'#p': [normalized]},
            limit: 200,
            relays: [relay],
            noCache: true,
          },
        ]),
        collectEvents(`status_auth_deletions_${nonce}_${normalized.slice(0, 6)}`, [
          {
            kinds: [5],
            authors: trustedAwardIssuers,
            limit: 500,
            relays: [relay],
            noCache: true,
          },
        ]),
      ]);
      return roleGrantsFulfillment(definitions, awards, deletions, normalized, trust);
    } catch {
      return false;
    }
  })();
  authorizationCache.set(key, {
    expiresAt: Date.now() + TRUST_CACHE_TTL_MS,
    promise,
  });
  return promise;
}
