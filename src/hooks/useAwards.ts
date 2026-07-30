/**
 * Member-side entitlement data: the signed-in user's kind-8 awards on a
 * community relay, their 30009 badge definitions, and live kind-37237
 * statuses (legacy 27237 during the transition, signer-authorized via
 * src/lib/communityTrust.ts). Mirrors StoreSub's subscription conventions
 * (sub ids include the relay, ParsedEvents stay FlatBuffer views,
 * EOSE-driven loading state).
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';
import {extractTagValue} from '@candypoets/nipworker';
import {BADGE_STATUS_KIND, LEGACY_BADGE_STATUS_KIND} from '../lib/orders';
import {fetchStatusSignerAuthorized} from '../lib/communityTrust';
import {useRelayStore} from '../stores/relayStore';

function relayKey(relay: string) {
  let hash = 0;
  for (let index = 0; index < relay.length; index += 1) {
    hash = (hash * 31 + relay.charCodeAt(index)) | 0;
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

/** badge definition address (`30009:<author>:<d>`) of an award. */
export function awardBadgeAddress(award: ParsedEvent) {
  return extractTagValue(award, 'a') || '';
}

export type MyAwardsResult = {
  awards: ParsedEvent[];
  /** badge definition address -> 30009 event (only for awards found). */
  definitions: Map<string, ParsedEvent>;
  loading: boolean;
};

/**
 * The member's awards + their definitions on ONE community relay. Stays
 * subscribed so a fresh purchase appears without remounting.
 */
export function useMyAwards(relay: string, pubkey: string | null | undefined, visible: boolean) {
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [awards, setAwards] = useState<ParsedEvent[]>([]);
  const [definitions, setDefinitions] = useState<Map<string, ParsedEvent>>(new Map());
  const [loading, setLoading] = useState(true);
  const awardsRef = useRef<ParsedEvent[]>([]);
  const definitionsRef = useRef<Map<string, ParsedEvent>>(new Map());

  // Awards (kind 8, #p = member).
  useEffect(() => {
    if (!visible || !relay || !pubkey) return undefined;
    awardsRef.current = [];
    setAwards([]);
    setLoading(true);
    const subId = `my_awards_${relayKey(relay)}_${pubkey.slice(0, 8)}`;
    setSubRelays(subId, [relay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [{kinds: [8], limit: 200, noCache: true, relays: [relay], tags: {'#p': [pubkey]}}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          if (status.status()?.toString() === 'EOSE') setLoading(false);
          return;
        }
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 8) return;
        if (extractTagValue(event, 'p') !== pubkey || !awardBadgeAddress(event)) return;
        const next = upsertById(awardsRef.current, event);
        if (next !== awardsRef.current) {
          awardsRef.current = next;
          setAwards(next);
        }
      },
      {bytesPerEvent: 12 * 1024},
    );
    return () => unsubscribe();
  }, [relay, pubkey, setSubRelays, visible]);

  // Badge definitions for the discovered awards (kind 30009 by author + #d).
  const definitionKey = awards
    .map(award => awardBadgeAddress(award))
    .sort()
    .join(',');
  useEffect(() => {
    if (!visible || !relay || !definitionKey) return undefined;
    const addresses = definitionKey.split(',');
    const authors = Array.from(new Set(addresses.map(address => address.split(':')[1])));
    const dTags = Array.from(
      new Set(addresses.map(address => address.split(':').slice(2).join(':'))),
    );
    const subId = `my_award_defs_${relayKey(relay)}_${dTags.join('_').slice(0, 40)}`;
    setSubRelays(subId, [relay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [{kinds: [30009], limit: 200, noCache: true, relays: [relay], authors, tags: {'#d': dTags}}],
      message => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 30009) return;
        const d = extractTagValue(event, 'd');
        const address = d ? `30009:${event.pubkey()}:${d}` : '';
        if (!address || !addresses.includes(address)) return;
        const current = definitionsRef.current.get(address);
        if (current && (current.createdAt() || 0) >= (event.createdAt() || 0)) return;
        const next = new Map(definitionsRef.current);
        next.set(address, event);
        definitionsRef.current = next;
        setDefinitions(next);
      },
      {bytesPerEvent: 12 * 1024, closeOnEose: true},
    );
    return () => unsubscribe();
  }, [relay, definitionKey, setSubRelays, visible]);

  return {awards, definitions, loading} as MyAwardsResult;
}

/**
 * Live kind-37237 statuses (legacy 27237 during the transition) for a set of
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
      void fetchStatusSignerAuthorized(relay, signer).then(ok => {
        inflightRef.current.delete(signer);
        const next = new Map(authorizedRef.current);
        next.set(signer, ok);
        authorizedRef.current = next;
        setAuthorized(next);
      });
    };
    const unsubscribe = subscribeToNostr(
      subId,
      [{kinds: [BADGE_STATUS_KIND, LEGACY_BADGE_STATUS_KIND], limit: 500, noCache: true, relays: [relay], tags: {'#e': ids}}],
      message => {
        const event = asParsedEvent(message);
        if (!event || (event.kind() !== BADGE_STATUS_KIND && event.kind() !== LEGACY_BADGE_STATUS_KIND)) return;
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
