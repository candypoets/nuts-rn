import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asParsedEvent,
  ConnectionTracker,
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

import {Feed} from '../components/Feed';
import {Avatar, Note, User} from '../components/notes';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {
  type ProcessedNotification,
  processNotifications,
} from '../notifications/processNotifications';
import {useAppStore, useAuthStore, useNostrStore} from '../stores';

const PAGE_LIMIT = 50;

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
  const writeRelays = useNostrStore(state => state.writeRelays);
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

  const relays = useMemo(
    () => [...new Set(writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS)],
    [writeRelays],
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
      if (!pubkey || event.pubkey() === pubkey) return;
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
        if (connectionTrackerRef.current.resolutionRate > 0.5) {
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
        if (paginationTrackerRef.current.resolutionRate > 0.5) setLoading(false);
        return;
      }
      const event = asParsedEvent(message);
      if (event) addEvent(event);
    },
    [addEvent],
  );

  const initSubscription = useCallback(() => {
    if (!visible || !pubkey) return;
    unsubscribeRef.current?.();
    paginationUnsubscribeRef.current?.();
    connectionTrackerRef.current = new ConnectionTracker();
    seenIdsRef.current.clear();
    setRawEvents([]);
    setHasMore(true);
    setLoading(true);

    unsubscribeRef.current = subscribeToNostr(
      `notifications_${pubkey}_${relayHash(relays)}`,
      buildRequests(),
      handleMessage,
      {bytesPerEvent: 10 * 1024},
    );
  }, [buildRequests, handleMessage, pubkey, relays, visible]);

  useEffect(() => {
    initSubscription();
    return () => {
      unsubscribeRef.current?.();
      paginationUnsubscribeRef.current?.();
      unsubscribeRef.current = null;
      paginationUnsubscribeRef.current = null;
    };
  }, [initSubscription, relaysKey]);

  useEffect(() => {
    if (visible) setLastNotificationView(Date.now());
  }, [setLastNotificationView, visible]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initSubscription();
  }, [initSubscription]);

  const handleNearBottom = useCallback(() => {
    if (loading || !hasMore || rawEvents.length === 0 || !pubkey) return;
    const sorted = [...rawEvents].sort((left, right) => right.createdAt() - left.createdAt());
    const cursor = sorted[Math.max(0, sorted.length - 6)];
    if (!cursor) return;

    const before = seenIdsRef.current.size;
    const until = cursor.createdAt() - 1;
    paginationSeqRef.current += 1;
    paginationTrackerRef.current = new ConnectionTracker();
    setLoading(true);
    paginationUnsubscribeRef.current?.();
    paginationUnsubscribeRef.current = subscribeToNostr(
      `notifications_page_${pubkey}_${paginationSeqRef.current}_${until}_${relayHash(relays)}`,
      buildRequests(until),
      message => {
        handlePaginationMessage(message);
        if (asConnectionStatus(message) && paginationTrackerRef.current.resolutionRate > 0.5) {
          setHasMore(seenIdsRef.current.size > before);
        }
      },
      {bytesPerEvent: 10 * 1024},
    );
  }, [buildRequests, handlePaginationMessage, hasMore, loading, pubkey, rawEvents, relays]);

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
        empty={<Text className="px-4 py-8 text-center text-slate-500">Sign in to view notifications</Text>}
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
      empty={<Text className="px-4 py-8 text-center text-slate-500">No notifications yet</Text>}
      contentContainerClassName="pb-28"
    />
  );
}

const NotificationsHeader = memo(function NotificationsHeader({
  onClose,
}: {
  onClose: () => void;
}) {
    return (
    <View className="border-b border-slate-200 bg-slate-50/95">
      <View className="h-16 flex-row items-center justify-between px-4">
        <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-slate-200" hitSlop={12} onPress={onClose}>
          <ChevronLeft size={22} color={"#17212b"} />
        </Pressable>
        <Text className="text-base font-semibold text-slate-900">Notifications</Text>
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
    return (
      <NotificationShell
        icon={<MessageCircleReply size={18} color="#2563eb" />}
        iconClassName="bg-blue-100"
        title={`${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} replied to your post`}
        timestamp={notification.timestamp}
      >
        <OriginalPostPreview
          notification={notification}
          relays={effectiveRelays}
          visible={visible}
        />
        <ActorStack events={notification.parsed.events} />
        <LatestEventPreview
          event={notification.parsed.events[0]}
          visible={visible}
          relays={effectiveRelays}
          action="replied"
        />
        <ExpandableActorList
          events={notification.parsed.events.slice(1)}
          label="replies"
        />
      </NotificationShell>
    );
  }

  if (notification.type === 'reaction') {
    return (
      <NotificationShell
        icon={<Heart size={18} color="#dc2626" fill="#dc2626" />}
        iconClassName="bg-red-100"
        title={`${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} liked your post`}
        timestamp={notification.timestamp}
      >
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
      </NotificationShell>
    );
  }

  if (notification.type === 'repost') {
    return (
      <NotificationShell
        icon={<Repeat2 size={18} color="#16a34a" />}
        iconClassName="bg-green-100"
        title={`${notification.parsed.events.length} ${peopleLabel(notification.parsed.events.length)} reposted your post`}
        timestamp={notification.timestamp}
      >
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
  title: string;
  timestamp: number;
  children: React.ReactNode;
}) {
  return (
    <View className="px-1 pb-1.5">
      <View className="rounded-lg bg-white/90 px-4 py-4 shadow-sm">
        <View className="flex-row items-start gap-3">
          <View className={`h-9 w-9 items-center justify-center rounded-full ${iconClassName}`}>
            {icon}
          </View>
          <View className="min-w-0 flex-1">
            <View className="mb-2 flex-row items-start justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                {title}
              </Text>
              <Text className="text-xs text-slate-500">{formatTime(timestamp)}</Text>
            </View>
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
  if (!notification.parsed.referencedPostId.startsWith('mention-')) {
    return (
      <View className="mb-3 rounded-md bg-slate-100/90 px-2 py-2">
        <Note
          noteId={notification.parsed.referencedPostId}
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
  }

  return null;
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
    <View className="mb-3 rounded-md bg-slate-100/90 px-2 py-2">
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
        <View className="-ml-2 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-200">
          <Text className="text-xs font-semibold text-slate-500">+{remaining}</Text>
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
      <Text className="min-w-0 flex-1 text-sm text-slate-500">
        {actors.length === 1 ? (
          <>
            <User pubkey={first.pubkey} link className="text-sm font-semibold text-slate-900" /> {action}
          </>
        ) : actors.length <= 3 ? (
          <>
            {actors.map(({event, pubkey}, index) => (
              <React.Fragment key={event.id()}>
                <User pubkey={pubkey} link className="text-sm font-semibold text-slate-900" />
                {index < actors.length - 2 ? ', ' : index < actors.length - 1 ? ' and ' : ' '}
              </React.Fragment>
            ))}
            {action}
          </>
        ) : (
          <>
            <User pubkey={first.pubkey} link className="text-sm font-semibold text-slate-900" />
            {', '}
            <User pubkey={second.pubkey} link className="text-sm font-semibold text-slate-900" />
            {' and '}
            <Text className="text-sm font-semibold text-slate-900">{actors.length - 2} others</Text>
            {' '}
            {action}
          </>
        )}
      </Text>
    </View>
  );
});

const LatestEventPreview = memo(function LatestEventPreview({
  event,
  visible,
  relays,
  action,
}: {
  event?: ParsedEvent;
  visible: boolean;
  relays: string[];
  action: string;
}) {
  const pubkey = eventPubkey(event);
  if (!event || !pubkey) return null;
  return (
    <View className="mb-2">
      <Text className="mb-1 text-sm text-slate-500">
        <User pubkey={pubkey} link className="text-sm font-semibold text-slate-900" /> {action}:
      </Text>
      <View className="rounded-md bg-slate-100/90 px-2 py-2">
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
    </View>
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
        <View className="mt-2 border-t border-slate-200 pt-3">
          {visibleActors.map(({event, pubkey}) => (
            <View key={event.id()} className="mb-2 flex-row items-center gap-2">
              <Avatar pubkey={pubkey} size="sm" link />
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <User pubkey={pubkey} link className="text-sm font-semibold text-slate-900" />
                <Text className="text-xs text-slate-500">{formatTime(event.createdAt())}</Text>
              </View>
            </View>
          ))}
          {actors.length > visibleActors.length ? (
            <Text className="text-xs text-slate-500">
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
        <Text className="text-xs font-medium text-slate-500">
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
