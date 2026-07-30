/**
 * Community trust + status-signer authorization — member-side port of the web
 * reference (`nuts-cash/src/lib/adminAccess.ts`, subset used by
 * `kind8.svelte`'s statusAuthorization). A kind-37237 entitlement status only
 * counts when its signer is authorized on the community relay: a relay
 * authority (NIP-11 pubkey/admin fields or the badge issuer), or a member
 * holding a role award whose definition grants the `store`/`events` permission.
 *
 * One deliberate simplification vs the web: web checks the permission matching
 * the badge type (`events` for event_access, `store` otherwise); RN accepts
 * either. Both sides still require an authorized STAFF signer — the gap is
 * only which staff role maps to which surface, and RN has no admin surface yet
 * (.qa/SPEC-GAPS.md).
 */
import type {ParsedEvent} from '@candypoets/nipworker';
import type {WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';

export type CommunityTrust = {
  authorityPubkeys: Set<string>;
  badgeIssuer?: string;
};

function relayHttpUrl(relay: string) {
  if (relay.startsWith('wss://')) return `https://${relay.slice(6)}`;
  if (relay.startsWith('ws://')) return `http://${relay.slice(5)}`;
  return relay;
}

function pubkeysFrom(value: unknown): string[] {
  if (typeof value === 'string') return /^[0-9a-f]{64}$/i.test(value) ? [value.toLowerCase()] : [];
  if (Array.isArray(value)) return value.flatMap(pubkeysFrom);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(pubkeysFrom);
}

const trustCache = new Map<string, Promise<CommunityTrust>>();

/** Relay authorities: NIP-11 admin fields + the community's badge issuer. */
export function fetchCommunityTrust(relay: string): Promise<CommunityTrust> {
  const cached = trustCache.get(relay);
  if (cached) return cached;
  const promise = (async () => {
    const authorityPubkeys = new Set<string>();
    let badgeIssuer: string | undefined;
    try {
      const response = await fetch(relayHttpUrl(relay), {
        headers: {accept: 'application/nostr+json'},
      });
      if (response.ok) {
        const info = await response.json();
        for (const pubkey of [
          ...pubkeysFrom(info?.pubkey),
          ...pubkeysFrom(info?.admin_pubkeys),
          ...pubkeysFrom(info?.admins),
          ...pubkeysFrom(info?.admin_pubkey),
        ]) {
          authorityPubkeys.add(pubkey);
        }
      }
    } catch {
      // unreachable relay → empty trust
    }
    try {
      const response = await fetch(`${relayHttpUrl(relay)}/community/info`);
      if (response.ok) {
        const info = await response.json();
        const issuer =
          typeof info?.badge_issuer === 'string'
            ? info.badge_issuer
            : typeof info?.booking_issuer === 'string'
              ? info.booking_issuer
              : '';
        if (/^[0-9a-f]{64}$/i.test(issuer)) badgeIssuer = issuer.toLowerCase();
      }
    } catch {
      // root authorities can still issue
    }
    return {authorityPubkeys, badgeIssuer};
  })();
  trustCache.set(relay, promise);
  return promise;
}

// --- role-permission resolution (port of resolveCommunityAccessFromEvents) ---

const ADMIN_PERMISSION_KEYS = [
  'posts',
  'media',
  'events',
  'store',
  'invites',
  'moderation',
  'settings',
] as const;
type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number];

/** Status signers need one of these; see the file-header simplification note. */
const STATUS_PERMISSIONS: AdminPermission[] = ['store', 'events'];

type AccessEvent = {id: string; pubkey: string; created_at: number; tags: string[][]};

function tagValue(tags: string[][], name: string) {
  return tags.find(tag => tag[0] === name)?.[1] || '';
}

function defaultRolePermissions(name: string): AdminPermission[] {
  const normalized = name.toLowerCase();
  if (normalized === 'admin') return [...ADMIN_PERMISSION_KEYS];
  return ['posts', 'media', ...(normalized === 'coach' ? ['events' as const] : [])];
}

function rolePermissions(definitions: AccessEvent[], awards: AccessEvent[], pubkey: string, trustedIssuers: ReadonlySet<string>) {
  const now = Math.floor(Date.now() / 1000);
  const latestDefinitions = new Map<string, AccessEvent>();
  for (const definition of definitions) {
    if (!trustedIssuers.has(definition.pubkey)) continue;
    const d = tagValue(definition.tags, 'd');
    if (!d) continue;
    const address = `30009:${definition.pubkey}:${d}`;
    const current = latestDefinitions.get(address);
    if (
      !current ||
      definition.created_at > current.created_at ||
      (definition.created_at === current.created_at && definition.id < current.id)
    ) {
      latestDefinitions.set(address, definition);
    }
  }
  const activeAddresses = new Set(
    awards
      .filter(award => {
        if (!trustedIssuers.has(award.pubkey)) return false;
        const address = tagValue(award.tags, 'a');
        const expiration = Number(tagValue(award.tags, 'expiration') || 0);
        const recipients = award.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]);
        return (
          recipients.includes(pubkey) &&
          address.startsWith(`30009:${award.pubkey}:`) &&
          (!expiration || expiration > now)
        );
      })
      .map(award => tagValue(award.tags, 'a')),
  );
  const permissions = new Set<AdminPermission>();
  for (const [address, definition] of latestDefinitions) {
    if (
      tagValue(definition.tags, 'type') !== 'role' ||
      !definition.tags.some(tag => tag[0] === 't' && tag[1] === 'role') ||
      !activeAddresses.has(address)
    ) {
      continue;
    }
    const name = tagValue(definition.tags, 'name') || tagValue(definition.tags, 'd');
    const explicit = definition.tags
      .filter(tag => tag[0] === 'permission' && tag[1] && tag[1] !== 'none')
      .map(tag => tag[1])
      .filter((permission): permission is AdminPermission =>
        ADMIN_PERMISSION_KEYS.includes(permission as AdminPermission),
      );
    for (const permission of explicit.length ? explicit : defaultRolePermissions(name)) {
      permissions.add(permission);
    }
  }
  return permissions;
}

// --- one-shot relay query (collects plain tag arrays; no FlatBuffer escapes) ---

function materialize(event: ParsedEvent): AccessEvent | null {
  const id = event.id();
  const pubkey = event.pubkey();
  if (!id || !pubkey) return null;
  const tags: string[][] = [];
  const tagsLength = event.tagsLength();
  for (let index = 0; index < tagsLength; index += 1) {
    const tagVec = event.tags(index);
    if (!tagVec) continue;
    const tag: string[] = [];
    const itemsLength = tagVec.itemsLength();
    for (let item = 0; item < itemsLength; item += 1) {
      tag.push(tagVec.items(item));
    }
    tags.push(tag);
  }
  return {id, pubkey, created_at: event.createdAt() || 0, tags};
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

const authorizationCache = new Map<string, Promise<boolean>>();

/**
 * Is `signer` authorized to publish entitlement statuses on `relay`?
 * Authority (NIP-11/badge issuer) short-circuits; otherwise resolve the
 * signer's role awards and check for a store/events permission. Cached per
 * relay+signer for the session (role changes are rare; screens remount).
 */
export function fetchStatusSignerAuthorized(relay: string, signer: string): Promise<boolean> {
  const key = `${relay}|${signer.toLowerCase()}`;
  const cached = authorizationCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const trust = await fetchCommunityTrust(relay);
    const normalized = signer.toLowerCase();
    if (trust.authorityPubkeys.has(normalized) || trust.badgeIssuer === normalized) return true;
    const trustedIssuers = new Set(trust.authorityPubkeys);
    if (trust.badgeIssuer) trustedIssuers.add(trust.badgeIssuer);
    if (!trustedIssuers.size) return false;
    const nonce = Date.now().toString(36);
    const [definitions, awards] = await Promise.all([
      collectEvents(
        `status_auth_defs_${nonce}_${normalized.slice(0, 6)}`,
        [
          {
            kinds: [30009],
            authors: Array.from(trustedIssuers),
            tags: {'#t': ['role']},
            limit: 200,
            relays: [relay],
            noCache: true,
          },
        ],
      ),
      collectEvents(
        `status_auth_awards_${nonce}_${normalized.slice(0, 6)}`,
        [
          {
            kinds: [8],
            authors: Array.from(trustedIssuers),
            tags: {'#p': [normalized]},
            limit: 200,
            relays: [relay],
            noCache: true,
          },
        ],
      ),
    ]);
    const permissions = rolePermissions(definitions, awards, normalized, trustedIssuers);
    return STATUS_PERMISSIONS.some(permission => permissions.has(permission));
  })();
  authorizationCache.set(key, promise);
  return promise;
}
