import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asKind20,
  asKind6,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {Feed} from '../components/Feed';
import {Note} from '../components/notes';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {
  ALL_FEED_KINDS,
  useAuthStore,
  useFeedBuilderStore,
  useRelayStore,
  useNostrStore,
} from '../stores';

type ExploreFeedProps = {
  enabled: boolean;
  visible: boolean;
  header: () => React.ReactNode;
  stickyHeader: () => React.ReactNode;
  stickyFooter: () => React.ReactNode;
  onProfileOpen?: (pubkey: string) => void;
};

export function ExploreFeed({
  enabled,
  visible,
  header,
  stickyHeader,
  stickyFooter,
  onProfileOpen,
}: ExploreFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const isInitializingRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const isInitialBatchReadyRef = useRef(false);
  const startRef = useRef(0);
  const lastSeenTopItemRef = useRef<number | null>(null);
  const lastFeedKeyRef = useRef<string | null>(null);
  const rootSubIdRef = useRef<string | null>(null);
  const prevPaginationSubIdRef = useRef<string | null>(null);
  const paginationCounterRef = useRef(0);
  const requestCacheRef = useRef(0);
  const itemsBeforePaginationRef = useRef(0);
  const untilRef = useRef<number | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginationCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const loadingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const selectedAuthors = useFeedBuilderStore(state => state.selectedAuthors);
  const authPubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const requestKinds = useMemo(
    () => (selectedKinds.length ? selectedKinds : ALL_FEED_KINDS),
    [selectedKinds],
  );
  const feedRelays =
    authPubkey && readRelays.length ? readRelays : DEFAULT_FEED_RELAYS;
  const feedKey = useMemo(
    () =>
      `${requestKinds.join(',') || 'kind1'}:${selectedAuthors.join(',') || 'global'}:${feedRelays.join(',')}`,
    [feedRelays, requestKinds, selectedAuthors],
  );
  const [, setTick] = useState(0);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
    if (paginationCheckTimeoutRef.current) {
      clearTimeout(paginationCheckTimeoutRef.current);
      paginationCheckTimeoutRef.current = null;
    }
  }, []);

  const requestList = useCallback(
    (forPagination = false): RequestObject[] => {
      return [
        {
          kinds: requestKinds,
          authors: selectedAuthors.length ? selectedAuthors : undefined,
          limit: 50,
          since: forPagination ? undefined : Math.floor(Date.now() / 1000 - 31 * 24 * 60 * 60),
          until: forPagination ? untilRef.current : undefined,
          noCache: !!requestCacheRef.current,
          relays: feedRelays,
        },
      ];
    },
    [feedRelays, requestKinds, selectedAuthors],
  );

  const shouldIncludeKind = useCallback(
    (kind: number) =>
      requestKinds.length > 0 ? requestKinds.includes(kind as (typeof ALL_FEED_KINDS)[number]) : true,
    [requestKinds],
  );

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const resetFeed = useCallback(() => {
    itemsRef.current = [];
    seenIdsRef.current.clear();
    isInitialBatchReadyRef.current = false;
    hasInitializedRef.current = false;
    isInitializingRef.current = false;
    startRef.current = 0;
    lastSeenTopItemRef.current = null;
    untilRef.current = undefined;
    paginationCounterRef.current = 0;
    setHasMore(true);
    itemsBeforePaginationRef.current = 0;
    prevPaginationSubIdRef.current = null;
    rootSubIdRef.current = null;
    setLoading(false);
    setRefreshing(false);
    setNewPostsCount(0);
    setTick(t => t + 1);

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    clearTimers();
  }, [clearTimers]);

  const addItem = useCallback((parsedEvent: ParsedEvent) => {
    const id = parsedEvent.id();
    if (!id || seenIdsRef.current.has(id)) return;
    seenIdsRef.current.add(id);

    const headCreatedAt = itemsRef.current[0]?.createdAt() ?? 0;
    if (
      startRef.current > 0 &&
      lastSeenTopItemRef.current !== null &&
      parsedEvent.createdAt() > headCreatedAt
    ) {
      setNewPostsCount(count => count + 1);
    }

    itemsRef.current = [...itemsRef.current, parsedEvent].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    if (startRef.current === 0) {
      lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
      setNewPostsCount(0);
    }
    setTick(t => t + 1);
  }, []);

  const handleEvents = useCallback(
    (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) {
          setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        }

        if (status.status()?.toString() === 'EOSE') {
          if (!isInitialBatchReadyRef.current) {
            isInitialBatchReadyRef.current = true;
          }
          setLoading(false);
          setRefreshing(false);
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          if (initTimeoutRef.current) {
            clearTimeout(initTimeoutRef.current);
            initTimeoutRef.current = null;
          }
          if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
            refreshTimeoutRef.current = null;
          }
        }
        return;
      }

      const parsed = asParsedEvent(message);
      if (!parsed) return;

      const kind = parsed.kind();
      if (!shouldIncludeKind(kind)) return;

      if (kind === 1 || kind === 6) {
        const kind1 = asKind1(parsed);
        if (kind1) {
          const reply = kind1.reply()?.id();
          const root = kind1.root()?.id();
          if (reply && !root) return;
          if (reply && root && reply !== root) return;
        }

        if (kind === 6) {
          const kind6 = asKind6(parsed);
          if (!kind6?.repostedEvent()) return;
        }
      } else if (kind === 20) {
        const kind20 = asKind20(parsed);
        if (kind20) {
          const images = fbArray(kind20, 'images');
          if (images.some(img => !img.dim())) {
            return;
          }
        }
      }

      const id = parsed.id();
      if (!id) return;
      if (seenIdsRef.current.has(id)) return;

      addItem(parsed);
    },
    [addItem, setRelayStatus, shouldIncludeKind],
  );

  const initFeed = useCallback(() => {
    if (!enabled || !visible) return;
    if (hasInitializedRef.current) return;
    if (loadingRef.current) return;
    if (isInitializingRef.current) return;

    isInitializingRef.current = true;
    setLoading(true);
    const requests = requestList();
    if (!requests.length) {
      setLoading(false);
      setRefreshing(false);
      isInitializingRef.current = false;
      return;
    }

    unsubscribeRef.current?.();
    rootSubIdRef.current = `feed_explore_${hashKey(`${feedKey}:${requestCacheRef.current}`)}`;
    setSubRelays(rootSubIdRef.current, feedRelays.map(normalizeRelayUrl));
    feedRelays.forEach(relay => {
      setRelayStatus(normalizeRelayUrl(relay), 'SUBSCRIBED');
    });
    unsubscribeRef.current = subscribeToNostr(
      rootSubIdRef.current,
      requests,
      handleEvents,
      {bytesPerEvent: 10 * 1024},
    );
    prevPaginationSubIdRef.current = rootSubIdRef.current;
    hasInitializedRef.current = true;
    isInitializingRef.current = false;
    isInitialBatchReadyRef.current = false;

    initTimeoutRef.current = setTimeout(() => {
      if (loadingRef.current) {
        setLoading(false);
        if (itemsRef.current.length === 0) {
          hasInitializedRef.current = false;
        }
      }
    }, 1500);
  }, [enabled, feedKey, feedRelays, handleEvents, requestList, setRelayStatus, setSubRelays, visible]);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;

    setRefreshing(true);
    requestCacheRef.current += 1;
    hasInitializedRef.current = false;
    setHasMore(true);
    untilRef.current = undefined;
    prevPaginationSubIdRef.current = null;
    clearTimers();
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
      setLoading(false);
    }, 10000);
    initFeed();
  }, [clearTimers, initFeed, refreshing]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || itemsRef.current.length === 0) return;

    setLoading(true);
    itemsBeforePaginationRef.current = itemsRef.current.length;
    paginationCounterRef.current += 1;
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    if (lastItem) untilRef.current = lastItem.createdAt() - 1;
    const requests = requestList(true);

    if (requests.length > 0) {
      unsubscribePaginationRef.current?.();
      const pageSubId = `${feedKey}_page_${paginationCounterRef.current}_${untilRef.current}`;
      unsubscribePaginationRef.current = subscribeToNostr(
        pageSubId,
        requests,
        handleEvents,
        {
          bytesPerEvent: 10 * 1024,
          pagination: prevPaginationSubIdRef.current,
        },
      );
      prevPaginationSubIdRef.current = pageSubId;
      paginationTimeoutRef.current = setTimeout(() => {
        setLoading(false);
      }, 10000);
    } else {
      setLoading(false);
      setHasMore(false);
    }
    },
    [feedKey, handleEvents, hasMore, loading, requestList],
  );

  useEffect(() => {
    if (!loading) {
      const itemsAtCheck = itemsBeforePaginationRef.current;
      if (itemsAtCheck > 0) {
      if (paginationTimeoutRef.current) {
        clearTimeout(paginationTimeoutRef.current);
        paginationTimeoutRef.current = null;
        }

        paginationCheckTimeoutRef.current = setTimeout(() => {
          const newItems = itemsRef.current.length - itemsAtCheck;
          if (newItems === 0) {
            setHasMore(false);
          }
          itemsBeforePaginationRef.current = 0;
          setTimeout(() => {
            unsubscribePaginationRef.current?.();
            unsubscribePaginationRef.current = null;
          }, 5000);
        }, 500);
      }
    }
  }, [loading]);

  useEffect(() => {
    if (!enabled) return;
    if (lastFeedKeyRef.current === feedKey) return;
    lastFeedKeyRef.current = feedKey;
    resetFeed();
  }, [enabled, feedKey, resetFeed]);

  useEffect(() => {
    if (!enabled) return;
    if (!visible) {
      hasInitializedRef.current = false;
      isInitializingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearTimers();
      return;
    }

    initFeed();

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearTimers();
    };
  }, [clearTimers, enabled, initFeed, visible]);

  const mergePendingItems = useCallback(() => {
    setNewPostsCount(0);
    lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
  }, []);

  const renderNewNotesBanner = useCallback(
    () => <NewNotesBanner count={newPostsCount} onPress={mergePendingItems} />,
    [mergePendingItems, newPostsCount],
  );

  const handleViewportChange = useCallback(
    ({start}: {start: number; end: number; down: boolean}) => {
      startRef.current = start;
      if (start === 0) {
        lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
        setNewPostsCount(0);
      }
    },
    [],
  );

  const renderItem = useCallback(
    ({item, visible: itemVisible}: {item: ParsedEvent; visible: boolean}) => (
      <Note
        note={item}
        visible={visible && itemVisible}
        onProfileOpen={onProfileOpen}
      />
    ),
    [onProfileOpen, visible],
  );

  const empty = (
    <View className="px-6 py-16">
      <Text className="text-center text-base font-semibold text-slate-700">
        Explore feed
      </Text>
      <Text className="mt-2 text-center text-sm text-slate-500">
        Loading explore notes...
      </Text>
    </View>
  );

  return (
    <Feed
      items={itemsRef.current}
      getItemId={item => item.id() || ''}
      pullToRefresh
      stickyFooterVisible
      header={header}
      stickyHeader={stickyHeader}
      fixedHeader={renderNewNotesBanner}
      stickyFooter={stickyFooter}
      renderItem={renderItem}
      loading={loading || refreshing}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      onNearBottom={handleNearBottom}
      onViewportChange={handleViewportChange}
      empty={empty}
      contentContainerClassName="pb-28 px-2"
    />
  );
}

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash.toString(36);
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function NewNotesBanner({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(count > 0 ? 1 : 0, {duration: 180});
  }, [count, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{translateY: -16 + shown.value * 16}],
  }));

  return (
    <Animated.View
      pointerEvents={count > 0 ? 'box-none' : 'none'}
      className="px-4 pt-24"
      style={style}
    >
      <Pressable
        className="items-center rounded-full bg-emerald-700 px-4 py-2 shadow-sm"
        onPress={onPress}
      >
        <Text className="text-sm font-semibold text-white">
          {count} new {count === 1 ? 'note' : 'notes'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
