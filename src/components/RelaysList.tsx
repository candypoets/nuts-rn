import React from 'react';
import {Text, View} from 'react-native';

type RelaysListProps = {
  relays: string[];
  statuses?: Record<string, string>;
  mini?: boolean;
  limit?: number;
};

function statusClass(status?: string) {
  switch (status) {
    case 'EOSE':
    case 'OK':
      return 'bg-emerald-500';
    case 'SUBSCRIBED':
      return 'bg-blue-500';
    case 'FAILED':
      return 'bg-red-500';
    case 'CLOSED':
      return 'bg-slate-400';
    default:
      return 'bg-slate-300';
  }
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

export function RelaysList({
  relays,
  statuses = {},
  mini = false,
  limit = mini ? 3 : 6,
}: RelaysListProps) {
  const displayRelays = relays.filter(Boolean).slice(0, limit);
  if (!displayRelays.length) return null;

  return (
    <View className="flex-row flex-wrap justify-end gap-1">
      {displayRelays.map(relay => {
        const key = normalizeRelayUrl(relay);
        const status = statuses[key];
        return (
          <View
            key={key}
            className={`flex-row items-center gap-1 rounded-full border border-slate-200 bg-white px-2 ${
              mini ? 'py-0.5' : 'py-1'
            }`}
          >
            <View
              className={`h-1.5 w-1.5 rounded-full ${statusClass(status)}`}
            />
            <Text
              className={`${mini ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}
              numberOfLines={1}
            >
              {relayLabel(relay)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
