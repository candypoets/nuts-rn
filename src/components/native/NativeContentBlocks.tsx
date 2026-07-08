import React, {useMemo} from 'react';
import {StyleSheet} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import NativeContentBlocksComponent from '../../specs/NativeContentBlocksNativeComponent';
import {
  getBaseContentColor,
  getMutedContentColor,
  useAppTheme,
} from '../../theme';

type Props = {
  note?: ParsedEvent;
  noteId?: string;
  relays?: string[];
  visible?: boolean;
  main?: boolean;
  showQuote?: boolean;
  showMedia?: boolean;
  forceFullContent?: boolean;
  depth?: number;
};

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as {bb?: {bytes_?: Uint8Array}} | null)?.bb?.bytes_;
  return bytes ? Array.from(bytes) : undefined;
}

export function NativeContentBlocks({
  note,
  noteId,
  relays,
  visible = true,
  main = false,
  showQuote = true,
  showMedia = true,
  forceFullContent = false,
  depth = 0,
}: Props) {
  const theme = useAppTheme();
  const eventId = note?.id?.() || noteId || '';
  const noteBytes = useMemo(() => flatBufferBytes(note), [eventId, note]);

  return (
    <NativeContentBlocksComponent
      noteId={eventId || noteId}
      noteBytes={noteBytes}
      relays={relays}
      visible={visible}
      main={main}
      showQuote={showQuote}
      showMedia={showMedia}
      forceFullContent={forceFullContent}
      depth={depth}
      primaryTextColor={getBaseContentColor(theme)}
      secondaryTextColor={getMutedContentColor(theme)}
      baseContentColor={getBaseContentColor(theme)}
      borderColor={theme.colors.base200}
      accentColor={theme.colors.primary}
      style={styles.root}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    minHeight: 18,
    width: '100%',
  },
});
