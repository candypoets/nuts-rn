import './global.css';
import './textEncodingPolyfill';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  DefaultTheme,
  NavigationContainer,
  useIsFocused,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { enableFreeze, enableScreens } from 'react-native-screens';
import {
  ReanimatedLogLevel,
  configureReanimatedLogger,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NostrManagerLike } from '@candypoets/nipworker';
import {
  ReactNativeBackend,
  createNostrManager,
  hasReactNativeModule,
  setManager,
} from '@candypoets/nipworker/react-native';
import { nip19 } from 'nostr-tools';

import { ChatFeed, ExploreFeed, HomeFeed } from './src/feeds';
import { useFollowListPackSync } from './src/hooks/useFollowListPackSync';
import { useNotificationSubscription } from './src/hooks/useNotificationSubscription';
import { useRelayTracking } from './src/hooks/useRelayTracking';
import { useRootNostrSubscriptions } from './src/hooks/useRootNostrSubscriptions';
import {
  FeedBuilderModal,
  LogoutModal,
  PostModal,
  PrivateKeyLogin,
  ProfileModal,
  ProfileStubModal,
  ScanModal,
  SendModal,
  SendPlaceholderModal,
  SignupModal,
} from './src/modals';
import { Kind0Sub, Kind1Sub, Kind4Sub, NotificationsSub } from './src/subs';
import { useAuthStore } from './src/stores';
import { CarouselAnimator } from './src/components/CarouselAnimator';
import { ImageZoom } from './src/components/ImageZoom';
import { SendStatuses } from './src/components/SendStatuses';
import type { RootStackParamList } from './src/navigation/types';

enableScreens(true);
enableFreeze(true);

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

type RouteId = 'home' | 'explore' | 'chat';
const ROUTES: Array<{ id: RouteId; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'chat', label: 'Chat' },
];

const NativeStack = createNativeStackNavigator<RootStackParamList>();
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
  },
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [manager, setManagerInstance] = useState<NostrManagerLike | null>(null);

  useEffect(() => {
    if (!hasReactNativeModule()) return;

    try {
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
        <View style={styles.root}>
          <StatusBar
            translucent
            backgroundColor="transparent"
            barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          />
          <RootNavigator manager={manager} nostrEnabled={Boolean(manager)} />
          <SendStatuses />
          <ImageZoom />
        </View>
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
    <NavigationContainer theme={navigationTheme}>
      <NativeStack.Navigator
        initialRouteName="Main"
        screenOptions={{
          contentStyle: styles.root,
          freezeOnBlur: true,
          fullScreenGestureEnabled: true,
          animationMatchesGesture: true,
          headerShown: false,
        }}
      >
        <NativeStack.Screen name="Main" options={{ freezeOnBlur: false }}>
          {() => <MainTabs nostrEnabled={nostrEnabled} />}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <NativeStack.Screen
          name="ChatThread"
          component={ChatThreadScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <NativeStack.Screen
          name="Kind1Thread"
          component={Kind1ThreadScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <NativeStack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <NativeStack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen name="Login" options={{ presentation: 'modal' }}>
          {({ navigation }) => (
            <LoginScreen
              manager={manager}
              onClose={navigation.goBack}
            />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen name="Logout" options={{ presentation: 'modal' }}>
          {({ navigation }) => (
            <LogoutScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="FeedBuilder"
          component={FeedBuilderScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Post"
          component={PostScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Send"
          component={SendScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="SendEcash"
          component={SendEcashScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Tapcash"
          component={TapcashScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Lightning"
          component={LightningScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="ProfileStub"
          component={ProfileStubScreen}
          options={{ presentation: 'modal' }}
        />
      </NativeStack.Navigator>
    </NavigationContainer>
  );
}

function RootServices({ manager }: { manager: NostrManagerLike | null }) {
  const setAuth = useAuthStore(state => state.setAuth);

  useRootNostrSubscriptions(Boolean(manager));
  useNotificationSubscription(Boolean(manager));
  useRelayTracking(Boolean(manager));
  useFollowListPackSync();

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

function MainTabs({ nostrEnabled }: { nostrEnabled: boolean }) {
  const [activeRouteId, setActiveRouteId] = useState<RouteId>('explore');
  const [activatedRoutes, setActivatedRoutes] = useState<
    Record<RouteId, boolean>
  >({
    home: false,
    explore: true,
    chat: false,
  });
  const stackDepth = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const activeRouteIndex = useMemo(
    () =>
      Math.max(
        0,
        ROUTES.findIndex(route => route.id === activeRouteId),
      ),
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

  const changeRouteIndex = useCallback((index: number) => {
    setActiveRouteId(ROUTES[index]?.id ?? 'explore');
  }, []);

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
        renderPage={({ index, width }) => (
          <FeedPage key={ROUTES[index].id} width={width}>
            {ROUTES[index].id === 'home' ? (
              <HomeFeed enabled={nostrEnabled} visible={activatedRoutes.home} />
            ) : ROUTES[index].id === 'explore' ? (
              <ExploreFeed
                enabled={nostrEnabled}
                visible={activatedRoutes.explore}
              />
            ) : (
              <ChatFeed enabled={nostrEnabled} visible={activatedRoutes.chat} />
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
  const nsec = useAuthStore(state => state.nsec);
  return useMemo(() => ({ pubkey, hasSigner, nsec }), [hasSigner, nsec, pubkey]);
}

function ProfileScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Profile'>) {
  const auth = useAuthValue();
  return <ProfileModal auth={auth} onClose={navigation.goBack} />;
}

function LoginScreen({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const auth = useAuthValue();
  if (mode === 'signup') {
    return (
      <SignupModal
        manager={manager}
        onBackToLogin={() => setMode('login')}
        onDone={onClose}
      />
    );
  }
  return (
    <PrivateKeyLogin
      manager={manager}
      auth={auth}
      onDone={onClose}
      onSignup={() => setMode('signup')}
    />
  );
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

function NotificationsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Notifications'>) {
  const focused = useIsFocused();
  return <NotificationsSub visible={focused} onClose={navigation.goBack} />;
}

function PostScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Post'>) {
  return <PostModal onClose={navigation.goBack} />;
}

function SendScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Send'>) {
  return <SendModal onClose={navigation.goBack} />;
}

function SendEcashScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'SendEcash'>) {
  return (
    <SendPlaceholderModal
      title="Ecash"
      pubkey={route.params.pubkey}
      onClose={navigation.goBack}
    />
  );
}

function ScanScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Scan'>) {
  return <ScanModal onClose={navigation.goBack} />;
}

function TapcashScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Tapcash'>) {
  return <SendPlaceholderModal title="Tap cash" onClose={navigation.goBack} />;
}

function LightningScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Lightning'>) {
  return (
    <SendPlaceholderModal
      title="Lightning"
      invoice={route.params?.invoice}
      onClose={navigation.goBack}
    />
  );
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
  const [subVisible, setSubVisible] = useState(false);

  useEffect(() => {
    setSubVisible(false);
    if (!isFocused) return undefined;

    const frame = requestAnimationFrame(() => {
      setSubVisible(true);
    });

    return () => {
      cancelAnimationFrame(frame);
      setSubVisible(false);
    };
  }, [isFocused, route.params.pubkey]);

  return (
    <Kind0Sub
      pubkey={route.params.pubkey}
      visible={isFocused && subVisible}
      onClose={navigation.goBack}
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

function Kind1ThreadScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Kind1Thread'>) {
  const isFocused = useIsFocused();

  return (
    <Kind1Sub
      nevent={route.params.nevent}
      visible={isFocused}
      onClose={navigation.goBack}
    />
  );
}

function FeedPage({
  children,
  width,
}: {
  children: React.ReactNode;
  width: number;
}) {
  return (
    <View pointerEvents="box-none" style={[styles.page, { width }]}>
      {children}
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
    flex: 1,
    backgroundColor: '#f5f7f8',
  },
});

export default App;
