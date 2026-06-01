import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AuthState = {
  pubkey: string | null;
  npub: string | null;
  privkey: string | null;
  nsec: string | null;
  hasSigner: boolean;
  authResolved: boolean;
};

type AuthStore = AuthState & {
  setAuth(auth: Partial<AuthState>): void;
  clearAuth(): void;
};

const initialAuthState: AuthState = {
  pubkey: null,
  npub: null,
  privkey: null,
  nsec: null,
  hasSigner: false,
  authResolved: false,
};

export const useAuthStore = create<AuthStore>()(
  persist(
    set => ({
      ...initialAuthState,
      setAuth: auth => set(current => ({ ...current, ...auth })),
      clearAuth: () => set(initialAuthState),
    }),
    {
      name: 'auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        pubkey: state.pubkey,
        npub: state.npub,
        privkey: state.privkey,
        nsec: state.nsec,
        hasSigner: state.hasSigner,
      }),
    },
  ),
);
