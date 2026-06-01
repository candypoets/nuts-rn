import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {
  getManager,
  Kind4ParsedT,
  ParsedData,
  ParsedEvent as FbParsedEvent,
  ParsedEventT,
  StringVecT,
  type Kind4Parsed,
  type ParsedEvent,
  type RequestObject,
  type WorkerMessage,
} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asKind4,
  asParsedEvent,
  fbArray,
  parseContent,
} from '@candypoets/nipworker/utils';
import {Builder, ByteBuffer} from 'flatbuffers';
import {ChevronLeft, Send} from 'lucide-react-native';
import {getEventHash, type UnsignedEvent} from 'nostr-tools';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Feed} from '../components/Feed';
import {Avatar, ContentBlocks, User} from '../components/notes';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useAuthStore, useNostrStore} from '../stores';

type Kind4ThreadProps = {
  peerPubkey: string;
  visible: boolean;
  onClose: () => void;
};

const THREAD_HEADER_HEIGHT = 65;
const TOP_SAFE_AREA_OFFSET = 8;
const KEYBOARD_ACCESSORY_SHOW_DELAY_MS = 45;

function now() {
  return Math.floor(Date.now() / 1000);
}

function toParsedEvent(event: ParsedEventT): ParsedEvent {
  const builder = new Builder(4096);
  const offset = event.pack(builder);
  builder.finish(offset);
  return FbParsedEvent.getRootAsParsedEvent(new ByteBuffer(builder.asUint8Array()));
}

function getNonce(event: ParsedEvent) {
  const tags = fbArray(event, 'tags');
  for (const tag of tags) {
    const values = fbArray(tag, 'items');
    if (values[0] === 'nonce') return values[1] ? String(values[1]) : undefined;
  }
  return undefined;
}

function processEvents(events: ParsedEvent[]) {
  const seen = new Set<string>();
  return events
    .filter(event => {
      const id = String(event.id() || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((left, right) => right.createdAt() - left.createdAt());
}

function oneDayDiff(first: number, second?: number) {
  if (!second) return true;
  return Math.abs(first - second) > 86_400;
}

function formatRelativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function Kind4Thread({peerPubkey, visible, onClose}: Kind4ThreadProps) {
  const rawEventsRef = useRef<ParsedEvent[]>([]);
  const sendingMapRef = useRef(new Map<string, number>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const paginationUnsubscribeRef = useRef<(() => void) | null>(null);
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPaginationSubIdRef = useRef<string | undefined>(undefined);
  const paginationCounterRef = useRef(0);
  const untilRef = useRef<number | undefined>(undefined);
  const itemsBeforePaginationRef = useRef(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [eventsVersion, setEventsVersion] = useState(0);
  const keyboardAccessoryBottom = useSharedValue(0);
  const keyboardAccessoryProgress = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const readRelayList = readRelays.length ? readRelays : DEFAULT_FEED_RELAYS;
  const writeRelayList = writeRelays.length ? writeRelays : readRelayList;
  const topInset = Math.max(0, insets.top - TOP_SAFE_AREA_OFFSET);
  const items = useMemo(() => {
    void eventsVersion;
    return processEvents(rawEventsRef.current);
  }, [eventsVersion]);

  const clearPaginationTimeout = useCallback(() => {
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
  }, []);

  const buildRequests = useCallback(
    (isPagination = false): RequestObject[] => {
      if (!pubkey) return [];
      const requests: RequestObject[] = [
        {
          kinds: [4],
          tags: {'#p': [pubkey]},
          authors: [peerPubkey],
          limit: 50,
          relays: readRelayList,
          noOptimize: true,
        },
        {
          kinds: [4],
          tags: {'#p': [peerPubkey]},
          authors: [pubkey],
          limit: 50,
          relays: writeRelayList,
          noOptimize: true,
        },
      ];
      if (isPagination && untilRef.current) {
        return requests.map(request => ({...request, until: untilRef.current}));
      }
      return requests;
    },
    [peerPubkey, pubkey, readRelayList, writeRelayList],
  );

  const handleEvents = useCallback((workerMessage: WorkerMessage) => {
    const parsed = asParsedEvent(workerMessage);
    if (!parsed || parsed.kind() !== 4) return;

    const nonce = getNonce(parsed);
    if (nonce && sendingMapRef.current.has(nonce)) {
      sendingMapRef.current.delete(nonce);
      return;
    }

    const id = String(parsed.id() || '');
    if (!id || rawEventsRef.current.some(event => String(event.id() || '') === id)) return;
    rawEventsRef.current = [...rawEventsRef.current, parsed];
    setEventsVersion(version => version + 1);
    setLoading(false);
  }, []);

  const initSubscription = useCallback(
    (isPagination = false) => {
      if (!visible || !pubkey) return;
      if (!isPagination && rawEventsRef.current.length > 0) return;

      const requests = buildRequests(isPagination);
      if (!requests.length) return;

      setLoading(true);
      const subId = isPagination
        ? `kind4_page_${peerPubkey}_${paginationCounterRef.current}_${untilRef.current}`
        : `kind4_${peerPubkey}`;

      if (!isPagination) {
        unsubscribeRef.current?.();
        unsubscribeRef.current = subscribeToNostr(subId, requests, handleEvents);
      } else {
        paginationUnsubscribeRef.current?.();
        paginationUnsubscribeRef.current = subscribeToNostr(
          subId,
          requests,
          handleEvents,
          {pagination: prevPaginationSubIdRef.current},
        );
      }
      prevPaginationSubIdRef.current = subId;
    },
    [buildRequests, handleEvents, peerPubkey, pubkey, visible],
  );

  useEffect(() => {
    if (!visible || !pubkey) return;
    rawEventsRef.current = [];
    sendingMapRef.current.clear();
    untilRef.current = undefined;
    itemsBeforePaginationRef.current = 0;
    paginationCounterRef.current = 0;
    prevPaginationSubIdRef.current = undefined;
    setHasMore(true);
    setEventsVersion(version => version + 1);
    initSubscription();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      paginationUnsubscribeRef.current?.();
      paginationUnsubscribeRef.current = null;
      clearPaginationTimeout();
    };
  }, [clearPaginationTimeout, initSubscription, peerPubkey, pubkey, visible]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const keyboardShow = Keyboard.addListener('keyboardWillChangeFrame', event => {
      const duration = Math.max(1, event.duration || 250);
      keyboardAccessoryBottom.value = withDelay(
        KEYBOARD_ACCESSORY_SHOW_DELAY_MS,
        withTiming(0, {
          duration: Math.max(1, duration - KEYBOARD_ACCESSORY_SHOW_DELAY_MS),
        }),
      );
      keyboardAccessoryProgress.value = withDelay(
        KEYBOARD_ACCESSORY_SHOW_DELAY_MS,
        withTiming(1, {
          duration: Math.max(1, duration - KEYBOARD_ACCESSORY_SHOW_DELAY_MS),
        }),
      );
    });
    const keyboardHide = Keyboard.addListener('keyboardWillHide', event => {
      keyboardAccessoryBottom.value = withTiming(
        0,
        {duration: Math.max(1, event.duration || 250)},
      );
      keyboardAccessoryProgress.value = withTiming(0, {
        duration: Math.max(1, event.duration || 250),
      });
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, [keyboardAccessoryBottom, keyboardAccessoryProgress]);

  const keyboardAccessoryStyle = useAnimatedStyle(() => ({
    bottom: keyboardAccessoryBottom.value,
    paddingBottom: interpolate(
      keyboardAccessoryProgress.value,
      [0, 1],
      [insets.bottom, 0],
    ),
  }));

  useEffect(() => {
    if (loading || itemsBeforePaginationRef.current === 0) return;
    const itemsAtCheck = itemsBeforePaginationRef.current;
    clearPaginationTimeout();
    if (items.length - itemsAtCheck === 0) setHasMore(false);
    itemsBeforePaginationRef.current = 0;
  }, [clearPaginationTimeout, items.length, loading]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || items.length === 0) return;
    setLoading(true);
    itemsBeforePaginationRef.current = items.length;
    paginationCounterRef.current += 1;

    const overlapIndex = Math.max(0, items.length - 6);
    const cursor = items[overlapIndex];
    if (cursor) untilRef.current = cursor.createdAt() - 1;
    initSubscription(true);

    clearPaginationTimeout();
    paginationTimeoutRef.current = setTimeout(() => {
      setLoading(false);
    }, 10000);
  }, [clearPaginationTimeout, hasMore, initSubscription, items, loading]);

  const handleSubmit = useCallback(async () => {
    const content = message.trim();
    if (!content || !pubkey) return;

    const cryptoSource = (globalThis as typeof globalThis & {
      crypto?: {getRandomValues?: (array: Uint8Array) => Uint8Array};
    }).crypto;
    const bytes: Uint8Array =
      cryptoSource?.getRandomValues?.(new Uint8Array(16)) ??
      Uint8Array.from({length: 16}, () => Math.floor(Math.random() * 256));
    const nonce = Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    const event: UnsignedEvent = {
      kind: 4,
      pubkey,
      content,
      created_at: now(),
      tags: [
        ['p', peerPubkey],
        ['nonce', nonce],
      ],
    };
    const parsed = await parseContent(event.content);
    const parsedEvent = toParsedEvent(
      new ParsedEventT(
        getEventHash(event),
        event.pubkey,
        event.kind,
        event.created_at,
        ParsedData.Kind4Parsed,
        new Kind4ParsedT(parsed, event.content, peerPubkey, peerPubkey),
        [],
        [],
        event.tags.map(tag => new StringVecT(tag)),
      ),
    );

    setMessage('');
    sendingMapRef.current.set(nonce, Date.now());
    rawEventsRef.current = [parsedEvent, ...rawEventsRef.current];
    setEventsVersion(version => version + 1);
    getManager().publish(
      `4${event.content}`,
      event,
      writeRelayList,
      prevPaginationSubIdRef.current ? [prevPaginationSubIdRef.current] : undefined,
    );
  }, [message, peerPubkey, pubkey, writeRelayList]);

  const fixedHeader = useCallback(
    () => (
      <View className="flex-row items-center justify-between border-b border-slate-200 bg-slate-50/95 px-4 py-3">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white"
          hitSlop={12}
          onPress={onClose}
        >
          <ChevronLeft size={24} color="#17212b" strokeWidth={2.2} />
        </Pressable>
        <View className="max-w-[70%] flex-row items-center gap-2 rounded-full border border-slate-200 bg-white pr-3">
          <Avatar pubkey={peerPubkey} size="lg" />
          <User pubkey={peerPubkey} className="shrink text-base font-semibold text-slate-900" />
        </View>
        <View className="h-10 w-10" />
      </View>
    ),
    [onClose, peerPubkey],
  );

  const stickyFooter = useCallback(
    () => (
      <View className="border-t border-slate-200 bg-slate-50/95 px-4 pb-4 pt-3">
        <View className="flex-row items-end gap-2">
          <TextInput
            className="max-h-28 flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-base text-slate-900"
            multiline
            placeholder="Aa"
            placeholderTextColor="#8794a0"
            value={message}
            onChangeText={setMessage}
          />
          <Pressable
            className={`h-11 w-11 items-center justify-center rounded-full ${
              message.trim() ? 'bg-emerald-700' : 'bg-slate-300'
            }`}
            disabled={!message.trim()}
            onPress={handleSubmit}
          >
            <Send size={19} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>
    ),
    [handleSubmit, message],
  );

  const useKeyboardAccessory = Platform.OS === 'ios';

  return (
    <View className="flex-1 bg-slate-50">
      <Feed
        items={items}
        getItemId={item => String(item.id() || '')}
        visible={visible}
        bottom
        bottomAutoScroll="initial"
        fixedHeader={fixedHeader}
        stickyFooter={useKeyboardAccessory ? undefined : stickyFooter}
        stickyFooterVisible={!useKeyboardAccessory}
        onNearBottom={handleNearBottom}
        removeClippedSubviews={false}
        renderItem={({item, index}) => (
          <MessageBubble
            message={item}
            incoming={String(item.pubkey() || '') === peerPubkey}
            isFirst={index === 0 || String(items[index + 1]?.pubkey?.() || '') !== String(item.pubkey?.() || '')}
            isLast={index === items.length - 1 || String(items[index - 1]?.pubkey?.() || '') !== String(item.pubkey?.() || '')}
            date={index === items.length - 1 || oneDayDiff(item.createdAt(), items[index - 1]?.createdAt())}
            sentAt={sendingMapRef.current.get(getNonce(item) || '')}
          />
        )}
        header={() => <View style={{height: THREAD_HEADER_HEIGHT + topInset}} />}
        empty={
          <View className="px-6 py-20">
            <Text className="text-center text-base font-semibold text-slate-700">
              No messages yet
            </Text>
          </View>
        }
        contentContainerClassName="px-2 pb-4"
      />
      {useKeyboardAccessory ? (
        <Animated.View style={[styles.keyboardAccessory, keyboardAccessoryStyle]}>
          {stickyFooter()}
        </Animated.View>
      ) : null}
    </View>
  );
}

function MessageBubble({
  message,
  incoming,
  isFirst,
  isLast,
  date,
  sentAt,
}: {
  message: ParsedEvent;
  incoming: boolean;
  isFirst: boolean;
  isLast: boolean;
  date: boolean;
  sentAt?: number;
}) {
  const kind4 = asKind4(message) as Kind4Parsed | null;
  const content = kind4 ? fbArray(kind4, 'parsedContent') : [];
  const sendingState = sentAt
    ? Date.now() - sentAt > 5000
      ? 'failed'
      : 'sending'
    : null;

  return (
    <View className={`${isFirst ? 'pt-1.5' : 'pt-0.5'} pb-0.5`}>
      {date ? (
        <View className="my-2 items-center">
          <View className="rounded-full bg-white px-3 py-1">
            <Text className="text-xs text-slate-500">
              {formatRelativeTime(message.createdAt())}
            </Text>
          </View>
        </View>
      ) : null}
      <View className={`w-full flex-row ${incoming ? 'justify-start' : 'justify-end'} px-2`}>
        <View
          className={`relative max-w-[80%] px-4 py-2 ${
            incoming ? 'bg-white' : 'bg-sky-600'
          } ${
            isFirst && isLast
              ? 'rounded-2xl'
              : incoming
                ? `${isFirst ? 'rounded-t-2xl' : 'rounded-tl-md rounded-tr-2xl'} ${isLast ? 'rounded-b-2xl rounded-bl-none' : 'rounded-b-2xl rounded-bl-md'}`
                : `${isFirst ? 'rounded-t-2xl' : 'rounded-tr-md rounded-tl-2xl'} ${isLast ? 'rounded-b-2xl rounded-br-none' : 'rounded-b-2xl rounded-br-md'}`
          }`}
        >
          <ContentBlocks content={content} showQuote={false} />
          {!incoming && sendingState ? (
            <Text className="absolute -left-9 bottom-1 text-xs text-slate-500">
              {sendingState === 'failed' ? 'x' : '...'}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAccessory: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
  },
});
