import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {MessageType} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';
import {ChevronLeft} from 'lucide-react-native';
import {decode, type AddressPointer} from 'nostr-tools/nip19';

import {Feed, FeedSticky} from '../components/Feed';
import {Kind30023Article} from '../components/notes/Kind30023Article';
import {eventTags, tagValue} from '../components/notes/kindHelpers';
import {RelaysList as HeaderRelaysList} from '../components/RelaysList';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useNostrStore, useRelayStore} from '../stores';
import {useAppTheme} from '../theme';

type Kind30023SubProps = {
  naddr: string;
  visible: boolean;
  onClose: () => void;
};

const EMPTY_ITEMS: ParsedEvent[] = [];
const ARTICLE_BYTES_PER_EVENT = 64 * 1024;

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function decodeAddressPointer(naddr: string): AddressPointer {
  try {
    const decoded = decode(naddr) as unknown as {data?: AddressPointer};
    return decoded?.data ?? ({identifier: '', pubkey: '', kind: 30023, relays: []} as AddressPointer);
  } catch (error) {
    console.warn('[kind30023] failed to decode naddr', error);
    return {identifier: '', pubkey: '', kind: 30023, relays: []} as AddressPointer;
  }
}

function pointerRelays(data: AddressPointer) {
  return [...new Set((data.relays ?? []).filter(Boolean).map(normalizeRelayUrl))];
}

const Kind30023Header = memo(function Kind30023Header({
  onClose,
  relays,
}: {
  onClose: () => void;
  relays: string[];
}) {
  const theme = useAppTheme();
  const relayStatuses = useRelayStore(state => state.relayStatuses);

  return (
    <View className="h-20 flex-row items-center justify-between rounded-lg bg-base-300/90 px-4 shadow-sm">
      <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-200" hitSlop={12} onPress={onClose}>
        <ChevronLeft size={22} color={theme.colors.primaryContent} />
      </Pressable>
      <HeaderRelaysList relays={relays} statuses={relayStatuses} mini />
    </View>
  );
});

export function Kind30023Sub({naddr, visible, onClose}: Kind30023SubProps) {
  const data = useMemo(() => decodeAddressPointer(naddr), [naddr]);
  const articleIdentifier = data.identifier ?? '';
  const articlePubkey = data.pubkey ?? '';
  const articleKind = data.kind ?? 30023;
  const initialRelays = useMemo(() => pointerRelays(data), [data]);
  const readRelays = useNostrStore(state => state.readRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [article, setArticle] = useState<ParsedEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relays = useMemo(
    () =>
      [
        ...new Set([
          ...readRelays,
          ...initialRelays,
          ...DEFAULT_FEED_RELAYS,
        ].map(normalizeRelayUrl)),
      ],
    [initialRelays, readRelays],
  );

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setArticle(null);
    setLoading(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [articleIdentifier, articlePubkey]);

  useEffect(() => {
    if (!visible || !articleIdentifier || !articlePubkey) return undefined;

    const subId = `kind30023_${articlePubkey}_${articleIdentifier}_${relayHash(relays)}`;
    console.log('[kind30023] subscribe article', {
      articleId: null,
      pubkey: `${articlePubkey.slice(0, 12)}...`,
      identifier: articleIdentifier,
      kind: articleKind,
      relays,
      bytesPerEvent: ARTICLE_BYTES_PER_EVENT,
      request: {
        kinds: [30023],
        authors: [articlePubkey],
        tags: {'#d': [articleIdentifier]},
        limit: 1,
        relays,
        cacheFirst: true,
      },
    });
    setLoading(true);
    setSubRelays(subId, relays);
    relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      timeoutRef.current = null;
    }, 1800);

    unsubscribeRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: [30023],
          authors: [articlePubkey],
          tags: {'#d': [articleIdentifier]},
          limit: 1,
          relays,
          cacheFirst: true,
        },
      ],
      message => {
        if (message.type() === MessageType.Eoce) {
          setLoading(false);
          return;
        }

        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) {
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          }
          if (relayStatus === 'EOSE') setLoading(false);
          return;
        }

        const parsed = asParsedEvent(message);
        const parsedPubkey = parsed?.pubkey() || '';
        if (!parsed || parsed.kind() !== 30023 || parsedPubkey !== articlePubkey) return;
        const dTag = tagValue(eventTags(parsed), 'd');
        console.log('[kind30023] candidate article event', {
          articleId: parsed.id(),
          pubkey: `${parsedPubkey.slice(0, 12)}...`,
          identifier: dTag,
          matches: dTag === articleIdentifier,
        });
        if (dTag !== articleIdentifier) return;
        setArticle(parsed);
        setLoading(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      },
      {bytesPerEvent: ARTICLE_BYTES_PER_EVENT},
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    articleIdentifier,
    articleKind,
    articlePubkey,
    relays,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  const items = article ? [article] : EMPTY_ITEMS;
  const renderHeader = useCallback(
    () => (
      <FeedSticky>
        <Kind30023Header onClose={onClose} relays={relays} />
      </FeedSticky>
    ),
    [onClose, relays],
  );

  return (
    <Feed
      items={items}
      loading={loading}
      visible={visible}
      motionHeader={renderHeader}
      empty={
        loading ? null : (
          <View className="px-4 py-10">
            <Text className="text-center text-sm text-base-content/70">Article not found</Text>
          </View>
        )
      }
      renderItem={({item}) => <Kind30023Article note={item} />}
    />
  );
}
