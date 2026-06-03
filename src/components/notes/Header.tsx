import React, { memo, useCallback } from 'react';
import { Text, View } from 'react-native';
import type { Kind0Parsed, ParsedEvent } from '@candypoets/nipworker';
import { BadgeCheck } from 'lucide-react-native';
import { useKind0Value } from '../../hooks/useKind0Value';
import { Avatar } from './Avatar';
import { RelaysList, type RelayStatusSink } from './RelaysList';
import { formatTimeShort } from './time';
import { User } from './User';

type HeaderProps = {
  note: ParsedEvent;
  subId: string;
  depth?: number;
  main?: boolean;
  relays?: string[];
  showRelays?: boolean;
  relayStatusSink?: RelayStatusSink;
};

function HeaderComponent({
  note,
  subId,
  depth = 0,
  main = false,
  relays,
  showRelays = true,
  relayStatusSink,
}: HeaderProps) {
  const pubkey = note.pubkey() || '';
  const isQuote = depth > 0;
  const selectNip05 = useCallback(
    (profile: Kind0Parsed) => profile.nip05?.()?.trim() || '',
    [],
  );
  const nip05 = useKind0Value(pubkey, {
    enabled: !!pubkey,
    fallback: '',
    selector: selectNip05,
  });

  return (
    <View className={isQuote ? 'flex-row gap-1' : '-ml-1 flex-row gap-1'}>
      <View className={isQuote ? 'w-4 items-center' : 'w-10 items-center'}>
        <Avatar
          pubkey={pubkey}
          size={isQuote ? 'xs' : 'md'}
          link
        />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <User
              pubkey={pubkey}
              link
              className={
                main
                  ? 'text-base font-semibold text-slate-900'
                  : 'text-sm font-semibold text-slate-900'
              }
            />
            {nip05 ? (
              <View className="min-w-0 flex-shrink flex-row items-center gap-1">
                <BadgeCheck
                  size={14}
                  color="#158777"
                  strokeWidth={2.4}
                />
                <Text
                  className="min-w-0 flex-shrink text-xs text-slate-500"
                  ellipsizeMode="middle"
                  numberOfLines={1}
                >
                  {nip05}
                </Text>
              </View>
            ) : null}
            <Text className="text-xs text-slate-500">
              {formatTimeShort(note.createdAt())}
            </Text>
          </View>
          {showRelays ? (
            <RelaysList
              note={note}
              subId={subId}
              relays={relays}
              statusSink={relayStatusSink}
              mini
            />
          ) : null}
        </View>
      </View>
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
    previous.relayStatusSink === next.relayStatusSink,
);
