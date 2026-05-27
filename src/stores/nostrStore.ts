import { create } from 'zustand';

export const BOOTSTRAP_RELAYS = [
  'wss://relay.thibautduchene.fr',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.nuts.cash',
];

export const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://purplepag.es'];

export type RelayMarker = {
  url: string;
  read: boolean;
  write: boolean;
};

export type ProfileSnapshot = {
  pubkey: string;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  updatedAt: number;
};

export type NostrStore = {
  kind0UpdatedAt: number;
  kind3UpdatedAt: number;
  kind10000UpdatedAt: number;
  kind10002UpdatedAt: number;
  kind10019UpdatedAt: number;
  kind10063UpdatedAt: number;
  kind10096UpdatedAt: number;
  follows: string[];
  relayMarkers: RelayMarker[];
  readRelays: string[];
  writeRelays: string[];
  mutedPubkeys: string[];
  mutedHashtags: string[];
  mutedWords: string[];
  mutedEventIds: string[];
  blossomServers: string[];
  nip96Servers: string[];
  trustedMints: string[];
  walletReadRelays: string[];
  profile: ProfileSnapshot | null;
  setKindTimestamp(kind: number, createdAt: number): void;
  setProfile(profile: ProfileSnapshot): void;
  setFollows(follows: string[]): void;
  setRelayMarkers(relays: RelayMarker[]): void;
  setMutes(mutes: Partial<Pick<NostrStore, 'mutedPubkeys' | 'mutedHashtags' | 'mutedWords' | 'mutedEventIds'>>): void;
  setUploadServers(servers: Partial<Pick<NostrStore, 'blossomServers' | 'nip96Servers'>>): void;
  setTrustedMints(mints: string[]): void;
  setWalletReadRelays(relays: string[]): void;
  resetNostrState(): void;
};

const initialState = {
  kind0UpdatedAt: 0,
  kind3UpdatedAt: 0,
  kind10000UpdatedAt: 0,
  kind10002UpdatedAt: 0,
  kind10019UpdatedAt: 0,
  kind10063UpdatedAt: 0,
  kind10096UpdatedAt: 0,
  follows: [],
  relayMarkers: [],
  readRelays: [],
  writeRelays: [],
  mutedPubkeys: [],
  mutedHashtags: [],
  mutedWords: [],
  mutedEventIds: [],
  blossomServers: [],
  nip96Servers: [],
  trustedMints: [],
  walletReadRelays: [],
  profile: null,
};

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRelayMarkers(left: RelayMarker[], right: RelayMarker[]) {
  return (
    left.length === right.length &&
    left.every((relay, index) => {
      const other = right[index];
      return (
        relay.url === other?.url &&
        relay.read === other.read &&
        relay.write === other.write
      );
    })
  );
}

export const useNostrStore = create<NostrStore>()(set => ({
  ...initialState,
  setKindTimestamp: (kind, createdAt) =>
    set(current => {
      const key = `kind${kind}UpdatedAt` as keyof NostrStore;
      if (typeof current[key] === 'number' && createdAt <= current[key]) return current;
      return { [key]: createdAt } as Partial<NostrStore>;
    }),
  setProfile: profile =>
    set(current => {
      if (current.profile && profile.updatedAt <= current.profile.updatedAt) {
        return current;
      }
      return {profile};
    }),
  setFollows: follows =>
    set(current =>
      sameStringArray(current.follows, follows) ? current : {follows},
    ),
  setRelayMarkers: relayMarkers =>
    set(current => {
      if (sameRelayMarkers(current.relayMarkers, relayMarkers)) return current;
      return {
        relayMarkers,
        readRelays: relayMarkers
          .filter(relay => relay.read)
          .map(relay => relay.url),
        writeRelays: relayMarkers
          .filter(relay => relay.write)
          .map(relay => relay.url),
      };
    }),
  setMutes: mutes =>
    set(current => {
      const next = {
        mutedPubkeys: mutes.mutedPubkeys ?? current.mutedPubkeys,
        mutedHashtags: mutes.mutedHashtags ?? current.mutedHashtags,
        mutedWords: mutes.mutedWords ?? current.mutedWords,
        mutedEventIds: mutes.mutedEventIds ?? current.mutedEventIds,
      };
      if (
        sameStringArray(current.mutedPubkeys, next.mutedPubkeys) &&
        sameStringArray(current.mutedHashtags, next.mutedHashtags) &&
        sameStringArray(current.mutedWords, next.mutedWords) &&
        sameStringArray(current.mutedEventIds, next.mutedEventIds)
      ) {
        return current;
      }
      return next;
    }),
  setUploadServers: servers =>
    set(current => {
      const next = {
        blossomServers: servers.blossomServers ?? current.blossomServers,
        nip96Servers: servers.nip96Servers ?? current.nip96Servers,
      };
      if (
        sameStringArray(current.blossomServers, next.blossomServers) &&
        sameStringArray(current.nip96Servers, next.nip96Servers)
      ) {
        return current;
      }
      return next;
    }),
  setTrustedMints: trustedMints =>
    set(current =>
      sameStringArray(current.trustedMints, trustedMints)
        ? current
        : {trustedMints},
    ),
  setWalletReadRelays: walletReadRelays =>
    set(current =>
      sameStringArray(current.walletReadRelays, walletReadRelays)
        ? current
        : {walletReadRelays},
    ),
  resetNostrState: () => set(initialState),
}));

export const selectPreferredUploadServer = (state: NostrStore) => {
  if (state.blossomServers.length) {
    return { type: 'blossom' as const, servers: state.blossomServers };
  }
  if (state.nip96Servers.length) {
    return { type: 'nip96' as const, servers: state.nip96Servers };
  }
  return null;
};
