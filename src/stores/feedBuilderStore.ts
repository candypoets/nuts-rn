import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type FeedKind } from './appStore';

export type ExploreAudienceMode = 'contacts' | 'all';

export const KIND_LABELS: Record<FeedKind, string> = {
  1: 'Notes',
  6: 'Reposts',
  20: 'Images',
  22: 'Short Videos',
  1068: 'Polls',
  30023: 'Articles',
  31922: 'Date Events',
  31923: 'Time Events',
};

export const KIND_DESCRIPTIONS: Record<FeedKind, string> = {
  1: 'Kind 1 text notes and replies.',
  6: 'Reposted notes with embedded source events.',
  20: 'Image posts.',
  22: 'Short-form video posts.',
  1068: 'Poll events.',
  30023: 'Long-form articles.',
  31922: 'Date-based calendar events.',
  31923: 'Time-based calendar events.',
};

export type FeedPackSelection = {
  id: string;
  kind: number;
  title: string;
  description: string | null;
  image: string | null;
  localImage?: 'followlist';
  people: string[];
  dTag: string | null;
};

type FeedBuilderStore = {
  selectedKinds: FeedKind[];
  selectedPacks: FeedPackSelection[];
  selectedAuthors: string[];
  exploreAudienceMode: ExploreAudienceMode;
  exploreRelays: string[] | null;
  hydrated: boolean;
  applySelection(kinds: FeedKind[], packs: FeedPackSelection[]): void;
  setSelectedKinds(kinds: FeedKind[]): void;
  setExploreAudienceMode(mode: ExploreAudienceMode): void;
  setExploreRelays(relays: string[]): void;
  setFollowListPack(pack: FeedPackSelection): void;
  toggleKind(kind: FeedKind): void;
  togglePack(pack: FeedPackSelection): void;
  removePack(id: string): void;
  clearPacks(): void;
  setHydrated(value: boolean): void;
};

function uniqueAuthors(packs: FeedPackSelection[]) {
  const authors = new Set<string>();
  packs.forEach(pack => {
    pack.people.forEach(author => authors.add(author));
  });
  return Array.from(authors);
}

const SELECTABLE_FEED_KINDS = new Set<FeedKind>([
  1,
  6,
  20,
  22,
  1068,
  30023,
  31922,
  31923,
]);

function normalizeKinds(kinds: number[]) {
  const normalized: FeedKind[] = [];
  kinds.forEach(kind => {
    if (kind === 30311) {
      normalized.push(31922, 31923);
      return;
    }
    if (SELECTABLE_FEED_KINDS.has(kind as FeedKind)) {
      normalized.push(kind as FeedKind);
    }
  });
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

export const useFeedBuilderStore = create<FeedBuilderStore>()(
  persist(
    set => ({
      selectedKinds: [],
      selectedPacks: [],
      selectedAuthors: [],
      exploreAudienceMode: 'contacts',
      exploreRelays: null,
      hydrated: false,
      applySelection: (kinds, packs) =>
        set({
          selectedKinds: normalizeKinds(kinds),
          selectedPacks: packs,
          selectedAuthors: uniqueAuthors(packs),
        }),
      setSelectedKinds: kinds =>
        set({
          selectedKinds: normalizeKinds(kinds),
        }),
      setExploreAudienceMode: exploreAudienceMode =>
        set({ exploreAudienceMode }),
      setExploreRelays: exploreRelays => set({ exploreRelays }),
      setFollowListPack: pack =>
        set(state => {
          const existingIndex = state.selectedPacks.findIndex(
            current => current.id === pack.id,
          );
          const selectedPacks =
            existingIndex === -1
              ? state.selectedPacks.length === 0
                ? [pack]
                : state.selectedPacks
              : [
                  pack,
                  ...state.selectedPacks.filter(
                    current => current.id !== pack.id,
                  ),
                ];
          if (selectedPacks === state.selectedPacks) return state;
          return {
            selectedPacks,
            selectedAuthors: uniqueAuthors(selectedPacks),
          };
        }),
      toggleKind: kind =>
        set(state => {
          const selectedKinds = state.selectedKinds.includes(kind)
            ? state.selectedKinds.filter(current => current !== kind)
            : [...state.selectedKinds, kind];
          return { selectedKinds: normalizeKinds(selectedKinds) };
        }),
      togglePack: pack =>
        set(state => {
          const exists = state.selectedPacks.some(
            current => current.id === pack.id,
          );
          const selectedPacks = exists
            ? state.selectedPacks.filter(current => current.id !== pack.id)
            : [...state.selectedPacks, pack];
          return {
            selectedPacks,
            selectedAuthors: uniqueAuthors(selectedPacks),
          };
        }),
      removePack: id =>
        set(state => {
          const selectedPacks = state.selectedPacks.filter(
            pack => pack.id !== id,
          );
          return {
            selectedPacks,
            selectedAuthors: uniqueAuthors(selectedPacks),
          };
        }),
      clearPacks: () => ({ selectedPacks: [], selectedAuthors: [] }),
      setHydrated: hydrated => set({ hydrated }),
    }),
    {
      name: 'feed-builder',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        selectedKinds: state.selectedKinds,
        selectedPacks: state.selectedPacks,
        selectedAuthors: state.selectedAuthors,
        exploreAudienceMode: state.exploreAudienceMode,
        exploreRelays: state.exploreRelays,
      }),
      onRehydrateStorage: () => state => {
        if (!state) return;
        state.setSelectedKinds(state.selectedKinds);
        state.setHydrated(true);
      },
    },
  ),
);
