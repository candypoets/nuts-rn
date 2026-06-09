import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ConnectionStatus, ParsedEvent, WorkerMessage } from '@candypoets/nipworker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asParsedEvent,
  isConnectionStatus,
  parseContent,
} from '@candypoets/nipworker/utils';
import {
  ChevronLeft,
  CircleSlash,
  UserCheck,
  UserPlus,
  Volume2,
  Zap,
} from 'lucide-react-native';
import type { EventTemplate } from 'nostr-tools';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Feed } from '../components/Feed';
import { FeedKindIcon } from '../components/FeedKindIcon';
import { Avatar, Note, User } from '../components/notes';
import { RelaysList as HeaderRelaysList } from '../components/RelaysList';
import {
  ALL_FEED_KINDS,
  BOOTSTRAP_RELAYS,
  useAuthStore,
  useNostrStore,
  useRelayStore,
  type FeedKind,
} from '../stores';
import { useKind0ProfileData } from '../hooks/useKind0ProfileData';
import type { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme';

const fallbackProfileImage = require('../../assets/miss-profile.png');
const TOP_SAFE_AREA_OFFSET = 8;
const PRE_PUBLISH_LOOKUP_TIMEOUT_MS = 1200;
const REPLACEABLE_LIST_BYTES_PER_EVENT = 128 * 1024;
const PROFILE_EMPTY_TIMEOUT_MS = 2400;
type ProfileKindFilterId = 'notes' | 'articles' | 'polls' | 'images' | 'videos';
const PROFILE_KIND_FILTERS: Array<{
  id: ProfileKindFilterId;
  iconKind: FeedKind;
  kinds: FeedKind[];
  label: string;
}> = [
  { id: 'notes', iconKind: 1, kinds: [1, 6], label: 'Notes' },
  { id: 'articles', iconKind: 30023, kinds: [30023], label: 'Articles' },
  { id: 'polls', iconKind: 1068, kinds: [1068], label: 'Polls' },
  { id: 'images', iconKind: 20, kinds: [20], label: 'Images' },
  { id: 'videos', iconKind: 34235, kinds: [34235], label: 'Videos' },
];

type Kind0ProfileHeaderProps = {
  about: string;
  aboutContent: ParsedAboutBlock[];
  activeRelays: string[];
  banner: string | null;
  lnaddress: string;
  name: string;
  nip05: string;
  onClose: () => void;
  onFollowPress: () => void;
  onKindPress: (id: ProfileKindFilterId) => void;
  onMutePress: () => void;
  onZapPress: () => void;
  picture: string | null;
  pubkey: string;
  selectedKind: ProfileKindFilterId | null;
  followPending: boolean;
  following: boolean;
  mutePending: boolean;
  muted: boolean;
};

type Kind0StickyHeaderProps = {
  onClose: () => void;
  pubkey: string;
};

type Kind0ImageProps = {
  uri: string | null;
  fallback?: ImageSourcePropType;
  className: string;
};

type Kind0RelayBlockProps = {
  relays: string[];
};

type ParsedAboutBlock = {
  type: string | Uint8Array | null;
  text: string | Uint8Array | null;
  data?: {
    id?: string | Uint8Array | null;
    author?: string | Uint8Array | null;
  } | null;
};

function blockString(value: string | Uint8Array | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return new TextDecoder().decode(value);
}

function Kind0ProfileAbout({ content }: { content: ParsedAboutBlock[] }) {
  if (!content.length) return null;

  return (
    <Text className="text-[15px] leading-5 text-primary-content">
      {content.map((block, index) => {
        const type = blockString(block.type);
        const text = blockString(block.text);
        const displayText =
          index === 0
            ? text.trimStart()
            : index === content.length - 1
            ? text.trimEnd()
            : text;
        const key = `${type || 'block'}-${index}-${text}`;

        if (type === 'text') {
          return <Text key={key}>{displayText}</Text>;
        }

        if (type === 'link') {
          return (
            <Text
              key={key}
              className="text-primary"
              onPress={event => {
                event.stopPropagation();
                if (text) {
                  Linking.openURL(text).catch(() => {});
                }
              }}
            >
              {displayText}
            </Text>
          );
        }

        if (type === 'hashtag') {
          return (
            <Text key={key} className="font-semibold text-primary">
              {displayText}
            </Text>
          );
        }

        if (type === 'npub' || type === 'nprofile' || type === 'naddr') {
          const data = block.data && 'author' in block.data ? block.data : null;
          const pubkey = blockString(data?.author) || blockString(data?.id);
          if (pubkey) {
            return (
              <User
                key={key}
                pubkey={pubkey}
                link
                className="text-[15px] font-semibold text-primary"
              />
            );
          }
        }

        return displayText ? <Text key={key}>{displayText}</Text> : null;
      })}
    </Text>
  );
}

const Kind0TrackedImage = memo(function Kind0TrackedImage({
  className,
  fallback,
  uri,
}: Kind0ImageProps) {
  const source = useMemo(() => (uri ? { uri } : fallback), [fallback, uri]);

  if (!source) return null;

  return (
    <View className={className}>
      <Image
        source={source}
        style={styles.trackedImage}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  trackedImage: {
    height: '100%',
    width: '100%',
  },
});

const Kind0StickyHeader = memo(function Kind0StickyHeader({
  onClose,
  pubkey,
}: Kind0StickyHeaderProps) {
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
      <Avatar pubkey={pubkey} size="lg" />
      <View className="h-9 w-9" />
    </View>
  );
});

const Kind0RelayBlock = memo(function Kind0RelayBlock({
  relays,
}: Kind0RelayBlockProps) {
  const relayStatuses = useRelayStore(state => state.relayStatuses);

  return <HeaderRelaysList relays={relays} statuses={relayStatuses} mini />;
});

const Kind0ProfileHeader = memo(function Kind0ProfileHeader({
  about,
  aboutContent,
  activeRelays,
  banner,
  lnaddress,
  name,
  nip05,
  onClose,
  onFollowPress,
  onKindPress,
  onMutePress,
  onZapPress,
  picture,
  pubkey,
  selectedKind,
  followPending,
  following,
  mutePending,
  muted,
}: Kind0ProfileHeaderProps) {
  const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const topInset = Math.max(0, insets.top - TOP_SAFE_AREA_OFFSET);

  return (
    <View className="overflow-hidden rounded-lg bg-base-300/95">
      <View
        className="bg-base-300/95"
        style={{
          height: 208 + topInset,
          width: screenWidth,
        }}
      >
        <Kind0TrackedImage uri={banner} className="h-full w-full" />
        <View
          className="absolute left-0 right-0 top-0 h-20 flex-row items-center justify-between px-4"
          style={{ paddingTop: topInset + 24 }}
        >
          <Pressable
            className="h-9 w-9 items-center justify-center rounded-full bg-base-300/85"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronLeft size={22} color={iconColor} />
          </Pressable>
          <View className="h-9 w-9" />
        </View>
      </View>

      <View className="px-4 pb-4">
        <View className="-mt-16 mb-4 flex-row items-center gap-3">
          <View className="h-32 w-32 overflow-hidden rounded-full border border-white bg-base-200">
            <Kind0TrackedImage
              uri={picture}
              fallback={fallbackProfileImage}
              className="h-full w-full"
            />
          </View>
          <View className="flex-row gap-2">
            <Pressable
              accessibilityLabel={following ? 'Unfollow profile' : 'Follow profile'}
              accessibilityState={{ disabled: followPending, selected: following }}
              className={`h-10 w-10 items-center justify-center rounded-full border border-white bg-base-300/90 ${
                followPending ? 'opacity-50' : ''
              }`}
              disabled={followPending}
              hitSlop={8}
              onPress={onFollowPress}
            >
              {following ? (
                <UserCheck size={21} color={iconColor} />
              ) : (
                <UserPlus size={21} color={iconColor} />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="Zap profile"
              className="h-10 w-10 items-center justify-center rounded-full border border-white bg-base-300/90"
              hitSlop={8}
              onPress={onZapPress}
            >
              <Zap size={21} color={iconColor} />
            </Pressable>
            <Pressable
              accessibilityLabel={muted ? 'Unmute profile' : 'Mute profile'}
              accessibilityState={{ disabled: mutePending, selected: muted }}
              className={`h-10 w-10 items-center justify-center rounded-full border border-white bg-base-300/90 ${
                mutePending ? 'opacity-50' : ''
              }`}
              disabled={mutePending}
              hitSlop={8}
              onPress={onMutePress}
            >
              {muted ? (
                <Volume2 size={21} color={iconColor} />
              ) : (
                <CircleSlash size={21} color={iconColor} />
              )}
            </Pressable>
          </View>
        </View>

        <Text className="text-xl font-bold text-base-content">{name}</Text>
        <Text className="mt-1 text-sm font-medium text-primary">
          {nip05 || pubkey.slice(0, 8)}
        </Text>
        {lnaddress ? (
          <Text className="mt-1 text-sm font-medium text-primary">
            {lnaddress}
          </Text>
        ) : null}
        {about ? (
          <View className="mt-4">
            <Kind0ProfileAbout content={aboutContent} />
          </View>
        ) : null}
        <View className="mt-3 items-start">
          <Kind0RelayBlock relays={activeRelays} />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="border-t border-base-200 bg-base-300/95"
        contentContainerClassName="gap-2 px-4 py-3"
      >
        {PROFILE_KIND_FILTERS.map(({ id, iconKind, label }) => {
          const selected = selectedKind === id;
          const color = selected
            ? theme.colors.primary
            : theme.colors.primaryContent;
          return (
            <Pressable
              key={id}
              accessibilityLabel={`${selected ? 'Clear' : 'Select'} ${label}`}
              accessibilityState={{ selected }}
              className={`h-10 flex-row items-center gap-2 rounded-full border px-3 ${
                selected
                  ? 'border-primary bg-primary/15'
                  : 'border-base-200 bg-base-200/70'
              }`}
              onPress={() => onKindPress(id)}
            >
              <FeedKindIcon kind={iconKind} size={18} color={color} />
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-base-content' : 'text-primary-content'
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays
    .map(relay => relay.replace(/[^a-zA-Z0-9]/g, ''))
    .join('')
    .slice(0, 20);
}

function shouldShowProfilePost(event: ParsedEvent) {
  if (event.kind() !== 1) return true;
  const kind1 = asKind1(event);
  if (!kind1) return false;
  const reply = kind1.reply()?.id();
  const root = kind1.root()?.id();
  if (reply && !root) return false;
  if (reply && root && reply !== root) return false;
  return true;
}

function hasOkStatus(statuses: Record<string, ConnectionStatus>) {
  return Object.values(statuses).some(status => status.status() === 'true');
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function kindFilterLabel(kind: ProfileKindFilterId | null) {
  return (
    PROFILE_KIND_FILTERS.find(filter => filter.id === kind)?.label ?? null
  );
}

function tagValues(event: ParsedEvent, tagName: string) {
  const values: string[] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tag = event.tags(index);
    const first = tag?.items(0);
    const second = tag?.items(1);
    if (first === tagName && second) values.push(String(second));
  }
  return values;
}

function contactPubkeysFromEvent(event: ParsedEvent) {
  return tagValues(event, 'p');
}

function mutedPubkeysFromEvent(event: ParsedEvent) {
  return tagValues(event, 'p');
}

function createMuteTemplate({
  eventIds,
  hashtags,
  pubkeys,
  words,
}: {
  eventIds: string[];
  hashtags: string[];
  pubkeys: string[];
  words: string[];
}): EventTemplate {
  const nextPubkeys = uniqueStrings(pubkeys);
  return {
    kind: 10000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...nextPubkeys.map(pubkey => ['p', pubkey]),
      ...uniqueStrings(hashtags).map(hashtag => ['t', hashtag]),
      ...uniqueStrings(words).map(word => ['word', word]),
      ...uniqueStrings(eventIds).map(eventId => ['e', eventId]),
    ],
    content: JSON.stringify(nextPubkeys),
  };
}

export function Kind0Sub({
  pubkey,
  visible,
  onClose,
}: {
  pubkey: string;
  visible: boolean;
  onClose: () => void;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authPubkey = useAuthStore(state => state.pubkey);
  const follows = useNostrStore(state => state.follows);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const rootWriteRelays = useNostrStore(state => state.writeRelays);
  const setFollows = useNostrStore(state => state.setFollows);
  const setMutes = useNostrStore(state => state.setMutes);
  const [profilePosts, setProfilePosts] = useState<ParsedEvent[]>([]);
  const [selectedKind, setSelectedKind] =
    useState<ProfileKindFilterId | null>(null);
  const [loading, setLoading] = useState(false);
  const [emptyTimedOut, setEmptyTimedOut] = useState(false);
  const [aboutContent, setAboutContent] = useState<ParsedAboutBlock[]>([]);
  const [hasMoreProfile, setHasMoreProfile] = useState(true);
  const [followIntent, setFollowIntent] = useState<boolean | null>(null);
  const [muteIntent, setMuteIntent] = useState<boolean | null>(null);
  const [followPublishStatus, setFollowPublishStatus] = useState<
    Record<string, ConnectionStatus>
  >({});
  const [mutePublishStatus, setMutePublishStatus] = useState<
    Record<string, ConnectionStatus>
  >({});
  const profilePostsRef = useRef<ParsedEvent[]>([]);
  const profileSeenIdsRef = useRef(new Set<string>());
  const profileFlushRef = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  const profileUnsubRef = useRef<(() => void) | null>(null);
  const profileLiveUnsubRef = useRef<(() => void) | null>(null);
  const followPublishUnsubRef = useRef<(() => void) | null>(null);
  const mutePublishUnsubRef = useRef<(() => void) | null>(null);
  const followLookupUnsubRef = useRef<(() => void) | null>(null);
  const muteLookupUnsubRef = useRef<(() => void) | null>(null);
  const followLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const muteLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const profilePaginationUnsubRef = useRef<(() => void) | null>(null);
  const emptyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileCountRef = useRef(0);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const {
    fallbackRelays,
    feedReady,
    profile,
    writeRelays,
  } = useKind0ProfileData(pubkey);
  const activeRelays = useMemo(
    () => (writeRelays.length ? writeRelays : fallbackRelays),
    [fallbackRelays, writeRelays],
  );
  const requestKinds = useMemo(
    () =>
      selectedKind
        ? PROFILE_KIND_FILTERS.find(filter => filter.id === selectedKind)
            ?.kinds ?? ALL_FEED_KINDS
        : ALL_FEED_KINDS,
    [selectedKind],
  );

  const addProfilePost = useCallback((event: ParsedEvent) => {
    if (!shouldShowProfilePost(event)) return;
    const id = event.id();
    if (!id || profileSeenIdsRef.current.has(id)) return;
    profileSeenIdsRef.current.add(id);
    profilePostsRef.current.push(event);
    if (profileFlushRef.current) return;
    profileFlushRef.current = requestAnimationFrame(() => {
      profileFlushRef.current = null;
      profilePostsRef.current.sort(
        (left, right) => right.createdAt() - left.createdAt(),
      );
      setProfilePosts([...profilePostsRef.current]);
    });
  }, []);

  useEffect(() => {
    profileCountRef.current = profilePostsRef.current.length;
  }, [profilePosts.length]);

  useEffect(() => {
    if (!pubkey) return undefined;
    profilePostsRef.current = [];
    profileSeenIdsRef.current.clear();
    setProfilePosts([]);
    setHasMoreProfile(true);

    return () => {
      if (profileFlushRef.current) {
        cancelAnimationFrame(profileFlushRef.current);
        profileFlushRef.current = null;
      }
      profileUnsubRef.current?.();
      profileUnsubRef.current = null;
      profileLiveUnsubRef.current?.();
      profileLiveUnsubRef.current = null;
      followPublishUnsubRef.current?.();
      followPublishUnsubRef.current = null;
      mutePublishUnsubRef.current?.();
      mutePublishUnsubRef.current = null;
      followLookupUnsubRef.current?.();
      followLookupUnsubRef.current = null;
      muteLookupUnsubRef.current?.();
      muteLookupUnsubRef.current = null;
      if (followLookupTimeoutRef.current) {
        clearTimeout(followLookupTimeoutRef.current);
        followLookupTimeoutRef.current = null;
      }
      if (muteLookupTimeoutRef.current) {
        clearTimeout(muteLookupTimeoutRef.current);
        muteLookupTimeoutRef.current = null;
      }
      profilePaginationUnsubRef.current?.();
      profilePaginationUnsubRef.current = null;
      if (emptyTimeoutRef.current) {
        clearTimeout(emptyTimeoutRef.current);
        emptyTimeoutRef.current = null;
      }
    };
  }, [pubkey]);

  useEffect(() => {
    profilePostsRef.current = [];
    profileSeenIdsRef.current.clear();
    setProfilePosts([]);
    setHasMoreProfile(true);
    setEmptyTimedOut(false);
    profilePaginationUnsubRef.current?.();
    profilePaginationUnsubRef.current = null;
    if (emptyTimeoutRef.current) {
      clearTimeout(emptyTimeoutRef.current);
      emptyTimeoutRef.current = null;
    }
  }, [selectedKind]);

  useEffect(() => {
    if (!pubkey || !feedReady) return;
    const relays = writeRelays.length ? writeRelays : fallbackRelays;
    const kindsKey = requestKinds.join('-');
    const subId = `kind0P_${pubkey}_${relayHash(relays)}_${kindsKey}`;
    const liveSince = Math.floor(Date.now() / 1000);
    const liveSubId = `kind0P_live_${pubkey}_${relayHash(relays)}_${kindsKey}_${liveSince}`;
    relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    setSubRelays(`kind0P_${pubkey}`, relays);
    setLoading(true);
    setEmptyTimedOut(false);
    if (emptyTimeoutRef.current) clearTimeout(emptyTimeoutRef.current);
    emptyTimeoutRef.current = setTimeout(() => {
      if (profileCountRef.current === 0) {
        setLoading(false);
        setEmptyTimedOut(true);
      }
    }, PROFILE_EMPTY_TIMEOUT_MS);

    profileUnsubRef.current?.();
    profileLiveUnsubRef.current?.();

    profileUnsubRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: requestKinds,
          authors: [pubkey],
          limit: 50,
          cacheFirst: true,
          noContext: true,
          relays,
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus)
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          if (relayStatus === 'EOSE') {
            setLoading(false);
            if (profileCountRef.current === 0) setEmptyTimedOut(true);
          }
          return;
        }

        const event = asParsedEvent(message);
        if (!event || event.pubkey() !== pubkey) return;
        addProfilePost(event);
        setEmptyTimedOut(false);
        setEmptyTimedOut(false);
        setLoading(false);
      },
      { closeOnEose: false },
    );

    profileLiveUnsubRef.current = subscribeToNostr(
      liveSubId,
      [
        {
          kinds: requestKinds,
          authors: [pubkey],
          limit: 20,
          since: liveSince,
          noContext: true,
          relays,
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus)
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          return;
        }

        const event = asParsedEvent(message);
        if (!event || event.pubkey() !== pubkey) return;
        addProfilePost(event);
      },
      { closeOnEose: false },
    );

    return () => {
      profileUnsubRef.current?.();
      profileUnsubRef.current = null;
      profileLiveUnsubRef.current?.();
      profileLiveUnsubRef.current = null;
      if (emptyTimeoutRef.current) {
        clearTimeout(emptyTimeoutRef.current);
        emptyTimeoutRef.current = null;
      }
      setLoading(false);
    };
  }, [
    addProfilePost,
    fallbackRelays,
    feedReady,
    pubkey,
    requestKinds,
    setRelayStatus,
    setSubRelays,
    writeRelays,
  ]);

  const name =
    profile?.name?.()?.trim() || profile?.displayName?.()?.trim() || 'Unnamed';
  const picture = profile?.picture?.() || null;
  const banner = profile?.banner?.() || null;
  const about = profile?.about?.()?.trim() || '';
  const nip05 = profile?.nip05?.()?.trim() || '';
  const lnaddress =
    profile?.lud16?.()?.trim() || profile?.lud06?.()?.trim() || '';
  const items = profilePosts;
  const selectedKindLabel = kindFilterLabel(selectedKind);

  useEffect(() => {
    let cancelled = false;
    if (!about) {
      setAboutContent([]);
      return () => {
        cancelled = true;
      };
    }

    parseContent(about)
      .then(content => {
        if (!cancelled) setAboutContent(content as ParsedAboutBlock[]);
      })
      .catch(() => {
        if (!cancelled) setAboutContent([]);
      });

    return () => {
      cancelled = true;
    };
  }, [about]);

  const handleNearBottom = useCallback(() => {
    if (loading || !items.length) return;
    const currentRelays = activeRelays;
    const lastItem = items[items.length - 1];
    const until = lastItem?.createdAt() ? lastItem.createdAt() - 1 : undefined;
    if (!until) return;

    if (!hasMoreProfile) return;
    profilePaginationUnsubRef.current?.();
    setLoading(true);
    const itemCountBefore = profileCountRef.current;
    profilePaginationUnsubRef.current = subscribeToNostr(
      `kind0P_${pubkey}_${relayHash(currentRelays)}_${requestKinds.join('-')}_page_${until}`,
      [
        {
          kinds: requestKinds,
          authors: [pubkey],
          limit: 50,
          until,
          noContext: true,
          relays: currentRelays,
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus)
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          if (relayStatus === 'EOSE') {
            setLoading(false);
            setTimeout(
              () =>
                setHasMoreProfile(profileCountRef.current > itemCountBefore),
              500,
            );
          }
          return;
        }

        const event = asParsedEvent(message);
        if (event && event.pubkey() === pubkey) addProfilePost(event);
      },
      { closeOnEose: false },
    );
  }, [
    activeRelays,
    addProfilePost,
    hasMoreProfile,
    items,
    loading,
    pubkey,
    requestKinds,
    setRelayStatus,
  ]);

  const handleKindPress = useCallback((kind: ProfileKindFilterId) => {
    setSelectedKind(current => (current === kind ? null : kind));
  }, []);
  const following = followIntent ?? follows.includes(pubkey);
  const muted = muteIntent ?? mutedPubkeys.includes(pubkey);
  const followPending = followIntent !== null && !hasOkStatus(followPublishStatus);
  const mutePending = muteIntent !== null && !hasOkStatus(mutePublishStatus);

  useEffect(() => {
    if (followIntent === null || follows.includes(pubkey) !== followIntent)
      return;
    setFollowIntent(null);
    setFollowPublishStatus({});
  }, [followIntent, follows, pubkey]);

  useEffect(() => {
    if (muteIntent === null || mutedPubkeys.includes(pubkey) !== muteIntent)
      return;
    setMuteIntent(null);
    setMutePublishStatus({});
  }, [muteIntent, mutedPubkeys, pubkey]);

  const handleFollowPress = useCallback(() => {
    if (!authPubkey || authPubkey === pubkey) return;
    const nextFollowing = !following;
    const relays = rootWriteRelays.length ? rootWriteRelays : BOOTSTRAP_RELAYS;
    const relayHint = activeRelays[0] || '';
    let completed = false;

    setFollowIntent(nextFollowing);
    setFollowPublishStatus({});
    followPublishUnsubRef.current?.();
    followPublishUnsubRef.current = null;
    followLookupUnsubRef.current?.();
    followLookupUnsubRef.current = null;
    if (followLookupTimeoutRef.current) {
      clearTimeout(followLookupTimeoutRef.current);
      followLookupTimeoutRef.current = null;
    }

    const publishFollow = (baseFollows: string[]) => {
      if (completed) return;
      completed = true;
      followLookupUnsubRef.current?.();
      followLookupUnsubRef.current = null;
      if (followLookupTimeoutRef.current) {
        clearTimeout(followLookupTimeoutRef.current);
        followLookupTimeoutRef.current = null;
      }

      const nextFollows = nextFollowing
        ? uniqueStrings([...baseFollows, pubkey])
        : baseFollows.filter(follow => follow !== pubkey);
      const template: EventTemplate = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: nextFollows.map(follow => [
          'p',
          follow,
          follow === pubkey ? relayHint : '',
        ]),
        content: '',
      };
      const statusMap: Record<string, ConnectionStatus> = {};

      setFollows(nextFollows);
      followPublishUnsubRef.current = publishToNostr(
        `follow_${pubkey}_${Date.now()}`,
        template,
        (message: WorkerMessage) => {
          const status = isConnectionStatus(message);
          const relayUrl = status?.relayUrl();
          if (!status || !relayUrl) return;
          statusMap[relayUrl] = status;
          setFollowPublishStatus({ ...statusMap });
        },
        { defaultRelays: relays, trackStatus: true },
      );
    };

    followLookupUnsubRef.current = subscribeToNostr(
      `follow_lookup_${authPubkey}_${Date.now()}`,
      [{ kinds: [3], authors: [authPubkey], limit: 1, relays }],
      message => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 3 || event.pubkey() !== authPubkey)
          return;
        publishFollow(contactPubkeysFromEvent(event));
      },
      {
        bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
        closeOnEose: false,
      },
    );
    followLookupTimeoutRef.current = setTimeout(() => {
      publishFollow(follows);
    }, PRE_PUBLISH_LOOKUP_TIMEOUT_MS);
  }, [
    activeRelays,
    authPubkey,
    following,
    follows,
    pubkey,
    rootWriteRelays,
    setFollows,
  ]);

  const handleMutePress = useCallback(() => {
    if (!authPubkey || authPubkey === pubkey) return;
    const nextMuted = !muted;
    const relays = rootWriteRelays.length ? rootWriteRelays : BOOTSTRAP_RELAYS;
    let completed = false;

    setMuteIntent(nextMuted);
    setMutePublishStatus({});
    mutePublishUnsubRef.current?.();
    mutePublishUnsubRef.current = null;
    muteLookupUnsubRef.current?.();
    muteLookupUnsubRef.current = null;
    if (muteLookupTimeoutRef.current) {
      clearTimeout(muteLookupTimeoutRef.current);
      muteLookupTimeoutRef.current = null;
    }

    const publishMute = ({
      eventIds,
      hashtags,
      pubkeys,
      words,
    }: {
      eventIds: string[];
      hashtags: string[];
      pubkeys: string[];
      words: string[];
    }) => {
      if (completed) return;
      completed = true;
      muteLookupUnsubRef.current?.();
      muteLookupUnsubRef.current = null;
      if (muteLookupTimeoutRef.current) {
        clearTimeout(muteLookupTimeoutRef.current);
        muteLookupTimeoutRef.current = null;
      }

      const nextMutedPubkeys = nextMuted
        ? uniqueStrings([...pubkeys, pubkey])
        : pubkeys.filter(mutedPubkey => mutedPubkey !== pubkey);
      const template = createMuteTemplate({
        eventIds,
        hashtags,
        pubkeys: nextMutedPubkeys,
        words,
      });
      const statusMap: Record<string, ConnectionStatus> = {};

      setMutes({
        mutedEventIds: eventIds,
        mutedHashtags: hashtags,
        mutedPubkeys: nextMutedPubkeys,
        mutedWords: words,
      });
      mutePublishUnsubRef.current = publishToNostr(
        `mute_${pubkey}_${Date.now()}`,
        template,
        (message: WorkerMessage) => {
          const status = isConnectionStatus(message);
          const relayUrl = status?.relayUrl();
          if (!status || !relayUrl) return;
          statusMap[relayUrl] = status;
          setMutePublishStatus({ ...statusMap });
        },
        { defaultRelays: relays, trackStatus: true },
      );
    };

    muteLookupUnsubRef.current = subscribeToNostr(
      `mute_lookup_${authPubkey}_${Date.now()}`,
      [{ kinds: [10000], authors: [authPubkey], limit: 1, relays }],
      message => {
        const event = asParsedEvent(message);
        if (!event || event.kind() !== 10000 || event.pubkey() !== authPubkey)
          return;
        publishMute({
          eventIds: tagValues(event, 'e'),
          hashtags: tagValues(event, 't'),
          pubkeys: mutedPubkeysFromEvent(event),
          words: tagValues(event, 'word'),
        });
      },
      {
        bytesPerEvent: REPLACEABLE_LIST_BYTES_PER_EVENT,
        closeOnEose: false,
      },
    );
    muteLookupTimeoutRef.current = setTimeout(() => {
      publishMute({
        eventIds: mutedEventIds,
        hashtags: mutedHashtags,
        pubkeys: mutedPubkeys,
        words: mutedWords,
      });
    }, PRE_PUBLISH_LOOKUP_TIMEOUT_MS);
  }, [
    authPubkey,
    muted,
    mutedEventIds,
    mutedHashtags,
    mutedPubkeys,
    mutedWords,
    pubkey,
    rootWriteRelays,
    setMutes,
  ]);

  const handleZapPress = useCallback(() => {
    navigation.navigate('SendEcash', { pubkey });
  }, [navigation, pubkey]);
  const stickyHeader = useCallback(
    () => <Kind0StickyHeader onClose={onClose} pubkey={pubkey} />,
    [onClose, pubkey],
  );

  const header = useCallback(
    () => (
      <Kind0ProfileHeader
        about={about}
        aboutContent={aboutContent}
        activeRelays={activeRelays}
        banner={banner}
        lnaddress={lnaddress}
        name={name}
        nip05={nip05}
        onClose={onClose}
        onFollowPress={handleFollowPress}
        onKindPress={handleKindPress}
        onMutePress={handleMutePress}
        onZapPress={handleZapPress}
        picture={picture}
        pubkey={pubkey}
        selectedKind={selectedKind}
        followPending={followPending}
        following={following}
        mutePending={mutePending}
        muted={muted}
      />
    ),
    [
      about,
      aboutContent,
      activeRelays,
      banner,
      handleFollowPress,
      handleKindPress,
      handleMutePress,
      handleZapPress,
      followPending,
      following,
      lnaddress,
      mutePending,
      muted,
      name,
      nip05,
      onClose,
      picture,
      selectedKind,
      pubkey,
    ],
  );
  return (
    <Feed
      items={items}
      getItemId={item => item.id() || item.createdAt()}
      renderItem={({ item, visible: itemVisible }) => (
        <Note note={item} visible={visible && itemVisible} />
      )}
      header={header}
      headerSafeArea={false}
      stickyHeader={stickyHeader}
      visible={visible}
      loading={loading}
      onNearBottom={handleNearBottom}
      removeClippedSubviews={false}
      empty={
        <View className="px-6 py-12">
          <Text className="text-center text-sm text-primary-content">
            {emptyTimedOut
              ? selectedKindLabel
                ? `No ${selectedKindLabel.toLowerCase()} found.`
                : 'No posts found.'
              : selectedKindLabel
              ? `Loading ${selectedKindLabel.toLowerCase()}...`
              : 'Loading posts...'}
          </Text>
        </View>
      }
      contentContainerClassName="pb-28"
    />
  );
}
