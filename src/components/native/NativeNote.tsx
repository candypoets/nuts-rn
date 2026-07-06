import React, {useMemo} from 'react';
import {StyleSheet} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import NativeNoteComponent from '../../specs/NativeNoteNativeComponent';
import {
  getBaseContentColor,
  getMutedContentColor,
  useAppTheme,
} from '../../theme';

type Props = {
  note?: ParsedEvent;
  noteId?: string;
  context?: ParsedEvent[];
  relays?: string[];
  visible?: boolean;
  footer?: boolean;
  main?: boolean;
  showQuote?: boolean;
  showMedia?: boolean;
  showRoot?: boolean;
  threadCard?: boolean;
  disableOpen?: boolean;
  depth?: number;
  leading?: boolean;
  tailing?: boolean;
};

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as {bb?: {bytes_?: Uint8Array}} | null)?.bb?.bytes_;
  if (!bytes) {
    return undefined;
  }

  return Array.from(bytes);
}

export function NativeNote({
  note,
  noteId,
  context,
  relays,
  visible = true,
  footer = true,
  main = false,
  showQuote = true,
  showMedia = true,
  showRoot = true,
  threadCard = false,
  disableOpen = false,
  depth = 0,
  leading = false,
  tailing = false,
}: Props) {
  const theme = useAppTheme();
  const eventId = note?.id?.() || noteId || '';
  const noteBytes = useMemo(() => flatBufferBytes(note), [eventId, note]);
  const contextBytes = useMemo(
    () => (context?.length === 1 ? flatBufferBytes(context[0]) : undefined),
    [context],
  );

  return (
    <NativeNoteComponent
      noteId={eventId || noteId}
      noteBytes={noteBytes}
      contextBytes={contextBytes}
      relays={relays}
      visible={visible}
      footer={footer}
      main={main}
      showQuote={showQuote}
      showMedia={showMedia}
      showRoot={showRoot}
      threadCard={threadCard}
      disableOpen={disableOpen}
      depth={depth}
      leading={leading}
      tailing={tailing}
      primaryTextColor={getBaseContentColor(theme)}
      secondaryTextColor={getMutedContentColor(theme)}
      baseContentColor={getBaseContentColor(theme)}
      cardBackgroundColor={theme.colors.base300}
      borderColor={theme.colors.base200}
      accentColor={theme.colors.primary}
      style={styles.root}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    minHeight: 84,
    width: '100%',
  },
});
