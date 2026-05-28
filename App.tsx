import './global.css';
import './textEncodingPolyfill';

import React, {useEffect, useMemo, useState} from 'react';
import {NativeModules, StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {
  default as Animated,
  ReanimatedLogLevel,
  configureReanimatedLogger,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
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
import {PagerAnimator, type PagerPresentation} from './src/components/PagerAnimator';
import {useRenderTrace} from './src/debug/renderTrace';

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
  const [activatedRoutes, setActivatedRoutes] = useState<Record<RouteId, boolean>>({
    home: true,
    explore: false,
    chat: false,
  });
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
    setActivatedRoutes(current =>
      current[activeRoute.id]
        ? current
        : {
            ...current,
            [activeRoute.id]: true,
          },
    );
  }, [activeRoute.id]);

  const push = (item: StackItem) => {
    setStack(items => {
      if (item.type === 'publicProfile') {
        const existingIndex = items.findIndex(
          current =>
            current.type === 'publicProfile' && current.pubkey === item.pubkey,
        );
        if (existingIndex >= 0) {
          return items.slice(0, existingIndex + 1);
        }
      }
      return [...items, item];
    });
  };
  const closeTop = () => setStack(items => items.slice(0, -1));
  const stackPresentationForItem = (item: StackItem): PagerPresentation =>
    item.type === 'publicProfile' || item.type === 'chatThread'
      ? 'sub'
      : 'modal';
  const stackKeyForItem = (item: StackItem, index: number) => {
    if (item.type === 'publicProfile') return `publicProfile:${item.pubkey}`;
    if (item.type === 'chatThread') return `chatThread:${item.peerPubkey}`;
    if (item.type === 'profileStub') return `profileStub:${item.path}`;
    return `${item.type}:${index}`;
  };
  const openProfileTarget = (item: ProfileModalTarget) => {
    if (item.type === 'profileStub' && item.path === 'nprofile' && auth.pubkey) {
      push({type: 'publicProfile', pubkey: auth.pubkey});
      return;
    }
    push(item);
  };
  const stackKey = stack.map(stackKeyForItem).join('|');

  useRenderTrace('MainTabs', {
    activeRouteId,
    activeRouteIndex,
    activatedRoutes: Object.entries(activatedRoutes)
      .filter(([, active]) => active)
      .map(([route]) => route)
      .join(','),
    stackKey,
    stackLength: stack.length,
    stackPresentation,
    topType: top?.type ?? 'none',
  });

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
        renderPage={({index, width, virtualX}) => (
          <FeedPage
            key={ROUTES[index].id}
            index={index}
            width={width}
            virtualX={virtualX}
          >
            {ROUTES[index].id === 'home' ? (
              <HomeFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.home}
                onLoginOpen={() => push({type: 'login'})}
                onProfileOpen={() => push({type: 'profile'})}
                onNotificationsOpen={() => undefined}
              />
            ) : ROUTES[index].id === 'explore' ? (
              <ExploreFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.explore}
                onFeedBuilderOpen={() => push({type: 'feedBuilder'})}
                onProfileOpen={pubkey => push({type: 'publicProfile', pubkey})}
              />
            ) : (
              <ChatFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.chat}
                onChatOpen={peerPubkey => push({type: 'chatThread', peerPubkey})}
              />
            )}
          </FeedPage>
        )}
      />
      <PagerAnimator
        dismissProgress={dismissProgress}
        getKey={stackKeyForItem}
        getPresentation={stackPresentationForItem}
        onCloseTop={closeTop}
        stack={stack}
        stackDepth={stackDepth}
        renderItem={({close, isTop, item}) =>
          item.type === 'profile' ? (
            <ProfileModal auth={auth} onClose={close} onNavigate={openProfileTarget} />
          ) : item.type === 'login' ? (
            <PrivateKeyLogin manager={manager} auth={auth} onDone={close} />
          ) : item.type === 'logout' ? (
            <LogoutModal manager={manager} onDone={close} />
          ) : item.type === 'feedBuilder' ? (
            <FeedBuilderModal onClose={close} />
          ) : item.type === 'profileStub' ? (
            <ProfileStubModal path={item.path} auth={auth} onClose={close} />
          ) : item.type === 'publicProfile' ? (
            <Kind0Sub
              pubkey={item.pubkey}
              visible={isTop}
              onClose={close}
              onProfileOpen={pubkey => push({type: 'publicProfile', pubkey})}
            />
          ) : (
            <Kind4Sub peerPubkey={item.peerPubkey} visible={isTop} onClose={close} />
          )
        }
      />
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
  useRenderTrace(`FeedPage:${index}`, {
    index,
    width,
  });
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
});

export default App;
