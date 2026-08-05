import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asEoce,
  asParsedEvent,
  fbArray,
  fbIterable,
  isValidProofs,
} from '@candypoets/nipworker/utils';
import type {Proof} from '@cashu/cashu-ts';

import {useAuthStore, useNostrStore, useWalletStore} from '../stores';
import {uniqueWalletRelays} from './useWalletSubscription';

const WALLET_RELAY_FALLBACK_DELAY_MS = 1_000;
const PROOF_BACKUP_SETTLE_DELAY_MS = 1_200;
const NUTZAP_LOOKBACK_SECONDS = 24 * 60 * 60;
const EMPTY_MINT_URLS: string[] = [];

/**
 * Loads and maintains Cashu proofs for the signed-in account at app scope.
 *
 * This must stay mounted above the router stack: balance consumers on routes
 * other than Home need both locally persisted proofs and relay recovery.
 */
export function useWalletProofSubscription({
  enabled,
  extraMintUrls = EMPTY_MINT_URLS,
}: {
  enabled: boolean;
  extraMintUrls?: string[];
}) {
  const authPubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const kind10019UpdatedAt = useNostrStore(state => state.kind10019UpdatedAt);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const initializeProofWallet = useWalletStore(
    state => state.initializeProofWallet,
  );
  const clearProofStorageOnce = useWalletStore(
    state => state.clearProofStorageOnce,
  );
  const addProofs = useWalletStore(state => state.addProofs);
  const checkAndFilterProofs = useWalletStore(
    state => state.checkAndFilterProofs,
  );
  const verifyAndCleanProofs = useWalletStore(
    state => state.verifyAndCleanProofs,
  );
  const unsubscribeProofsRef = useRef<(() => void) | null>(null);
  const unsubscribeNutzapsRef = useRef<(() => void) | null>(null);
  const handleProofsMessageRef = useRef<
    ((message: WorkerMessage) => void) | null
  >(null);
  const subscriptionSeqRef = useRef(0);
  const pendingProofEventsRef = useRef<ParsedEvent[]>([]);
  const proofEoseReceivedRef = useRef(false);
  const collectingProofBackupsRef = useRef(false);
  const resolveProofBackupsTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const [fallbackReady, setFallbackReady] = useState(false);

  const relays = useMemo(
    () => uniqueWalletRelays(readRelays, walletReadRelays),
    [readRelays, walletReadRelays],
  );
  const relaysResolved = kind10019UpdatedAt > 0 || fallbackReady;
  const mintUrls = useMemo(
    () => [...new Set([...walletMintUrls, ...extraMintUrls])],
    [extraMintUrls, walletMintUrls],
  );
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

  useEffect(() => {
    setFallbackReady(false);
    if (!enabled || !authPubkey || kind10019UpdatedAt > 0) return;

    const timeout = setTimeout(
      () => setFallbackReady(true),
      WALLET_RELAY_FALLBACK_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [authPubkey, enabled, kind10019UpdatedAt]);

  const subscribeToNutzapsSince = useCallback(
    (since: number) => {
      if (!authPubkey || !relays.length) return;
      unsubscribeNutzapsRef.current?.();
      unsubscribeNutzapsRef.current = subscribeToNostr(
        `app_nutzap_events_${authPubkey}_${since}`,
        [
          {
            kinds: [9321],
            tags: {'#p': [authPubkey]},
            since,
            limit: 50,
            relays,
          },
        ],
        message => handleProofsMessageRef.current?.(message),
        {
          isSlow: true,
          pipeline: proofPipeline,
        },
      );
    },
    [authPubkey, proofPipeline, relays],
  );

  const finishProofBackupScan = useCallback(() => {
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }
    if (!collectingProofBackupsRef.current) return;
    collectingProofBackupsRef.current = false;
    verifyAndCleanProofs()
      .then(() =>
        subscribeToNutzapsSince(
          Math.floor(Date.now() / 1000) - NUTZAP_LOOKBACK_SECONDS,
        ),
      )
      .catch(error => {
        console.warn('[wallet-proofs] failed to finalize proof recovery', error);
      });
  }, [subscribeToNutzapsSince, verifyAndCleanProofs]);

  const scheduleResolveProofBackups = useCallback(() => {
    if (!collectingProofBackupsRef.current) return;
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
    }
    resolveProofBackupsTimeoutRef.current = setTimeout(
      finishProofBackupScan,
      PROOF_BACKUP_SETTLE_DELAY_MS,
    );
  }, [finishProofBackupScan]);

  const handleProofsMessage = useCallback(
    async (message: WorkerMessage) => {
      if (asEoce(message)) {
        verifyAndCleanProofs().catch(() => {});
        scheduleResolveProofBackups();
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        if (
          status.status()?.toString() === 'EOSE' &&
          !proofEoseReceivedRef.current
        ) {
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
        if (checkedProofs.length) {
          addProofs(mint, checkedProofs).catch(() => {});
        }
      }
      if (pendingProofEventsRef.current.length) {
        pendingProofEventsRef.current.shift();
      }
      if (sourceKind === 7375) scheduleResolveProofBackups();
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

  useEffect(() => {
    const sequence = subscriptionSeqRef.current + 1;
    subscriptionSeqRef.current = sequence;
    unsubscribeProofsRef.current?.();
    unsubscribeNutzapsRef.current?.();
    unsubscribeProofsRef.current = null;
    unsubscribeNutzapsRef.current = null;
    pendingProofEventsRef.current = [];
    proofEoseReceivedRef.current = false;
    collectingProofBackupsRef.current = false;
    if (resolveProofBackupsTimeoutRef.current) {
      clearTimeout(resolveProofBackupsTimeoutRef.current);
      resolveProofBackupsTimeoutRef.current = null;
    }

    if (!enabled || !authPubkey) return;

    // Local proofs are loaded immediately. Relay discovery only gates the
    // remote recovery subscription below.
    const initialize = async () => {
      await clearProofStorageOnce(authPubkey);
      if (subscriptionSeqRef.current !== sequence) return;
      await initializeProofWallet(authPubkey, mintUrls);
      if (subscriptionSeqRef.current !== sequence) return;
      await verifyAndCleanProofs();
      if (
        subscriptionSeqRef.current !== sequence ||
        !relaysResolved ||
        !relays.length
      ) {
        return;
      }
      collectingProofBackupsRef.current = true;
      const requests: RequestObject[] = [
        {
          kinds: [7375],
          authors: [authPubkey],
          limit: 20,
          relays,
        },
      ];
      unsubscribeProofsRef.current = subscribeToNostr(
        `app_wallet_proofs_${authPubkey}`,
        requests,
        handleProofsMessage,
        {
          isSlow: true,
          pipeline: proofPipeline,
        },
      );
    };
    initialize().catch(error => {
      console.warn('[wallet-proofs] failed to initialize wallet', error);
    });

    return () => {
      subscriptionSeqRef.current += 1;
      unsubscribeProofsRef.current?.();
      unsubscribeNutzapsRef.current?.();
      unsubscribeProofsRef.current = null;
      unsubscribeNutzapsRef.current = null;
      collectingProofBackupsRef.current = false;
      if (resolveProofBackupsTimeoutRef.current) {
        clearTimeout(resolveProofBackupsTimeoutRef.current);
        resolveProofBackupsTimeoutRef.current = null;
      }
    };
  }, [
    authPubkey,
    clearProofStorageOnce,
    enabled,
    handleProofsMessage,
    initializeProofWallet,
    mintUrls,
    proofPipeline,
    relays,
    relaysResolved,
    verifyAndCleanProofs,
  ]);
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
        ? {e: toText(e), r: r ? toText(r) : undefined, s: toText(s)}
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
