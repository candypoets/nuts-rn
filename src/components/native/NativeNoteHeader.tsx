import React, {useMemo} from 'react';
import {StyleSheet} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import NativeNoteHeaderComponent from '../../specs/NativeNoteHeaderNativeComponent';
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
  reposterPubkey?: string;
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
  reposterPubkey,
}: Props) {
  const theme = useAppTheme();
  const noteId = note.id() || '';
  const noteBytes = useMemo(() => flatBufferBytes(note), [noteId, note]);
  const primaryTextColor = getBaseContentColor(theme);
  const secondaryTextColor = getMutedContentColor(theme);

  return (
    <NativeNoteHeaderComponent
      noteBytes={noteBytes}
      relays={relays}
      visible={true}
      depth={depth}
      main={main}
      showRelays={showRelays}
      relayCount={relays?.length ?? 0}
      reposterPubkey={reposterPubkey}
      fallbackSubId={subId}
      primaryTextColor={primaryTextColor}
      secondaryTextColor={secondaryTextColor}
      avatarBackgroundColor={theme.colors.base200}
      accentColor={theme.colors.primary}
      style={[styles.header, depth > 0 ? styles.quote : styles.full]}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    alignSelf: 'stretch',
    flex: 1,
    minWidth: 0,
  },
  full: {
    minHeight: 40,
  },
  quote: {
    minHeight: 18,
  },
});
