import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/types';

type RelaysListProps = {
  relays: string[];
  statuses?: Record<string, string>;
  mini?: boolean;
};

function statusClass(status?: string) {
  switch (status) {
    case 'EOSE':
    case 'OK':
      return 'bg-success';
    case 'SUBSCRIBED':
      return 'bg-blue-500';
    case 'FAILED':
      return 'bg-error';
    case 'CLOSED':
      return 'bg-base-200';
    default:
      return 'bg-base-200';
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
}: RelaysListProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const displayRelays = relays.filter(Boolean);
  const heightClass = mini ? 'h-6' : 'h-7';
  if (!displayRelays.length) return null;

  return (
    <Pressable
      className={`self-start overflow-hidden ${heightClass}`}
      hitSlop={10}
      onPress={event => {
        event.stopPropagation();
        navigation.navigate('RelayInfos', {relays, statuses});
      }}
    >
      <ScrollView
        className={heightClass}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName={`flex-row items-center gap-1 ${mini ? '' : 'px-4'}`}
      >
        {displayRelays.map(relay => {
          const key = normalizeRelayUrl(relay);
          const status = statuses[key];
          return (
            <View
              key={key}
              className={`flex-row items-center gap-1 rounded-full border border-base-200 bg-base-300 px-2 ${
                mini ? 'py-0.5' : 'py-1'
              }`}
            >
              <View
                className={`${mini ? 'h-1 w-1' : 'h-1.5 w-1.5'} rounded-full ${statusClass(status)}`}
              />
              <Text
                className={`${mini ? 'text-[10px]' : 'text-[11px]'} text-primary-content`}
                numberOfLines={1}
              >
                {relayLabel(relay)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </Pressable>
  );
}
