import React, { memo } from 'react';
import { View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { NativeNoteHeader } from '../native/NativeNoteHeader';
import type { RelayStatusSink } from './RelaysList';

type HeaderProps = {
  note: ParsedEvent;
  subId: string;
  depth?: number;
  main?: boolean;
  relays?: string[];
  showRelays?: boolean;
  relayStatusSink?: RelayStatusSink;
  reposterPubkey?: string;
};

function HeaderComponent({
  note,
  subId,
  depth = 0,
  main = false,
  relays,
  showRelays = true,
  relayStatusSink,
  reposterPubkey,
}: HeaderProps) {
  const isQuote = depth > 0;

  return (
    <View
      className={
        isQuote || main ? 'flex-row gap-1' : '-ml-1 flex-row gap-1'
      }
    >
      <NativeNoteHeader
        note={note}
        subId={relayStatusSink ? `${subId} / relay sink` : subId}
        depth={depth}
        main={main}
        relays={relays}
        showRelays={showRelays}
        reposterPubkey={reposterPubkey}
      />
    </View>
  );
}

export const Header = memo(
  HeaderComponent,
  (previous, next) =>
    previous.note.id() === next.note.id() &&
    previous.subId === next.subId &&
    (previous.depth ?? 0) === (next.depth ?? 0) &&
    (previous.main ?? false) === (next.main ?? false) &&
    previous.relays === next.relays &&
    (previous.showRelays ?? true) === (next.showRelays ?? true) &&
    previous.relayStatusSink === next.relayStatusSink &&
    previous.reposterPubkey === next.reposterPubkey,
);
