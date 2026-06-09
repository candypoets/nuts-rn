import {useCallback, useEffect, useMemo, useState} from 'react';
import type {WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind17375,
  asParsedEvent,
} from '@candypoets/nipworker/utils';

import {
  useAuthStore,
  useNostrStore,
  useRelayStore,
  useWalletStore,
} from '../stores';

const WALLET_FALLBACK_RELAYS = ['wss://relay.nuts.cash'];

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash.toString(36);
}

export function walletSubscriptionId(
  pubkey: string,
  relays: string[],
  cacheKey = 0,
) {
  return `active_wallet_${pubkey}_${cacheKey}_${hashKey(relays.join(','))}`;
}

export function uniqueWalletRelays(readRelays: string[], walletReadRelays: string[]) {
  return [
    ...new Set(
      [...readRelays, ...walletReadRelays, ...WALLET_FALLBACK_RELAYS].map(normalizeRelayUrl),
    ),
  ].filter(Boolean);
}

export function handleWalletSubscriptionMessage(message: WorkerMessage) {
  const status = asConnectionStatus(message);
  if (status) {
    const relayUrl = status.relayUrl();
    const relayStatus = status.status()?.toString();
    if (relayUrl && relayStatus) {
      useRelayStore.getState().setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
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
  const privateKey = wallet.p2pkPrivKey?.() || null;
  const publicKey = wallet.p2pkPubKey?.() || null;

  const walletStore = useWalletStore.getState();
  walletStore.setWalletKeys({
    privateKey,
    publicKey,
  });

  const normalizedMintUrls = mintUrls.map(normalizeMintUrl);
  const currentMintUrls = walletStore.walletMintUrls.map(normalizeMintUrl);
  if (!sameStringArray(currentMintUrls, normalizedMintUrls)) {
    walletStore.setWalletMintUrls(mintUrls);
  }

  const nextActiveMintUrl =
    walletStore.activeMintUrl &&
    normalizedMintUrls.includes(normalizeMintUrl(walletStore.activeMintUrl))
      ? walletStore.activeMintUrl
      : mintUrls[0] ?? null;
  if (nextActiveMintUrl !== walletStore.activeMintUrl) {
    walletStore.setActiveMintUrl(nextActiveMintUrl);
  }
}

export function useWalletSubscription({
  enabled,
  cacheKey = 0,
}: {
  enabled: boolean;
  cacheKey?: number;
}) {
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const kind10019UpdatedAt = useNostrStore(state => state.kind10019UpdatedAt);
  const [fallbackReady, setFallbackReady] = useState(false);
  const relays = useMemo(
    () => uniqueWalletRelays(readRelays, walletReadRelays),
    [readRelays, walletReadRelays],
  );
  const relaysResolved = kind10019UpdatedAt > 0 || fallbackReady;

  useEffect(() => {
    setFallbackReady(false);
    if (!enabled || !pubkey || kind10019UpdatedAt > 0) return;
    const timeout = setTimeout(() => setFallbackReady(true), 1000);
    return () => clearTimeout(timeout);
  }, [enabled, kind10019UpdatedAt, pubkey]);

  const subscribe = useCallback(() => {
    if (!enabled || !pubkey || !relaysResolved || !relays.length) return undefined;
    const subId = walletSubscriptionId(pubkey, relays, cacheKey);
    return subscribeToNostr(
      subId,
      [
        {
          kinds: [17375],
          authors: [pubkey],
          limit: 10,
          noCache: !!cacheKey,
          relays,
        },
      ],
      handleWalletSubscriptionMessage,
      {bytesPerEvent: 6144},
    );
  }, [
    cacheKey,
    enabled,
    fallbackReady,
    kind10019UpdatedAt,
    pubkey,
    readRelays,
    relays,
    relaysResolved,
    walletReadRelays,
  ]);

  useEffect(() => subscribe(), [subscribe]);

  return {relays, relaysResolved, subscribe};
}
