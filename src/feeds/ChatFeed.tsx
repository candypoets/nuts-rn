import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {Kind4Parsed, ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asEoce,
  asKind4,
  asParsedEvent,
  ConnectionTracker,
  fbArray,
} from '@candypoets/nipworker/utils';
import {Info, MessageCirclePlus} from 'lucide-react-native';
import {Feed} from '../components/Feed';
import {Avatar, ContentBlocks, User} from '../components/notes';
import {wasRecentSwipeGesture} from '../components/notes/press';
import {RelaysList} from '../components/RelaysList';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {pushDistinct} from '../navigation/pushDistinct';
import type {RootStackParamList} from '../navigation/types';
import {useAuthStore, useNostrStore, useRelayStore} from '../stores';

type ChatListTab = 'messages' | 'requests';

type ChatFeedProps = {
  enabled: boolean;
  visible: boolean;
};

type Conversation = {
  chatId: string;
  latest: ParsedEvent;
  peerPubkey: string;
  hasOutgoing: boolean;
};

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function formatRelativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function correspondent(event: ParsedEvent, myPubkey: string | null) {
  const kind4 = asKind4(event);
  const recipient = kind4?.recipient() || '';
  return recipient === myPubkey ? event.pubkey() || '' : String(recipient);
}

function buildRequests(pubkey: string | null, relays: string[]): RequestObject[] {
  if (!pubkey) return [];
  return [
    {kinds: [4], authors: [pubkey], relays, noCache: true},
    {kinds: [4], authors: [pubkey], relays},
    {kinds: [4], tags: {'#p': [pubkey]}, relays, noCache: true},
    {kinds: [4], tags: {'#p': [pubkey]}, relays},
  ];
}

function groupConversations(
  events: ParsedEvent[],
  pubkey: string | null,
  contacts: string[],
  hasContactList: boolean,
  _eventsVersion: number,
) {
  const contactSet = new Set(contacts);
  const chats = new Map<string, Conversation>();

  events.forEach(event => {
    const kind4 = asKind4(event);
    const chatId = kind4?.chatId();
    if (!chatId) return;

    const peerPubkey = correspondent(event, pubkey);
    const isOutgoing = event.pubkey() === pubkey;
    const previous = chats.get(chatId);
    if (!previous) {
      chats.set(chatId, {
        chatId,
        latest: event,
        peerPubkey,
        hasOutgoing: isOutgoing,
      });
      return;
    }

    chats.set(chatId, {
      chatId,
      latest:
        previous.latest.createdAt() < event.createdAt()
          ? event
          : previous.latest,
      peerPubkey: previous.peerPubkey || peerPubkey,
      hasOutgoing: previous.hasOutgoing || isOutgoing,
    });
  });

  return Array.from(chats.values())
    .sort((left, right) => right.latest.createdAt() - left.latest.createdAt())
    .reduce(
      (acc, chat) => {
        const known = hasContactList ? contactSet.has(chat.peerPubkey) : true;
        if (known || chat.hasOutgoing) {
          acc.messages.push(chat);
        } else {
          acc.requests.push(chat);
        }
        return acc;
      },
      {messages: [] as Conversation[], requests: [] as Conversation[]},
    );
}

export function ChatFeed({enabled, visible}: ChatFeedProps) {
  const eventsRef = useRef<ParsedEvent[]>([]);
  const pendingEventsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChatKeyRef = useRef<string | null>(null);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<ChatListTab>('messages');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [eventsVersion, setEventsVersion] = useState(0);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const contacts = useNostrStore(state => state.follows);
  const hasContactList = useNostrStore(state => state.kind3UpdatedAt > 0);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const relays = useMemo(() => {
    const source = pubkey && (readRelays.length || writeRelays.length)
      ? [...readRelays, ...writeRelays]
      : DEFAULT_FEED_RELAYS;
    return Array.from(new Set(source.map(normalizeRelayUrl)));
  }, [pubkey, readRelays, writeRelays]);
  const chatKey = useMemo(
    () => `${pubkey || 'anon'}:${hasSigner === false ? 'readonly' : 'signer'}:${relays.join(',')}`,
    [hasSigner, pubkey, relays],
  );
  const conversations = useMemo(() => {
    return groupConversations(
      eventsRef.current,
      pubkey,
      contacts,
      hasContactList,
      eventsVersion,
    );
  }, [contacts, eventsVersion, hasContactList, pubkey]);
  const items =
    activeTab === 'requests' ? conversations.requests : conversations.messages;

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetEvents = useCallback(() => {
    eventsRef.current = [];
    pendingEventsRef.current = [];
    seenIdsRef.current.clear();
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = false;
    setEventsVersion(version => version + 1);
  }, []);

  const commitPendingEvents = useCallback(() => {
    const pending = pendingEventsRef.current;
    if (!pending.length) return;
    pendingEventsRef.current = [];
    eventsRef.current = [...eventsRef.current, ...pending].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    setEventsVersion(version => version + 1);
  }, []);

  const completeResolvingSubscription = useCallback(() => {
    if (!subscriptionResolvingRef.current) return;
    subscriptionResolvingRef.current = false;
    commitPendingEvents();
    setLoading(false);
    setRefreshing(false);
    clearTimer();
  }, [clearTimer, commitPendingEvents]);

  const handleEvents = useCallback(
    (message: WorkerMessage) => {
      if (asEoce(message)) {
        commitPendingEvents();
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
      if (!parsed || parsed.kind() !== 4) return;

      const kind4 = asKind4(parsed);
      if (!kind4?.chatId()) return;
      const id = parsed.id();
      if (!id || seenIdsRef.current.has(id)) return;

      seenIdsRef.current.add(id);
      pendingEventsRef.current = [...pendingEventsRef.current, parsed];
      if (!subscriptionResolvingRef.current) commitPendingEvents();
    },
    [commitPendingEvents, completeResolvingSubscription, setRelayStatus],
  );

  const startSubscription = useCallback(
    (forceCacheBust = false) => {
      if (!enabled || !visible || !pubkey || hasSigner === false) return;

      const requests = buildRequests(pubkey, relays);
      if (!requests.length) return;
      const subId = `chat_${pubkey}_${forceCacheBust ? Date.now() : relays.join(',')}`;
      setSubRelays(subId, relays);
      relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
      unsubscribeRef.current?.();
      pendingEventsRef.current = [];
      connectionTrackerRef.current.reset();
      subscriptionResolvingRef.current = true;
      unsubscribeRef.current = subscribeToNostr(subId, requests, handleEvents);
      setLoading(eventsRef.current.length === 0);
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        completeResolvingSubscription();
      }, 5000);
    },
    [
      clearTimer,
      completeResolvingSubscription,
      enabled,
      handleEvents,
      hasSigner,
      pubkey,
      relays,
      setRelayStatus,
      setSubRelays,
      visible,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    if (lastChatKeyRef.current === chatKey) return;
    lastChatKeyRef.current = chatKey;
    resetEvents();
  }, [chatKey, enabled, resetEvents]);

  useEffect(() => {
    if (!enabled) return;
    const connectionTracker = connectionTrackerRef.current;
    if (!visible) {
      setLoading(false);
      setRefreshing(false);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      clearTimer();
      return;
    }
    startSubscription();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      pendingEventsRef.current = [];
      connectionTracker.reset();
      subscriptionResolvingRef.current = false;
      clearTimer();
    };
  }, [clearTimer, enabled, startSubscription, visible]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    resetEvents();
    startSubscription(true);
  }, [resetEvents, startSubscription]);
  const header = useCallback(
    () => (
      <ChatHeader
        activeTab={activeTab}
        messagesCount={conversations.messages.length}
        requestsCount={conversations.requests.length}
        relays={relays}
        statuses={relayStatuses}
        onSelectTab={setActiveTab}
      />
    ),
    [
      activeTab,
      conversations.messages.length,
      conversations.requests.length,
      relayStatuses,
      relays,
    ],
  );

  const stickyHeader = useCallback(
    () => (
      <ChatHeader
        activeTab={activeTab}
        messagesCount={conversations.messages.length}
        requestsCount={conversations.requests.length}
        relays={relays}
        statuses={relayStatuses}
        onSelectTab={setActiveTab}
        sticky
      />
    ),
    [
      activeTab,
      conversations.messages.length,
      conversations.requests.length,
      relayStatuses,
      relays,
    ],
  );

  const empty = (
    <View className="px-3 py-16">
      <Text className="text-center text-base font-semibold text-slate-700">
        {pubkey ? 'No chats yet' : 'Sign in to see chats'}
      </Text>
      <Text className="mt-2 text-center text-sm text-slate-500">
        {pubkey
          ? 'Kind 4 subscriptions are ready; conversations appear here once messages arrive.'
          : 'Chat uses your account pubkey to load direct-message conversations.'}
      </Text>
    </View>
  );

  return (
    <Feed
      items={items}
      getItemId={item => item.chatId}
      pullToRefresh
      header={header}
      stickyHeader={stickyHeader}
      stickyHeaderSafeAreaColor="rgba(248, 250, 252, 0.95)"
      renderItem={({item}) => (
        <ChatRow
          conversation={item}
          pubkey={pubkey}
        />
      )}
      loading={loading || refreshing}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      empty={empty}
      contentContainerClassName="pb-28"
    />
  );
}

function ChatHeader({
  activeTab,
  messagesCount,
  requestsCount,
  relays,
  statuses,
  onSelectTab,
  sticky = false,
}: {
  activeTab: ChatListTab;
  messagesCount: number;
  requestsCount: number;
  relays: string[];
  statuses: Record<string, string>;
  onSelectTab: (tab: ChatListTab) => void;
  sticky?: boolean;
}) {
  return (
    <View className={`${sticky ? 'border-b border-slate-200 bg-slate-50/95' : 'bg-slate-50'}`}>
      <View className={`${sticky ? '' : 'rounded-lg bg-white/90 px-3 py-3 shadow-sm'}`}>
        <View className="h-14 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="text-2xl font-bold text-slate-900">BM</Text>
            <Pressable className="h-8 w-8 items-center justify-center rounded-full bg-slate-100">
              <Info size={17} color="#52616f" strokeWidth={2.2} />
            </Pressable>
          </View>
          <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-emerald-600 bg-white">
            <MessageCirclePlus size={19} color="#1f7a5a" strokeWidth={2.2} />
          </Pressable>
        </View>
        {!sticky ? <RelaysList relays={relays} statuses={statuses} /> : null}
        <View className="mt-3 flex-row rounded-lg bg-slate-100 p-1">
          <ChatTab
            active={activeTab === 'messages'}
            label="messages"
            count={messagesCount}
            onPress={() => onSelectTab('messages')}
          />
          <ChatTab
            active={activeTab === 'requests'}
            label="requests"
            count={requestsCount}
            onPress={() => onSelectTab('requests')}
          />
        </View>
      </View>
    </View>
  );
}

function ChatTab({
  active,
  label,
  count,
  onPress,
}: {
  active: boolean;
  label: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="min-h-10 flex-1 flex-row items-center justify-center gap-2 rounded-md px-3"
      style={active ? styles.chatTabActive : null}
      onPress={onPress}
    >
      <Text className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>
        {label}
      </Text>
      <View className={`${active ? 'bg-emerald-700' : 'bg-slate-300'} min-w-5 rounded-full px-1.5 py-0.5`}>
        <Text className={`text-center text-[11px] font-bold ${active ? 'text-white' : 'text-slate-700'}`}>
          {count}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Keep active shadow/background out of dynamic className changes. NativeWind
  // can emit an upgrade warning for Pressable shadows, and that warning
  // stringifier trips React Navigation's default context getters in dev.
  chatTabActive: {
    backgroundColor: '#ffffff',
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
});

function ChatRow({
  conversation,
  pubkey,
}: {
  conversation: Conversation;
  pubkey: string | null;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const kind4 = asKind4(conversation.latest) as Kind4Parsed | null;
  const parsedContent = kind4 ? fbArray(kind4, 'parsedContent') : [];
  const outgoing = conversation.latest.pubkey() === pubkey;

  return (
    <Pressable
      className="mt-1 min-h-24 flex-row gap-3 overflow-hidden rounded-lg bg-white/90 px-3 py-4 shadow-sm"
      onPress={event => {
        event.stopPropagation();
        if (!wasRecentSwipeGesture()) {
          pushDistinct(navigation, 'ChatThread', {
            peerPubkey: conversation.peerPubkey,
          });
        }
      }}
    >
      <Avatar pubkey={conversation.peerPubkey} size="lg" />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <User
            pubkey={conversation.peerPubkey}
            className="shrink text-base font-semibold text-slate-900"
          />
          <Text className="shrink-0 text-xs text-slate-500">
            {formatRelativeTime(conversation.latest.createdAt())}
          </Text>
        </View>
        <View className="mt-1 max-h-10 overflow-hidden">
          {outgoing ? (
            <Text className="text-sm font-semibold text-emerald-700">you:</Text>
          ) : null}
          <ContentBlocks content={parsedContent} showQuote={false} />
        </View>
      </View>
    </Pressable>
  );
}
