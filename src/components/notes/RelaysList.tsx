import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ParsedEvent} from '@candypoets/nipworker';
import type {RootStackParamList} from '../../navigation/types';
import {useRelayStore} from '../../stores';

export type RelayStatusSink = React.MutableRefObject<
  ((relayUrl: string, status: string) => void) | null
>;

type RelaysListProps = {
  note: ParsedEvent;
  subId: string;
  relays?: string[];
  statusSink?: RelayStatusSink;
  mini?: boolean;
  limit?: number;
};

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function statusClass(status?: string) {
  switch (status) {
    case 'EOSE':
    case 'OK':
      return 'bg-emerald-700';
    case 'SUBSCRIBED':
      return 'bg-blue-500';
    case 'FAILED':
      return 'bg-red-500';
    case 'CLOSED':
      return 'bg-base-200';
    default:
      return 'bg-base-200';
  }
}

function useRelayStatusDots(statusSink?: RelayStatusSink) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  const updateStatus = useCallback((relayUrl: string, status: string) => {
    const key = normalizeRelayUrl(relayUrl);
    setStatuses(current =>
      current[key] === status ? current : {...current, [key]: status},
    );
  }, []);

  useEffect(() => {
    if (!statusSink) return undefined;
    statusSink.current = updateStatus;
    return () => {
      if (statusSink.current === updateStatus) statusSink.current = null;
    };
  }, [statusSink, updateStatus]);

  return statuses;
}

export function RelaysList({
  note,
  subId,
  relays: fallbackRelays = [],
  statusSink,
  mini = false,
  limit = 3,
}: RelaysListProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const statuses = useRelayStatusDots(statusSink);
  const relays = useMemo(() => {
    const nextRelays: string[] = [];
    for (let index = 0; index < note.relaysLength(); index += 1) {
      const relay = note.relays(index);
      if (relay) nextRelays.push(normalizeRelayUrl(relay));
    }
    return [...new Set((fallbackRelays.length ? fallbackRelays : nextRelays).map(normalizeRelayUrl))];
  }, [fallbackRelays, note]);

  if (!relays.length) return null;

  const openRelayInfos = () => {
    setSubRelays(subId, relays);
    navigation.navigate('RelayInfos', {
      subId,
      relays,
      statuses,
    });
  };

  return (
    <Pressable
      className="flex-row flex-wrap justify-end gap-1 pt-1"
      hitSlop={10}
      onPress={event => {
        event.stopPropagation();
        openRelayInfos();
      }}
    >
      {relays.slice(0, limit).map(relay => (
        <View
          key={relay}
          className={`${mini ? 'h-1 w-1' : 'h-1.5 w-1.5'} rounded-full ${statusClass(
            statuses[normalizeRelayUrl(relay)],
          )}`}
        />
      ))}
    </Pressable>
  );
}
