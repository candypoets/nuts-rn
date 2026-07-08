import React, {useCallback, useEffect, useMemo, useState} from 'react';
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
  forceFullContent?: boolean;
  showRoot?: boolean;
  threadCard?: boolean;
  disableOpen?: boolean;
  depth?: number;
  leading?: boolean;
  tailing?: boolean;
  onNativeRoute?: (route: string) => void;
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
  forceFullContent = main,
  showRoot = true,
  threadCard = false,
  disableOpen = false,
  depth = 0,
  leading = false,
  tailing = false,
  onNativeRoute,
}: Props) {
  const theme = useAppTheme();
  const eventId = note?.id?.() || noteId || '';
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const noteBytes = useMemo(() => flatBufferBytes(note), [eventId, note]);
  const contextBytes = useMemo(
    () => (context?.length === 1 ? flatBufferBytes(context[0]) : undefined),
    [context],
  );
  const handleHeightChange = useCallback((event: {nativeEvent: {height: number}}) => {
    const nextHeight = Math.ceil(event.nativeEvent.height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    setMeasuredHeight(current =>
      current !== null && Math.abs(current - nextHeight) < 1 ? current : nextHeight,
    );
  }, []);
  const handleNativeRoute = useCallback((event: {nativeEvent: {route: string}}) => {
    onNativeRoute?.(event.nativeEvent.route);
  }, [onNativeRoute]);

  useEffect(() => {
    setMeasuredHeight(null);
  }, [
    eventId,
    footer,
    main,
    showQuote,
    showMedia,
    forceFullContent,
    depth,
  ]);

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
      forceFullContent={forceFullContent}
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
      onHeightChange={handleHeightChange}
      onNativeRoute={handleNativeRoute}
      style={[styles.root, {height: measuredHeight ?? 120}]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
