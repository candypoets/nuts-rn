import './global.css';
import './textEncodingPolyfill';

import React, {useEffect, useMemo, useState} from 'react';
import {NativeModules, Pressable, StatusBar, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {
  default as Animated,
  ReanimatedLogLevel,
  configureReanimatedLogger,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import type {NostrManagerLike} from '@candypoets/nipworker';
import {
  ReactNativeBackend,
  createNostrManager,
  hasReactNativeModule,
  setManager,
} from '@candypoets/nipworker/react-native';
import {nip19} from 'nostr-tools';

import {ChatFeed, ExploreFeed, HomeFeed} from './src/feeds';
import {useFollowListPackSync} from './src/hooks/useFollowListPackSync';
import {useRelayTracking} from './src/hooks/useRelayTracking';
import {useRootNostrSubscriptions} from './src/hooks/useRootNostrSubscriptions';
import {
  FeedBuilderModal,
  LogoutModal,
  PrivateKeyLogin,
  ProfileModal,
  ProfileStubModal,
  type ProfileModalTarget,
} from './src/modals';
import {Kind0Sub, Kind4Sub} from './src/subs';
import {useAuthStore} from './src/stores';
import {CarouselAnimator} from './src/components/CarouselAnimator';

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

type RouteId = 'home' | 'explore' | 'chat';
type StackItem =
  | {type: 'profile'}
  | {type: 'login'}
  | {type: 'logout'}
  | {type: 'feedBuilder'}
  | {type: 'profileStub'; path: 'relays' | 'wallet' | 'theme' | 'nprofile'}
  | {type: 'publicProfile'; pubkey: string}
  | {type: 'chatThread'; peerPubkey: string};

const ROUTES: Array<{id: RouteId; label: string}> = [
  {id: 'home', label: 'Home'},
  {id: 'explore', label: 'Explore'},
  {id: 'chat', label: 'Chat'},
];

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [manager, setManagerInstance] = useState<NostrManagerLike | null>(null);

  useEffect(() => {
    if (!hasReactNativeModule()) return;

    try {
      if (__DEV__) {
        NativeModules.NipworkerReactNativeModule?.deinit?.();
      }
      const nextManager = __DEV__
        ? new ReactNativeBackend()
        : createNostrManager();
      setManager(nextManager);
      setManagerInstance(nextManager);
    } catch (error) {
      console.warn('[app] failed to initialize nostr manager', error);
    }
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <RootServices manager={manager} />
        <SafeAreaView style={styles.root}>
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <MainTabs manager={manager} nostrEnabled={Boolean(manager)} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootServices({manager}: {manager: NostrManagerLike | null}) {
  const setAuth = useAuthStore(state => state.setAuth);

  useRootNostrSubscriptions(Boolean(manager));
  useRelayTracking(Boolean(manager));
  useFollowListPackSync();

  useEffect(() => {
    if (!manager) return;

    const handleAuth = (event: Event) => {
      const detail = (
        event as Event & {
          detail?: {pubkey?: string | null; hasSigner?: boolean};
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

function MainTabs({
  manager,
  nostrEnabled,
}: {
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
}) {
  const [activeRouteId, setActiveRouteId] = useState<RouteId>('home');
  const [stack, setStack] = useState<StackItem[]>([]);
  const stackDepth = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const authPubkey = useAuthStore(state => state.pubkey);
  const authHasSigner = useAuthStore(state => state.hasSigner);
  const activeRouteIndex = useMemo(
    () => Math.max(0, ROUTES.findIndex(route => route.id === activeRouteId)),
    [activeRouteId],
  );
  const activeRoute = ROUTES[activeRouteIndex] ?? ROUTES[0];
  const auth = useMemo(
    () => ({pubkey: authPubkey, hasSigner: authHasSigner}),
    [authHasSigner, authPubkey],
  );
  const top = stack.at(-1) ?? null;
  const stackPresentation =
    top?.type === 'publicProfile' || top?.type === 'chatThread'
      ? 'sub'
      : top
        ? 'modal'
        : 'flat';

  useEffect(() => {
    stackDepth.value = withTiming(stack.length, {duration: 220});
  }, [stack.length, stackDepth]);

  const push = (item: StackItem) => {
    setStack(items => {
      const current = items.at(-1);
      if (
        current?.type === 'publicProfile' &&
        item.type === 'publicProfile' &&
        current.pubkey === item.pubkey
      ) {
        return items;
      }
      return [...items, item];
    });
  };
  const closeTop = () => setStack(items => items.slice(0, -1));
  const openProfileTarget = (item: ProfileModalTarget) => {
    if (item.type === 'profileStub' && item.path === 'nprofile' && auth.pubkey) {
      push({type: 'publicProfile', pubkey: auth.pubkey});
      return;
    }
    push(item);
  };

  return (
    <View style={styles.navigator}>
      <CarouselAnimator
        activeIndex={activeRouteIndex}
        pageCount={ROUTES.length}
        labels={ROUTES.map(route => route.label)}
        enabled={!top}
        stackDepth={stackDepth}
        dismissProgress={dismissProgress}
        stackPresentation={stackPresentation}
        onIndexChange={index => {
          setActiveRouteId(ROUTES[index]?.id ?? 'home');
        }}
        renderPage={({index, width, virtualX, isActive}) => (
          <FeedPage
            key={ROUTES[index].id}
            index={index}
            width={width}
            virtualX={virtualX}
          >
            {ROUTES[index].id === 'home' ? (
              <HomeFeed
                enabled={nostrEnabled}
                visible={isActive}
                onLoginOpen={() => push({type: 'login'})}
                onProfileOpen={() => push({type: 'profile'})}
                onNotificationsOpen={() => undefined}
              />
            ) : ROUTES[index].id === 'explore' ? (
              <ExploreFeed
                enabled={nostrEnabled}
                visible={isActive}
                onProfileOpen={pubkey => push({type: 'publicProfile', pubkey})}
              />
            ) : (
              <ChatFeed
                enabled={nostrEnabled}
                visible={isActive}
                onChatOpen={peerPubkey => push({type: 'chatThread', peerPubkey})}
              />
            )}
          </FeedPage>
        )}
      />
      <BottomTabs activeRouteId={activeRoute.id} onRoutePress={setActiveRouteId} />
      {top ? (
        <View style={top.type === 'publicProfile' || top.type === 'chatThread' ? styles.subLayer : styles.modalLayer}>
          {top.type === 'profile' ? (
            <ProfileModal auth={auth} onClose={closeTop} onNavigate={openProfileTarget} />
          ) : top.type === 'login' ? (
            <PrivateKeyLogin manager={manager} auth={auth} onDone={closeTop} />
          ) : top.type === 'logout' ? (
            <LogoutModal manager={manager} onDone={closeTop} />
          ) : top.type === 'feedBuilder' ? (
            <FeedBuilderModal onClose={closeTop} />
          ) : top.type === 'profileStub' ? (
            <ProfileStubModal path={top.path} auth={auth} onClose={closeTop} />
          ) : top.type === 'publicProfile' ? (
            <Kind0Sub
              pubkey={top.pubkey}
              visible
              onClose={closeTop}
              onProfileOpen={pubkey => push({type: 'publicProfile', pubkey})}
            />
          ) : (
            <Kind4Sub peerPubkey={top.peerPubkey} visible onClose={closeTop} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function FeedPage({
  children,
  index,
  virtualX,
  width,
}: {
  children: React.ReactNode;
  index: number;
  virtualX: SharedValue<number>;
  width: number;
}) {
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{translateX: index * width - virtualX.value}],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.page, {width}, pageStyle]}
    >
      {children}
    </Animated.View>
  );
}

function BottomTabs({
  activeRouteId,
  onRoutePress,
}: {
  activeRouteId: RouteId;
  onRoutePress: (routeId: RouteId) => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      {ROUTES.map(route => {
        const active = route.id === activeRouteId;
        return (
          <Pressable
            key={route.id}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            style={[styles.bottomTab, active ? styles.bottomTabActive : null]}
            onPress={() => onRoutePress(route.id)}
          >
            <Text
              style={[
                styles.bottomTabText,
                active ? styles.bottomTabTextActive : null,
              ]}
            >
              {route.label}
            </Text>
          </Pressable>
        );
      })}
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
  page: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#f5f7f8',
  },
  modalLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
    zIndex: 40,
  },
  subLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#f5f7f8',
    zIndex: 40,
  },
  bottomTabs: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce3e8',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 12,
    flexDirection: 'row',
    gap: 4,
    left: 12,
    padding: 4,
    position: 'absolute',
    right: 12,
    zIndex: 30,
  },
  bottomTab: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 8,
  },
  bottomTabActive: {
    backgroundColor: '#17212b',
  },
  bottomTabText: {
    color: '#52616f',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomTabTextActive: {
    color: '#ffffff',
  },
});

export default App;
