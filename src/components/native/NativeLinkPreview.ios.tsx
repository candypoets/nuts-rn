import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Linking, StyleSheet, View} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import NativeLinkPreviewComponent from '../../specs/NativeLinkPreviewNativeComponent';
import {
  getBaseContentColor,
  getMutedContentColor,
  useAppTheme,
} from '../../theme';

export const isNativeLinkPreviewAvailable = true;

type Props = {
  url: string;
  text: string;
  visible?: boolean;
};

function normalizeLinkUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function openLink(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {
    Linking.openURL(url).catch(() => {});
  });
}

function getYoutubeVideoId(url: string) {
  try {
    const parsed = new URL(normalizeLinkUrl(url));
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com'
    ) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');

      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function NativeLinkPreview({url, text, visible = true}: Props) {
  const theme = useAppTheme();
  const [height, setHeight] = useState(() =>
    getYoutubeVideoId(url) ? 292 : 96,
  );
  const baseContentColor = getBaseContentColor(theme);
  const secondaryTextColor = getMutedContentColor(theme);

  useEffect(() => {
    setHeight(getYoutubeVideoId(url) ? 292 : 96);
  }, [url]);

  const handleHeightChange = useCallback(
    (event: {nativeEvent: {height: number}}) => {
      const nextHeight = Math.ceil(event.nativeEvent.height);
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      setHeight(current =>
        Math.abs(current - nextHeight) < 1 ? current : nextHeight,
      );
    },
    [],
  );

  const handleNativeRoute = useCallback(
    (event: {nativeEvent: {route: string}}) => {
      const route = event.nativeEvent.route;
      if (!route.startsWith('url:')) return;
      const nextUrl = route.slice('url:'.length);
      if (nextUrl) openLink(nextUrl);
    },
    [],
  );

  const style = useMemo(
    () => [styles.root, {height}],
    [height],
  );

  return visible ? (
    <NativeLinkPreviewComponent
      url={url}
      text={text}
      baseContentColor={baseContentColor}
      secondaryTextColor={secondaryTextColor}
      cardBackgroundColor={theme.colors.base300}
      borderColor={theme.colors.base200}
      onHeightChange={handleHeightChange}
      onNativeRoute={handleNativeRoute}
      style={style}
    />
  ) : (
    <View style={style} />
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
