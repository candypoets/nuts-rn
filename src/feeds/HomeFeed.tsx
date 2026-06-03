import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
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
  asKind17375,
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
  CheckCircle2,
  CirclePlus,
  Eye,
  EyeOff,
  QrCode,
  Search,
  ScanLine,
  Send,
  Wallet,
  Zap,
} from 'lucide-react-native';
import { Feed } from '../components/Feed';
import { NotificationBellButton } from '../components/NotificationBellButton';
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
import { RelaysList as HeaderRelaysList } from '../components/RelaysList';
import type { RootStackParamList } from '../navigation/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedImage = Animated.createAnimatedComponent(Image);

type HomeFeedProps = {
  enabled: boolean;
  visible: boolean;
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

type MintInfo = {
  name: string;
  url: string;
  iconUrl?: string;
  state?: string;
  n_errors?: number;
  n_mints?: number;
  n_melts?: number;
};

type MintInfoResponse = {
  name?: string;
  icon_url?: string;
};

type MintAuditResponse = {
  state?: string;
  n_errors?: number;
  n_mints?: number;
  n_melts?: number;
};

export function HomeFeed({ enabled, visible }: HomeFeedProps) {
  const itemsRef = useRef<ParsedEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribeWalletRef = useRef<(() => void) | null>(null);
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
  const [proofDebug, setProofDebug] = useState({
    validProofMessages: 0,
    proofCount: 0,
    backupEvents: 0,
    nutzapEvents: 0,
  });
  const authPubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const kind10019UpdatedAt = useNostrStore(state => state.kind10019UpdatedAt);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const activeMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
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
    return [...new Set([...readRelays, ...walletReadRelays])];
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
  }, [
    authPubkey,
    completeResolvingSubscription,
    enabled,
    handleMessage,
    homeRelays,
    requestList,
    setRelayStatus,
    visible,
  ]);

  const handleWalletMessage = useCallback(
    async (message: WorkerMessage) => {
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
        { length: wallet.mintsLength() },
        (_, index) => wallet.mints(index),
      ).filter((mint): mint is string => !!mint);

      const currentWallet = useWalletStore.getState();
      const normalizedMintUrls = mintUrls.map(normalizeMintUrl);
      const currentMintUrls = currentWallet.walletMintUrls.map(normalizeMintUrl);
      if (!sameStringArray(currentMintUrls, normalizedMintUrls)) {
        setWalletMintUrls(mintUrls);
      }

      const nextActiveMintUrl =
        currentWallet.activeMintUrl &&
        normalizedMintUrls.includes(normalizeMintUrl(currentWallet.activeMintUrl))
          ? currentWallet.activeMintUrl
          : mintUrls[0] ?? null;
      if (nextActiveMintUrl !== currentWallet.activeMintUrl) {
        setActiveMintUrl(nextActiveMintUrl);
      }
    },
    [
      setActiveMintUrl,
      setRelayStatus,
      setWalletMintUrls,
    ],
  );

  const subscribeToNutzapsSince = useCallback(
    (since: number) => {
      if (!authPubkey || !walletProofRelays.length) return;
      proofSinceRef.current = since;
      unsubscribeNutzapsRef.current?.();
      console.log('[home-wallet] proof fetch relays', {
        phase: 'nutzaps',
        subId: `nutszap_events_${authPubkey}_${requestCacheRef.current}_${since}`,
        since,
        relays: walletProofRelays,
        source: 'readRelays+walletReadRelays',
        walletReadRelays,
        readRelays,
      });
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
      console.log('[home-wallet] querying nutzaps after proof backups', {
        since,
      });
    },
    [
      authPubkey,
      proofPipeline,
      walletReadRelays,
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
      .then(() => {
        console.log('[home-wallet] finished proof backup scan');
        subscribeToNutzapsSince(Math.floor(Date.now() / 1000) - 24 * 60 * 60);
      })
      .catch(error => {
        console.error('[home-wallet] proof backup finish failed', error);
      });
  }, [
    subscribeToNutzapsSince,
    verifyAndCleanProofs,
  ]);

  const scheduleResolveProofBackups = useCallback(
    (reason: string) => {
      if (!collectingProofBackupsRef.current) return;
      if (resolveProofBackupsTimeoutRef.current) {
        clearTimeout(resolveProofBackupsTimeoutRef.current);
      }
      resolveProofBackupsTimeoutRef.current = setTimeout(() => {
        console.log('[home-wallet] finishing proof backup scan', {
          reason,
        });
        finishProofBackupScan();
      }, 1200);
    },
    [finishProofBackupScan],
  );

  const handleProofsMessage = useCallback(
    async (message: WorkerMessage) => {
      if (asEoce(message)) {
        verifyAndCleanProofs().catch(error => {
          console.error('[home-wallet] proof verification failed', error);
        });
        scheduleResolveProofBackups('eoce');
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        if (status.status()?.toString() === 'EOSE' && !proofEoseReceivedRef.current) {
          proofEoseReceivedRef.current = true;
          verifyAndCleanProofs().catch(error => {
            console.error('[home-wallet] proof verification failed', error);
          });
          scheduleResolveProofBackups('eose');
        }
        return;
      }

      const validProofs = isValidProofs(message);
      if (!validProofs) {
        const parsed = asParsedEvent(message);
        if (parsed && (parsed.kind() === 7375 || parsed.kind() === 9321)) {
          pendingProofEventsRef.current.push(parsed);
          console.log('[home-wallet] proof event forwarded', {
            id: parsed.id(),
            kind: parsed.kind(),
            createdAt: parsed.createdAt(),
            relays: fbArray(parsed, 'relays'),
          });
        }
        return;
      }

      const sourceEvent = pendingProofEventsRef.current[0];
      const sourceKind =
        sourceEvent?.kind() ??
        (collectingProofBackupsRef.current ? 7375 : undefined);
      let rawProofCount = 0;
      let messageProofCount = 0;
      for (const mintProofs of fbIterable(validProofs, 'proofs')) {
        const mint = mintProofs.mint();
        if (!mint) continue;
        const proofs = fbArray(mintProofs, 'proofs')
          .map(toCashuProof)
          .filter((proof): proof is Proof => !!proof);
        rawProofCount += proofs.length;
        const checkedProofs =
          proofEoseReceivedRef.current && !collectingProofBackupsRef.current
            ? await checkAndFilterProofs(mint, proofs)
            : proofs;
        messageProofCount += checkedProofs.length;
        if (checkedProofs.length) {
          addProofs(mint, checkedProofs).catch(error => {
            console.error('[home-wallet] proof ingest failed', error);
          });
        }
      }
      console.log('[home-wallet] valid proofs message', {
        sourceKind,
        rawProofs: rawProofCount,
        keptProofs: messageProofCount,
      });
      if (pendingProofEventsRef.current.length) {
        pendingProofEventsRef.current.shift();
      }
      if (sourceKind === 7375) {
        scheduleResolveProofBackups('valid-proof-backup');
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

  const initWallet = useCallback(() => {
    if (!enabled || !visible || !authPubkey) return;
    if (!walletRelaysResolved) return;
    if (!walletProofRelays.length) return;
    const subId = `active_wallet_${authPubkey}_${
      requestCacheRef.current
    }_${hashKey(walletProofRelays.join(','))}`;
    unsubscribeWalletRef.current?.();
    unsubscribeWalletRef.current = subscribeToNostr(
      subId,
      [
        {
          kinds: [17375],
          authors: [authPubkey],
          limit: 10,
          noCache: !!requestCacheRef.current,
          relays: walletProofRelays,
        },
      ],
      handleWalletMessage,
      { bytesPerEvent: 6144 },
    );
  }, [
    authPubkey,
    enabled,
    handleWalletMessage,
    visible,
    walletProofRelays,
    walletRelaysResolved,
  ]);

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
    console.log('[home-wallet] proof fetch relays', {
      phase: 'backups',
      subId,
      relays: walletProofRelays,
      source: 'readRelays+walletReadRelays',
      walletReadRelays,
      readRelays,
    });
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
      .catch(error => {
        console.error('[home-wallet] proof wallet init failed', error);
      });
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
    walletReadRelays,
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
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    unsubscribeWalletRef.current?.();
    unsubscribeWalletRef.current = null;
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
      // Temporarily disabled while investigating iOS crashes around wallet/kind0 resolution.
      initWallet();
      initProofs();
      initFeed();
    }

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      unsubscribeWalletRef.current?.();
      unsubscribeWalletRef.current = null;
      unsubscribeProofsRef.current?.();
      unsubscribeProofsRef.current = null;
      proofSubscriptionSeqRef.current += 1;
      pendingItemsRef.current = [];
      connectionTracker.reset();
      subscriptionResolvingRef.current = false;
      eoceReceivedRef.current = false;
      clearRefreshTimeout();
    };
  }, [
    authPubkey,
    clearRefreshTimeout,
    enabled,
    initFeed,
    initProofs,
    initWallet,
    visible,
  ]);

  const handleRefresh = useCallback(() => {
    if (!authPubkey || refreshing) return;
    requestCacheRef.current += 1;
    setRefreshing(true);
    // Temporarily disabled while investigating iOS crashes around wallet/kind0 resolution.
    initWallet();
    initProofs();
    initFeed();
  }, [authPubkey, initFeed, initProofs, initWallet, refreshing]);

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
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={walletMintUrls}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      homeRelays,
      relayStatuses,
      setActiveMintUrl,
      viewHidden,
      walletMintUrls,
    ],
  );

  const renderStickyHeader = useCallback(
    () => (
      <HomeHeader
        relays={homeRelays}
        relayStatuses={relayStatuses}
        viewHidden={viewHidden}
        pubkey={authPubkey}
        mintUrls={[]}
        activeMintUrl={activeMintUrl}
        balanceByMint={balanceByMint}
        onSelectMint={setActiveMintUrl}
        onToggleView={() => setViewHidden(value => !value)}
        showMintCards={false}
      />
    ),
    [
      authPubkey,
      activeMintUrl,
      balanceByMint,
      homeRelays,
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
        stickyHeaderSafeAreaColor="rgba(248, 250, 252, 0.95)"
        renderItem={() => null}
        empty={<LoggedOutHome />}
        contentContainerClassName="pb-28"
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
      stickyHeaderSafeAreaColor="rgba(248, 250, 252, 0.95)"
      renderItem={({ item }) => (
        <WalletActivityRow activity={item} currentPubkey={authPubkey} />
      )}
      loading={loading && activities.length === 0}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      empty={<EmptyWalletStub />}
      contentContainerClassName="pb-28"
    />
  );
}

function HomeHeader({
  compact = false,
  relays,
  relayStatuses,
  viewHidden,
  pubkey,
  mintUrls,
  activeMintUrl,
  balanceByMint,
  onSelectMint,
  onToggleView,
  showMintCards = true,
}: {
  compact?: boolean;
  relays: string[];
  relayStatuses: Record<string, string>;
  viewHidden: boolean;
  pubkey: string | null;
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
  onToggleView: () => void;
  showMintCards?: boolean;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const iconColor = "#17212b";

  return (
    <View
      className={`${
        compact ? 'border-b border-slate-200 bg-slate-50/95' : 'bg-slate-50'
      }`}
    >
      <View
        className={`${
          compact ? '' : 'rounded-lg bg-white/90 px-3 py-3 shadow-sm'
        }`}
      >
        <View className="h-14 flex-row items-center justify-between">
          <Text className="text-2xl font-semibold text-slate-900">Home</Text>
          <View className="flex-row items-center gap-2">
            <HeaderIconButton onPress={() => navigation.navigate('CmdK')}>
              <Search size={19} color={iconColor} strokeWidth={2.2} />
            </HeaderIconButton>
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
            <NotificationBellButton />
            <HeaderProfileButton pubkey={pubkey} />
          </View>
        </View>
        <HeaderRelaysList
          relays={relays}
          statuses={relayStatuses}
          mini={compact}
        />
        {!compact && pubkey ? (
          <WalletHeaderSection
            mintUrls={mintUrls}
            activeMintUrl={activeMintUrl}
            balanceByMint={balanceByMint}
            onSelectMint={onSelectMint}
            showMintCards={showMintCards}
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
}: {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  onSelectMint: (mintUrl: string | null) => void;
  showMintCards?: boolean;
}) {
    if (showMintCards && !mintUrls.length) {
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
          <View className="h-10 w-10 items-center justify-center rounded-full bg-slate-200">
            <Wallet size={20} color={"#1f7a5a"} strokeWidth={2.2} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="mt-1">
      {showMintCards ? (
        <MintCardPicker
          mintUrls={mintUrls}
          activeMintUrl={activeMintUrl}
          balanceByMint={balanceByMint}
          onSelectMint={onSelectMint}
        />
      ) : null}
      <WalletActions className={showMintCards ? 'mt-4' : undefined} />
    </View>
  );
}

function WalletActions({ className = '' }: { className?: string }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View className={`${className} flex-row items-start gap-5 px-2`}>
      <WalletAction
        icon={<CirclePlus size={25} color="#ffffff" strokeWidth={2.3} />}
        label="Receive"
        onPress={() => navigation.navigate('Receive')}
      />
      <WalletAction
        icon={<Send size={25} color="#ffffff" strokeWidth={2.3} />}
        label="Send"
        onPress={() => navigation.navigate('Send')}
      />
      <WalletAction
        outlined
        icon={<ScanLine size={25} color={"#1f7a5a"} strokeWidth={2.3} />}
        label="Scan"
        onPress={() => navigation.navigate('Scan', { mode: 'scan' })}
      />
    </View>
  );
}

export function MintCardPicker({
  mintUrls,
  activeMintUrl,
  balanceByMint,
  amount,
  onChangeAmount,
  stripOnly = false,
  onSelectMint,
}: {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  amount?: string;
  onChangeAmount?: (amount: string) => void;
  stripOnly?: boolean;
  onSelectMint: (mintUrl: string | null) => void;
}) {
  const activeMint =
    activeMintUrl && mintUrls.includes(activeMintUrl)
      ? activeMintUrl
      : mintUrls[0];
  const activeBalance = activeMint ? balanceByMint[activeMint] ?? 0 : 0;

  if (!activeMint) return null;

  if (stripOnly) {
    return (
      <View className="h-[92px]">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-3 h-[92px]"
          contentContainerStyle={styles.mintStripContent}
        >
          {mintUrls.map(mintUrl => (
            <MintSquare
              key={mintUrl}
              mintUrl={mintUrl}
              selected={mintUrl === activeMint}
              onPress={() => onSelectMint(mintUrl)}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-3 -mb-8 h-[82px] z-10"
        contentContainerStyle={styles.mintStripContent}
      >
        {mintUrls.map(mintUrl => (
          <MintSquare
            key={mintUrl}
            mintUrl={mintUrl}
            balance={onChangeAmount ? undefined : balanceByMint[mintUrl] ?? 0}
            selected={mintUrl === activeMint}
            onPress={() => onSelectMint(mintUrl)}
          />
        ))}
      </ScrollView>
      <Pressable
        className="rounded-2xl border border-slate-100 bg-white/55 px-5 pb-5 pt-10"
        onPress={() => onSelectMint(activeMint)}
      >
        {onChangeAmount ? (
          <>
            <Text className="text-sm font-semibold uppercase text-slate-500">
              amount
            </Text>
            <View className="mt-1 flex-row items-end">
              <TextInput
                keyboardType="number-pad"
                className="min-h-16 flex-1 font-mono text-5xl font-semibold text-slate-900"
                value={amount}
                onChangeText={onChangeAmount}
                placeholder="0"
                placeholderTextColor="#cbd5e1"
              />
              <Text className="pb-3 text-base font-bold text-slate-500">sats</Text>
            </View>
          </>
        ) : (
          <>
            <Text className="text-sm font-semibold uppercase text-slate-500">
              current balance
            </Text>
            <Text className="mt-1 font-mono text-3xl font-semibold text-slate-900">
              {activeBalance} <Text className="text-2xl font-bold">丰</Text>
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function MintSquare({
  mintUrl,
  balance,
  selected,
  onPress,
}: {
  mintUrl: string;
  balance?: number;
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
    fetchMintData(mintUrl).then(nextMint => {
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
  const initial = (mint.name || displayMintName(mintUrl))
    .trim()
    .charAt(0)
    .toUpperCase();
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
      {typeof balance === 'number' ? (
        <Text className="absolute bottom-1.5 text-[10px] font-bold text-slate-700">
          {balance}
        </Text>
      ) : null}
    </AnimatedPressable>
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
          outlined ? 'border border-emerald-700 bg-white' : 'bg-emerald-700'
        }`}
      >
        {icon}
      </View>
      <Text className="mt-1 text-sm font-semibold text-slate-500">{label}</Text>
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
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
      className="mt-1 rounded-lg border border-slate-200 bg-white/95 px-4 py-4 shadow-sm"
      onPress={openActivity}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View>
            <Avatar
              pubkey={otherPubkey || ''}
              size="lg"
              query={!!otherPubkey}
            />
            <View
              className="absolute bottom-0 right-0 h-5 w-5 translate-x-1 items-center justify-center rounded-full border-2 border-white"
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
                  <Text className="text-sm font-semibold text-slate-900">
                    You zapped
                  </Text>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                </>
              ) : (
                <>
                  {otherPubkey ? <User pubkey={otherPubkey} /> : null}
                  <Text className="text-sm font-semibold text-slate-900">
                    zapped you
                  </Text>
                </>
              )}
            </View>
            <Text className="mt-1 text-xs text-slate-500">
              {formatActivityDate(activity.createdAt)} · NIP-
              {activity.kind === 9321 ? '61' : '57'}
            </Text>
          </View>
        </View>
        <View className="shrink-0 flex-row items-center gap-1">
          <CheckCircle2 size={16} color={"#1f7a5a"} strokeWidth={2.2} />
          <Text className="text-sm font-bold text-emerald-700">
            {activity.amount} sats
          </Text>
        </View>
      </View>
      {activity.comment ? (
        <Text className="ml-13 mt-3 text-sm text-slate-500">
          "{activity.comment}"
        </Text>
      ) : null}
    </Pressable>
  );
}

function LoggedOutHome() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View className="rounded-lg border border-slate-200 bg-white/95 px-5 py-6 shadow-sm">
      <View className="items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-slate-200">
          <Wallet size={30} color={"#1f7a5a"} strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-slate-900">
          Sign in to load your wallet feed
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
          Home shows your NIP-61 NutsZap and NIP-57 zap activity once a Nostr
          key is available.
        </Text>
        <Pressable
          className="mt-5 rounded-full bg-emerald-700 px-5 py-3"
          onPress={() => navigation.navigate('Login')}
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
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-slate-200">
          <Wallet size={30} color={"#1f7a5a"} strokeWidth={2.2} />
        </View>
        <Text className="text-center text-xl font-semibold text-slate-900">
          No wallet activity yet
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
          Cashu wallet loading is stubbed for now. Activity will appear here
          when NIP-61 or NIP-57 events are found.
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

const styles = StyleSheet.create({
  mintStripContent: {
    alignItems: 'flex-end',
    gap: 10,
    minHeight: 82,
    paddingHorizontal: 12,
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

const mintInfoCache = new Map<string, MintInfo>();

async function fetchMintData(mintUrl: string): Promise<MintInfo> {
  const normalizedUrl = normalizeMintUrl(mintUrl);
  const cached = mintInfoCache.get(normalizedUrl);
  if (cached) return cached;

  try {
    const [info, audit] = await Promise.all([
      fetch(`${normalizedUrl}/v1/info`)
        .then(response => {
          if (!response.ok) throw new Error('Mint info request failed');
          return response.json() as Promise<MintInfoResponse>;
        })
        .catch(() => null),
      fetch(
        `https://api.audit.8333.space/mints/url/?url=${encodeURIComponent(
          normalizedUrl,
        )}`,
      )
        .then(response =>
          response.ok ? (response.json() as Promise<MintAuditResponse>) : null,
        )
        .catch(() => null),
    ]);

    if (!info) throw new Error('Mint info request failed');

    const mint = {
      name: info.name || displayMintName(normalizedUrl),
      url: normalizedUrl,
      iconUrl: info.icon_url,
      state: audit?.state || 'OK',
      n_errors: audit?.n_errors,
      n_mints: audit?.n_mints,
      n_melts: audit?.n_melts,
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

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function displayMintName(url: string) {
  return normalizeMintUrl(url)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
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
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
