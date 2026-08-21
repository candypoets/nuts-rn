import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useNavigation } from 'expo-router/react-navigation';
import type {
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  createPaginatedSubscription,
  type PaginatedSubscription,
} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asKind20,
  asKind22,
  asKind6,
  asParsedEvent,
  asPreGeneric,
  fbArray,
} from '@candypoets/nipworker/utils';
import { ComposerFooter } from '../components/ComposerFooter';
import { Feed, FeedHeaderDynamic, FeedSticky } from '../components/Feed';
import {
  FeedKindNavigator,
  type FeedKindTabId,
} from '../components/FeedKindNavigator';
import { NotificationBellButton } from '../components/NotificationBellButton';
import {ExploreKindSwipe} from '../components/ExploreKindSwipe';
import { Note } from '../components/notes/Note';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { FEED_PAGE_WINDOW_SECONDS } from '../nostr/pagination';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
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
  scrollToTopKey?: number;
  visible: boolean;
  screenActive?: boolean;
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
const MEDIA_GRID_COLUMNS = 2;
const MEDIA_TILE_HEIGHT = 286;
const MAX_NEW_NOTE_AVATARS = 3;
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
  scrollToTopKey: tabScrollToTopKey,
  visible,
  screenActive = visible,
  header,
  stickyFooter,
  onChromeVisibilityChange,
}: ExploreFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const requestCacheRef = useRef(0);
  const authFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const commitFrameRef = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  const feedSubscriptionRef = useRef<PaginatedSubscription | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const heldNewItemsRef = useRef<ParsedEvent[]>([]);
  const subscriptionResolvingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newNotes, setNewNotes] = useState<NewNotesState>(EMPTY_NEW_NOTES);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [scrollToTopKey, setScrollToTopKey] = useState<number | undefined>();
  const combinedScrollToTopKey =
    tabScrollToTopKey === undefined && scrollToTopKey === undefined
      ? undefined
      : `${tabScrollToTopKey ?? 0}:${scrollToTopKey ?? 0}`;
  const [allowGuestExplore, setAllowGuestExplore] = useState(false);
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
  const requestKindSet = useMemo(
    () => new Set<number>(requestKinds),
    [requestKinds],
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

  const defaultStickyFooter = useCallback(() => <ExploreComposerFooter />, []);

  const clearTimers = useCallback(() => {
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
      requestKinds.length > 0 ? requestKindSet.has(kind) : true,
    [requestKindSet, requestKinds.length],
  );

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
    setLoading(next);
  }, []);

  const setRefreshingState = useCallback((next: boolean) => {
    refreshingRef.current = next;
    setRefreshing(next);
  }, []);

  const resetItems = useCallback(() => {
    itemsRef.current = [];
    seenIdsRef.current.clear();
    pendingItemsRef.current = [];
    heldNewItemsRef.current = [];
    setNewNotes(EMPTY_NEW_NOTES);
    setItemsVersion(version => version + 1);
  }, []);

  const stopRootSubscription = useCallback(
    (clearLoading = true) => {
      subscriptionResolvingRef.current = false;
      pendingItemsRef.current = [];
      heldNewItemsRef.current = [];
      if (clearLoading) {
        setLoadingState(false);
        setRefreshingState(false);
      }
      feedSubscriptionRef.current?.close();
      feedSubscriptionRef.current = null;
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
  }, [commitPendingItems, setLoadingState, setRefreshingState]);

  const addItem = useCallback(
    (parsedEvent: ParsedEvent) => {
      const id = parsedEvent.id();
      if (!id || seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      const topItemCreatedAt = itemsRef.current[0]?.createdAt();
      if (
        !subscriptionResolvingRef.current &&
        topItemCreatedAt !== undefined &&
        parsedEvent.createdAt() > topItemCreatedAt
      ) {
        // Live post: hold it back instead of prepending it mid-read. The
        // "N more posts" header control merges held posts on demand.
        heldNewItemsRef.current.push(parsedEvent);
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
        return;
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
      setHeaderScrolled(start > 0);
    },
    [],
  );

  const handleNewNotesPress = useCallback(() => {
    pendingItemsRef.current = [
      ...heldNewItemsRef.current,
      ...pendingItemsRef.current,
    ];
    heldNewItemsRef.current = [];
    commitPendingItems();
    setNewNotes(EMPTY_NEW_NOTES);
    setScrollToTopKey(key => (key ?? 0) + 1);
  }, [commitPendingItems]);

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
        newNotes={newNotes}
        showNewNotesPill={headerScrolled}
        onNewNotesPress={handleNewNotesPress}
      />
    ),
    [
      authPubkey,
      exploreAudienceMode,
      feedRelays,
      handleNewNotesPress,
      headerScrolled,
      newNotes,
      relaySelectionSubId,
      relayStatuses,
      selectedKinds,
      setExploreAudienceMode,
      setSelectedKinds,
    ],
  );

  const handleEvents = useCallback(
    (message: WorkerMessage): number | undefined => {
      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) {
          setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        }

        return undefined;
      }

      const parsed = asParsedEvent(message);
      if (!parsed) return undefined;

      const kind = parsed.kind();
      const id = parsed.id();
      if (!shouldIncludeKind(kind)) {
        return undefined;
      }

      if (kind === 1 || kind === 6) {
        const kind1 = asKind1(parsed);
        if (kind1) {
          const reply = kind1.reply()?.id();
          const root = kind1.root()?.id();
          if (reply && !root) {
            return undefined;
          }
          if (reply && root && reply !== root) {
            return undefined;
          }
        }

        if (kind === 6) {
          const kind6 = asKind6(parsed);
          const repostedEvent = kind6?.repostedEvent();
          if (
            !repostedEvent ||
            !REPOSTABLE_FEED_KINDS.has(repostedEvent.kind())
          ) {
            return undefined;
          }
        }
      } else if (kind === 20) {
        const kind20 = asKind20(parsed);
        if (kind20) {
          const images = fbArray(kind20, 'images');
          if (images.some(img => !img.dim())) {
            return undefined;
          }
        }
      }

      if (!id) {
        return undefined;
      }
      if (seenIdsRef.current.has(id)) {
        return undefined;
      }

      addItem(parsed);
      return parsed.createdAt();
    },
    [addItem, setRelayStatus, shouldIncludeKind],
  );

  const startRootSubscription = useCallback(() => {
    setLoadingState(itemsRef.current.length === 0);
    const requests = requestList();
    if (!requests.length) {
      setLoadingState(false);
      setRefreshingState(false);
      return;
    }

    subscriptionResolvingRef.current = false;
    feedSubscriptionRef.current?.close();
    const rootSubId = `${baseSubId}_${relayKey}_${requestCacheRef.current}`;
    pendingItemsRef.current = [];
    subscriptionResolvingRef.current = true;
    setSubRelays(relaySelectionSubId, feedRelays.map(normalizeRelayUrl));
    feedRelays.forEach(relay => {
      setRelayStatus(normalizeRelayUrl(relay), 'SUBSCRIBED');
    });
    feedSubscriptionRef.current = createPaginatedSubscription({
      subId: rootSubId,
      requests,
      pageRequests: requestList({ forPagination: true }),
      windowSeconds: FEED_PAGE_WINDOW_SECONDS,
      maxEmptyPages: 3,
      rootTimeoutMs: 1500,
      initialLoading: itemsRef.current.length === 0,
      onMessage: handleEvents,
      onStateChange: state => {
        if (state.loading) {
          // Batch commits behind relay resolution only for the initial load
          // and pull-to-refresh; pagination pages render progressively as
          // events arrive instead of appearing in one batch on settle.
          if (itemsRef.current.length === 0 || refreshingRef.current) {
            subscriptionResolvingRef.current = true;
          }
          setLoadingState(true);
          return;
        }
        if (subscriptionResolvingRef.current) {
          completeResolvingSubscription();
          return;
        }
        setLoadingState(false);
      },
      options: { bytesPerEvent: 10 * 1024 },
    });
    feedSubscriptionRef.current.start();
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
    // Held posts are already in seenIds, so the refreshed subscription will
    // not re-deliver them; fold them into the pending batch instead.
    pendingItemsRef.current = heldNewItemsRef.current;
    heldNewItemsRef.current = [];
    commitPendingItems();
    setNewNotes(EMPTY_NEW_NOTES);
    subscriptionResolvingRef.current = false;
    clearTimers();
    feedSubscriptionRef.current?.close();
    feedSubscriptionRef.current = null;
    startRootSubscription();
  }, [
    canStartExplore,
    clearTimers,
    commitPendingItems,
    refreshing,
    setRefreshingState,
    startRootSubscription,
  ]);

  const handleNearBottom = useCallback(() => {
    if (loading || itemsRef.current.length === 0) return;
    pendingItemsRef.current = [];
    feedSubscriptionRef.current?.loadMore();
  }, [loading]);

  const resetFeedRef = useRef(resetFeed);
  const startRootSubscriptionRef = useRef(startRootSubscription);
  const stopRootSubscriptionRef = useRef(stopRootSubscription);

  useEffect(() => {
    resetFeedRef.current = resetFeed;
    startRootSubscriptionRef.current = startRootSubscription;
    stopRootSubscriptionRef.current = stopRootSubscription;
  }, [resetFeed, startRootSubscription, stopRootSubscription]);

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
    <ExploreKindSwipe
      enabled={enabled && visible}
      selectedKinds={selectedKinds}
      tabs={EXPLORE_KIND_TABS}
      onSelectKinds={setSelectedKinds}
    >
      <View className="flex-1">
        <Feed
          items={itemsRef.current}
          scrollToTopKey={combinedScrollToTopKey}
          getItemId={getItemId}
          motionHeader={listHeader}
          motionHeaderPressToTop
          pullToRefresh
          headerSafeArea
          headerOwnsSafeArea
          stickyFooter={stickyFooter ?? defaultStickyFooter}
          renderItem={renderItem}
          visible={visible}
          screenActive={screenActive}
          loading={loading || refreshing}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onNearBottom={handleNearBottom}
          nearBottomThreshold={1600}
          onViewportStateChange={handleViewportStateChange}
          onChromeVisibilityChange={onChromeVisibilityChange}
          empty={empty}
          contentContainerClassName="pb-44"
          numColumns={mediaGrid ? MEDIA_GRID_COLUMNS : 1}
          columnWrapperStyle={mediaGrid ? styles.mediaGridColumns : undefined}
        />
      </View>
    </ExploreKindSwipe>
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
  const navigation = useNavigation<AppNavigationProp>();
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
        <NativeMediaViewer
          note={note}
          relays={relays}
          visible={visible}
          links={links}
          containerWidth={tileWidth}
          height={MEDIA_TILE_HEIGHT}
          style={styles.mediaTileNativeViewer}
        />
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
  return <ComposerFooter bottomOffset={8} floating={false} />;
}

function NewNotesButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const theme = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} more ${count === 1 ? 'post' : 'posts'}`}
      accessibilityHint="Show the latest posts"
      className="mt-1 flex-row items-center justify-center gap-1 px-3 pb-2 pt-1"
      onPress={event => {
        event.stopPropagation();
        onPress();
      }}
    >
      <ChevronUp size={14} color={theme.colors.primary} strokeWidth={2.4} />
      <Text className="text-sm font-semibold text-primary">
        {count} more {count === 1 ? 'post' : 'posts'}
      </Text>
    </Pressable>
  );
}

function NewNotesAvatarButton({
  newNotes,
  onPress,
}: {
  newNotes: NewNotesState;
  onPress: () => void;
}) {
  const theme = useAppTheme();

  if (!newNotes.count || !newNotes.pubkeys.length) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${newNotes.count} more ${
        newNotes.count === 1 ? 'note' : 'notes'
      }`}
      accessibilityHint="Show the latest notes"
      onPress={event => {
        event.stopPropagation();
        onPress();
      }}
      className="h-12 flex-row items-center justify-center gap-2 rounded-full border border-base-200 bg-base-100 px-3 shadow-lg"
    >
      <ChevronUp size={14} color={theme.colors.primary} strokeWidth={2.4} />
      <View className="flex-row items-center">
        {newNotes.pubkeys.map((newNotePubkey, index) => (
          <View
            key={newNotePubkey}
            className={index === 0 ? '' : '-ml-3'}
            style={{ zIndex: newNotes.pubkeys.length - index }}
          >
            <Avatar pubkey={newNotePubkey} size="md" />
          </View>
        ))}
      </View>
    </Pressable>
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
  newNotes,
  showNewNotesPill,
  onNewNotesPress,
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
  newNotes: NewNotesState;
  showNewNotesPill: boolean;
  onNewNotesPress: () => void;
}) {
  const visibleKinds =
    selectedKinds.length > 0 && selectedKinds.length < ALL_FEED_KINDS.length
      ? selectedKinds
      : [];
  const showStickyNewNotes =
    showKindSelector &&
    showNewNotesPill &&
    newNotes.count > 0 &&
    newNotes.pubkeys.length > 0;

  return (
    <View className="border-b border-base-200 bg-transparent">
      <FeedSticky>
        <View className="relative" pointerEvents="box-none">
          <View
            className="px-3 pb-2"
            style={
              safeAreaTop > 0 ? { paddingTop: safeAreaTop + 8 } : undefined
            }
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
                {pubkey ? (
                  <NotificationBellButton
                    className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
                  />
                ) : null}
                <HeaderProfileButton
                  pubkey={pubkey}
                  className={`h-9 w-9 border-base-200 ${surfaceClassName}`}
                />
              </View>
            </View>
          </View>
          {showStickyNewNotes ? (
            <View
              className="absolute left-0 right-0 z-40 items-center"
              pointerEvents="box-none"
              style={{ top: safeAreaTop + 64 + 48 }}
            >
              <NewNotesAvatarButton
                newNotes={newNotes}
                onPress={onNewNotesPress}
              />
            </View>
          ) : null}
        </View>
      </FeedSticky>
      <FeedHeaderDynamic>
        <View className={`px-3 pt-2 ${showKindSelector ? 'pb-0' : 'pb-3'}`}>
          <HeaderRelaysList
            subId={relaySelectionSubId}
            relays={relays}
            statuses={relayStatuses}
          />
        </View>
      </FeedHeaderDynamic>
      {showKindSelector ? (
        <View className="relative px-3 pt-4">
          <FeedKindNavigator
            selectedKinds={selectedKinds}
            onSelectKinds={setSelectedKinds}
            tabs={EXPLORE_KIND_TABS}
          />
        </View>
      ) : null}
      {!showNewNotesPill && newNotes.count > 0 ? (
        <NewNotesButton count={newNotes.count} onPress={onNewNotesPress} />
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
  const navigation = useNavigation<AppNavigationProp>();

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
          onPress={event => {
            event.stopPropagation();
            openFeedBuilder();
          }}
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
  const navigation = useNavigation<AppNavigationProp>();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      className={`h-9 w-9 items-center justify-center rounded-full border border-base-200 ${surfaceClassName}`}
      hitSlop={12}
      onPress={event => {
        event.stopPropagation();
        navigation.navigate('CmdK');
      }}
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
      onPress={event => {
        event.stopPropagation();
        toggleScope();
      }}
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
