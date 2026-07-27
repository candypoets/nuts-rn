import React, { useCallback, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ParsedEvent } from '@candypoets/nipworker';
import NativeMediaViewerComponent from '../../specs/NativeMediaViewerNativeComponent';
import { handleProfileRoute } from '../../navigation/nativeRouteEvents';
import type { RootStackParamList } from '../../navigation/types';
import { useAppTheme } from '../../theme';
import { footerColors, useNoteFooterActions } from '../notes/footerActions';
import type { ImageGridLink } from '../notes/ImageGrid';

export const isNativeMediaViewerAvailable = true;

type Props = {
  links: ImageGridLink[];
  note?: ParsedEvent;
  relays?: string[];
  visible?: boolean;
  containerWidth?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

const MAX_IMAGE_HEIGHT = 384;
const IMAGE_GRID_HEIGHT = 192;

function parseDim(dim?: string | null) {
  if (!dim) return null;
  const [width, height] = dim
    .toLowerCase()
    .split('x')
    .map(value => Number.parseFloat(value));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function imageHeight(dim: string | null | undefined, width: number) {
  const parsed = parseDim(dim);
  if (!parsed) return Math.min(width, MAX_IMAGE_HEIGHT);
  return Math.min((parsed.height * width) / parsed.width, MAX_IMAGE_HEIGHT);
}

function mediaItemKey(link: Pick<ImageGridLink, 'src'>, index: number) {
  return `${index}-${link.src}`;
}

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as { bb?: { bytes_?: Uint8Array } } | null)?.bb?.bytes_;
  return bytes ? Array.from(bytes) : undefined;
}

export function NativeMediaViewer({
  links,
  note,
  relays,
  visible = true,
  containerWidth,
  height: explicitHeight,
  style,
}: Props) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const footerActions = useNoteFooterActions(note, relays);
  const { width: viewportWidth } = useWindowDimensions();
  const noteBytes = useMemo(() => flatBufferBytes(note), [note]);
  const validLinks = useMemo(
    () =>
      links
        .filter(link => link.src)
        .map((link, index) => ({
          ...link,
          itemKey: mediaItemKey(link, index),
        })),
    [links],
  );
  const width = Math.max(160, containerWidth ?? viewportWidth - 88);
  const height =
    explicitHeight ??
    (validLinks.length === 1
      ? imageHeight(validLinks[0]?.dim, width)
      : validLinks.length
      ? IMAGE_GRID_HEIGHT
      : 0);

  const urls = useMemo(() => validLinks.map(link => link.src), [validLinks]);
  const types = useMemo(
    () => validLinks.map(link => link.type ?? 'image'),
    [validLinks],
  );
  const thumbnails = useMemo(
    () => validLinks.map(link => link.blurhash ?? ''),
    [validLinks],
  );
  const dims = useMemo(
    () => validLinks.map(link => link.dim ?? ''),
    [validLinks],
  );
  const itemKeys = useMemo(
    () => validLinks.map(link => link.itemKey ?? ''),
    [validLinks],
  );
  const sessionId = useMemo(
    () => `${validLinks[0]?.src || 'media'}-${validLinks.length}`,
    [validLinks],
  );
  const handleNativeRoute = useCallback(
    (event: { nativeEvent: { route: string } }) => {
      handleProfileRoute(event.nativeEvent.route, navigation);
    },
    [navigation],
  );
  const handleNativeAction = useCallback(
    (event: { nativeEvent: { action: string } }) => {
      footerActions.handleAction(event.nativeEvent.action);
    },
    [footerActions],
  );

  if (!validLinks.length || height <= 0) return null;

  return (
    <Pressable
      onPress={event => {
        event.stopPropagation();
      }}
      onPressIn={event => {
        event.stopPropagation();
      }}
      onPressOut={event => {
        event.stopPropagation();
      }}
      style={[styles.root, style, { width, height }]}
    >
      {visible ? (
        <NativeMediaViewerComponent
          urls={urls}
          types={types}
          thumbnails={thumbnails}
          dims={dims}
          itemKeys={itemKeys}
          sessionId={sessionId}
          noteBytes={noteBytes}
          relays={relays}
          currentUserPubkey={footerActions.currentUserPubkey}
          optimisticReactionNonce={footerActions.optimisticReactionNonce}
          primaryTextColor="#ffffff"
          secondaryTextColor="rgba(255, 255, 255, 0.76)"
          avatarBackgroundColor={theme.colors.base200}
          tintColor={footerColors.tint}
          primaryColor={footerColors.primary}
          accentColor={footerColors.accent}
          zoomBackgroundColor="rgba(15, 23, 42, 0.46)"
          onNativeRoute={handleNativeRoute}
          onNativeAction={handleNativeAction}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
});
