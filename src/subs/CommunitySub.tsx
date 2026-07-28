import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import {MenuView} from '@react-native-menu/menu';
import {useNavigation} from 'expo-router/react-navigation';
import {
  NpubLimiterPipeConfigT,
  ParsePipeConfigT,
  PipeConfig,
  PipeT,
  SerializeEventsPipeConfigT,
  type ParsedEvent,
} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asKind20,
  asKind6,
  asParsedEvent,
  asPreGeneric,
  fbArray,
} from '@candypoets/nipworker/utils';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  RadioTower,
  Send,
  UserPlus,
  Users,
} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Feed} from '../components/Feed';
import {Note} from '../components/notes';
import {Avatar} from '../components/notes/Avatar';
import {eventTags, stringValue, tagValue} from '../components/notes/kindHelpers';
import {fetchRelayInfosForRelays, normalizeRelayUrl} from '../nostr/nip11';
import type {AppNavigationProp} from '../navigation/types';
import {useRelayStore, type FeedKind} from '../stores';
import {useAppTheme} from '../theme';

type CommunityKindFilterId = 'notes' | 'media' | 'polls' | 'articles';

type CommunitySubProps = {
  description?: string;
  icon?: string;
  name?: string;
  onClose: () => void;
  relationship?: 'follow' | 'belong';
  relay: string;
  visible: boolean;
};

type CommunityTab = {
  id: CommunityKindFilterId;
  kinds: FeedKind[];
  label: string;
};

type CommunityCalendarEvent = {
  id: string;
  address: string;
  attendeeCount: number;
  capacity: number;
  image?: string;
  location: string;
  relays: string[];
  start: number;
  title: string;
  description: string;
};

type CommunityRsvpStatus = 'accepted' | 'declined' | 'tentative';

type CommunityRsvpSummary = {
  accepted: number;
  declined: number;
  tentative: number;
  acceptedPubkeys: string[];
};

type CommunityRsvp = {
  address: string;
  createdAt: number;
  pubkey: string;
  status: CommunityRsvpStatus;
};

const COMMUNITY_TABS: CommunityTab[] = [
  {id: 'notes', kinds: [1, 6], label: 'Notes'},
  {id: 'media', kinds: [20, 22], label: 'Media'},
  {id: 'polls', kinds: [1068], label: 'Polls'},
  {id: 'articles', kinds: [30023], label: 'Articles'},
];
const COMMUNITY_EMPTY_TIMEOUT_MS = 2400;
const COMMUNITY_EVENT_KINDS = [31922, 31923];
const RSVP_KIND = 31925;
const RSVP_LIMIT_PER_PUBKEY = 1;
const RSVP_MAX_PUBKEYS = 1000;

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

function relayHash(relay: string) {
  return relay.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
}

function communityColor(url: string) {
  let hash = 0;
  for (let index = 0; index < url.length; index += 1) {
    hash = (hash * 31 + url.charCodeAt(index)) % 360;
  }
  return `hsl(${hash}, 74%, 42%)`;
}

function shouldShowCommunityPost(event: ParsedEvent) {
  const kind = event.kind();
  if (kind === 1 || kind === 6) {
    const kind1 = asKind1(event);
    if (kind1) {
      const reply = kind1.reply()?.id();
      const root = kind1.root()?.id();
      if (reply && !root) return false;
      if (reply && root && reply !== root) return false;
    }
    if (kind === 6) {
      const kind6 = asKind6(event);
      if (!kind6?.repostedEvent()) return false;
    }
  } else if (kind === 20) {
    const kind20 = asKind20(event);
    if (kind20 && fbArray(kind20, 'images').some(image => !image.dim())) {
      return false;
    }
  }
  return true;
}

function parseCalendarEvent(event: ParsedEvent): CommunityCalendarEvent | null {
  if (!COMMUNITY_EVENT_KINDS.includes(event.kind())) return null;
  const id = event.id();
  const tags = eventTags(event);
  const pre = asPreGeneric(event);
  const d = stringValue(pre?.d()) || tagValue(tags, 'd');
  const startTag = tagValue(tags, 'start') || tagValue(tags, 'starts');
  const start =
    event.kind() === 31922
      ? Math.floor(Date.parse(`${startTag}T00:00:00`) / 1000)
      : pre
        ? Number(pre.starts())
        : Number(startTag);
  if (!id || !d || !start || start < Math.floor(Date.now() / 1000)) return null;
  const participants = pre ? fbArray(pre, 'participants') : [];
  const currentParticipants = Number(pre?.currentParticipants?.() ?? 0);
  const capacity = Number(tagValue(tags, 'capacity') || 0);
  const description =
    tagValue(tags, 'summary').trim() ||
    stringValue(pre?.description()).trim() ||
    stringValue(pre?.content()).trim();
  return {
    id,
    address: `${event.kind()}:${event.pubkey()}:${d}`,
    attendeeCount: currentParticipants || participants.length,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
    description,
    image: stringValue(pre?.image()) || tagValue(tags, 'image') || undefined,
    location: stringValue(pre?.location()) || tagValue(tags, 'location'),
    relays: [],
    start,
    title:
      stringValue(pre?.title()).trim() ||
      tagValue(tags, 'title').trim() ||
      tagValue(tags, 'name').trim() ||
      description ||
      'Community event',
  };
}

function parseRsvp(event: ParsedEvent, addresses: Set<string>): CommunityRsvp | null {
  if (event.kind() !== RSVP_KIND) return null;
  const pubkey = event.pubkey();
  if (!pubkey) return null;

  const tags = eventTags(event);
  const pre = asPreGeneric(event);
  const address = tagValue(tags, 'a');
  const status = stringValue(pre?.status()) || tagValue(tags, 'status');
  if (!address || !addresses.has(address)) return null;
  if (status !== 'accepted' && status !== 'declined' && status !== 'tentative') {
    return null;
  }

  return {
    address,
    createdAt: event.createdAt(),
    pubkey,
    status,
  };
}

function summarizeRsvps(
  rsvpsByAddress: Record<string, Record<string, CommunityRsvp>>,
  address: string,
): CommunityRsvpSummary {
  const latestByPubkey = Object.values(rsvpsByAddress[address] ?? {});
  const acceptedPubkeys = latestByPubkey
    .filter(rsvp => rsvp.status === 'accepted')
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(rsvp => rsvp.pubkey);

  return {
    accepted: acceptedPubkeys.length,
    acceptedPubkeys,
    declined: latestByPubkey.filter(rsvp => rsvp.status === 'declined').length,
    tentative: latestByPubkey.filter(rsvp => rsvp.status === 'tentative').length,
  };
}

function rsvpPipeline(subId: string) {
  return [
    new PipeT(PipeConfig.ParsePipeConfig, new ParsePipeConfigT()),
    new PipeT(
      PipeConfig.NpubLimiterPipeConfig,
      new NpubLimiterPipeConfigT(
        RSVP_KIND,
        RSVP_LIMIT_PER_PUBKEY,
        RSVP_MAX_PUBKEYS,
      ),
    ),
    new PipeT(
      PipeConfig.SerializeEventsPipeConfig,
      new SerializeEventsPipeConfigT(subId),
    ),
  ];
}

function formatEventMonth(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {month: 'short'})
    .format(new Date(timestamp * 1000))
    .toUpperCase();
}

function formatEventDay(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {day: 'numeric'}).format(
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

function EventCard({
  event,
  rsvpSummary,
}: {
  event: CommunityCalendarEvent;
  rsvpSummary: CommunityRsvpSummary;
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<AppNavigationProp>();
  const goingCount = rsvpSummary.accepted || event.attendeeCount;
  const acceptedPubkeys = rsvpSummary.acceptedPubkeys.slice(0, 3);
  const spotsLeft = event.capacity
    ? Math.max(0, event.capacity - goingCount)
    : null;

  return (
    <Pressable
      className="w-60 overflow-hidden rounded-lg border border-base-200 bg-base-300"
      onPress={() => {
        const relay = event.relays[0] || '';
        if (!relay || !event.address) return;
        navigation.navigate('CalendarEvent', {relay, address: event.address});
      }}
    >
      <View className="h-28 bg-base-200">
        {event.image ? (
          <Image
            source={{uri: event.image}}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View className="h-full w-full items-center justify-center bg-base-200">
            <CalendarDays size={34} color={theme.colors.primary} />
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

      <View className="min-h-[116px] p-3">
        <Text className="text-base font-bold text-base-content" numberOfLines={1}>
          {event.title}
        </Text>
        <Text className="mt-2 text-sm font-medium text-primary-content" numberOfLines={1}>
          {formatEventTime(event.start)}
        </Text>
        {event.location ? (
          <Text className="mt-1 text-sm font-medium text-primary-content" numberOfLines={1}>
            {event.location}
          </Text>
        ) : null}
        <View className="mt-auto flex-row items-center pt-4">
          <View className="mr-2 h-6 flex-row items-center">
            {acceptedPubkeys.length ? (
              acceptedPubkeys.map((pubkey, index) => (
                <View
                  key={pubkey}
                  className={`overflow-hidden rounded-full border border-base-300 ${
                    index ? '-ml-2' : ''
                  }`}
                >
                  <Avatar pubkey={pubkey} size="zap" link={false} />
                </View>
              ))
            ) : (
              <View className="h-6 w-6 items-center justify-center rounded-full bg-primary/20">
                <Users size={12} color={theme.colors.primary} />
              </View>
            )}
          </View>
          <Text className="text-sm font-semibold text-primary">
            {goingCount} going
          </Text>
          {rsvpSummary.tentative ? (
            <Text className="ml-2 text-xs font-medium text-primary-content">
              {rsvpSummary.tentative} maybe
            </Text>
          ) : null}
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

const CommunityStickyHeader = memo(function CommunityStickyHeader({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View className="h-16 flex-row items-center justify-between px-4">
      <Pressable
        className="h-9 w-9 items-center justify-center rounded-full bg-base-200"
        hitSlop={12}
        onPress={onClose}
      >
        <ChevronLeft size={22} color={theme.colors.primaryContent} />
      </Pressable>
      <Text className="text-base font-semibold text-base-content" numberOfLines={1}>
        {name}
      </Text>
      <View className="h-9 w-9" />
    </View>
  );
});

function CommunityTabs({
  selectedId,
  onSelect,
}: {
  selectedId: CommunityKindFilterId;
  onSelect: (id: CommunityKindFilterId) => void;
}) {
  const [tabWidth, setTabWidth] = useState(0);
  const underlineX = useRef(new Animated.Value(0)).current;
  const selectedIndex = Math.max(
    0,
    COMMUNITY_TABS.findIndex(tab => tab.id === selectedId),
  );

  useEffect(() => {
    if (!tabWidth) return;
    Animated.timing(underlineX, {
      toValue: selectedIndex * tabWidth,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selectedIndex, tabWidth, underlineX]);

  return (
    <View
      className="relative flex-row"
      onLayout={event => {
        const nextWidth = event.nativeEvent.layout.width / COMMUNITY_TABS.length;
        setTabWidth(current =>
          Math.abs(current - nextWidth) < 0.5 ? current : nextWidth,
        );
      }}
    >
      <Animated.View
        className="absolute -bottom-2 left-0 h-0.5 rounded-full bg-primary"
        style={{width: tabWidth, transform: [{translateX: underlineX}]}}
      />
      {COMMUNITY_TABS.map(tab => {
        const selected = tab.id === selectedId;
        return (
          <Pressable
            key={tab.id}
            accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${tab.label}`}
            accessibilityState={{selected}}
            className="h-10 flex-1 items-center justify-center"
            onPress={() => {
              if (!selected) onSelect(tab.id);
            }}
          >
            <Text
              className={`text-base font-semibold ${
                selected ? 'text-base-content' : 'text-primary-content'
              }`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const CommunityHeader = memo(function CommunityHeader({
  description,
  icon,
  name,
  onClose,
  relationship,
  relay,
  selectedTab,
  onSelectTab,
  upcomingEvents,
  rsvpsByAddress,
}: {
  description: string;
  icon?: string;
  name: string;
  onClose: () => void;
  relationship?: 'follow' | 'belong';
  relay: string;
  selectedTab: CommunityKindFilterId;
  onSelectTab: (id: CommunityKindFilterId) => void;
  rsvpsByAddress: Record<string, Record<string, CommunityRsvp>>;
  upcomingEvents: CommunityCalendarEvent[];
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(0, insets.top - 8);
  const memberLabel = relationship === 'belong' ? 'Belongs to' : 'Following';

  return (
    <View className="overflow-hidden rounded-lg bg-base-300/95">
      <View
        style={[
          styles.hero,
          {paddingTop: topInset + 20, backgroundColor: communityColor(relay)},
        ]}
      >
        <View className="flex-row items-center justify-between px-4">
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full bg-base-300/80"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronLeft size={22} color={theme.colors.primaryContent} />
          </Pressable>
          <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-base-300/80">
            <MoreHorizontal size={22} color={theme.colors.primaryContent} />
          </Pressable>
        </View>
      </View>

      <View className="-mt-10 px-4 pb-4">
        <View className="flex-row items-end justify-between gap-3">
          <View
            className="h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white bg-base-200"
          >
            {icon ? (
              <Image source={{uri: icon}} style={styles.image} contentFit="cover" />
            ) : (
              <RadioTower size={38} color={theme.colors.primaryContent} />
            )}
          </View>
          <MenuView
            title="Community status"
            actions={[
              {
                id: 'status',
                title: memberLabel,
                attributes: {disabled: true},
              },
              {
                id: 'public',
                title: 'Public community',
                attributes: {disabled: true},
              },
            ]}
          >
            <Pressable className="flex-row items-center gap-2 rounded-full border border-primary px-4 py-2">
              <Text className="text-sm font-bold text-primary">
                {memberLabel}
              </Text>
              <ChevronDown size={16} color={theme.colors.primary} />
            </Pressable>
          </MenuView>
        </View>

        <Text className="mt-4 text-3xl font-bold text-base-content" numberOfLines={2}>
          {name}
        </Text>
        <Text className="mt-1 text-base font-medium text-primary-content" numberOfLines={1}>
          Public community · {relayLabel(relay)}
        </Text>
        <Text className="mt-5 text-base leading-6 text-primary-content">
          {description || 'Public relay community.'}
        </Text>
        <Text className="mt-5 text-base font-medium text-primary-content">
          Public
        </Text>

        <View className="mt-6 flex-row gap-3">
          <Pressable className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-base-200">
            <Send size={20} color={theme.colors.primary} />
            <Text className="text-base font-bold text-base-content">Share</Text>
          </Pressable>
          <Pressable className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-base-200">
            <UserPlus size={20} color={theme.colors.primary} />
            <Text className="text-base font-bold text-base-content">Invite</Text>
          </Pressable>
        </View>

        <View className="mt-6 border-t border-base-200 pt-4">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-bold text-base-content">
              Upcoming events
            </Text>
            {upcomingEvents.length ? (
              <Text className="text-sm font-bold text-primary">See all</Text>
            ) : null}
          </View>
          {upcomingEvents.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 pr-4"
            >
              {upcomingEvents.slice(0, 3).map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  rsvpSummary={summarizeRsvps(rsvpsByAddress, event.address)}
                />
              ))}
            </ScrollView>
          ) : (
            <Text className="text-sm font-medium text-primary-content">
              No upcoming events
            </Text>
          )}
        </View>

        <View className="mt-6">
          <Text className="text-xl font-bold text-base-content">
            Recent activity
          </Text>
          <View className="mt-3">
            <CommunityTabs selectedId={selectedTab} onSelect={onSelectTab} />
          </View>
        </View>
      </View>
    </View>
  );
});

export function CommunitySub({
  description: descriptionParam,
  icon: iconParam,
  name: nameParam,
  onClose,
  relationship,
  relay,
  visible,
}: CommunitySubProps) {
  const normalizedRelay = useMemo(() => normalizeRelayUrl(relay), [relay]);
  const relayInfos = useRelayStore(state => state.relayInfos);
  const relayInfo = relayInfos[normalizedRelay]?.info;
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [selectedTab, setSelectedTab] = useState<CommunityKindFilterId>('notes');
  const [items, setItems] = useState<ParsedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [emptyTimedOut, setEmptyTimedOut] = useState(false);
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const flushRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const emptyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const eventUnsubscribeRef = useRef<(() => void) | null>(null);
  const rsvpUnsubscribeRef = useRef<(() => void)[]>([]);
  const rsvpsRef = useRef<Record<string, Record<string, CommunityRsvp>>>({});
  const [rsvpsByAddress, setRsvpsByAddress] = useState<
    Record<string, Record<string, CommunityRsvp>>
  >({});
  const [upcomingEvents, setUpcomingEvents] = useState<CommunityCalendarEvent[]>(
    [],
  );
  const requestKinds = useMemo(
    () => COMMUNITY_TABS.find(tab => tab.id === selectedTab)?.kinds ?? [1, 6],
    [selectedTab],
  );
  const name = nameParam || relayInfo?.name || relayLabel(normalizedRelay);
  const description = descriptionParam || relayInfo?.description || '';
  const icon = iconParam || relayInfo?.icon;

  useEffect(() => {
    fetchRelayInfosForRelays([normalizedRelay]);
  }, [normalizedRelay]);

  useEffect(() => {
    setUpcomingEvents([]);
    rsvpsRef.current = {};
    setRsvpsByAddress({});
    rsvpUnsubscribeRef.current.forEach(unsubscribe => unsubscribe());
    rsvpUnsubscribeRef.current = [];
  }, [normalizedRelay]);

  const addItem = useCallback((event: ParsedEvent) => {
    if (!shouldShowCommunityPost(event)) return;
    const id = event.id();
    if (!id || seenIdsRef.current.has(id)) return;
    seenIdsRef.current.add(id);
    itemsRef.current.push(event);
    if (flushRef.current) return;
    flushRef.current = requestAnimationFrame(() => {
      flushRef.current = null;
      itemsRef.current.sort((left, right) => right.createdAt() - left.createdAt());
      setItems([...itemsRef.current]);
    });
  }, []);

  useEffect(() => {
    itemsRef.current = [];
    seenIdsRef.current.clear();
    setItems([]);
    setEmptyTimedOut(false);
  }, [normalizedRelay, selectedTab]);

  useEffect(() => {
    if (!visible || !normalizedRelay) return undefined;

    const subId = `community_nocache_${relayHash(normalizedRelay)}_${requestKinds.join('-')}`;
    setLoading(true);
    setEmptyTimedOut(false);
    setSubRelays(subId, [normalizedRelay]);
    setRelayStatus(normalizedRelay, 'SUBSCRIBED');
    if (emptyTimeoutRef.current) clearTimeout(emptyTimeoutRef.current);
    emptyTimeoutRef.current = setTimeout(() => {
      if (!itemsRef.current.length) {
        setLoading(false);
        setEmptyTimedOut(true);
      }
    }, COMMUNITY_EMPTY_TIMEOUT_MS);

    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: requestKinds,
          limit: 50,
          noCache: true,
          relays: [normalizedRelay],
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) {
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          }
          if (relayStatus === 'EOSE') {
            setLoading(false);
            if (!itemsRef.current.length) setEmptyTimedOut(true);
          }
          return;
        }

        const event = asParsedEvent(message);
        if (!event || !requestKinds.includes(event.kind() as FeedKind)) return;
        addItem(event);
      },
      {bytesPerEvent: 10 * 1024},
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (flushRef.current) {
        cancelAnimationFrame(flushRef.current);
        flushRef.current = null;
      }
      if (emptyTimeoutRef.current) {
        clearTimeout(emptyTimeoutRef.current);
        emptyTimeoutRef.current = null;
      }
    };
  }, [
    addItem,
    normalizedRelay,
    requestKinds,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !normalizedRelay) return undefined;

    const events = new Map<string, CommunityCalendarEvent>();
    const subId = `community_events_nocache_${relayHash(normalizedRelay)}`;
    setSubRelays(subId, [normalizedRelay]);
    eventUnsubscribeRef.current?.();
    eventUnsubscribeRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: COMMUNITY_EVENT_KINDS,
          limit: 20,
          noCache: true,
          relays: [normalizedRelay],
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) {
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          }
          return;
        }
        const parsed = asParsedEvent(message);
        if (!parsed) return;
        const event = parseCalendarEvent(parsed);
        if (!event) return;
        event.relays = [normalizedRelay];
        events.set(event.id, event);
        setUpcomingEvents(
          Array.from(events.values()).sort((left, right) => left.start - right.start),
        );
      },
      {bytesPerEvent: 8 * 1024, closeOnEose: true},
    );

    return () => {
      eventUnsubscribeRef.current?.();
      eventUnsubscribeRef.current = null;
    };
  }, [normalizedRelay, setRelayStatus, setSubRelays, visible]);

  const eventAddresses = useMemo(
    () => upcomingEvents.map(event => event.address).filter(Boolean),
    [upcomingEvents],
  );
  const eventAddressKey = eventAddresses.join('|');

  useEffect(() => {
    if (!visible || !normalizedRelay || !eventAddresses.length) return undefined;

    rsvpUnsubscribeRef.current.forEach(unsubscribe => unsubscribe());
    rsvpUnsubscribeRef.current = eventAddresses.map(address => {
      const addresses = new Set([address]);
      const subId = `community_rsvps_nocache_${relayHash(normalizedRelay)}_${relayHash(address)}`;
      setSubRelays(subId, [normalizedRelay]);

      return subscribeToNostr(
        subId,
        [
          {
            kinds: [RSVP_KIND],
            limit: 500,
            noCache: true,
            relays: [normalizedRelay],
            tags: {'#a': [address]},
          },
        ],
        message => {
          const status = asConnectionStatus(message);
          if (status) {
            const relayUrl = status.relayUrl();
            const relayStatus = status.status()?.toString();
            if (relayUrl && relayStatus) {
              setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
            }
            return;
          }

          const parsed = asParsedEvent(message);
          if (!parsed) return;
          const rsvp = parseRsvp(parsed, addresses);
          if (!rsvp) return;

          const current = rsvpsRef.current[rsvp.address]?.[rsvp.pubkey];
          if (current && current.createdAt >= rsvp.createdAt) return;
          rsvpsRef.current = {
            ...rsvpsRef.current,
            [rsvp.address]: {
              ...(rsvpsRef.current[rsvp.address] ?? {}),
              [rsvp.pubkey]: rsvp,
            },
          };
          setRsvpsByAddress(rsvpsRef.current);
        },
        {
          bytesPerEvent: 4 * 1024,
          closeOnEose: true,
          pipeline: rsvpPipeline(subId),
        },
      );
    });

    return () => {
      rsvpUnsubscribeRef.current.forEach(unsubscribe => unsubscribe());
      rsvpUnsubscribeRef.current = [];
    };
  }, [
    eventAddressKey,
    eventAddresses,
    normalizedRelay,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  const header = useCallback(
    () => (
      <CommunityHeader
        description={description}
        icon={icon}
        name={name}
        onClose={onClose}
        relationship={relationship}
        relay={normalizedRelay}
        rsvpsByAddress={rsvpsByAddress}
        selectedTab={selectedTab}
        onSelectTab={setSelectedTab}
        upcomingEvents={upcomingEvents}
      />
    ),
    [
      description,
      icon,
      name,
      normalizedRelay,
      onClose,
      relationship,
      rsvpsByAddress,
      selectedTab,
      upcomingEvents,
    ],
  );
  const stickyHeader = useCallback(
    () => <CommunityStickyHeader name={name} onClose={onClose} />,
    [name, onClose],
  );
  const renderItem = useCallback(
    ({item, visible: itemVisible}: {item: ParsedEvent; visible: boolean}) => (
      <Note note={item} visible={visible && itemVisible} />
    ),
    [visible],
  );
  const getItemId = useCallback(
    (item: ParsedEvent) => item.id() || item.createdAt(),
    [],
  );
  const empty = (
    <View className="px-6 py-16">
      <Text className="text-center text-base font-semibold text-primary-content">
        {emptyTimedOut ? 'No community posts yet.' : 'Loading community posts...'}
      </Text>
    </View>
  );

  return (
    <Feed
      items={items}
      getItemId={getItemId}
      header={header}
      headerSafeArea={false}
      stickyHeader={stickyHeader}
      renderItem={renderItem}
      loading={loading}
      visible={visible}
      removeClippedSubviews={false}
      empty={empty}
      contentContainerClassName="pb-28"
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 170,
  },
  image: {
    height: '100%',
    width: '100%',
  },
});
