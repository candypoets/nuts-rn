import React, {useCallback, useMemo} from 'react';
import {StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ParsedEvent} from '@candypoets/nipworker';
import NativeNoteHeaderComponent from '../../specs/NativeNoteHeaderNativeComponent';
import {shortNpub} from '../../lib/identity';
import {handleProfileRoute} from '../../navigation/nativeRouteEvents';
import type {RootStackParamList} from '../../navigation/types';
import {
  getBaseContentColor,
  getMutedContentColor,
  useAppTheme,
} from '../../theme';

type Props = {
  note: ParsedEvent;
  subId: string;
  depth?: number;
  main?: boolean;
  relays?: string[];
  showRelays?: boolean;
  relayStatuses?: Record<string, string>;
  reposterPubkey?: string;
  onNotePress: () => void;
};

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as {bb?: {bytes_?: Uint8Array}} | null)?.bb?.bytes_;
  if (!bytes) {
    return undefined;
  }

  return Array.from(bytes);
}

export function NativeNoteHeader({
  note,
  subId,
  depth = 0,
  main = false,
  relays,
  showRelays = true,
  relayStatuses,
  reposterPubkey,
  onNotePress,
}: Props) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const noteBytes = useMemo(() => flatBufferBytes(note), [note]);
  const authorPubkey = note.pubkey() || undefined;
  const nameFallback = useMemo(
    () => (authorPubkey ? shortNpub(authorPubkey) : ''),
    [authorPubkey],
  );
  const relayStatusEntries = useMemo(
    () => Object.entries(relayStatuses ?? {}).flat(),
    [relayStatuses],
  );
  const primaryTextColor = getBaseContentColor(theme);
  const secondaryTextColor = getMutedContentColor(theme);
  const handleNativeRoute = useCallback(
    (event: {nativeEvent: {route: string}}) => {
      if (event.nativeEvent.route === 'note') {
        onNotePress();
        return;
      }
      handleProfileRoute(event.nativeEvent.route, navigation);
    },
    [navigation, onNotePress],
  );

  return (
    <NativeNoteHeaderComponent
      noteBytes={noteBytes}
      relays={relays}
      visible={true}
      depth={depth}
      main={main}
      showRelays={showRelays}
      relayCount={relays?.length ?? 0}
      relayStatuses={relayStatusEntries}
      authorPubkey={authorPubkey}
      reposterPubkey={reposterPubkey}
      fallbackSubId={subId}
      nameFallback={nameFallback}
      primaryTextColor={primaryTextColor}
      secondaryTextColor={secondaryTextColor}
      avatarBackgroundColor={theme.colors.base200}
      accentColor={theme.colors.primary}
      onNativeRoute={handleNativeRoute}
      style={[styles.header, depth > 0 ? styles.quote : styles.full]}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    alignSelf: 'stretch',
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 1,
  },
  full: {
    minHeight: 42,
  },
  quote: {
    minHeight: 18,
  },
});
