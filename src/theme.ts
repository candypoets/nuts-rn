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
  const { red, green, blue } = parseHexRgb(hex);
  return `${red} ${green} ${blue}`;
}

function isDarkHex(hex: string) {
  return getHexPerceivedLuminance(hex) < 140;
}

function parseHexRgb(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return { red: 0, green: 0, blue: 0 };
  return {
    red: Math.floor(value / 65536) % 256,
    green: Math.floor(value / 256) % 256,
    blue: value % 256,
  };
}

function getHexPerceivedLuminance(hex: string) {
  const { red, green, blue } = parseHexRgb(hex);
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

function getHexRelativeLuminance(hex: string) {
  const { red, green, blue } = parseHexRgb(hex);
  const channels = [red, green, blue].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function getContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = getHexRelativeLuminance(foreground);
  const backgroundLuminance = getHexRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableTextColor(background: string) {
  const darkText = '#111827';
  const lightText = '#f8fafc';
  return getContrastRatio(darkText, background) >= getContrastRatio(lightText, background)
    ? darkText
    : lightText;
}

function ensureReadableTextColor(foreground: string, background: string, fallback?: string) {
  if (getContrastRatio(foreground, background) >= 4.5) {
    return foreground;
  }
  if (fallback && getContrastRatio(fallback, background) >= 4.5) {
    return fallback;
  }
  return readableTextColor(background);
}

export function getBaseContentColor(theme: AppTheme) {
  return readableTextColor(theme.colors.base100);
}

export function getMutedContentColor(theme: AppTheme) {
  return ensureReadableTextColor(theme.colors.primaryContent, theme.colors.base100);
}

function getOrderedBaseColors(colors: AppThemeColors) {
  const base100Luminance = getHexPerceivedLuminance(colors.base100);
  const base300Luminance = getHexPerceivedLuminance(colors.base300);
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
    primary: '#137568',
    primaryContent: '#52616f',
    secondary: '#b7318f',
    secondaryContent: '#475569',
    base100: '#f9fafb',
    base200: '#f2f2f3',
    base300: '#f8fdfd',
    accent: '#5b35b1',
    neutral: '#2a323c',
    info: '#2563eb',
    success: '#168456',
    warning: '#b7791f',
    error: '#dc2626',
    highlight: '#ffffff',
  },
  nightsky: {
    primary: '#1fb092',
    primaryContent: '#d3dce7',
    secondary: '#b7318f',
    secondaryContent: '#d3dce7',
    base100: '#1f2937',
    base200: '#2a3442',
    base300: '#101722',
    accent: '#9f7aea',
    neutral: '#2a323c',
    info: '#38bdf8',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    highlight: '#000000',
  },
  matteblack: {
    primary: '#1fb092',
    primaryContent: '#d1d5db',
    secondary: '#333333',
    secondaryContent: '#d1d5db',
    base100: '#111111',
    base200: '#242424',
    base300: '#181818',
    accent: '#7c3aed',
    neutral: '#1a1a1a',
    info: '#60a5fa',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    highlight: '#333333',
  },
  snowwhite: {
    primary: '#137568',
    primaryContent: '#475569',
    secondary: '#d4d4d4',
    secondaryContent: '#343434',
    base100: '#f8fafc',
    base200: '#eef2f7',
    base300: '#ffffff',
    accent: '#3454d1',
    neutral: '#f0f0f0',
    info: '#2563eb',
    success: '#15803d',
    warning: '#b45309',
    error: '#dc2626',
    highlight: '#e2e8f0',
  },
  downfox: {
    primary: '#7cc8dd',
    primaryContent: '#d9e7f2',
    secondary: '#282828',
    secondaryContent: '#d9e7f2',
    base100: '#00213f',
    base200: '#161616',
    base300: '#1f2a3d',
    accent: '#f7931a',
    neutral: '#141414',
    info: '#60a5fa',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    highlight: '#282828',
  },
  sunset: {
    primary: '#b94738',
    primaryContent: '#5f4934',
    secondary: '#d8842b',
    secondaryContent: '#4a3828',
    base100: '#f4e4bc',
    base200: '#e8d5a8',
    base300: '#fff8ea',
    accent: '#2563eb',
    neutral: '#9a6b22',
    info: '#2563eb',
    success: '#15803d',
    warning: '#b45309',
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
    primaryContent: ensureReadableTextColor(
      sourceColors.primaryContent,
      sourceColors.base100,
      isDarkHex(sourceColors.base100) ? '#d1d5db' : '#52616f',
    ),
    secondaryContent: ensureReadableTextColor(
      sourceColors.secondaryContent,
      sourceColors.base300,
      isDarkHex(sourceColors.base300) ? '#d1d5db' : '#475569',
    ),
  });

  return {
    id,
    name: themeNames[id],
    colors,
    button: {
      primary: {
        background: colors.primary,
        border: colors.primary,
        text: readableTextColor(colors.primary),
      },
      secondary: {
        background: colors.base300,
        border: colors.base200,
        text: ensureReadableTextColor(colors.secondaryContent, colors.base300),
      },
      info: {
        background: colors.accent,
        border: colors.accent,
        text: readableTextColor(colors.accent),
      },
      disabled: {
        background: colors.base200,
        border: colors.base200,
        text: ensureReadableTextColor(colors.primaryContent, colors.base200),
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

export function isAppThemeDark(theme: AppTheme) {
  return isDarkHex(theme.colors.base100);
}
