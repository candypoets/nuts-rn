import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from 'expo-router/build/react-navigation/native-stack';
import {Wallet as CashuWallet} from '@cashu/cashu-ts';
import {ArrowLeft, Check, ClipboardCopy, RefreshCw} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import {useReducedMotion} from 'react-native-reanimated';

import {AppButton} from '../components/AppButton';
import {MintCardPicker} from '../components/MintCardPicker';
import {
  useAuthStore,
  useMintingStore,
  useWalletStore,
  type MintingStatus,
} from '../stores';
import {useAppTheme} from '../theme';

type MintingModalProps = {
  onClose: () => void;
};

type MintingStackParamList = {
  MintingAmount: undefined;
  MintingInvoice: undefined;
};

// expo-router 57 hard-errors when app code imports @react-navigation/*, but
// its own vendored fork is reachable via deep imports inside the expo-router
// package, which passes the Metro check. This recreates the original
// pre-migration embedded native stack (slide_from_right, swipe-back).
const MintingStack = createNativeStackNavigator<MintingStackParamList>();

const NETWORK_RETRY_DELAY_MS = 1200;

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function statusText(status: MintingStatus) {
  switch (status) {
    case 'creating':
      return 'Creating invoice...';
    case 'waiting':
      return 'Waiting for payment...';
    case 'minting':
      return 'Minting proofs...';
    case 'paid':
      return 'Payment received';
    case 'expired':
      return 'Invoice expired';
    case 'error':
      return 'Could not complete topup';
    default:
      return 'Ready';
  }
}

function formatExpiresIn(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function isRetryableMintNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancelled|canceled|network request failed|fetch failed/i.test(
    message,
  );
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
        setTimeout(resolve, NETWORK_RETRY_DELAY_MS * (attempt + 1)),
      );
    }
  }
  throw lastError;
}

/**
 * Minting (topup) wizard: one screen hosting an embedded native stack
 * (amount -> invoice), like the original pre-migration modal. No
 * NavigationContainer — the inner stack attaches to expo-router's root
 * navigation context (same fork). Inter-step state (amount, quote, status)
 * lives in useMintingStore; the quote object is not serializable, so it is
 * shared through the store rather than params.
 */
export function MintingModal({onClose: _onClose}: MintingModalProps) {
  const resetMinting = useMintingStore(state => state.resetMinting);
  const reducedMotion = useReducedMotion();

  // Fresh state every time the flow is opened.
  useEffect(() => {
    resetMinting();
  }, [resetMinting]);

  return (
    <MintingStack.Navigator
      screenOptions={{
        animation: reducedMotion ? 'fade' : 'slide_from_right',
        headerShown: false,
      }}
    >
      <MintingStack.Screen
        component={MintingAmountScreen}
        name="MintingAmount"
      />
      <MintingStack.Screen
        component={MintingInvoiceScreen}
        name="MintingInvoice"
      />
    </MintingStack.Navigator>
  );
}

/** Amount step: pick a mint and amount, create the mint quote. */
function MintingAmountScreen({
  navigation,
}: NativeStackScreenProps<MintingStackParamList, 'MintingAmount'>) {
  const authPubkey = useAuthStore(state => state.pubkey);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const storedActiveMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const savePendingMintQuote = useWalletStore(
    state => state.savePendingMintQuote,
  );
  const amount = useMintingStore(state => state.amount);
  const status = useMintingStore(state => state.status);
  const setAmount = useMintingStore(state => state.setAmount);
  const setQuote = useMintingStore(state => state.setQuote);
  const setStatus = useMintingStore(state => state.setStatus);
  const setError = useMintingStore(state => state.setError);

  const mints = useMemo(
    () =>
      Array.from(new Set(walletMintUrls.map(normalizeMintUrl))).filter(Boolean),
    [walletMintUrls],
  );
  const selectedMint =
    storedActiveMintUrl && mints.includes(storedActiveMintUrl)
      ? storedActiveMintUrl
      : mints[0] ?? null;
  const numericAmount = Number(amount);
  const canCreate =
    !!selectedMint &&
    Number.isInteger(numericAmount) &&
    numericAmount > 0 &&
    status !== 'creating' &&
    status !== 'waiting' &&
    status !== 'minting';

  const createInvoice = useCallback(async () => {
    if (!selectedMint || !canCreate) return;

    setError(null);
    setStatus('creating');

    try {
      const mint = normalizeMintUrl(selectedMint);
      setActiveMintUrl(mint);
      const wallet = new CashuWallet(mint);
      await retryMintNetworkCall(() => wallet.loadMint());
      const nextQuote = await retryMintNetworkCall(() =>
        wallet.createMintQuoteBolt11(numericAmount),
      );
      if (authPubkey) {
        await savePendingMintQuote(authPubkey, mint, nextQuote);
      }
      setQuote(nextQuote);
      setStatus('waiting');
      navigation.navigate('MintingInvoice');
    } catch (cause) {
      console.error('[minting] failed to create or mint invoice', cause);
      setError(
        cause instanceof Error ? cause.message : 'Unknown minting error',
      );
      setStatus('error');
    }
  }, [
    authPubkey,
    canCreate,
    navigation,
    numericAmount,
    savePendingMintQuote,
    selectedMint,
    setActiveMintUrl,
    setError,
    setQuote,
    setStatus,
  ]);

  const selectMint = useCallback(
    (mint: string | null) => {
      if (status === 'creating' || status === 'waiting' || status === 'minting')
        return;
      setActiveMintUrl(mint ? normalizeMintUrl(mint) : null);
    },
    [setActiveMintUrl, status],
  );

  return (
    <MintingAmountStep
      amount={amount}
      balanceByMint={balanceByMint}
      canCreate={canCreate}
      mints={mints}
      selectedMint={selectedMint}
      status={status}
      onAmountChange={setAmount}
      onCreateInvoice={createInvoice}
      onSelectMint={selectMint}
    />
  );
}

/** Invoice step: show the quote QR, watch for payment/expiry. */
function MintingInvoiceScreen({
  navigation,
}: NativeStackScreenProps<MintingStackParamList, 'MintingInvoice'>) {
  const authPubkey = useAuthStore(state => state.pubkey);
  const pendingMintQuotes = useWalletStore(state => state.pendingMintQuotes);
  const deletePendingMintQuote = useWalletStore(
    state => state.deletePendingMintQuote,
  );
  const amount = useMintingStore(state => state.amount);
  const quote = useMintingStore(state => state.quote);
  const status = useMintingStore(state => state.status);
  const error = useMintingStore(state => state.error);
  const setStatus = useMintingStore(state => state.setStatus);
  const setError = useMintingStore(state => state.setError);
  const [copied, setCopied] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000),
  );

  // Back is blocked while a quote is being created or proofs are minting.
  const backBlocked = status === 'creating' || status === 'minting';
  const backBlockedRef = useRef(backBlocked);
  useEffect(() => {
    backBlockedRef.current = backBlocked;
  }, [backBlocked]);

  useEffect(() => {
    navigation.setOptions({gestureEnabled: !backBlocked});
  }, [backBlocked, navigation]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        if (!backBlockedRef.current) return;
        event.preventDefault();
      }),
    [navigation],
  );

  const invoice = quote?.request ?? '';
  const expiresInSeconds =
    quote?.expiry && status !== 'paid'
      ? Math.max(0, quote.expiry - nowSeconds)
      : null;

  useEffect(() => {
    if (!quote || status !== 'waiting') return;
    const stillPending = pendingMintQuotes.some(
      pendingQuote => pendingQuote.quote === quote.quote,
    );
    if (!stillPending) {
      setStatus('paid');
    }
  }, [pendingMintQuotes, quote, status, setStatus]);

  useEffect(() => {
    if (!quote?.expiry || status === 'paid' || status === 'expired') return;

    const interval = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [quote?.expiry, status]);

  useEffect(() => {
    if (
      expiresInSeconds !== null &&
      expiresInSeconds <= 0 &&
      (status === 'waiting' || status === 'creating')
    ) {
      if (authPubkey && quote?.quote) {
        deletePendingMintQuote(authPubkey, quote.quote).catch(error => {
          console.error('[minting] failed to delete expired quote', error);
        });
      }
      setStatus('expired');
      setError('This invoice expired. Go back and create a new invoice.');
    }
  }, [
    authPubkey,
    deletePendingMintQuote,
    expiresInSeconds,
    quote,
    status,
    setError,
    setStatus,
  ]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    await Clipboard.setStringAsync(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [invoice]);

  const onBack = useCallback(() => {
    if (backBlockedRef.current) return;
    navigation.goBack();
  }, [navigation]);

  return (
    <MintingInvoiceStep
      amount={amount}
      copied={copied}
      error={error}
      expiresInSeconds={expiresInSeconds}
      invoice={invoice}
      status={status}
      onBack={onBack}
      onCopyInvoice={copyInvoice}
    />
  );
}

function MintingAmountStep({
  amount,
  balanceByMint,
  canCreate,
  mints,
  selectedMint,
  status,
  onAmountChange,
  onCreateInvoice,
  onSelectMint,
}: {
  amount: string;
  balanceByMint: Record<string, number>;
  canCreate: boolean;
  mints: string[];
  selectedMint: string | null;
  status: MintingStatus;
  onAmountChange: (value: string) => void;
  onCreateInvoice: () => void;
  onSelectMint: (mint: string | null) => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.modalBody, {backgroundColor: theme.colors.base100}]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="pt-1 text-center text-2xl font-bold text-base-content">
          Topup
        </Text>

        <MintCardPicker
          mintUrls={mints}
          activeMintUrl={selectedMint}
          balanceByMint={balanceByMint}
          onSelectMint={onSelectMint}
        />

        <View className="mt-10 items-center">
          <View className="flex-row items-center">
            <Text className="mr-2 -translate-y-2 text-4xl font-black text-base-content">
              丰
            </Text>
            <TextInput
              className="h-24 min-w-40 max-w-72 p-0 text-center text-7xl font-bold text-base-content"
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#cbd5e1"
              textAlignVertical="center"
              value={amount}
              editable={status !== 'creating'}
              onChangeText={value =>
                onAmountChange(value.replace(/[^0-9]/g, ''))
              }
            />
          </View>
        </View>

        <AppButton
          className="mt-10"
          disabled={!canCreate}
          title={
            status === 'creating' ? 'Creating...' : 'Create Lightning Invoice'
          }
          onPress={onCreateInvoice}
        />
      </ScrollView>
    </View>
  );
}

function MintingInvoiceStep({
  amount,
  copied,
  error,
  expiresInSeconds,
  invoice,
  status,
  onBack,
  onCopyInvoice,
}: {
  amount: string;
  copied: boolean;
  error: string | null;
  expiresInSeconds: number | null;
  invoice: string;
  status: MintingStatus;
  onBack: () => void;
  onCopyInvoice: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.modalBody, {backgroundColor: theme.colors.base100}]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          className="mt-4 h-10 flex-row items-center self-start rounded-full px-1"
          onPress={onBack}
        >
          <ArrowLeft
            size={20}
            color={theme.colors.primaryContent}
            strokeWidth={2.4}
          />
          <Text className="ml-1 text-sm font-bold text-primary-content">
            Back
          </Text>
        </Pressable>

        <View className="mt-4 items-center rounded-lg bg-base-200 py-3">
          <Text className="text-3xl font-bold text-base-content">
            {amount || 0} <Text className="font-black">sats</Text>
          </Text>
        </View>

        <View className="mt-8 items-center">
          {status === 'paid' ? (
            <View className="h-[275px] w-[275px] items-center justify-center rounded-xl border-4 border-primary bg-base-300 shadow-sm">
              <Check size={150} color="#22c55e" strokeWidth={1.8} />
            </View>
          ) : invoice ? (
            <Pressable
              className="rounded-xl bg-base-300 p-4 shadow-sm"
              onPress={onCopyInvoice}
            >
              <QRCode value={`lightning:${invoice}`} size={275} />
            </Pressable>
          ) : (
            <View className="h-[275px] w-[275px] items-center justify-center rounded-xl bg-base-200 shadow-sm">
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          )}

          <View className="mt-3 flex-row items-center">
            {status === 'paid' ? (
              <Check size={18} color={theme.colors.primary} strokeWidth={2.4} />
            ) : status === 'waiting' || status === 'minting' ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <RefreshCw size={17} color="#64748b" strokeWidth={2.2} />
            )}
            <Text className="ml-2 text-sm font-semibold text-primary-content">
              {status === 'paid'
                ? 'Payment received!'
                : status === 'waiting' && expiresInSeconds !== null
                ? `Expires in ${formatExpiresIn(expiresInSeconds)}`
                : statusText(status)}
            </Text>
          </View>
        </View>

        <Pressable
          className="mt-6 min-h-12 w-full flex-row items-center rounded-lg border border-amber-400 bg-base-300 px-3"
          disabled={!invoice}
          onPress={onCopyInvoice}
        >
          <Text
            className="min-w-0 flex-1 text-xs text-primary-content"
            numberOfLines={1}
          >
            {invoice || 'Generating...'}
          </Text>
          <ClipboardCopy
            size={18}
            color={theme.colors.primaryContent}
            strokeWidth={2.2}
          />
        </Pressable>
        <Text className="mt-2 text-center text-xs font-semibold text-primary-content">
          {copied ? 'Copied' : 'Tap QR or invoice to copy'}
        </Text>

        {error ? (
          <View className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <Text className="text-sm font-semibold text-red-800">{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
  content: {
    paddingBottom: 34,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
});
