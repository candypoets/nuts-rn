import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type FeedKind = 1 | 6 | 20 | 34235 | 1068 | 30023 | 30311;

export const ALL_FEED_KINDS: FeedKind[] = [1, 6, 20, 34235, 1068, 30023, 30311];

export type AppStore = {
  feedKinds: FeedKind[];
  lastNotificationView: number;
  replying: boolean;
  composing: boolean;
  setFeedKinds(feedKinds: FeedKind[]): void;
  setLastNotificationView(value: number): void;
  setReplying(value: boolean): void;
  setComposing(value: boolean): void;
};

export const useAppStore = create<AppStore>()(
  persist(
    set => ({
      feedKinds: [],
      lastNotificationView: Date.now(),
      replying: false,
      composing: false,
      setFeedKinds: feedKinds => set({ feedKinds }),
      setLastNotificationView: lastNotificationView => set({ lastNotificationView }),
      setReplying: replying => set({ replying }),
      setComposing: composing => set({ composing }),
    }),
    {
      name: 'app',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        feedKinds: state.feedKinds,
        lastNotificationView: state.lastNotificationView,
      }),
    },
  ),
);

