import React, { memo } from 'react';
import { Text, View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { Avatar } from './Avatar';
import { RelaysList } from './RelaysList';
import { formatTimeShort } from './time';
import { User } from './User';

type HeaderProps = {
  note: ParsedEvent;
  depth?: number;
  main?: boolean;
};

function HeaderComponent({
  note,
  depth = 0,
  main = false,
}: HeaderProps) {
  const pubkey = note.pubkey() || '';
  const isQuote = depth > 0;

  return (
    <View className={isQuote ? 'flex-row gap-1' : 'flex-row gap-2'}>
      <View className={isQuote ? 'w-4 items-center' : 'w-8 items-center'}>
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
            <Text className="text-xs text-slate-500">
              {formatTimeShort(note.createdAt())}
            </Text>
          </View>
          <RelaysList note={note} />
        </View>
      </View>
    </View>
  );
}

export const Header = memo(
  HeaderComponent,
  (previous, next) =>
    previous.note.id() === next.note.id() &&
    (previous.depth ?? 0) === (next.depth ?? 0) &&
    (previous.main ?? false) === (next.main ?? false),
);
