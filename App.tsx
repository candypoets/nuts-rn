import './global.css';
import './textEncodingPolyfill';

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {NativeModules, StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {NavigationContainer, useIsFocused, useNavigation} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {enableFreeze, enableScreens} from 'react-native-screens';
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
import {useRenderTrace} from './src/debug/renderTrace';

enableScreens(true);
enableFreeze(true);

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

type RouteId = 'home' | 'explore' | 'chat';
type RootStackParamList = {
  Main: undefined;
  Profile: undefined;
  Login: undefined;
  Logout: undefined;
  FeedBuilder: undefined;
  ProfileStub: {path: 'relays' | 'wallet' | 'theme' | 'nprofile'};
  PublicProfile: {pubkey: string};
  ChatThread: {peerPubkey: string};
};

const ROUTES: Array<{id: RouteId; label: string}> = [
  {id: 'home', label: 'Home'},
  {id: 'explore', label: 'Explore'},
  {id: 'chat', label: 'Chat'},
];

const NativeStack = createNativeStackNavigator<RootStackParamList>();

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
          <RootNavigator manager={manager} nostrEnabled={Boolean(manager)} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({
  manager,
  nostrEnabled,
}: {
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
}) {
  return (
    <NavigationContainer>
      <NativeStack.Navigator
        initialRouteName="Main"
        screenOptions={{
          contentStyle: styles.root,
          freezeOnBlur: true,
          headerShown: false,
        }}
      >
        <NativeStack.Screen name="Main" options={{freezeOnBlur: false}}>
          {() => <MainTabs nostrEnabled={nostrEnabled} />}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
          options={{animation: 'slide_from_right'}}
        />
        <NativeStack.Screen
          name="ChatThread"
          component={ChatThreadScreen}
          options={{animation: 'slide_from_right'}}
        />
        <NativeStack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{presentation: 'modal'}}
        />
        <NativeStack.Screen name="Login" options={{presentation: 'modal'}}>
          {({navigation}) => (
            <LoginScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen name="Logout" options={{presentation: 'modal'}}>
          {({navigation}) => (
            <LogoutScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="FeedBuilder"
          component={FeedBuilderScreen}
          options={{presentation: 'modal'}}
        />
        <NativeStack.Screen
          name="ProfileStub"
          component={ProfileStubScreen}
          options={{presentation: 'modal'}}
        />
      </NativeStack.Navigator>
    </NavigationContainer>
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

function MainTabs({nostrEnabled}: {nostrEnabled: boolean}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [activeRouteId, setActiveRouteId] = useState<RouteId>('home');
  const [activatedRoutes, setActivatedRoutes] = useState<Record<RouteId, boolean>>({
    home: true,
    explore: false,
    chat: false,
  });
  const stackDepth = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const activeRouteIndex = useMemo(
    () => Math.max(0, ROUTES.findIndex(route => route.id === activeRouteId)),
    [activeRouteId],
  );
  const activeRoute = ROUTES[activeRouteIndex] ?? ROUTES[0];

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

  const openLogin = useCallback(() => navigation.navigate('Login'), [navigation]);
  const openProfile = useCallback(() => navigation.navigate('Profile'), [navigation]);
  const openFeedBuilder = useCallback(
    () => navigation.navigate('FeedBuilder'),
    [navigation],
  );
  const openPublicProfile = useCallback(
    (pubkey: string) => navigation.push('PublicProfile', {pubkey}),
    [navigation],
  );
  const openChatThread = useCallback(
    (peerPubkey: string) => navigation.push('ChatThread', {peerPubkey}),
    [navigation],
  );
  const changeRouteIndex = useCallback((index: number) => {
    setActiveRouteId(ROUTES[index]?.id ?? 'home');
  }, []);
  const noop = useCallback(() => undefined, []);

  useRenderTrace('MainTabs', {
    activeRouteId,
    activeRouteIndex,
    activatedRoutes: Object.entries(activatedRoutes)
      .filter(([, active]) => active)
      .map(([route]) => route)
      .join(','),
  });

  return (
    <View style={styles.navigator}>
      <CarouselAnimator
        activeIndex={activeRouteIndex}
        pageCount={ROUTES.length}
        labels={ROUTES.map(route => route.label)}
        enabled
        stackDepth={stackDepth}
        dismissProgress={dismissProgress}
        stackPresentation="flat"
        onIndexChange={changeRouteIndex}
        renderPage={({index, width, virtualIndex}) => (
          <FeedPage
            key={ROUTES[index].id}
            index={index}
            width={width}
            virtualIndex={virtualIndex}
          >
            {ROUTES[index].id === 'home' ? (
              <HomeFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.home}
                onLoginOpen={openLogin}
                onProfileOpen={openProfile}
                onNotificationsOpen={noop}
              />
            ) : ROUTES[index].id === 'explore' ? (
              <ExploreFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.explore}
                onFeedBuilderOpen={openFeedBuilder}
                onProfileOpen={openPublicProfile}
              />
            ) : (
              <ChatFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.chat}
                onChatOpen={openChatThread}
              />
            )}
          </FeedPage>
        )}
      />
    </View>
  );
}

function useAuthValue() {
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  return useMemo(() => ({pubkey, hasSigner}), [hasSigner, pubkey]);
}

function ProfileScreen({navigation}: NativeStackScreenProps<RootStackParamList, 'Profile'>) {
  const auth = useAuthValue();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openProfileTarget = useCallback(
    (item: ProfileModalTarget) => {
      if (item.type === 'profileStub' && item.path === 'nprofile' && auth.pubkey) {
        rootNavigation.push('PublicProfile', {pubkey: auth.pubkey});
        return;
      }
      if (item.type === 'profileStub') {
        rootNavigation.navigate('ProfileStub', {path: item.path});
      }
    },
    [auth.pubkey, rootNavigation],
  );
  return (
    <ProfileModal
      auth={auth}
      onClose={navigation.goBack}
      onNavigate={openProfileTarget}
    />
  );
}

function LoginScreen({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  const auth = useAuthValue();
  return <PrivateKeyLogin manager={manager} auth={auth} onDone={onClose} />;
}

function LogoutScreen({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  return <LogoutModal manager={manager} onDone={onClose} />;
}

function FeedBuilderScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'FeedBuilder'>) {
  return <FeedBuilderModal onClose={navigation.goBack} />;
}

function ProfileStubScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'ProfileStub'>) {
  const auth = useAuthValue();
  return (
    <ProfileStubModal
      path={route.params.path}
      auth={auth}
      onClose={navigation.goBack}
    />
  );
}

function PublicProfileScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'PublicProfile'>) {
  const isFocused = useIsFocused();
  const openPublicProfile = useCallback(
    (pubkey: string) => navigation.push('PublicProfile', {pubkey}),
    [navigation],
  );
  return (
    <Kind0Sub
      pubkey={route.params.pubkey}
      visible={isFocused}
      onClose={navigation.goBack}
      onProfileOpen={openPublicProfile}
    />
  );
}

function ChatThreadScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'ChatThread'>) {
  const isFocused = useIsFocused();
  return (
    <Kind4Sub
      peerPubkey={route.params.peerPubkey}
      visible={isFocused}
      onClose={navigation.goBack}
    />
  );
}

function FeedPage({
  children,
  index,
  virtualIndex,
  width,
}: {
  children: React.ReactNode;
  index: number;
  virtualIndex: SharedValue<number>;
  width: number;
}) {
  useRenderTrace(`FeedPage:${index}`, {
    index,
    width,
  });
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{translateX: (index - virtualIndex.value) * width}],
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
