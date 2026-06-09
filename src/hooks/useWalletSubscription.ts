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
const latestWalletEventCreatedAtByPubkey = new Map<string, number>();

function walletDebug(label: string, data?: Record<string, unknown>) {
  console.log(`[home-wallet] ${label}`, data ?? {});
}

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
    walletDebug('status', {
      relay: relayUrl ? normalizeRelayUrl(relayUrl) : null,
      status: relayStatus ?? null,
      message: status.message?.(),
    });
    if (relayUrl && relayStatus) {
      useRelayStore.getState().setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
    }
    return;
  }

  const parsed = asParsedEvent(message);
  if (!parsed || parsed.kind() !== 17375) return;
  walletDebug('event', {
    id: parsed.id()?.slice(0, 12),
    kind: parsed.kind(),
    pubkey: parsed.pubkey()?.slice(0, 12),
    createdAt: parsed.createdAt(),
    parsedType:
      typeof parsed.parsedType === 'function' ? parsed.parsedType() : 'unknown',
  });
  const wallet = asKind17375(parsed);
  walletDebug('kind17375 parse', {
    ok: !!wallet,
    mints: wallet ? wallet.mintsLength() : 0,
    hasPrivateKey: !!wallet?.p2pkPrivKey?.(),
    hasPublicKey: !!wallet?.p2pkPubKey?.(),
  });
  if (!wallet) return;

  const pubkey = parsed.pubkey() || '';
  const createdAt = parsed.createdAt();
  const latestCreatedAt = latestWalletEventCreatedAtByPubkey.get(pubkey) ?? 0;
  if (createdAt < latestCreatedAt) {
    walletDebug('ignored older kind17375', {
      id: parsed.id()?.slice(0, 12),
      pubkey: pubkey.slice(0, 12),
      createdAt,
      latestCreatedAt,
    });
    return;
  }
  latestWalletEventCreatedAtByPubkey.set(pubkey, createdAt);

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
    if (!enabled || !pubkey || kind10019UpdatedAt > 0) {
      walletDebug('fallback skip', {
        enabled,
        hasPubkey: !!pubkey,
        kind10019UpdatedAt,
      });
      return;
    }
    walletDebug('fallback timer start', {
      pubkey: pubkey.slice(0, 12),
      delayMs: 1000,
    });
    const timeout = setTimeout(() => {
      walletDebug('fallback ready', {
        pubkey: pubkey.slice(0, 12),
      });
      setFallbackReady(true);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [enabled, kind10019UpdatedAt, pubkey]);

  useEffect(() => {
    walletDebug('state', {
      enabled,
      pubkey: pubkey?.slice(0, 12) ?? null,
      kind10019UpdatedAt,
      fallbackReady,
      relaysResolved,
      relays,
    });
  }, [enabled, fallbackReady, kind10019UpdatedAt, pubkey, relays, relaysResolved]);

  const subscribe = useCallback(() => {
    if (!enabled || !pubkey || !relaysResolved || !relays.length) {
      walletDebug('subscribe skipped', {
        enabled,
        hasPubkey: !!pubkey,
        relaysResolved,
        relays,
      });
      return undefined;
    }
    const subId = walletSubscriptionId(pubkey, relays, cacheKey);
    walletDebug('subscribe', {
      subId,
      pubkey: pubkey.slice(0, 12),
      cacheKey,
      noCache: !!cacheKey,
      relays,
    });
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
    pubkey,
    relays,
    relaysResolved,
  ]);

  useEffect(() => subscribe(), [subscribe]);

  return {relays, relaysResolved, subscribe};
}
