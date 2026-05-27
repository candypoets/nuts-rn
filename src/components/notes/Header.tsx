import React from 'react';
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
  onProfileOpen?: (pubkey: string) => void;
};

export function Header({ note, depth = 0, main = false, onProfileOpen }: HeaderProps) {
  const pubkey = note.pubkey() || '';
  const isQuote = depth > 0;

  return (
    <View className={isQuote ? 'flex-row gap-1' : 'flex-row gap-2'}>
      <View className={isQuote ? 'w-4 items-center' : 'w-8 items-center'}>
        <Avatar
          pubkey={pubkey}
          size={isQuote ? 'xs' : 'md'}
          link
          onProfileOpen={onProfileOpen}
        />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <User
              pubkey={pubkey}
              link
              onProfileOpen={onProfileOpen}
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
