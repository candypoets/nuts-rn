import { useUIStore } from './stores/uiStore';
import { vars } from 'nativewind';

export type AppThemeId =
  | 'touchgrass'
  | 'nightsky'
  | 'matteblack'
  | 'snowwhite'
  | 'downfox'
  | 'sunset';
export type ButtonTone = 'primary' | 'secondary' | 'info';

export type ButtonPalette = {
  background: string;
  border: string;
  text: string;
};

export type AppThemeColors = {
  primary: string;
  primaryContent: string;
  secondary: string;
  secondaryContent: string;
  base100: string;
  base200: string;
  base300: string;
  accent: string;
  neutral: string;
  info: string;
  success: string;
  warning: string;
  error: string;
  highlight: string;
};

export type AppTheme = {
  id: AppThemeId;
  name: string;
  colors: AppThemeColors;
  button: Record<ButtonTone, ButtonPalette> & {
    disabled: ButtonPalette;
  };
};

function hexToRgbChannels(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return '0 0 0';
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

function isDarkHex(hex: string) {
  return getHexLuminance(hex) < 140;
}

function getHexLuminance(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return 0;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

function getBaseContentColor(theme: AppTheme) {
  return isDarkHex(theme.colors.base100) ? '#ffffff' : '#1a1a1a';
}

function getMutedContentColor(theme: AppTheme) {
  return theme.colors.primaryContent;
}

function getOrderedBaseColors(colors: AppThemeColors) {
  const base100Luminance = getHexLuminance(colors.base100);
  const base300Luminance = getHexLuminance(colors.base300);
  const shouldBase300BeDarker = isDarkHex(colors.base100);
  const isOrdered = shouldBase300BeDarker
    ? base300Luminance < base100Luminance
    : base300Luminance > base100Luminance;

  if (isOrdered) {
    return colors;
  }

  return {
    ...colors,
    base100: colors.base300,
    base300: colors.base100,
  };
}

const builtInThemeColors: Record<AppThemeId, AppThemeColors> = {
  touchgrass: {
    primary: '#158777',
    primaryContent: '#9b9ea4',
    secondary: '#D926AA',
    secondaryContent: '#c1cad6',
    base100: '#f9fafb',
    base200: '#f2f2f3',
    base300: '#f8fdfd',
    accent: '#6d28d9',
    neutral: '#2a323c',
    info: '#00b5ff',
    success: '#00a96e',
    warning: '#ffbe00',
    error: '#ff5861',
    highlight: '#ffffff',
  },
  nightsky: {
    primary: '#1fb092',
    primaryContent: '#48505a',
    secondary: '#D926AA',
    secondaryContent: '#c1cad6',
    base100: '#131716',
    base200: '#1a1a1a',
    base300: '#1f2937',
    accent: '#c19bfd',
    neutral: '#2a323c',
    info: '#00b5ff',
    success: '#00a96e',
    warning: '#ffbe00',
    error: '#ff5861',
    highlight: '#000000',
  },
  matteblack: {
    primary: '#1fb092',
    primaryContent: '#a0a0a0',
    secondary: '#333333',
    secondaryContent: '#b0b0b0',
    base100: '#111111',
    base200: '#242424',
    base300: '#181818',
    accent: '#a855f7',
    neutral: '#1a1a1a',
    info: '#4d4d4d',
    success: '#00ff66',
    warning: '#cc6600',
    error: '#990000',
    highlight: '#333333',
  },
  snowwhite: {
    primary: '#158777',
    primaryContent: '#e0e0e0',
    secondary: '#d4d4d4',
    secondaryContent: '#343434',
    base100: '#e8e8e8',
    base200: '#f8f8f8',
    base300: '#ffffff',
    accent: '#3366ff',
    neutral: '#f0f0f0',
    info: '#99ddff',
    success: '#aaffaa',
    warning: '#ffdd99',
    error: '#ff9999',
    highlight: '#d4d4d4',
  },
  downfox: {
    primary: '#ADD8E6',
    primaryContent: '#999999',
    secondary: '#282828',
    secondaryContent: '#b3b3b3',
    base100: '#00213f',
    base200: '#161616',
    base300: '#1f2a3d',
    accent: '#f7931a',
    neutral: '#141414',
    info: '#336699',
    success: '#004d00',
    warning: '#996600',
    error: '#660000',
    highlight: '#282828',
  },
  sunset: {
    primary: '#ff6347',
    primaryContent: '#f5f5dc',
    secondary: '#ffb347',
    secondaryContent: '#4a4a4a',
    base100: '#f4e4bc',
    base200: '#e8d5a8',
    base300: '#f7f2f3d9',
    accent: '#1e90ff',
    neutral: '#daa520',
    info: '#87ceeb',
    success: '#32cd32',
    warning: '#ffa500',
    error: '#dc143c',
    highlight: '#ffe4b5',
  },
};

const themeNames: Record<AppThemeId, string> = {
  touchgrass: 'Touch Grass',
  nightsky: 'Night Sky',
  matteblack: 'Matte Black',
  snowwhite: 'Snow White',
  downfox: 'Down Fox',
  sunset: 'Sunset Beach',
};

function createAppTheme(id: AppThemeId): AppTheme {
  const sourceColors = builtInThemeColors[id];
  const colors = getOrderedBaseColors({
    ...sourceColors,
    primaryContent: isDarkHex(sourceColors.base100)
      ? sourceColors.primaryContent
      : '#52616f',
  });

  return {
    id,
    name: themeNames[id],
    colors,
    button: {
      primary: {
        background: colors.primary,
        border: colors.primary,
        text: '#ffffff',
      },
      secondary: {
        background: colors.base300,
        border: colors.base200,
        text: colors.secondaryContent,
      },
      info: {
        background: colors.accent,
        border: colors.accent,
        text: '#ffffff',
      },
      disabled: {
        background: colors.base200,
        border: colors.base200,
        text: colors.primaryContent,
      },
    },
  };
}

export const appThemes: Record<AppThemeId, AppTheme> = {
  touchgrass: createAppTheme('touchgrass'),
  nightsky: createAppTheme('nightsky'),
  matteblack: createAppTheme('matteblack'),
  snowwhite: createAppTheme('snowwhite'),
  downfox: createAppTheme('downfox'),
  sunset: createAppTheme('sunset'),
};

export const appThemeIds: AppThemeId[] = [
  'touchgrass',
  'nightsky',
  'matteblack',
  'snowwhite',
  'downfox',
  'sunset',
];

export const defaultTheme = appThemes.matteblack;

export function getAppTheme(themeId: string | null | undefined) {
  if (themeId && themeId in appThemes) {
    return appThemes[themeId as AppThemeId];
  }
  return defaultTheme;
}

export function getAppThemeVars(theme: AppTheme) {
  const baseContent = getBaseContentColor(theme);
  const mutedContent = getMutedContentColor(theme);
  return vars({
    '--color-primary': hexToRgbChannels(theme.colors.primary),
    '--color-primary-content': hexToRgbChannels(mutedContent),
    '--color-secondary': hexToRgbChannels(theme.colors.secondary),
    '--color-secondary-content': hexToRgbChannels(theme.colors.secondaryContent),
    '--color-base-content': hexToRgbChannels(baseContent),
    '--color-accent': hexToRgbChannels(theme.colors.accent),
    '--color-neutral': hexToRgbChannels(theme.colors.neutral),
    '--color-info': hexToRgbChannels(theme.colors.info),
    '--color-success': hexToRgbChannels(theme.colors.success),
    '--color-warning': hexToRgbChannels(theme.colors.warning),
    '--color-error': hexToRgbChannels(theme.colors.error),
    '--color-highlight': hexToRgbChannels(theme.colors.highlight),
    '--color-base-100': hexToRgbChannels(theme.colors.base100),
    '--color-base-200': hexToRgbChannels(theme.colors.base200),
    '--color-base-300': hexToRgbChannels(theme.colors.base300),
  });
}

export function useAppTheme() {
  const themeId = useUIStore(state => state.themeId);
  return getAppTheme(themeId);
}
