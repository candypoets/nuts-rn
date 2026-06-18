import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated as RNAnimated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
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
import { ChevronDown, PenLine, Search } from 'lucide-react-native';
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
import { useAppTheme } from '../theme';
import { FeedKindIcon } from '../components/FeedKindIcon';

type ExploreFeedProps = {
  enabled: boolean;
  visible: boolean;
  header?: () => React.ReactNode;
  stickyHeader?: () => React.ReactNode;
  stickyFooter?: () => React.ReactNode;
  onChromeVisibilityChange?: (visible: boolean) => void;
};

const GUEST_EXPLORE_RELAYS = [
  'wss://nostr.wine',
  'wss://pyramid.fiatjaf.com',
  'wss://nostr.mom',
];
const AUTH_FALLBACK_DELAY_MS = 1200;
type ExploreKindTabId =
  | 'all'
  | 'notes'
  | 'articles'
  | 'polls'
  | 'media'
  | 'events';
type ExploreKindTab = {
  id: ExploreKindTabId;
  label: string;
  kinds?: FeedKind[];
};
const EXPLORE_KIND_TABS: ExploreKindTab[] = [
  {id: 'all', label: 'All'},
  {id: 'notes', label: 'Notes', kinds: [1, 6]},
  {id: 'articles', label: 'Articles', kinds: [30023]},
  {id: 'polls', label: 'Polls', kinds: [1068]},
  {id: 'media', label: 'Media', kinds: [20, 34235]},
  {id: 'events', label: 'Events', kinds: [30311]},
];

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

function hasFollowListPack(packs: FeedPackSelection[]) {
  return packs.some(pack => pack.id === 'followlist');
}

export function ExploreFeed({
  enabled,
  visible,
  header,
  stickyHeader,
  stickyFooter,
  onChromeVisibilityChange,
}: ExploreFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const startRef = useRef(0);
  const lastSeenTopItemRef = useRef<number | null>(null);
  const rootSubIdRef = useRef<string | null>(null);
  const liveSubIdRef = useRef<string | null>(null);
  const prevPaginationSubIdRef = useRef<string | null>(null);
  const paginationCounterRef = useRef(0);
  const requestCacheRef = useRef(0);
  const itemsBeforePaginationRef = useRef(0);
  const untilRef = useRef<number | undefined>(undefined);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const unsubscribeLiveRef = useRef<(() => void) | null>(null);
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const deferredNewItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const [allowGuestExplore, setAllowGuestExplore] = useState(false);
  const loadingRef = useRef(false);
  const refreshingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const setSelectedKinds = useFeedBuilderStore(state => state.setSelectedKinds);
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
  const followsReadyForExplore =
    !hasFollowListPack(selectedPacks) || kind3UpdatedAt > 0;
  const canStartExplore =
    feedBuilderHydrated &&
    nostrHydrated &&
    followsReadyForExplore &&
    (authReadyForExplore || allowGuestExplore);
  const feedKey = useMemo(
    () =>
      `${requestKinds.join(',') || 'kind1'}:${
        requestAuthors.join(',') || 'global'
      }:${feedRelays.join(',')}`,
    [feedRelays, requestAuthors, requestKinds],
  );
  const [, setItemsVersion] = useState(0);

  const defaultHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        setSelectedKinds={setSelectedKinds}
        selectedPacks={selectedPacks}
        showKindSelector
        surfaceClassName="bg-base-100"
      />
    ),
    [
      authPubkey,
      feedRelays,
      relayStatuses,
      selectedKinds,
      selectedPacks,
      setSelectedKinds,
    ],
  );

  const defaultStickyHeader = useCallback(
    () => (
      <ExploreHeader
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        setSelectedKinds={setSelectedKinds}
        selectedPacks={selectedPacks}
        showKindIndicators={false}
        surfaceClassName="bg-base-100"
      />
    ),
    [
      authPubkey,
      feedRelays,
      relayStatuses,
      selectedKinds,
      selectedPacks,
      setSelectedKinds,
    ],
  );

  const defaultStickyFooter = useCallback(() => <ExploreComposerFooter />, []);

  const clearTimers = useCallback(() => {
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
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
    (options?: {
      forPagination?: boolean;
      since?: number;
      limit?: number;
    }): RequestObject[] => {
      const forPagination = options?.forPagination ?? false;
      return [
        {
          kinds: requestKinds,
          authors: requestAuthors.length ? requestAuthors : undefined,
          limit: options?.limit ?? 50,
          since: forPagination
            ? undefined
            : options?.since ??
              Math.floor(Date.now() / 1000 - 31 * 24 * 60 * 60),
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

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  const setLoadingState = useCallback((next: boolean) => {
    loadingRef.current = next;
    setLoading(next);
  }, []);

  const setRefreshingState = useCallback((next: boolean) => {
    refreshingRef.current = next;
    setRefreshing(next);
  }, []);

  const resetItems = useCallback(() => {
    itemsRef.current = [];
    seenIdsRef.current.clear();
    startRef.current = 0;
    lastSeenTopItemRef.current = null;
    untilRef.current = undefined;
    paginationCounterRef.current = 0;
    setHasMore(true);
    itemsBeforePaginationRef.current = 0;
    prevPaginationSubIdRef.current = null;
    rootSubIdRef.current = null;
    setNewPostsCount(0);
    pendingItemsRef.current = [];
    deferredNewItemsRef.current = [];
    connectionTrackerRef.current.reset();
    setItemsVersion(version => version + 1);
  }, []);

  const stopRootSubscription = useCallback(
    (clearLoading = true) => {
      subscriptionResolvingRef.current = false;
      pendingItemsRef.current = [];
      connectionTrackerRef.current.reset();
      if (clearLoading) {
        setLoadingState(false);
        setRefreshingState(false);
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribeLiveRef.current?.();
      unsubscribeLiveRef.current = null;
      rootSubIdRef.current = null;
      liveSubIdRef.current = null;
      prevPaginationSubIdRef.current = null;
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearTimers();
    },
    [clearTimers, setLoadingState, setRefreshingState],
  );

  const resetFeed = useCallback(() => {
    stopRootSubscription(false);
    resetItems();
    setLoadingState(false);
    setRefreshingState(false);
  }, [resetItems, setLoadingState, setRefreshingState, stopRootSubscription]);

  const commitPendingItems = useCallback(() => {
    commitFrameRef.current = null;
    const pending = pendingItemsRef.current;
    if (!pending.length) return;
    pendingItemsRef.current = [];

    const headCreatedAt = itemsRef.current[0]?.createdAt() ?? 0;
    const nearTop = startRef.current === 0;
    const deferred =
      !nearTop && lastSeenTopItemRef.current !== null
        ? pending.filter(event => event.createdAt() > headCreatedAt)
        : [];
    const immediate =
      deferred.length > 0
        ? pending.filter(event => event.createdAt() <= headCreatedAt)
        : pending;

    if (immediate.length > 0) {
      itemsRef.current = [...itemsRef.current, ...immediate].sort(
        (left, right) => right.createdAt() - left.createdAt(),
      );
    }
    if (nearTop) {
      lastSeenTopItemRef.current = itemsRef.current[0]?.createdAt() ?? null;
      setNewPostsCount(0);
    } else if (deferred.length > 0) {
      deferredNewItemsRef.current = [
        ...deferredNewItemsRef.current,
        ...deferred,
      ].sort((left, right) => right.createdAt() - left.createdAt());
      setNewPostsCount(count => count + deferred.length);
    }
    if (immediate.length > 0) {
      setItemsVersion(version => version + 1);
    }
  }, []);

  const scheduleCommitPendingItems = useCallback(() => {
    if (commitFrameRef.current) return;
    commitFrameRef.current = requestAnimationFrame(commitPendingItems);
  }, [commitPendingItems]);

  const completeResolvingSubscription = useCallback(() => {
    if (!subscriptionResolvingRef.current) {
      return;
    }
    subscriptionResolvingRef.current = false;
    commitPendingItems();
    setLoadingState(false);
    setRefreshingState(false);
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
  }, [commitPendingItems, setLoadingState, setRefreshingState]);

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

  const startRootSubscription = useCallback(() => {
    setLoadingState(itemsRef.current.length === 0);
    const requests = requestList();
    if (!requests.length) {
      setLoadingState(false);
      setRefreshingState(false);
      return;
    }

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
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
    unsubscribeRef.current = subscribeToNostr(
      rootSubIdRef.current,
      requests,
      handleEvents,
      { bytesPerEvent: 10 * 1024 },
    );
    prevPaginationSubIdRef.current = rootSubIdRef.current;

    initTimeoutRef.current = setTimeout(() => {
      if (loadingRef.current) {
        completeResolvingSubscription();
      }
    }, 1500);
  }, [
    completeResolvingSubscription,
    feedKey,
    feedRelays,
    handleEvents,
    requestList,
    setRelayStatus,
    setSubRelays,
    setLoadingState,
    setRefreshingState,
  ]);

  const stopLiveSubscription = useCallback(() => {
    unsubscribeLiveRef.current?.();
    unsubscribeLiveRef.current = null;
    liveSubIdRef.current = null;
  }, []);

  const startLiveSubscription = useCallback(() => {
    const since = Math.floor(Date.now() / 1000);
    const requests = requestList({ since, limit: 20 });
    if (!requests.length) return;

    stopLiveSubscription();
    liveSubIdRef.current = `feed_explore_live_${hashKey(
      `${feedKey}:${since}:${requestCacheRef.current}`,
    )}`;
    setSubRelays(liveSubIdRef.current, feedRelays.map(normalizeRelayUrl));
    unsubscribeLiveRef.current = subscribeToNostr(
      liveSubIdRef.current,
      requests,
      handleEvents,
      { bytesPerEvent: 10 * 1024 },
    );
  }, [
    feedKey,
    feedRelays,
    handleEvents,
    requestList,
    setSubRelays,
    stopLiveSubscription,
  ]);

  const handleRefresh = useCallback(() => {
    if (!canStartExplore) return;
    if (refreshing) return;

    setRefreshingState(true);
    requestCacheRef.current += 1;
    setHasMore(true);
    untilRef.current = undefined;
    prevPaginationSubIdRef.current = null;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    clearTimers();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    stopLiveSubscription();
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    startRootSubscription();
    startLiveSubscription();
  }, [
    canStartExplore,
    clearTimers,
    refreshing,
    setRefreshingState,
    startLiveSubscription,
    startRootSubscription,
    stopLiveSubscription,
  ]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || itemsRef.current.length === 0) return;

    setLoadingState(true);
    itemsBeforePaginationRef.current = itemsRef.current.length;
    paginationCounterRef.current += 1;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    if (lastItem) untilRef.current = lastItem.createdAt() - 1;
    const requests = requestList({ forPagination: true });

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
      setLoadingState(false);
      setHasMore(false);
    }
  }, [
    completeResolvingSubscription,
    feedKey,
    handleEvents,
    hasMore,
    loading,
    requestList,
    setLoadingState,
  ]);

  const resetFeedRef = useRef(resetFeed);
  const startLiveSubscriptionRef = useRef(startLiveSubscription);
  const startRootSubscriptionRef = useRef(startRootSubscription);
  const stopLiveSubscriptionRef = useRef(stopLiveSubscription);
  const stopRootSubscriptionRef = useRef(stopRootSubscription);

  useEffect(() => {
    resetFeedRef.current = resetFeed;
    startLiveSubscriptionRef.current = startLiveSubscription;
    startRootSubscriptionRef.current = startRootSubscription;
    stopLiveSubscriptionRef.current = stopLiveSubscription;
    stopRootSubscriptionRef.current = stopRootSubscription;
  }, [
    resetFeed,
    startLiveSubscription,
    startRootSubscription,
    stopLiveSubscription,
    stopRootSubscription,
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
  }, [allowGuestExplore, authReadyForExplore, enabled, visible]);

  useEffect(() => {
    if (!enabled) return;
    if (!visible || !canStartExplore) {
      stopRootSubscriptionRef.current();
      return;
    }

    resetFeedRef.current();
    startRootSubscriptionRef.current();
    startLiveSubscriptionRef.current();

    return () => {
      stopLiveSubscriptionRef.current();
      stopRootSubscriptionRef.current();
    };
  }, [canStartExplore, enabled, feedKey, followsReadyForExplore, visible]);

  const mergePendingItems = useCallback(() => {
    const deferred = deferredNewItemsRef.current;
    if (deferred.length > 0) {
      deferredNewItemsRef.current = [];
      itemsRef.current = [...itemsRef.current, ...deferred].sort(
        (left, right) => right.createdAt() - left.createdAt(),
      );
      setItemsVersion(version => version + 1);
    }
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
        onChromeVisibilityChange={onChromeVisibilityChange}
        empty={empty}
        contentContainerClassName="pb-28"
      />
    </View>
  );
}

function ExploreComposerFooter() {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openPost = useCallback(() => navigation.navigate('Post'), [navigation]);

  return (
    <View className="items-end px-4">
      <Pressable
        hitSlop={8}
        onPress={openPost}
        style={[
          styles.composerButton,
          {
            backgroundColor: `${theme.colors.primary}4D`,
            borderColor: `${theme.colors.primary}CC`,
          },
        ]}
      >
        <BlurView
          intensity={36}
          tint="dark"
          style={[
            styles.composerBlur,
            { backgroundColor: `${theme.colors.primary}26` },
          ]}
        >
          <PenLine size={17} color="#ffffff" strokeWidth={2.1} />
          <Text style={[styles.composerText, { color: '#ffffff' }]}>
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
  setSelectedKinds,
  selectedPacks,
  showKindIndicators = true,
  showKindSelector = false,
  surfaceClassName,
}: {
  mini?: boolean;
  pubkey: string | null;
  relayStatuses: Record<string, string>;
  relays: string[];
  selectedKinds: FeedKind[];
  setSelectedKinds: (kinds: FeedKind[]) => void;
  selectedPacks: FeedPackSelection[];
  showKindIndicators?: boolean;
  showKindSelector?: boolean;
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
            : `rounded-lg bg-base-300/90 px-3 pt-3 shadow-sm ${
                showKindSelector ? 'pb-0' : 'pb-3'
              }`
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
            <ExploreScopeToggle packs={selectedPacks} />
            {showKindIndicators ? (
              <FeedKindHeaderButtons
                kinds={showKindSelector ? [] : visibleKinds}
                surfaceClassName={surfaceClassName}
              />
            ) : null}
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
        {showKindSelector ? (
          <View className="mt-4">
            <ExploreKindSelector
              selectedKinds={selectedKinds}
              onSelectKinds={setSelectedKinds}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function sameKinds(left: FeedKind[], right: FeedKind[]) {
  if (left.length !== right.length) return false;
  return left.every((kind, index) => kind === right[index]);
}

function selectedExploreKindTab(selectedKinds: FeedKind[]): ExploreKindTabId {
  if (
    selectedKinds.length === 0 ||
    sameKinds(selectedKinds, ALL_FEED_KINDS)
  ) {
    return 'all';
  }

  return (
    EXPLORE_KIND_TABS.find(tab =>
      tab.kinds ? sameKinds(selectedKinds, tab.kinds) : false,
    )?.id ?? 'all'
  );
}

function ExploreKindSelector({
  selectedKinds,
  onSelectKinds,
}: {
  selectedKinds: FeedKind[];
  onSelectKinds: (kinds: FeedKind[]) => void;
}) {
  const selectedId = selectedExploreKindTab(selectedKinds);

  return (
    <View className="w-full">
      <ExploreSegmentedTabs
        tabs={EXPLORE_KIND_TABS}
        selectedId={selectedId}
        onSelect={id => {
          const tab = EXPLORE_KIND_TABS.find(item => item.id === id);
          onSelectKinds(tab?.kinds ?? []);
        }}
      />
    </View>
  );
}

function ExploreSegmentedTabs<T extends string>({
  tabs,
  selectedId,
  onSelect,
}: {
  tabs: Array<{id: T; label: string}>;
  selectedId: T;
  onSelect: (id: T) => void;
}) {
  const [tabLayouts, setTabLayouts] = useState<
    Partial<Record<T, {x: number; width: number}>>
  >({});
  const underlineX = useRef(new RNAnimated.Value(0)).current;
  const underlineWidth = useRef(new RNAnimated.Value(0)).current;
  const selectedLayout = tabLayouts[selectedId];

  const handleTabLayout = useCallback(
    (id: T, event: LayoutChangeEvent) => {
      const {x, width} = event.nativeEvent.layout;
      setTabLayouts(current => {
        const previous = current[id];
        if (
          previous &&
          Math.abs(previous.x - x) < 0.5 &&
          Math.abs(previous.width - width) < 0.5
        ) {
          return current;
        }
        return {...current, [id]: {x, width}};
      });
    },
    [],
  );

  useEffect(() => {
    if (!selectedLayout) return;
    RNAnimated.parallel([
      RNAnimated.timing(underlineX, {
        toValue: selectedLayout.x,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      RNAnimated.timing(underlineWidth, {
        toValue: selectedLayout.width,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [selectedLayout, underlineWidth, underlineX]);

  return (
    <View className="relative w-full">
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row"
      >
        <RNAnimated.View
          className="absolute bottom-0 left-0 h-0.5 rounded-full bg-primary"
          style={{
            width: underlineWidth,
            transform: [{translateX: underlineX}],
          }}
        />
        {tabs.map(tab => {
          const selected = tab.id === selectedId;
          return (
            <Pressable
              key={tab.id}
              accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${tab.label}`}
              accessibilityState={{selected}}
              className="h-11 min-w-20 items-center justify-center px-3 pb-2 pt-1"
              onLayout={event => handleTabLayout(tab.id, event)}
              onPress={() => {
                if (!selected) onSelect(tab.id);
              }}
            >
              <Text
                className={`text-base font-semibold ${
                  selected ? 'text-base-content' : 'text-base-content/60'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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

function HeaderSearchButton({
  surfaceClassName,
}: {
  surfaceClassName: string;
}) {
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

function ExploreScopeToggle({
  packs,
}: {
  packs: FeedPackSelection[];
}) {
  const theme = useAppTheme();
  const follows = useNostrStore(state => state.follows);
  const kind3UpdatedAt = useNostrStore(state => state.kind3UpdatedAt);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const applySelection = useFeedBuilderStore(state => state.applySelection);
  const clearPacks = useFeedBuilderStore(state => state.clearPacks);
  const contactsSelected = packs.some(pack => pack.id === 'followlist');
  const label = contactsSelected ? 'Contacts' : 'Everyone';
  const accessibilityLabel = contactsSelected
    ? 'Showing contacts. Switch to everyone.'
    : 'Showing everyone. Switch to contacts.';

  const toggleScope = useCallback(() => {
    if (contactsSelected) {
      clearPacks();
      return;
    }
    applySelection(selectedKinds, [
      {
        id: 'followlist',
        kind: 39089,
        title: 'Follow List',
        description: 'People you follow',
        image: null,
        localImage: 'followlist',
        people: kind3UpdatedAt > 0 ? follows : [],
        dTag: 'followlist',
      },
    ]);
  }, [applySelection, clearPacks, contactsSelected, follows, kind3UpdatedAt, selectedKinds]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="min-w-0 flex-row items-center gap-1"
      hitSlop={12}
      onPress={toggleScope}
    >
      <Text className="text-2xl font-semibold text-base-content">
        {label}
      </Text>
      <ChevronDown
        size={19}
        color={theme.colors.primaryContent}
        strokeWidth={2.2}
      />
    </Pressable>
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
