import { create } from 'zustand';

export type RelayInfo = {
  name?: string;
  description?: string;
  banner?: string;
  icon?: string;
  pubkey?: string;
  self?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: Record<string, unknown>;
  retention?: unknown[];
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: Record<string, unknown>;
};

export type RelayInfoFetchStatus = 'idle' | 'loading' | 'ok' | 'failed';

export type RelayInfoEntry = {
  info?: RelayInfo;
  status: RelayInfoFetchStatus;
  fetchedAt?: number;
  error?: string;
};

export type RelayStore = {
  relayInfos: Record<string, RelayInfoEntry>;
  relayStatuses: Record<string, string>;
  relaySubs: Record<string, string[]>;
  setRelayInfoLoading(url: string): void;
  setRelayInfo(url: string, info: RelayInfo): void;
  setRelayInfoError(url: string, error: string): void;
  setRelayStatus(url: string, status: string): void;
  setSubRelays(subId: string, relays: string[]): void;
};

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export const useRelayStore = create<RelayStore>()(set => ({
  relayInfos: {},
  relayStatuses: {},
  relaySubs: {},
  setRelayInfoLoading: url =>
    set(state => ({
      relayInfos: {
        ...state.relayInfos,
        [url]: {
          ...state.relayInfos[url],
          status: 'loading',
        },
      },
    })),
  setRelayInfo: (url, info) =>
    set(state => ({
      relayInfos: {
        ...state.relayInfos,
        [url]: {
          info,
          status: 'ok',
          fetchedAt: Date.now(),
        },
      },
    })),
  setRelayInfoError: (url, error) =>
    set(state => ({
      relayInfos: {
        ...state.relayInfos,
        [url]: {
          ...state.relayInfos[url],
          status: 'failed',
          fetchedAt: Date.now(),
          error,
        },
      },
    })),
  setRelayStatus: (url, status) =>
    set(state => {
      if (state.relayStatuses[url] === status) return state;
      // Dev-only: surface relay connectivity in logcat (native relay logs
      // from nipworker don't reach Android logcat).
      if (__DEV__) {
        console.log('[relay-status]', url, '->', status);
      }
      return { relayStatuses: { ...state.relayStatuses, [url]: status } };
    }),
  setSubRelays: (subId, relays) =>
    set(state =>
      state.relaySubs[subId] !== undefined &&
      sameStringArray(state.relaySubs[subId] ?? [], relays)
        ? state
        : { relaySubs: { ...state.relaySubs, [subId]: relays } },
    ),
}));
