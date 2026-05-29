import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asParsedEvent,
  ConnectionTracker,
} from '@candypoets/nipworker/utils';
import {ChevronLeft} from 'lucide-react-native';

import {Feed} from '../components/Feed';
import {Note} from '../components/notes';
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

function titleForNotification(notification: ProcessedNotification) {
  const count = notification.parsed.events.length;
  const actor = count === 1 ? 'Someone' : `${count} people`;
  if (notification.type === 'reply') return `${actor} replied`;
  if (notification.type === 'reaction') return `${actor} reacted`;
  if (notification.type === 'repost') return `${actor} reposted`;
  return `${actor} mentioned you`;
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
      <NotificationItem notification={item} visible={visible && itemVisible} />
    ),
    [visible],
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
        <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-slate-100" hitSlop={12} onPress={onClose}>
          <ChevronLeft size={22} color="#17212b" />
        </Pressable>
        <Text className="text-base font-semibold text-slate-950">Notifications</Text>
        <View className="h-9 w-9" />
      </View>
    </View>
  );
});

const NotificationItem = memo(function NotificationItem({
  notification,
  visible,
}: {
  notification: ProcessedNotification;
  visible: boolean;
}) {
  const events = notification.parsed.events;
  const previewEvents = events.slice(0, notification.type === 'reaction' ? 1 : 3);

  return (
    <View className="px-1 pb-1.5">
      <View className="rounded-lg bg-white/90 px-3 py-3 shadow-sm">
        <View className="mb-2 flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm font-semibold text-slate-900">
            {titleForNotification(notification)}
          </Text>
          <Text className="text-xs text-slate-500">{formatTime(notification.timestamp)}</Text>
        </View>
        {previewEvents.map(event => (
          <View key={event.id()} className="mb-2 last:mb-0">
            {event.kind() === 1 || event.kind() === 6 ? (
              <Note note={event} visible={visible} footer={false} showRoot={false} />
            ) : (
              <Text className="text-sm text-slate-600" numberOfLines={2}>
                Reaction
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
});
