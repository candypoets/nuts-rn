import './global.css';
import './textEncodingPolyfill';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  ReanimatedLogLevel,
  configureReanimatedLogger,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Kind0Parsed, NostrManagerLike, ParsedEvent } from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  ReactNativeBackend,
  createNostrManager,
  hasReactNativeModule,
  setManager,
} from '@candypoets/nipworker/react-native';
import {asParsedEvent, isKind0} from '@candypoets/nipworker/utils';
import {
  Bell,
  ChevronRight,
  ChevronLeft,
  CircleSlash,
  Infinity,
  KeyRound,
  LogOut,
  Palette,
  PenLine,
  Plus,
  Radio,
  RefreshCw,
  UserPlus,
  User,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react-native';
import { nip19 } from 'nostr-tools';
import {
  useAuthStore,
  useFeedBuilderStore,
  useNostrStore,
  useRelayStore,
  useWalletStore,
} from './src/stores';
import { useRootNostrSubscriptions } from './src/hooks/useRootNostrSubscriptions';
import { useRelayTracking } from './src/hooks/useRelayTracking';
import {ChatFeed, ExploreFeed, HomeFeed, Kind4Thread} from './src/feeds';
import { Feed } from './src/components/Feed';
import {Avatar, Note} from './src/components/notes';
import {HeaderProfileButton} from './src/components/HeaderProfileButton';
import {RelaysList as HeaderRelaysList} from './src/components/RelaysList';
import {FeedBuilderModal} from './src/modals/FeedBuilderModal';
import {DEFAULT_FEED_RELAYS} from './src/nostr/relays';

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

type ReceivedEvent = {
  id: string;
  pubkey: string;
  createdAt: number;
  kind: number;
};

type RouteId = 'home' | 'explore' | 'chat';

type FeedRoute = {
  id: RouteId;
  label: string;
  accent: string;
  description: string;
};

type AuthState = {
  pubkey: string | null;
  hasSigner: boolean;
};

type AppStackItem =
  | {
      type: 'route';
      route: FeedRoute;
    }
  | {
      type: 'notifications';
      route: FeedRoute;
    }
  | {
      type: 'modal';
      route: FeedRoute;
    }
  | {
      type: 'feedBuilder';
      route: FeedRoute;
    }
  | {
      type: 'profile';
    }
  | {
      type: 'publicProfile';
      pubkey: string;
    }
  | {
      type: 'login';
    }
  | {
      type: 'logout';
    }
  | {
      type: 'profileStub';
      path: 'relays' | 'wallet' | 'theme' | 'nprofile';
    }
  | {
      type: 'chatThread';
      peerPubkey: string;
    };

type FeedPageItem =
  | {
      type: 'smoke';
    };

const FEED_ROUTES: FeedRoute[] = [
  {
    id: 'home',
    label: 'Home',
    accent: '#1f7a5a',
    description: 'Live kind 1 relay smoke stream and local runtime checks.',
  },
  {
    id: 'explore',
    label: 'Explore',
    accent: '#a13f2b',
    description:
      'Discovery space for trending relays, people, and event kinds.',
  },
  {
    id: 'chat',
    label: 'Chat',
    accent: '#355c9a',
    description: 'Conversation surface for direct notes and group threads.',
  },
];

const followListImage = require('./assets/followlist.png');

const SWIPE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodePrivateKey(input: string) {
  const value = input.trim();
  if (!value) {
    throw new Error('Enter a private key.');
  }

  if (value.toLowerCase().startsWith('nsec')) {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected an nsec private key.');
    }
    return decoded.data;
  }

  const hex = value.replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Use an nsec key or a 64-character hex private key.');
  }
  return hexToBytes(hex);
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [subscriptionStatus, setSubscriptionStatus] = useState('idle');
  const [firstEvent, setFirstEvent] = useState<ReceivedEvent | null>(null);
  const [manager, setManagerInstance] = useState<NostrManagerLike | null>(null);
  const authPubkey = useAuthStore(state => state.pubkey);
  const authHasSigner = useAuthStore(state => state.hasSigner);
  const auth = useMemo(
    () => ({pubkey: authPubkey, hasSigner: authHasSigner}),
    [authHasSigner, authPubkey],
  );

  const status = useMemo(() => {
    let backendStatus = 'not created';
    try {
      backendStatus = ReactNativeBackend ? 'import ok' : 'missing export';
    } catch (error) {
      backendStatus = error instanceof Error ? error.message : String(error);
    }

    return {
      hasModule: hasReactNativeModule(),
      backendStatus,
    };
  }, []);

  useEffect(() => {
    if (!status.hasModule) {
      setSubscriptionStatus('native module missing');
      return;
    }

    try {
      const nextManager = createNostrManager();
      setManager(nextManager);
      setManagerInstance(nextManager);
    } catch (error) {
      setSubscriptionStatus(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [status.hasModule]);

  useEffect(() => {
    setSubscriptionStatus(manager ? 'manager ready' : 'idle');
    setFirstEvent(null);
  }, [manager]);

  return (
    <SafeAreaProvider>
      <RootServices manager={manager} />
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <SwapNavigator
          status={status}
          subscriptionStatus={subscriptionStatus}
          firstEvent={firstEvent}
          manager={manager}
          auth={auth}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function RootServices({manager}: {manager: NostrManagerLike | null}) {
  const setAuth = useAuthStore(state => state.setAuth);
  const follows = useNostrStore(state => state.follows);
  const setFollowListPack = useFeedBuilderStore(state => state.setFollowListPack);

  useRootNostrSubscriptions(Boolean(manager));
  useRelayTracking(Boolean(manager));

  useEffect(() => {
    setFollowListPack({
      id: 'followlist',
      kind: 39089,
      title: 'Follow List',
      description: 'People you follow',
      image: null,
      localImage: 'followlist',
      people: follows,
      dTag: 'followlist',
    });
  }, [follows, setFollowListPack]);

  useEffect(() => {
    if (!manager) return;

    const handleAuth = (event: Event) => {
      const detail = (
        event as Event & {
          detail?: { pubkey?: string | null; hasSigner?: boolean };
        }
      ).detail;
      const pubkey = detail?.pubkey ?? null;
      setAuth({
        pubkey,
        npub: pubkey ? nip19.npubEncode(pubkey) : null,
        hasSigner: detail?.hasSigner ?? false,
      });
    };

    manager.addEventListener('auth', handleAuth);
    return () => manager.removeEventListener('auth', handleAuth);
  }, [manager, setAuth]);

  return null;
}

function SwapNavigator({
  status,
  subscriptionStatus,
  firstEvent,
  manager,
  auth,
}: {
  status: { hasModule: boolean; backendStatus: string };
  subscriptionStatus: string;
  firstEvent: ReceivedEvent | null;
  manager: NostrManagerLike | null;
  auth: AuthState;
}) {
  const width = Dimensions.get('window').width;
  const [activeIndex, setActiveIndex] = useState(0);
  const [stack, setStack] = useState<AppStackItem[]>([]);
  const topStackType = stack.at(-1)?.type ?? null;
  const topStackIsModal =
    topStackType === 'modal' ||
    topStackType === 'feedBuilder' ||
    topStackType === 'profile' ||
    topStackType === 'login' ||
    topStackType === 'logout' ||
    topStackType === 'profileStub';
  const virtualX = useSharedValue(0);
  const dragX = useSharedValue(0);
  const stackDepth = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const activeIndexRef = useRef(activeIndex);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    stackDepth.value = withTiming(stack.length, {duration: 220});
  }, [stack.length, stackDepth]);

  const pushNotifications = useCallback((route: FeedRoute) => {
    dismissProgress.value = 0;
    setStack(items => [
      ...items,
      {
        type: 'notifications',
        route,
      },
    ]);
  }, [dismissProgress]);

  const pushPostModal = useCallback((route: FeedRoute) => {
    dismissProgress.value = 0;
    setStack(items => [
      ...items,
      {
        type: 'modal',
        route,
      },
    ]);
  }, [dismissProgress]);

  const pushFeedBuilder = useCallback((route: FeedRoute) => {
    dismissProgress.value = 0;
    setStack(items => [
      ...items,
      {
        type: 'feedBuilder',
        route,
      },
    ]);
  }, [dismissProgress]);

  const pushChatThread = useCallback((peerPubkey: string) => {
    dismissProgress.value = 0;
    setStack(items => [...items, {type: 'chatThread', peerPubkey}]);
  }, [dismissProgress]);

  const pushProfile = useCallback(() => {
    dismissProgress.value = 0;
    setStack(items => [...items, {type: 'profile'}]);
  }, [dismissProgress]);

  const pushPublicProfile = useCallback((pubkey: string) => {
    dismissProgress.value = 0;
    setStack(items => {
      const top = items.at(-1);
      if (top?.type === 'publicProfile' && top.pubkey === pubkey) return items;
      return [...items, {type: 'publicProfile', pubkey}];
    });
  }, [dismissProgress]);

  const closeTopStack = useCallback(() => {
    setStack(items => {
      const next = items.slice(0, -1);
      stackDepth.value = next.length;
      return next;
    });
    setTimeout(() => {
      dismissProgress.value = 0;
    }, 240);
  }, [dismissProgress, stackDepth]);

  const navigateTo = (index: number) => {
    const next = clamp(index, 0, FEED_ROUTES.length - 1);
    setActiveIndex(next);
    activeIndexRef.current = next;
    virtualX.value = withSpring(next * width, SWIPE_SPRING);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          const current = activeIndexRef.current;
          const maxDelta = current * width;
          const minDelta = -(FEED_ROUTES.length - 1 - current) * width;
          let constrained = gesture.dx;
          if (gesture.dx > maxDelta)
            constrained = maxDelta + (gesture.dx - maxDelta) * 0.3;
          if (gesture.dx < minDelta)
            constrained = minDelta + (gesture.dx - minDelta) * 0.3;
          dragX.value = constrained;
          virtualX.value = current * width - constrained;
        },
        onPanResponderRelease: (_, gesture) => {
          const current = activeIndexRef.current;
          const threshold = width / 3;
          const velocityThreshold = 0.5;
          let target = current;
          if (
            Math.abs(gesture.dx) > threshold ||
            Math.abs(gesture.vx) > velocityThreshold
          ) {
            if (gesture.dx > 0) target = current - 1;
            if (gesture.dx < 0) target = current + 1;
          }
          target = clamp(target, 0, FEED_ROUTES.length - 1);
          dragX.value = 0;
          setActiveIndex(target);
          virtualX.value = withSpring(target * width, SWIPE_SPRING, () => {
            runOnJS(setActiveIndex)(target);
          });
          activeIndexRef.current = target;
        },
      }),
    [dragX, virtualX, width],
  );

  const mainStyle = useAnimatedStyle(() => {
    const effectiveDepth = Math.max(0, stackDepth.value - dismissProgress.value);
    const isModal = topStackIsModal;
    const isSub =
      topStackType === 'notifications' ||
      topStackType === 'chatThread' ||
      topStackType === 'publicProfile';
    return {
      transform: [
        {
          translateX: isSub
            ? -interpolate(
                effectiveDepth,
                [0, 1],
                [0, width * 0.2],
                Extrapolation.CLAMP,
              )
            : 0,
        },
        {
          translateY: isModal
            ? interpolate(effectiveDepth, [0, 1], [0, 30], Extrapolation.CLAMP)
            : 0,
        },
        {
          scale: interpolate(
            effectiveDepth,
            [0, 1],
            [1, isModal ? 0.94 : 0.92],
            Extrapolation.CLAMP,
          ),
        },
      ],
      opacity: isModal
        ? 1
        : interpolate(effectiveDepth, [0, 1], [1, 0.72], Extrapolation.CLAMP),
    };
  });

  return (
    <View style={styles.navigator}>
      <Animated.View
        style={[styles.mainPager, mainStyle]}
        {...panResponder.panHandlers}
      >
        {FEED_ROUTES.map((route, index) => (
          <FeedPage
            key={route.id}
            index={index}
            route={route}
            width={width}
            virtualX={virtualX}
            isActive={index === activeIndex}
            onLoginOpen={() =>
              setStack(items => [...items, { type: 'login' }])
            }
            onProfileOpen={pushProfile}
            onPublicProfileOpen={pushPublicProfile}
            onNotificationsOpen={() => pushNotifications(route)}
            onPostOpen={() => pushPostModal(route)}
            onFeedBuilderOpen={() => pushFeedBuilder(route)}
            onChatOpen={pushChatThread}
            status={status}
            subscriptionStatus={subscriptionStatus}
            firstEvent={firstEvent}
            auth={auth}
            nostrEnabled={Boolean(manager)}
          />
        ))}
      </Animated.View>
      <View style={styles.carouselProgress}>
        {FEED_ROUTES.map((route, index) => (
          <Pressable
            key={route.id}
            accessibilityRole="button"
            accessibilityLabel={route.label}
            style={styles.progressButton}
            onPress={() => navigateTo(index)}
          >
            <ProgressBar index={index} virtualX={virtualX} width={width} />
          </Pressable>
        ))}
      </View>
      {stack.map((item, index) => (
        <StackCard
          key={`${item.type === 'route' ? item.route.id : item.type}-${index}`}
          item={item}
          index={index}
          depthFromTop={stack.length - 1 - index}
          onClose={closeTopStack}
          onDismissProgress={progress => {
            dismissProgress.value = progress;
          }}
          onDismissComplete={() => {
            dismissProgress.value = withTiming(1, {duration: 180});
          }}
          onDismissCancel={() => {
            dismissProgress.value = withSpring(0, SWIPE_SPRING);
          }}
          dismissProgress={dismissProgress}
          onPush={nextItem => {
            dismissProgress.value = 0;
            setStack(items => [...items, nextItem]);
          }}
          manager={manager}
          auth={auth}
        />
      ))}
    </View>
  );
}

function FeedPage({
  index,
  route,
  width,
  virtualX,
  isActive,
  onLoginOpen,
  onProfileOpen,
  onPublicProfileOpen,
  onNotificationsOpen,
  onPostOpen,
  onFeedBuilderOpen,
  onChatOpen,
  status,
  subscriptionStatus,
  firstEvent,
  auth,
  nostrEnabled,
}: {
  index: number;
  route: FeedRoute;
  width: number;
  virtualX: SharedValue<number>;
  isActive: boolean;
  onLoginOpen: () => void;
  onProfileOpen: () => void;
  onPublicProfileOpen: (pubkey: string) => void;
  onNotificationsOpen: () => void;
  onPostOpen: () => void;
  onFeedBuilderOpen: () => void;
  onChatOpen: (peerPubkey: string) => void;
  status: { hasModule: boolean; backendStatus: string };
  subscriptionStatus: string;
  firstEvent: ReceivedEvent | null;
  auth: AuthState;
  nostrEnabled: boolean;
}) {
  const readRelays = useNostrStore(state => state.readRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const selectedPacks = useFeedBuilderStore(state => state.selectedPacks);
  const displayRelays =
    auth.pubkey && readRelays.length ? readRelays : DEFAULT_FEED_RELAYS;
  const feedItems = useMemo<FeedPageItem[]>(
    () => (route.id === 'home' ? [{type: 'smoke'}] : []),
    [route.id],
  );
  const renderHeader = useCallback(
    () => (
      <View className="bg-slate-50 px-1 pt-2">
        <View className="mx-1 rounded-lg bg-white/90 px-3 py-3 shadow-sm">
          <View className="h-14 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              {route.id === 'explore' ? (
                <FeedPackHeaderButtons
                  packs={selectedPacks}
                  surfaceClassName="bg-slate-50"
                  onPress={onFeedBuilderOpen}
                />
              ) : (
                <View className="h-9 w-9" />
              )}
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                <RefreshCw size={18} color="#52616f" strokeWidth={2.2} />
              </Pressable>
              <Pressable
                className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
                hitSlop={12}
                onPress={onNotificationsOpen}
              >
                <Bell size={19} color="#17212b" strokeWidth={2.2} />
              </Pressable>
              <HeaderProfileButton
                pubkey={auth.pubkey}
                onPress={onProfileOpen}
              />
            </View>
          </View>
          <HeaderRelaysList relays={displayRelays} statuses={relayStatuses} />
        </View>
      </View>
    ),
    [
      auth.pubkey,
      displayRelays,
      onFeedBuilderOpen,
      onProfileOpen,
      onNotificationsOpen,
      relayStatuses,
      route.id,
      selectedPacks,
    ],
  );
  const renderStickyHeader = useCallback(
    () => (
      <View className="border-b border-slate-200 bg-slate-50/95 px-4 py-2">
        <View className="h-12 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {route.id === 'explore' ? (
              <FeedPackHeaderButtons
                packs={selectedPacks}
                surfaceClassName="bg-white"
                onPress={onFeedBuilderOpen}
              />
            ) : (
              <View className="h-9 w-9" />
            )}
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white"
              hitSlop={12}
              onPress={onNotificationsOpen}
            >
              <Bell size={19} color="#17212b" strokeWidth={2.2} />
            </Pressable>
            <HeaderProfileButton
              pubkey={auth.pubkey}
              className="h-9 w-9 border-slate-200 bg-white"
              onPress={onProfileOpen}
            />
          </View>
        </View>
        <HeaderRelaysList
          relays={displayRelays}
          statuses={relayStatuses}
          mini
        />
      </View>
    ),
    [
      auth.pubkey,
      displayRelays,
      onFeedBuilderOpen,
      onProfileOpen,
      onNotificationsOpen,
      relayStatuses,
      route.id,
      selectedPacks,
    ],
  );
  const renderStickyFooter = useCallback(
    () => (
      <View className="px-4 pb-4">
        <Pressable
          className="flex-row items-center gap-2 rounded-full border border-emerald-600 bg-white/90 px-5 py-3"
          onPress={route.id === 'home' && !auth.pubkey ? onLoginOpen : onPostOpen}
        >
          <PenLine size={18} color="#1f7a5a" strokeWidth={2.2} />
          <Text className="text-base font-semibold text-slate-700">
            {route.id === 'home'
              ? auth.pubkey
                ? "What's up?"
                : 'Login with private key'
              : "What's up?"}
          </Text>
        </Pressable>
      </View>
    ),
    [auth.pubkey, onLoginOpen, onPostOpen, route.id],
  );
  const renderFeedItem = useCallback(
    ({item}: {item: FeedPageItem}) =>
      item.type === 'smoke' ? (
        <View>
          <SmokeStatus
            status={status}
            subscriptionStatus={subscriptionStatus}
            firstEvent={firstEvent}
            auth={auth}
            onLoginOpen={onLoginOpen}
          />
        </View>
      ) : null,
    [auth, firstEvent, onLoginOpen, status, subscriptionStatus],
  );

  const pageStyle = useAnimatedStyle(() => {
    const translateX = index * width - virtualX.value;
    const ratio = 1 / (Math.abs(virtualX.value - index * width) / width + 1);
    return {
      transform: [
        { translateX },
        { scale: interpolate(ratio, [0.5, 1], [0.96, 1]) },
      ],
      opacity: interpolate(ratio, [0.5, 1], [0.55, 1]),
    };
  });

  return (
    <Animated.View
      pointerEvents={isActive ? 'auto' : 'none'}
      style={[styles.page, pageStyle]}
    >
      {route.id === 'explore' ? (
        <ExploreFeed
          enabled={nostrEnabled}
          visible={isActive}
          header={renderHeader}
          stickyHeader={renderStickyHeader}
          stickyFooter={renderStickyFooter}
          onProfileOpen={onPublicProfileOpen}
        />
      ) : route.id === 'chat' ? (
        <ChatFeed
          enabled={nostrEnabled}
          visible={isActive}
          onChatOpen={onChatOpen}
        />
      ) : route.id === 'home' ? (
        <HomeFeed
          enabled={nostrEnabled}
          visible={isActive}
          onLoginOpen={onLoginOpen}
          onProfileOpen={onProfileOpen}
          onNotificationsOpen={onNotificationsOpen}
        />
      ) : (
        <Feed
          items={feedItems}
          getItemId={item => item.type}
          pullToRefresh
          header={renderHeader}
          stickyHeader={renderStickyHeader}
          stickyFooter={renderStickyFooter}
          renderItem={renderFeedItem}
        />
      )}
    </Animated.View>
  );
}

function SmokeStatus({
  status,
  subscriptionStatus,
  firstEvent,
  auth,
  onLoginOpen,
}: {
  status: { hasModule: boolean; backendStatus: string };
  subscriptionStatus: string;
  firstEvent: ReceivedEvent | null;
  auth: AuthState;
  onLoginOpen: () => void;
}) {
  return (
    <>
      <Pressable
        style={[
          styles.action,
          auth.pubkey ? styles.loginSuccessAction : styles.loginAction,
        ]}
        onPress={onLoginOpen}
      >
        <Text style={styles.actionText}>
          {auth.pubkey ? 'Logged in' : 'Login with private key'}
        </Text>
      </Pressable>
      {auth.pubkey ? (
        <View style={styles.row}>
          <Text style={styles.label}>Account</Text>
          <Text style={styles.value}>{auth.pubkey.slice(0, 16)}...</Text>
          <Text style={styles.meta}>
            signer: {auth.hasSigner ? 'private key' : 'read only'}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.label}>Package import</Text>
        <Text style={styles.value}>{status.backendStatus}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Native module</Text>
        <Text style={styles.value}>
          {status.hasModule
            ? 'NipworkerReactNativeModule found'
            : 'not linked yet'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Nostr manager</Text>
        <Text style={styles.value}>{subscriptionStatus}</Text>
        <Text style={styles.meta}>feed subscriptions are owned by their views</Text>
      </View>
      {firstEvent ? (
        <View style={styles.row}>
          <Text style={styles.label}>First event</Text>
          <Text style={styles.value}>kind {firstEvent.kind}</Text>
          <Text style={styles.meta}>id: {firstEvent.id.slice(0, 16)}</Text>
          <Text style={styles.meta}>
            pubkey: {firstEvent.pubkey.slice(0, 16)}
          </Text>
          <Text style={styles.meta}>created: {firstEvent.createdAt}</Text>
        </View>
      ) : null}
    </>
  );
}

function FeedPackHeaderButtons({
  packs,
  surfaceClassName,
  onPress,
}: {
  packs: Array<{id: string; title: string; image: string | null; localImage?: 'followlist'}>;
  surfaceClassName: string;
  onPress: () => void;
}) {
  if (!packs.length) {
    return (
      <Pressable
        className={`h-9 w-9 items-center justify-center rounded-full border border-slate-200 ${surfaceClassName}`}
        hitSlop={12}
        onPress={onPress}
      >
        <Infinity size={21} color="#17212b" strokeWidth={2.2} />
      </Pressable>
    );
  }

  return (
    <View className="flex-row items-center gap-1">
      {packs.slice(0, 4).map(pack => (
        <Pressable
          key={pack.id}
          accessibilityRole="button"
          accessibilityLabel={pack.title}
          className={`h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 ${surfaceClassName}`}
          hitSlop={12}
          onPress={onPress}
        >
          {pack.localImage === 'followlist' || pack.image ? (
            <Image
              source={pack.localImage === 'followlist' ? followListImage : {uri: pack.image ?? ''}}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <Users size={18} color="#17212b" strokeWidth={2.1} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function ProgressBar({
  index,
  virtualX,
  width,
}: {
  index: number;
  virtualX: SharedValue<number>;
  width: number;
}) {
  const style = useAnimatedStyle(() => {
    const ratio = 1 / (Math.abs(virtualX.value - index * width) / width + 1);
    return {
      opacity: 0.3 + ratio * 0.7,
      transform: [{ scaleX: 0.75 + ratio * 0.5 }],
    };
  });

  return <Animated.View style={[styles.progress, style]} />;
}

function PublicProfileSub({
  pubkey,
  visible,
  onClose,
}: {
  pubkey: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<Kind0Parsed | null>(null);
  const [posts, setPosts] = useState<ParsedEvent[]>([]);
  const [mode, setMode] = useState<'profile' | 'feed'>('profile');

  useEffect(() => {
    if (!pubkey) return;
    setProfile(null);
    setPosts([]);

    const unsubscribe = subscribeToNostr(
      `nprofile_${pubkey}_${DEFAULT_FEED_RELAYS.join('|')}`,
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
          cacheFirst: true,
          relays: DEFAULT_FEED_RELAYS,
        },
        {
          kinds: [1],
          authors: [pubkey],
          limit: 30,
          relays: DEFAULT_FEED_RELAYS,
        },
      ],
      message => {
        const kind0 = isKind0(message);
        if (kind0 && kind0.pubkey?.() === pubkey) {
          setProfile(kind0);
          return;
        }

        const event = asParsedEvent(message);
        if (!event || event.kind() !== 1 || event.pubkey() !== pubkey) return;
        setPosts(current => {
          const id = event.id();
          if (!id || current.some(item => item.id() === id)) return current;
          return [...current, event].sort(
            (left, right) => right.createdAt() - left.createdAt(),
          );
        });
      },
      {closeOnEose: false},
    );

    return unsubscribe;
  }, [pubkey]);

  const name =
    profile?.name?.()?.trim() ||
    profile?.displayName?.()?.trim() ||
    'Unnamed';
  const picture = profile?.picture?.() || null;
  const banner = profile?.banner?.() || null;
  const about = profile?.about?.()?.trim() || '';
  const nip05 = profile?.nip05?.()?.trim() || '';
  const lnaddress = profile?.lud16?.()?.trim() || profile?.lud06?.()?.trim() || '';
  const relays = DEFAULT_FEED_RELAYS.map(relay => relay.replace(/^wss:\/\//, ''));
  const items = mode === 'profile' ? posts : [];

  const stickyHeader = () => (
    <View className="h-24 flex-row items-center justify-between bg-white/95 px-4 pt-10">
      <Pressable
        className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
        hitSlop={12}
        onPress={onClose}
      >
        <ChevronLeft size={22} color="#17212b" />
      </Pressable>
      <Avatar pubkey={pubkey} size="lg" />
      <View className="h-9 w-9" />
    </View>
  );

  const header = () => (
    <View className="overflow-hidden rounded-lg bg-slate-100">
      <View className="h-52 bg-slate-200">
        {banner ? (
          <Image source={{uri: banner}} className="h-full w-full" resizeMode="cover" />
        ) : null}
        <View className="absolute left-0 right-0 top-0 h-20 flex-row items-center justify-between px-4 pt-10">
          <Pressable
            className="h-9 w-9 items-center justify-center rounded-full bg-white/85"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronLeft size={22} color="#17212b" />
          </Pressable>
          <View className="h-9 w-9" />
        </View>
      </View>

      <View className="px-4 pb-4">
        <View className="-mt-16 mb-4 flex-row items-end gap-3">
          <View className="h-32 w-32 overflow-hidden rounded-full border border-white bg-slate-200">
            <Image
              source={picture ? {uri: picture} : require('./assets/miss-profile.png')}
              className="h-full w-full"
              resizeMode="cover"
            />
          </View>
          <View className="mb-2 flex-row gap-2">
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-white/90">
              <UserPlus size={19} color="#17212b" />
            </Pressable>
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-white/90">
              <Zap size={19} color="#17212b" />
            </Pressable>
            <Pressable className="h-9 w-9 items-center justify-center rounded-full border border-white bg-white/90">
              <CircleSlash size={19} color="#17212b" />
            </Pressable>
          </View>
        </View>

        <Text className="text-xl font-bold text-slate-950">{name}</Text>
        <Text className="mt-1 text-sm font-medium text-emerald-700">
          {nip05 || pubkey.slice(0, 8)}
        </Text>
        {lnaddress ? (
          <Text className="mt-1 text-sm font-medium text-emerald-700">
            {lnaddress}
          </Text>
        ) : null}
        {about ? (
          <Text className="mt-4 text-[15px] leading-5 text-slate-700">{about}</Text>
        ) : null}
        <View className="mt-4 flex-row flex-wrap gap-2">
          {relays.map(relay => (
            <Text
              key={relay}
              className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500"
            >
              {relay}
            </Text>
          ))}
        </View>
      </View>

      <View className="flex-row border-t border-slate-200 bg-white">
        <Pressable className="flex-1 items-center py-3" onPress={() => setMode('profile')}>
          <Text
            className={[
              'text-sm font-semibold',
              mode === 'profile' ? 'text-slate-950' : 'text-slate-500',
            ].join(' ')}
          >
            Posts
          </Text>
        </Pressable>
        <Pressable className="flex-1 items-center py-3" onPress={() => setMode('feed')}>
          <Text
            className={[
              'text-sm font-semibold',
              mode === 'feed' ? 'text-slate-950' : 'text-slate-500',
            ].join(' ')}
          >
            Feed
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Feed
      items={items}
      getItemId={item => item.id() || item.createdAt()}
      renderItem={({item, visible: itemVisible}) => (
        <Note note={item} visible={visible && itemVisible} onProfileOpen={() => {}} />
      )}
      header={header}
      stickyHeader={stickyHeader}
      visible={visible}
      empty={
        <View className="px-6 py-12">
          <Text className="text-center text-sm text-slate-500">
            {mode === 'profile' ? 'Loading posts...' : 'Feed is not loaded yet.'}
          </Text>
        </View>
      }
      contentContainerClassName="pb-28 px-2"
    />
  );
}

function ProfileModal({
  auth,
  onClose,
  onNavigate,
}: {
  auth: AuthState;
  onClose: () => void;
  onNavigate: (item: AppStackItem) => void;
}) {
  return (
    <View style={styles.modalBody}>
      <View style={styles.profileSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Profile</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.accountButtons}>
            {auth.pubkey ? (
              <HeaderProfileButton
                pubkey={auth.pubkey}
                className="h-14 w-14 border-emerald-600 bg-white"
              />
            ) : null}
            <Pressable style={styles.addAccountButton} onPress={() => onNavigate({type: 'login'})}>
              <Plus size={22} color="#17212b" strokeWidth={2.4} />
            </Pressable>
          </View>

          <View style={styles.menuGroup}>
            {auth.pubkey ? (
              <ProfileMenuRow
                icon={<LogOut size={21} color="#17212b" strokeWidth={2.1} />}
                label="Log out"
                onPress={() => onNavigate({type: 'logout'})}
              />
            ) : (
              <ProfileMenuRow
                icon={<KeyRound size={21} color="#17212b" strokeWidth={2.1} />}
                label="Sign in"
                onPress={() => onNavigate({type: 'login'})}
              />
            )}
          </View>

          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.menuGroup}>
            <ProfileMenuRow
              icon={<User size={21} color="#17212b" strokeWidth={2.1} />}
              label="My Profile"
              onPress={() => onNavigate({type: 'profileStub', path: 'nprofile'})}
            />
            <ProfileMenuRow
              icon={<KeyRound size={21} color="#17212b" strokeWidth={2.1} />}
              label="Keys"
              onPress={() => onNavigate({type: 'login'})}
            />
            <ProfileMenuRow
              icon={<Radio size={21} color="#17212b" strokeWidth={2.1} />}
              label="Relays"
              detail="Your relay preferences"
              onPress={() => onNavigate({type: 'profileStub', path: 'relays'})}
            />
            <ProfileMenuRow
              icon={<Wallet size={21} color="#17212b" strokeWidth={2.1} />}
              label="Wallet"
              detail="Wallet preferences"
              onPress={() => onNavigate({type: 'profileStub', path: 'wallet'})}
            />
            <ProfileMenuRow
              icon={<Palette size={21} color="#17212b" strokeWidth={2.1} />}
              label="Theme"
              detail="Appearance settings"
              onPress={() => onNavigate({type: 'profileStub', path: 'theme'})}
              last
            />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function ProfileMenuRow({
  icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.menuRow, last ? styles.menuRowLast : null]}
      onPress={onPress}
    >
      <View style={styles.menuIcon}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      </View>
      <ChevronRight size={21} color="#8794a0" strokeWidth={2.1} />
    </Pressable>
  );
}

function LogoutModal({
  manager,
  onDone,
}: {
  manager: NostrManagerLike | null;
  onDone: () => void;
}) {
  const clearAuth = useAuthStore(state => state.clearAuth);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletPassphrase = useWalletStore(state => state.setWalletPassphrase);

  const logout = () => {
    clearAuth();
    setWalletMnemonic('');
    setWalletPassphrase('');
    manager?.removeAccount();
    manager?.logout();
    onDone();
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Log out</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            Make sure you saved your private key before logging out.
          </Text>
        </View>
        <Pressable style={[styles.action, styles.loginAction]} onPress={logout}>
          <Text style={styles.actionText}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileStubModal({
  path,
  auth,
  onClose,
}: {
  path: 'relays' | 'wallet' | 'theme' | 'nprofile';
  auth: AuthState;
  onClose: () => void;
}) {
  const titles = {
    relays: 'Relays',
    wallet: 'Wallet',
    theme: 'Theme',
    nprofile: 'My Profile',
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>{titles[path]}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={styles.stackBody}>
          {titles[path]} is wired as a profile modal path and stubbed for now.
        </Text>
        {path === 'nprofile' && auth.pubkey ? (
          <Text style={styles.meta}>{auth.pubkey}</Text>
        ) : null}
      </View>
    </View>
  );
}

function StackCard({
  item,
  depthFromTop,
  onClose,
  onDismissProgress,
  onDismissComplete,
  onDismissCancel,
  dismissProgress,
  onPush,
  manager,
  auth,
}: {
  item: AppStackItem;
  index: number;
  depthFromTop: number;
  onClose: () => void;
  onDismissProgress: (progress: number) => void;
  onDismissComplete: () => void;
  onDismissCancel: () => void;
  dismissProgress: SharedValue<number>;
  onPush: (item: AppStackItem) => void;
  manager: NostrManagerLike | null;
  auth: AuthState;
}) {
  const enter = useSharedValue(0);
  const animatedDepth = useSharedValue(depthFromTop);
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const windowWidth = Dimensions.get('window').width;
  const windowHeight = Dimensions.get('window').height;
  const isModalItem =
    item.type === 'modal' ||
    item.type === 'feedBuilder' ||
    item.type === 'profile' ||
    item.type === 'login' ||
    item.type === 'logout' ||
    item.type === 'profileStub';
  const modalGestureStartLimit =
    item.type === 'feedBuilder' ? 104 : Math.min(220, windowHeight * 0.22);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 220 });
  }, [enter]);

  useEffect(() => {
    if (depthFromTop < animatedDepth.value && dismissProgress.value > 0) {
      animatedDepth.value = depthFromTop;
      return;
    }
    animatedDepth.value = withTiming(depthFromTop, {duration: 220});
  }, [animatedDepth, depthFromTop, dismissProgress]);

  const close = useCallback(() => {
    onDismissComplete();
    enter.value = withTiming(0, { duration: 180 }, () => runOnJS(onClose)());
  }, [enter, onClose, onDismissComplete]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (!isModalItem) return false;
          return (
            gesture.moveY <= modalGestureStartLimit &&
            gesture.dy > 10 &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx)
          );
        },
        onMoveShouldSetPanResponder: (_, gesture) =>
          item.type === 'notifications' ||
          item.type === 'chatThread' ||
          item.type === 'publicProfile'
            ? gesture.dx > 8 &&
              Math.abs(gesture.dx) > Math.abs(gesture.dy)
            : gesture.dy > 8 &&
              Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const nextX = Math.max(0, gesture.dx);
          const nextY = Math.max(0, gesture.dy);
          dismissX.value = nextX;
          dismissY.value = nextY;
          if (
            item.type === 'notifications' ||
            item.type === 'chatThread' ||
            item.type === 'publicProfile'
          ) {
            onDismissProgress(clamp(nextX / windowWidth, 0, 1));
          } else if (isModalItem) {
            onDismissProgress(clamp(nextY / windowHeight, 0, 1));
          }
        },
        onPanResponderRelease: (_, gesture) => {
          const shouldClose = isModalItem
            ? gesture.dy > 140 || gesture.vy > 0.65
            : gesture.dx > 96 || gesture.vx > 0.6;
          if (shouldClose) {
            if (isModalItem) {
              dismissY.value = withTiming(windowHeight, {duration: 180});
            } else {
              dismissX.value = withTiming(windowWidth, {duration: 180});
            }
            close();
            return;
          }
          dismissX.value = withSpring(0, SWIPE_SPRING);
          dismissY.value = withSpring(0, SWIPE_SPRING);
          if (
            item.type === 'notifications' ||
            item.type === 'chatThread' ||
            item.type === 'publicProfile' ||
            isModalItem
          ) {
            onDismissCancel();
          }
        },
      }),
    [
      close,
      dismissX,
      dismissY,
      isModalItem,
      item.type,
      modalGestureStartLimit,
      onDismissCancel,
      onDismissProgress,
      windowWidth,
      windowHeight,
    ],
  );

  const style = useAnimatedStyle(() => {
    const isSub =
      item.type === 'notifications' ||
      item.type === 'chatThread' ||
      item.type === 'publicProfile';
    const isModal = isModalItem;
    const effectiveDepth = Math.max(0, animatedDepth.value - dismissProgress.value);
    const scale = isSub ? 1 : 1 - effectiveDepth * 0.04;
    return {
      opacity: enter.value * Math.max(0.45, 1 - effectiveDepth * 0.25),
      transform: [
        {
          translateX: isSub
            ? (1 - enter.value) * windowWidth -
              effectiveDepth * 30 +
              dismissX.value
            : isModal
              ? 0
              : (1 - enter.value) * 80 - effectiveDepth * 24 + dismissX.value,
        },
        {
          translateY: isModal
            ? (1 - enter.value) * windowHeight +
              effectiveDepth * 30 +
              dismissY.value
            : (1 - enter.value) * 24 - effectiveDepth * 18 + dismissY.value,
        },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        item.type === 'publicProfile'
          ? styles.stackProfilePage
          : item.type === 'notifications'
          ? styles.stackSubPage
          : item.type === 'chatThread'
            ? styles.stackThreadPage
          : isModalItem
            ? styles.stackModalLayer
            : styles.stackCard,
        style,
      ]}
      {...panResponder.panHandlers}
    >
      {item.type === 'profile' ? (
        <ProfileModal
          auth={auth}
          onClose={close}
          onNavigate={onPush}
        />
      ) : item.type === 'publicProfile' ? (
        <PublicProfileSub
          pubkey={item.pubkey}
          visible={depthFromTop === 0}
          onClose={close}
        />
      ) : item.type === 'login' ? (
        <PrivateKeyLogin manager={manager} auth={auth} onDone={close} />
      ) : item.type === 'logout' ? (
        <LogoutModal manager={manager} onDone={close} />
      ) : item.type === 'profileStub' ? (
        <ProfileStubModal path={item.path} auth={auth} onClose={close} />
      ) : item.type === 'notifications' ? (
        <DummyNotificationsSub item={item} onClose={close} />
      ) : item.type === 'chatThread' ? (
        <Kind4Thread
          peerPubkey={item.peerPubkey}
          visible={depthFromTop === 0}
          onClose={close}
        />
      ) : item.type === 'modal' ? (
        <DummyPostModal item={item} onClose={close} />
      ) : item.type === 'feedBuilder' ? (
        <FeedBuilderModal onClose={close} />
      ) : (
        <>
          <Text style={styles.stackBody}>{item.route.description}</Text>
          <Pressable
            style={[styles.action, { backgroundColor: item.route.accent }]}
            onPress={close}
          >
            <Text style={styles.actionText}>Close</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}

function DummyNotificationsSub({
  item,
  onClose,
}: {
  item: Extract<AppStackItem, {type: 'notifications'}>;
  onClose: () => void;
}) {
  return (
    <View style={styles.subBody}>
      <Text style={styles.label}>Dummy sub</Text>
      <Text style={styles.value}>{item.route.label} notifications</Text>
      <Text style={styles.stackBody}>
        This is a placeholder subpage pushed from the bell button. It mirrors the
        web PagerAnimator shape: main content remains registered underneath and
        a sub page slides in from the right.
      </Text>
      <Pressable
        style={[styles.action, {backgroundColor: item.route.accent}]}
        onPress={onClose}
      >
        <Text style={styles.actionText}>Go back</Text>
      </Pressable>
    </View>
  );
}

function DummyPostModal({
  item,
  onClose,
}: {
  item: Extract<AppStackItem, {type: 'modal'}>;
  onClose: () => void;
}) {
  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <Text style={styles.stackTitle}>Post</Text>
        <Text style={styles.stackBody}>
          This is a placeholder modal opened from the composer. It mirrors the
          web modal path: the modal rises from the bottom and a downward swipe
          should move the page underneath in sync.
        </Text>
        <View style={styles.input}>
          <Text style={styles.meta}>Posting to {item.route.label}</Text>
        </View>
        <Pressable
          style={[styles.action, {backgroundColor: item.route.accent}]}
          onPress={onClose}
        >
          <Text style={styles.actionText}>Close modal</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrivateKeyLogin({
  manager,
  auth,
  onDone,
}: {
  manager: NostrManagerLike | null;
  auth: AuthState;
  onDone: () => void;
}) {
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore(state => state.setAuth);

  const submit = () => {
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }

    try {
      const secretKey = decodePrivateKey(privateKey);
      const privkey = bytesToHex(secretKey);
      const nsec = privateKey.trim().toLowerCase().startsWith('nsec')
        ? privateKey.trim()
        : nip19.nsecEncode(secretKey);
      manager.setSigner('privkey', privkey);
      setAuth({privkey, nsec});
      setPrivateKey('');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Authenticate</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
      <Text style={styles.stackBody}>
        Paste an nsec or 64-character hex private key. The native nipworker
        backend derives the public key and reports login through its auth event.
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="nsec1... or hex private key"
        placeholderTextColor="#8794a0"
        secureTextEntry
        style={styles.input}
        value={privateKey}
        onChangeText={text => {
          setPrivateKey(text);
          setError(null);
        }}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {auth.pubkey ? (
        <Text style={styles.successText}>
          Signed in as {auth.pubkey.slice(0, 16)}...
        </Text>
      ) : null}
      <Pressable
        style={[styles.action, manager ? styles.loginAction : styles.disabledAction]}
        onPress={submit}
      >
        <Text style={styles.actionText}>Sign in</Text>
      </Pressable>
      <Pressable style={styles.secondaryAction} onPress={onDone}>
        <Text style={styles.secondaryActionText}>Close</Text>
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f7f8',
  },
  navigator: {
    flex: 1,
    overflow: 'hidden',
  },
  mainPager: {
    flex: 1,
  },
  page: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#f5f7f8',
  },
  row: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#dce3e8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  label: {
    color: '#52616f',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  value: {
    color: '#17212b',
    fontSize: 17,
    marginTop: 4,
  },
  meta: {
    color: '#52616f',
    fontSize: 13,
    marginTop: 4,
  },
  action: {
    borderRadius: 8,
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  loginAction: {
    backgroundColor: '#17212b',
  },
  loginSuccessAction: {
    backgroundColor: '#1f7a5a',
  },
  disabledAction: {
    backgroundColor: '#8794a0',
  },
  secondaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryActionText: {
    color: '#52616f',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#f5f7f8',
    borderColor: '#dce3e8',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: '#17212b',
    fontSize: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    color: '#a13f2b',
    fontSize: 13,
    marginBottom: 12,
  },
  successText: {
    color: '#1f7a5a',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
  },
  carouselProgress: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    left: '25%',
    position: 'absolute',
    right: '25%',
    top: 8,
    zIndex: 20,
  },
  progressButton: {
    flex: 1,
    paddingVertical: 10,
  },
  progress: {
    backgroundColor: '#17212b',
    borderRadius: 2,
    height: 4,
  },
  stackCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dce3e8',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    left: 18,
    padding: 22,
    position: 'absolute',
    right: 18,
    top: 96,
  },
  stackSubPage: {
    backgroundColor: '#ffffff',
    bottom: 0,
    left: 0,
    paddingHorizontal: 22,
    paddingTop: 96,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  stackThreadPage: {
    backgroundColor: '#ffffff',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
  stackProfilePage: {
    backgroundColor: '#ffffff',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
  stackModalLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  subBody: {
    flex: 1,
  },
  modalBody: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    minHeight: '62%',
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  profileSheet: {
    backgroundColor: '#ffffff',
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: '#c7d0d8',
    borderRadius: 2,
    height: 4,
    marginBottom: 18,
    width: 42,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stackTitle: {
    color: '#17212b',
    fontSize: 24,
    fontWeight: '800',
  },
  stackBody: {
    color: '#52616f',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 18,
    marginTop: 8,
  },
  accountButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
    minHeight: 56,
  },
  addAccountButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce3e8',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sectionTitle: {
    color: '#17212b',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 4,
  },
  menuGroup: {
    borderColor: '#dce3e8',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
    overflow: 'hidden',
  },
  menuRow: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomColor: '#dce3e8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
  },
  menuText: {
    flex: 1,
  },
  menuLabel: {
    color: '#17212b',
    fontSize: 16,
    fontWeight: '800',
  },
  warningBox: {
    alignItems: 'center',
    backgroundColor: '#fff7db',
    borderColor: '#ead28f',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
    padding: 14,
  },
  warningText: {
    color: '#745b10',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
  },
});

export default App;
