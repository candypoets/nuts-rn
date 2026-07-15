import './global.css';
import './textEncodingPolyfill';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
  type KeyboardEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  DefaultTheme,
  NavigationContainer,
  useIsFocused,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import {
  createNativeBottomTabNavigator,
  type NativeBottomTabIcon,
} from '@react-navigation/bottom-tabs/unstable';
import {House, Layers3, MessageCircle} from 'lucide-react-native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { enableFreeze, enableScreens } from 'react-native-screens';
import {
  ReanimatedLogLevel,
  configureReanimatedLogger,
} from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NostrManagerLike } from '@candypoets/nipworker';
import {MintQuoteState, Wallet as CashuWallet} from '@cashu/cashu-ts';
import {
  ReactNativeBackend,
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
  CalendarEventModal,
  Kind1111CommentsModal,
  KeysModal,
  CmdKModal,
  LogoutModal,
  MintingModal,
  MintsModal,
  NewChatModal,
  PostModal,
  PrivateKeyLogin,
  ProfileModal,
  ProfileStubModal,
  ReceiveModal,
  RelayPreferencesModal,
  RelayInfosModal,
  ScanModal,
  SendEcashModal,
  SendModal,
  SendPlaceholderModal,
  ShareModal,
  SignupModal,
  ThemeModal,
  WalletModal,
} from './src/modals';
import { CommunitySub, Kind0Sub, Kind1Sub, Kind30023Sub, Kind4Sub, LiveStreamSub, NotificationsSub, TagsSub } from './src/subs';
import {useAuthStore, useNostrStore, useWalletStore} from './src/stores';
import { ImageZoom } from './src/components/ImageZoom';
import { SendStatuses } from './src/components/SendStatuses';
import type { RootStackParamList } from './src/navigation/types';
import {rootNavigationRef} from './src/navigation/rootNavigation';
import {
  configureNativeTabBarCompactAppearance,
  setNativeTabBarVisible,
} from './src/navigation/nativeTabBar';
import {publishProofsBackup} from './src/nostr/proofBackup';
import {uniqueWalletRelays} from './src/hooks/useWalletSubscription';
import {resumePendingTransactions} from './src/model/cashu/txRecovery';
import { getAppThemeVars, isAppThemeDark, useAppTheme } from './src/theme';
import { startNativeDebugLogRelay } from './src/debug/nativeDebugBridge';
import {NativeParityHarness} from './src/debug/NativeParityHarness';

enableScreens(true);
enableFreeze(true);

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

type RouteId = 'home' | 'explore' | 'chat';
type MainTabParamList = {
  HomeTab: undefined;
  ExploreTab: undefined;
  ChatTab: undefined;
};
const NativeStack = createNativeStackNavigator<RootStackParamList>();
const NativeBottomTabs = createNativeBottomTabNavigator<MainTabParamList>();
const AndroidBottomTabs = createBottomTabNavigator<MainTabParamList>();
const supportsNativeTabBarMinimization =
  Platform.OS === 'ios' && Number.parseFloat(String(Platform.Version)) >= 26;
const MINT_QUOTE_MONITOR_INTERVAL_MS = 2500;
const MINT_QUOTE_RETRY_DELAY_MS = 1200;
const PUSH_SCREEN_OPTIONS = {
  animation: 'simple_push' as const,
};
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
  },
};

function scheduleNostrCleanup(manager: NostrManagerLike | null, delay = 1000) {
  if (!manager) return () => {};

  const timeout = setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        manager.cleanup();
      });
    });
  }, delay);

  return () => clearTimeout(timeout);
}

function createSharedNostrManager(): NostrManagerLike | null {
  if (!hasReactNativeModule()) return null;

  // This must run before Swift/Kotlin native components use Nipworker hooks.
  // The RN manager initializes the Rust runtime that native components borrow.
  const manager = new ReactNativeBackend();

  setManager(manager);
  return manager;
}

function isRetryableMintNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancelled|canceled|network request failed|fetch failed/i.test(message);
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function retryMintNetworkCall<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableMintNetworkError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise<void>(resolve =>
        setTimeout(resolve, MINT_QUOTE_RETRY_DELAY_MS * (attempt + 1)),
      );
    }
  }
  throw lastError;
}

function App() {
  const theme = useAppTheme();
  const isDarkMode = isAppThemeDark(theme);
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  const [manager] = useState<NostrManagerLike | null>(() => {
    try {
      return createSharedNostrManager();
    } catch (error) {
      console.warn('[app] failed to initialize nostr manager', error);
      return null;
    }
  });
  const keyboardResizeStyle = useKeyboardResizeStyle();
  useEffect(() => {
    return startNativeDebugLogRelay(event => {
      if (event.event === 'summary' && event.logs?.length) {
        const tabBarDiagnostic = event.logs.find(
          log =>
            log.source === 'NativeTabBarController' &&
            log.event === 'scroll-view-diagnostic',
        );
        if (tabBarDiagnostic?.details) {
          console.log('[tab-bar-scroll]', tabBarDiagnostic.details);
        }
        console.log(
          '[native-debug]',
          event.logs
            .map(log => {
              const context = log.context ? `/${log.context}` : '';
              return `${log.source}.${log.event}${context} x${log.count ?? 0}`;
            })
            .join(' | '),
          event.logs.slice(0, 8).map(log => log.details),
        );
        return;
      }
      console.log('[native-debug]', event);
    });
  }, []);

  if (!manager) {
    return null;
  }

  const showNativeParityHarness =
    __DEV__ && process.env.EXPO_PUBLIC_NATIVE_PARITY === '1';

  return (
    <GestureHandlerRootView
      style={[styles.root, { backgroundColor: theme.colors.base100 }]}
    >
      <KeyboardProvider>
        <SafeAreaProvider>
          <View
            style={[
              styles.root,
              themeVars,
              { backgroundColor: theme.colors.base100 },
            ]}
          >
            <RootServices manager={manager} />
            <Animated.View
              style={[
                styles.root,
                { backgroundColor: theme.colors.base100 },
                keyboardResizeStyle,
              ]}
            >
              <StatusBar
                translucent
                backgroundColor="transparent"
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
              />
              {showNativeParityHarness ? (
                <NativeParityHarness />
              ) : (
                <RootNavigator manager={manager} nostrEnabled={Boolean(manager)} />
              )}
              <SendStatuses />
            </Animated.View>
          </View>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function useKeyboardResizeStyle() {
  const { height: windowHeight } = useWindowDimensions();
  const height = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;

    height.setValue(windowHeight);
  }, [height, windowHeight]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;

    const animateToKeyboardFrame = (event: KeyboardEvent) => {
      const keyboardTop = event.endCoordinates.screenY;
      const nextHeight = Math.max(0, Math.min(windowHeight, keyboardTop));

      Animated.timing(height, {
        toValue: nextHeight,
        duration: Math.max(1, event.duration || 250),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    };

    const change = Keyboard.addListener(
      'keyboardWillChangeFrame',
      animateToKeyboardFrame,
    );
    const hide = Keyboard.addListener('keyboardWillHide', event => {
      Animated.timing(height, {
        toValue: windowHeight,
        duration: Math.max(1, event.duration || 250),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });

    return () => {
      change.remove();
      hide.remove();
    };
  }, [height, windowHeight]);

  if (Platform.OS !== 'ios') return null;
  return { flex: 0, height };
}

function RootNavigator({
  manager,
  nostrEnabled,
}: {
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
}) {
  const theme = useAppTheme();
  const themedNavigationTheme = useMemo(
    () => ({
      ...navigationTheme,
      colors: {
        ...navigationTheme.colors,
        background: theme.colors.base100,
      },
    }),
    [theme.colors.base100],
  );
  const cleanupCancelRef = useRef<(() => void) | null>(null);
  const contentStyle = useMemo(
    () => [styles.root, { backgroundColor: theme.colors.base100 }],
    [theme],
  );
  const scheduleCleanup = useCallback(
    (delay = 1000) => {
      cleanupCancelRef.current?.();
      cleanupCancelRef.current = scheduleNostrCleanup(manager, delay);
    },
    [manager],
  );

  useEffect(
    () => () => {
      cleanupCancelRef.current?.();
      cleanupCancelRef.current = null;
    },
    [],
  );

  return (
    <NavigationContainer
      ref={rootNavigationRef}
      theme={themedNavigationTheme}
      onStateChange={() => scheduleCleanup()}
    >
      <NativeStack.Navigator
        initialRouteName="Main"
        screenOptions={{
          contentStyle,
          freezeOnBlur: true,
          fullScreenGestureEnabled: true,
          animationMatchesGesture: true,
          headerShown: false,
        }}
      >
        <NativeStack.Screen name="Main" options={{ freezeOnBlur: false }}>
          {() => <MainTabs manager={manager} nostrEnabled={nostrEnabled} />}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="Community"
          component={CommunityScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="CalendarEvent"
          component={CalendarEventScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="ChatThread"
          component={ChatThreadScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="Kind1Thread"
          component={Kind1ThreadScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="Kind30023Thread"
          component={Kind30023ThreadScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="LiveStream"
          component={LiveStreamScreen}
          options={{ presentation: 'modal', gestureEnabled: true }}
        />
        <NativeStack.Screen
          name="Kind1111Comments"
          component={Kind1111CommentsScreen}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.66, 0.92],
            sheetExpandsWhenScrolledToEdge: false,
            sheetGrabberVisible: true,
            sheetInitialDetentIndex: 0,
          }}
        />
        <NativeStack.Screen
          name="Tags"
          component={TagsScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={PUSH_SCREEN_OPTIONS}
        />
        <NativeStack.Screen
          name="Profile"
          options={{ presentation: 'modal' }}
        >
          {props => (
            <ProfileScreen {...props} manager={manager} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen name="Login" options={{ presentation: 'modal' }}>
          {({ navigation }) => (
            <LoginScreen
              manager={manager}
              onClose={navigation.goBack}
            />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen name="Logout" options={{ presentation: 'formSheet' }}>
          {({ navigation }) => (
            <LogoutScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen name="Keys" options={{ presentation: 'modal' }}>
          {({ navigation }) => <KeysScreen onClose={navigation.goBack} />}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="CmdK"
          component={CmdKScreen}
          options={{ presentation: 'fullScreenModal' }}
        />
        <NativeStack.Screen
          name="FeedBuilder"
          component={FeedBuilderScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Post"
          component={PostScreen}
          options={{ presentation: 'modal', gestureEnabled: true }}
        />
        <NativeStack.Screen
          name="Receive"
          component={ReceiveScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Minting"
          component={MintingScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Send"
          component={SendScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="NewChat"
          component={NewChatScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="SendEcash"
          component={SendEcashScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Share"
          component={ShareScreen}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6],
            sheetCornerRadius: 18,
            sheetGrabberVisible: false,
          }}
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
          name="Theme"
          component={ThemeScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="Mints"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Mints',
          }}
        >
          {({ navigation }) => (
            <MintsScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="RelayPreferences"
          component={RelayPreferencesScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen name="Wallet" options={{ presentation: 'modal' }}>
          {({ navigation }) => (
            <WalletScreen manager={manager} onClose={navigation.goBack} />
          )}
        </NativeStack.Screen>
        <NativeStack.Screen
          name="ProfileStub"
          component={ProfileStubScreen}
          options={{ presentation: 'modal' }}
        />
        <NativeStack.Screen
          name="RelayInfos"
          component={RelayInfosScreen}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.66],
            sheetGrabberVisible: true,
            sheetInitialDetentIndex: 0,
          }}
        />
      </NativeStack.Navigator>
      <ImageZoom />
    </NavigationContainer>
  );
}

function RootServices({ manager }: { manager: NostrManagerLike | null }) {
  const setAuth = useAuthStore(state => state.setAuth);
  const authPubkey = useAuthStore(state => state.pubkey);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const pendingMintQuotes = useWalletStore(state => state.pendingMintQuotes);
  const loadPendingMintQuotes = useWalletStore(state => state.loadPendingMintQuotes);
  const deletePendingMintQuote = useWalletStore(state => state.deletePendingMintQuote);
  const initializeProofWallet = useWalletStore(state => state.initializeProofWallet);
  const addProofs = useWalletStore(state => state.addProofs);
  const getUnspentProofsForMint = useWalletStore(state => state.getUnspentProofsForMint);
  const verifyAndCleanProofs = useWalletStore(state => state.verifyAndCleanProofs);
  const resetWalletSession = useWalletStore(state => state.resetWalletSession);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const readRelays = useNostrStore(state => state.readRelays);
  const resetNostrState = useNostrStore(state => state.resetNostrState);
  const activeMintQuoteMonitorsRef = useRef(new Map<string, () => void>());
  const activeNostrPubkeyRef = useRef<string | null | undefined>(undefined);

  useRootNostrSubscriptions(Boolean(manager));
  useNotificationSubscription(Boolean(manager));
  useRelayTracking(Boolean(manager));
  useFollowListPackSync();

  useEffect(() => {
    if (!manager) return;

    const handleAuth = (event: Event) => {
      const detail = (
        event as Event & {
          detail?: {
            pubkey?: string | null;
            hasSigner?: boolean;
            secretKey?: unknown;
          };
        }
      ).detail;
      const pubkey = detail?.pubkey ?? null;
      const secretKey =
        typeof detail?.secretKey === 'string' &&
        /^[0-9a-f]{64}$/i.test(detail.secretKey)
          ? detail.secretKey
          : null;
      const currentPubkey = useAuthStore.getState().pubkey;
      if (pubkey !== currentPubkey) {
        resetNostrState();
        resetWalletSession();
      }
      setAuth({
        pubkey,
        npub: pubkey ? nip19.npubEncode(pubkey) : null,
        hasSigner: detail?.hasSigner ?? false,
        authResolved: true,
        ...(secretKey
          ? {
              privkey: secretKey,
              nsec: nip19.nsecEncode(hexToBytes(secretKey)),
            }
          : {}),
      });
    };

    manager.addEventListener('auth', handleAuth);
    return () => manager.removeEventListener('auth', handleAuth);
  }, [manager, resetNostrState, resetWalletSession, setAuth]);

  useEffect(() => {
    const previousPubkey = activeNostrPubkeyRef.current;
    if (previousPubkey === authPubkey) return;
    activeNostrPubkeyRef.current = authPubkey;
    if (authPubkey) {
      resetNostrState();
      resetWalletSession();
    }
    if (previousPubkey !== undefined) {
      return scheduleNostrCleanup(manager, 0);
    }
  }, [authPubkey, manager, resetNostrState, resetWalletSession]);

  useEffect(() => {
    if (!authPubkey) return;
    loadPendingMintQuotes(authPubkey).catch(error => {
      console.error('[minting] failed to load pending mint quotes', error);
    });
  }, [authPubkey, loadPendingMintQuotes]);

  useEffect(() => {
    if (!authPubkey) return;
    const pendingMintUrls = pendingMintQuotes.map(quote => quote.mintUrl);
    initializeProofWallet(authPubkey, [...walletMintUrls, ...pendingMintUrls])
      .then(() => resumePendingTransactions())
      .catch(error => {
        console.error('[minting] failed to initialize app-level proof wallet', error);
      });
  }, [authPubkey, initializeProofWallet, pendingMintQuotes, walletMintUrls]);

  useEffect(() => {
    const activeMonitors = activeMintQuoteMonitorsRef.current;
    return () => {
      for (const cancel of activeMonitors.values()) {
        cancel();
      }
      activeMonitors.clear();
    };
  }, [authPubkey]);

  useEffect(() => {
    if (!authPubkey) return;
    const activeMonitors = activeMintQuoteMonitorsRef.current;
    const pendingIds = new Set(pendingMintQuotes.map(quote => quote.quote));

    for (const [quoteId, cancel] of Array.from(activeMonitors.entries())) {
      if (!pendingIds.has(quoteId)) {
        cancel();
        activeMonitors.delete(quoteId);
      }
    }

    for (const quote of pendingMintQuotes) {
      if (activeMonitors.has(quote.quote)) continue;

      let cancelled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cancel = () => {
        cancelled = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
      };
      activeMonitors.set(quote.quote, cancel);

      const monitor = async () => {
        if (cancelled) return;
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (quote.expiry && quote.expiry <= nowSeconds) {
          console.log('[minting] pending mint quote expired', {
            mint: quote.mintUrl,
            quote: quote.quote,
          });
          activeMonitors.delete(quote.quote);
          await deletePendingMintQuote(authPubkey, quote.quote);
          return;
        }

        try {
          const wallet = new CashuWallet(quote.mintUrl);
          await retryMintNetworkCall(() => wallet.loadMint());
          const latest = await retryMintNetworkCall(() =>
            wallet.checkMintQuoteBolt11(quote),
          );
          console.log('[minting] pending mint quote status', {
            mint: quote.mintUrl,
            quote: quote.quote,
            state: latest.state,
          });

          if (latest.state === MintQuoteState.PAID) {
            console.log('[minting] pending mint quote paid, minting proofs', {
              mint: quote.mintUrl,
              quote: quote.quote,
              amount: quote.amount,
            });
            const proofs = await retryMintNetworkCall(
              () => wallet.mintProofsBolt11(Number(quote.amount), quote),
              5,
            );
            await addProofs(quote.mintUrl, proofs);
            console.log('[minting] pending mint quote minted proofs', {
              mint: quote.mintUrl,
              quote: quote.quote,
              proofs: proofs.length,
            });
            publishProofsBackup(
              quote.mintUrl,
              getUnspentProofsForMint(quote.mintUrl),
              uniqueWalletRelays(readRelays, walletReadRelays),
            );
            await verifyAndCleanProofs();
            activeMonitors.delete(quote.quote);
            await deletePendingMintQuote(authPubkey, quote.quote);
            return;
          }

          if (latest.state === MintQuoteState.ISSUED) {
            activeMonitors.delete(quote.quote);
            await deletePendingMintQuote(authPubkey, quote.quote);
            return;
          }
        } catch (error) {
          console.error('[minting] pending mint quote monitor failed', {
            mint: quote.mintUrl,
            quote: quote.quote,
            error,
          });
        }

        if (!cancelled) {
          timeout = setTimeout(monitor, MINT_QUOTE_MONITOR_INTERVAL_MS);
        }
      };

      timeout = setTimeout(monitor, 0);
    }
  }, [
    addProofs,
    authPubkey,
    deletePendingMintQuote,
    getUnspentProofsForMint,
    pendingMintQuotes,
    readRelays,
    verifyAndCleanProofs,
    walletReadRelays,
  ]);

  return null;
}

function MainTabs({
  manager,
  nostrEnabled,
}: {
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
}) {
  const theme = useAppTheme();
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  useEffect(() => {
    configureNativeTabBarCompactAppearance();
  }, []);
  const [activatedRoutes, setActivatedRoutes] = useState<
    Record<RouteId, boolean>
  >({
    home: false,
    explore: true,
    chat: false,
  });

  const activateRoute = useCallback((routeId: RouteId) => {
    setActivatedRoutes(current => {
      if (current[routeId]) return current;
      return {...current, [routeId]: true};
    });
  }, []);

  const tabContext = useMemo(
    () => ({
      activatedRoutes,
      activateRoute,
      manager,
      nostrEnabled,
      themeVars,
      backgroundColor: theme.colors.base100,
    }),
    [
      activateRoute,
      activatedRoutes,
      manager,
      nostrEnabled,
      theme.colors.base100,
      themeVars,
    ],
  );

  return (
    <MainTabContext.Provider value={tabContext}>
      {Platform.OS === 'android' ? (
        <AndroidBottomTabs.Navigator
          initialRouteName="ExploreTab"
          backBehavior="initialRoute"
          screenOptions={({route}) => ({
            headerShown: false,
            lazy: false,
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.primaryContent,
            tabBarStyle: {
              backgroundColor: theme.colors.base100,
              borderTopColor: `${theme.colors.primaryContent}18`,
              height: 68,
              paddingBottom: 7,
              paddingTop: 7,
            },
            tabBarLabelStyle: {fontSize: 11, fontWeight: '500'},
            tabBarIcon: ({color, size}) => {
              const Icon =
                route.name === 'HomeTab'
                  ? House
                  : route.name === 'ChatTab'
                    ? MessageCircle
                    : Layers3;
              return <Icon color={color} size={Math.min(size, 22)} strokeWidth={2} />;
            },
          }) satisfies BottomTabNavigationOptions}
        >
          <AndroidBottomTabs.Screen name="HomeTab" component={HomeTabScreen} options={{title: 'Home'}} />
          <AndroidBottomTabs.Screen name="ExploreTab" component={ExploreTabScreen} options={{title: 'Feed'}} />
          <AndroidBottomTabs.Screen name="ChatTab" component={ChatTabScreen} options={{title: 'Chats'}} />
        </AndroidBottomTabs.Navigator>
      ) : (
      <NativeBottomTabs.Navigator
        initialRouteName="ExploreTab"
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
          lazy: false,
          overrideScrollViewContentInsetAdjustmentBehavior: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.primaryContent,
          tabBarActiveIndicatorColor: `${theme.colors.primary}22`,
          tabBarControllerMode: 'tabBar',
          tabBarMinimizeBehavior: 'onScrollDown',
          tabBarStyle: {
            backgroundColor: theme.colors.base100,
            shadowColor: `${theme.colors.primary}33`,
          },
        }}
      >
        <NativeBottomTabs.Screen
          name="HomeTab"
          component={HomeTabScreen}
          options={{
            title: 'Home',
            tabBarLabel: 'Home',
            tabBarIcon: tabIcon('home'),
          }}
        />
        <NativeBottomTabs.Screen
          name="ExploreTab"
          component={ExploreTabScreen}
          options={{
            title: 'Feed',
            tabBarLabel: 'Feed',
            tabBarIcon: tabIcon('explore'),
          }}
        />
        <NativeBottomTabs.Screen
          name="ChatTab"
          component={ChatTabScreen}
          options={{
            title: 'Chats',
            tabBarLabel: 'Chats',
            tabBarIcon: tabIcon('chat'),
          }}
        />
      </NativeBottomTabs.Navigator>
      )}
    </MainTabContext.Provider>
  );
}

type MainTabContextValue = {
  activatedRoutes: Record<RouteId, boolean>;
  activateRoute: (routeId: RouteId) => void;
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
  themeVars: ReturnType<typeof getAppThemeVars>;
  backgroundColor: string;
};

const MainTabContext = createContext<MainTabContextValue | null>(null);

function useMainTabContext(routeId: RouteId) {
  const context = useContext(MainTabContext);
  if (!context) {
    throw new Error('Main tab context is missing');
  }

  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    context.activateRoute(routeId);
    if (!supportsNativeTabBarMinimization) {
      setNativeTabBarVisible(true, false);
    }
    return scheduleNostrCleanup(context.manager);
  }, [context, isFocused, routeId]);

  return {
    ...context,
    isFocused,
    visible: context.activatedRoutes[routeId],
  };
}

function HomeTabScreen() {
  const {isFocused, nostrEnabled, visible} =
    useMainTabContext('home');
  const handleChromeVisibilityChange = useCallback(
    (nextVisible: boolean) => {
      if (isFocused && !supportsNativeTabBarMinimization) {
        setNativeTabBarVisible(nextVisible);
      }
    },
    [isFocused],
  );

  return (
    <HomeFeed
      enabled={nostrEnabled}
      visible={visible}
      onChromeVisibilityChange={handleChromeVisibilityChange}
    />
  );
}

function ExploreTabScreen() {
  const {isFocused, nostrEnabled, visible} =
    useMainTabContext('explore');
  const handleChromeVisibilityChange = useCallback(
    (nextVisible: boolean) => {
      if (isFocused && !supportsNativeTabBarMinimization) {
        setNativeTabBarVisible(nextVisible);
      }
    },
    [isFocused],
  );

  return (
    <ExploreFeed
      enabled={nostrEnabled}
      visible={visible}
      onChromeVisibilityChange={handleChromeVisibilityChange}
    />
  );
}

function ChatTabScreen() {
  const {isFocused, nostrEnabled, visible} =
    useMainTabContext('chat');
  const handleChromeVisibilityChange = useCallback(
    (nextVisible: boolean) => {
      if (isFocused && !supportsNativeTabBarMinimization) {
        setNativeTabBarVisible(nextVisible);
      }
    },
    [isFocused],
  );

  return (
    <ChatFeed
      enabled={nostrEnabled}
      visible={visible}
      onChromeVisibilityChange={handleChromeVisibilityChange}
    />
  );
}

function tabIcon(routeId: RouteId) {
  if (Platform.OS !== 'ios') return undefined;

  return {
      type: 'sfSymbol',
      name:
        routeId === 'home'
          ? 'house'
          : routeId === 'chat'
            ? 'message'
            : 'square.stack',
    } satisfies NativeBottomTabIcon;
}

function useAuthValue() {
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const nsec = useAuthStore(state => state.nsec);
  return useMemo(() => ({ pubkey, hasSigner, nsec }), [hasSigner, nsec, pubkey]);
}

function ProfileScreen({
  manager,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Profile'> & {
  manager: NostrManagerLike | null;
}) {
  const auth = useAuthValue();
  return <ProfileModal auth={auth} manager={manager} onClose={navigation.goBack} />;
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

function CmdKScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'CmdK'>) {
  return (
    <CmdKModal
      onClose={navigation.goBack}
      onSelectProfile={pubkey => navigation.navigate('PublicProfile', {pubkey})}
      onSelectHashtag={tag => navigation.navigate('Tags', {tags: [tag]})}
    />
  );
}

function NotificationsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Notifications'>) {
  const focused = useIsFocused();
  return <NotificationsSub visible={focused} onClose={navigation.goBack} />;
}

function PostScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Post'>) {
  return (
    <PostModal
      reply={route.params?.reply}
      quote={route.params?.quote}
      onClose={navigation.goBack}
    />
  );
}

function SendScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Send'>) {
  return <SendModal onClose={navigation.goBack} />;
}

function NewChatScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'NewChat'>) {
  return <NewChatModal onClose={navigation.goBack} />;
}

function ReceiveScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Receive'>) {
  return (
    <ReceiveModal
      onClose={navigation.goBack}
      onMinting={() => navigation.navigate('Minting')}
    />
  );
}

function MintingScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Minting'>) {
  return <MintingModal onClose={navigation.goBack} />;
}

function SendEcashScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'SendEcash'>) {
  return (
    <SendEcashModal
      pubkey={route.params.pubkey}
      noteId={route.params.noteId}
      targetKind={route.params.targetKind}
      targetAddress={route.params.targetAddress}
      onClose={navigation.goBack}
    />
  );
}

function ShareScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Share'>) {
  return (
    <ShareModal
      nevent={route.params.nevent}
      naddr={route.params.naddr}
      onClose={navigation.goBack}
    />
  );
}

function KeysScreen({ onClose }: { onClose: () => void }) {
  return <KeysModal onClose={onClose} />;
}

function ScanScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, 'Scan'>) {
  return <ScanModal initialMode={route.params?.mode} />;
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

function ThemeScreen() {
  return <ThemeModal />;
}

function MintsScreen({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  return <MintsModal manager={manager} onClose={onClose} />;
}

function RelayPreferencesScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'RelayPreferences'>) {
  return <RelayPreferencesModal onClose={navigation.goBack} />;
}

function WalletScreen({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  return <WalletModal manager={manager} onClose={onClose} />;
}

function RelayInfosScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'RelayInfos'>) {
  return (
    <RelayInfosModal
      subId={route.params.subId}
      relays={route.params.relays}
      statuses={route.params.statuses}
      mode={route.params.mode}
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

function CommunityScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Community'>) {
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
  }, [isFocused, route.params.relay]);

  return (
    <CommunitySub
      description={route.params.description}
      icon={route.params.icon}
      name={route.params.name}
      relationship={route.params.relationship}
      relay={route.params.relay}
      visible={isFocused && subVisible}
      onClose={navigation.goBack}
    />
  );
}

function CalendarEventScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'CalendarEvent'>) {
  return (
    <CalendarEventModal
      relay={route.params.relay}
      address={route.params.address}
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

function Kind30023ThreadScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Kind30023Thread'>) {
  const isFocused = useIsFocused();

  return (
    <Kind30023Sub
      naddr={route.params.naddr}
      visible={isFocused}
      onClose={navigation.goBack}
    />
  );
}

function LiveStreamScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, 'LiveStream'>) {
  const isFocused = useIsFocused();

  return (
    <LiveStreamSub
      nevent={route.params.nevent}
      visible={isFocused}
    />
  );
}

function Kind1111CommentsScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Kind1111Comments'>) {
  return (
    <Kind1111CommentsModal
      nevent={route.params.nevent}
      onClose={navigation.goBack}
    />
  );
}

function TagsScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Tags'>) {
  const isFocused = useIsFocused();
  return (
    <TagsSub
      tags={route.params.tags}
      visible={isFocused}
      onClose={navigation.goBack}
    />
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
});

export default App;
