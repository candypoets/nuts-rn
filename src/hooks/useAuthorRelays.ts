import {useEffect, useMemo, useState} from 'react';
import type {WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asParsedEvent, isKind10002} from '@candypoets/nipworker/utils';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {BOOTSTRAP_RELAYS, useRelayStore} from '../stores';

export type RelayMarkerType = 'read' | 'write';

type CacheEntry = {
  relays?: Record<RelayMarkerType, string[]>;
  listeners: Set<() => void>;
  unsubscribe?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};

const cache = new Map<string, CacheEntry>();
const EMPTY_RELAYS: string[] = [];

export function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

export function relayList(values: unknown[]) {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string' && /^wss?:\/\//.test(value))
        .map(normalizeRelayUrl),
    ),
  ];
}

export function relaysFromKind10002(
  kind10002: ReturnType<typeof isKind10002>,
  marker: RelayMarkerType,
  limit = 5,
) {
  if (!kind10002) return EMPTY_RELAYS;
  return relayList(
    Array.from({length: kind10002.relaysLength()}, (_, index) =>
      kind10002.relays(index),
    )
      .filter(relay => (marker === 'read' ? relay?.read() : relay?.write()))
      .map(relay => relay?.url()),
  ).slice(0, limit);
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cacheKey(pubkey: string, discoveryRelays: string[]) {
  return `${pubkey}_${relayHash(discoveryRelays)}`;
}

function notify(entry: CacheEntry) {
  entry.listeners.forEach(listener => listener());
}

function resolveAuthorRelays(pubkey: string, discoveryRelays: string[]) {
  const key = cacheKey(pubkey, discoveryRelays);
  let entry = cache.get(key);
  if (entry) return entry;

  entry = {listeners: new Set()};
  cache.set(key, entry);

  entry.timeout = setTimeout(() => {
    const current = cache.get(key);
    if (!current || current.relays !== undefined) return;
    current.relays = {read: EMPTY_RELAYS, write: EMPTY_RELAYS};
    current.unsubscribe?.();
    current.unsubscribe = undefined;
    notify(current);
  }, 1000);

  entry.unsubscribe = subscribeToNostr(
    `author_relays_${key}`,
    [
      {
        kinds: [10002],
        authors: [pubkey],
        limit: 1,
        cacheFirst: true,
        closeOnEOSE: true,
        relays: discoveryRelays,
      },
    ],
    (message: WorkerMessage) => {
      const kind10002 = isKind10002(message);
      const event = asParsedEvent(message);
      if (!kind10002 || event?.pubkey() !== pubkey) return;

      const current = cache.get(key);
      if (!current) return;
      if (current.timeout) {
        clearTimeout(current.timeout);
        current.timeout = undefined;
      }
      current.unsubscribe?.();
      current.unsubscribe = undefined;

      const relays = {
        read: relaysFromKind10002(kind10002, 'read'),
        write: relaysFromKind10002(kind10002, 'write'),
      };
      if (
        current.relays &&
        sameStringArray(current.relays.read, relays.read) &&
        sameStringArray(current.relays.write, relays.write)
      ) {
        return;
      }
      current.relays = relays;
      notify(current);
    },
  );

  return entry;
}

export function useAuthorRelays(
  pubkey: string | undefined | null,
  marker: RelayMarkerType,
  fallbackRelays: string[] = DEFAULT_FEED_RELAYS,
  discoveryRelays: string[] = BOOTSTRAP_RELAYS,
) {
  const normalizedFallback = useMemo(() => relayList(fallbackRelays), [fallbackRelays]);
  const normalizedDiscovery = useMemo(() => relayList(discoveryRelays), [discoveryRelays]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!pubkey) return undefined;

    const entry = resolveAuthorRelays(pubkey, normalizedDiscovery);
    const listener = () => setVersion(version => version + 1);
    entry.listeners.add(listener);

    return () => {
      entry.listeners.delete(listener);
    };
  }, [normalizedDiscovery, pubkey]);

  return useMemo(() => {
    if (!pubkey) return normalizedFallback;
    const entry = cache.get(cacheKey(pubkey, normalizedDiscovery));
    const resolved = entry?.relays?.[marker];
    return resolved && resolved.length ? resolved : normalizedFallback;
  }, [marker, normalizedDiscovery, normalizedFallback, pubkey]);
}

export function useResolvedAuthorRelays(
  pubkey: string | undefined | null,
  marker: RelayMarkerType,
  discoveryRelays: string[] = BOOTSTRAP_RELAYS,
) {
  const normalizedDiscovery = useMemo(() => relayList(discoveryRelays), [discoveryRelays]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!pubkey) return undefined;

    const entry = resolveAuthorRelays(pubkey, normalizedDiscovery);
    const listener = () => setVersion(version => version + 1);
    entry.listeners.add(listener);

    return () => {
      entry.listeners.delete(listener);
    };
  }, [normalizedDiscovery, pubkey]);

  return useMemo(() => {
    if (!pubkey) return undefined;
    return cache.get(cacheKey(pubkey, normalizedDiscovery))?.relays?.[marker];
  }, [marker, normalizedDiscovery, pubkey]);
}

export function useEffectiveAuthorRelays({
  subId,
  pubkey,
  marker,
  fallbackRelays = EMPTY_RELAYS,
}: {
  subId: string | undefined;
  pubkey: string | undefined | null;
  marker: RelayMarkerType;
  fallbackRelays?: string[];
}) {
  const overrideRelays = useRelayStore(state =>
    subId ? state.relaySubs[subId] : undefined,
  );
  const hasOverride = overrideRelays !== undefined;
  const normalizedOverride = useMemo(
    () => (overrideRelays ? relayList(overrideRelays) : undefined),
    [overrideRelays],
  );
  const normalizedFallback = useMemo(
    () => relayList(fallbackRelays),
    [fallbackRelays],
  );
  const authorRelays = useResolvedAuthorRelays(
    hasOverride ? undefined : pubkey,
    marker,
  );

  return useMemo(() => {
    if (hasOverride) return normalizedOverride ?? EMPTY_RELAYS;
    return authorRelays && authorRelays.length ? authorRelays : normalizedFallback;
  }, [authorRelays, hasOverride, normalizedFallback, normalizedOverride]);
}
