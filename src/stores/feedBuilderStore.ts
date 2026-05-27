import {create} from 'zustand';
import {type FeedKind} from './appStore';

export const KIND_LABELS: Record<FeedKind, string> = {
  1: 'Notes',
  6: 'Reposts',
  20: 'Images',
  34235: 'Videos',
  1068: 'Polls',
  30023: 'Articles',
  30311: 'Live',
};

export const KIND_DESCRIPTIONS: Record<FeedKind, string> = {
  1: 'Kind 1 text notes and replies.',
  6: 'Reposted notes with embedded source events.',
  20: 'Image posts.',
  34235: 'Video posts.',
  1068: 'Poll events.',
  30023: 'Long-form articles.',
  30311: 'Live activity events.',
};

export type FeedPackSelection = {
  id: string;
  kind: number;
  title: string;
  description: string | null;
  image: string | null;
  people: string[];
  dTag: string | null;
};

type FeedBuilderStore = {
  selectedKinds: FeedKind[];
  selectedPacks: FeedPackSelection[];
  selectedAuthors: string[];
  setSelectedKinds(kinds: FeedKind[]): void;
  toggleKind(kind: FeedKind): void;
  togglePack(pack: FeedPackSelection): void;
  removePack(id: string): void;
  clearPacks(): void;
};

function uniqueAuthors(packs: FeedPackSelection[]) {
  return Array.from(new Set(packs.flatMap(pack => pack.people))).sort();
}

function normalizeKinds(kinds: FeedKind[]) {
  return Array.from(new Set(kinds)).sort((left, right) => left - right);
}

export const useFeedBuilderStore = create<FeedBuilderStore>()(set => ({
  selectedKinds: [1],
  selectedPacks: [],
  selectedAuthors: [],
  setSelectedKinds: kinds =>
    set({
      selectedKinds: normalizeKinds(kinds),
    }),
  toggleKind: kind =>
    set(state => {
      const selectedKinds = state.selectedKinds.includes(kind)
        ? state.selectedKinds.filter(current => current !== kind)
        : [...state.selectedKinds, kind];
      return {selectedKinds: normalizeKinds(selectedKinds)};
    }),
  togglePack: pack =>
    set(state => {
      const exists = state.selectedPacks.some(current => current.id === pack.id);
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
      const selectedPacks = state.selectedPacks.filter(pack => pack.id !== id);
      return {
        selectedPacks,
        selectedAuthors: uniqueAuthors(selectedPacks),
      };
    }),
  clearPacks: () => ({selectedPacks: [], selectedAuthors: []}),
}));
