import type { MintQuoteResponse } from '@cashu/cashu-ts';
import { create } from 'zustand';

export type MintingStatus =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'minting'
  | 'paid'
  | 'expired'
  | 'error';

/**
 * Shared state for the minting (topup) flow. The amount step creates a mint
 * quote and the wizard switches to the invoice step locally; the quote object
 * is not serializable, so it is handed over through this store.
 */
type MintingStore = {
  amount: string;
  quote: MintQuoteResponse | null;
  status: MintingStatus;
  error: string | null;
  setAmount(amount: string): void;
  setQuote(quote: MintQuoteResponse | null): void;
  setStatus(status: MintingStatus): void;
  setError(error: string | null): void;
  resetMinting(): void;
};

const initialMintingState = {
  amount: '200',
  quote: null,
  status: 'idle' as MintingStatus,
  error: null,
};

export const useMintingStore = create<MintingStore>()(set => ({
  ...initialMintingState,
  setAmount: amount => set({ amount }),
  setQuote: quote => set({ quote }),
  setStatus: status => set({ status }),
  setError: error => set({ error }),
  resetMinting: () => set(initialMintingState),
}));
