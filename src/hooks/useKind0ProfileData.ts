import {useEffect, useMemo, useState} from 'react';
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
import {useRelayStore} from '../stores';

const REPLACEABLE_LIST_BYTES_PER_EVENT = 128 * 1024;

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 20);
}

export function useKind0ProfileData(pubkey: string) {
  const [profile, setProfile] = useState<Kind0Parsed | null>(null);
  const [profileContacts, setProfileContacts] = useState<string[]>([]);
  const [writeRelays, setWriteRelays] = useState<string[]>([]);
  const [readRelays, setReadRelays] = useState<string[]>([]);
  const [feedReady, setFeedReady] = useState(false);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const fallbackRelays = useMemo(() => DEFAULT_FEED_RELAYS.map(normalizeRelayUrl), []);

  useEffect(() => {
    if (!pubkey) return undefined;

    setProfile(null);
    setProfileContacts([]);
    setWriteRelays([]);
    setReadRelays([]);
    setFeedReady(false);

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
        if (kind0 && kind0.pubkey?.() === pubkey) {
          setProfile(current => (current === kind0 ? current : kind0));
        }
      },
      {closeOnEose: true},
    );

    let unsubscribeDiscovery: (() => void) | null = null;
    const discoveryTimeout = setTimeout(() => {
      fallbackRelays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
      unsubscribeDiscovery = subscribeToNostr(
        `kind0_meta_${pubkey}_${relayHash(fallbackRelays)}`,
        [
          {kinds: [10002], authors: [pubkey], limit: 1, cacheFirst: true, closeOnEOSE: true, relays: fallbackRelays},
          {kinds: [3], authors: [pubkey], limit: 1, cacheFirst: true, closeOnEOSE: true, relays: fallbackRelays},
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
          const kind10002 = isKind10002(message);
          if (event && kind10002 && event.pubkey() === pubkey) {
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
            const contacts = fbArray(kind3, 'contacts').map(contact => contact.pubkey() ?? '').filter(Boolean);
            setProfileContacts(current => (sameStringArray(current, contacts) ? current : contacts));
          }
        },
        {
          bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
          closeOnEose: true,
        },
      );
    }, 240);
    const feedReadyTimeout = setTimeout(() => setFeedReady(true), 320);

    return () => {
      clearTimeout(discoveryTimeout);
      clearTimeout(feedReadyTimeout);
      unsubscribeProfile();
      unsubscribeDiscovery?.();
    };
  }, [fallbackRelays, pubkey, setRelayStatus]);

  return {
    fallbackRelays,
    feedReady,
    profile,
    profileContacts,
    readRelays,
    writeRelays,
  };
}
