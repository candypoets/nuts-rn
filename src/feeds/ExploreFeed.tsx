import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import type {
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
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
import { Feed } from '../components/Feed';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { Note } from '../components/notes';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { Infinity, PenLine, Search, Users } from 'lucide-react-native';
import {
  ALL_FEED_KINDS,
  KIND_LABELS,
  type FeedKind,
  type FeedPackSelection,
  useAuthStore,
  useFeedBuilderStore,
  useRelayStore,
  useNostrStore,
} from '../stores';
import { HeaderProfileButton } from '../components/HeaderProfileButton';
import { RelaysList as HeaderRelaysList } from '../components/RelaysList';
import type { RootStackParamList } from '../navigation/types';
import {useAppTheme} from '../theme';
import { FeedKindIcon } from '../components/FeedKindIcon';

type ExploreFeedProps = {
  enabled: boolean;
  visible: boolean;
  header?: () => React.ReactNode;
  stickyHeader?: () => React.ReactNode;
  stickyFooter?: () => React.ReactNode;
};

const followListImage = require('../../assets/followlist.png');
const GUEST_EXPLORE_RELAYS = [
  'wss://nostr.wine',
  'wss://pyramid.fiatjaf.com',
  'wss://nostr.mom',
];
const AUTH_FALLBACK_DELAY_MS = 1200;

function exploreFeedDebug(message: string, data?: Record<string, unknown>) {
  console.log(`[explore-feed] ${message}`, data ?? {});
}

function authorsForExplorePacks(
  packs: FeedPackSelection[],
  follows: string[],
  hasResolvedFollows: boolean,
) {
  const authors = new Set<string>();
  packs.forEach(pack => {
    const people =
      pack.id === 'followlist' && hasResolvedFollows ? follows : pack.people;
    people.forEach(author => authors.add(author));
  });
  return Array.from(authors);
}

function verifyExploreItemIds(items: ParsedEvent[], feedKey: string) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;

  const ids = new Map<string, number>();
  let missing = 0;

  items.forEach(item => {
    const id = item.id();
    if (!id) {
      missing += 1;
      return;
    }
    ids.set(id, (ids.get(id) ?? 0) + 1);
  });

  const duplicates = Array.from(ids.entries()).filter(([, count]) => count > 1);
  if (!missing && !duplicates.length) return;

  console.warn('[explore-feed] invalid item ids', {
    feedKey,
    items: items.length,
    missing,
    duplicates: duplicates.slice(0, 10).map(([id, count]) => ({
      id: id.slice(0, 12),
      count,
    })),
  });
}

export function ExploreFeed({
  enabled,
  visible,
  header,
  stickyHeader,
  stickyFooter,
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
  const subscriptionCounterRef = useRef(0);
  const requestCacheRef = useRef(0);
  const itemsBeforePaginationRef = useRef(0);
  const untilRef = useRef<number | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const paginationCheckTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const authFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const commitFrameRef = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const [allowGuestExplore, setAllowGuestExplore] = useState(false);
  const loadingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const selectedAuthors = useFeedBuilderStore(state => state.selectedAuthors);
  const selectedPacks = useFeedBuilderStore(state => state.selectedPacks);
  const feedBuilderHydrated = useFeedBuilderStore(state => state.hydrated);
  const authPubkey = useAuthStore(state => state.pubkey);
  const authResolved = useAuthStore(state => state.authResolved);
  const readRelays = useNostrStore(state => state.readRelays);
  const follows = useNostrStore(state => state.follows);
  const kind3UpdatedAt = useNostrStore(state => state.kind3UpdatedAt);
  const nostrHydrated = useNostrStore(state => state.hydrated);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const requestKinds = useMemo(
    () => (selectedKinds.length ? selectedKinds : ALL_FEED_KINDS),
    [selectedKinds],
  );
  const requestAuthors = useMemo(
    () =>
      selectedPacks.length
        ? authorsForExplorePacks(selectedPacks, follows, kind3UpdatedAt > 0)
        : selectedAuthors,
    [follows, kind3UpdatedAt, selectedAuthors, selectedPacks],
  );
  const feedRelays = useMemo(
    () =>
      authPubkey
        ? readRelays.length
          ? readRelays
          : DEFAULT_FEED_RELAYS
        : GUEST_EXPLORE_RELAYS,
    [authPubkey, readRelays],
  );
  const authReadyForExplore = Boolean(authPubkey) || authResolved;
  const canStartExplore =
    feedBuilderHydrated &&
    nostrHydrated &&
    (authReadyForExplore || allowGuestExplore);
  const feedKey = useMemo(
    () =>
      `${requestKinds.join(',') || 'kind1'}:${
        requestAuthors.join(',') || 'global'
      }:${feedRelays.join(',')}`,
    [feedRelays, requestAuthors, requestKinds],
  );
  const [itemsVersion, setItemsVersion] = useState(0);

  const defaultHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        selectedPacks={selectedPacks}
        surfaceClassName="bg-base-100"
      />
    ),
    [authPubkey, feedRelays, relayStatuses, selectedKinds, selectedPacks],
  );

  const defaultStickyHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        selectedPacks={selectedPacks}
        surfaceClassName="bg-base-100"
      />
    ),
    [authPubkey, feedRelays, relayStatuses, selectedKinds, selectedPacks],
  );

  const defaultStickyFooter = useCallback(() => <ExploreComposerFooter />, []);

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
    if (commitFrameRef.current) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
  }, []);

  const requestList = useCallback(
    (forPagination = false): RequestObject[] => {
      return [
        {
          kinds: requestKinds,
          authors: requestAuthors.length ? requestAuthors : undefined,
          limit: 50,
          since: forPagination
            ? undefined
            : Math.floor(Date.now() / 1000 - 31 * 24 * 60 * 60),
          until: forPagination ? untilRef.current : undefined,
          noCache: !!requestCacheRef.current,
          relays: feedRelays,
        },
      ];
    },
    [feedRelays, requestAuthors, requestKinds],
  );

  const shouldIncludeKind = useCallback(
    (kind: number) =>
      requestKinds.length > 0
        ? requestKinds.includes(kind as (typeof ALL_FEED_KINDS)[number])
        : true,
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
    setItemsVersion(version => version + 1);
  }, []);

  const scheduleCommitPendingItems = useCallback(() => {
    if (commitFrameRef.current) return;
    commitFrameRef.current = requestAnimationFrame(commitPendingItems);
  }, [commitPendingItems]);

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

  const addItem = useCallback(
    (parsedEvent: ParsedEvent) => {
      const id = parsedEvent.id();
      if (!id || seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      pendingItemsRef.current.push(parsedEvent);
      if (!subscriptionResolvingRef.current) {
        scheduleCommitPendingItems();
      }
    },
    [scheduleCommitPendingItems],
  );

  const handleEvents = useCallback(
    (message: WorkerMessage) => {
      if (asEoce(message)) {
        completeResolvingSubscription();
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
      const id = parsed.id();
      if (!shouldIncludeKind(kind)) {
        return;
      }

      if (kind === 1 || kind === 6) {
        const kind1 = asKind1(parsed);
        if (kind1) {
          const reply = kind1.reply()?.id();
          const root = kind1.root()?.id();
          if (reply && !root) {
            return;
          }
          if (reply && root && reply !== root) {
            return;
          }
        }

        if (kind === 6) {
          const kind6 = asKind6(parsed);
          if (!kind6?.repostedEvent()) {
            return;
          }
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

      if (!id) {
        return;
      }
      if (seenIdsRef.current.has(id)) {
        return;
      }

      addItem(parsed);
    },
    [addItem, completeResolvingSubscription, setRelayStatus, shouldIncludeKind],
  );

  const initFeed = useCallback(() => {
    if (!enabled || !visible || !canStartExplore) {
      return;
    }
    if (hasInitializedRef.current) {
      return;
    }
    if (loadingRef.current) {
      return;
    }
    if (isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;
    setLoading(itemsRef.current.length === 0);
    const requests = requestList();
    if (!requests.length) {
      setLoading(false);
      setRefreshing(false);
      isInitializingRef.current = false;
      return;
    }

    unsubscribeRef.current?.();
    rootSubIdRef.current = `feed_explore_${hashKey(
      `${feedKey}:${requestCacheRef.current}`,
    )}`;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    setSubRelays(rootSubIdRef.current, feedRelays.map(normalizeRelayUrl));
    feedRelays.forEach(relay => {
      setRelayStatus(normalizeRelayUrl(relay), 'SUBSCRIBED');
    });
    subscriptionCounterRef.current += 1;
    exploreFeedDebug('create subscription', {
      sequence: subscriptionCounterRef.current,
      type: 'main',
      subId: rootSubIdRef.current,
      enabled,
      visible,
      canStartExplore,
      feedBuilderHydrated,
      nostrHydrated,
      authPubkey: authPubkey ? `${authPubkey.slice(0, 8)}...` : null,
      authResolved,
      allowGuestExplore,
      feedKeyHash: hashKey(feedKey),
      requestCache: requestCacheRef.current,
      kinds: requestKinds,
      authors: requestAuthors.length,
      storedAuthors: selectedAuthors.length,
      follows: follows.length,
      relays: feedRelays,
      requests: requests.map(request => ({
        kinds: request.kinds,
        authors: request.authors?.length ?? 0,
        limit: request.limit,
        since: request.since,
        until: request.until,
        noCache: request.noCache,
        relays: request.relays,
      })),
    });
    unsubscribeRef.current = subscribeToNostr(
      rootSubIdRef.current,
      requests,
      handleEvents,
      { bytesPerEvent: 10 * 1024 },
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
  }, [
    completeResolvingSubscription,
    allowGuestExplore,
    authPubkey,
    authResolved,
    canStartExplore,
    enabled,
    feedBuilderHydrated,
    feedKey,
    feedRelays,
    follows.length,
    handleEvents,
    nostrHydrated,
    requestAuthors.length,
    requestList,
    requestKinds,
    selectedAuthors.length,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  const handleRefresh = useCallback(() => {
    if (!canStartExplore) return;
    if (refreshing) return;

    setRefreshing(true);
    requestCacheRef.current += 1;
    hasInitializedRef.current = false;
    loadingRef.current = false;
    setLoading(false);
    setHasMore(true);
    untilRef.current = undefined;
    prevPaginationSubIdRef.current = null;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    clearTimers();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    refreshTimeoutRef.current = setTimeout(() => {
      completeResolvingSubscription();
    }, 10000);
    initFeed();
  }, [
    canStartExplore,
    clearTimers,
    completeResolvingSubscription,
    initFeed,
    refreshing,
  ]);

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
      subscriptionCounterRef.current += 1;
      exploreFeedDebug('create subscription', {
        sequence: subscriptionCounterRef.current,
        type: 'pagination',
        subId: pageSubId,
        previousSubId: prevPaginationSubIdRef.current,
        enabled,
        visible,
        feedKeyHash: hashKey(feedKey),
        requestCache: requestCacheRef.current,
        paginationCounter: paginationCounterRef.current,
        itemsBeforePagination: itemsBeforePaginationRef.current,
        until: untilRef.current,
        kinds: requestKinds,
        authors: requestAuthors.length,
        storedAuthors: selectedAuthors.length,
        follows: follows.length,
        relays: feedRelays,
        requests: requests.map(request => ({
          kinds: request.kinds,
          authors: request.authors?.length ?? 0,
          limit: request.limit,
          since: request.since,
          until: request.until,
          noCache: request.noCache,
          relays: request.relays,
        })),
      });
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
  }, [
    completeResolvingSubscription,
    feedKey,
    handleEvents,
    hasMore,
    loading,
    requestList,
    requestKinds,
    requestAuthors.length,
    selectedAuthors.length,
    follows.length,
    feedRelays,
    visible,
    enabled,
  ]);

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
    verifyExploreItemIds(itemsRef.current, feedKey);
  }, [feedKey, itemsVersion]);

  useEffect(() => {
    if (!enabled) return;
    if (!canStartExplore) return;
    if (lastFeedKeyRef.current === feedKey) return;
    lastFeedKeyRef.current = feedKey;
    resetFeed();
  }, [canStartExplore, enabled, feedKey, resetFeed]);

  useEffect(() => {
    if (!enabled || !visible || authReadyForExplore) {
      setAllowGuestExplore(false);
      if (authFallbackTimeoutRef.current) {
        clearTimeout(authFallbackTimeoutRef.current);
        authFallbackTimeoutRef.current = null;
      }
      return;
    }

    if (authFallbackTimeoutRef.current) return;
    authFallbackTimeoutRef.current = setTimeout(() => {
      authFallbackTimeoutRef.current = null;
      setAllowGuestExplore(true);
    }, AUTH_FALLBACK_DELAY_MS);

    return () => {
      if (authFallbackTimeoutRef.current) {
        clearTimeout(authFallbackTimeoutRef.current);
        authFallbackTimeoutRef.current = null;
      }
    };
  }, [authReadyForExplore, enabled, visible]);

  useEffect(() => {
    if (!enabled) return;
    if (!visible || !canStartExplore) {
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
  }, [canStartExplore, clearTimers, enabled, initFeed, visible]);

  const mergePendingItems = useCallback(() => {
    setNewPostsCount(0);
    lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
  }, []);

  const renderNewNotesBanner = useCallback(
    ({ scrollToTop }: { scrollToTop: () => void }) =>
      newPostsCount > 0 ? (
        <NewNotesBanner
          count={newPostsCount}
          onPress={() => {
            mergePendingItems();
            scrollToTop();
          }}
        />
      ) : null,
    [mergePendingItems, newPostsCount],
  );

  const handleViewportChange = useCallback(
    ({ start }: { start: number; end: number; down: boolean }) => {
      startRef.current = start;
      if (start === 0) {
        lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
        setNewPostsCount(0);
      }
    },
    [],
  );

  const renderItem = useCallback(
    ({
      item,
      visible: itemVisible,
    }: {
      item: ParsedEvent;
      visible: boolean;
    }) => <Note note={item} visible={visible && itemVisible} />,
    [visible],
  );
  const getItemId = useCallback(
    (item: ParsedEvent, index: number) => item.id() || `missing:${index}`,
    [],
  );
  const listHeader = header ?? defaultHeader;

  const empty = (
    <View className="px-6 py-16">
      <Text className="text-center text-base font-semibold text-primary-content">
        Explore feed
      </Text>
      <Text className="mt-2 text-center text-sm text-primary-content">
        Loading explore notes...
      </Text>
    </View>
  );

  return (
    <View className="flex-1">
      <Feed
        items={itemsRef.current}
        getItemId={getItemId}
        header={listHeader}
        pullToRefresh
        stickyHeader={stickyHeader ?? defaultStickyHeader}
        fixedHeader={renderNewNotesBanner}
        stickyFooter={stickyFooter ?? defaultStickyFooter}
        renderItem={renderItem}
        loading={loading || refreshing}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onNearBottom={handleNearBottom}
        onViewportChange={handleViewportChange}
        empty={empty}
        contentContainerClassName="pb-28"
      />
    </View>
  );
}

function ExploreComposerFooter() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const primary = {
    background: '#17212b',
    border: '#17212b',
  };
  const openPost = useCallback(() => navigation.navigate('Post'), [navigation]);

  return (
    <View className="items-end px-4">
      <Pressable
        hitSlop={8}
        onPress={openPost}
        style={[styles.composerButton, { borderColor: `${primary.border}66` }]}
      >
        <BlurView
          intensity={28}
          tint="light"
          style={[
            styles.composerBlur,
            { backgroundColor: `${primary.background}2E` },
          ]}
        >
          <PenLine size={17} color={primary.background} strokeWidth={2.1} />
          <Text style={[styles.composerText, { color: primary.background }]}>
            What's up?
          </Text>
        </BlurView>
      </Pressable>
    </View>
  );
}

function ExploreHeader({
  mini = false,
  pubkey,
  relayStatuses,
  relays,
  selectedKinds,
  selectedPacks,
  surfaceClassName,
}: {
  mini?: boolean;
  pubkey: string | null;
  relayStatuses: Record<string, string>;
  relays: string[];
  selectedKinds: FeedKind[];
  selectedPacks: FeedPackSelection[];
  surfaceClassName: string;
}) {
  const visibleKinds =
    selectedKinds.length > 0 && selectedKinds.length < ALL_FEED_KINDS.length
      ? selectedKinds
      : [];

  return (
    <View className={mini ? 'border-b border-base-200 bg-base-100/95' : ''}>
      <View
        className={
          mini
            ? 'h-12 flex-row items-center justify-between'
            : 'rounded-lg bg-base-300/90 px-3 py-3 shadow-sm'
        }
      >
        <View
          className={
            mini
              ? 'flex-row items-center justify-between'
              : 'h-14 flex-row items-center justify-between'
          }
        >
          <View className="min-w-0 flex-1 flex-row items-center gap-1">
            <FeedPackHeaderButtons
              packs={selectedPacks}
              surfaceClassName={surfaceClassName}
            />
            <FeedKindHeaderButtons
              kinds={visibleKinds}
              surfaceClassName={surfaceClassName}
            />
          </View>
          <View className="flex-row items-center gap-2">
            <HeaderSearchButton surfaceClassName={surfaceClassName} />
            <NotificationBellButton
              className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
            />
            <HeaderProfileButton
              pubkey={pubkey}
              className={`h-9 w-9 border-base-200 ${surfaceClassName}`}
            />
          </View>
        </View>
        <HeaderRelaysList
          relays={relays}
          statuses={relayStatuses}
          mini={mini}
        />
      </View>
    </View>
  );
}

function FeedKindHeaderButtons({
  kinds,
  surfaceClassName,
}: {
  kinds: FeedKind[];
  surfaceClassName: string;
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const openFeedBuilder = useCallback(() => {
    navigation.navigate('FeedBuilder');
  }, [navigation]);

  if (!kinds.length) return null;

  return (
    <>
      {kinds.map(kind => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={`Filter: ${KIND_LABELS[kind]}`}
          className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
          onPress={openFeedBuilder}
        >
          <FeedKindIcon
            kind={kind}
            size={16}
            color={theme.colors.primaryContent}
            strokeWidth={2.1}
          />
        </Pressable>
      ))}
    </>
  );
}

function HeaderSearchButton({surfaceClassName}: {surfaceClassName: string}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
      hitSlop={12}
      onPress={() => navigation.navigate('CmdK')}
    >
      <Search size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
    </Pressable>
  );
}

function FeedPackHeaderButtons({
  packs,
  surfaceClassName,
}: {
  packs: FeedPackSelection[];
  surfaceClassName: string;
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const iconColor = theme.colors.primaryContent;
  const openFeedBuilder = useCallback(
    () => navigation.navigate('FeedBuilder'),
    [navigation],
  );

  if (!packs.length) {
    return (
      <Pressable
        className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
        hitSlop={12}
        onPress={openFeedBuilder}
      >
        <Infinity size={21} color={iconColor} strokeWidth={2.2} />
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
          className={`h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-base-200 ${surfaceClassName}`}
          hitSlop={12}
          onPress={openFeedBuilder}
        >
          {pack.localImage === 'followlist' || pack.image ? (
            <Image
              source={
                pack.localImage === 'followlist'
                  ? followListImage
                  : { uri: pack.image ?? '' }
              }
              style={styles.fill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Users size={18} color={iconColor} strokeWidth={2.1} />
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

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
  composerButton: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  composerBlur: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  composerText: {
    fontSize: 14,
    fontWeight: '600',
  },
  newNotesButton: {
    borderColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  newNotesBlur: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  newNotesText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
});

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
    shown.value = withTiming(1, { duration: 180 });
  }, [shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: -36 + shown.value * 36 }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      className="items-center pt-3"
      style={style}
    >
      <Pressable hitSlop={8} onPress={onPress} style={styles.newNotesButton}>
        <BlurView intensity={30} tint="light" style={styles.newNotesBlur}>
          <Text style={styles.newNotesText}>
            {count} new {count === 1 ? 'note' : 'notes'}
          </Text>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}
