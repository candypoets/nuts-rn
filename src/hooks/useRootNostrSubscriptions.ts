import {useEffect, useMemo} from 'react';
import type {ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind0,
  asKind10002,
  asKind10019,
  asKind3,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';

import {
  BOOTSTRAP_RELAYS,
  INDEXER_RELAYS,
  useAuthStore,
  useNostrStore,
  type RelayMarker,
} from '../stores';
import {useWalletSubscription} from './useWalletSubscription';

const ROOT_DEBUG = false;
const REPLACEABLE_LIST_BYTES_PER_EVENT = 128 * 1024;
const RELAY_DIRECTORY_RELAYS = Array.from(
  new Set([...INDEXER_RELAYS, ...BOOTSTRAP_RELAYS, 'wss://relay.nuts.cash']),
);

function rootDebug(label: string, data?: Record<string, unknown>) {
  if (!ROOT_DEBUG) return;
  console.log(`[root-nostr] ${label}`, data ?? {});
}

function tagValues(event: NonNullable<ReturnType<typeof asParsedEvent>>, tagName: string) {
  const values: string[] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tag = event.tags(index);
    const first = tag?.items(0);
    const second = tag?.items(1);
    if (first === tagName && second) values.push(String(second));
  }
  return values;
}

function eventTags(event: ParsedEvent) {
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

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relaySetAddressesFromRelayFeed(event: ParsedEvent) {
  return Array.from(
    new Set(
      eventTags(event)
        .filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30002:'))
        .map(tag => tag[1]),
    ),
  );
}

function relayUrlsFromRelaySet(event: ParsedEvent) {
  return Array.from(
    new Set(
      eventTags(event)
        .filter(tag => tag[0] === 'relay' && tag[1])
        .map(tag => normalizeRelayUrl(tag[1])),
    ),
  );
}

function relaySetD(event: ParsedEvent) {
  return eventTags(event).find(tag => tag[0] === 'd')?.[1] || '';
}

function handleRootMessage(message: WorkerMessage) {
  const status = asConnectionStatus(message);
  if (status) {
    rootDebug('status', {
      relay: status.relayUrl(),
      status: status.status()?.toString(),
      message: status.message?.(),
    });
  }

  const event = asParsedEvent(message);
  if (!event) {
    rootDebug('non-event', {
      type: typeof message.type === 'function' ? message.type() : 'unknown',
    });
    return;
  }

  rootDebug('event', {
    id: event.id()?.slice(0, 12),
    kind: event.kind(),
    pubkey: event.pubkey()?.slice(0, 12),
    createdAt: event.createdAt(),
    parsedType:
      typeof event.parsedType === 'function' ? event.parsedType() : 'unknown',
  });

  const state = useNostrStore.getState();
  const previousKind3UpdatedAt = state.kind3UpdatedAt;
  state.setKindTimestamp(event.kind(), event.createdAt());

  if (event.kind() === 0) {
    const kind0 = asKind0(event);
    rootDebug('kind0 parse', {
      ok: !!kind0,
      name: kind0?.name?.(),
      hasPicture: !!kind0?.picture?.(),
    });
    if (kind0) {
      state.setProfile({
        pubkey: event.pubkey() || kind0.pubkey() || '',
        name: kind0.name() || null,
        displayName: kind0.displayName() || null,
        picture: kind0.picture() || null,
        updatedAt: event.createdAt(),
      });
    }
    return;
  }

  if (event.kind() === 3) {
    if (previousKind3UpdatedAt > 0 && event.createdAt() <= previousKind3UpdatedAt) {
      rootDebug('kind3 ignored older event', {
        createdAt: event.createdAt(),
        current: previousKind3UpdatedAt,
      });
      return;
    }
    const kind3 = asKind3(event);
    rootDebug('kind3 parse', {
      ok: !!kind3,
      contacts: kind3 ? fbArray(kind3, 'contacts').length : 0,
    });
    if (kind3) {
      state.setFollows(fbArray(kind3, 'contacts').map(contact => contact.pubkey() ?? '').filter(Boolean));
    }
    return;
  }

  if (event.kind() === 10002) {
    const kind10002 = asKind10002(event);
    rootDebug('kind10002 parse', {
      ok: !!kind10002,
      relays: kind10002 ? fbArray(kind10002, 'relays').length : 0,
    });
    if (kind10002) {
      const relays: RelayMarker[] = fbArray(kind10002, 'relays')
        .map(relay => ({
          url: relay.url() ?? '',
          read: relay.read(),
          write: relay.write(),
        }))
        .filter(relay => relay.url);
      state.setRelayMarkers(relays);
    }
    return;
  }

  if (event.kind() === 10012) {
    const addresses = relaySetAddressesFromRelayFeed(event);
    rootDebug('kind10012 parse', {
      addresses: addresses.length,
      id: event.id()?.slice(0, 12),
    });
    state.setRelayDirectoryAddresses(addresses);
    return;
  }

  if (event.kind() === 10000) {
    state.setMutes({
      mutedPubkeys: tagValues(event, 'p'),
      mutedHashtags: tagValues(event, 't'),
      mutedWords: tagValues(event, 'word'),
      mutedEventIds: tagValues(event, 'e'),
    });
    return;
  }

  if (event.kind() === 10019) {
    const kind10019 = asKind10019(event);
    rootDebug('kind10019 parse', {
      ok: !!kind10019,
      trustedMints: kind10019 ? fbArray(kind10019, 'trustedMints').length : 0,
      readRelays: kind10019 ? fbArray(kind10019, 'readRelays') : [],
    });
    const mints = kind10019
      ? fbArray(kind10019, 'trustedMints').map(mint => mint.url() ?? '')
      : tagValues(event, 'mint');
    state.setTrustedMints(mints.filter(Boolean));
    state.setWalletReadRelays(
      kind10019
        ? fbArray(kind10019, 'readRelays')
            .map(relay => String(relay))
            .filter(Boolean)
        : [],
    );
    return;
  }

  if (event.kind() === 10063) {
    state.setUploadServers({ blossomServers: tagValues(event, 'server') });
    return;
  }

  if (event.kind() === 10096) {
    state.setUploadServers({ nip96Servers: tagValues(event, 'server') });
  }
}

export function useRootNostrSubscriptions(enabled: boolean) {
  const pubkey = useAuthStore(state => state.pubkey);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const relayDirectoryAddresses = useNostrStore(
    state => state.relayDirectoryAddresses,
  );
  const hasProfileInputs = useNostrStore(
    state => state.kind3UpdatedAt > 0 && state.kind10002UpdatedAt > 0,
  );
  const writeRelaysKey = writeRelays.join(',');
  const relayDirectoryAddressKey = relayDirectoryAddresses.join('|');
  const relayDirectoryRequests = useMemo(
    () =>
      relayDirectoryAddresses.map(address => {
        const [, author, d] = address.split(':');
        return {
          kinds: [30002],
          authors: [author || pubkey || ''],
          tags: {'#d': [d || '']},
          limit: 1,
          relays: RELAY_DIRECTORY_RELAYS,
          cacheFirst: true,
        };
      }),
    [pubkey, relayDirectoryAddresses],
  );

  useWalletSubscription({enabled});

  useEffect(() => {
    if (!enabled || !pubkey) return;

    rootDebug('subscribe bootstrap', {
      pubkey: pubkey.slice(0, 12),
      relays: BOOTSTRAP_RELAYS,
    });

    return subscribeToNostr(
      `relays_${pubkey}`,
      [
        { kinds: [10019, 10002], authors: [pubkey], relays: BOOTSTRAP_RELAYS },
        { kinds: [3, 0], authors: [pubkey], relays: BOOTSTRAP_RELAYS },
        { kinds: [10000], authors: [pubkey], relays: BOOTSTRAP_RELAYS },
        { kinds: [10063], authors: [pubkey], relays: BOOTSTRAP_RELAYS },
        { kinds: [10096], authors: [pubkey], relays: BOOTSTRAP_RELAYS },
        {
          kinds: [10012],
          authors: [pubkey],
          relays: RELAY_DIRECTORY_RELAYS,
          cacheFirst: true,
        },
      ],
      handleRootMessage,
      {
        bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
        closeOnEose: false,
      },
    );
  }, [enabled, pubkey]);

  useEffect(() => {
    if (!enabled || !pubkey || !hasProfileInputs) return;

    const relays = writeRelaysKey ? writeRelays : BOOTSTRAP_RELAYS;
    const subId = `profile_${pubkey}_${writeRelaysKey || 'bootstrap'}`;
    rootDebug('subscribe profile', {
      subId,
      pubkey: pubkey.slice(0, 12),
      relays,
    });
    const requests = [
      { kinds: [0, 3], authors: [pubkey], relays, noOptimize: true },
      { kinds: [10000], authors: [pubkey], relays, noOptimize: true },
    ];

    return subscribeToNostr(subId, requests, handleRootMessage, {
      bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
      closeOnEose: false,
    });
  }, [
    enabled,
    hasProfileInputs,
    pubkey,
    writeRelays,
    writeRelaysKey,
  ]);

  useEffect(() => {
    if (!enabled || !pubkey) {
      useNostrStore.getState().resetRelayDirectory();
    }
  }, [enabled, pubkey]);

  useEffect(() => {
    if (!enabled || !pubkey || !relayDirectoryRequests.length) return;

    const expectedAddresses = new Set(relayDirectoryAddresses);
    const subId = `relay_directory_sets_${pubkey}_${relayDirectoryAddressKey}`;
    rootDebug('subscribe relay directory sets', {
      subId,
      addresses: relayDirectoryAddresses.length,
      relays: RELAY_DIRECTORY_RELAYS,
    });

    return subscribeToNostr(
      subId,
      relayDirectoryRequests,
      (message: WorkerMessage) => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 30002) return;
        const d = relaySetD(event);
        const address = `30002:${event.pubkey()}:${d}`;
        if (!expectedAddresses.has(address)) return;

        const relays = relayUrlsFromRelaySet(event);
        rootDebug('kind30002 relay set parse', {
          address,
          relays: relays.length,
          id: event.id()?.slice(0, 12),
        });
        useNostrStore.getState().setRelayRoleSet({
          address,
          createdAt: event.createdAt(),
          d,
          relays,
        });
      },
      {
        bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
        closeOnEose: false,
      },
    );
  }, [
    enabled,
    pubkey,
    relayDirectoryAddresses,
    relayDirectoryAddressKey,
    relayDirectoryRequests,
  ]);
}
