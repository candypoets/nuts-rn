import '../../global.css';
import '../../textEncodingPolyfill';
import 'react-native-get-random-values';

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Linking, Platform, StatusBar, StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {
  KeyboardAvoidingView,
  KeyboardProvider,
} from 'react-native-keyboard-controller';
import {enableFreeze, enableScreens} from 'react-native-screens';
import {
  ReanimatedLogLevel,
  configureReanimatedLogger,
  useReducedMotion,
} from 'react-native-reanimated';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import type {NostrManagerLike} from '@candypoets/nipworker';
import {MintQuoteState, Wallet as CashuWallet} from '@cashu/cashu-ts';
import {nip19} from 'nostr-tools';
import {Stack, usePathname, useRouter} from 'expo-router';

import {useFollowListPackSync} from '../hooks/useFollowListPackSync';
import {useNotificationSubscription} from '../hooks/useNotificationSubscription';
import {usePushNotifications} from '../hooks/usePushNotifications';
import {useRelayTracking} from '../hooks/useRelayTracking';
import {useRootNostrSubscriptions} from '../hooks/useRootNostrSubscriptions';
import {useWalletProofSubscription} from '../hooks/useWalletProofSubscription';
import {
  useAuthStore,
  useFeedBuilderStore,
  useNostrStore,
  useWalletStore,
} from '../stores';
import {ImageZoom} from '../components/ImageZoom';
import {SendStatuses} from '../components/SendStatuses';
import {publishProofsBackup} from '../nostr/proofBackup';
import {uniqueWalletRelays} from '../hooks/useWalletSubscription';
import {resumePendingTransactions} from '../model/cashu/txRecovery';
import {getAppThemeVars, isAppThemeDark, useAppTheme} from '../theme';
import {startNativeDebugLogRelay} from '../debug/nativeDebugBridge';
import {NativeParityHarness} from '../debug/NativeParityHarness';
import {getSharedNostrManager} from '../nostr/manager';
import {
  resolveInviteDeepLink,
  resolveNostrDeepLink,
} from '../navigation/linking';
import {
  singularByParams,
  singularNostrRoute,
} from '../navigation/singularRoutes';
import {configureImageCache, runMediaCacheMaintenance} from '../media/cache';

enableScreens(true);
enableFreeze(true);
configureImageCache();

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

const MINT_QUOTE_MONITOR_INTERVAL_MS = 2500;
const MINT_QUOTE_RETRY_DELAY_MS = 1200;

const singularProfile = singularByParams('pubkey');
const singularCommunity = singularByParams('relay');
const singularStore = singularByParams('relay');
const singularCalendarEvent = singularByParams('relay', 'address');
const singularChat = singularByParams('peerPubkey');
const singularTags = singularByParams('tags');

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

function isRetryableMintNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancelled|canceled|network request failed|fetch failed/i.test(
    message,
  );
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

export default function RootLayout() {
  const theme = useAppTheme();
  const isDarkMode = isAppThemeDark(theme);
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  const [manager] = useState<NostrManagerLike | null>(() =>
    getSharedNostrManager(),
  );
  const reducedMotion = useReducedMotion();
  const stackAnimation = reducedMotion
    ? ('fade' as const)
    : ('default' as const);
  const contentStyle = useMemo(
    () => [styles.root, {backgroundColor: theme.colors.base100}],
    [theme],
  );

  useEffect(() => {
    runMediaCacheMaintenance().catch(error => {
      console.warn('[media-cache] startup maintenance failed', error);
    });
  }, []);

  useEffect(() => {
    return startNativeDebugLogRelay(event => {
      if (event.event === 'summary' && event.logs?.length) {
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
      style={[styles.root, {backgroundColor: theme.colors.base100}]}
    >
      <KeyboardProvider>
        <SafeAreaProvider>
          <View
            style={[
              styles.root,
              themeVars,
              {backgroundColor: theme.colors.base100},
            ]}
          >
            <RootServices manager={manager} />
            <KeyboardAvoidingView
              behavior={
                Platform.OS === 'ios' ? 'translate-with-padding' : undefined
              }
              enabled={Platform.OS === 'ios'}
              style={[styles.root, {backgroundColor: theme.colors.base100}]}
            >
              <StatusBar
                translucent
                backgroundColor="transparent"
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
              />
              {showNativeParityHarness ? (
                <NativeParityHarness />
              ) : (
                <>
                  <Stack
                    screenOptions={{
                      animation: stackAnimation,
                      contentStyle,
                      freezeOnBlur: true,
                      fullScreenGestureEnabled: true,
                      // Keep push-screen dismissal on iOS's native interactive
                      // pop path so the screen underneath can resume scrolling
                      // immediately after a full-screen swipe.
                      animationMatchesGesture: false,
                      headerShown: false,
                    }}
                  >
                    <Stack.Screen
                      name="(tabs)"
                      options={{freezeOnBlur: false}}
                    />
                    {/* presentation/animation are read at push time, so they
                        must be declared here — in-route <Stack.Screen options>
                        lands post-push via setOptions and is ignored. */}
                    {/* Push screens */}
                    <Stack.Screen
                      name="PublicProfile"
                      dangerouslySingular={singularProfile}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="Community"
                      dangerouslySingular={singularCommunity}
                      options={{
                        animation: stackAnimation,
                        fullScreenGestureEnabled: false,
                      }}
                    />
                    <Stack.Screen
                      name="Store"
                      dangerouslySingular={singularStore}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="CalendarEvent"
                      dangerouslySingular={singularCalendarEvent}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="ChatThread"
                      dangerouslySingular={singularChat}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="Kind1Thread"
                      dangerouslySingular={singularNostrRoute}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="Kind30023Thread"
                      dangerouslySingular={singularNostrRoute}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="Tags"
                      dangerouslySingular={singularTags}
                      options={{animation: stackAnimation}}
                    />
                    <Stack.Screen
                      name="Notifications"
                      dangerouslySingular
                      options={{animation: stackAnimation}}
                    />
                    {/* Modal screens */}
                    <Stack.Screen
                      name="LiveStream"
                      options={{presentation: 'modal', gestureEnabled: true}}
                    />
                    <Stack.Screen
                      name="Mints"
                      options={{
                        presentation: 'modal',
                        headerShown: true,
                        title: 'Mints',
                      }}
                    />
                    <Stack.Screen
                      name="Profile"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Login"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Keys"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Theme"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="RelayPreferences"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Wallet"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="FeedBuilder"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Receive"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Minting"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Send"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="NewChat"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="SendEcash"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Scan"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Award"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Passes"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Tapcash"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="Lightning"
                      options={{presentation: 'modal'}}
                    />
                    <Stack.Screen
                      name="ProfileStub"
                      options={{presentation: 'modal'}}
                    />
                    {/* Form sheets */}
                    <Stack.Screen
                      name="Kind1111Comments"
                      options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.66, 0.92],
                        sheetExpandsWhenScrolledToEdge: false,
                        sheetGrabberVisible: true,
                        sheetInitialDetentIndex: 0,
                      }}
                    />
                    <Stack.Screen
                      name="Share"
                      options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.6],
                        sheetCornerRadius: 18,
                        sheetGrabberVisible: false,
                      }}
                    />
                    <Stack.Screen
                      name="Logout"
                      options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: 'fitToContents',
                      }}
                    />
                    <Stack.Screen
                      name="Redeem"
                      options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.92],
                        sheetCornerRadius: 18,
                        sheetGrabberVisible: false,
                      }}
                    />
                    <Stack.Screen
                      name="RelayInfos"
                      options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.66],
                        sheetGrabberVisible: true,
                        sheetInitialDetentIndex: 0,
                      }}
                    />
                    {/* Full-screen modals */}
                    <Stack.Screen
                      name="Post"
                      options={{
                        presentation: 'fullScreenModal',
                        gestureEnabled: false,
                      }}
                    />
                    <Stack.Screen
                      name="CmdK"
                      options={{presentation: 'fullScreenModal'}}
                    />
                  </Stack>
                  <ImageZoom />
                </>
              )}
              <SendStatuses />
            </KeyboardAvoidingView>
            <PathnameCleanup manager={manager} />
            <NostrDeepLinkHandler />
          </View>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function NostrDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const openUrl = (url: string | null) => {
      if (!url) return;
      const invite = resolveInviteDeepLink(url);
      if (invite) {
        router.push({
          pathname: '/Redeem',
          params: invite.params,
        });
        return;
      }
      const route = resolveNostrDeepLink(url);
      if (!route) return;

      switch (route.name) {
        case 'PublicProfile':
          router.push({
            pathname: '/PublicProfile',
            params: route.params,
          });
          break;
        case 'Kind1Thread':
          router.push({
            pathname: '/Kind1Thread',
            params: route.params,
          });
          break;
        case 'Kind30023Thread':
          router.push({
            pathname: '/Kind30023Thread',
            params: route.params,
          });
          break;
      }
    };

    Linking.getInitialURL()
      .then(openUrl)
      .catch(error => {
        console.warn('[deep-link] failed to read initial URL', error);
      });
    const subscription = Linking.addEventListener('url', event =>
      openUrl(event.url),
    );
    return () => subscription.remove();
  }, [router]);

  return null;
}

/**
 * Replaces the old NavigationContainer onStateChange -> scheduleCleanup hook:
 * schedules a nostr cleanup on every route change.
 */
function PathnameCleanup({manager}: {manager: NostrManagerLike | null}) {
  const pathname = usePathname();
  const cleanupCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupCancelRef.current?.();
    cleanupCancelRef.current = scheduleNostrCleanup(manager);
  }, [pathname, manager]);

  useEffect(
    () => () => {
      cleanupCancelRef.current?.();
      cleanupCancelRef.current = null;
    },
    [],
  );

  return null;
}

function RootServices({manager}: {manager: NostrManagerLike | null}) {
  const setAuth = useAuthStore(state => state.setAuth);
  const authPubkey = useAuthStore(state => state.pubkey);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const proofsLoaded = useWalletStore(state => state.proofsLoaded);
  const pendingMintQuotes = useWalletStore(state => state.pendingMintQuotes);
  const loadPendingMintQuotes = useWalletStore(
    state => state.loadPendingMintQuotes,
  );
  const deletePendingMintQuote = useWalletStore(
    state => state.deletePendingMintQuote,
  );
  const addProofs = useWalletStore(state => state.addProofs);
  const getUnspentProofsForMint = useWalletStore(
    state => state.getUnspentProofsForMint,
  );
  const verifyAndCleanProofs = useWalletStore(
    state => state.verifyAndCleanProofs,
  );
  const resetWalletSession = useWalletStore(state => state.resetWalletSession);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const readRelays = useNostrStore(state => state.readRelays);
  const resetNostrState = useNostrStore(state => state.resetNostrState);
  const activeMintQuoteMonitorsRef = useRef(new Map<string, () => void>());
  const activeNostrPubkeyRef = useRef<string | null | undefined>(undefined);
  const pendingMintUrls = useMemo(
    () => pendingMintQuotes.map(quote => quote.mintUrl),
    [pendingMintQuotes],
  );

  useRootNostrSubscriptions(Boolean(manager));
  useNotificationSubscription(Boolean(manager));
  usePushNotifications(Boolean(manager));
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
            error?: string | null;
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
      if (pubkey && pubkey !== currentPubkey) {
        // Fresh login (any method): land the Explore feed on contacts.
        useFeedBuilderStore.getState().setExploreAudienceMode('contacts');
      }
      setAuth({
        pubkey,
        npub: pubkey ? nip19.npubEncode(pubkey) : null,
        hasSigner: detail?.hasSigner ?? false,
        authResolved: true,
        nip46AuthUrl: null,
        authError: detail?.error ?? null,
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
    if (!manager) return;

    const handleAuthUrl = (event: Event) => {
      const detail = (
        event as Event & {detail?: {url?: string; requestId?: string}}
      ).detail;
      if (typeof detail?.url !== 'string' || !detail.url) return;
      setAuth({nip46AuthUrl: detail.url});
    };

    manager.addEventListener('authUrl', handleAuthUrl);
    return () => manager.removeEventListener('authUrl', handleAuthUrl);
  }, [manager, setAuth]);

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

  useWalletProofSubscription({
    enabled: Boolean(manager),
    extraMintUrls: pendingMintUrls,
  });

  useEffect(() => {
    if (!authPubkey) return;
    loadPendingMintQuotes(authPubkey).catch(error => {
      console.error('[minting] failed to load pending mint quotes', error);
    });
  }, [authPubkey, loadPendingMintQuotes]);

  useEffect(() => {
    if (!authPubkey || !proofsLoaded) return;
    resumePendingTransactions().catch(error => {
      console.error('[minting] failed to resume pending transactions', error);
    });
  }, [authPubkey, pendingMintQuotes, proofsLoaded, walletMintUrls]);

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f7f8',
  },
});
