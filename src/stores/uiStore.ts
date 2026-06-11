import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const initialDimensions = Dimensions.get('window');

export type UIStore = {
  dimensions: { width: number; height: number };
  imageZoom: {
    links: {
      src: string;
      type?: 'image' | 'video';
      blurhash?: string;
      dim?: string | null;
    }[];
    note?: ParsedEvent;
    zoomed?: number;
    gridId: string;
    videoTime: number;
  };
  themeId: string | null;
  debugEnabled: boolean;
  setDimensions(dimensions: { width: number; height: number }): void;
  setImageZoom(value: Partial<UIStore['imageZoom']>): void;
  setThemeId(themeId: string | null): void;
  setDebugEnabled(debugEnabled: boolean): void;
};

export const useUIStore = create<UIStore>()(
  persist(
    set => ({
      dimensions: { width: initialDimensions.width, height: initialDimensions.height },
      imageZoom: { links: [], gridId: '', videoTime: 0 },
      themeId: null,
      debugEnabled: false,
      setDimensions: dimensions => set({ dimensions }),
      setImageZoom: value =>
        set(state => ({ imageZoom: { ...state.imageZoom, ...value } })),
      setThemeId: themeId => set({ themeId }),
      setDebugEnabled: debugEnabled => set({ debugEnabled }),
    }),
    {
      name: 'ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        themeId: state.themeId,
      }),
    },
  ),
);

Dimensions.addEventListener('change', ({ window }) => {
  useUIStore.getState().setDimensions({ width: window.width, height: window.height });
});

export const selectIsMobile = (state: UIStore) => state.dimensions.width <= 768;
