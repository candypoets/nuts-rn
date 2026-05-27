import React from 'react';
import {Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {Avatar} from './Avatar';
import {RelaysList} from './RelaysList';
import {formatTimeShort, shortPubkey} from './time';
import {User} from './User';

type HeaderProps = {
  note: ParsedEvent;
  depth?: number;
  main?: boolean;
};

export function Header({note, depth = 0, main = false}: HeaderProps) {
  const pubkey = note.pubkey() || '';

  return (
    <View className="flex-row gap-2">
      <View className={depth ? 'w-5 items-center' : 'w-8 items-center'}>
        <Avatar pubkey={pubkey} size={depth ? 'sm' : 'md'} />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <User
              pubkey={pubkey}
              className={main ? 'text-base font-semibold text-slate-900' : 'text-sm font-semibold text-slate-900'}
            />
            <Text className="text-xs text-slate-500">
              {formatTimeShort(note.createdAt())}
            </Text>
          </View>
          <RelaysList note={note} />
        </View>
        {!pubkey ? null : (
          <Text className="mt-0.5 text-xs text-slate-400">
            {shortPubkey(pubkey)}
          </Text>
        )}
      </View>
    </View>
  );
}
