import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { ComposerFooter } from '../components/ComposerFooter';
import { Feed } from '../components/Feed';
import {
  FeedKindNavigator,
  type FeedKindTabId,
} from '../components/FeedKindNavigator';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { Note } from '../components/notes';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { ChevronDown, Search } from 'lucide-react-native';
import {
  ALL_FEED_KINDS,
  KIND_LABELS,
  type FeedKind,
  type ExploreAudienceMode,
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
const APP_FOOTER_HEIGHT = 56;
const EXPLORE_KIND_TABS: Array<{
  id: FeedKindTabId;
  label: string;
  kinds?: FeedKind[];
}> = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes', kinds: [1, 6] },
  { id: 'articles', label: 'Articles', kinds: [30023] },
  { id: 'polls', label: 'Polls', kinds: [1068] },
  { id: 'media', label: 'Media', kinds: [20, 22] },
  { id: 'events', label: 'Events', kinds: [30311] },
];

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
  const rootSubIdRef = useRef<string | null>(null);
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
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [allowGuestExplore, setAllowGuestExplore] = useState(false);
  const loadingRef = useRef(false);
  const refreshingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const setSelectedKinds = useFeedBuilderStore(state => state.setSelectedKinds);
  const exploreAudienceMode = useFeedBuilderStore(
    state => state.exploreAudienceMode,
  );
  const setExploreAudienceMode = useFeedBuilderStore(
    state => state.setExploreAudienceMode,
  );
  const feedBuilderHydrated = useFeedBuilderStore(state => state.hydrated);
  const authPubkey = useAuthStore(state => state.pubkey);
  const authResolved = useAuthStore(state => state.authResolved);
  const readRelays = useNostrStore(state => state.readRelays);
  const relayDirectoryUrls = useNostrStore(state => state.relayDirectoryUrls);
  const follows = useNostrStore(state => state.follows);
  const kind3UpdatedAt = useNostrStore(state => state.kind3UpdatedAt);
  const nostrHydrated = useNostrStore(state => state.hydrated);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const relaySubs = useRelayStore(state => state.relaySubs);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const relaySelectionSubId = `feed${exploreAudienceMode}`;
  const selectedSubRelays = relaySubs[relaySelectionSubId];
  const requestKinds = useMemo(
    () => (selectedKinds.length ? selectedKinds : ALL_FEED_KINDS),
    [selectedKinds],
  );
  const requestAuthors = useMemo(
    () => (exploreAudienceMode === 'contacts' ? follows : []),
    [exploreAudienceMode, follows],
  );
  const accountRelays = useMemo(
    () =>
      relayDirectoryUrls.length
        ? relayDirectoryUrls
        : readRelays.length
        ? readRelays
        : DEFAULT_FEED_RELAYS,
    [readRelays, relayDirectoryUrls],
  );
  const feedRelays = useMemo(() => {
    const relays =
      selectedSubRelays ?? (authPubkey ? accountRelays : GUEST_EXPLORE_RELAYS);
    return relays.map(normalizeRelayUrl).filter(Boolean);
  }, [accountRelays, authPubkey, selectedSubRelays]);
  const authReadyForExplore = Boolean(authPubkey) || authResolved;
  const followsReadyForExplore =
    exploreAudienceMode !== 'contacts' || kind3UpdatedAt > 0;
  const canStartExplore =
    feedBuilderHydrated &&
    nostrHydrated &&
    followsReadyForExplore &&
    (authReadyForExplore || allowGuestExplore);
  const feedRelayKey = feedRelays.join('|');
  const relayKey = `${feedRelays.length}_${hashKey(feedRelayKey)}`;
  const contactFeedKey =
    exploreAudienceMode === 'contacts'
      ? `${kind3UpdatedAt > 0 ? 'kind3-ready' : 'kind3-pending'}${hashKey(
          requestAuthors.join(','),
        )}`
      : '';
  const baseSubId = `feed${exploreAudienceMode}${contactFeedKey}${selectedKinds.join(
    ',',
  )}`;
  const feedKey = useMemo(
    () => `${baseSubId}_${relayKey}`,
    [baseSubId, relayKey],
  );
  const [, setItemsVersion] = useState(0);

  const defaultHeader = useCallback(
    ({ safeAreaTop = 0 } = { safeAreaTop: 0 }) => (
      <ExploreHeader
        safeAreaTop={safeAreaTop}
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        setSelectedKinds={setSelectedKinds}
        audienceMode={exploreAudienceMode}
        setAudienceMode={setExploreAudienceMode}
        relaySelectionSubId={relaySelectionSubId}
        showKindSelector
        surfaceClassName="bg-base-100"
      />
    ),
    [
      authPubkey,
      feedRelays,
      exploreAudienceMode,
      relayStatuses,
      relaySelectionSubId,
      selectedKinds,
      setExploreAudienceMode,
      setSelectedKinds,
    ],
  );

  const defaultStickyHeader = useCallback(
    ({ safeAreaTop = 0 } = { safeAreaTop: 0 }) => (
      <ExploreHeader
        safeAreaTop={safeAreaTop}
        pubkey={authPubkey}
        relays={feedRelays}
        relayStatuses={relayStatuses}
        selectedKinds={selectedKinds}
        setSelectedKinds={setSelectedKinds}
        audienceMode={exploreAudienceMode}
        setAudienceMode={setExploreAudienceMode}
        relaySelectionSubId={relaySelectionSubId}
        showKindIndicators={false}
        showKindSelector
        showRelayList={false}
        surfaceClassName="bg-base-100"
      />
    ),
    [
      authPubkey,
      feedRelays,
      exploreAudienceMode,
      relayStatuses,
      relaySelectionSubId,
      selectedKinds,
      setExploreAudienceMode,
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
      if (
        exploreAudienceMode === 'contacts' &&
        (kind3UpdatedAt <= 0 || requestAuthors.length === 0)
      ) {
        return [];
      }
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
          noCache: true,
          relays: feedRelays,
        },
      ];
    },
    [
      exploreAudienceMode,
      feedRelays,
      kind3UpdatedAt,
      requestAuthors,
      requestKinds,
    ],
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
    untilRef.current = undefined;
    paginationCounterRef.current = 0;
    setHasMore(true);
    itemsBeforePaginationRef.current = 0;
    prevPaginationSubIdRef.current = null;
    rootSubIdRef.current = null;
    pendingItemsRef.current = [];
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
      rootSubIdRef.current = null;
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

    itemsRef.current = [...itemsRef.current, ...pending].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    setItemsVersion(version => version + 1);
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
    rootSubIdRef.current = `${baseSubId}_${relayKey}_${requestCacheRef.current}`;
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    setSubRelays(relaySelectionSubId, feedRelays.map(normalizeRelayUrl));
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
    baseSubId,
    feedRelays,
    handleEvents,
    requestList,
    relayKey,
    relaySelectionSubId,
    setRelayStatus,
    setSubRelays,
    setLoadingState,
    setRefreshingState,
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
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    startRootSubscription();
  }, [
    canStartExplore,
    clearTimers,
    refreshing,
    setRefreshingState,
    startRootSubscription,
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
      const pageSubId = `${baseSubId}_${relayKey}_page_${paginationCounterRef.current}_${untilRef.current}`;
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
    baseSubId,
    completeResolvingSubscription,
    handleEvents,
    hasMore,
    loading,
    relayKey,
    requestList,
    setLoadingState,
  ]);

  const resetFeedRef = useRef(resetFeed);
  const startRootSubscriptionRef = useRef(startRootSubscription);
  const stopRootSubscriptionRef = useRef(stopRootSubscription);

  useEffect(() => {
    resetFeedRef.current = resetFeed;
    startRootSubscriptionRef.current = startRootSubscription;
    stopRootSubscriptionRef.current = stopRootSubscription;
  }, [resetFeed, startRootSubscription, stopRootSubscription]);

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

    return () => {
      stopRootSubscriptionRef.current();
    };
  }, [canStartExplore, enabled, feedKey, followsReadyForExplore, visible]);

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
        headerOwnsSafeArea
        stickyFooter={stickyFooter ?? defaultStickyFooter}
        renderItem={renderItem}
        loading={loading || refreshing}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onNearBottom={handleNearBottom}
        onChromeVisibilityChange={onChromeVisibilityChange}
        empty={empty}
        contentContainerClassName="pb-44"
      />
    </View>
  );
}

function ExploreComposerFooter() {
  return (
    <ComposerFooter bottomOffset={APP_FOOTER_HEIGHT + 8} floating={false} />
  );
}

function ExploreHeader({
  mini = false,
  safeAreaTop = 0,
  pubkey,
  relayStatuses,
  relays,
  selectedKinds,
  setSelectedKinds,
  audienceMode,
  setAudienceMode,
  relaySelectionSubId,
  showKindIndicators = true,
  showKindSelector = false,
  showRelayList = true,
  surfaceClassName,
}: {
  mini?: boolean;
  safeAreaTop?: number;
  pubkey: string | null;
  relayStatuses: Record<string, string>;
  relays: string[];
  selectedKinds: FeedKind[];
  setSelectedKinds: (kinds: FeedKind[]) => void;
  audienceMode: ExploreAudienceMode;
  setAudienceMode: (mode: ExploreAudienceMode) => void;
  relaySelectionSubId: string;
  showKindIndicators?: boolean;
  showKindSelector?: boolean;
  showRelayList?: boolean;
  surfaceClassName: string;
}) {
  const visibleKinds =
    selectedKinds.length > 0 && selectedKinds.length < ALL_FEED_KINDS.length
      ? selectedKinds
      : [];

  return (
    <View
      className={
        mini ? 'border-b border-base-200 bg-base-100/95' : 'bg-base-100'
      }
      style={mini && safeAreaTop > 0 ? { paddingTop: safeAreaTop } : undefined}
    >
      <View
        className={
          mini
            ? 'h-12 flex-row items-center justify-between'
            : `rounded-lg bg-base-300/90 px-3 pt-3 shadow-sm ${
                showKindSelector ? 'pb-0' : 'pb-3'
              }`
        }
        style={
          !mini && safeAreaTop > 0
            ? { paddingTop: safeAreaTop + 12 }
            : undefined
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
            <ExploreScopeToggle
              audienceMode={audienceMode}
              setAudienceMode={setAudienceMode}
            />
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
        {showRelayList ? (
          <HeaderRelaysList
            subId={relaySelectionSubId}
            relays={relays}
            statuses={relayStatuses}
            mini={mini}
          />
        ) : null}
        {showKindSelector ? (
          <View className="mt-4">
            <FeedKindNavigator
              selectedKinds={selectedKinds}
              onSelectKinds={setSelectedKinds}
              tabs={EXPLORE_KIND_TABS}
              deferSelection
            />
          </View>
        ) : null}
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
  audienceMode,
  setAudienceMode,
}: {
  audienceMode: ExploreAudienceMode;
  setAudienceMode: (mode: ExploreAudienceMode) => void;
}) {
  const theme = useAppTheme();
  const contactsSelected = audienceMode === 'contacts';
  const label = contactsSelected ? 'Contacts' : 'All';
  const accessibilityLabel = contactsSelected
    ? 'Showing contacts. Switch to everyone.'
    : 'Showing everyone. Switch to contacts.';

  const toggleScope = useCallback(() => {
    setAudienceMode(contactsSelected ? 'all' : 'contacts');
  }, [contactsSelected, setAudienceMode]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="min-w-0 flex-row items-center gap-1"
      hitSlop={12}
      onPress={toggleScope}
    >
      <Text className="text-2xl font-semibold text-base-content">{label}</Text>
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

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}
