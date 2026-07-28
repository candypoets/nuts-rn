import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ConnectionStatus, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asEoce,
  asKind1,
  asParsedEvent,
  ConnectionTracker,
} from '@candypoets/nipworker/utils';
import {ArrowLeft} from 'lucide-react-native';
import {Feed, FeedSticky} from '../components/Feed';
import {Note} from '../components/notes';
import {RelaysList} from '../components/RelaysList';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useRelayStore} from '../stores';

type TagsSubProps = {
  tags: string[];
  visible: boolean;
  onClose: () => void;
};

const PAGE_LIMIT = 50;
const TAG_RELAYS = DEFAULT_FEED_RELAYS;

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays.map(normalizeRelayUrl).sort().join('|');
}

function cleanTag(tag: string) {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

function safeSubKey(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function isRootKind1(event: ParsedEvent) {
  const kind1 = asKind1(event);
  if (!kind1) return true;

  const reply = kind1.reply()?.id();
  const root = kind1.root()?.id();
  if (reply && !root) return false;
  if (reply && root && reply !== root) return false;
  return true;
}

export function TagsSub({tags, visible, onClose}: TagsSubProps) {
  const cleanTags = useMemo(
    () => [...new Set(tags.map(cleanTag).filter(Boolean))],
    [tags],
  );
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const paginationCounterRef = useRef(0);
  const untilRef = useRef<number | undefined>(undefined);
  const prevPaginationSubIdRef = useRef<string | null>(null);
  const itemsBeforePaginationRef = useRef(0);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({});
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const relays = TAG_RELAYS;
  const tagsKey = cleanTags.join('_');
  const subId = useMemo(
    () => `tags_${safeSubKey(`${tagsKey}:${relayHash(relays)}`)}`,
    [relays, tagsKey],
  );

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (commitFrameRef.current) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
  }, []);

  const resetFeed = useCallback(() => {
    itemsRef.current = [];
    seenIdsRef.current.clear();
    pendingItemsRef.current = [];
    paginationCounterRef.current = 0;
    untilRef.current = undefined;
    prevPaginationSubIdRef.current = null;
    itemsBeforePaginationRef.current = 0;
    connectionTrackerRef.current.reset();
    setConnectionStatus({});
    setLoading(false);
    setHasMore(true);
    setItemsVersion(version => version + 1);
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    clearTimers();
  }, [clearTimers]);

  const commitPendingItems = useCallback(() => {
    commitFrameRef.current = null;
    const pending = pendingItemsRef.current;
    if (!pending.length) return;
    pendingItemsRef.current = [];
    itemsRef.current = [...itemsRef.current, ...pending].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    setItemsVersion(version => version + 1);
  }, []);

  const completeLoading = useCallback(() => {
    commitPendingItems();
    setLoading(false);
    clearTimers();
  }, [clearTimers, commitPendingItems]);

  const addItem = useCallback((event: ParsedEvent) => {
    const id = event.id();
    if (!id || seenIdsRef.current.has(id)) return;
    seenIdsRef.current.add(id);
    pendingItemsRef.current.push(event);
    if (!commitFrameRef.current) {
      commitFrameRef.current = requestAnimationFrame(commitPendingItems);
    }
  }, [commitPendingItems]);

  const handleEvents = useCallback((message: WorkerMessage) => {
    if (asEoce(message)) {
      completeLoading();
      return;
    }

    const status = asConnectionStatus(message);
    if (status) {
      const relayUrl = status.relayUrl();
      const relayStatus = status.status()?.toString();
      if (relayUrl) {
        const normalized = normalizeRelayUrl(relayUrl);
        setConnectionStatus(current => ({...current, [normalized]: status}));
        if (relayStatus) setRelayStatus(normalized, relayStatus);
      }
      connectionTrackerRef.current.handleMessage(message);
      if (connectionTrackerRef.current.resolutionRate > 0.5) {
        completeLoading();
      }
      return;
    }

    const parsed = asParsedEvent(message);
    if (!parsed || parsed.kind() !== 1 || !isRootKind1(parsed)) return;
    addItem(parsed);
  }, [addItem, completeLoading, setRelayStatus]);

  const requestList = useCallback(
    (forPagination = false) => [
      {
        kinds: [1],
        tags: {'#t': cleanTags},
        limit: PAGE_LIMIT,
        until: forPagination ? untilRef.current : undefined,
        noCache: true,
        relays,
      },
    ],
    [cleanTags, relays],
  );

  const startSubscription = useCallback(() => {
    if (!visible || cleanTags.length === 0 || unsubscribeRef.current) return;

    setLoading(itemsRef.current.length === 0);
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    setSubRelays(subId, relays.map(normalizeRelayUrl));
    relays.forEach(relay => setRelayStatus(normalizeRelayUrl(relay), 'SUBSCRIBED'));
    unsubscribeRef.current = subscribeToNostr(subId, requestList(), handleEvents, {
      bytesPerEvent: 10 * 1024,
    });
    prevPaginationSubIdRef.current = subId;
    timeoutRef.current = setTimeout(completeLoading, 10000);
  }, [cleanTags.length, completeLoading, handleEvents, relays, requestList, setRelayStatus, setSubRelays, subId, visible]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || itemsRef.current.length === 0) return;

    setLoading(true);
    itemsBeforePaginationRef.current = itemsRef.current.length;
    paginationCounterRef.current += 1;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    if (lastItem) untilRef.current = lastItem.createdAt() - 1;

    unsubscribePaginationRef.current?.();
    const pageSubId = `${subId}_page_${paginationCounterRef.current}_${untilRef.current}`;
    unsubscribePaginationRef.current = subscribeToNostr(pageSubId, requestList(true), handleEvents, {
      bytesPerEvent: 10 * 1024,
      pagination: prevPaginationSubIdRef.current ?? undefined,
    });
    prevPaginationSubIdRef.current = pageSubId;
    timeoutRef.current = setTimeout(completeLoading, 10000);
  }, [completeLoading, handleEvents, hasMore, loading, requestList, subId]);

  useEffect(() => {
    resetFeed();
  }, [resetFeed, tagsKey]);

  useEffect(() => {
    if (!visible) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearTimers();
      return;
    }
    startSubscription();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearTimers();
    };
  }, [clearTimers, startSubscription, visible]);

  useEffect(() => {
    if (loading || itemsBeforePaginationRef.current === 0) return;
    if (itemsRef.current.length === itemsBeforePaginationRef.current) {
      setHasMore(false);
    }
    itemsBeforePaginationRef.current = 0;
  }, [loading, itemsVersion]);

  const title = cleanTags.map(tag => `#${tag}`).join(' ');
  const renderHeader = useCallback(() => (
    <FeedSticky>
      <TagsHeader title={title} relays={relays} statuses={connectionStatus} onClose={onClose} />
    </FeedSticky>
  ), [connectionStatus, onClose, relays, title]);
  const renderItem = useCallback(
    ({item, visible: itemVisible}: {item: ParsedEvent; visible: boolean}) => (
      <Note note={item} visible={visible && itemVisible} />
    ),
    [visible],
  );
  const empty = (
    <View className="px-6 py-16">
      <Text className="text-center text-base font-semibold text-primary-content">{title || 'Hashtag feed'}</Text>
      <Text className="mt-2 text-center text-sm text-primary-content">No notes found yet.</Text>
    </View>
  );

  return (
    <Feed
      items={itemsRef.current}
      getItemId={(item, index) => item.id() || `missing:${index}`}
      renderItem={renderItem}
      motionHeader={renderHeader}
      loading={loading}
      onNearBottom={handleNearBottom}
      empty={empty}
      contentContainerClassName="pb-12"
      removeClippedSubviews={false}
    />
  );
}

function TagsHeader({
  title,
  relays,
  statuses,
  onClose,
}: {
  title: string;
  relays: string[];
  statuses: Record<string, ConnectionStatus>;
  onClose: () => void;
}) {
  const stringStatuses = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(statuses).map(([relay, status]) => [
          relay,
          status.status()?.toString() || '',
        ]),
      ),
    [statuses],
  );

  return (
    <View className="min-h-16 flex-row items-center gap-3 border-b border-base-200 bg-base-300/95 px-4 py-3">
      <Pressable
        hitSlop={10}
        className="h-9 w-9 items-center justify-center rounded-full bg-base-300"
        onPress={onClose}
      >
        <ArrowLeft size={20} color="#0f172a" />
      </Pressable>
      <Text className="min-w-0 flex-1 text-lg font-semibold text-primary" numberOfLines={1}>
        {title}
      </Text>
      <View className="max-w-[45%]">
        <RelaysList relays={relays} statuses={stringStatuses} mini />
      </View>
    </View>
  );
}
