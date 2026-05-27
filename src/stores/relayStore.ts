import { create } from 'zustand';

export type RelayInfo = {
  name?: string;
  description?: string;
  icon?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
};

export type RelayStore = {
  relayInfos: Record<string, RelayInfo>;
  relayStatuses: Record<string, string>;
  relaySubs: Record<string, string[]>;
  setRelayInfo(url: string, info: RelayInfo): void;
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
  setRelayInfo: (url, info) =>
    set(state => ({ relayInfos: { ...state.relayInfos, [url]: info } })),
  setRelayStatus: (url, status) =>
    set(state =>
      state.relayStatuses[url] === status
        ? state
        : {relayStatuses: {...state.relayStatuses, [url]: status}},
    ),
  setSubRelays: (subId, relays) =>
    set(state =>
      sameStringArray(state.relaySubs[subId] ?? [], relays)
        ? state
        : {relaySubs: {...state.relaySubs, [subId]: relays}},
    ),
}));
