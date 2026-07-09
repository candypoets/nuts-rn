import React from 'react';
import type {ParsedEvent} from '@candypoets/nipworker';
import { NativeNoteFooter } from '../native/NativeNoteFooter';
import {footerColors, useNoteFooterActions} from './footerActions';
import type { RelayStatusSink } from './RelaysList';

type FooterProps = {
  note: ParsedEvent;
  visible: boolean;
  main?: boolean;
  mode?: 'inline' | 'zoom';
  relays?: string[];
  relayStatusSink?: RelayStatusSink;
};

const EMPTY_RELAYS: string[] = [];

export function Footer({
  note,
  visible,
  main = false,
  mode = 'inline',
  relays = EMPTY_RELAYS,
  relayStatusSink: _relayStatusSink,
}: FooterProps) {
  const footerActions = useNoteFooterActions(note, relays);

  return (
    <NativeNoteFooter
      note={note}
      relays={relays}
      currentUserPubkey={footerActions.currentUserPubkey}
      optimisticReactionNonce={footerActions.optimisticReactionNonce}
      visible={visible}
      main={main}
      mode={mode}
      tintColor={footerColors.tint}
      primaryColor={footerColors.primary}
      accentColor={footerColors.accent}
      onReply={footerActions.onReply}
      onComments={footerActions.onComments}
      onRepost={footerActions.onRepost}
      onLike={footerActions.onLike}
      onShare={footerActions.onShare}
      onZap={footerActions.onZap}
    />
  );
}
