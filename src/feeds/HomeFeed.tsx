import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { neventEncode } from 'nostr-tools/nip19';
import {
  MuteFilterPipeConfigT,
  ParsePipeConfigT,
  PipeConfig,
  PipeT,
  ProofVerificationPipeConfigT,
  SaveToDbPipeConfigT,
  type ParsedEvent,
  type RequestObject,
  type WorkerMessage,
} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind9321,
  asKind9735,
  asParsedEvent,
  asEoce,
  ConnectionTracker,
  fbIterable,
  fbArray,
  isValidProofs,
} from '@candypoets/nipworker/utils';
import type { Proof } from '@cashu/cashu-ts';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  QrCode,
  ScanLine,
  Wallet,
  Zap,
} from 'lucide-react-native';
import { AppButton } from '../components/AppButton';
import { Feed } from '../components/Feed';
import { MintCardPicker } from '../components/MintCardPicker';
import { Avatar } from '../components/notes/Avatar';
import { User } from '../components/notes/User';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import {
  useAuthStore,
  useNostrStore,
  useRelayStore,
  useWalletStore,
} from '../stores';
import { HeaderProfileButton } from '../components/HeaderProfileButton';
import type { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme';
import {
  uniqueWalletRelays,
} from '../hooks/useWalletSubscription';

type HomeFeedProps = {
  enabled: boolean;
  visible: boolean;
  onChromeVisibilityChange?: (visible: boolean) => void;
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
  zappedEventId: string | null;
  zappedRelays: string[];
  redeemed?: boolean;
};

const HOME_REFRESH_TIMEOUT_MS = 3_000;

export function HomeFeed({ enabled, visible, onChromeVisibilityChange }: HomeFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribeProofsRef = useRef<(() => void) | null>(null);
  const unsubscribeNutzapsRef = useRef<(() => void) | null>(null);
  const handleProofsMessageRef = useRef<((message: WorkerMessage) => void) | null>(
    null,
  );
  const proofSubscriptionSeqRef = useRef(0);
  const proofSinceRef = useRef<number | null>(null);
  const pendingProofEventsRef = useRef<ParsedEvent[]>([]);
  const proofEoseReceivedRef = useRef(false);
  const collectingProofBackupsRef = useRef(false);
  const resolveProofBackupsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingItemsRef = useRef<ParsedEvent[]>([]);
  const connectionTrackerRef = useRef(new ConnectionTracker());
  const subscriptionResolvingRef = useRef(false);
  const eoceReceivedRef = useRef(false);
  const requestCacheRef = useRef(0);
  const lastHomeKeyRef = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewHidden, setViewHidden] = useState(false);
  const [, setTick] = useState(0);
  const [walletRelayFallbackReady, setWalletRelayFallbackReady] = useState(false);
  const [, setProofDebug] = useState({
    validProofMessages: 0,
    proofCount: 0,
    backupEvents: 0,
    nutzapEvents: 0,
  });
  const authPubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const kind10019UpdatedAt = useNostrStore(state => state.kind10019UpdatedAt);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const activeMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const initializeProofWallet = useWalletStore(
    state => state.initializeProofWallet,
  );
  const clearProofStorageOnce = useWalletStore(
    state => state.clearProofStorageOnce,
  );
  const addProofs = useWalletStore(state => state.addProofs);
  const checkAndFilterProofs = useWalletStore(state => state.checkAndFilterProofs);
  const verifyAndCleanProofs = useWalletStore(state => state.verifyAndCleanProofs);
  const homeRelays = useMemo(() => {
    return [
      ...new Set([
        ...DEFAULT_FEED_RELAYS,
        ...walletReadRelays,
        ...readRelays,
        'wss://relay.nuts.cash',
      ]),
    ];
  }, [readRelays, walletReadRelays]);
  const walletProofRelays = useMemo(() => {
    return uniqueWalletRelays(readRelays, walletReadRelays);
  }, [readRelays, walletReadRelays]);
  const walletRelaysResolved =
    kind10019UpdatedAt > 0 || walletRelayFallbackReady;
  const homeKey = authPubkey || 'anon';

  const proofPipeline = useMemo(
    () => [
      new PipeT(
        PipeConfig.MuteFilterPipeConfig,
        new MuteFilterPipeConfigT(
          mutedPubkeys,
          mutedHashtags,
          mutedWords,
          mutedEventIds,
        ),
      ),
      new PipeT(PipeConfig.ParsePipeConfig, new ParsePipeConfigT()),
      new PipeT(PipeConfig.SaveToDbPipeConfig, new SaveToDbPipeConfigT()),
      new PipeT(
        PipeConfig.ProofVerificationPipeConfig,
        new ProofVerificationPipeConfigT(500),
      ),
    ],
    [mutedEventIds, mutedHashtags, mutedPubkeys, mutedWords],
  );

  const requestList = useCallback((): RequestObject[] => {
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
        tags: { '#p': [authPubkey] },
        limit: 50,
        noCache: !!requestCacheRef.current,
        relays: homeRelays,
      },
      {
        kinds: [9735],
        tags: { '#P': [authPubkey] },
        limit: 50,
        noCache: !!requestCacheRef.current,
        relays: homeRelays,
      },
    ];
  }, [authPubkey, homeRelays]);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const clearRefreshWatchdog = useCallback(() => {
    if (refreshWatchdogRef.current) {
      clearTimeout(refreshWatchdogRef.current);
      refreshWatchdogRef.current = null;
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

  const completeResolvingSubscription = useCallback((reason = 'relay-resolution') => {
    console.log('[home-refresh] complete', {
      reason,
      wasResolving: subscriptionResolvingRef.current,
      pendingItems: pendingItemsRef.current.length,
    });
    subscriptionResolvingRef.current = false;
    commitPendingItems();
    setLoading(false);
    setRefreshing(false);
    clearRefreshTimeout();
    clearRefreshWatchdog();
  }, [clearRefreshTimeout, clearRefreshWatchdog, commitPendingItems]);

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
    async (message: WorkerMessage) => {
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
    [
      addEvent,
      commitPendingItems,
      completeResolvingSubscription,
      setRelayStatus,
    ],
  );

  const initFeed = useCallback(() => {
    if (!enabled || !visible || !authPubkey || !hasSigner) return false;
    if (!homeRelays.length) return false;
    const requests = requestList();
    if (!requests.length) return false;
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
    clearRefreshTimeout();
    refreshTimeoutRef.current = setTimeout(() => {
      completeResolvingSubscription('timeout');
    }, HOME_REFRESH_TIMEOUT_MS);
    return true;
  }, [
    authPubkey,
    clearRefreshTimeout,
    completeResolvingSubscription,
    enabled,
    hasSigner,
    handleMessage,
    homeRelays,
    requestList,
    setRelayStatus,
    visible,
  ]);

  const subscribeToNutzapsSince = useCallback(
    (since: number) => {
      if (!authPubkey || !walletProofRelays.length) return;
      proofSinceRef.current = since;
      unsubscribeNutzapsRef.current?.();
      unsubscribeNutzapsRef.current = subscribeToNostr(
        `nutszap_events_${authPubkey}_${requestCacheRef.current}_${since}`,
        [
          {
            kinds: [9321],
            tags: { '#p': [authPubkey] },
            since,
            noCache: !!requestCacheRef.current,
            limit: 50,
            relays: walletProofRelays,
          },
        ],
        message => handleProofsMessageRef.current?.(message),
        {
          isSlow: true,
          pipeline: proofPipeline,
        },
      );
    },
    [
      authPubkey,
      proofPipeline,
      walletProofRelays,
    ],
  );

  const finishProofBackupScan = useCallback(() => {
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }
    if (!collectingProofBackupsRef.current) return;
    collectingProofBackupsRef.current = false;
    verifyAndCleanProofs()
      .then(() => subscribeToNutzapsSince(Math.floor(Date.now() / 1000) - 24 * 60 * 60))
      .catch(() => {});
  }, [
    subscribeToNutzapsSince,
    verifyAndCleanProofs,
  ]);

  const scheduleResolveProofBackups = useCallback(
    () => {
      if (!collectingProofBackupsRef.current) return;
      if (resolveProofBackupsTimeoutRef.current) {
        clearTimeout(resolveProofBackupsTimeoutRef.current);
      }
      resolveProofBackupsTimeoutRef.current = setTimeout(() => {
        finishProofBackupScan();
      }, 1200);
    },
    [finishProofBackupScan],
  );

  const handleProofsMessage = useCallback(
    async (message: WorkerMessage) => {
      if (asEoce(message)) {
        verifyAndCleanProofs().catch(() => {});
        scheduleResolveProofBackups();
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        if (status.status()?.toString() === 'EOSE' && !proofEoseReceivedRef.current) {
          proofEoseReceivedRef.current = true;
          verifyAndCleanProofs().catch(() => {});
          scheduleResolveProofBackups();
        }
        return;
      }

      const validProofs = isValidProofs(message);
      if (!validProofs) {
        const parsed = asParsedEvent(message);
        if (parsed && (parsed.kind() === 7375 || parsed.kind() === 9321)) {
          pendingProofEventsRef.current.push(parsed);
        }
        return;
      }

      const sourceEvent = pendingProofEventsRef.current[0];
      const sourceKind =
        sourceEvent?.kind() ??
        (collectingProofBackupsRef.current ? 7375 : undefined);
      let messageProofCount = 0;
      for (const mintProofs of fbIterable(validProofs, 'proofs')) {
        const mint = mintProofs.mint();
        if (!mint) continue;
        const proofs = fbArray(mintProofs, 'proofs')
          .map(toCashuProof)
          .filter((proof): proof is Proof => !!proof);
        const checkedProofs =
          proofEoseReceivedRef.current && !collectingProofBackupsRef.current
            ? await checkAndFilterProofs(mint, proofs)
            : proofs;
        messageProofCount += checkedProofs.length;
        if (checkedProofs.length) {
          addProofs(mint, checkedProofs).catch(() => {});
        }
      }
      if (pendingProofEventsRef.current.length) {
        pendingProofEventsRef.current.shift();
      }
      if (sourceKind === 7375) {
        scheduleResolveProofBackups();
      }
      setProofDebug(current => ({
        validProofMessages: current.validProofMessages + 1,
        proofCount: current.proofCount + messageProofCount,
        backupEvents:
          sourceKind === 7375 ? current.backupEvents + 1 : current.backupEvents,
        nutzapEvents:
          sourceKind === 9321 ? current.nutzapEvents + 1 : current.nutzapEvents,
      }));
    },
    [
      addProofs,
      checkAndFilterProofs,
      scheduleResolveProofBackups,
      verifyAndCleanProofs,
    ],
  );

  useEffect(() => {
    handleProofsMessageRef.current = handleProofsMessage;
  }, [handleProofsMessage]);

  const initProofs = useCallback(() => {
    if (!enabled || !visible || !authPubkey) return;
    if (!walletRelaysResolved) return;
    if (!walletProofRelays.length) return;
    const seq = proofSubscriptionSeqRef.current + 1;
    proofSubscriptionSeqRef.current = seq;
    proofSinceRef.current = null;
    pendingProofEventsRef.current = [];
    proofEoseReceivedRef.current = false;
    collectingProofBackupsRef.current = true;
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }
    setProofDebug({
      validProofMessages: 0,
      proofCount: 0,
      backupEvents: 0,
      nutzapEvents: 0,
    });
    const subId = `nutszap_${authPubkey}_${requestCacheRef.current}`;
    const requests: RequestObject[] = [
      {
        kinds: [7375],
        authors: [authPubkey],
        noCache: !!requestCacheRef.current,
        limit: 20,
        relays: walletProofRelays,
      },
    ];
    unsubscribeProofsRef.current?.();
    unsubscribeNutzapsRef.current?.();
    unsubscribeProofsRef.current = null;
    unsubscribeNutzapsRef.current = null;
    clearProofStorageOnce(authPubkey)
      .then(() => initializeProofWallet(authPubkey, walletMintUrls))
      .then(() => verifyAndCleanProofs())
      .then(() => {
        if (proofSubscriptionSeqRef.current !== seq) return;
        unsubscribeProofsRef.current = subscribeToNostr(
          subId,
          requests,
          handleProofsMessage,
          {
            isSlow: true,
            pipeline: proofPipeline,
          },
        );
      })
      .catch(() => {});
  }, [
    authPubkey,
    clearProofStorageOnce,
    enabled,
    handleProofsMessage,
    initializeProofWallet,
    proofPipeline,
    verifyAndCleanProofs,
    visible,
    walletProofRelays,
    walletRelaysResolved,
    walletMintUrls,
  ]);

  useEffect(() => {
    setWalletRelayFallbackReady(false);
    if (!enabled || !visible || !authPubkey || kind10019UpdatedAt > 0) return;

    const timeout = setTimeout(() => {
      setWalletRelayFallbackReady(true);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [
    authPubkey,
    enabled,
    kind10019UpdatedAt,
    visible,
  ]);

  useEffect(() => {
    if (lastHomeKeyRef.current === homeKey) return;
    lastHomeKeyRef.current = homeKey;
    itemsRef.current = [];
    pendingItemsRef.current = [];
    connectionTrackerRef.current.reset();
    subscriptionResolvingRef.current = false;
    eoceReceivedRef.current = false;
    proofSinceRef.current = null;
    pendingProofEventsRef.current = [];
    proofEoseReceivedRef.current = false;
    collectingProofBackupsRef.current = false;
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }
    seenIdsRef.current.clear();
    setTick(tick => tick + 1);
  }, [homeKey]);

  useEffect(() => {
    const connectionTracker = connectionTrackerRef.current;
    clearRefreshTimeout();
    clearRefreshWatchdog();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribeProofsRef.current?.();
    unsubscribeNutzapsRef.current?.();
    unsubscribeProofsRef.current = null;
    unsubscribeNutzapsRef.current = null;
    proofSinceRef.current = null;
    pendingProofEventsRef.current = [];
    proofEoseReceivedRef.current = false;
    collectingProofBackupsRef.current = false;
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }
    proofSubscriptionSeqRef.current += 1;
    setLoading(false);
    setRefreshing(false);

    if (enabled && visible && authPubkey) {
      initProofs();
      initFeed();
    }

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribeProofsRef.current?.();
      unsubscribeProofsRef.current = null;
      proofSubscriptionSeqRef.current += 1;
      pendingItemsRef.current = [];
      connectionTracker.reset();
      subscriptionResolvingRef.current = false;
      eoceReceivedRef.current = false;
      clearRefreshTimeout();
      clearRefreshWatchdog();
    };
  }, [
    authPubkey,
    clearRefreshTimeout,
    clearRefreshWatchdog,
    enabled,
    initFeed,
    initProofs,
    visible,
  ]);

  const handleRefresh = useCallback(() => {
    if (!authPubkey || refreshing) return;
    console.log('[home-refresh] start', {
      requestCache: requestCacheRef.current + 1,
      relays: homeRelays.length,
      hasSigner,
      enabled,
      visible,
    });
    clearRefreshTimeout();
    requestCacheRef.current += 1;
    setRefreshing(true);
    clearRefreshWatchdog();
    refreshWatchdogRef.current = setTimeout(() => {
      refreshWatchdogRef.current = null;
      completeResolvingSubscription('refresh-watchdog');
    }, HOME_REFRESH_TIMEOUT_MS);
    try {
      initProofs();
      if (!initFeed()) {
        console.warn('[home-refresh] feed initialization skipped');
        completeResolvingSubscription('initialization-skipped');
      }
    } catch (error) {
      console.warn('[home-refresh] initialization failed', error);
      completeResolvingSubscription('initialization-failed');
    }
  }, [
    authPubkey,
    clearRefreshTimeout,
    clearRefreshWatchdog,
    completeResolvingSubscription,
    enabled,
    hasSigner,
    homeRelays.length,
    initFeed,
    initProofs,
    refreshing,
    visible,
  ]);

  const activities = useMemo(
    () =>
      itemsRef.current
        .map(toWalletActivity)
        .filter((item): item is WalletActivity => !!item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemsRef.current, authPubkey],
  );

  const renderHeader = useCallback(
    ({ safeAreaTop = 0 } = { safeAreaTop: 0 }) => (
      <HomeHeader
        safeAreaTop={safeAreaTop}
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={walletMintUrls}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
        readOnly={!hasSigner}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      hasSigner,
      setActiveMintUrl,
      viewHidden,
      walletMintUrls,
    ],
  );

  const renderStickyHeader = useCallback(
    ({ safeAreaTop = 0 } = { safeAreaTop: 0 }) => (
      <HomeHeader
        safeAreaTop={safeAreaTop}
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={[]}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
        showMintCards={false}
        readOnly={!hasSigner}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      hasSigner,
      setActiveMintUrl,
      viewHidden,
    ],
  );

  if (!authPubkey) {
    return (
      <Feed
        items={[]}
        header={renderHeader}
        headerSafeArea
        headerOwnsSafeArea
        stickyHeader={renderStickyHeader}
        renderItem={() => null}
        onChromeVisibilityChange={onChromeVisibilityChange}
        empty={<LoggedOutHome />}
        contentContainerClassName="pb-44"
      />
    );
  }

  if (!hasSigner) {
    return (
      <Feed
        items={[]}
        header={renderHeader}
        headerSafeArea
        headerOwnsSafeArea
        stickyHeader={renderStickyHeader}
        renderItem={() => null}
        onChromeVisibilityChange={onChromeVisibilityChange}
        empty={<ReadOnlyWalletStub />}
        contentContainerClassName="pb-44"
      />
    );
  }

  return (
    <Feed
      items={activities}
      getItemId={item => item.id}
      pullToRefresh
      header={renderHeader}
      headerSafeArea
      headerOwnsSafeArea
      stickyHeader={renderStickyHeader}
      renderItem={({ item, index }) => (
        <WalletActivityRow
          activity={item}
          currentPubkey={authPubkey}
          isFirst={
            getActivityDateKey(item.createdAt) !==
            getActivityDateKey(activities[index - 1]?.createdAt)
          }
          isLast={
            getActivityDateKey(item.createdAt) !==
            getActivityDateKey(activities[index + 1]?.createdAt)
          }
        />
      )}
      loading={loading && activities.length === 0}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      onChromeVisibilityChange={onChromeVisibilityChange}
      empty={<EmptyWalletStub />}
      contentContainerClassName="pb-44"
    />
  );
}

function HomeHeader({
  compact = false,
  safeAreaTop = 0,
  viewHidden,
  pubkey,
  mintUrls,
  activeMintUrl,
  balanceByMint,
  onSelectMint,
  onToggleView,
  showMintCards = true,
  readOnly = false,
}: {
  compact?: boolean;
  safeAreaTop?: number;
  viewHidden: boolean;
  pubkey: string | null;
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
  onToggleView: () => void;
  showMintCards?: boolean;
  readOnly?: boolean;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;

  return (
    <View
      className={`${
        compact ? 'border-b border-base-200 bg-base-100/95' : 'bg-base-100'
      }`}
      style={compact && safeAreaTop > 0 ? {paddingTop: safeAreaTop} : undefined}
    >
      <View
        className={`${
          compact ? '' : 'rounded-lg bg-base-300/90 px-3 py-3 shadow-sm'
        }`}
        style={!compact && safeAreaTop > 0 ? {paddingTop: safeAreaTop + 12} : undefined}
      >
        <View className="h-14 flex-row items-center justify-between">
          <Text className="text-2xl font-semibold text-base-content">Home</Text>
          <View className="flex-row items-center gap-2">
            <HeaderIconButton onPress={onToggleView}>
              {viewHidden ? (
                <EyeOff size={19} color={iconColor} strokeWidth={2.2} />
              ) : (
                <Eye size={19} color={iconColor} strokeWidth={2.2} />
              )}
            </HeaderIconButton>
            <HeaderIconButton
              onPress={() => navigation.navigate('Scan', { mode: 'share' })}
            >
              <QrCode size={19} color={iconColor} strokeWidth={2.2} />
            </HeaderIconButton>
            <HeaderProfileButton pubkey={pubkey} />
          </View>
        </View>
        {!compact && pubkey ? (
          <WalletHeaderSection
            mintUrls={mintUrls}
            activeMintUrl={activeMintUrl}
            balanceByMint={balanceByMint}
            onSelectMint={onSelectMint}
            showMintCards={showMintCards}
            readOnly={readOnly}
          />
        ) : null}
      </View>
    </View>
  );
}

function WalletHeaderSection({
  mintUrls,
  activeMintUrl,
  balanceByMint,
  onSelectMint,
  showMintCards = true,
  readOnly = false,
}: {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
  showMintCards?: boolean;
  readOnly?: boolean;
}) {
  const theme = useAppTheme();

  if (readOnly) {
    return (
      <View className="mt-3 rounded-lg border border-base-200 bg-base-100 px-4 py-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-base-content">
              Wallet unavailable
            </Text>
            <Text className="mt-1 text-sm text-primary-content">
              Wallet features are not available in read-only mode.
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-base-200">
            <Wallet size={20} color={theme.colors.primary} strokeWidth={2.2} />
          </View>
        </View>
      </View>
    );
  }

  if (showMintCards && !mintUrls.length) {
    return (
      <View className="mt-3 rounded-lg border border-base-200 bg-base-100 px-4 py-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-base-content">
              Setup Your Wallet
            </Text>
            <Text className="mt-1 text-sm text-primary-content">
              No Cashu wallet event was found yet.
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-base-200">
            <Wallet size={20} color={theme.colors.primary} strokeWidth={2.2} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="mt-1">
      {showMintCards ? (
        <View className="pt-3">
          <MintCardPicker
            mintUrls={mintUrls}
            activeMintUrl={activeMintUrl}
            balanceByMint={balanceByMint}
            onSelectMint={onSelectMint}
          />
        </View>
      ) : null}
      <WalletActions className={showMintCards ? 'mt-4' : undefined} />
    </View>
  );
}

function WalletActions({ className = '' }: { className?: string }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useAppTheme();

  return (
    <View className={`${className} flex-row items-start gap-5 px-2`}>
      <WalletAction
        icon={<Plus size={32} color="#ffffff" strokeWidth={1.9} />}
        label="Receive"
        onPress={() => navigation.navigate('Receive')}
      />
      <WalletAction
        icon={<ArrowRight size={32} color="#ffffff" strokeWidth={1.9} />}
        label="Send"
        onPress={() => navigation.navigate('Send')}
      />
      <WalletAction
        outlined
        icon={<ScanLine size={30} color={theme.colors.primary} strokeWidth={1.9} />}
        label="Scan"
        onPress={() => navigation.navigate('Scan', { mode: 'scan' })}
      />
    </View>
  );
}

function WalletAction({
  icon,
  label,
  outlined = false,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  outlined?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      className="items-center"
      disabled={!onPress}
      hitSlop={8}
      onPress={onPress}
    >
      <View
        className={`h-14 w-14 items-center justify-center rounded-full ${
          outlined ? 'border-2 border-primary bg-transparent' : 'bg-primary'
        }`}
      >
        {icon}
      </View>
      <Text className="mt-1 text-sm font-bold text-primary-content">{label}</Text>
    </Pressable>
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
      className="h-9 w-9 items-center justify-center rounded-full border border-base-200 bg-base-100"
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
  isFirst,
  isLast,
}: {
  activity: WalletActivity;
  currentPubkey: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useAppTheme();
  const isSender =
    activity.sender === currentPubkey ||
    activity.event.pubkey() === currentPubkey;
  const otherPubkey = isSender
    ? activity.recipient
    : activity.sender || activity.event.pubkey();
  const kindColor = activity.kind === 9321 ? '#b7791f' : '#eab308';
  const openActivity = useCallback(() => {
    if (activity.zappedEventId) {
      navigation.navigate('Kind1Thread', {
        nevent: neventEncode({
          id: activity.zappedEventId,
          author: activity.recipient || undefined,
          kind: 1,
          relays: activity.zappedRelays,
        }),
      });
      return;
    }

    const profilePubkey =
      activity.recipient && activity.recipient !== currentPubkey
        ? activity.recipient
        : activity.sender && activity.sender !== currentPubkey
          ? activity.sender
          : activity.event.pubkey() && activity.event.pubkey() !== currentPubkey
            ? activity.event.pubkey()
            : null;

    if (profilePubkey) {
      navigation.navigate('PublicProfile', { pubkey: profilePubkey });
    }
  }, [activity, currentPubkey, navigation]);

  return (
    <Pressable
      className={[
        'relative bg-base-300/95 px-4 py-4',
        isFirst ? 'mt-1 rounded-t-lg' : '',
        isLast ? 'rounded-b-lg' : 'border-b border-base-100',
      ].join(' ')}
      onPress={openActivity}
    >
      {isFirst ? (
        <View className="absolute left-0 right-0 top-1 z-10 items-center">
          <Text className="bg-base-300/95 px-2 text-xs font-bold text-base-content/70">
            {formatActivityDate(activity.createdAt)}
          </Text>
        </View>
      ) : null}
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View>
            <Avatar
              pubkey={otherPubkey || ''}
              size="lg"
              query={!!otherPubkey}
            />
            <View
              className="absolute bottom-0 right-0 h-5 w-5 translate-x-1 items-center justify-center rounded-full border-2 border-base-100"
              style={{ backgroundColor: kindColor }}
            >
              {activity.kind === 9321 ? (
                <Wallet size={11} color="#ffffff" strokeWidth={2.4} />
              ) : (
                <Zap
                  size={11}
                  color="#ffffff"
                  fill="#ffffff"
                  strokeWidth={2.4}
                />
              )}
            </View>
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-1">
              {isSender ? (
                <>
                  <Text className="text-sm font-semibold text-base-content">
                    You zapped
                  </Text>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                </>
              ) : (
                <>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                  <Text className="text-sm font-semibold text-base-content">
                    zapped you
                  </Text>
                </>
              )}
            </View>
            {activity.comment ? (
              <Text
                className="mt-1 text-xs text-primary-content"
                numberOfLines={2}
              >
                "{activity.comment}"
              </Text>
            ) : null}
          </View>
        </View>
        <View className="shrink-0 flex-row items-center gap-1">
          <CheckCircle2 size={16} color={theme.colors.primary} strokeWidth={2.2} />
          <Text className="text-sm font-bold text-primary">
            {activity.amount} sats
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function LoggedOutHome() {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View className="px-3 py-16">
      <View className="rounded-lg border border-base-200 bg-base-300/95 px-5 py-6 shadow-sm">
        <View className="items-center">
          <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-base-200">
            <Wallet size={30} color={theme.colors.primary} strokeWidth={2.2} />
          </View>
          <Text className="text-center text-xl font-semibold text-base-content">
            Sign in to load your wallet feed
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-primary-content">
            Home shows your wallet activity once you are signed in.
          </Text>
          <AppButton
            title="Sign in"
            className="mx-auto mt-5 min-w-36 px-6"
            onPress={() => navigation.navigate('Login')}
          />
        </View>
      </View>
    </View>
  );
}

function EmptyWalletStub() {
  const theme = useAppTheme();

  return (
    <View className="rounded-lg border border-base-200 bg-base-300/95 px-5 py-6 shadow-sm">
      <View className="items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-base-200">
          <Wallet size={30} color={theme.colors.primary} strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-base-content">
          No wallet activity yet
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-primary-content">
          Cashu wallet loading is stubbed for now. Activity will appear here
          when NIP-61 or NIP-57 events are found.
        </Text>
      </View>
    </View>
  );
}

function ReadOnlyWalletStub() {
  const theme = useAppTheme();

  return (
    <View className="rounded-lg border border-base-200 bg-base-300/95 px-5 py-6 shadow-sm">
      <View className="items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-base-200">
          <Wallet size={30} color={theme.colors.primary} strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-base-content">
          Wallet unavailable
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-primary-content">
          Wallet activity is not available in read-only mode.
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
      zappedEventId: zap.eventId(),
      zappedRelays: eventRelays(event),
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
      zappedEventId: taggedEventId(event),
      zappedRelays: taggedEventRelays(event),
    };
  }

  return null;
}

function eventRelays(event: ParsedEvent) {
  if (typeof event.relaysLength !== 'function') return [];
  return Array.from({ length: event.relaysLength() }, (_, index) =>
    event.relays(index),
  ).filter((relay): relay is string => !!relay);
}

function taggedEventId(event: ParsedEvent) {
  return (
    fbArray(event, 'tags')
      .map(tag => fbArray(tag, 'items').map(item => String(item)))
      .find(tag => tag[0] === 'e' && tag[1])?.[1] || null
  );
}

function taggedEventRelays(event: ParsedEvent) {
  const tagRelay =
    fbArray(event, 'tags')
      .map(tag => fbArray(tag, 'items').map(item => String(item)))
      .find(tag => tag[0] === 'e' && tag[2])?.[2] || null;
  return [
    ...new Set(
      [tagRelay, ...eventRelays(event)].filter(
        (relay): relay is string => !!relay,
      ),
    ),
  ];
}

function toCashuProof(proof: {
  amount(): bigint;
  id(): string | Uint8Array | null;
  secret(): string | Uint8Array | null;
  c(): string | Uint8Array | null;
  dleq(): {
    e(): string | Uint8Array | null;
    r(): string | Uint8Array | null;
    s(): string | Uint8Array | null;
  } | null;
}): Proof | null {
  const id = proof.id();
  const secret = proof.secret();
  const c = proof.c();
  if (!id || !secret || !c) return null;

  const dleq = proof.dleq();
  const e = dleq?.e();
  const r = dleq?.r();
  const s = dleq?.s();

  return {
    amount: Number(proof.amount()),
    id: toText(id),
    secret: toText(secret),
    C: toText(c),
    dleq:
      e && s
        ? { e: toText(e), r: r ? toText(r) : undefined, s: toText(s) }
        : undefined,
  };
}

function toText(value: string | Uint8Array) {
  if (typeof value === 'string') return value;
  let text = '';
  for (let index = 0; index < value.length; index += 1) {
    text += String.fromCharCode(value[index]);
  }
  return text;
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function getActivityDateKey(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatActivityDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.getTime() >= today.getTime()) return 'TODAY';
  if (date.getTime() >= yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
