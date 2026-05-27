import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Pressable, Text, View} from 'react-native';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asEoce,
  asKind1,
  asKind20,
  asKind6,
  asParsedEvent,
  ConnectionTracker,
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
  Bell,
  Infinity,
  RefreshCw,
  Users,
} from 'lucide-react-native';
import {
  ALL_FEED_KINDS,
  type FeedPackSelection,
  useAuthStore,
  useFeedBuilderStore,
  useRelayStore,
  useNostrStore,
} from '../stores';
import {HeaderProfileButton} from '../components/HeaderProfileButton';
import {RelaysList as HeaderRelaysList} from '../components/RelaysList';
import {FeedBuilderModal} from '../modals/FeedBuilderModal';

type ExploreFeedProps = {
  enabled: boolean;
  visible: boolean;
  header?: () => React.ReactNode;
  stickyHeader?: () => React.ReactNode;
  stickyFooter?: () => React.ReactNode;
  onProfileOpen?: (pubkey: string) => void;
};

const followListImage = require('../../assets/followlist.png');

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
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const loadingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const selectedAuthors = useFeedBuilderStore(state => state.selectedAuthors);
  const selectedPacks = useFeedBuilderStore(state => state.selectedPacks);
  const authPubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [feedBuilderOpen, setFeedBuilderOpen] = useState(false);
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

  const defaultHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedPacks={selectedPacks}
        surfaceClassName="bg-slate-50"
        onFeedBuilderOpen={() => setFeedBuilderOpen(true)}
      />
    ),
    [authPubkey, feedRelays, relayStatuses, selectedPacks],
  );

  const defaultStickyHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedPacks={selectedPacks}
        mini
        surfaceClassName="bg-white"
        onFeedBuilderOpen={() => setFeedBuilderOpen(true)}
      />
    ),
    [authPubkey, feedRelays, relayStatuses, selectedPacks],
  );

  const tabsSpacer = useCallback(() => <View className="h-[72px]" />, []);

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
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = false;
    setTick(t => t + 1);

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    clearTimers();
  }, [clearTimers]);

  const commitPendingItems = useCallback(() => {
    const pending = pendingItemsRef.current;
    if (!pending.length) return;
    pendingItemsRef.current = [];

    const headCreatedAt = itemsRef.current[0]?.createdAt() ?? 0;
    const newAboveViewport =
      startRef.current > 0 && lastSeenTopItemRef.current !== null
        ? pending.filter(event => event.createdAt() > headCreatedAt).length
        : 0;

    itemsRef.current = [...itemsRef.current, ...pending].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    if (startRef.current === 0) {
      lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
      setNewPostsCount(0);
    } else if (newAboveViewport) {
      setNewPostsCount(count => count + newAboveViewport);
    }
    setTick(t => t + 1);
  }, []);

  const completeResolvingSubscription = useCallback(() => {
    if (!subscriptionResolvingRef.current) return;
    subscriptionResolvingRef.current = false;
    isInitialBatchReadyRef.current = true;
    commitPendingItems();
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
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
  }, [commitPendingItems]);

  const addItem = useCallback((parsedEvent: ParsedEvent) => {
    const id = parsedEvent.id();
    if (!id || seenIdsRef.current.has(id)) return;
    seenIdsRef.current.add(id);
    pendingItemsRef.current = [...pendingItemsRef.current, parsedEvent];
    if (!subscriptionResolvingRef.current) {
      commitPendingItems();
    }
  }, [commitPendingItems]);

  const handleEvents = useCallback(
    (message: WorkerMessage) => {
      if (asEoce(message)) {
        commitPendingItems();
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) {
          setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        }

        connectionTrackerRef.current.handleMessage(message);
        if (connectionTrackerRef.current.resolutionRate > 0.5) {
          completeResolvingSubscription();
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
    [
      addItem,
      commitPendingItems,
      completeResolvingSubscription,
      setRelayStatus,
      shouldIncludeKind,
    ],
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
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
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
        completeResolvingSubscription();
        if (itemsRef.current.length === 0) {
          hasInitializedRef.current = false;
        }
      }
    }, 1500);
  }, [completeResolvingSubscription, enabled, feedKey, feedRelays, handleEvents, requestList, setRelayStatus, setSubRelays, visible]);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;

    setRefreshing(true);
    requestCacheRef.current += 1;
    hasInitializedRef.current = false;
    setHasMore(true);
    untilRef.current = undefined;
    prevPaginationSubIdRef.current = null;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    clearTimers();
    refreshTimeoutRef.current = setTimeout(() => {
      completeResolvingSubscription();
    }, 10000);
    initFeed();
  }, [clearTimers, completeResolvingSubscription, initFeed, refreshing]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || itemsRef.current.length === 0) return;

    setLoading(true);
    itemsBeforePaginationRef.current = itemsRef.current.length;
    paginationCounterRef.current += 1;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
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
        completeResolvingSubscription();
      }, 10000);
    } else {
      setLoading(false);
      setHasMore(false);
    }
    },
    [completeResolvingSubscription, feedKey, handleEvents, hasMore, loading, requestList],
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
    <View className="flex-1">
      {(header ?? defaultHeader)()}
      <Feed
        items={itemsRef.current}
        getItemId={item => item.id() || ''}
        pullToRefresh
        stickyFooterVisible
        stickyHeader={stickyHeader ?? defaultStickyHeader}
        fixedHeader={renderNewNotesBanner}
        stickyFooter={stickyFooter ?? tabsSpacer}
        renderItem={renderItem}
        loading={loading || refreshing}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onNearBottom={handleNearBottom}
        onViewportChange={handleViewportChange}
        empty={empty}
        contentContainerClassName="pb-28 px-2"
      />
      {feedBuilderOpen ? (
        <View className="absolute inset-0 z-50 bg-white">
          <FeedBuilderModal onClose={() => setFeedBuilderOpen(false)} />
        </View>
      ) : null}
    </View>
  );
}

function ExploreHeader({
  mini = false,
  pubkey,
  relayStatuses,
  relays,
  selectedPacks,
  surfaceClassName,
  onFeedBuilderOpen,
}: {
  mini?: boolean;
  pubkey: string | null;
  relayStatuses: Record<string, string>;
  relays: string[];
  selectedPacks: FeedPackSelection[];
  surfaceClassName: string;
  onFeedBuilderOpen: () => void;
}) {
  return (
    <View
      className={
        mini
          ? 'border-b border-slate-200 bg-slate-50/95 px-4 py-2'
          : 'bg-slate-50 px-1 pt-2'
      }
    >
      <View className={mini ? 'h-12 flex-row items-center justify-between' : 'mx-1 rounded-lg bg-white/90 px-3 py-3 shadow-sm'}>
        <View className={mini ? 'flex-row items-center justify-between' : 'h-14 flex-row items-center justify-between'}>
          <FeedPackHeaderButtons
            packs={selectedPacks}
            surfaceClassName={surfaceClassName}
            onPress={onFeedBuilderOpen}
          />
          <View className="flex-row items-center gap-2">
            <Pressable className={`h-9 w-9 items-center justify-center rounded-full border border-slate-200 ${surfaceClassName}`}>
              <RefreshCw size={18} color="#52616f" strokeWidth={2.2} />
            </Pressable>
            <Pressable className={`h-9 w-9 items-center justify-center rounded-full border border-slate-200 ${surfaceClassName}`}>
              <Bell size={19} color="#17212b" strokeWidth={2.2} />
            </Pressable>
            <HeaderProfileButton
              pubkey={pubkey}
              className={`h-9 w-9 border-slate-200 ${surfaceClassName}`}
            />
          </View>
        </View>
        <HeaderRelaysList relays={relays} statuses={relayStatuses} mini={mini} />
      </View>
    </View>
  );
}

function FeedPackHeaderButtons({
  packs,
  surfaceClassName,
  onPress,
}: {
  packs: FeedPackSelection[];
  surfaceClassName: string;
  onPress: () => void;
}) {
  if (!packs.length) {
    return (
      <Pressable
        className={`h-9 w-9 items-center justify-center rounded-full border border-slate-200 ${surfaceClassName}`}
        hitSlop={12}
        onPress={onPress}
      >
        <Infinity size={21} color="#17212b" strokeWidth={2.2} />
      </Pressable>
    );
  }

  return (
    <View className="flex-row items-center gap-1">
      {packs.slice(0, 4).map(pack => (
        <Pressable
          key={pack.id}
          accessibilityRole="button"
          accessibilityLabel={pack.title}
          className={`h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 ${surfaceClassName}`}
          hitSlop={12}
          onPress={onPress}
        >
          {pack.localImage === 'followlist' || pack.image ? (
            <Image
              source={pack.localImage === 'followlist' ? followListImage : {uri: pack.image ?? ''}}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <Users size={18} color="#17212b" strokeWidth={2.1} />
          )}
        </Pressable>
      ))}
    </View>
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
