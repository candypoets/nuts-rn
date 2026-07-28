import '../global.css';
import '../textEncodingPolyfill';
import 'react-native-get-random-values';

import React, {useEffect, useMemo, useRef, useState} from 'react';
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
import { enableFreeze, enableScreens } from 'react-native-screens';
import {
  ReanimatedLogLevel,
  configureReanimatedLogger,
} from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NostrManagerLike } from '@candypoets/nipworker';
import { MintQuoteState, Wallet as CashuWallet } from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { Stack, usePathname } from 'expo-router';

import { useFollowListPackSync } from '../src/hooks/useFollowListPackSync';
import { useNotificationSubscription } from '../src/hooks/useNotificationSubscription';
import { useRelayTracking } from '../src/hooks/useRelayTracking';
import { useRootNostrSubscriptions } from '../src/hooks/useRootNostrSubscriptions';
import { useAuthStore, useNostrStore, useWalletStore } from '../src/stores';
import { ImageZoom } from '../src/components/ImageZoom';
import { SendStatuses } from '../src/components/SendStatuses';
import { publishProofsBackup } from '../src/nostr/proofBackup';
import { uniqueWalletRelays } from '../src/hooks/useWalletSubscription';
import { resumePendingTransactions } from '../src/model/cashu/txRecovery';
import { getAppThemeVars, isAppThemeDark, useAppTheme } from '../src/theme';
import { startNativeDebugLogRelay } from '../src/debug/nativeDebugBridge';
import { NativeParityHarness } from '../src/debug/NativeParityHarness';
import { getSharedNostrManager } from '../src/nostr/manager';

enableScreens(true);
enableFreeze(true);

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

const MINT_QUOTE_MONITOR_INTERVAL_MS = 2500;
const MINT_QUOTE_RETRY_DELAY_MS = 1200;

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

export default function RootLayout() {
  const theme = useAppTheme();
  const isDarkMode = isAppThemeDark(theme);
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  const [manager] = useState<NostrManagerLike | null>(() =>
    getSharedNostrManager(),
  );
  const keyboardResizeStyle = useKeyboardResizeStyle();
  const contentStyle = useMemo(
    () => [styles.root, { backgroundColor: theme.colors.base100 }],
    [theme],
  );

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
                <>
                  <Stack
                    screenOptions={{
                      contentStyle,
                      freezeOnBlur: true,
                      fullScreenGestureEnabled: true,
                      animationMatchesGesture: true,
                      headerShown: false,
                    }}
                  >
                    <Stack.Screen
                      name="(tabs)"
                      options={{ freezeOnBlur: false }}
                    />
                  </Stack>
                  <ImageZoom />
                </>
              )}
              <SendStatuses />
            </Animated.View>
            <PathnameCleanup manager={manager} />
          </View>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Replaces the old NavigationContainer onStateChange -> scheduleCleanup hook:
 * schedules a nostr cleanup on every route change.
 */
function PathnameCleanup({ manager }: { manager: NostrManagerLike | null }) {
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f7f8',
  },
});
