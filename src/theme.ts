import { useUIStore } from './stores/uiStore';

export type AppThemeId = 'default';
export type ButtonTone = 'primary' | 'secondary' | 'info';

export type ButtonPalette = {
  background: string;
  border: string;
  text: string;
};

export type AppTheme = {
  id: AppThemeId;
  button: Record<ButtonTone, ButtonPalette> & {
    disabled: ButtonPalette;
  };
};

export const appThemes: Record<AppThemeId, AppTheme> = {
  default: {
    id: 'default',
    button: {
      primary: {
        background: '#17212b',
        border: '#17212b',
        text: '#ffffff',
      },
      secondary: {
        background: '#ffffff',
        border: '#d7dee5',
        text: '#52616f',
      },
      info: {
        background: '#158777',
        border: '#158777',
        text: '#ffffff',
      },
      disabled: {
        background: '#cbd5e1',
        border: '#cbd5e1',
        text: '#ffffff',
      },
    },
  },
};

export const defaultTheme = appThemes.default;

export function getAppTheme(themeId: string | null | undefined) {
  if (themeId && themeId in appThemes) {
    return appThemes[themeId as AppThemeId];
  }
  return defaultTheme;
}

export function useAppTheme() {
  const themeId = useUIStore(state => state.themeId);
  return getAppTheme(themeId);
}

