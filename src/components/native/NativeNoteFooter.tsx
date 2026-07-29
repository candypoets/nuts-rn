import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import NativeNoteFooterComponent from '../../specs/NativeNoteFooterNativeComponent';
import type { RelayStatusSink } from '../notes/RelaysList';

type Props = {
  note: ParsedEvent;
  relays?: string[];
  relayResolutionPending?: boolean;
  relayStatusSink?: RelayStatusSink;
  currentUserPubkey?: string;
  optimisticReactionNonce?: number;
  visible?: boolean;
  main?: boolean;
  mode?: 'inline' | 'zoom';
  tintColor: string;
  primaryColor: string;
  accentColor: string;
  onReply: () => void;
  onComments: () => void;
  onRepost: () => void;
  onLike: () => void;
  onShare: () => void;
  onZap: () => void;
};
type FooterAction = 'reply' | 'comments' | 'repost' | 'like' | 'share' | 'zap';

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as { bb?: { bytes_?: Uint8Array } } | null)?.bb?.bytes_;
  return bytes ? Array.from(bytes) : undefined;
}

export function NativeNoteFooter({
  note,
  relays,
  relayResolutionPending = false,
  relayStatusSink,
  currentUserPubkey,
  optimisticReactionNonce = 0,
  visible = true,
  main = false,
  mode = 'inline',
  tintColor,
  primaryColor,
  accentColor,
  onReply,
  onComments,
  onRepost,
  onLike,
  onShare,
  onZap,
}: Props) {
  const zoom = mode === 'zoom';
  const noteBytes = React.useMemo(() => flatBufferBytes(note), [note]);
  const handleNativeAction = React.useCallback(
    (event: { nativeEvent: { action: string } }) => {
      switch (event.nativeEvent.action as FooterAction) {
        case 'reply':
          onReply();
          break;
        case 'comments':
          onComments();
          break;
        case 'repost':
          onRepost();
          break;
        case 'like':
          onLike();
          break;
        case 'share':
          onShare();
          break;
        case 'zap':
          onZap();
          break;
      }
    },
    [onComments, onLike, onReply, onRepost, onShare, onZap],
  );
  const handleRelayStatus = React.useCallback(
    (event: { nativeEvent: { relayUrl: string; status: string } }) => {
      const { relayUrl, status } = event.nativeEvent;
      relayStatusSink?.current?.(relayUrl, status);
    },
    [relayStatusSink],
  );

  return (
    <View
      accessibilityLabel="Note actions"
      style={[
        styles.root,
        zoom ? styles.zoomRoot : styles.inlineRoot,
        !zoom && (main ? styles.inlineMain : styles.inlineIndented),
      ]}
    >
      <NativeNoteFooterComponent
        noteBytes={noteBytes}
        noteId={note.id() || undefined}
        relays={relays}
        relayResolutionPending={relayResolutionPending}
        currentUserPubkey={currentUserPubkey}
        optimisticReactionNonce={optimisticReactionNonce}
        visible={visible}
        main={main}
        zoom={zoom}
        tintColor={tintColor}
        primaryColor={primaryColor}
        accentColor={accentColor}
        zoomBackgroundColor="rgba(15, 23, 42, 0.46)"
        onNativeAction={handleNativeAction}
        onRelayStatus={handleRelayStatus}
        style={StyleSheet.absoluteFill}
        pointerEvents="auto"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    zIndex: 30,
    width: '100%',
  },
  inlineRoot: {
    height: 24,
    marginTop: 4,
    marginLeft: -8,
    // paddingHorizontal: 0,
  },
  inlineIndented: {
    paddingLeft: 40,
  },
  inlineMain: {
    paddingLeft: 8,
  },
  zoomRoot: {
    height: 48,
    marginTop: 12,
  },
});
