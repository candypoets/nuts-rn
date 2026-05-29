import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CheckStateEnum,
  Wallet as CashuWallet,
  type Proof,
} from '@cashu/cashu-ts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type ProofBucket = Map<string, Proof[]>;

const unspentProofs: ProofBucket = new Map();
const spentProofs: ProofBucket = new Map();
const reservedProofs: ProofBucket = new Map();
const cashuWallets = new Map<string, CashuWallet>();
let activeWalletPubkey: string | null = null;
let verifyingProofs = false;

const proofMintIndexKey = (pubkey: string) => `proof_mints_${pubkey}`;
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
    cashuWallets.set(normalized, wallet);
  }
  return wallet;
}

export type WalletStore = {
  walletMnemonic: string;
  walletMnemonicIndex: number;
  walletPassphrase: string;
  walletMintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  proofsLoaded: boolean;
  proofsVerifying: boolean;
  deletedKind7375Ids: string[];
  initializeProofWallet(pubkey: string, mintUrls: string[]): Promise<void>;
  addProofs(mintUrl: string, proofs: Proof[]): Promise<void>;
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
      proofsLoaded: false,
      proofsVerifying: false,
      deletedKind7375Ids: [],
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

        set({
          proofsLoaded: true,
          balanceByMint: balanceFor(unspentProofs, reservedProofs),
        });
      },
      addProofs: async (mintUrl, proofs) => {
        if (!activeWalletPubkey || !mintUrl || !proofs.length) return;
        const mint = normalizeMintUrl(mintUrl);
        const current = unspentProofs.get(mint) || [];
        const merged = uniqProofs([...current, ...proofs]);
        unspentProofs.set(mint, merged);
        await Promise.all([
          rememberMint(activeWalletPubkey, mint),
          writeProofs('unspent', activeWalletPubkey, mint, merged),
        ]);
        set({ balanceByMint: balanceFor(unspentProofs, reservedProofs) });
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
              states.forEach((state, index) => {
                const proof = proofs[index];
                if (!proof) return;
                if (state.state === CheckStateEnum.SPENT) {
                  nextSpent.push(proof);
                } else {
                  nextUnspent.push(proof);
                }
              });
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
          set({ balanceByMint: balanceFor(unspentProofs, reservedProofs) });
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
