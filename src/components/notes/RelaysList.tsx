import React from 'react';
import {Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';

type RelaysListProps = {
  note: ParsedEvent;
};

export function RelaysList({note}: RelaysListProps) {
  const relays: string[] = [];
  for (let index = 0; index < note.relaysLength(); index += 1) {
    const relay = note.relays(index);
    if (relay) relays.push(relay);
  }

  if (!relays.length) return null;

  return (
    <View className="flex-row flex-wrap justify-end gap-1">
      {relays.slice(0, 2).map(relay => (
        <View
          key={relay}
          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5"
        >
          <Text className="text-[10px] text-slate-500" numberOfLines={1}>
            {relay.replace(/^wss?:\/\//, '')}
          </Text>
        </View>
      ))}
    </View>
  );
}
