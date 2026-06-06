import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import {Image} from 'expo-image';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asParsedEvent,
  parseContent,
} from '@candypoets/nipworker/utils';
import {ChevronLeft, CircleSlash, UserPlus, Zap} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Feed} from '../components/Feed';
import {Avatar, Note, User} from '../components/notes';
import {RelaysList as HeaderRelaysList} from '../components/RelaysList';
import {ALL_FEED_KINDS, useRelayStore} from '../stores';
import {useKind0ProfileData} from '../hooks/useKind0ProfileData';
import {useAppTheme} from '../theme';

const fallbackProfileImage = require('../../assets/miss-profile.png');
const TOP_SAFE_AREA_OFFSET = 8;

type Kind0HeaderMode = 'profile' | 'feed';

type Kind0ProfileHeaderProps = {
  about: string;
  aboutContent: ParsedAboutBlock[];
  activeRelays: string[];
  banner: string | null;
  lnaddress: string;
  mode: Kind0HeaderMode;
  name: string;
  nip05: string;
  onClose: () => void;
  onFeedPress: () => void;
  onProfilePress: () => void;
  picture: string | null;
  profileContactsLength: number;
  pubkey: string;
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

function Kind0ProfileAbout({content}: {content: ParsedAboutBlock[]}) {
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
  const source = useMemo(
    () => (uri ? {uri} : fallback),
    [fallback, uri],
  );

  if (!source) return null;

  return (
    <View className={className}>
      <Image source={source} style={styles.trackedImage} contentFit="cover" cachePolicy="memory-disk" />
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
      <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-200" hitSlop={12} onPress={onClose}>
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
  mode,
  name,
  nip05,
  onClose,
  onFeedPress,
  onProfilePress,
  picture,
  profileContactsLength,
  pubkey,
}: Kind0ProfileHeaderProps) {
  const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;
  const insets = useSafeAreaInsets();
  const {width: screenWidth} = useWindowDimensions();
  const topInset = Math.max(0, insets.top - TOP_SAFE_AREA_OFFSET);

  return (
    <View className="overflow-hidden rounded-lg bg-base-200">
      <View
        className="bg-base-200"
        style={{
          height: 208 + topInset,
          width: screenWidth,
        }}
      >
        <Kind0TrackedImage
          uri={banner}
          className="h-full w-full"
        />
        <View
          className="absolute left-0 right-0 top-0 h-20 flex-row items-center justify-between px-4"
          style={{paddingTop: topInset + 24}}
        >
          <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-300/85" hitSlop={12} onPress={onClose}>
            <ChevronLeft size={22} color={iconColor} />
          </Pressable>
          <View className="h-9 w-9" />
        </View>
      </View>

      <View className="px-4 pb-4">
        <View className="-mt-16 mb-4 flex-row items-end gap-3">
          <View className="h-32 w-32 overflow-hidden rounded-full border border-white bg-base-200">
            <Kind0TrackedImage
              uri={picture}
              fallback={fallbackProfileImage}
              className="h-full w-full"
            />
          </View>
          <View className="mb-2 flex-row gap-2">
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-base-300/90">
              <UserPlus size={19} color={iconColor} />
            </Pressable>
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-base-300/90">
              <Zap size={19} color={iconColor} />
            </Pressable>
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-base-300/90">
              <CircleSlash size={19} color={iconColor} />
            </Pressable>
          </View>
        </View>

        <Text className="text-xl font-bold text-base-content">{name}</Text>
        <Text className="mt-1 text-sm font-medium text-primary">{nip05 || pubkey.slice(0, 8)}</Text>
        {lnaddress ? <Text className="mt-1 text-sm font-medium text-primary">{lnaddress}</Text> : null}
        {about ? (
          <View className="mt-4">
            <Kind0ProfileAbout content={aboutContent} />
          </View>
        ) : null}
        <View className="mt-3 items-start">
          <Kind0RelayBlock relays={activeRelays} />
        </View>
      </View>

      <View className="flex-row border-t border-base-200 bg-base-300">
        <Pressable className="flex-1 items-center py-3" onPress={onProfilePress}>
          <Text className={`text-sm font-semibold ${mode === 'profile' ? 'text-base-content' : 'text-primary-content'}`}>Posts</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center py-3"
          disabled={!profileContactsLength}
          onPress={onFeedPress}
        >
          <Text
            className={`text-sm font-semibold ${
              mode === 'feed' ? 'text-base-content' : profileContactsLength ? 'text-primary-content' : 'text-primary-content/50'
            }`}
          >
            Feed
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 20);
}

function shouldShowProfilePost(event: ParsedEvent) {
  const kind1 = asKind1(event);
  if (!kind1) return false;
  const reply = kind1.reply()?.id();
  const root = kind1.root()?.id();
  if (reply && !root) return false;
  if (reply && root && reply !== root) return false;
  return true;
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
  const [profilePosts, setProfilePosts] = useState<ParsedEvent[]>([]);
  const [feedPosts, setFeedPosts] = useState<ParsedEvent[]>([]);
  const [mode, setMode] = useState<'profile' | 'feed'>('profile');
  const [loading, setLoading] = useState(false);
  const [aboutContent, setAboutContent] = useState<ParsedAboutBlock[]>([]);
  const [hasMoreProfile, setHasMoreProfile] = useState(true);
  const [hasMoreFeed, setHasMoreFeed] = useState(true);
  const profilePostsRef = useRef<ParsedEvent[]>([]);
  const feedPostsRef = useRef<ParsedEvent[]>([]);
  const profileSeenIdsRef = useRef(new Set<string>());
  const feedSeenIdsRef = useRef(new Set<string>());
  const profileFlushRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const feedFlushRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const profilePaginationUnsubRef = useRef<(() => void) | null>(null);
  const feedPaginationUnsubRef = useRef<(() => void) | null>(null);
  const profileCountRef = useRef(0);
  const feedCountRef = useRef(0);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const {
    fallbackRelays,
    feedReady,
    profile,
    profileContacts,
    readRelays,
    writeRelays,
  } = useKind0ProfileData(pubkey);
  const activeRelays = useMemo(
    () =>
      mode === 'profile'
        ? writeRelays.length
          ? writeRelays
          : fallbackRelays
        : readRelays.length
        ? readRelays
        : fallbackRelays,
    [fallbackRelays, mode, readRelays, writeRelays],
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
      profilePostsRef.current.sort((left, right) => right.createdAt() - left.createdAt());
      setProfilePosts([...profilePostsRef.current]);
    });
  }, []);

  const addFeedPost = useCallback((event: ParsedEvent) => {
    if (!shouldShowProfilePost(event)) return;
    const id = event.id();
    if (!id || feedSeenIdsRef.current.has(id)) return;
    feedSeenIdsRef.current.add(id);
    feedPostsRef.current.push(event);
    if (feedFlushRef.current) return;
    feedFlushRef.current = requestAnimationFrame(() => {
      feedFlushRef.current = null;
      feedPostsRef.current.sort((left, right) => right.createdAt() - left.createdAt());
      setFeedPosts([...feedPostsRef.current]);
    });
  }, []);

  useEffect(() => {
    profileCountRef.current = profilePostsRef.current.length;
  }, [profilePosts.length]);

  useEffect(() => {
    feedCountRef.current = feedPostsRef.current.length;
  }, [feedPosts.length]);

  useEffect(() => {
    if (!pubkey) return undefined;
    profilePostsRef.current = [];
    feedPostsRef.current = [];
    profileSeenIdsRef.current.clear();
    feedSeenIdsRef.current.clear();
    setProfilePosts([]);
    setFeedPosts([]);
    setMode('profile');
    setHasMoreProfile(true);
    setHasMoreFeed(true);

    return () => {
      if (profileFlushRef.current) {
        cancelAnimationFrame(profileFlushRef.current);
        profileFlushRef.current = null;
      }
      if (feedFlushRef.current) {
        cancelAnimationFrame(feedFlushRef.current);
        feedFlushRef.current = null;
      }
      profilePaginationUnsubRef.current?.();
      profilePaginationUnsubRef.current = null;
      feedPaginationUnsubRef.current?.();
      feedPaginationUnsubRef.current = null;
    };
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !feedReady) return;
    const relays = writeRelays.length ? writeRelays : fallbackRelays;
    const subId = `kind0P_${pubkey}_${relayHash(relays)}`;
    relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    setSubRelays(`kind0P_${pubkey}`, relays);
    setLoading(true);

    const unsubscribe = subscribeToNostr(
      subId,
      [{kinds: ALL_FEED_KINDS, authors: [pubkey], limit: 50, noContext: true, relays}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          if (relayStatus === 'EOSE') setLoading(false);
          return;
        }

        const event = asParsedEvent(message);
        if (!event || event.pubkey() !== pubkey) return;
        addProfilePost(event);
        setLoading(false);
      },
      {closeOnEose: false},
    );

    return () => {
      unsubscribe();
      setLoading(false);
    };
  }, [addProfilePost, fallbackRelays, feedReady, pubkey, setRelayStatus, setSubRelays, writeRelays]);

  useEffect(() => {
    if (!pubkey || mode !== 'feed' || !profileContacts.length) return;
    const relays = readRelays.length ? readRelays : fallbackRelays;
    const authors = profileContacts.slice(0, 250);
    const subId = `kind0F_${pubkey}_${relayHash(relays)}`;
    relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    setSubRelays(`kind0F_${pubkey}`, relays);
    setLoading(true);

    const unsubscribe = subscribeToNostr(
      subId,
      [{kinds: ALL_FEED_KINDS, authors, limit: 50, noContext: true, relays}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          if (relayStatus === 'EOSE') setLoading(false);
          return;
        }

        const event = asParsedEvent(message);
        if (event) addFeedPost(event);
        setLoading(false);
      },
      {closeOnEose: false},
    );

    return () => {
      unsubscribe();
      setLoading(false);
    };
  }, [addFeedPost, fallbackRelays, mode, profileContacts, pubkey, readRelays, setRelayStatus, setSubRelays]);

  const name = profile?.name?.()?.trim() || profile?.displayName?.()?.trim() || 'Unnamed';
  const picture = profile?.picture?.() || null;
  const banner = profile?.banner?.() || null;
  const about = profile?.about?.()?.trim() || '';
  const nip05 = profile?.nip05?.()?.trim() || '';
  const lnaddress = profile?.lud16?.()?.trim() || profile?.lud06?.()?.trim() || '';
  const items = mode === 'profile' ? profilePosts : feedPosts;

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

    if (mode === 'profile') {
      if (!hasMoreProfile) return;
      profilePaginationUnsubRef.current?.();
      setLoading(true);
      const itemCountBefore = profileCountRef.current;
      profilePaginationUnsubRef.current = subscribeToNostr(
        `kind0P_${pubkey}_${relayHash(currentRelays)}_page_${until}`,
        [{kinds: ALL_FEED_KINDS, authors: [pubkey], limit: 50, until, noContext: true, relays: currentRelays}],
        message => {
          const status = asConnectionStatus(message);
          if (status) {
            const relayUrl = status.relayUrl();
            const relayStatus = status.status()?.toString();
            if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
            if (relayStatus === 'EOSE') {
              setLoading(false);
              setTimeout(() => setHasMoreProfile(profileCountRef.current > itemCountBefore), 500);
            }
            return;
          }

          const event = asParsedEvent(message);
          if (event && event.pubkey() === pubkey) addProfilePost(event);
        },
        {closeOnEose: false},
      );
      return;
    }

    if (!hasMoreFeed || !profileContacts.length) return;
    feedPaginationUnsubRef.current?.();
    setLoading(true);
    const itemCountBefore = feedCountRef.current;
    feedPaginationUnsubRef.current = subscribeToNostr(
      `kind0F_${pubkey}_${relayHash(currentRelays)}_page_${until}`,
      [{kinds: ALL_FEED_KINDS, authors: profileContacts.slice(0, 250), limit: 50, until, noContext: true, relays: currentRelays}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          if (relayStatus === 'EOSE') {
            setLoading(false);
            setTimeout(() => setHasMoreFeed(feedCountRef.current > itemCountBefore), 500);
          }
          return;
        }

        const event = asParsedEvent(message);
        if (event) addFeedPost(event);
      },
      {closeOnEose: false},
    );
  }, [
    activeRelays,
    addFeedPost,
    addProfilePost,
    hasMoreFeed,
    hasMoreProfile,
    items,
    loading,
    mode,
    profileContacts,
    pubkey,
    setRelayStatus,
  ]);

  const handleProfileModePress = useCallback(() => setMode('profile'), []);
  const handleFeedModePress = useCallback(() => {
    if (profileContacts.length) setMode('feed');
  }, [profileContacts.length]);
  const stickyHeader = useCallback(
    () => <Kind0StickyHeader onClose={onClose} pubkey={pubkey} />,
    [onClose, pubkey],
  );

  const header = useCallback(() => (
    <Kind0ProfileHeader
      about={about}
      aboutContent={aboutContent}
      activeRelays={activeRelays}
      banner={banner}
      lnaddress={lnaddress}
      mode={mode}
      name={name}
      nip05={nip05}
      onClose={onClose}
      onFeedPress={handleFeedModePress}
      onProfilePress={handleProfileModePress}
      picture={picture}
      profileContactsLength={profileContacts.length}
      pubkey={pubkey}
    />
  ), [
    about,
    aboutContent,
    activeRelays,
    banner,
    handleFeedModePress,
    handleProfileModePress,
    lnaddress,
    mode,
    name,
    nip05,
    onClose,
    picture,
    profileContacts.length,
    pubkey,
  ]);
  return (
    <Feed
      items={items}
      getItemId={item => item.id() || item.createdAt()}
      renderItem={({item, visible: itemVisible}) => (
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
            {mode === 'profile'
              ? 'Loading posts...'
              : profileContacts.length
              ? 'Loading feed...'
              : 'No follows found for this profile.'}
          </Text>
        </View>
      }
      contentContainerClassName="pb-28"
    />
  );
}
