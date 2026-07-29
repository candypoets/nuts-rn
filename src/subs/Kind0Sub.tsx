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
import { useNavigation } from 'expo-router/react-navigation';
import type { ConnectionStatus, ParsedEvent, WorkerMessage } from '@candypoets/nipworker';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asParsedEvent,
  isKind0,
  isConnectionStatus,
  parseContent,
} from '@candypoets/nipworker/utils';
import {
  ChevronLeft,
  CircleSlash,
  MessageSquare,
  ShieldCheck,
  Users,
  UserCheck,
  UserPlus,
  Volume2,
  Zap,
} from 'lucide-react-native';
import type { EventTemplate } from 'nostr-tools';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feed, type FeedRenderItemInfo } from '../components/Feed';
import {FeedKindNavigator} from '../components/FeedKindNavigator';
import {SegmentedTabs} from '../components/SegmentedTabs';
import { Avatar, Note, User } from '../components/notes';
import { fetchRelayInfosForRelays } from '../nostr/nip11';
import {
  ALL_FEED_KINDS,
  BOOTSTRAP_RELAYS,
  useAuthStore,
  useNostrStore,
  useRelayStore,
  type FeedKind,
} from '../stores';
import { useKind0ProfileData } from '../hooks/useKind0ProfileData';
import {initials, shortNpub} from '../lib/identity';
import type { AppNavigationProp } from '../navigation/types';
import { useAppTheme } from '../theme';

const fallbackProfileImage = require('../../assets/miss-profile.png');
const KIND0_BANNER_HEIGHT = 208;
const TOP_SAFE_AREA_OFFSET = 8;
const PRE_PUBLISH_LOOKUP_TIMEOUT_MS = 1500;
const REPLACEABLE_LIST_BYTES_PER_EVENT = 128 * 1024;
const PROFILE_EMPTY_TIMEOUT_MS = 2400;
type ProfileKindFilterId = 'notes' | 'articles' | 'polls' | 'media';
const PROFILE_KIND_FILTERS: Array<{
  id: ProfileKindFilterId;
  kinds: FeedKind[];
  label: string;
}> = [
  { id: 'notes', kinds: [1, 6], label: 'Notes' },
  { id: 'media', kinds: [20, 22], label: 'Media' },
  { id: 'polls', kinds: [1068], label: 'Polls' },
  { id: 'articles', kinds: [30023], label: 'Articles' },
];

type Kind0ProfileHeaderProps = {
  about: string;
  aboutContent: ParsedAboutBlock[];
  banner: string | null;
  communities: ProfileCommunity[];
  contributionCount: number;
  lnaddress: string;
  name: string;
  nip05: string;
  onFollowPress: () => void;
  onMutePress: () => void;
  onZapPress: () => void;
  picture: string | null;
  pubkey: string;
  scrollY: SharedValue<number>;
  followPending: boolean;
  following: boolean;
  mutePending: boolean;
  muted: boolean;
};

type Kind0StickyHeaderProps = {
  onClose: () => void;
  pubkey: string;
  safeAreaTop?: number;
  scrollY: SharedValue<number>;
};

type Kind0ImageProps = {
  uri: string | null;
  fallback?: ImageSourcePropType;
  className: string;
};

type ProfileCommunity = {
  key: string;
  name: string;
  relationship: 'follow' | 'belong';
  url: string;
};

type CommunityPreviewProfile = {
  pubkey: string;
  name: string;
  picture: string | null;
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

function readableTextColor(background: string) {
  const normalized = background.replace('#', '').slice(0, 6);
  if (normalized.length !== 6) return '#1a1a1a';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return '#1a1a1a';
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140
    ? '#ffffff'
    : '#1a1a1a';
}

function Kind0ProfileAbout({ content }: { content: ParsedAboutBlock[] }) {
  if (!content.length) return null;

  return (
    <Text className="text-[15px] leading-5 text-base-content">
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
  safeAreaTop = 0,
  scrollY,
}: Kind0StickyHeaderProps) {
  const theme = useAppTheme();
  const bannerExitOffset = KIND0_BANNER_HEIGHT + safeAreaTop - 64;
  const surfaceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [0, bannerExitOffset],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const identityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [KIND0_BANNER_HEIGHT / 3, bannerExitOffset],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Animated.View
      className="flex-row items-center justify-between px-4"
      style={{height: 64 + safeAreaTop, paddingTop: safeAreaTop}}>
      <Animated.View
        className="absolute inset-0 border-b"
        pointerEvents="none"
        style={[
          {
            backgroundColor: theme.colors.base300,
            borderBottomColor: theme.colors.base200,
          },
          surfaceStyle,
        ]}
      />
      <Pressable
        accessibilityLabel="Close profile"
        className="h-9 w-9 items-center justify-center rounded-full bg-base-300/85"
        hitSlop={12}
        onPress={onClose}
      >
        <ChevronLeft size={22} color={theme.colors.primaryContent} />
      </Pressable>
      <Animated.View style={identityStyle}>
        <Avatar pubkey={pubkey} size="lg" />
      </Animated.View>
      <View className="h-9 w-9" />
    </Animated.View>
  );
});

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

const communityNames: Record<string, string> = {
  'wss://relay.nuts.cash': 'Nuts',
  'wss://relay.damus.io': 'Damus',
  'wss://nos.lol': 'Nos',
  'wss://purplepag.es': 'Purple Pages',
  'wss://user.kindpag.es': 'Kind Pages',
};

const communityColorClasses = [
  'bg-primary',
  'bg-secondary',
  'bg-accent',
  'bg-info',
  'bg-warning',
  'bg-success',
];

function communityColorClass(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % communityColorClasses.length;
  }
  return communityColorClasses[hash];
}

function eventRelayUrls(event: ParsedEvent) {
  if (typeof event.relaysLength !== 'function') return [];
  return Array.from({length: event.relaysLength()}, (_, index) =>
    event.relays(index),
  )
    .filter((relay): relay is string => Boolean(relay))
    .map(normalizeRelayUrl);
}

const EMPTY_COMMUNITY_PROFILES: CommunityPreviewProfile[] = [];

const Kind0CommunityCard = memo(function Kind0CommunityCard({
  community,
  profiles,
}: {
  community: ProfileCommunity;
  profiles: CommunityPreviewProfile[];
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<AppNavigationProp>();
  // Select only this community's relay info entry: subscribing the whole
  // section to the relayInfos map rerendered every card on each relay
  // info fetch.
  const info = useRelayStore(state => state.relayInfos[community.key]?.info);
  const name =
    info?.name?.trim() ||
    communityNames[community.key] ||
    community.name;
  const belongs = community.relationship === 'belong';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} community`}
      className={`w-56 rounded-lg border p-3 ${
        belongs
          ? 'border-primary/35 bg-base-300'
          : 'border-base-200 bg-base-300'
      }`}
      onPress={event => {
        event.stopPropagation();
        navigation.navigate('Community', {
          description: info?.description,
          icon: info?.icon,
          name,
          relationship: community.relationship,
          relay: community.url,
        });
      }}
    >
      <View className="flex-row items-start gap-3">
        <View
          className={`h-12 w-12 items-center justify-center overflow-hidden rounded-lg ${communityColorClass(
            community.key,
          )}`}
        >
          {info?.icon ? (
            <Image
              source={{ uri: info.icon }}
              style={styles.trackedImage}
            />
          ) : (
            <Text className="text-sm font-bold text-base-100">
              {initials(name)}
            </Text>
          )}
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-1">
            <Text
              className="min-w-0 flex-1 text-[15px] font-bold text-base-content"
              numberOfLines={1}
            >
              {name}
            </Text>
            {belongs ? (
              <ShieldCheck
                size={15}
                color={theme.colors.primary}
                strokeWidth={2.3}
              />
            ) : null}
          </View>
          <Text className="mt-1 text-xs font-semibold uppercase text-primary">
            {belongs ? 'Member' : 'Following'}
          </Text>
        </View>
      </View>
      {info?.description ? (
        <Text
          className="mt-3 min-h-10 text-sm leading-5 text-primary-content"
          numberOfLines={2}
        >
          {info.description}
        </Text>
      ) : (
        <Text className="mt-3 min-h-10 text-sm leading-5 text-primary-content">
          Public community
        </Text>
      )}
      <View className="mt-3 h-6 flex-row items-center">
        {profiles.length ? (
          <>
          {profiles.slice(0, 5).map((profile, index) => (
            <View
              key={profile.pubkey}
              className="h-6 w-6 overflow-hidden rounded-full border border-base-300 bg-base-200"
              style={{marginLeft: index ? -7 : 0}}
            >
              {profile.picture ? (
                <Image
                  source={{uri: profile.picture}}
                  style={styles.trackedImage}
                />
              ) : (
                <Text className="mt-1 text-center text-[9px] font-bold text-primary-content">
                  {initials(profile.name)}
                </Text>
              )}
            </View>
          ))}
          {profiles.length > 5 ? (
            <Text className="ml-2 text-xs font-semibold text-primary-content">
              +{profiles.length - 5}
            </Text>
          ) : null}
          </>
        ) : null}
      </View>
      <View className="mt-3 flex-row items-center gap-1">
        <Users size={14} color={theme.colors.primaryContent} />
        <Text className="text-xs font-medium text-primary-content">
          Public
        </Text>
      </View>
    </Pressable>
  );
});

const Kind0CommunitySection = memo(function Kind0CommunitySection({
  communities,
  contributionCount,
}: {
  communities: ProfileCommunity[];
  contributionCount: number;
}) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<AppNavigationProp>();
  const [selectedRelationship, setSelectedRelationship] = useState<
    ProfileCommunity['relationship']
  >('belong');
  const [previewProfiles, setPreviewProfiles] = useState<
    Record<string, CommunityPreviewProfile[]>
  >({});
  const followCount = communities.filter(
    community => community.relationship === 'follow',
  ).length;
  const belongCount = communities.filter(
    community => community.relationship === 'belong',
  ).length;
  const visibleCommunities = communities.filter(
    community => community.relationship === selectedRelationship,
  );

  useEffect(() => {
    if (communities.length) {
      fetchRelayInfosForRelays(communities.map(community => community.url));
    }
  }, [communities]);

  useEffect(() => {
    if (!communities.length) return undefined;

    setPreviewProfiles({});
    const unsubscribes = communities.map(community => {
      const seen = new Set<string>();
      const profiles: CommunityPreviewProfile[] = [];
      return subscribeToNostr(
        `community_kind0_${relayHash([community.key])}`,
        [
          {
            kinds: [0],
            limit: 10,
            relays: [community.url],
            closeOnEOSE: true,
          },
        ],
        message => {
          const kind0 = isKind0(message);
          const event = asParsedEvent(message);
          const pubkey = kind0?.pubkey?.();
          if (!kind0 || !pubkey || seen.has(pubkey)) return;
          const eventRelays = event ? eventRelayUrls(event) : [];
          if (eventRelays.length && !eventRelays.includes(community.key)) {
            return;
          }
          seen.add(pubkey);
          profiles.push({
            pubkey,
            name:
              kind0.name?.()?.trim() ||
              kind0.displayName?.()?.trim() ||
              shortNpub(pubkey),
            picture: kind0.picture?.() || null,
          });
          setPreviewProfiles(current => ({
            ...current,
            [community.key]: [...profiles],
          }));
        },
        {closeOnEose: true},
      );
    });

    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, [communities]);

  if (!communities.length) return null;

  return (
    <View className="mt-5">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-bold text-base-content">
            Communities
          </Text>
          <Text className="mt-1 text-sm text-primary-content">
            Your spaces. Your people.
          </Text>
        </View>
        <Pressable
          className="flex-row items-center gap-1"
          hitSlop={8}
          onPress={() =>
            navigation.navigate('RelayInfos', {
              relays: communities.map(community => community.url),
              mode: 'communities',
            })
          }
        >
          <Text className="text-sm font-semibold text-primary">
            See all ({communities.length})
          </Text>
          <ChevronLeft
            size={17}
            color={theme.colors.primary}
            strokeWidth={2.3}
            style={{transform: [{rotate: '180deg'}]}}
          />
        </Pressable>
      </View>

      <View className="mt-3 flex-row overflow-hidden rounded-lg border border-base-200 bg-base-300">
        <View className="flex-1 border-r border-base-200 px-3 py-3">
          <Users size={18} color={theme.colors.primaryContent} />
          <Text className="text-lg font-bold text-base-content">
            {communities.length}
          </Text>
          <Text className="text-xs font-semibold uppercase text-primary-content">
            Communities
          </Text>
        </View>
        <View className="flex-1 border-r border-base-200 px-3 py-3">
          <ShieldCheck size={18} color={theme.colors.primaryContent} />
          <Text className="text-lg font-bold text-base-content">
            {belongCount}
          </Text>
          <Text className="text-xs font-semibold uppercase text-primary-content">
            Roles
          </Text>
        </View>
        <View className="flex-1 px-3 py-3">
          <MessageSquare size={18} color={theme.colors.primaryContent} />
          <Text className="text-lg font-bold text-base-content">
            {contributionCount}
          </Text>
          <Text className="text-xs font-semibold uppercase text-primary-content">
            24h posts
          </Text>
        </View>
      </View>

      <View className="mt-4">
        <SegmentedTabs
          tabs={[
            {id: 'belong', label: 'Belongs to', count: belongCount},
            {id: 'follow', label: 'Following', count: followCount},
          ]}
          selectedId={selectedRelationship}
          onSelect={setSelectedRelationship}
          variant="pill"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-3"
        contentContainerClassName="gap-3"
      >
        {visibleCommunities.map(community => (
          <Kind0CommunityCard
            key={`${community.relationship}-${community.key}`}
            community={community}
            profiles={previewProfiles[community.key] ?? EMPTY_COMMUNITY_PROFILES}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const Kind0ProfileHeader = memo(function Kind0ProfileHeader({
  about,
  aboutContent,
  banner,
  communities,
  contributionCount,
  lnaddress,
  name,
  nip05,
  onFollowPress,
  onMutePress,
  onZapPress,
  picture,
  pubkey,
  scrollY,
  followPending,
  following,
  mutePending,
  muted,
}: Kind0ProfileHeaderProps) {
  const theme = useAppTheme();
  const iconColor = readableTextColor(theme.colors.base100);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const bannerHeight =
    KIND0_BANNER_HEIGHT + Math.max(0, insets.top - TOP_SAFE_AREA_OFFSET);
  const bannerStyle = useAnimatedStyle(() => {
    const pullDistance = Math.max(-scrollY.value, 0);
    return {
      transformOrigin: 'top',
      transform: [
        {
          translateY: Math.min(scrollY.value, 0),
        },
        {
          scale: interpolate(
            pullDistance,
            [0, 180],
            [1, 1.36],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  return (
    <View className="bg-base-300/95">
      <View
        className="overflow-visible bg-base-300/95"
        style={{
          height: bannerHeight,
          width: screenWidth,
        }}
      >
        <Animated.View className="h-full w-full" style={bannerStyle}>
          <Kind0TrackedImage uri={banner} className="h-full w-full" />
        </Animated.View>
      </View>

      <View className="px-4 pb-4">
        <View className="-mt-16 mb-4 flex-row items-center justify-between">
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
          {nip05 || shortNpub(pubkey)}
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
        <Kind0CommunitySection
          communities={communities}
          contributionCount={contributionCount}
        />
      </View>

    </View>
  );
});

const Kind0ActivityHeader = memo(function Kind0ActivityHeader({
  onKindPress,
  selectedKind,
}: {
  onKindPress: (id: ProfileKindFilterId) => void;
  selectedKind: ProfileKindFilterId | null;
}) {
  const selectedActivityKinds = useMemo(
    () =>
      selectedKind
        ? PROFILE_KIND_FILTERS.find(filter => filter.id === selectedKind)
            ?.kinds ?? []
        : [],
    [selectedKind],
  );

  return (
    <View className="px-4 pb-2 pt-4">
      <Text className="text-xl font-bold text-base-content">
        Recent activity
      </Text>
      <View className="mt-3">
        <FeedKindNavigator
          selectedKinds={selectedActivityKinds}
          onSelectKinds={kinds => {
            const nextFilter = PROFILE_KIND_FILTERS.find(
              filter =>
                filter.kinds.length === kinds.length &&
                filter.kinds.every((kind, index) => kind === kinds[index]),
            );
            if (!nextFilter) {
              if (selectedKind) onKindPress(selectedKind);
              return;
            }
            if (selectedKind !== nextFilter.id) onKindPress(nextFilter.id);
          }}
        />
      </View>
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

function communityList(readRelays: string[], writeRelays: string[]) {
  const writeSet = new Set(writeRelays.map(normalizeRelayUrl));
  const belongCommunities = writeRelays.map(relay => {
    const key = normalizeRelayUrl(relay);
    return {
      key,
      name: communityNames[key] || relayLabel(relay),
      relationship: 'belong' as const,
      url: key,
    };
  });
  const followCommunities = readRelays
    .map(normalizeRelayUrl)
    .filter(relay => !writeSet.has(relay))
    .map(relay => ({
      key: relay,
      name: communityNames[relay] || relayLabel(relay),
      relationship: 'follow' as const,
      url: relay,
    }));

  return [...belongCommunities, ...followCommunities];
}

function contributionsLast24h(events: ParsedEvent[]) {
  const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  return events.filter(event => event.createdAt() >= since).length;
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
    useNavigation<AppNavigationProp>();
  const authPubkey = useAuthStore(state => state.pubkey);
  const follows = useNostrStore(state => state.follows);
  const kind3UpdatedAt = useNostrStore(state => state.kind3UpdatedAt);
  const kind10000UpdatedAt = useNostrStore(state => state.kind10000UpdatedAt);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const rootWriteRelays = useNostrStore(state => state.writeRelays);
  const setFollows = useNostrStore(state => state.setFollows);
  const setKindTimestamp = useNostrStore(state => state.setKindTimestamp);
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
    profile,
    readRelays,
    writeRelays,
  } = useKind0ProfileData(pubkey, visible);
  const activeRelays = useMemo(
    () => (writeRelays.length ? writeRelays : fallbackRelays),
    [fallbackRelays, writeRelays],
  );
  const communities = useMemo(
    () => communityList(readRelays, writeRelays),
    [readRelays, writeRelays],
  );
  const contributionCount = useMemo(
    () => contributionsLast24h(profilePosts),
    [profilePosts],
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
    if (!pubkey || !visible) return;
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
    pubkey,
    requestKinds,
    setRelayStatus,
    setSubRelays,
    visible,
    writeRelays,
  ]);

  const name =
    profile?.name?.()?.trim() ||
    profile?.displayName?.()?.trim() ||
    (profile ? 'Unnamed' : shortNpub(pubkey));
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
      const createdAt = Math.floor(Date.now() / 1000);
      const template: EventTemplate = {
        kind: 3,
        created_at: createdAt,
        tags: nextFollows.map(follow => [
          'p',
          follow,
          follow === pubkey ? relayHint : '',
        ]),
        content: '',
      };
      const statusMap: Record<string, ConnectionStatus> = {};

      setFollows(nextFollows);
      setKindTimestamp(3, createdAt);
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
        if (event.createdAt() <= kind3UpdatedAt) return;
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
    kind3UpdatedAt,
    pubkey,
    rootWriteRelays,
    setFollows,
    setKindTimestamp,
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
      setKindTimestamp(10000, template.created_at);
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
        if (event.createdAt() <= kind10000UpdatedAt) return;
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
    kind10000UpdatedAt,
    muted,
    mutedEventIds,
    mutedHashtags,
    mutedPubkeys,
    mutedWords,
    pubkey,
    rootWriteRelays,
    setKindTimestamp,
    setMutes,
  ]);

  const handleZapPress = useCallback(() => {
    navigation.navigate('SendEcash', { pubkey });
  }, [navigation, pubkey]);
  // Hoisted: an inline renderItem gets a new identity on every Kind0Sub
  // render (each posts flush, profile field, loading flip), which makes
  // Feed recreate every row element.
  const renderItem = useCallback(
    ({item, visible: itemVisible}: FeedRenderItemInfo<ParsedEvent>) => (
      <Note note={item} visible={visible && itemVisible} />
    ),
    [visible],
  );
  const motionHeader = useCallback(
    ({
      safeAreaTop,
      scrollY,
    }: {
      safeAreaTop: number;
      scrollY: SharedValue<number>;
    }) => (
      <View>
        <Kind0StickyHeader
          onClose={onClose}
          pubkey={pubkey}
          safeAreaTop={safeAreaTop}
          scrollY={scrollY}
        />
      </View>
    ),
    [onClose, pubkey],
  );
  const header = useCallback(
    ({
      scrollY,
    }: {
      scrollY: SharedValue<number>;
    }) => (
      <View className="border-b border-base-200 bg-base-300/95">
        <Kind0ProfileHeader
          about={about}
          aboutContent={aboutContent}
          banner={banner}
          communities={communities}
          contributionCount={contributionCount}
          lnaddress={lnaddress}
          name={name}
          nip05={nip05}
          onFollowPress={handleFollowPress}
          onMutePress={handleMutePress}
          onZapPress={handleZapPress}
          picture={picture}
          pubkey={pubkey}
          scrollY={scrollY}
          followPending={followPending}
          following={following}
          mutePending={mutePending}
          muted={muted}
        />
        <Kind0ActivityHeader
          onKindPress={handleKindPress}
          selectedKind={selectedKind}
        />
      </View>
    ),
    [
      about,
      aboutContent,
      banner,
      communities,
      contributionCount,
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
      picture,
      selectedKind,
      pubkey,
    ],
  );
  return (
    <Feed
      items={items}
      getItemId={item => item.id() || item.createdAt()}
      renderItem={renderItem}
      motionHeader={motionHeader}
      motionHeaderOverlaysContent
      motionHeaderSurfaceColor="transparent"
      header={header}
      headerSafeArea
      headerOwnsSafeArea
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
