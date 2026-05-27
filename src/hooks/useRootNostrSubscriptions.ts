import { useEffect } from 'react';
import type { WorkerMessage } from '@candypoets/nipworker';
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
  useAuthStore,
  useNostrStore,
  type RelayMarker,
} from '../stores';

const ROOT_DEBUG = false;

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
  const hasProfileInputs = useNostrStore(
    state => state.kind3UpdatedAt > 0 && state.kind10002UpdatedAt > 0,
  );
  const writeRelaysKey = writeRelays.join(',');

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
      ],
      handleRootMessage,
      { closeOnEose: false },
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
      closeOnEose: false,
    });
  }, [
    enabled,
    hasProfileInputs,
    pubkey,
    writeRelays,
    writeRelaysKey,
  ]);
}
