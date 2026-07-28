import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useNavigation } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  asKind22,
  asKind6,
  asParsedEvent,
  asPreGeneric,
  ConnectionTracker,
  fbArray,
} from '@candypoets/nipworker/utils';
import { ComposerFooter } from '../components/ComposerFooter';
import { Feed, FeedHeaderDynamic, FeedSticky } from '../components/Feed';
import { getFeedTopInset } from '../components/feedLayout';
import {
  FeedKindNavigator,
  type FeedKindTabId,
} from '../components/FeedKindNavigator';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { Note } from '../components/notes/Note';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import {
  CalendarDays,
  ChevronDown,
  Play,
  Search,
  Users,
} from 'lucide-react-native';
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
import type { AppNavigationProp } from '../navigation/types';
import { useAppTheme } from '../theme';
import { FeedKindIcon } from '../components/FeedKindIcon';
import { Avatar } from '../components/notes/Avatar';
import { User } from '../components/notes/User';
import { useUIStore } from '../stores/uiStore';
import {
  eventTags,
  stringValue,
  tagValue,
} from '../components/notes/kindHelpers';
import {
  NativeMediaViewer,
  isNativeMediaViewerAvailable,
} from '../components/native/NativeMediaViewer';

type ExploreFeedProps = {
  enabled: boolean;
  visible: boolean;
  header?: () => React.ReactNode;
  stickyFooter?: () => React.ReactNode;
  onChromeVisibilityChange?: (visible: boolean) => void;
};

type ExploreCalendarEvent = {
  id: string;
  address: string;
  attendeeCount: number;
  capacity: number;
  description: string;
  image?: string;
  location: string;
  relays: string[];
  start: number;
  title: string;
};

type NewNotesState = {
  count: number;
  pubkeys: string[];
};

const GUEST_EXPLORE_RELAYS = [
  'wss://nostr.wine',
  'wss://pyramid.fiatjaf.com',
  'wss://nostr.mom',
];
const AUTH_FALLBACK_DELAY_MS = 1200;
const APP_FOOTER_HEIGHT = Platform.OS === 'android' ? 68 : 56;
const MEDIA_GRID_COLUMNS = 2;
const MEDIA_TILE_HEIGHT = 286;
const MAX_NEW_NOTE_AVATARS = 3;
const NEW_NOTES_WIDGET_HEIGHT = 40;
const EMPTY_NEW_NOTES: NewNotesState = { count: 0, pubkeys: [] };
const DEFAULT_EXPLORE_KINDS: FeedKind[] = [1, 6, 1068];
const REPOSTABLE_FEED_KINDS = new Set<number>([
  1, 20, 22, 1068, 30023, 30311, 31922, 31923,
]);
const EXPLORE_KIND_TABS: Array<{
  id: FeedKindTabId;
  label: string;
  kinds?: FeedKind[];
}> = [
  { id: 'notes', label: 'Notes', kinds: [1, 6, 1068] },
  { id: 'media', label: 'Media', kinds: [20, 22] },
  { id: 'articles', label: 'Articles', kinds: [30023] },
  { id: 'events', label: 'Events', kinds: [31922, 31923] },
];

function isLegacySeparatedNotesSelection(kinds: FeedKind[]) {
  return (
    (kinds.length === 1 && kinds[0] === 1068) ||
    (kinds.length === 2 && kinds.includes(1) && kinds.includes(6))
  );
}

export function ExploreFeed({
  enabled,
  visible,
  header,
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
  const paginationUnsubscribeTimeoutRef = useRef<ReturnType<
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
  const viewportStartRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newNotes, setNewNotes] = useState<NewNotesState>(EMPTY_NEW_NOTES);
  const [feedChromeVisible, setFeedChromeVisible] = useState(true);
  const [scrollToTopKey, setScrollToTopKey] = useState<number | undefined>();
  const [allowGuestExplore, setAllowGuestExplore] = useState(false);
  const insets = useSafeAreaInsets();
  const feedTopInset = getFeedTopInset(insets.top);
  const loadingRef = useRef(true);
  const refreshingRef = useRef(false);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const setSelectedKinds = useFeedBuilderStore(state => state.setSelectedKinds);
  const exploreAudienceMode = useFeedBuilderStore(
    state => state.exploreAudienceMode,
  );
  const setExploreAudienceMode = useFeedBuilderStore(
    state => state.setExploreAudienceMode,
  );
  const exploreRelays = useFeedBuilderStore(state => state.exploreRelays);
  const setExploreRelays = useFeedBuilderStore(state => state.setExploreRelays);
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
  const relaySelectionSubId = 'feedExplore';
  const selectedSubRelays = relaySubs[relaySelectionSubId];
  const requestKinds = useMemo(
    () =>
      selectedKinds.length && !isLegacySeparatedNotesSelection(selectedKinds)
        ? selectedKinds
        : DEFAULT_EXPLORE_KINDS,
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
      selectedSubRelays ??
      exploreRelays ??
      (authPubkey ? accountRelays : GUEST_EXPLORE_RELAYS);
    return relays.flatMap(relay => {
      const normalized = normalizeRelayUrl(relay);
      return normalized ? [normalized] : [];
    });
  }, [accountRelays, authPubkey, exploreRelays, selectedSubRelays]);
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
  const baseSubId = `feed${exploreAudienceMode}${contactFeedKey}${requestKinds.join(
    ',',
  )}`;
  const feedKey = useMemo(
    () => `${baseSubId}_${relayKey}`,
    [baseSubId, relayKey],
  );
  const [, setItemsVersion] = useState(0);
  const mediaGrid =
    selectedKinds.length === 2 &&
    selectedKinds.includes(20) &&
    selectedKinds.includes(22);
  const eventCards =
    selectedKinds.length === 2 &&
    selectedKinds.includes(31922) &&
    selectedKinds.includes(31923);
  const emptyNoun =
    EXPLORE_KIND_TABS.find(
      tab =>
        tab.kinds &&
        tab.kinds.length === selectedKinds.length &&
        tab.kinds.every(kind => selectedKinds.includes(kind)),
    )?.label.toLowerCase() ?? 'notes';

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
    if (paginationUnsubscribeTimeoutRef.current) {
      clearTimeout(paginationUnsubscribeTimeoutRef.current);
      paginationUnsubscribeTimeoutRef.current = null;
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

  useEffect(() => {
    if (!feedBuilderHydrated) return;
    if (selectedSubRelays === undefined) {
      if (exploreRelays !== null) {
        setSubRelays(relaySelectionSubId, exploreRelays);
      }
      return;
    }
    setExploreRelays(selectedSubRelays);
  }, [
    exploreRelays,
    feedBuilderHydrated,
    selectedSubRelays,
    setExploreRelays,
    setSubRelays,
  ]);

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
    setNewNotes(EMPTY_NEW_NOTES);
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
      const topItemCreatedAt = itemsRef.current[0]?.createdAt();
      if (
        viewportStartRef.current > 0 &&
        topItemCreatedAt !== undefined &&
        parsedEvent.createdAt() > topItemCreatedAt
      ) {
        const pubkey = parsedEvent.pubkey();
        setNewNotes(current => ({
          count: current.count + 1,
          pubkeys: pubkey
            ? [
                pubkey,
                ...current.pubkeys.filter(existing => existing !== pubkey),
              ].slice(0, MAX_NEW_NOTE_AVATARS)
            : current.pubkeys,
        }));
      }
      pendingItemsRef.current.push(parsedEvent);
      if (!subscriptionResolvingRef.current) {
        scheduleCommitPendingItems();
      }
    },
    [scheduleCommitPendingItems],
  );

  const handleViewportStateChange = useCallback(
    ({ start }: { start: number; down: boolean }) => {
      viewportStartRef.current = start;
      if (start === 0) {
        setNewNotes(EMPTY_NEW_NOTES);
      }
    },
    [],
  );

  const handleChromeVisibilityChange = useCallback(
    (nextVisible: boolean) => {
      setFeedChromeVisible(nextVisible);
      onChromeVisibilityChange?.(nextVisible);
    },
    [onChromeVisibilityChange],
  );

  const handleNewNotesPress = useCallback(() => {
    commitPendingItems();
    setNewNotes(EMPTY_NEW_NOTES);
    setScrollToTopKey(key => (key ?? 0) + 1);
  }, [commitPendingItems]);

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
          const repostedEvent = kind6?.repostedEvent();
          if (
            !repostedEvent ||
            !REPOSTABLE_FEED_KINDS.has(repostedEvent.kind())
          ) {
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
          pagination: prevPaginationSubIdRef.current ?? undefined,
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
          paginationUnsubscribeTimeoutRef.current = setTimeout(() => {
            paginationUnsubscribeTimeoutRef.current = null;
            unsubscribePaginationRef.current?.();
            unsubscribePaginationRef.current = null;
          }, 5000);
        }, 500);
      }
    }

    return () => {
      if (paginationCheckTimeoutRef.current) {
        clearTimeout(paginationCheckTimeoutRef.current);
        paginationCheckTimeoutRef.current = null;
      }
      if (paginationUnsubscribeTimeoutRef.current) {
        clearTimeout(paginationUnsubscribeTimeoutRef.current);
        paginationUnsubscribeTimeoutRef.current = null;
      }
    };
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
    ({ item, visible: itemVisible }: { item: ParsedEvent; visible: boolean }) =>
      mediaGrid ? (
        <MediaGridNote
          note={item}
          relays={feedRelays}
          visible={visible && itemVisible}
        />
      ) : eventCards ? (
        <ExploreEventCard note={item} relays={feedRelays} />
      ) : (
        <Note
          note={item}
          relays={feedRelays}
          visible={visible && itemVisible}
        />
      ),
    [eventCards, feedRelays, mediaGrid, visible],
  );
  const getItemId = useCallback(
    (item: ParsedEvent, index: number) => item.id() || `missing:${index}`,
    [],
  );
  const listHeader = header ?? defaultHeader;

  const empty = (
    <View className="items-center px-6 py-12">
      <Text className="text-center text-base font-semibold text-primary-content">
        No {emptyNoun} here yet
      </Text>
      <Text className="mt-2 max-w-72 text-center text-sm text-primary-content">
        Try another community relay or switch scope from contacts to all.
      </Text>
      {exploreAudienceMode === 'contacts' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch Explore feed scope to all"
          className="mt-5 rounded-full bg-primary px-5 py-2"
          onPress={() => setExploreAudienceMode('all')}
        >
          <Text className="text-sm font-semibold text-primary-content">
            Switch to all
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1">
      <Feed
        items={itemsRef.current}
        scrollToTopKey={scrollToTopKey}
        getItemId={getItemId}
        motionHeader={listHeader}
        pullToRefresh
        headerSafeArea
        headerOwnsSafeArea
        stickyFooter={stickyFooter ?? defaultStickyFooter}
        renderItem={renderItem}
        loading={loading || refreshing}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onNearBottom={handleNearBottom}
        onViewportStateChange={handleViewportStateChange}
        onChromeVisibilityChange={handleChromeVisibilityChange}
        empty={empty}
        contentContainerClassName="pb-44"
        numColumns={mediaGrid ? MEDIA_GRID_COLUMNS : 1}
        columnWrapperStyle={mediaGrid ? styles.mediaGridColumns : undefined}
      />
      {newNotes.count > 0 ? (
        <View
          className={`absolute left-0 right-0 z-40 items-center ${
            feedChromeVisible ? 'top-24' : 'top-3'
          }`}
          pointerEvents="box-none"
          style={{ paddingTop: feedTopInset + NEW_NOTES_WIDGET_HEIGHT }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${newNotes.count} more ${
              newNotes.count === 1 ? 'note' : 'notes'
            }`}
            accessibilityHint="Show the latest notes"
            onPress={handleNewNotesPress}
          >
            <View className="flex-row items-center rounded-full shadow-lg">
              {newNotes.pubkeys.map((pubkey, index) => (
                <View
                  key={pubkey}
                  className={index === 0 ? '' : '-ml-3'}
                  style={{ zIndex: newNotes.pubkeys.length - index }}
                >
                  <Avatar pubkey={pubkey} size="md" />
                </View>
              ))}
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

type MediaGridLink = {
  src: string;
  poster?: string;
  type: 'image' | 'video';
  blurhash?: string;
  dim?: string | null;
};

function parseExploreCalendarEvent(
  note: ParsedEvent,
  relays: string[],
): ExploreCalendarEvent | null {
  const kind = note.kind();
  if (kind !== 31922 && kind !== 31923) return null;
  const id = note.id();
  const pubkey = note.pubkey();
  const tags = eventTags(note);
  const pre = asPreGeneric(note);
  const d = stringValue(pre?.d()) || tagValue(tags, 'd');
  const startTag = tagValue(tags, 'start') || tagValue(tags, 'starts');
  const start =
    kind === 31922
      ? Math.floor(Date.parse(`${startTag}T00:00:00`) / 1000)
      : pre
      ? Number(pre.starts())
      : Number(startTag);
  if (!id || !pubkey || !d || !start) return null;

  const participants = pre ? fbArray(pre, 'participants') : [];
  const capacity = Number(tagValue(tags, 'capacity') || 0);
  const description =
    tagValue(tags, 'summary').trim() ||
    stringValue(pre?.description()).trim() ||
    stringValue(pre?.content()).trim();

  return {
    id,
    address: `${kind}:${pubkey}:${d}`,
    attendeeCount:
      Number(pre?.currentParticipants?.() ?? 0) || participants.length,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
    description,
    image: stringValue(pre?.image()) || tagValue(tags, 'image') || undefined,
    location: stringValue(pre?.location()) || tagValue(tags, 'location'),
    relays,
    start,
    title:
      stringValue(pre?.title()).trim() ||
      tagValue(tags, 'title').trim() ||
      tagValue(tags, 'name').trim() ||
      description ||
      'Community event',
  };
}

function formatEventMonth(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: 'short' })
    .format(new Date(timestamp * 1000))
    .toUpperCase();
}

function formatEventDay(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(
    new Date(timestamp * 1000),
  );
}

function formatEventTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function ExploreEventCard({
  note,
  relays,
}: {
  note: ParsedEvent;
  relays: string[];
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<AppNavigationProp>();
  const event = useMemo(
    () => parseExploreCalendarEvent(note, relays),
    [note, relays],
  );

  if (!event) return <Note note={note} />;

  const spotsLeft = event.capacity
    ? Math.max(0, event.capacity - event.attendeeCount)
    : null;

  return (
    <Pressable
      className="mx-3 mt-2 overflow-hidden rounded-lg border border-base-200 bg-base-300"
      onPress={() => {
        const relay = event.relays[0] || '';
        if (!relay || !event.address) return;
        navigation.navigate('CalendarEvent', { relay, address: event.address });
      }}
    >
      <View className="h-36 bg-base-200">
        {event.image ? (
          <Image
            source={{ uri: event.image }}
            style={styles.fill}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View className="h-full w-full items-center justify-center bg-base-200">
            <CalendarDays size={38} color={theme.colors.primary} />
          </View>
        )}
        <View className="absolute inset-0 bg-black/25" />
        <View className="absolute left-3 top-3 overflow-hidden rounded-md bg-white">
          <Text className="bg-base-300 px-2 py-1 text-center text-[10px] font-black uppercase text-base-content">
            {formatEventMonth(event.start)}
          </Text>
          <Text className="px-2 py-1 text-center text-xl font-black text-black">
            {formatEventDay(event.start)}
          </Text>
        </View>
      </View>

      <View className="p-3">
        <Text
          className="text-base font-bold text-base-content"
          numberOfLines={1}
        >
          {event.title}
        </Text>
        <Text
          className="mt-2 text-sm font-medium text-primary-content"
          numberOfLines={1}
        >
          {formatEventTime(event.start)}
        </Text>
        {event.location ? (
          <Text
            className="mt-1 text-sm font-medium text-primary-content"
            numberOfLines={1}
          >
            {event.location}
          </Text>
        ) : null}
        {event.description ? (
          <Text
            className="mt-2 text-sm leading-5 text-primary-content"
            numberOfLines={2}
          >
            {event.description}
          </Text>
        ) : null}
        <View className="mt-4 flex-row items-center">
          <View className="mr-2 h-6 w-6 items-center justify-center rounded-full bg-primary/20">
            <Users size={12} color={theme.colors.primary} />
          </View>
          <Text className="text-sm font-semibold text-primary">
            {event.attendeeCount} going
          </Text>
        </View>
        {spotsLeft !== null ? (
          <Text
            className={`mt-2 text-xs font-semibold ${
              spotsLeft ? 'text-primary-content' : 'text-error'
            }`}
            numberOfLines={1}
          >
            {spotsLeft ? `${spotsLeft} spots left` : 'Full'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function mediaEventData(note: ParsedEvent) {
  const kind20 = asKind20(note);
  const kind22 = asKind22(note);

  if (kind20) {
    const media = fbArray(kind20, 'images')
      .map(image => ({
        src: image.url() || '',
        poster: image.blurhash() || undefined,
        blurhash: image.blurhash() || undefined,
        dim: image.dim() || undefined,
        type: 'image' as const,
      }))
      .filter(item => item.src);
    return {
      media,
      title: kind20.title?.() || '',
      description: kind20.description?.() || '',
    };
  }

  if (kind22) {
    const media = fbArray(kind22, 'videos')
      .map(video => ({
        src: video.url() || '',
        poster: video.image() || undefined,
        blurhash: video.image() || undefined,
        dim: video.dim() || undefined,
        type: 'video' as const,
      }))
      .filter(item => item.src || item.poster);
    return {
      media,
      title: kind22.title?.() || '',
      description: kind22.description?.() || '',
    };
  }

  return { media: [] as MediaGridLink[], title: '', description: '' };
}

function MediaGridNoteComponent({
  note,
  relays,
  visible,
}: {
  note: ParsedEvent;
  relays: string[];
  visible: boolean;
}) {
  const { media } = useMemo(() => mediaEventData(note), [note]);
  const primary = media[0];
  const theme = useAppTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const pubkey = note.pubkey() || '';
  const links = useMemo(() => media.filter(item => item.src), [media]);
  const tileWidth = Math.max(160, viewportWidth / MEDIA_GRID_COLUMNS);
  const openNote = useCallback(() => {
    if (!links.length) return;
    setImageZoom({
      links: links.map(item => ({
        src: item.src,
        type: item.type,
        blurhash: item.blurhash,
        dim: item.dim,
      })),
      note,
      zoomed: 0,
    });
  }, [links, note, setImageZoom]);
  const overlayTextClassName =
    theme.id === 'snowwhite' ? 'text-neutral-950' : 'text-white';

  if (isNativeMediaViewerAvailable) {
    return (
      <View
        className="relative overflow-hidden bg-base-200"
        style={styles.mediaTile}
      >
        {visible ? (
          <NativeMediaViewer
            note={note}
            relays={relays}
            links={links}
            containerWidth={tileWidth}
            height={MEDIA_TILE_HEIGHT}
            style={styles.mediaTileNativeViewer}
          />
        ) : null}
        <View className="absolute bottom-0 left-0 right-0 px-1.5 py-1.5">
          <View className="min-w-0 flex-row items-center gap-2">
            <Avatar pubkey={pubkey} size="xxs" />
            <User
              pubkey={pubkey}
              className={`min-w-0 flex-1 text-[11px] font-semibold ${overlayTextClassName}`}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      className="relative overflow-hidden bg-base-200"
      style={styles.mediaTile}
      onPress={openNote}
    >
      <View className="relative h-full w-full bg-base-200">
        {visible && primary?.type === 'video' && primary.src ? (
          <MediaGridVideoPreview src={primary.src} poster={primary.poster} />
        ) : visible && primary ? (
          <Image
            source={{ uri: primary.poster || primary.src }}
            placeholder={
              primary.type === 'image' && primary.poster
                ? primary.poster
                : undefined
            }
            contentFit="cover"
            cachePolicy="memory-disk"
            style={styles.fill}
          />
        ) : null}
        {primary?.type === 'video' ? (
          <View className="absolute inset-0 items-center justify-center">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-black/55">
              <Play size={14} color="#ffffff" fill="#ffffff" />
            </View>
          </View>
        ) : null}
      </View>
      <View className="absolute bottom-0 left-0 right-0 px-1.5 py-1.5">
        <View className="min-w-0 flex-row items-center gap-2">
          <Avatar pubkey={pubkey} size="xxs" />
          <User
            pubkey={pubkey}
            className={`min-w-0 flex-1 text-[11px] font-semibold ${overlayTextClassName}`}
          />
        </View>
      </View>
    </Pressable>
  );
}

function MediaGridVideoPreview({
  poster,
  src,
}: {
  poster?: string;
  src: string;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const player = useVideoPlayer(src, nextPlayer => {
    nextPlayer.muted = true;
    nextPlayer.volume = 0;
    nextPlayer.loop = false;
    nextPlayer.showNowPlayingNotification = false;
    nextPlayer.staysActiveInBackground = false;
    nextPlayer.currentTime = 0;
    nextPlayer.pause();
  });

  useEffect(() => {
    setFirstFrameRendered(false);
    setPosterFailed(false);
    player.muted = true;
    player.volume = 0;
    player.currentTime = 0;
    player.pause();
  }, [player, src]);

  return (
    <>
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="cover"
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        useExoShutter={false}
        style={styles.fill}
        onFirstFrameRender={() => setFirstFrameRendered(true)}
      />
      {poster && !firstFrameRendered && !posterFailed ? (
        <Image
          source={{ uri: poster }}
          contentFit="cover"
          cachePolicy="memory-disk"
          style={styles.posterImage}
          onError={() => setPosterFailed(true)}
        />
      ) : null}
    </>
  );
}

const MediaGridNote = memo(
  MediaGridNoteComponent,
  (previous, next) =>
    previous.note.id() === next.note.id() &&
    previous.relays === next.relays &&
    previous.visible === next.visible,
);

function ExploreComposerFooter() {
  return (
    <ComposerFooter bottomOffset={APP_FOOTER_HEIGHT + 8} floating={false} />
  );
}

function ExploreHeader({
  safeAreaTop = 0,
  pubkey,
  relayStatuses,
  relays,
  selectedKinds,
  setSelectedKinds,
  audienceMode,
  setAudienceMode,
  relaySelectionSubId,
  showKindSelector = false,
  surfaceClassName,
}: {
  safeAreaTop?: number;
  pubkey: string | null;
  relayStatuses: Record<string, string>;
  relays: string[];
  selectedKinds: FeedKind[];
  setSelectedKinds: (kinds: FeedKind[]) => void;
  audienceMode: ExploreAudienceMode;
  setAudienceMode: (mode: ExploreAudienceMode) => void;
  relaySelectionSubId: string;
  showKindSelector?: boolean;
  surfaceClassName: string;
}) {
  const visibleKinds =
    selectedKinds.length > 0 && selectedKinds.length < ALL_FEED_KINDS.length
      ? selectedKinds
      : [];

  return (
    <View className="border-b border-base-200 bg-base-100">
      <FeedSticky>
        <View
          className="px-3 pb-2"
          style={safeAreaTop > 0 ? {paddingTop: safeAreaTop + 8} : undefined}
        >
          <View className="h-14 flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center gap-1">
              <ExploreScopeToggle
                audienceMode={audienceMode}
                setAudienceMode={setAudienceMode}
              />
              <FeedKindHeaderButtons
                kinds={showKindSelector ? [] : visibleKinds}
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
        </View>
      </FeedSticky>
      <FeedHeaderDynamic>
        <View
          className={`px-3 pt-2 ${showKindSelector ? 'pb-0' : 'pb-3'}`}
        >
          <HeaderRelaysList
            subId={relaySelectionSubId}
            relays={relays}
            statuses={relayStatuses}
          />
        </View>
      </FeedHeaderDynamic>
      {showKindSelector ? (
        <View className="px-3 pt-4">
          <FeedKindNavigator
            selectedKinds={selectedKinds}
            onSelectKinds={setSelectedKinds}
            tabs={EXPLORE_KIND_TABS}
          />
        </View>
      ) : null}
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
    useNavigation<AppNavigationProp>();

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
    useNavigation<AppNavigationProp>();

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

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
  mediaGridColumns: {
    flexDirection: 'row',
    columnGap: 0,
  },
  mediaTile: {
    height: MEDIA_TILE_HEIGHT,
  },
  mediaTileNativeViewer: {
    borderRadius: 0,
    marginBottom: 0,
  },
  posterImage: {
    ...StyleSheet.absoluteFill,
  },
});

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
