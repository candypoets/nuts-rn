import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {
  MintQuoteState,
  Wallet as CashuWallet,
  type MintQuoteResponse,
} from '@cashu/cashu-ts';
import {ArrowLeft, Check, ClipboardCopy, RefreshCw} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';

import {AppButton} from '../components/AppButton';
import {useAuthStore, useWalletStore} from '../stores';

type MintingModalProps = {
  onClose: () => void;
};

type MintingStatus =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'minting'
  | 'paid'
  | 'expired'
  | 'error';
type MintingStackParamList = {
  MintingAmount: undefined;
  MintingInvoice: undefined;
};
type MintInfo = {
  name: string;
  url: string;
  iconUrl?: string;
  state?: string;
};
type MintInfoResponse = {
  name?: string;
  icon_url?: string;
};

const POLL_INTERVAL_MS = 2500;
const POLL_LIMIT = 72;
const NETWORK_RETRY_DELAY_MS = 1200;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedImage = Animated.createAnimatedComponent(Image);
const MintingStack = createNativeStackNavigator<MintingStackParamList>();

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function displayMintName(mintUrl: string | null) {
  if (!mintUrl) return 'No mint selected';
  try {
    return new URL(mintUrl).hostname.replace(/^www\./, '');
  } catch {
    return mintUrl.replace(/^https?:\/\//, '');
  }
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
  return /cancelled|canceled|network request failed|fetch failed/i.test(message);
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

export function MintingModal({onClose}: MintingModalProps) {
  const authPubkey = useAuthStore(state => state.pubkey);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const storedActiveMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const pendingMintQuotes = useWalletStore(state => state.pendingMintQuotes);
  const savePendingMintQuote = useWalletStore(state => state.savePendingMintQuote);
  const deletePendingMintQuote = useWalletStore(state => state.deletePendingMintQuote);
  const [amount, setAmount] = useState('200');
  const [selectedMint, setSelectedMint] = useState(
    storedActiveMintUrl || walletMintUrls[0] || null,
  );
  const [quote, setQuote] = useState<MintQuoteResponse | null>(null);
  const [status, setStatus] = useState<MintingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const cancelledRef = useRef(false);

  const mints = useMemo(
    () => Array.from(new Set(walletMintUrls.map(normalizeMintUrl))).filter(Boolean),
    [walletMintUrls],
  );
  const invoice = quote?.request ?? '';
  const expiresInSeconds =
    quote?.expiry && status !== 'paid'
      ? Math.max(0, quote.expiry - nowSeconds)
      : null;
  const numericAmount = Number(amount);
  const canCreate =
    !!selectedMint &&
    Number.isInteger(numericAmount) &&
    numericAmount > 0 &&
    status !== 'creating' &&
    status !== 'waiting' &&
    status !== 'minting';

  const createInvoice = useCallback(async (onInvoiceCreated?: () => void) => {
    if (!selectedMint || !canCreate) return;

    cancelledRef.current = false;
    setError(null);
    setCopied(false);
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
      setNowSeconds(Math.floor(Date.now() / 1000));
      onInvoiceCreated?.();
      setStatus('waiting');
    } catch (cause) {
      console.error('[minting] failed to create or mint invoice', cause);
      setError(cause instanceof Error ? cause.message : 'Unknown minting error');
      setStatus('error');
    }
  }, [
    authPubkey,
    canCreate,
    numericAmount,
    savePendingMintQuote,
    selectedMint,
    setActiveMintUrl,
  ]);

  useEffect(() => {
    if (!quote || status !== 'waiting') return;
    const stillPending = pendingMintQuotes.some(
      pendingQuote => pendingQuote.quote === quote.quote,
    );
    if (!stillPending) {
      setStatus('paid');
    }
  }, [pendingMintQuotes, quote, status]);

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
      cancelledRef.current = true;
      if (authPubkey && quote?.quote) {
        deletePendingMintQuote(authPubkey, quote.quote).catch(error => {
          console.error('[minting] failed to delete expired quote', error);
        });
      }
      setStatus('expired');
      setError('This invoice expired. Go back and create a new invoice.');
    }
  }, [authPubkey, deletePendingMintQuote, expiresInSeconds, quote, status]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    await Clipboard.setStringAsync(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [invoice]);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const selectMint = useCallback(
    (mint: string) => {
      if (status === 'creating' || status === 'waiting' || status === 'minting') return;
      setSelectedMint(mint);
      setActiveMintUrl(mint);
    },
    [setActiveMintUrl, status],
  );

  const backToAmount = useCallback(() => {
    if (status === 'creating' || status === 'minting') return;
  }, [status]);

  return (
    <MintingStack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: {backgroundColor: '#f8fafc'},
      }}
    >
      <MintingStack.Screen name="MintingAmount">
        {({navigation}) => (
          <MintingAmountStep
            amount={amount}
            balanceByMint={balanceByMint}
            canCreate={canCreate}
            mints={mints}
            selectedMint={selectedMint}
            status={status}
            onAmountChange={setAmount}
            onCreateInvoice={() => {
              createInvoice(() => navigation.navigate('MintingInvoice'));
            }}
            onSelectMint={selectMint}
          />
        )}
      </MintingStack.Screen>
      <MintingStack.Screen name="MintingInvoice">
        {({navigation}) => (
          <MintingInvoiceStep
            amount={amount}
            copied={copied}
            error={error}
            expiresInSeconds={expiresInSeconds}
            invoice={invoice}
            status={status}
            onBack={() => {
              backToAmount();
              navigation.goBack();
            }}
            onCopyInvoice={copyInvoice}
          />
        )}
      </MintingStack.Screen>
    </MintingStack.Navigator>
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
  onSelectMint: (mint: string) => void;
}) {
  return (
    <View style={styles.modalBody}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="pt-1 text-center text-2xl font-bold text-slate-900">
          Topup
        </Text>

        <MintCardPicker
          mints={mints}
          balanceByMint={balanceByMint}
          selectedMint={selectedMint}
          onSelectMint={onSelectMint}
        />

        <View className="mt-10 items-center">
          <View className="flex-row items-center">
            <Text className="mr-2 -translate-y-2 text-4xl font-black text-slate-900">丰</Text>
            <TextInput
              className="h-24 min-w-40 max-w-72 p-0 text-center text-7xl font-bold text-slate-900"
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#cbd5e1"
              textAlignVertical="center"
              value={amount}
              editable={status !== 'creating'}
              onChangeText={value => onAmountChange(value.replace(/[^0-9]/g, ''))}
            />
          </View>
        </View>

        <AppButton
          className="mt-10"
          disabled={!canCreate}
          title={status === 'creating' ? 'Creating...' : 'Create Lightning Invoice'}
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
  return (
    <View style={styles.modalBody}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          className="mt-4 h-10 flex-row items-center self-start rounded-full px-1"
          onPress={onBack}
        >
          <ArrowLeft size={20} color="#17212b" strokeWidth={2.4} />
          <Text className="ml-1 text-sm font-bold text-slate-500">Back</Text>
        </Pressable>

        <View className="mt-4 items-center rounded-lg bg-slate-200 py-3">
          <Text className="text-3xl font-bold text-slate-900">
            {amount || 0} <Text className="font-black">sats</Text>
          </Text>
        </View>

        <View className="mt-8 items-center">
          {status === 'paid' ? (
            <View className="h-[275px] w-[275px] items-center justify-center rounded-xl border-4 border-emerald-500 bg-white shadow-sm">
              <Check size={150} color="#22c55e" strokeWidth={1.8} />
            </View>
          ) : invoice ? (
            <Pressable
              className="rounded-xl bg-white p-4 shadow-sm"
              onPress={onCopyInvoice}
            >
              <QRCode value={`lightning:${invoice}`} size={275} />
            </Pressable>
          ) : (
            <View className="h-[275px] w-[275px] items-center justify-center rounded-xl bg-slate-200 shadow-sm">
              <ActivityIndicator color="#1f7a5a" />
            </View>
          )}

          <View className="mt-3 flex-row items-center">
            {status === 'paid' ? (
              <Check size={18} color="#1f7a5a" strokeWidth={2.4} />
            ) : status === 'waiting' || status === 'minting' ? (
              <ActivityIndicator color="#1f7a5a" />
            ) : (
              <RefreshCw size={17} color="#64748b" strokeWidth={2.2} />
            )}
            <Text className="ml-2 text-sm font-semibold text-slate-500">
              {status === 'paid'
                ? 'Payment received!'
                : status === 'waiting' && expiresInSeconds !== null
                  ? `Expires in ${formatExpiresIn(expiresInSeconds)}`
                  : statusText(status)}
            </Text>
          </View>
        </View>

        <Pressable
          className="mt-6 min-h-12 w-full flex-row items-center rounded-lg border border-amber-400 bg-white px-3"
          disabled={!invoice}
          onPress={onCopyInvoice}
        >
          <Text
            className="min-w-0 flex-1 text-xs text-slate-500"
            numberOfLines={1}
          >
            {invoice || 'Generating...'}
          </Text>
          <ClipboardCopy size={18} color="#52616f" strokeWidth={2.2} />
        </Pressable>
        <Text className="mt-2 text-center text-xs font-semibold text-slate-500">
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
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  content: {
    paddingBottom: 34,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  mintStripContent: {
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    minHeight: 92,
  },
  mintSquare: {
    shadowColor: '#0f172a',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  selectedMintSquare: {
    shadowColor: '#0f172a',
    shadowOffset: {width: 0, height: 5},
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 2,
  },
});

function MintCardPicker({
  mints,
  balanceByMint,
  selectedMint,
  onSelectMint,
}: {
  mints: string[];
  balanceByMint: Record<string, number>;
  selectedMint: string | null;
  onSelectMint: (mint: string) => void;
}) {
  if (!mints.length) {
    return (
      <View className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
        <Text className="text-base font-bold text-slate-900">No mint selected</Text>
        <Text className="mt-1 text-sm text-slate-500">
          Add a wallet mint before creating an invoice.
        </Text>
      </View>
    );
  }

  const activeMint = selectedMint || mints[0];
  const activeBalance = balanceByMint[activeMint] ?? 0;

  return (
    <View className="mt-8">
      <Pressable
        className="mt-14 rounded-2xl border border-slate-200 bg-white px-5 pb-6 pt-16"
        onPress={() => onSelectMint(activeMint)}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text className="shrink py-1 text-base leading-8 text-slate-900">
            current balance:{' '}
            <Text className="text-2xl leading-8">{activeBalance} 丰</Text>
          </Text>
        </View>
      </Pressable>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="absolute -top-1 -mx-4 z-10 h-[92px]"
        contentContainerStyle={styles.mintStripContent}
      >
        {mints.map(mint => (
          <MintSquare
            key={mint}
            mintUrl={mint}
            selected={mint === activeMint}
            onPress={() => onSelectMint(mint)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function MintSquare({
  mintUrl,
  selected,
  onPress,
}: {
  mintUrl: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [mint, setMint] = useState<MintInfo>(() => ({
    name: displayMintName(mintUrl),
    url: mintUrl,
  }));
  const sizeProgress = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    let alive = true;
    fetchMintInfo(mintUrl).then(nextMint => {
      if (alive) setMint(nextMint);
    });
    return () => {
      alive = false;
    };
  }, [mintUrl]);

  useEffect(() => {
    Animated.timing(sizeProgress, {
      toValue: selected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [selected, sizeProgress]);

  const colors = mintColors(mint.name || mintUrl);
  const initial = (mint.name || displayMintName(mintUrl)).trim().charAt(0).toUpperCase();
  const tileSize = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [58, 82],
  });
  const tileRadius = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 18],
  });
  const iconSize = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [34, 48],
  });
  const iconRadius = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 16],
  });
  const initialClassName = selected ? 'text-3xl' : 'text-xl';

  return (
    <AnimatedPressable
      className={`items-center justify-center overflow-hidden ${
        selected ? 'border-2 border-white' : ''
      }`}
      style={[
        {
          backgroundColor: colors.soft,
          borderRadius: tileRadius,
          height: tileSize,
          width: tileSize,
        },
        selected ? styles.selectedMintSquare : styles.mintSquare,
      ]}
      onPress={onPress}
    >
      {mint.iconUrl ? (
        <AnimatedImage
          contentFit="cover"
          cachePolicy="memory-disk"
          source={{uri: mint.iconUrl}}
          style={{
            borderRadius: iconRadius,
            height: iconSize,
            width: iconSize,
          }}
        />
      ) : (
        <Animated.View
          className="items-center justify-center"
          style={{
            backgroundColor: colors.base,
            borderRadius: iconRadius,
            height: iconSize,
            width: iconSize,
          }}
        >
          <Text className={`${initialClassName} font-black text-white`}>
            {initial}
          </Text>
        </Animated.View>
      )}
    </AnimatedPressable>
  );
}

const mintInfoCache = new Map<string, MintInfo>();

async function fetchMintInfo(mintUrl: string): Promise<MintInfo> {
  const normalizedUrl = normalizeMintUrl(mintUrl);
  const cached = mintInfoCache.get(normalizedUrl);
  if (cached) return cached;

  try {
    const response = await fetch(`${normalizedUrl}/v1/info`);
    if (!response.ok) throw new Error('Mint info request failed');
    const info = (await response.json()) as MintInfoResponse;
    const mint = {
      name: info.name || displayMintName(normalizedUrl),
      url: normalizedUrl,
      iconUrl: info.icon_url,
    };
    mintInfoCache.set(normalizedUrl, mint);
    return mint;
  } catch {
    const fallback = {
      name: displayMintName(normalizedUrl),
      url: normalizedUrl,
    };
    mintInfoCache.set(normalizedUrl, fallback);
    return fallback;
  }
}

function mintColors(value: string) {
  const hash = value
    .replace(/cash/gi, '')
    .split('')
    .reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 2147483647, 0);
  const hue = Math.abs(hash % 320) + 20;
  return {
    base: `hsl(${hue}, 72%, 34%)`,
    soft: `hsl(${hue}, 42%, 90%)`,
  };
}
