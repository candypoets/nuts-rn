import {useEffect, useMemo, useRef, useState} from 'react';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind3,
  asParsedEvent,
  fbArray,
  isKind10002,
  isKind0,
} from '@candypoets/nipworker/utils';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {INDEXER_RELAYS} from '../stores';
import {useRelayStore} from '../stores';

const REPLACEABLE_LIST_BYTES_PER_EVENT = 128 * 1024;
const RELAY_DIRECTORY_RELAYS = Array.from(
  new Set([...INDEXER_RELAYS, ...DEFAULT_FEED_RELAYS, 'wss://relay.nuts.cash']),
);

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 20);
}

function eventTags(event: NonNullable<ReturnType<typeof asParsedEvent>>) {
  const tags: string[][] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tag = event.tags(index);
    if (!tag) continue;
    const items: string[] = [];
    for (let itemIndex = 0; itemIndex < tag.itemsLength(); itemIndex += 1) {
      items.push(String(tag.items(itemIndex) || ''));
    }
    tags.push(items);
  }
  return tags;
}

function relaySetAddressesFromRelayFeed(
  event: NonNullable<ReturnType<typeof asParsedEvent>>,
) {
  return Array.from(
    new Set(
      eventTags(event)
        .filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30002:'))
        .map(tag => tag[1]),
    ),
  );
}

function relayUrlsFromRelaySet(
  event: NonNullable<ReturnType<typeof asParsedEvent>>,
) {
  return Array.from(
    new Set(
      eventTags(event)
        .filter(tag => tag[0] === 'relay' && tag[1])
        .map(tag => normalizeRelayUrl(tag[1])),
    ),
  );
}

function relaySetD(event: NonNullable<ReturnType<typeof asParsedEvent>>) {
  return eventTags(event).find(tag => tag[0] === 'd')?.[1] || '';
}

export function useKind0ProfileData(pubkey: string, visible: boolean) {
  const [profile, setProfile] = useState<Kind0Parsed | null>(null);
  const [profileContacts, setProfileContacts] = useState<string[]>([]);
  const [writeRelays, setWriteRelays] = useState<string[]>([]);
  const [readRelays, setReadRelays] = useState<string[]>([]);
  const [directoryWriteRelays, setDirectoryWriteRelays] = useState<string[]>([]);
  const [directoryReadRelays, setDirectoryReadRelays] = useState<string[]>([]);
  const latestKind0Ref = useRef(0);
  const latestKind3Ref = useRef(0);
  const latestKind10002Ref = useRef(0);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const fallbackRelays = useMemo(() => DEFAULT_FEED_RELAYS.map(normalizeRelayUrl), []);

  // Reset resolved state only when the profile target changes. Blur keeps
  // the state: refocus resubscribes and cacheFirst refills, while the
  // createdAt refs below reject stale redeliveries.
  useEffect(() => {
    setProfile(null);
    setProfileContacts([]);
    setWriteRelays([]);
    setReadRelays([]);
    setDirectoryWriteRelays([]);
    setDirectoryReadRelays([]);
    latestKind0Ref.current = 0;
    latestKind3Ref.current = 0;
    latestKind10002Ref.current = 0;
  }, [pubkey]);

  // The profile header sub is cheap (single kind0, cacheFirst, closes on
  // EOSE): start it at mount so name/avatar resolve during the push
  // animation instead of after it.
  useEffect(() => {
    if (!pubkey) return undefined;

    const unsubscribeProfile = subscribeToNostr(
      `u_${pubkey}`,
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
          cacheFirst: true,
          closeOnEOSE: true,
          relays: fallbackRelays,
        },
      ],
      message => {
        const kind0 = isKind0(message);
        const event = asParsedEvent(message);
        if (
          kind0 &&
          event &&
          kind0.pubkey?.() === pubkey &&
          event.createdAt() > latestKind0Ref.current
        ) {
          latestKind0Ref.current = event.createdAt();
          setProfile(current => (current === kind0 ? current : kind0));
        }
      },
      {closeOnEose: true},
    );

    return () => {
      unsubscribeProfile();
    };
  }, [fallbackRelays, pubkey]);

  // Discovery subscriptions run only while the profile screen is visible:
  // blur tears them down so covered screens stop streaming, focus
  // resubscribes. The previous fixed 240ms/320ms startup timers only
  // approximated "after the push animation"; the visible gate expresses
  // that exactly.
  useEffect(() => {
    if (!pubkey || !visible) return undefined;

    let unsubscribeRelaySets: (() => void) | null = null;
    fallbackRelays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    const unsubscribeDiscovery = subscribeToNostr(
      `kind0_meta_${pubkey}_${relayHash([
        ...fallbackRelays,
        ...RELAY_DIRECTORY_RELAYS,
      ])}`,
      [
        {kinds: [10012], authors: [pubkey], limit: 1, cacheFirst: true, relays: RELAY_DIRECTORY_RELAYS},
        {kinds: [10002], authors: [pubkey], limit: 1, cacheFirst: true, relays: fallbackRelays},
        {kinds: [3], authors: [pubkey], limit: 1, cacheFirst: true, relays: fallbackRelays},
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          return;
        }

        const event = asParsedEvent(message);
        if (event?.kind() === 10012 && event.pubkey() === pubkey) {
          const addresses = relaySetAddressesFromRelayFeed(event);
          if (!addresses.length) return;
          const expectedAddresses = new Set(addresses);
          const setSubId = `kind0_relay_sets_${pubkey}_${relayHash(addresses)}`;
          const roleSets = new Map<string, {createdAt: number; d: string; relays: string[]}>();
          unsubscribeRelaySets?.();
          unsubscribeRelaySets = subscribeToNostr(
            setSubId,
            addresses.map(address => {
              const [, author, d] = address.split(':');
              return {
                kinds: [30002],
                authors: [author || pubkey],
                tags: {'#d': [d || '']},
                limit: 1,
                cacheFirst: true,
                relays: RELAY_DIRECTORY_RELAYS,
              };
            }),
            relaySetMessage => {
              const relaySetEvent = asParsedEvent(relaySetMessage);
              if (!relaySetEvent || relaySetEvent.kind() !== 30002) return;
              const d = relaySetD(relaySetEvent);
              const address = `30002:${relaySetEvent.pubkey()}:${d}`;
              if (!expectedAddresses.has(address)) return;
              const existing = roleSets.get(address);
              if (existing && relaySetEvent.createdAt() <= existing.createdAt) {
                return;
              }
              roleSets.set(address, {
                createdAt: relaySetEvent.createdAt(),
                d,
                relays: relayUrlsFromRelaySet(relaySetEvent),
              });
              const writeSet = new Set<string>();
              const readSet = new Set<string>();
              roleSets.forEach(roleSet => {
                const target = roleSet.d.includes('admin') || roleSet.d.includes('member')
                  ? writeSet
                  : readSet;
                roleSet.relays.forEach(relay => target.add(normalizeRelayUrl(relay)));
              });
              setDirectoryWriteRelays(Array.from(writeSet));
              setDirectoryReadRelays(Array.from(readSet));
            },
            {
              bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
              closeOnEose: false,
            },
          );
          return;
        }

        const kind10002 = isKind10002(message);
        if (event && kind10002 && event.pubkey() === pubkey) {
          if (event.createdAt() <= latestKind10002Ref.current) {
            return;
          }
          latestKind10002Ref.current = event.createdAt();
          const discoveredWriteRelays = fbArray(kind10002, 'relays')
            .filter(relay => relay.write())
            .map(relay => relay.url() ?? '')
            .filter(Boolean)
            .map(normalizeRelayUrl);
          const discoveredReadRelays = fbArray(kind10002, 'relays')
            .filter(relay => relay.read())
            .map(relay => relay.url() ?? '')
            .filter(Boolean)
            .map(normalizeRelayUrl);
          setWriteRelays(current => (sameStringArray(current, discoveredWriteRelays) ? current : discoveredWriteRelays));
          setReadRelays(current => (sameStringArray(current, discoveredReadRelays) ? current : discoveredReadRelays));
          return;
        }

        const kind3 = event ? asKind3(event) : null;
        if (event && kind3 && event.pubkey() === pubkey) {
          if (event.createdAt() <= latestKind3Ref.current) {
            return;
          }
          latestKind3Ref.current = event.createdAt();
          const contacts = fbArray(kind3, 'contacts').map(contact => contact.pubkey() ?? '').filter(Boolean);
          setProfileContacts(current => (sameStringArray(current, contacts) ? current : contacts));
        }
      },
      {
        bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
        closeOnEose: false,
      },
    );

    return () => {
      unsubscribeDiscovery();
      unsubscribeRelaySets?.();
    };
  }, [fallbackRelays, pubkey, setRelayStatus, visible]);

  return {
    fallbackRelays,
    profile,
    profileContacts,
    readRelays: directoryReadRelays.length || directoryWriteRelays.length
      ? directoryReadRelays
      : readRelays,
    writeRelays: directoryReadRelays.length || directoryWriteRelays.length
      ? directoryWriteRelays
      : writeRelays,
  };
}
