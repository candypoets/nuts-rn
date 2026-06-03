import AsyncStorage from '@react-native-async-storage/async-storage';
import type {WorkerMessage} from '@candypoets/nipworker';
import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import type {MeltQuoteResponse, MintQuoteResponse, Proof} from '@cashu/cashu-ts';
import type {EventTemplate} from 'nostr-tools';

import {useWalletStore} from '../../stores';

export type TxType = 'nutszap' | 'nutszap-melt' | 'zap' | 'melt';

export type TxState = {
  txId: string;
  type: TxType;
  status: 'pending' | 'completed' | 'failed' | 'pending_publish';
  params: {
    fromMint: string;
    toMint?: string;
    pubkey: string;
    amount: number;
    memo?: string;
    noteId?: string;
    lnurl?: string;
    p2pkPubkey?: string;
    receiptRelays?: string[];
  };
  proofs: Proof[];
  meltQuote?: MeltQuoteResponse & {mintUrl: string};
  mintQuote?: MintQuoteResponse & {mintUrl: string};
  nutzapEvent?: EventTemplate;
  published: boolean;
  publishAttempts: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const TX_INDEX_KEY = 'cashu_tx_index_v1';
const TX_KEY_PREFIX = 'cashu_tx_v1_';
const PENDING_BACKUP_KEY = 'cashu_pending_proof_backups_v1';
const DEFAULT_BACKUP_RELAYS = ['wss://relay.nuts.cash'];

type PendingBackup = {
  mint: string;
  attempts: number;
  lastAttempt: number;
};

const txKey = (txId: string) => `${TX_KEY_PREFIX}${txId}`;

async function readTxIndex() {
  const stored = await AsyncStorage.getItem(TX_INDEX_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

async function writeTxIndex(txIds: string[]) {
  await AsyncStorage.setItem(TX_INDEX_KEY, JSON.stringify(Array.from(new Set(txIds))));
}

async function rememberTx(txId: string) {
  const txIds = await readTxIndex();
  if (txIds.includes(txId)) return;
  await writeTxIndex([...txIds, txId]);
}

async function forgetTx(txId: string) {
  const txIds = await readTxIndex();
  await writeTxIndex(txIds.filter(id => id !== txId));
}

async function saveTx(state: TxState) {
  await Promise.all([
    AsyncStorage.setItem(
      txKey(state.txId),
      JSON.stringify({...state, updatedAt: Date.now()}),
    ),
    rememberTx(state.txId),
  ]);
}

export async function getTransaction(txId: string) {
  const stored = await AsyncStorage.getItem(txKey(txId));
  if (!stored) return null;
  try {
    return JSON.parse(stored) as TxState;
  } catch {
    return null;
  }
}

async function deleteTx(txId: string) {
  await Promise.all([AsyncStorage.removeItem(txKey(txId)), forgetTx(txId)]);
}

async function listTransactions() {
  const txIds = await readTxIndex();
  const transactions = await Promise.all(txIds.map(getTransaction));
  return transactions.filter((tx): tx is TxState => !!tx);
}

export async function startTransaction(
  type: TxType,
  params: TxState['params'],
  proofs: Proof[],
) {
  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const state: TxState = {
    txId,
    type,
    status: 'pending',
    params,
    proofs,
    published: false,
    publishAttempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveTx(state);
  console.log('[tx] started', {txId, type, proofs: proofs.length});
  return txId;
}

export async function updateTransaction(txId: string, updates: Partial<TxState>) {
  const current = await getTransaction(txId);
  if (!current) throw new Error('Transaction not found');
  await saveTx({...current, ...updates, updatedAt: Date.now()});
}

export async function completeTransaction(txId: string, requirePublish = false) {
  const current = await getTransaction(txId);
  if (!current) return;
  if (requirePublish && !current.published && current.nutzapEvent) {
    await saveTx({...current, status: 'pending_publish', updatedAt: Date.now()});
    console.log('[tx] pending publish', {txId});
    return;
  }
  await saveTx({...current, status: 'completed', updatedAt: Date.now()});
  console.log('[tx] completed', {txId});
  setTimeout(() => {
    deleteTx(txId).catch(error => console.warn('[tx] cleanup failed', error));
  }, 60_000);
}

export async function markPublished(txId: string) {
  const current = await getTransaction(txId);
  if (!current) return;
  await saveTx({
    ...current,
    published: true,
    publishAttempts: current.publishAttempts + 1,
    updatedAt: Date.now(),
  });
  await completeTransaction(txId);
}

export async function failTransaction(txId: string, error: string) {
  const current = await getTransaction(txId);
  if (!current) return;
  await saveTx({...current, status: 'failed', error, updatedAt: Date.now()});
  if (current.proofs.length) {
    await useWalletStore.getState().addProofs(current.params.fromMint, current.proofs);
    console.log('[tx] returned proofs after failure', {
      txId,
      proofs: current.proofs.length,
    });
  }
}

export async function listPendingPublish() {
  const transactions = await listTransactions();
  return transactions.filter(tx => tx.status === 'pending_publish' && !tx.published);
}

async function listPending() {
  const transactions = await listTransactions();
  return transactions.filter(tx => tx.status === 'pending');
}

export async function retryPublish(txId: string) {
  const current = await getTransaction(txId);
  if (!current?.nutzapEvent) return false;
  if (current.published) return true;

  const success = await publishWithRetry(
    current.nutzapEvent,
    current.params.receiptRelays,
  );
  if (success) {
    await markPublished(txId);
    return true;
  }
  await saveTx({
    ...current,
    publishAttempts: current.publishAttempts + 1,
    updatedAt: Date.now(),
  });
  return false;
}

export async function resumePendingTransactions() {
  const pending = await listPending();
  for (const tx of pending) {
    const age = Date.now() - tx.createdAt;
    if (age > 5 * 60 * 1000) {
      await failTransaction(tx.txId, 'Transaction timed out');
    } else {
      await failTransaction(tx.txId, 'App restarted during transaction');
    }
  }

  const pendingPublish = await listPendingPublish();
  for (const tx of pendingPublish) {
    await retryPublish(tx.txId);
  }

  await retryPendingBackups();
}

export async function publishWithRetry(
  event: EventTemplate,
  relays: string[] = [],
  timeoutMs = 10_000,
  maxRetries = 3,
) {
  const publishRelays = relays.length ? relays : DEFAULT_BACKUP_RELAYS;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const success = await new Promise<boolean>(resolve => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve(false);
      }, timeoutMs);

      publishToNostr(
        `pub_${Date.now()}_${attempt}`,
        event,
        (message: WorkerMessage) => {
          const status = isConnectionStatus(message);
          const statusValue = status?.status()?.toString();
          if (!status || !statusValue || resolved) return;
          if (statusValue === 'SENT' || statusValue === 'true' || statusValue === 'ok') {
            resolved = true;
            clearTimeout(timeout);
            resolve(true);
          }
        },
        {defaultRelays: publishRelays, trackStatus: true},
      );
    });

    if (success) return true;
    if (attempt < maxRetries) {
      await new Promise<void>(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

async function readPendingBackups() {
  const stored = await AsyncStorage.getItem(PENDING_BACKUP_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored) as Record<string, PendingBackup>;
  } catch {
    return {};
  }
}

async function writePendingBackups(backups: Record<string, PendingBackup>) {
  await AsyncStorage.setItem(PENDING_BACKUP_KEY, JSON.stringify(backups));
}

export async function markBackupPending(mint: string) {
  const pending = await readPendingBackups();
  pending[mint] = {mint, attempts: 0, lastAttempt: 0};
  await writePendingBackups(pending);
}

export async function markBackupSuccess(mint: string) {
  const pending = await readPendingBackups();
  delete pending[mint];
  await writePendingBackups(pending);
}

export async function publishProofsBackup(
  mint: string,
  proofs: Proof[],
  relays: string[] = [],
  timeoutMs = 15_000,
) {
  if (!mint || !proofs.length) return false;
  const event: EventTemplate = {
    kind: 7375,
    content: JSON.stringify({mint, proofs, del: []}),
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
  };
  const success = await publishWithRetry(event, relays, timeoutMs, 1);
  if (success) {
    await markBackupSuccess(mint);
  } else {
    await markBackupPending(mint);
  }
  return success;
}

export async function retryPendingBackups() {
  const pending = await readPendingBackups();
  const entries = Object.entries(pending);
  if (!entries.length) return;

  const wallet = useWalletStore.getState();
  for (const [mint, backup] of entries) {
    const proofs = wallet.getUnspentProofsForMint(mint);
    if (!proofs.length) {
      await markBackupSuccess(mint);
      continue;
    }
    pending[mint] = {
      ...backup,
      attempts: backup.attempts + 1,
      lastAttempt: Date.now(),
    };
    await writePendingBackups(pending);
    const success = await publishProofsBackup(mint, proofs);
    if (success) await markBackupSuccess(mint);
  }
}
