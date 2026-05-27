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

export const useRelayStore = create<RelayStore>()(set => ({
  relayInfos: {},
  relayStatuses: {},
  relaySubs: {},
  setRelayInfo: (url, info) =>
    set(state => ({ relayInfos: { ...state.relayInfos, [url]: info } })),
  setRelayStatus: (url, status) =>
    set(state => ({ relayStatuses: { ...state.relayStatuses, [url]: status } })),
  setSubRelays: (subId, relays) =>
    set(state => ({ relaySubs: { ...state.relaySubs, [subId]: relays } })),
}));
