import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AuthAccountState = {
  npub: string | null;
  privkey: string | null;
  nsec: string | null;
  hasSigner: boolean;
};

export type AuthState = {
  pubkey: string | null;
  npub: string | null;
  privkey: string | null;
  nsec: string | null;
  hasSigner: boolean;
  authResolved: boolean;
  accounts: Record<string, AuthAccountState>;
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
  accounts: {},
};

function accountSnapshot(state: AuthState): AuthAccountState {
  return {
    npub: state.npub,
    privkey: state.privkey,
    nsec: state.nsec,
    hasSigner: state.hasSigner,
  };
}

function resolveAuthState(
  current: AuthState,
  auth: Partial<AuthState>,
): AuthState {
  const accounts = {...current.accounts};
  if (current.pubkey) {
    accounts[current.pubkey] = accountSnapshot(current);
  }

  const pubkeyChanged = Object.prototype.hasOwnProperty.call(auth, 'pubkey');
  if (!pubkeyChanged) {
    const next = {...current, ...auth, accounts};
    if (next.pubkey) accounts[next.pubkey] = accountSnapshot(next);
    return next;
  }

  const nextPubkey = auth.pubkey ?? null;
  if (!nextPubkey) {
    return {
      ...current,
      ...auth,
      pubkey: null,
      npub: null,
      privkey: null,
      nsec: null,
      hasSigner: false,
      accounts,
    };
  }

  const saved = accounts[nextPubkey];
  const next: AuthState = {
    ...current,
    ...auth,
    pubkey: nextPubkey,
    npub: auth.npub !== undefined ? auth.npub : saved?.npub ?? null,
    privkey: auth.privkey !== undefined ? auth.privkey : saved?.privkey ?? null,
    nsec: auth.nsec !== undefined ? auth.nsec : saved?.nsec ?? null,
    hasSigner:
      auth.hasSigner !== undefined ? auth.hasSigner : saved?.hasSigner ?? false,
    accounts,
  };
  accounts[nextPubkey] = accountSnapshot(next);
  return next;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    set => ({
      ...initialAuthState,
      setAuth: auth => set(current => resolveAuthState(current, auth)),
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
        accounts: state.accounts,
      }),
    },
  ),
);
