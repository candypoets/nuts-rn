/**
 * Member-side entitlement data: the signed-in user's kind-8 awards on a
 * community relay, their NIP-97 definitions, revocations, and live kind-37237
 * statuses. Mirrors StoreSub's subscription conventions
 * (sub ids include the relay, ParsedEvents stay FlatBuffer views,
 * EOSE-driven loading state).
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';
import {extractTagValue} from '@candypoets/nipworker';
import {BADGE_STATUS_KIND} from '../lib/orders';
import {
  awardSignerAuthorized,
  fetchCommunityTrust,
  fetchStatusSignerAuthorized,
  type CommunityTrust,
} from '../lib/communityTrust';
import {eventTags} from '../components/notes/kindHelpers';
import {parseDefinitionAddress} from '../lib/nip97';
import {useRelayStore} from '../stores/relayStore';

function relayKey(relay: string) {
  let hash = 0;
  for (let index = 0; index < relay.length; index += 1) {
    hash = (hash * 31 + relay.charCodeAt(index)) % 2_147_483_647;
  }
  return Math.abs(hash).toString(36);
}

function upsertById(events: ParsedEvent[], candidate: ParsedEvent) {
  const id = candidate.id();
  if (!id) return events;
  const index = events.findIndex(event => event.id() === id);
  if (index === -1) return [...events, candidate];
  if ((events[index].createdAt() || 0) >= (candidate.createdAt() || 0)) return events;
  const next = events.slice();
  next[index] = candidate;
  return next;
}

/** NIP-97 definition address of an award. */
export function awardBadgeAddress(award: ParsedEvent) {
  return extractTagValue(award, 'a') || '';
}

function hasRecipient(event: ParsedEvent, pubkey: string) {
  return eventTags(event).some(tag => tag[0] === 'p' && tag[1] === pubkey);
}

function awardRevoked(award: ParsedEvent, deletions: ParsedEvent[], trust: CommunityTrust) {
  const awardId = award.id();
  const issuer = award.pubkey()?.toLowerCase();
  if (!awardId || !issuer) return true;
  return deletions.some(deletion => {
    const signer = deletion.pubkey()?.toLowerCase();
    return (
      deletion.kind() === 5 &&
      Boolean(signer) &&
      (signer === issuer || trust.authorityPubkeys.has(signer as string)) &&
      eventTags(deletion).some(tag => tag[0] === 'e' && tag[1] === awardId)
    );
  });
}

export type MyAwardsResult = {
  awards: ParsedEvent[];
  /** definition address -> NIP-97 definition event (only for awards found). */
  definitions: Map<string, ParsedEvent>;
  loading: boolean;
};

/**
 * The member's awards + their definitions on ONE community relay. Stays
 * subscribed so a fresh purchase appears without remounting.
 */
export function useMyAwards(relay: string, pubkey: string | null | undefined, visible: boolean) {
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [candidateAwards, setCandidateAwards] = useState<ParsedEvent[]>([]);
  const [definitions, setDefinitions] = useState<Map<string, ParsedEvent>>(new Map());
  const [deletions, setDeletions] = useState<ParsedEvent[]>([]);
  const [trust, setTrust] = useState<CommunityTrust | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const awardsRef = useRef<ParsedEvent[]>([]);
  const definitionsRef = useRef<Map<string, ParsedEvent>>(new Map());
  const deletionsRef = useRef<ParsedEvent[]>([]);

  // Awards (kind 8, #p = member).
  useEffect(() => {
    if (!visible || !relay || !pubkey) return undefined;
    awardsRef.current = [];
    definitionsRef.current = new Map();
    deletionsRef.current = [];
    setCandidateAwards([]);
    setDefinitions(new Map());
    setDeletions([]);
    setTrust(undefined);
    setLoading(true);
    let cancelled = false;
    fetchCommunityTrust(relay).then(resolved => {
      if (!cancelled) setTrust(resolved);
    });
    const subId = `my_awards_${relayKey(relay)}_${pubkey.slice(0, 8)}`;
    setSubRelays(subId, [relay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds: [8],
          limit: 200,
          noCache: true,
          relays: [relay],
          tags: {'#p': [pubkey]},
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          if (status.status()?.toString() === 'EOSE') setLoading(false);
          return;
        }
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 8) return;
        if (!hasRecipient(event, pubkey) || !parseDefinitionAddress(awardBadgeAddress(event))) {
          return;
        }
        const next = upsertById(awardsRef.current, event);
        if (next !== awardsRef.current) {
          awardsRef.current = next;
          setCandidateAwards(next);
        }
      },
      {bytesPerEvent: 12 * 1024},
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [relay, pubkey, setSubRelays, visible]);

  // NIP-97 definitions for the discovered awards (kind + author + #d).
  const definitionKey = candidateAwards
    .map(award => awardBadgeAddress(award))
    .sort()
    .join(',');
  useEffect(() => {
    if (!visible || !relay || !definitionKey) return undefined;
    const addresses = definitionKey.split(',');
    const parsedAddresses = addresses
      .map(parseDefinitionAddress)
      .filter((address): address is NonNullable<typeof address> => Boolean(address));
    const kinds = Array.from(new Set(parsedAddresses.map(address => address.kind)));
    const authors = Array.from(new Set(parsedAddresses.map(address => address.pubkey)));
    const dTags = Array.from(new Set(parsedAddresses.map(address => address.d)));
    const subId = `my_award_defs_${relayKey(relay)}_${dTags.join('_').slice(0, 40)}`;
    setSubRelays(subId, [relay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds,
          limit: 200,
          noCache: true,
          relays: [relay],
          authors,
          tags: {'#d': dTags},
        },
      ],
      message => {
        const event = asParsedEvent(message);
        if (!event || !kinds.includes(event.kind())) return;
        const d = extractTagValue(event, 'd');
        const address = d ? `${event.kind()}:${event.pubkey()}:${d}` : '';
        if (!address || !addresses.includes(address)) return;
        const current = definitionsRef.current.get(address);
        if (
          current &&
          ((current.createdAt() || 0) > (event.createdAt() || 0) ||
            ((current.createdAt() || 0) === (event.createdAt() || 0) &&
              (current.id() || '') < (event.id() || '')))
        ) {
          return;
        }
        const next = new Map(definitionsRef.current);
        next.set(address, event);
        definitionsRef.current = next;
        setDefinitions(next);
      },
      {bytesPerEvent: 12 * 1024, closeOnEose: true},
    );
    return () => unsubscribe();
  }, [relay, definitionKey, setSubRelays, visible]);

  const awardIdsKey = candidateAwards
    .map(award => award.id())
    .filter((id): id is string => Boolean(id))
    .sort()
    .join(',');
  useEffect(() => {
    if (!visible || !relay || !awardIdsKey) return undefined;
    deletionsRef.current = [];
    setDeletions([]);
    const awardIds = awardIdsKey.split(',');
    const subId = `my_award_deletions_${relayKey(relay)}_${relayKey(awardIdsKey)}`;
    setSubRelays(subId, [relay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds: [5],
          limit: 500,
          noCache: true,
          relays: [relay],
          tags: {'#e': awardIds},
        },
      ],
      message => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 5) return;
        const next = upsertById(deletionsRef.current, event);
        if (next !== deletionsRef.current) {
          deletionsRef.current = next;
          setDeletions(next);
        }
      },
      {bytesPerEvent: 8 * 1024},
    );
    return () => unsubscribe();
  }, [awardIdsKey, relay, setSubRelays, visible]);

  const awards = useMemo(() => {
    if (!trust) return [];
    const now = Math.floor(Date.now() / 1000);
    return candidateAwards.filter(award => {
      const definition = definitions.get(awardBadgeAddress(award));
      if (!definition || !awardSignerAuthorized(award, definition, trust)) return false;
      const expiration = extractTagValue(award, 'expiration');
      if (expiration !== undefined && (!/^\d+$/.test(expiration) || Number(expiration) <= now)) {
        return false;
      }
      return !awardRevoked(award, deletions, trust);
    });
  }, [candidateAwards, definitions, deletions, trust]);

  return {awards, definitions, loading: loading || !trust} as MyAwardsResult;
}

/**
 * Live NIP-97 kind-37237 statuses for a set of
 * award ids. Only statuses from AUTHORIZED signers are returned — web
 * kind8.svelte verifies each signer against the community's trust/roles
 * (src/lib/communityTrust.ts); without that a member could fake a 'cancelled'
 * check-in and restore their own uses. Subscribe BEFORE staff acts.
 */
export function useAwardStatuses(relay: string, awardIds: string[], visible: boolean) {
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [statuses, setStatuses] = useState<ParsedEvent[]>([]);
  const statusesRef = useRef<ParsedEvent[]>([]);
  const [authorized, setAuthorized] = useState<ReadonlyMap<string, boolean>>(new Map());
  const authorizedRef = useRef(new Map<string, boolean>());
  const inflightRef = useRef(new Set<string>());
  const idsKey = awardIds.slice().sort().join(',');

  useEffect(() => {
    if (!visible || !relay || !idsKey) return undefined;
    statusesRef.current = [];
    setStatuses([]);
    authorizedRef.current = new Map();
    setAuthorized(new Map());
    inflightRef.current = new Set();
    const ids = idsKey.split(',');
    // Hash the FULL id set: a prefix slice collides with the Store strip's
    // multi-award sub (same 24 chars, different #e filter) and nipworker would
    // silently reuse the other subscription's buffer (home-wallet gotcha).
    const subId = `award_status_${relayKey(relay)}_${relayKey(idsKey)}_${ids.length}`;
    if (__DEV__) console.log('[award-status-sub] open', subId, relay);
    setSubRelays(subId, [relay]);
    const authorizeSigner = (signer: string) => {
      if (authorizedRef.current.has(signer) || inflightRef.current.has(signer)) return;
      inflightRef.current.add(signer);
      fetchStatusSignerAuthorized(relay, signer).then(ok => {
        inflightRef.current.delete(signer);
        const next = new Map(authorizedRef.current);
        next.set(signer, ok);
        authorizedRef.current = next;
        setAuthorized(next);
      });
    };
    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds: [BADGE_STATUS_KIND],
          limit: 500,
          noCache: true,
          relays: [relay],
          tags: {'#e': ids},
        },
      ],
      message => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== BADGE_STATUS_KIND) return;
        if (__DEV__) {
          console.log(
            '[award-status]',
            event.id()?.slice(0, 8),
            extractTagValue(event, 'status'),
            extractTagValue(event, 'e')?.slice(0, 8),
          );
        }
        const signer = event.pubkey();
        if (signer) authorizeSigner(signer);
        const next = upsertById(statusesRef.current, event);
        if (next !== statusesRef.current) {
          statusesRef.current = next;
          setStatuses(next);
        }
      },
      {bytesPerEvent: 8 * 1024},
    );
    return () => unsubscribe();
  }, [relay, idsKey, setSubRelays, visible]);

  return useMemo(
    () => statuses.filter(event => authorized.get(event.pubkey() || '') === true),
    [statuses, authorized],
  );
}
