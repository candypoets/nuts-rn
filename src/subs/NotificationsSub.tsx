import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asParsedEvent,
  ConnectionTracker,
  fbArray,
} from '@candypoets/nipworker/utils';
import {
  AtSign,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Heart,
  MessageCircleReply,
  Repeat2,
} from 'lucide-react-native';
import {neventEncode} from 'nostr-tools/nip19';

import {Feed} from '../components/Feed';
import {Avatar, ContentBlocks, Note, User} from '../components/notes';
import {pushDistinct} from '../navigation/pushDistinct';
import type {RootStackParamList} from '../navigation/types';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {
  type ProcessedNotification,
  processNotifications,
} from '../notifications/processNotifications';
import {useAppStore, useAuthStore, useNostrStore} from '../stores';
import {useAppTheme} from '../theme';

const PAGE_LIMIT = 50;
const SHORT_PAGE_BACKFILL_ROWS = 25;
const MAX_SHORT_PAGE_BACKFILLS = 6;
const PAGINATION_TIMEOUT_MS = 10000;
const EOSE_FALLBACK_TIMEOUT_MS = 1000;

type NotificationsSubProps = {
  visible: boolean;
  onClose: () => void;
};

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function formatTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function peopleLabel(count: number) {
  return count === 1 ? 'person' : 'people';
}

function isRelayUrl(value: unknown): value is string {
  return typeof value === 'string' && /^wss?:\/\//.test(value);
}

function itemRelays(notification: ProcessedNotification, relays: string[]) {
  return [
    ...new Set(
      [...relays, ...notification.parsed.requests.flatMap(req => req.relays ?? [])]
        .filter(isRelayUrl),
    ),
  ];
}

function eventPubkey(event?: ParsedEvent) {
  return event?.pubkey?.() || null;
}

function eventsWithPubkeys(events: ParsedEvent[]) {
  return events
    .map(event => ({event, pubkey: eventPubkey(event)}))
    .filter((entry): entry is {event: ParsedEvent; pubkey: string} => !!entry.pubkey);
}

export function NotificationsSub({visible, onClose}: NotificationsSubProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const setLastNotificationView = useAppStore(state => state.setLastNotificationView);
  const [rawEvents, setRawEvents] = useState<ParsedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const paginationUnsubscribeRef = useRef<(() => void) | null>(null);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const paginationTrackerRef = useRef(new ConnectionTracker());
  const paginationSeqRef = useRef(0);
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shortBackfillCountRef = useRef(0);

  const relays = useMemo(
    () => [...new Set(readRelays.length ? readRelays : DEFAULT_FEED_RELAYS)],
    [readRelays],
  );
  const relaysKey = relays.join(',');

  const notifications = useMemo(
    () => (pubkey ? processNotifications(rawEvents, pubkey) : []),
    [pubkey, rawEvents],
  );

  const buildRequests = useCallback(
    (until?: number): RequestObject[] => {
      if (!pubkey) return [];
      const request: RequestObject = {
        kinds: [1, 7, 6],
        tags: {'#p': [pubkey]},
        limit: PAGE_LIMIT,
        relays,
        noCache: true,
      };
      if (until) request.until = until;
      return [request];
    },
    [pubkey, relays],
  );

  const addEvent = useCallback(
    (event: ParsedEvent) => {
      if (!pubkey) return;
      if (event.pubkey() === pubkey) return;
      if (![1, 6, 7].includes(event.kind())) return;
      const id = event.id();
      if (!id || seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      setRawEvents(current => [...current, event]);
    },
    [pubkey],
  );

  const handleMessage = useCallback(
    (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (status) {
        connectionTrackerRef.current.handleMessage(message);
        if (connectionTrackerRef.current.resolutionRate >= 0.5) {
          clearInitialTimeout();
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }
      const event = asParsedEvent(message);
      if (event) addEvent(event);
    },
    [addEvent],
  );

  const handlePaginationMessage = useCallback(
    (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (status) {
        paginationTrackerRef.current.handleMessage(message);
        if (paginationTrackerRef.current.resolutionRate >= 0.5) setLoading(false);
        return;
      }
      const event = asParsedEvent(message);
      if (event) addEvent(event);
    },
    [addEvent],
  );

  const clearPaginationTimeout = useCallback(() => {
    if (!paginationTimeoutRef.current) return;
    clearTimeout(paginationTimeoutRef.current);
    paginationTimeoutRef.current = null;
  }, []);

  const clearInitialTimeout = useCallback(() => {
    if (!initialTimeoutRef.current) return;
    clearTimeout(initialTimeoutRef.current);
    initialTimeoutRef.current = null;
  }, []);

  const initSubscription = useCallback(() => {
    if (!visible || !pubkey) return;
    unsubscribeRef.current?.();
    paginationUnsubscribeRef.current?.();
    clearPaginationTimeout();
    clearInitialTimeout();
    connectionTrackerRef.current = new ConnectionTracker();
    seenIdsRef.current.clear();
    shortBackfillCountRef.current = 0;
    setRawEvents([]);
    setHasMore(true);
    setLoading(true);

    unsubscribeRef.current = subscribeToNostr(
      `notifications_${pubkey}_${relayHash(relays)}`,
      buildRequests(),
      handleMessage,
      {bytesPerEvent: 10 * 1024},
    );
    initialTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setRefreshing(false);
      initialTimeoutRef.current = null;
    }, EOSE_FALLBACK_TIMEOUT_MS);
  }, [
    buildRequests,
    clearInitialTimeout,
    clearPaginationTimeout,
    handleMessage,
    pubkey,
    relays,
    visible,
  ]);

  useEffect(() => {
    initSubscription();
    return () => {
      unsubscribeRef.current?.();
      paginationUnsubscribeRef.current?.();
      clearPaginationTimeout();
      clearInitialTimeout();
      unsubscribeRef.current = null;
      paginationUnsubscribeRef.current = null;
    };
  }, [clearInitialTimeout, clearPaginationTimeout, initSubscription, relaysKey]);

  useEffect(() => {
    if (visible) setLastNotificationView(Date.now());
  }, [setLastNotificationView, visible]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initSubscription();
  }, [initSubscription]);

  const loadNextPage = useCallback((autoBackfill = false) => {
    if (loading || !hasMore || rawEvents.length === 0 || !pubkey) return;
    const sorted = [...rawEvents].sort((left, right) => right.createdAt() - left.createdAt());
    const cursorIndex = sorted.length > 6 ? sorted.length - 6 : sorted.length - 1;
    const cursor = sorted[cursorIndex];
    if (!cursor) return;

    if (autoBackfill) shortBackfillCountRef.current += 1;
    const before = seenIdsRef.current.size;
    const until = cursor.createdAt() - 1;
    paginationSeqRef.current += 1;
    paginationTrackerRef.current = new ConnectionTracker();
    setLoading(true);
    paginationUnsubscribeRef.current?.();
    clearPaginationTimeout();
    paginationUnsubscribeRef.current = subscribeToNostr(
      `notifications_page_${pubkey}_${paginationSeqRef.current}_${until}_${relayHash(relays)}`,
      buildRequests(until),
      message => {
        handlePaginationMessage(message);
        if (asConnectionStatus(message) && paginationTrackerRef.current.resolutionRate >= 0.5) {
          const addedEvents = seenIdsRef.current.size > before;
          setHasMore(addedEvents);
          clearPaginationTimeout();
        }
      },
      {bytesPerEvent: 10 * 1024},
    );
    paginationTimeoutRef.current = setTimeout(() => {
      const addedEvents = seenIdsRef.current.size > before;
      setHasMore(addedEvents);
      setLoading(false);
      paginationTimeoutRef.current = null;
    }, PAGINATION_TIMEOUT_MS);
  }, [
    buildRequests,
    clearPaginationTimeout,
    handlePaginationMessage,
    hasMore,
    loading,
    pubkey,
    rawEvents,
    relays,
  ]);

  const handleNearBottom = useCallback(() => {
    loadNextPage(false);
  }, [loadNextPage]);

  useEffect(() => {
    if (
      !visible ||
      loading ||
      !hasMore ||
      rawEvents.length === 0 ||
      notifications.length >= SHORT_PAGE_BACKFILL_ROWS ||
      shortBackfillCountRef.current >= MAX_SHORT_PAGE_BACKFILLS
    ) {
      return;
    }
    loadNextPage(true);
  }, [hasMore, loadNextPage, loading, notifications.length, rawEvents.length, visible]);

  const renderHeader = useCallback(
    () => <NotificationsHeader onClose={onClose} />,
    [onClose],
  );

  const renderItem = useCallback(
    ({item, visible: itemVisible}: {item: ProcessedNotification; visible: boolean}) => (
      <NotificationItem notification={item} visible={visible && itemVisible} relays={relays} />
    ),
    [relays, visible],
  );

  if (!pubkey) {
    return (
      <Feed
        items={[]}
        renderItem={() => null}
        header={renderHeader}
        stickyHeader={renderHeader}
        empty={<Text className="px-4 py-8 text-center text-primary-content">Sign in to view notifications</Text>}
      />
    );
  }

  return (
    <Feed
      items={notifications}
      getItemId={item => item.id().fnv1aHash()}
      renderItem={renderItem}
      header={renderHeader}
      stickyHeader={renderHeader}
      loading={loading && notifications.length === 0}
      refreshing={refreshing}
      pullToRefresh
      onRefresh={handleRefresh}
      onNearBottom={handleNearBottom}
      empty={<Text className="px-4 py-8 text-center text-primary-content">No notifications yet</Text>}
      contentContainerClassName="pb-28"
    />
  );
}

const NotificationsHeader = memo(function NotificationsHeader({
  onClose,
}: {
  onClose: () => void;
}) {
  const theme = useAppTheme();
    return (
    <View className="border-b border-base-200 bg-base-100/95">
      <View className="h-16 flex-row items-center justify-between px-4">
        <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-200" hitSlop={12} onPress={onClose}>
          <ChevronLeft size={22} color={theme.colors.primaryContent} />
        </Pressable>
        <Text className="text-base font-semibold text-base-content">Notifications</Text>
        <View className="h-9 w-9" />
      </View>
    </View>
  );
});

const NotificationItem = memo(function NotificationItem({
  notification,
  visible,
  relays,
}: {
  notification: ProcessedNotification;
  visible: boolean;
  relays: string[];
}) {
  const effectiveRelays = useMemo(
    () => itemRelays(notification, relays),
    [notification, relays],
  );

  if (notification.type === 'reply') {
    const isSingleReply = notification.parsed.events.length === 1;
    const replyPubkey = eventPubkey(notification.parsed.events[0]);
    return (
      <NotificationShell
        icon={
          isSingleReply && replyPubkey ? (
            <Avatar pubkey={replyPubkey} size="sm" link />
          ) : (
            <MessageCircleReply size={18} color="#2563eb" />
          )
        }
        iconClassName={isSingleReply && replyPubkey ? '' : 'bg-blue-100'}
        title={
          isSingleReply
            ? undefined
            : `${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} replied to your post`
        }
        timestamp={notification.timestamp}
      >
        {isSingleReply ? null : <ActorStack events={notification.parsed.events} />}
        <ReplyEventPreview
          event={notification.parsed.events[0]}
          relays={effectiveRelays}
        />
        <ExpandableReplyList
          events={notification.parsed.events.slice(1)}
          relays={effectiveRelays}
        />
      </NotificationShell>
    );
  }

  if (notification.type === 'reaction') {
    const isSingleReaction = notification.parsed.events.length === 1;
    const reactionPubkey = eventPubkey(notification.parsed.events[0]);
    return (
      <NotificationShell
        icon={
          isSingleReaction && reactionPubkey ? (
            <Avatar pubkey={reactionPubkey} size="sm" link />
          ) : (
            <Heart size={18} color="#dc2626" fill="#dc2626" />
          )
        }
        iconClassName={isSingleReaction && reactionPubkey ? '' : 'bg-red-100'}
        title={
          isSingleReaction
            ? undefined
            : `${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} liked your post`
        }
        timestamp={notification.timestamp}
      >
        {isSingleReaction ? (
          <>
            <SingleActorLine event={notification.parsed.events[0]} action="liked your post" />
            <OriginalPostPreview
              notification={notification}
              relays={effectiveRelays}
              visible={visible}
            />
          </>
        ) : (
          <>
            <OriginalPostPreview
              notification={notification}
              relays={effectiveRelays}
              visible={visible}
            />
            <ActorSummary events={notification.parsed.events} action="liked this post" />
            <ExpandableActorList
              events={notification.parsed.events}
              label="likes"
            />
          </>
        )}
      </NotificationShell>
    );
  }

  if (notification.type === 'repost') {
    const isSingleRepost = notification.parsed.events.length === 1;
    const repostPubkey = eventPubkey(notification.parsed.events[0]);
    return (
      <NotificationShell
        icon={
          isSingleRepost && repostPubkey ? (
            <Avatar pubkey={repostPubkey} size="sm" link />
          ) : (
            <Repeat2 size={18} color="#16a34a" />
          )
        }
        iconClassName={isSingleRepost && repostPubkey ? '' : 'bg-green-100'}
        title={
          isSingleRepost
            ? undefined
            : `${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} reposted your post`
        }
        timestamp={notification.timestamp}
      >
        {isSingleRepost ? (
          <>
            <SingleActorLine event={notification.parsed.events[0]} action="reposted your post" />
            <OriginalPostPreview
              notification={notification}
              relays={effectiveRelays}
              visible={visible}
            />
          </>
        ) : (
          <>
            <OriginalPostPreview
              notification={notification}
              relays={effectiveRelays}
              visible={visible}
            />
            <ActorSummary events={notification.parsed.events} action="reposted this post" />
            <ExpandableActorList
              events={notification.parsed.events}
              label="reposts"
            />
          </>
        )}
      </NotificationShell>
    );
  }

  return (
    <NotificationShell
      icon={<AtSign size={18} color="#9333ea" />}
      iconClassName="bg-purple-100"
      title={
        notification.parsed.events.length === 1
          ? 'You were mentioned in a post'
          : `You were mentioned in ${notification.parsed.events.length} posts`
      }
      timestamp={notification.timestamp}
    >
      <MentionPreview
        event={notification.parsed.events[0]}
        visible={visible}
        relays={effectiveRelays}
      />
      {notification.parsed.events.length > 1 ? (
        <>
          <ActorStack events={notification.parsed.events} />
          <ExpandableActorList
            events={notification.parsed.events.slice(1)}
            label="mentions"
          />
        </>
      ) : null}
    </NotificationShell>
  );
});

const NotificationShell = memo(function NotificationShell({
  icon,
  iconClassName,
  title,
  timestamp,
  children,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  title?: string;
  timestamp: number;
  children: React.ReactNode;
}) {
  return (
    <View className="px-1 pb-1.5">
      <View className="rounded-lg bg-base-300/90 px-4 py-4 shadow-sm">
        <View className="flex-row items-start gap-3">
          <View className={`h-9 w-9 items-center justify-center rounded-full ${iconClassName}`}>
            {icon}
          </View>
          <View className="min-w-0 flex-1">
            {title ? (
              <View className="mb-2 flex-row items-start justify-between gap-3">
                <Text className="min-w-0 flex-1 text-sm font-semibold text-base-content">
                  {title}
                </Text>
                <Text className="text-xs text-primary-content">{formatTime(timestamp)}</Text>
              </View>
            ) : null}
            {children}
          </View>
        </View>
      </View>
    </View>
  );
});

const OriginalPostPreview = memo(function OriginalPostPreview({
  notification,
  visible,
  relays,
}: {
  notification: ProcessedNotification;
  visible: boolean;
  relays: string[];
}) {
  if (notification.parsed.referencedPostId.startsWith('mention-')) return null;
  return (
    <ReferencedPostContent
      noteId={notification.parsed.referencedPostId}
      relays={relays}
      visible={visible}
    />
  );
});

const ReferencedPostContent = memo(function ReferencedPostContent({
  noteId,
  relays,
  visible,
}: {
  noteId: string;
  relays: string[];
  visible: boolean;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [note, setNote] = useState<ParsedEvent | null>(null);
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !noteId) return undefined;
    if (seenRef.current !== noteId) {
      seenRef.current = noteId;
      setNote(null);
    }
    return subscribeToNostr(
      `notification_post_${noteId}`,
      [{ids: [noteId], limit: 1, relays, cacheFirst: true}],
      message => {
        const parsed = asParsedEvent(message);
        if (parsed?.id?.() === noteId) setNote(parsed);
      },
      {bytesPerEvent: 10 * 1024},
    );
  }, [noteId, relays, visible]);

  const kind1 = useMemo(() => (note ? asKind1(note) : null), [note]);
  const content = useMemo(
    () => (kind1 ? fbArray(kind1, 'parsedContent') : []),
    [kind1],
  );
  const shortContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'shortenedContent') : []),
    [kind1],
  );
  const openPost = () => {
    if (note?.kind?.() === 20) return;
    pushDistinct(navigation, 'Kind1Thread', {
      nevent: neventEncode({
        id: noteId,
        author: note?.pubkey?.() || undefined,
        relays,
        kind: note?.kind?.() || 1,
      }),
    });
  };

  if (!note) {
    return (
      <Text className="text-sm text-primary-content">
        Loading note {noteId.slice(0, 12)}...
      </Text>
    );
  }

  return (
    <Pressable onPress={openPost}>
      <ContentBlocks
        content={content}
        shortContent={shortContent}
        note={note}
        showMedia={false}
        showQuote={false}
        forceFullContent={false}
      />
    </Pressable>
  );
});

const MentionPreview = memo(function MentionPreview({
  event,
  visible,
  relays,
}: {
  event?: ParsedEvent;
  visible: boolean;
  relays: string[];
}) {
  if (!event) return null;
  return (
    <View className="mb-3 rounded-md bg-base-200/90 px-2 py-2">
      <Note
        note={event}
        relays={relays}
        visible={visible}
        footer={false}
        showMedia={false}
        showQuote={false}
        showRoot={false}
        depth={1}
      />
    </View>
  );
});

const ActorStack = memo(function ActorStack({events}: {events: ParsedEvent[]}) {
  const actors = eventsWithPubkeys(events);
  if (!actors.length) return null;
  const visibleActors = actors.slice(0, 5);
  const remaining = actors.length - visibleActors.length;

  return (
    <View className="mb-3 flex-row items-center">
      {visibleActors.map(({event, pubkey}, index) => (
        <View
          key={event.id()}
          className={index === 0 ? '' : '-ml-2'}
          style={{zIndex: visibleActors.length - index}}
        >
          <Avatar pubkey={pubkey} size="sm" link />
        </View>
      ))}
      {remaining > 0 ? (
        <View className="-ml-2 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-base-200">
          <Text className="text-xs font-semibold text-primary-content">+{remaining}</Text>
        </View>
      ) : null}
    </View>
  );
});

const ActorSummary = memo(function ActorSummary({
  events,
  action,
}: {
  events: ParsedEvent[];
  action: string;
}) {
  const actors = eventsWithPubkeys(events);
  if (!actors.length) return null;
  const first = actors[0];
  const second = actors[1];

  return (
    <View className="mb-1 flex-row items-start gap-2">
      <ActorStack events={events} />
      <Text className="min-w-0 flex-1 text-sm text-primary-content">
        {actors.length === 1 ? (
          <>
            <User pubkey={first.pubkey} link className="text-sm font-semibold text-base-content" /> {action}
          </>
        ) : actors.length <= 3 ? (
          <>
            {actors.map(({event, pubkey}, index) => (
              <React.Fragment key={event.id()}>
                <User pubkey={pubkey} link className="text-sm font-semibold text-base-content" />
                {index < actors.length - 2 ? ', ' : index < actors.length - 1 ? ' and ' : ' '}
              </React.Fragment>
            ))}
            {action}
          </>
        ) : (
          <>
            <User pubkey={first.pubkey} link className="text-sm font-semibold text-base-content" />
            {', '}
            <User pubkey={second.pubkey} link className="text-sm font-semibold text-base-content" />
            {' and '}
            <Text className="text-sm font-semibold text-base-content">{actors.length - 2} others</Text>
            {' '}
            {action}
          </>
        )}
      </Text>
    </View>
  );
});

const SingleActorLine = memo(function SingleActorLine({
  event,
  action,
}: {
  event?: ParsedEvent;
  action: string;
}) {
  const pubkey = eventPubkey(event);
  if (!pubkey) return null;
  return (
    <Text className="mb-1 text-sm text-primary-content">
      <User pubkey={pubkey} link className="text-sm font-semibold text-base-content" /> {action}
    </Text>
  );
});

const ExpandableReplyList = memo(function ExpandableReplyList({
  events,
  relays,
}: {
  events: ParsedEvent[];
  relays: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!events.length) return null;
  const visibleEvents = events.slice(0, 10);

  return (
    <View className="mt-1">
      {expanded ? (
        <View className="mt-2 gap-3">
          {visibleEvents.map(event => (
            <ReplyEventPreview key={event.id()} event={event} relays={relays} />
          ))}
          {events.length > visibleEvents.length ? (
            <Text className="text-xs text-primary-content">
              {events.length - visibleEvents.length} more replies
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        className="flex-row items-center gap-1 self-start"
        hitSlop={8}
        onPress={() => setExpanded(value => !value)}
      >
        <Text className="text-xs font-medium text-primary-content">
          {expanded ? 'Show less' : `Show more replies`}
        </Text>
        {expanded ? (
          <ChevronUp size={14} color="#64748b" />
        ) : (
          <ChevronDown size={14} color="#64748b" />
        )}
      </Pressable>
    </View>
  );
});

const ReplyEventPreview = memo(function ReplyEventPreview({
  event,
  relays,
}: {
  event?: ParsedEvent;
  relays: string[];
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const pubkey = eventPubkey(event);
  const kind1 = useMemo(() => (event ? asKind1(event) : null), [event]);
  const content = useMemo(
    () => (kind1 ? fbArray(kind1, 'parsedContent') : []),
    [kind1],
  );
  const shortContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'shortenedContent') : []),
    [kind1],
  );

  if (!event || !pubkey) return null;
  const openReply = () => {
    const id = event.id();
    if (!id) return;
    pushDistinct(navigation, 'Kind1Thread', {
      nevent: neventEncode({
        id,
        author: pubkey,
        relays,
        kind: event.kind() || 1,
      }),
    });
  };

  return (
    <Pressable onPress={openReply}>
      <Text className="mb-1 text-sm text-primary-content">
        <User pubkey={pubkey} link className="text-sm font-semibold text-base-content" /> replied:
      </Text>
      <ContentBlocks
        content={content}
        shortContent={shortContent}
        note={event}
        showMedia={false}
        showQuote={false}
        forceFullContent={false}
      />
    </Pressable>
  );
});

const ExpandableActorList = memo(function ExpandableActorList({
  events,
  label,
}: {
  events: ParsedEvent[];
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const actors = eventsWithPubkeys(events);
  if (actors.length <= 1) return null;
  const visibleActors = actors.slice(0, 10);

  return (
    <View className="mt-1">
      {expanded ? (
        <View className="mt-2 border-t border-base-200 pt-3">
          {visibleActors.map(({event, pubkey}) => (
            <View key={event.id()} className="mb-2 flex-row items-center gap-2">
              <Avatar pubkey={pubkey} size="sm" link />
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <User pubkey={pubkey} link className="text-sm font-semibold text-base-content" />
                <Text className="text-xs text-primary-content">{formatTime(event.createdAt())}</Text>
              </View>
            </View>
          ))}
          {actors.length > visibleActors.length ? (
            <Text className="text-xs text-primary-content">
              {actors.length - visibleActors.length} more {label}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        className="mt-2 flex-row items-center gap-1 self-start"
        hitSlop={8}
        onPress={() => setExpanded(value => !value)}
      >
        <Text className="text-xs font-medium text-primary-content">
          {expanded ? 'Show less' : `Show more ${label}`}
        </Text>
        {expanded ? (
          <ChevronUp size={14} color="#475569" />
        ) : (
          <ChevronDown size={14} color="#475569" />
        )}
      </Pressable>
    </View>
  );
});
