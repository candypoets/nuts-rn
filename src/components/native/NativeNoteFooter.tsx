import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import NativeNoteFooterComponent from '../../specs/NativeNoteFooterNativeComponent';

type Props = {
  note: ParsedEvent;
  relays?: string[];
  currentUserPubkey?: string;
  visible?: boolean;
  main?: boolean;
  mode?: 'inline' | 'zoom';
  tintColor: string;
  primaryColor: string;
  accentColor: string;
  onReply: () => void;
  onComments: () => void;
  onQuote: () => void;
  onLike: () => void;
  onShare: () => void;
  onZap: () => void;
};

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as {bb?: {bytes_?: Uint8Array}} | null)?.bb?.bytes_;
  return bytes ? Array.from(bytes) : undefined;
}

export function NativeNoteFooter({
  note,
  relays,
  currentUserPubkey,
  visible = true,
  main = false,
  mode = 'inline',
  tintColor,
  primaryColor,
  accentColor,
  onReply,
  onComments,
  onQuote,
  onLike,
  onShare,
  onZap,
}: Props) {
  const zoom = mode === 'zoom';
  const noteBytes = React.useMemo(() => flatBufferBytes(note), [note]);
  const supportsComments = note.kind() !== 1 && note.kind() !== 6;

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
        relays={relays}
        currentUserPubkey={currentUserPubkey}
        visible={visible}
        main={main}
        zoom={zoom}
        tintColor={tintColor}
        primaryColor={primaryColor}
        accentColor={accentColor}
        zoomBackgroundColor="rgba(15, 23, 42, 0.46)"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[
          styles.hitRow,
          zoom ? styles.zoomHitRow : styles.inlineHitRow,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          style={zoom ? styles.zoomHit : styles.inlineHit}
          onPress={supportsComments ? onComments : onReply}
        />
        <Pressable
          accessibilityRole="button"
          style={zoom ? styles.zoomHit : styles.inlineHit}
          onPress={onQuote}
        />
        <Pressable
          accessibilityRole="button"
          style={zoom ? styles.zoomHit : styles.inlineHit}
          onPress={onLike}
        />
        <Pressable
          accessibilityRole="button"
          style={zoom ? styles.zoomHit : styles.inlineHit}
          onPress={onShare}
        />
      </View>
      {zoom ? null : (
        <Pressable
          accessibilityRole="button"
          style={styles.zapHit}
          onPress={onZap}
        />
      )}
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
    marginTop: 8,
    paddingHorizontal: 8,
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
  hitRow: {
    flexDirection: 'row',
  },
  inlineHitRow: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 32,
    top: 0,
  },
  zoomHitRow: {
    bottom: 0,
    justifyContent: 'space-between',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  inlineHit: {
    minWidth: 34,
    flexGrow: 0,
    flexShrink: 0,
  },
  zoomHit: {
    flex: 1,
  },
  zapHit: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
  },
});
