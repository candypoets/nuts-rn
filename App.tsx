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
  PanResponder,
  Pressable,
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
import type { NostrManagerLike } from '@candypoets/nipworker';
import {
  ReactNativeBackend,
  createNostrManager,
  hasReactNativeModule,
  setManager,
} from '@candypoets/nipworker/react-native';
import {Bell, Infinity, PenLine, RefreshCw} from 'lucide-react-native';
import { nip19 } from 'nostr-tools';
import {
  useAuthStore,
  useNostrStore,
  useRelayStore,
} from './src/stores';
import { useRootNostrSubscriptions } from './src/hooks/useRootNostrSubscriptions';
import { useRelayTracking } from './src/hooks/useRelayTracking';
import { ExploreFeed } from './src/feeds';
import { Feed } from './src/components/Feed';
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
      type: 'login';
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

  useRootNostrSubscriptions(Boolean(manager));
  useRelayTracking(Boolean(manager));

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
    topStackType === 'modal' || topStackType === 'feedBuilder';
  const virtualX = useSharedValue(0);
  const dragX = useSharedValue(0);
  const stackDepth = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const activeIndexRef = useRef(activeIndex);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    stackDepth.value = withTiming(stack.length, { duration: 220 });
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

  const closeTopStack = useCallback(() => {
    setStack(items => items.slice(0, -1));
    setTimeout(() => {
      dismissProgress.value = 0;
    }, 240);
  }, [dismissProgress]);

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
    const isSub = topStackType === 'notifications';
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
            onNotificationsOpen={() => pushNotifications(route)}
            onPostOpen={() => pushPostModal(route)}
            onFeedBuilderOpen={() => pushFeedBuilder(route)}
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
  onNotificationsOpen,
  onPostOpen,
  onFeedBuilderOpen,
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
  onNotificationsOpen: () => void;
  onPostOpen: () => void;
  onFeedBuilderOpen: () => void;
  status: { hasModule: boolean; backendStatus: string };
  subscriptionStatus: string;
  firstEvent: ReceivedEvent | null;
  auth: AuthState;
  nostrEnabled: boolean;
}) {
  const readRelays = useNostrStore(state => state.readRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const displayRelays =
    auth.pubkey && readRelays.length ? readRelays : DEFAULT_FEED_RELAYS;
  const feedItems = useMemo<FeedPageItem[]>(
    () =>
      route.id === 'home'
        ? [{type: 'smoke'}]
        : [],
    [route.id],
  );
  const renderHeader = useCallback(
    () => (
      <View className="bg-slate-50 px-1 pt-2">
        <View className="mx-1 rounded-lg bg-white/90 px-3 py-3 shadow-sm">
          <View className="h-14 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              {route.id === 'explore' ? (
                <Pressable
                  className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
                  hitSlop={12}
                  onPress={onFeedBuilderOpen}
                >
                  <Infinity size={21} color="#17212b" strokeWidth={2.2} />
                </Pressable>
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
                onPress={auth.pubkey ? undefined : onLoginOpen}
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
      onLoginOpen,
      onNotificationsOpen,
      relayStatuses,
      route.id,
    ],
  );
  const renderStickyHeader = useCallback(
    () => (
      <View className="border-b border-slate-200 bg-slate-50/95 px-4 py-2">
        <View className="h-12 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {route.id === 'explore' ? (
              <Pressable
                className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white"
                hitSlop={12}
                onPress={onFeedBuilderOpen}
              >
                <Infinity size={21} color="#17212b" strokeWidth={2.2} />
              </Pressable>
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
              onPress={auth.pubkey ? undefined : onLoginOpen}
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
      onLoginOpen,
      onNotificationsOpen,
      relayStatuses,
      route.id,
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
        />
      ) : (
        <Feed
          items={feedItems}
          getItemId={item => item.type}
          pullToRefresh
          stickyFooterVisible={route.id === 'home'}
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

function StackCard({
  item,
  depthFromTop,
  onClose,
  onDismissProgress,
  onDismissComplete,
  onDismissCancel,
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
  manager: NostrManagerLike | null;
  auth: AuthState;
}) {
  const enter = useSharedValue(0);
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const windowWidth = Dimensions.get('window').width;
  const windowHeight = Dimensions.get('window').height;
  const isModalItem = item.type === 'modal' || item.type === 'feedBuilder';
  const modalGestureStartLimit =
    item.type === 'feedBuilder' ? 104 : Math.min(220, windowHeight * 0.22);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 220 });
  }, [enter]);

  const close = useCallback(() => {
    enter.value = withTiming(0, { duration: 180 }, () => runOnJS(onClose)());
  }, [enter, onClose]);

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
          item.type === 'notifications'
            ? gesture.dx > 8 &&
              Math.abs(gesture.dx) > Math.abs(gesture.dy)
            : gesture.dy > 8 &&
              Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const nextX = Math.max(0, gesture.dx);
          const nextY = Math.max(0, gesture.dy);
          dismissX.value = nextX;
          dismissY.value = nextY;
          if (item.type === 'notifications') {
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
            if (item.type === 'notifications' || isModalItem) {
              onDismissComplete();
            }
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
          if (item.type === 'notifications' || isModalItem) {
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
      onDismissComplete,
      onDismissProgress,
      windowWidth,
      windowHeight,
    ],
  );

  const style = useAnimatedStyle(() => {
    const isSub = item.type === 'notifications';
    const isModal = isModalItem;
    const scale = isSub || isModal ? 1 : 1 - depthFromTop * 0.04;
    return {
      opacity: enter.value * Math.max(0.45, 1 - depthFromTop * 0.25),
      transform: [
        {
          translateX: isSub
            ? (1 - enter.value) * windowWidth -
              depthFromTop * 30 +
              dismissX.value
            : (1 - enter.value) * 80 - depthFromTop * 24 + dismissX.value,
        },
        {
          translateY: isModal
            ? (1 - enter.value) * windowHeight -
              depthFromTop * 30 +
              dismissY.value
            : (1 - enter.value) * 24 - depthFromTop * 18 + dismissY.value,
        },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        item.type === 'notifications'
          ? styles.stackSubPage
          : isModalItem
            ? styles.stackModalLayer
            : styles.stackCard,
        style,
      ]}
      {...panResponder.panHandlers}
    >
      {item.type === 'login' ? (
        <PrivateKeyLogin manager={manager} auth={auth} onDone={close} />
      ) : item.type === 'notifications' ? (
        <DummyNotificationsSub item={item} onClose={close} />
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
    <View>
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
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: '#c7d0d8',
    borderRadius: 2,
    height: 4,
    marginBottom: 18,
    width: 42,
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
});

export default App;
