import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import type {
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asParsedEvent,
  asPreGeneric,
  fbArray,
} from '@candypoets/nipworker/utils';
import type {EventTemplate} from 'nostr-tools';
import {
  CalendarClock,
  CalendarX,
  ChevronLeft,
  MapPin,
  Ticket,
  Users,
} from 'lucide-react-native';
import {useRouter} from 'expo-router';
import {useNavigation} from 'expo-router/react-navigation';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Avatar, User} from '../components/notes';
import {eventTags, stringValue, tagValue} from '../components/notes/kindHelpers';
import {awardBadgeAddress, useMyAwards} from '../hooks/useAwards';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {pushDistinct} from '../navigation/pushDistinct';
import type {AppNavigationProp} from '../navigation/types';
import {useAuthStore, useNostrStore, useRelayStore} from '../stores';
import {normalizeRelayUrl} from '../nostr/nip11';
import {useAppTheme} from '../theme';

type CalendarEventModalProps = {
  relay: string;
  address: string;
  onClose: () => void;
};

type CalendarEventDetail = {
  id: string;
  address: string;
  attendeeCount: number;
  capacity: number;
  description: string;
  entranceBadge?: string;
  image?: string;
  location: string;
  relays: string[];
  start: number;
  title: string;
};

const CALENDAR_EVENT_KINDS = [31922, 31923];
const RSVP_KIND = 31925;

function uniqueRelays(relays: string[]) {
  return [...new Set(relays.filter(Boolean).map(normalizeRelayUrl))];
}

function splitAddress(value: string) {
  const [kind, author, ...rest] = value.split(':');
  return {kind: Number(kind), author, d: rest.join(':')};
}

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

function parseCalendarEvent(
  event: ParsedEvent,
  relays: string[],
): CalendarEventDetail | null {
  if (!CALENDAR_EVENT_KINDS.includes(event.kind())) return null;
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
  if (!id || !d || !start) return null;

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
    entranceBadge: tagValue(tags, 'entrance_badge') || undefined,
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

function formatTime(timestamp?: number) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function formatCalendarDay(timestamp?: number) {
  if (!timestamp) return ['', ''];
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp * 1000)).split(' ');
}

const AttendeeRow = memo(function AttendeeRow({pubkey}: {pubkey: string}) {
  const router = useRouter();
  return (
    <Pressable
      className="flex-row items-center gap-3 rounded-xl bg-base-200 p-3"
      onPress={() =>
        pushDistinct(router, {
          pathname: '/PublicProfile',
          params: {pubkey},
        })
      }
    >
      <Avatar pubkey={pubkey} size="lg" link={false} />
      <View className="min-w-0 flex-1">
        <User pubkey={pubkey} link={false} className="text-sm font-semibold text-base-content" />
        <Text className="mt-1 text-xs font-medium text-primary-content">
          RSVP accepted
        </Text>
      </View>
    </Pressable>
  );
});

export function CalendarEventModal({
  relay,
  address,
  onClose,
}: CalendarEventModalProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation =
    useNavigation<AppNavigationProp>();
  const pubkey = useAuthStore(state => state.pubkey);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const [event, setEvent] = useState<CalendarEventDetail | null>(null);
  const [eventRaw, setEventRaw] = useState<ParsedEvent | null>(null);
  const [attendeeEvents, setAttendeeEvents] = useState<Record<string, ParsedEvent>>({});
  const [loading, setLoading] = useState(true);
  const [rsvpStatus, setRsvpStatus] = useState('');
  const eventUnsubRef = useRef<(() => void) | null>(null);
  const rsvpUnsubRef = useRef<(() => void) | null>(null);
  const publishUnsubRef = useRef<(() => void) | null>(null);
  // Latest RSVP status per pubkey, so a newer declined/tentative retracts an
  // earlier accepted (and out-of-order older events can't resurrect it).
  const rsvpLatestRef = useRef<Record<string, {createdAt: number; status: string}>>({});

  const selectedRelay = useMemo(() => normalizeRelayUrl(relay), [relay]);
  const relays = useMemo(
    () => uniqueRelays([selectedRelay, ...DEFAULT_FEED_RELAYS]),
    [selectedRelay],
  );
  const attendees = useMemo(
    () => Object.keys(attendeeEvents).sort(),
    [attendeeEvents],
  );
  const attendeeCount = attendees.length || event?.attendeeCount || 0;
  const hasRsvped = Boolean(pubkey && attendees.includes(pubkey));
  // The member's entrance ticket for this event, when they hold one.
  const {awards: myAwards} = useMyAwards(selectedRelay, pubkey, Boolean(event?.entranceBadge));
  const ticketAward = useMemo(
    () =>
      event?.entranceBadge
        ? myAwards.find(candidate => awardBadgeAddress(candidate) === event.entranceBadge)
        : undefined,
    [event?.entranceBadge, myAwards],
  );
  const spotsLeft = event?.capacity
    ? Math.max(0, event.capacity - attendeeCount)
    : null;
  const capacityLabel = event?.capacity
    ? `${attendeeCount}/${event.capacity}`
    : `${attendeeCount}`;
  const [month, day] = formatCalendarDay(event?.start);

  const handleConnectionStatus = useCallback(
    (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (!status) return false;
      const relayUrl = status.relayUrl();
      const relayStatus = status.status()?.toString();
      if (relayUrl) {
        const normalized = normalizeRelayUrl(relayUrl);
        if (relayStatus) setRelayStatus(normalized, relayStatus);
      }
      return true;
    },
    [setRelayStatus],
  );

  useEffect(() => {
    eventUnsubRef.current?.();
    rsvpUnsubRef.current?.();
    setEvent(null);
    setEventRaw(null);
    setAttendeeEvents({});
    setRsvpStatus('');
    setLoading(Boolean(address));
    rsvpLatestRef.current = {};

    if (!address) return undefined;

    const parsedAddress = splitAddress(address);
    if (!parsedAddress.kind || !parsedAddress.author || !parsedAddress.d) {
      setLoading(false);
      return undefined;
    }

    const eventSubId = `event_detail_${address}_${selectedRelay}`;
    const eventRequests: RequestObject[] = [
      {
        kinds: [parsedAddress.kind],
        authors: [parsedAddress.author],
        tags: {'#d': [parsedAddress.d]},
        limit: 1,
        noCache: true,
        relays,
      },
    ];
    setSubRelays(eventSubId, relays);
    eventUnsubRef.current = subscribeToNostr(
      eventSubId,
      eventRequests,
      message => {
        if (handleConnectionStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (!parsed) return;
        setEventRaw(parsed);
        setEvent(parseCalendarEvent(parsed, relays));
        setLoading(false);
      },
      {bytesPerEvent: 12 * 1024, closeOnEose: true},
    );

    const rsvpSubId = `event_rsvps_${address}_${selectedRelay}`;
    setSubRelays(rsvpSubId, relays);
    rsvpUnsubRef.current = subscribeToNostr(
      rsvpSubId,
      [{kinds: [RSVP_KIND], noCache: true, relays, tags: {'#a': [address]}}],
      message => {
        if (handleConnectionStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (!parsed) return;
        const rsvpPubkey = parsed.pubkey();
        if (!rsvpPubkey) return;
        const tags = eventTags(parsed);
        const status =
          stringValue(asPreGeneric(parsed)?.content?.()) ||
          tagValue(tags, 'status') ||
          'accepted';
        const createdAt = parsed.createdAt();
        const latest = rsvpLatestRef.current[rsvpPubkey];
        if (latest && latest.createdAt >= createdAt) return;
        rsvpLatestRef.current = {
          ...rsvpLatestRef.current,
          [rsvpPubkey]: {createdAt, status},
        };
        if (status !== 'accepted') {
          setAttendeeEvents(current => {
            if (!current[rsvpPubkey]) return current;
            const next = {...current};
            delete next[rsvpPubkey];
            return next;
          });
          return;
        }
        setAttendeeEvents(current => ({...current, [rsvpPubkey]: parsed}));
      },
      {bytesPerEvent: 4 * 1024, closeOnEose: true},
    );

    const timeout = setTimeout(() => setLoading(false), 1800);
    return () => {
      clearTimeout(timeout);
      eventUnsubRef.current?.();
      eventUnsubRef.current = null;
      rsvpUnsubRef.current?.();
      rsvpUnsubRef.current = null;
    };
  }, [address, handleConnectionStatus, relays, selectedRelay, setSubRelays]);

  useEffect(
    () => () => {
      publishUnsubRef.current?.();
    },
    [],
  );

  const publishRsvp = useCallback(() => {
    if (!pubkey) {
      navigation.navigate('Login');
      return;
    }
    if (!eventRaw || hasRsvped) return;
    const tags = eventTags(eventRaw);
    const pTags = tags.filter(tag => tag[0] === 'p' && tag.every(Boolean));
    const template: EventTemplate = {
      kind: RSVP_KIND,
      content: 'accepted',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['a', address],
        ['d', `${address}:${pubkey}`],
        ['status', 'accepted'],
        ...pTags,
      ],
    };
    const publishRelays = uniqueRelays([selectedRelay, ...writeRelays, ...relays]);
    setRsvpStatus('Publishing RSVP...');
    publishUnsubRef.current?.();
    publishUnsubRef.current = publishToNostr(
      `event_rsvp_${address}_${pubkey}`,
      template,
      message => {
        const status = asConnectionStatus(message);
        if (status?.status()?.toString() === 'true') {
          setRsvpStatus('You are going');
          rsvpLatestRef.current = {
            ...rsvpLatestRef.current,
            [pubkey]: {createdAt: template.created_at, status: 'accepted'},
          };
          setAttendeeEvents(current => ({...current, [pubkey]: eventRaw}));
        }
      },
      {defaultRelays: publishRelays, trackStatus: true},
    );
  }, [address, eventRaw, hasRsvped, navigation, pubkey, relays, selectedRelay, writeRelays]);

  return (
    <View className="flex-1 bg-base-100">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{paddingBottom: 120 + insets.bottom}}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className="space-y-5 p-5" style={{paddingTop: insets.top + 12}}>
            <View className="h-64 rounded-xl bg-base-200" />
            <View className="h-5 w-40 rounded bg-base-200" />
            <View className="h-9 w-4/5 rounded bg-base-200" />
            <View className="h-9 w-3/5 rounded bg-base-200" />
          </View>
        ) : event ? (
          <>
            <View className="relative overflow-hidden bg-base-200" style={styles.hero}>
              {event.image ? (
                <Image source={{uri: event.image}} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View className="absolute inset-0 bg-base-200" />
              )}
              <View className="absolute inset-0 bg-black/45" />
              <View
                className="relative flex-1 justify-end px-5 pb-6"
                style={{paddingTop: insets.top + 16}}
              >
                <Pressable
                  className="absolute left-4 h-10 w-10 items-center justify-center rounded-full bg-base-100/90"
                  style={{top: insets.top + 8}}
                  hitSlop={10}
                  onPress={onClose}
                >
                  <ChevronLeft size={22} color={theme.colors.primaryContent} />
                </Pressable>
                <View className="mb-5 flex-row items-end justify-between gap-4">
                  <View className="rounded-xl bg-base-100/95 p-3">
                    <Text className="text-center text-xs font-black uppercase text-primary">
                      {month}
                    </Text>
                    <Text className="text-center text-3xl font-black text-base-content">
                      {day}
                    </Text>
                  </View>
                  <View className="rounded-full bg-base-100/90 px-3 py-1.5">
                    <Text className="text-xs font-semibold text-primary-content">
                      {relayLabel(selectedRelay)}
                    </Text>
                  </View>
                </View>
                <View className="mb-2 flex-row items-center gap-2">
                  <CalendarClock size={18} color={theme.colors.primary} />
                  <Text className="text-sm font-semibold text-primary">
                    {formatTime(event.start)}
                  </Text>
                </View>
                <Text className="max-w-[280px] text-4xl font-black text-base-content">
                  {event.title}
                </Text>
              </View>
            </View>

            <View className="-mt-3 px-5 pb-8">
              <View className="rounded-2xl bg-base-100 p-4 shadow-xl shadow-base-content/10">
                <View className="flex-row overflow-hidden rounded-xl bg-base-200">
                  {[
                    ['Going', String(attendeeCount)],
                    ['Capacity', capacityLabel],
                    ['Spots', spotsLeft === null ? 'Open' : spotsLeft ? String(spotsLeft) : 'Full'],
                  ].map(([label, value]) => (
                    <View key={label} className="flex-1 p-3">
                      <Text className="text-[11px] font-semibold text-primary-content">
                        {label}
                      </Text>
                      <Text className="mt-1 font-mono text-xl font-black text-base-content">
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>
                {event.location ? (
                  <View className="mt-4 flex-row items-start gap-3">
                    <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <MapPin size={20} color={theme.colors.primary} />
                    </View>
                    <Text className="min-w-0 flex-1 pt-1 text-sm font-medium leading-5 text-primary-content">
                      {event.location}
                    </Text>
                  </View>
                ) : null}
              </View>

              {event.description ? (
                <View className="mt-6">
                  <Text className="text-sm font-black text-base-content">About</Text>
                  <Text className="mt-2 text-[15px] leading-7 text-primary-content">
                    {event.description}
                  </Text>
                </View>
              ) : null}

              <View className="mt-6">
                <View className="mb-3 flex-row items-center justify-between">
                  <Text className="text-sm font-black text-base-content">Who's going</Text>
                  <Text className="font-mono text-xs font-semibold text-primary-content">
                    {attendees.length}
                  </Text>
                </View>
                {attendees.length ? (
                  <View className="gap-2">
                    {attendees.map(attendee => (
                      <AttendeeRow key={attendee} pubkey={attendee} />
                    ))}
                  </View>
                ) : (
                  <View className="items-center rounded-2xl bg-base-200 p-5">
                    <View className="mb-3 h-12 w-12 items-center justify-center rounded-xl bg-base-100">
                      <Users size={24} color={theme.colors.primary} />
                    </View>
                    <Text className="text-sm font-semibold text-base-content">
                      No RSVPs yet
                    </Text>
                    <Text className="mt-1 text-center text-sm leading-5 text-primary-content">
                      Be the first person on the list.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center px-8 py-24" style={{paddingTop: insets.top + 80}}>
            <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-base-200">
              <CalendarX size={30} color={theme.colors.primaryContent} />
            </View>
            <Text className="text-xl font-black text-base-content">Event not found</Text>
            <Text className="mt-2 text-center text-sm leading-6 text-primary-content">
              The selected relay did not return this event.
            </Text>
          </View>
        )}
      </ScrollView>

      {event ? (
        <View
          className="absolute bottom-0 left-0 right-0 border-t border-base-200 bg-base-100/95 px-5 pt-3"
          style={{paddingBottom: insets.bottom + 12}}
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold text-base-content" numberOfLines={1}>
                {event.title}
              </Text>
              <Text className="text-xs font-medium text-primary-content">
                {rsvpStatus || (hasRsvped ? 'You are on the list' : `${attendeeCount} going`)}
              </Text>
            </View>
            {ticketAward ? (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-1.5 rounded-xl bg-primary px-4 py-3"
                onPress={() =>
                  pushDistinct(router, {
                    pathname: '/Award',
                    params: {relay: selectedRelay, award: ticketAward.id() || ''},
                  })
                }
              >
                <Ticket size={16} color="#ffffff" />
                <Text className="text-base font-bold text-white">Your ticket</Text>
              </Pressable>
            ) : null}
            <Pressable
              className={`min-w-28 items-center justify-center rounded-xl px-5 py-3 ${
                hasRsvped || spotsLeft === 0 || !pubkey ? 'bg-base-200' : 'bg-primary'
              }`}
              disabled={hasRsvped || spotsLeft === 0}
              onPress={publishRsvp}
            >
              <Text
                className={`text-base font-bold ${
                  hasRsvped || spotsLeft === 0 || !pubkey
                    ? 'text-primary-content'
                    : 'text-white'
                }`}
              >
                {!pubkey ? 'Login' : hasRsvped ? 'Going' : spotsLeft === 0 ? 'Full' : 'RSVP'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 320,
  },
});
