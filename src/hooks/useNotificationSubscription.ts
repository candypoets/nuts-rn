import {useEffect, useMemo, useRef} from 'react';
import type {WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asParsedEvent} from '@candypoets/nipworker/utils';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useAppStore, useAuthStore, useNostrStore} from '../stores';

function relayHash(relays: string[]) {
  return relays
    .map(relay => relay.replace(/[^a-zA-Z0-9]/g, ''))
    .join('')
    .slice(0, 24);
}

export function useNotificationSubscription(enabled: boolean) {
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const lastNotificationView = useAppStore(state => state.lastNotificationView);
  const setMissedNotifications = useAppStore(state => state.setMissedNotifications);
  const viewedAtRef = useRef(lastNotificationView);
  const seenEventIdsRef = useRef(new Set<string>());

  const relays = useMemo(() => {
    const source = readRelays.length ? readRelays : DEFAULT_FEED_RELAYS;
    return [...new Set(source)];
  }, [readRelays]);
  const relaysKey = relays.join(',');

  useEffect(() => {
    viewedAtRef.current = lastNotificationView;
    seenEventIdsRef.current.clear();
    setMissedNotifications(0);
  }, [lastNotificationView, setMissedNotifications]);

  useEffect(() => {
    if (!enabled || !pubkey) return undefined;

    seenEventIdsRef.current.clear();
    setMissedNotifications(0);

    return subscribeToNostr(
      `notifications_${pubkey}_${relayHash(relays)}`,
      [
        {
          kinds: [1, 7, 6],
          tags: {'#p': [pubkey]},
          limit: 100,
          relays,
        },
      ],
      (message: WorkerMessage) => {
        const event = asParsedEvent(message);
        if (!event) return;
        if (event.pubkey() === pubkey) return;
        if (event.createdAt() <= viewedAtRef.current / 1000) return;

        const id = event.id();
        if (!id || seenEventIdsRef.current.has(id)) return;
        seenEventIdsRef.current.add(id);
        setMissedNotifications(seenEventIdsRef.current.size);
      },
    );
  }, [enabled, pubkey, relays, relaysKey, setMissedNotifications]);
}
