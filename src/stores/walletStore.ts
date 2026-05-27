import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WalletStore = {
  walletMnemonic: string;
  walletMnemonicIndex: number;
  walletPassphrase: string;
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  deletedKind7375Ids: string[];
  setWalletMnemonic(value: string): void;
  setWalletMnemonicIndex(value: number): void;
  setWalletPassphrase(value: string): void;
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
      activeMintUrl: null,
      balanceByMint: {},
      deletedKind7375Ids: [],
      setWalletMnemonic: walletMnemonic => set({ walletMnemonic }),
      setWalletMnemonicIndex: walletMnemonicIndex => set({ walletMnemonicIndex }),
      setWalletPassphrase: walletPassphrase => set({ walletPassphrase }),
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
        activeMintUrl: state.activeMintUrl,
        deletedKind7375Ids: state.deletedKind7375Ids,
      }),
    },
  ),
);

export const selectBalance = (state: WalletStore) =>
  Object.values(state.balanceByMint).reduce((sum, value) => sum + value, 0);

