import { Dimensions } from 'react-native';
import { create } from 'zustand';

const initialDimensions = Dimensions.get('window');

export type UIStore = {
  dimensions: { width: number; height: number };
  imageZoom: {
    links: { src: string; type?: 'image' | 'video' }[];
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

export const useUIStore = create<UIStore>()(set => ({
  dimensions: { width: initialDimensions.width, height: initialDimensions.height },
  imageZoom: { links: [], gridId: '', videoTime: 0 },
  themeId: null,
  debugEnabled: false,
  setDimensions: dimensions => set({ dimensions }),
  setImageZoom: value =>
    set(state => ({ imageZoom: { ...state.imageZoom, ...value } })),
  setThemeId: themeId => set({ themeId }),
  setDebugEnabled: debugEnabled => set({ debugEnabled }),
}));

Dimensions.addEventListener('change', ({ window }) => {
  useUIStore.getState().setDimensions({ width: window.width, height: window.height });
});

export const selectIsMobile = (state: UIStore) => state.dimensions.width <= 768;

