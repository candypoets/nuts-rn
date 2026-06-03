import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CheckStateEnum,
  Wallet as CashuWallet,
  type MintQuoteResponse,
  type Proof,
} from '@cashu/cashu-ts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type ProofBucket = Map<string, Proof[]>;

export type PendingMintQuote = MintQuoteResponse & {
  mintUrl: string;
  createdAt: number;
};

export type ProofDebugStats = {
  received: number;
  valid: number;
  amount: number;
};

export const EMPTY_PROOF_DEBUG_STATS: ProofDebugStats = {
  received: 0,
  valid: 0,
  amount: 0,
};

const unspentProofs: ProofBucket = new Map();
const spentProofs: ProofBucket = new Map();
const reservedProofs: ProofBucket = new Map();
const cashuWallets = new Map<string, CashuWallet>();
let activeWalletPubkey: string | null = null;
let verifyingProofs = false;

const proofMintIndexKey = (pubkey: string) => `proof_mints_${pubkey}`;
const proofStorageClearedKey = (pubkey: string) => `proof_storage_cleared_${pubkey}`;
const pendingMintQuotesKey = (pubkey: string) => `pending_mint_quotes_${pubkey}`;
const proofKey = (
  state: 'unspent' | 'spent' | 'reserved',
  pubkey: string,
  mint: string,
) => `${state}_${pubkey}_${encodeURIComponent(normalizeMintUrl(mint))}`;

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function uniqProofs(proofs: Proof[]) {
  const bySecret = new Map<string, Proof>();
  for (const proof of proofs) {
    if (proof.secret) bySecret.set(proof.secret, proof);
  }
  return Array.from(bySecret.values());
}

function withoutKnownSpentProofs(mint: string, proofs: Proof[]) {
  const spentSecrets = new Set(
    (spentProofs.get(mint) || []).map(proof => proof.secret).filter(Boolean),
  );
  const uniqueProofs = uniqProofs(proofs);
  if (!spentSecrets.size) return uniqueProofs;
  const nextProofs = uniqueProofs.filter(proof => !spentSecrets.has(proof.secret));
  const discarded = uniqueProofs.length - nextProofs.length;
  if (discarded > 0) {
    console.log('[wallet] discarded locally known spent proofs', {
      mint,
      discarded,
      incoming: uniqueProofs.length,
      kept: nextProofs.length,
    });
  }
  return nextProofs;
}

function balanceFor(unspent: ProofBucket, reserved: ProofBucket) {
  const next: Record<string, number> = {};
  for (const [mint, proofs] of unspent.entries()) {
    const total = proofs.reduce((sum, proof) => sum + proof.amount, 0);
    const reservedTotal = (reserved.get(mint) || []).reduce(
      (sum, proof) => sum + proof.amount,
      0,
    );
    next[mint] = Math.max(0, total - reservedTotal);
  }
  return next;
}

function proofCountFor(bucket: ProofBucket) {
  return Array.from(bucket.values()).reduce(
    (sum, proofs) => sum + proofs.length,
    0,
  );
}

function amountFor(balanceByMint: Record<string, number>) {
  return Object.values(balanceByMint).reduce((sum, value) => sum + value, 0);
}

async function readProofs(
  state: 'unspent' | 'spent' | 'reserved',
  pubkey: string,
  mint: string,
) {
  const stored = await AsyncStorage.getItem(proofKey(state, pubkey, mint));
  if (!stored) return [];
  try {
    return JSON.parse(stored) as Proof[];
  } catch {
    return [];
  }
}

async function writeProofs(
  state: 'unspent' | 'spent' | 'reserved',
  pubkey: string,
  mint: string,
  proofs: Proof[],
) {
  await AsyncStorage.setItem(
    proofKey(state, pubkey, mint),
    JSON.stringify(proofs),
  );
}

async function rememberMint(pubkey: string, mint: string) {
  const normalized = normalizeMintUrl(mint);
  const key = proofMintIndexKey(pubkey);
  const stored = await AsyncStorage.getItem(key);
  const mints = stored ? (JSON.parse(stored) as string[]) : [];
  if (mints.includes(normalized)) return;
  await AsyncStorage.setItem(key, JSON.stringify([...mints, normalized]));
}

async function loadMintIndex(pubkey: string) {
  const stored = await AsyncStorage.getItem(proofMintIndexKey(pubkey));
  if (!stored) return [];
  try {
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

async function getCashuWallet(mint: string) {
  const normalized = normalizeMintUrl(mint);
  let wallet = cashuWallets.get(normalized);
  if (!wallet) {
    wallet = new CashuWallet(normalized);
    await wallet.loadMint();
    cashuWallets.set(normalized, wallet);
  }
  return wallet;
}

async function clearStoredProofs(pubkey: string) {
  const indexedMints = await loadMintIndex(pubkey);
  const keys = [
    proofMintIndexKey(pubkey),
    ...indexedMints.flatMap(mint => [
      proofKey('unspent', pubkey, mint),
      proofKey('spent', pubkey, mint),
      proofKey('reserved', pubkey, mint),
    ]),
  ];
  await Promise.all(keys.map(key => AsyncStorage.removeItem(key)));
}

async function readPendingMintQuotes(pubkey: string) {
  const stored = await AsyncStorage.getItem(pendingMintQuotesKey(pubkey));
  if (!stored) return [];
  try {
    return JSON.parse(stored) as PendingMintQuote[];
  } catch {
    return [];
  }
}

async function writePendingMintQuotes(pubkey: string, quotes: PendingMintQuote[]) {
  await AsyncStorage.setItem(pendingMintQuotesKey(pubkey), JSON.stringify(quotes));
}

export type WalletStore = {
  walletMnemonic: string;
  walletMnemonicIndex: number;
  walletPassphrase: string;
  walletMintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  proofDebugStats: ProofDebugStats;
  proofsLoaded: boolean;
  proofsVerifying: boolean;
  deletedKind7375Ids: string[];
  pendingMintQuotes: PendingMintQuote[];
  initializeProofWallet(pubkey: string, mintUrls: string[]): Promise<void>;
  clearProofStorage(pubkey: string): Promise<void>;
  clearProofStorageOnce(pubkey: string): Promise<void>;
  addProofs(mintUrl: string, proofs: Proof[]): Promise<void>;
  setProofsForMint(mintUrl: string, proofs: Proof[]): Promise<void>;
  getUnspentProofsForMint(mintUrl: string): Proof[];
  loadPendingMintQuotes(pubkey: string): Promise<void>;
  savePendingMintQuote(pubkey: string, mintUrl: string, quote: MintQuoteResponse): Promise<void>;
  deletePendingMintQuote(pubkey: string, quoteId: string): Promise<void>;
  checkAndFilterProofs(mintUrl: string, proofs: Proof[]): Promise<Proof[]>;
  verifyAndCleanProofs(): Promise<void>;
  setWalletMnemonic(value: string): void;
  setWalletMnemonicIndex(value: number): void;
  setWalletPassphrase(value: string): void;
  setWalletMintUrls(value: string[]): void;
  setActiveMintUrl(value: string | null): void;
  setBalanceByMint(value: Record<string, number>): void;
  setDeletedKind7375Ids(value: string[]): void;
};

export const useWalletStore = create<WalletStore>()(
  persist(
    set => ({
      walletMnemonic: '',
      walletMnemonicIndex: 0,
      walletPassphrase: '',
      walletMintUrls: [],
      activeMintUrl: null,
      balanceByMint: {},
      proofDebugStats: EMPTY_PROOF_DEBUG_STATS,
      proofsLoaded: false,
      proofsVerifying: false,
      deletedKind7375Ids: [],
      pendingMintQuotes: [],
      initializeProofWallet: async (pubkey, mintUrls) => {
        activeWalletPubkey = pubkey;
        unspentProofs.clear();
        spentProofs.clear();
        reservedProofs.clear();
        cashuWallets.clear();

        const indexedMints = await loadMintIndex(pubkey);
        const mints = Array.from(
          new Set([...mintUrls, ...indexedMints].map(normalizeMintUrl)),
        ).filter(Boolean);

        await Promise.all(
          mints.map(async mint => {
            const [unspent, spent, reserved] = await Promise.all([
              readProofs('unspent', pubkey, mint),
              readProofs('spent', pubkey, mint),
              readProofs('reserved', pubkey, mint),
            ]);
            if (unspent.length) unspentProofs.set(mint, uniqProofs(unspent));
            if (spent.length) spentProofs.set(mint, uniqProofs(spent));
            if (reserved.length) reservedProofs.set(mint, uniqProofs(reserved));
          }),
        );

        const balanceByMint = balanceFor(unspentProofs, reservedProofs);
        set({
          proofsLoaded: true,
          balanceByMint,
          proofDebugStats: {
            received: 0,
            valid: proofCountFor(unspentProofs),
            amount: amountFor(balanceByMint),
          },
        });
      },
      clearProofStorage: async pubkey => {
        if (!pubkey) return;
        await clearStoredProofs(pubkey);
        if (activeWalletPubkey === pubkey) {
          unspentProofs.clear();
          spentProofs.clear();
          reservedProofs.clear();
          set({
            balanceByMint: {},
            proofDebugStats: EMPTY_PROOF_DEBUG_STATS,
          });
        }
      },
      clearProofStorageOnce: async pubkey => {
        if (!pubkey) return;
        const key = proofStorageClearedKey(pubkey);
        const alreadyCleared = await AsyncStorage.getItem(key);
        if (alreadyCleared === '1') return;
        await clearStoredProofs(pubkey);
        if (activeWalletPubkey === pubkey) {
          unspentProofs.clear();
          spentProofs.clear();
          reservedProofs.clear();
          set({
            balanceByMint: {},
            proofDebugStats: EMPTY_PROOF_DEBUG_STATS,
          });
        }
        await AsyncStorage.setItem(key, '1');
      },
      addProofs: async (mintUrl, proofs) => {
        if (!activeWalletPubkey || !mintUrl || !proofs.length) return;
        const mint = normalizeMintUrl(mintUrl);
        const current = unspentProofs.get(mint) || [];
        const merged = withoutKnownSpentProofs(mint, [...current, ...proofs]);
        unspentProofs.set(mint, merged);
        await Promise.all([
          rememberMint(activeWalletPubkey, mint),
          writeProofs('unspent', activeWalletPubkey, mint, merged),
        ]);
        set(state => {
          const balanceByMint = balanceFor(unspentProofs, reservedProofs);
          const currentStats =
            state.proofDebugStats ?? EMPTY_PROOF_DEBUG_STATS;
          return {
            balanceByMint,
            proofDebugStats: {
              received: currentStats.received + proofs.length,
              valid: proofCountFor(unspentProofs),
              amount: amountFor(balanceByMint),
            },
          };
        });
      },
      setProofsForMint: async (mintUrl, proofs) => {
        if (!activeWalletPubkey || !mintUrl) return;
        const mint = normalizeMintUrl(mintUrl);
        const nextProofs = withoutKnownSpentProofs(mint, proofs);
        if (nextProofs.length) {
          unspentProofs.set(mint, nextProofs);
        } else {
          unspentProofs.delete(mint);
        }
        await Promise.all([
          rememberMint(activeWalletPubkey, mint),
          writeProofs('unspent', activeWalletPubkey, mint, nextProofs),
        ]);
        set(state => {
          const balanceByMint = balanceFor(unspentProofs, reservedProofs);
          const currentStats =
            state.proofDebugStats ?? EMPTY_PROOF_DEBUG_STATS;
          return {
            balanceByMint,
            proofDebugStats: {
              received: currentStats.received,
              valid: proofCountFor(unspentProofs),
              amount: amountFor(balanceByMint),
            },
          };
        });
      },
      getUnspentProofsForMint: mintUrl => {
        if (!mintUrl) return [];
        return [...(unspentProofs.get(normalizeMintUrl(mintUrl)) || [])];
      },
      loadPendingMintQuotes: async pubkey => {
        if (!pubkey) return;
        const pendingMintQuotes = await readPendingMintQuotes(pubkey);
        set({pendingMintQuotes});
      },
      savePendingMintQuote: async (pubkey, mintUrl, quote) => {
        if (!pubkey || !mintUrl || !quote.quote) return;
        const pendingQuote: PendingMintQuote = {
          ...quote,
          mintUrl: normalizeMintUrl(mintUrl),
          createdAt: Math.floor(Date.now() / 1000),
        };
        const current = await readPendingMintQuotes(pubkey);
        const next = [
          pendingQuote,
          ...current.filter(existing => existing.quote !== quote.quote),
        ];
        await writePendingMintQuotes(pubkey, next);
        console.log('[minting] saved pending mint quote', {
          mint: pendingQuote.mintUrl,
          quote: pendingQuote.quote,
          amount: pendingQuote.amount,
          expiry: pendingQuote.expiry,
        });
        set({pendingMintQuotes: next});
      },
      deletePendingMintQuote: async (pubkey, quoteId) => {
        if (!pubkey || !quoteId) return;
        const current = await readPendingMintQuotes(pubkey);
        const next = current.filter(quote => quote.quote !== quoteId);
        await writePendingMintQuotes(pubkey, next);
        if (next.length !== current.length) {
          console.log('[minting] deleted pending mint quote', {quote: quoteId});
        }
        set({pendingMintQuotes: next});
      },
      checkAndFilterProofs: async (mintUrl, proofs) => {
        if (!mintUrl || !proofs.length) return proofs;
        const mint = normalizeMintUrl(mintUrl);
        try {
          const wallet = await getCashuWallet(mint);
          const states = await wallet.checkProofsStates(
            proofs.map(proof => ({ secret: proof.secret })),
          );
          const unspentProofs: Proof[] = [];
          let spentCount = 0;
          states.forEach((state, index) => {
            const proof = proofs[index];
            if (!proof) return;
            if (state.state !== CheckStateEnum.SPENT) {
              unspentProofs.push(proof);
            } else {
              spentCount += 1;
            }
          });
          if (spentCount > 0) {
            console.log('[wallet] discarded mint-reported spent proofs', {
              mint,
              discarded: spentCount,
              checked: proofs.length,
              kept: unspentProofs.length,
            });
          }
          return withoutKnownSpentProofs(mint, unspentProofs);
        } catch (error) {
          console.error('[wallet] proof state check failed', mint, error);
          return withoutKnownSpentProofs(mint, proofs);
        }
      },
      verifyAndCleanProofs: async () => {
        if (!activeWalletPubkey || verifyingProofs) return;
        verifyingProofs = true;
        set({ proofsVerifying: true });
        try {
          for (const [mint, proofs] of Array.from(unspentProofs.entries())) {
            if (!proofs.length) continue;
            try {
              const wallet = await getCashuWallet(mint);
              const states = await wallet.checkProofsStates(
                proofs.map(proof => ({ secret: proof.secret })),
              );
              const nextUnspent: Proof[] = [];
              const nextSpent = [...(spentProofs.get(mint) || [])];
              let spentCount = 0;
              states.forEach((state, index) => {
                const proof = proofs[index];
                if (!proof) return;
                if (state.state === CheckStateEnum.SPENT) {
                  spentCount += 1;
                  nextSpent.push(proof);
                } else {
                  nextUnspent.push(proof);
                }
              });
              if (spentCount > 0) {
                console.log('[wallet] moved spent proofs out of unspent', {
                  mint,
                  spent: spentCount,
                  checked: proofs.length,
                  remaining: nextUnspent.length,
                });
              }
              unspentProofs.set(mint, uniqProofs(nextUnspent));
              spentProofs.set(mint, uniqProofs(nextSpent));
              await Promise.all([
                writeProofs(
                  'unspent',
                  activeWalletPubkey,
                  mint,
                  uniqProofs(nextUnspent),
                ),
                writeProofs(
                  'spent',
                  activeWalletPubkey,
                  mint,
                  uniqProofs(nextSpent),
                ),
              ]);
            } catch (error) {
              console.error('[wallet] proof state check failed', mint, error);
            }
          }
          const balanceByMint = balanceFor(unspentProofs, reservedProofs);
          set(state => {
            const currentStats =
              state.proofDebugStats ?? EMPTY_PROOF_DEBUG_STATS;
            return {
              balanceByMint,
              proofDebugStats: {
                received: currentStats.received,
                valid: proofCountFor(unspentProofs),
                amount: amountFor(balanceByMint),
              },
            };
          });
        } finally {
          verifyingProofs = false;
          set({ proofsVerifying: false });
        }
      },
      setWalletMnemonic: walletMnemonic => set({ walletMnemonic }),
      setWalletMnemonicIndex: walletMnemonicIndex =>
        set({ walletMnemonicIndex }),
      setWalletPassphrase: walletPassphrase => set({ walletPassphrase }),
      setWalletMintUrls: walletMintUrls =>
        set({ walletMintUrls: walletMintUrls.map(normalizeMintUrl) }),
      setActiveMintUrl: activeMintUrl => set({ activeMintUrl }),
      setBalanceByMint: balanceByMint => set({ balanceByMint }),
      setDeletedKind7375Ids: deletedKind7375Ids => set({ deletedKind7375Ids }),
    }),
    {
      name: 'wallet',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        walletMnemonic: state.walletMnemonic,
        walletMnemonicIndex: state.walletMnemonicIndex,
        walletPassphrase: state.walletPassphrase,
        walletMintUrls: state.walletMintUrls,
        activeMintUrl: state.activeMintUrl,
        deletedKind7375Ids: state.deletedKind7375Ids,
      }),
    },
  ),
);

export const selectBalance = (state: WalletStore) =>
  Object.values(state.balanceByMint).reduce((sum, value) => sum + value, 0);
