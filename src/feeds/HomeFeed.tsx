import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import type {ParsedEvent, RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind17375,
  asKind9321,
  asKind9735,
  asParsedEvent,
  asEoce,
  ConnectionTracker,
} from '@candypoets/nipworker/utils';
import {
  Bell,
  CheckCircle2,
  CirclePlus,
  Eye,
  EyeOff,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  Wallet,
  Zap,
} from 'lucide-react-native';
import {Feed} from '../components/Feed';
import {Avatar} from '../components/notes/Avatar';
import {User} from '../components/notes/User';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useAuthStore, useNostrStore, useRelayStore, useWalletStore} from '../stores';
import {HeaderProfileButton} from '../components/HeaderProfileButton';
import {RelaysList as HeaderRelaysList} from '../components/RelaysList';

type HomeFeedProps = {
  enabled: boolean;
  visible: boolean;
  onLoginOpen: () => void;
  onProfileOpen: () => void;
  onNotificationsOpen: () => void;
};

type WalletActivity = {
  event: ParsedEvent;
  id: string;
  kind: 9321 | 9735;
  createdAt: number;
  amount: number;
  sender: string | null;
  recipient: string | null;
  comment: string | null;
  redeemed?: boolean;
};

type MintInfo = {
  name: string;
  url: string;
  state?: string;
};

export function HomeFeed({
  enabled,
  visible,
  onLoginOpen,
  onProfileOpen,
  onNotificationsOpen,
}: HomeFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribeWalletRef = useRef<(() => void) | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const eoceReceivedRef = useRef(false);
  const requestCacheRef = useRef(0);
  const lastHomeKeyRef = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewHidden, setViewHidden] = useState(false);
  const [defaultRelays, setDefaultRelays] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const authPubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const activeMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const homeRelays = useMemo(
    () => [...new Set([...defaultRelays, ...walletReadRelays, ...readRelays])],
    [defaultRelays, readRelays, walletReadRelays],
  );
  const homeKey = useMemo(
    () => `${authPubkey || 'anon'}:${homeRelays.join(',')}`,
    [authPubkey, homeRelays],
  );

  const requestList = useCallback(
    (): RequestObject[] => {
      if (!authPubkey) return [];
      return [
        {
          kinds: [9321, 9735],
          authors: [authPubkey],
          limit: 50,
          noCache: !!requestCacheRef.current,
          relays: homeRelays,
        },
        {
          kinds: [9321, 9735],
          tags: {'#p': [authPubkey]},
          limit: 50,
          noCache: !!requestCacheRef.current,
          relays: homeRelays,
        },
        {
          kinds: [9735],
          tags: {'#P': [authPubkey]},
          limit: 50,
          noCache: !!requestCacheRef.current,
          relays: homeRelays,
        },
      ];
    },
    [authPubkey, homeRelays],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDefaultRelays(DEFAULT_FEED_RELAYS);
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const commitPendingItems = useCallback(() => {
    const pending = pendingItemsRef.current;
    if (!pending.length) return;
    pendingItemsRef.current = [];
    itemsRef.current = [...itemsRef.current, ...pending].sort(
      (left, right) => right.createdAt() - left.createdAt(),
    );
    setTick(tick => tick + 1);
  }, []);

  const completeResolvingSubscription = useCallback(() => {
    if (!subscriptionResolvingRef.current) return;
    subscriptionResolvingRef.current = false;
    commitPendingItems();
    setLoading(false);
    setRefreshing(false);
    clearRefreshTimeout();
  }, [clearRefreshTimeout, commitPendingItems]);

  const addEvent = useCallback(
    (parsed: ParsedEvent) => {
      if (parsed.kind() !== 9321 && parsed.kind() !== 9735) return;
      const id = parsed.id();
      if (!id || seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      pendingItemsRef.current = [...pendingItemsRef.current, parsed];
      if (!subscriptionResolvingRef.current) commitPendingItems();
    },
    [commitPendingItems],
  );

  const handleMessage = useCallback(
    (message: WorkerMessage) => {
      if (asEoce(message)) {
        eoceReceivedRef.current = true;
        commitPendingItems();
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) {
          setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        }
        connectionTrackerRef.current.handleMessage(message);
        if (connectionTrackerRef.current.resolutionRate > 0.5) {
          completeResolvingSubscription();
        }
        return;
      }

      const parsed = asParsedEvent(message);
      if (parsed) addEvent(parsed);
    },
    [addEvent, commitPendingItems, completeResolvingSubscription, setRelayStatus],
  );

  const initFeed = useCallback(() => {
    if (!enabled || !visible || !authPubkey) return;
    if (!homeRelays.length) return;
    const requests = requestList();
    if (!requests.length) return;
    unsubscribeRef.current?.();
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = true;
    eoceReceivedRef.current = false;
    homeRelays.forEach(relay =>
      setRelayStatus(normalizeRelayUrl(relay), 'SUBSCRIBED'),
    );
    setLoading(itemsRef.current.length === 0);
    unsubscribeRef.current = subscribeToNostr(
      `home_${authPubkey}_${requestCacheRef.current}`,
      requests,
      handleMessage,
    );
    refreshTimeoutRef.current = setTimeout(() => {
      completeResolvingSubscription();
    }, 10000);
  }, [authPubkey, completeResolvingSubscription, enabled, handleMessage, homeRelays, requestList, setRelayStatus, visible]);

  const handleWalletMessage = useCallback(
    (message: WorkerMessage) => {
      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) {
          setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        }
        return;
      }

      const parsed = asParsedEvent(message);
      if (!parsed || parsed.kind() !== 17375) return;
      const wallet = asKind17375(parsed);
      if (!wallet) return;

      const mintUrls = Array.from(
        {length: wallet.mintsLength()},
        (_, index) => wallet.mints(index),
      ).filter((mint): mint is string => !!mint);

      setWalletMintUrls(mintUrls);
      setActiveMintUrl(
        activeMintUrl && mintUrls.includes(activeMintUrl)
          ? activeMintUrl
          : mintUrls[0] ?? null,
      );
    },
    [activeMintUrl, setActiveMintUrl, setRelayStatus, setWalletMintUrls],
  );

  const initWallet = useCallback(() => {
    if (!enabled || !visible || !authPubkey) return;
    if (!homeRelays.length) return;
    const subId = `active_wallet_${authPubkey}_${requestCacheRef.current}_${hashKey(homeRelays.join(','))}`;
    unsubscribeWalletRef.current?.();
    unsubscribeWalletRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: [17375],
          authors: [authPubkey],
          limit: 10,
          noCache: !!requestCacheRef.current,
          relays: homeRelays,
        },
      ],
      handleWalletMessage,
      {bytesPerEvent: 6144},
    );
  }, [authPubkey, enabled, handleWalletMessage, homeRelays, visible]);

  useEffect(() => {
    if (lastHomeKeyRef.current === homeKey) return;
    lastHomeKeyRef.current = homeKey;
    itemsRef.current = [];
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = false;
    eoceReceivedRef.current = false;
    seenIdsRef.current.clear();
    setTick(tick => tick + 1);
  }, [homeKey]);

  useEffect(() => {
    clearRefreshTimeout();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribeWalletRef.current?.();
    unsubscribeWalletRef.current = null;
    setLoading(false);
    setRefreshing(false);

    if (enabled && visible && authPubkey) {
      initWallet();
      initFeed();
    }

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribeWalletRef.current?.();
      unsubscribeWalletRef.current = null;
      pendingItemsRef.current = [];
      connectionTrackerRef.current.reset();
      subscriptionResolvingRef.current = false;
      eoceReceivedRef.current = false;
      clearRefreshTimeout();
    };
  }, [authPubkey, clearRefreshTimeout, enabled, initFeed, initWallet, visible]);

  const handleRefresh = useCallback(() => {
    if (!authPubkey || refreshing) return;
    requestCacheRef.current += 1;
    setRefreshing(true);
    initWallet();
    initFeed();
  }, [authPubkey, initFeed, initWallet, refreshing]);

  const activities = useMemo(
    () =>
      itemsRef.current
        .map(toWalletActivity)
        .filter((item): item is WalletActivity => !!item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemsRef.current, authPubkey],
  );

  const renderHeader = useCallback(
    () => (
      <HomeHeader
        relays={homeRelays}
        relayStatuses={relayStatuses}
        refreshing={refreshing}
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={walletMintUrls}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
        onRefresh={handleRefresh}
        onProfileOpen={onProfileOpen}
        onNotificationsOpen={onNotificationsOpen}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      homeRelays,
      handleRefresh,
      onNotificationsOpen,
      onProfileOpen,
      refreshing,
      relayStatuses,
      setActiveMintUrl,
      viewHidden,
      walletMintUrls,
    ],
  );

  const renderStickyHeader = useCallback(
    () => (
      <HomeHeader
        compact
        relays={homeRelays}
        relayStatuses={relayStatuses}
        refreshing={refreshing}
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={[]}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
        onRefresh={handleRefresh}
        onProfileOpen={onProfileOpen}
        onNotificationsOpen={onNotificationsOpen}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      homeRelays,
      handleRefresh,
      onNotificationsOpen,
      onProfileOpen,
      refreshing,
      relayStatuses,
      setActiveMintUrl,
      viewHidden,
    ],
  );

  if (!authPubkey) {
    return (
      <Feed
        items={[]}
        header={renderHeader}
        stickyHeader={renderStickyHeader}
        renderItem={() => null}
        empty={<LoggedOutHome onLoginOpen={onLoginOpen} />}
        contentContainerClassName="pb-28 px-2"
      />
    );
  }

  return (
    <Feed
      items={activities}
      getItemId={item => item.id}
      pullToRefresh
      header={renderHeader}
      stickyHeader={renderStickyHeader}
      renderItem={({item}) => (
        <WalletActivityRow activity={item} currentPubkey={authPubkey} />
      )}
      loading={loading && activities.length === 0}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      empty={<EmptyWalletStub />}
      contentContainerClassName="pb-28 px-2"
    />
  );
}

function HomeHeader({
  compact = false,
  relays,
  relayStatuses,
  refreshing,
  viewHidden,
  pubkey,
  mintUrls,
  activeMintUrl,
  balanceByMint,
  onSelectMint,
  onToggleView,
  onRefresh,
  onProfileOpen,
  onNotificationsOpen,
}: {
  compact?: boolean;
  relays: string[];
  relayStatuses: Record<string, string>;
  refreshing: boolean;
  viewHidden: boolean;
  pubkey: string | null;
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
  onToggleView: () => void;
  onRefresh: () => void;
  onProfileOpen: () => void;
  onNotificationsOpen: () => void;
}) {
  return (
    <View className={`${compact ? 'border-b border-slate-200 bg-slate-50/95 px-4 py-2' : 'bg-slate-50 px-1 pt-2'}`}>
      <View className={`${compact ? '' : 'mx-1 rounded-lg bg-white/90 px-3 py-3 shadow-sm'}`}>
        <View className="h-14 flex-row items-center justify-between">
          <Text className="text-2xl font-semibold text-slate-950">Home</Text>
          <View className="flex-row items-center gap-2">
            <HeaderIconButton onPress={onToggleView}>
              {viewHidden ? (
                <EyeOff size={19} color="#17212b" strokeWidth={2.2} />
              ) : (
                <Eye size={19} color="#17212b" strokeWidth={2.2} />
              )}
            </HeaderIconButton>
            <HeaderIconButton>
              <QrCode size={19} color="#17212b" strokeWidth={2.2} />
            </HeaderIconButton>
            <HeaderIconButton onPress={onRefresh}>
              <RefreshCw
                size={19}
                color={refreshing ? '#1f7a5a' : '#52616f'}
                strokeWidth={2.2}
              />
            </HeaderIconButton>
            <HeaderIconButton onPress={onNotificationsOpen}>
              <Bell size={19} color="#17212b" strokeWidth={2.2} />
            </HeaderIconButton>
            <HeaderProfileButton pubkey={pubkey} onPress={onProfileOpen} />
          </View>
        </View>
        <HeaderRelaysList relays={relays} statuses={relayStatuses} mini={compact} />
        {!compact && pubkey ? (
          <WalletCarousel
            mintUrls={mintUrls}
            activeMintUrl={activeMintUrl}
            balanceByMint={balanceByMint}
            onSelectMint={onSelectMint}
          />
        ) : null}
      </View>
    </View>
  );
}

function WalletCarousel({
  mintUrls,
  activeMintUrl,
  balanceByMint,
  onSelectMint,
}: {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
}) {
  if (!mintUrls.length) {
    return (
      <View className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-slate-900">
              Setup Your Wallet
            </Text>
            <Text className="mt-1 text-sm text-slate-500">
              No Cashu wallet event was found yet.
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
            <Wallet size={20} color="#1f7a5a" strokeWidth={2.2} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="mt-3">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 pr-4"
      >
        {mintUrls.map(mintUrl => (
          <MintCard
            key={mintUrl}
            mintUrl={mintUrl}
            selected={mintUrl === activeMintUrl}
            balance={balanceByMint[mintUrl] ?? 0}
            onPress={() => onSelectMint(mintUrl)}
          />
        ))}
      </ScrollView>
      <View className="mt-4 flex-row items-start gap-5 px-2">
        <WalletAction icon={<CirclePlus size={25} color="#ffffff" strokeWidth={2.3} />} label="Receive" />
        <WalletAction icon={<Send size={25} color="#ffffff" strokeWidth={2.3} />} label="Send" />
        <WalletAction outlined icon={<ScanLine size={25} color="#1f7a5a" strokeWidth={2.3} />} label="Scan" />
      </View>
    </View>
  );
}

function MintCard({
  mintUrl,
  selected,
  balance,
  onPress,
}: {
  mintUrl: string;
  selected: boolean;
  balance: number;
  onPress: () => void;
}) {
  const [mint, setMint] = useState<MintInfo>(() => ({
    name: displayMintName(mintUrl),
    url: mintUrl,
  }));

  useEffect(() => {
    let alive = true;
    fetchMintData(mintUrl).then(nextMint => {
      if (alive) setMint(nextMint);
    });
    return () => {
      alive = false;
    };
  }, [mintUrl]);

  const colors = cardColors(mint.name || mintUrl);

  return (
    <Pressable
      className={`h-32 w-72 overflow-hidden rounded-xl p-4 shadow-sm ${selected ? 'border-2 border-emerald-400' : 'border border-transparent'}`}
      style={{backgroundColor: colors.base}}
      onPress={onPress}
    >
      <View
        className="absolute -bottom-16 -right-12 h-40 w-40 rounded-full border-2 opacity-20"
        style={{borderColor: colors.accent}}
      />
      <View
        className="absolute -bottom-8 right-14 h-24 w-24 rounded-full border-2 opacity-20"
        style={{borderColor: '#ffffff'}}
      />
      <View className="flex-row items-start justify-between">
        <Text className="max-w-52 text-lg font-bold text-white">
          {cleanMintName(mint.name)}
        </Text>
        <View
          className="h-3 w-3 rounded-full"
          style={{backgroundColor: mint.state === 'ERROR' ? '#ef4444' : '#22c55e'}}
        />
      </View>
      <View className="mt-5 flex-row gap-3">
        <View className="flex-1 rounded-lg bg-black/20 px-3 py-2">
          <Text className="text-xs font-semibold uppercase text-white/70">
            Balance
          </Text>
          <Text className="mt-1 font-mono text-xl font-semibold text-white">
            {balance} sats
          </Text>
        </View>
        <View className="flex-1 rounded-lg bg-black/20 px-3 py-2">
          <Text className="text-xs font-semibold uppercase text-white/70">
            Health
          </Text>
          <Text className="mt-1 text-xl font-semibold text-white">
            {mint.state === 'ERROR' ? 'Error' : 'OK'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function WalletAction({
  icon,
  label,
  outlined = false,
}: {
  icon: React.ReactNode;
  label: string;
  outlined?: boolean;
}) {
  return (
    <View className="items-center">
      <Pressable
        className={`h-14 w-14 items-center justify-center rounded-full ${outlined ? 'border border-emerald-700 bg-white' : 'bg-emerald-700'}`}
      >
        {icon}
      </Pressable>
      <Text className="mt-1 text-sm font-semibold text-slate-800">{label}</Text>
    </View>
  );
}

function HeaderIconButton({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      className="h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
      hitSlop={12}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

function WalletActivityRow({
  activity,
  currentPubkey,
}: {
  activity: WalletActivity;
  currentPubkey: string;
}) {
  const isSender = activity.sender === currentPubkey || activity.event.pubkey() === currentPubkey;
  const otherPubkey = isSender ? activity.recipient : activity.sender || activity.event.pubkey();
  const kindColor = activity.kind === 9321 ? '#b7791f' : '#eab308';

  return (
    <View className="mt-1 rounded-lg border border-slate-200 bg-white/95 px-4 py-4 shadow-sm">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View>
            <Avatar pubkey={otherPubkey || ''} size="lg" query={!!otherPubkey} />
            <View
              className="absolute bottom-0 right-0 h-5 w-5 translate-x-1 items-center justify-center rounded-full border-2 border-white"
              style={{backgroundColor: kindColor}}
            >
              {activity.kind === 9321 ? (
                <Wallet size={11} color="#ffffff" strokeWidth={2.4} />
              ) : (
                <Zap size={11} color="#ffffff" fill="#ffffff" strokeWidth={2.4} />
              )}
            </View>
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-1">
              {isSender ? (
                <>
                  <Text className="text-sm font-semibold text-slate-900">You zapped</Text>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                </>
              ) : (
                <>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                  <Text className="text-sm font-semibold text-slate-900">zapped you</Text>
                </>
              )}
            </View>
            <Text className="mt-1 text-xs text-slate-500">
              {formatActivityDate(activity.createdAt)} · NIP-{activity.kind === 9321 ? '61' : '57'}
            </Text>
          </View>
        </View>
        <View className="shrink-0 flex-row items-center gap-1">
          <CheckCircle2 size={16} color="#1f7a5a" strokeWidth={2.2} />
          <Text className="text-sm font-bold text-emerald-700">
            {activity.amount} sats
          </Text>
        </View>
      </View>
      {activity.comment ? (
        <Text className="ml-13 mt-3 text-sm text-slate-600">
          "{activity.comment}"
        </Text>
      ) : null}
    </View>
  );
}

function LoggedOutHome({onLoginOpen}: {onLoginOpen: () => void}) {
  return (
    <View className="rounded-lg border border-slate-200 bg-white/95 px-5 py-6 shadow-sm">
      <View className="items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
          <Wallet size={30} color="#1f7a5a" strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-slate-900">
          Sign in to load your wallet feed
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
          Home shows your NIP-61 NutsZap and NIP-57 zap activity once a Nostr key is available.
        </Text>
        <Pressable
          className="mt-5 rounded-full bg-emerald-700 px-5 py-3"
          onPress={onLoginOpen}
        >
          <Text className="text-sm font-semibold text-white">
            Login with private key
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmptyWalletStub() {
  return (
    <View className="rounded-lg border border-slate-200 bg-white/95 px-5 py-6 shadow-sm">
      <View className="items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
          <Wallet size={30} color="#1f7a5a" strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-slate-900">
          No wallet activity yet
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
          Cashu wallet loading is stubbed for now. Activity will appear here when NIP-61 or NIP-57 events are found.
        </Text>
      </View>
    </View>
  );
}

function toWalletActivity(event: ParsedEvent): WalletActivity | null {
  const id = event.id();
  if (!id) return null;

  if (event.kind() === 9321) {
    const zap = asKind9321(event);
    if (!zap) return null;
    return {
      event,
      id,
      kind: 9321,
      createdAt: event.createdAt(),
      amount: zap.amount(),
      sender: zap.sender(),
      recipient: zap.recipient(),
      comment: zap.comment(),
      redeemed: zap.redeemed(),
    };
  }

  if (event.kind() === 9735) {
    const zap = asKind9735(event);
    if (!zap) return null;
    return {
      event,
      id,
      kind: 9735,
      createdAt: event.createdAt(),
      amount: zap.amount(),
      sender: zap.sender(),
      recipient: zap.recipient(),
      comment: zap.content(),
    };
  }

  return null;
}

const mintInfoCache = new Map<string, MintInfo>();

async function fetchMintData(mintUrl: string): Promise<MintInfo> {
  const normalizedUrl = normalizeMintUrl(mintUrl);
  const cached = mintInfoCache.get(normalizedUrl);
  if (cached) return cached;

  try {
    const response = await fetch(`${normalizedUrl}/v1/info`);
    if (!response.ok) throw new Error('Mint info request failed');
    const info = (await response.json()) as {
      name?: string;
      icon_url?: string;
    };
    const mint = {
      name: info.name || displayMintName(normalizedUrl),
      url: normalizedUrl,
      state: 'OK',
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

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function displayMintName(url: string) {
  return normalizeMintUrl(url)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
}

function cleanMintName(name: string) {
  return name.replace(/mint/gi, '').replace(/cashu/gi, '').trim() || 'Unknown Mint';
}

function cardColors(value: string) {
  const withoutCash = value.replace(/cash/gi, '');
  let hash = 0;
  for (let index = 0; index < withoutCash.length; index += 1) {
    hash = (hash << 5) - hash + withoutCash.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash % 320) + 20;
  const saturation = 65 + Math.abs((hash >> 8) % 25);
  const light = 18 + Math.abs((hash >> 16) % 12);
  return {
    base: `hsl(${hue}, ${saturation}%, ${light}%)`,
    accent: `hsl(${(hue + 48) % 360}, 70%, 80%)`,
  };
}

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash.toString(36);
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function formatActivityDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.getTime() >= today.getTime()) return 'Today';
  if (date.getTime() >= yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
