import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus } from 'lucide-react-native';
import { fetchRelayInfosForRelays, normalizeRelayUrl } from '../nostr/nip11';
import type { RootStackParamList } from '../navigation/types';
import { useRelayStore } from '../stores';
import { useAppTheme } from '../theme';

type RelaysListProps = {
  relays: string[];
  subId?: string;
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

function fullStatusKind(status?: string) {
  switch (status) {
    case 'EOSE':
    case 'OK':
      return 'success';
    case 'FAILED':
    case 'CLOSED':
      return 'failed';
    case 'SUBSCRIBED':
    default:
      return 'loading';
  }
}

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

const relayNames: Record<string, string> = {
  'wss://relay.nuts.cash': 'Nuts',
  'wss://relay.damus.io': 'Damus',
  'wss://nos.lol': 'Nos',
  'wss://relay.thibautduchene.fr': 'Thibaut',
  'wss://purplepag.es': 'Purple Pages',
  'wss://user.kindpag.es': 'Kind Pages',
};

const relayColorClasses = [
  'bg-primary',
  'bg-secondary',
  'bg-accent',
  'bg-info',
  'bg-warning',
  'bg-success',
];

function relayColorClass(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % relayColorClasses.length;
  }
  return relayColorClasses[hash];
}

function communityName(url: string, name?: string) {
  const normalized = normalizeRelayUrl(url);
  return name?.trim() || relayNames[normalized] || relayLabel(url);
}

function initials(name: string) {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function RelaysList({
  relays,
  subId,
  statuses = {},
  mini = false,
}: RelaysListProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useAppTheme();
  const storeRelays = useRelayStore(state =>
    subId ? state.relaySubs[subId] : undefined,
  );
  const relayInfos = useRelayStore(state => state.relayInfos);
  const sourceRelays = storeRelays ?? relays;
  const displayRelays = useMemo(
    () => sourceRelays.filter(Boolean),
    [sourceRelays],
  );
  const heightClass = mini ? 'h-6' : 'h-7';
  const openRelayInfos = () => {
    navigation.navigate('RelayInfos', {
      subId,
      relays: displayRelays,
      statuses,
    });
  };
  const openCommunityRelay = (relay: string) => {
    const key = normalizeRelayUrl(relay);
    const info = relayInfos[key]?.info;
    navigation.navigate('Community', {
      description: info?.description,
      icon: info?.icon,
      name: communityName(relay, info?.name),
      relay: key,
    });
  };

  useEffect(() => {
    if (mini || !displayRelays.length) return;
    fetchRelayInfosForRelays(displayRelays);
  }, [displayRelays, mini]);

  if (!mini) {
    return (
      <View style={styles.fullContainer}>
        <ScrollView
          horizontal
          onScrollBeginDrag={event => {
            event.stopPropagation();
          }}
          onTouchStart={event => {
            event.stopPropagation();
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row items-center gap-2"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Manage relays"
            className="items-center justify-center rounded-full border border-dashed border-base-200 bg-base-300"
            hitSlop={8}
            onPress={event => {
              event.stopPropagation();
              openRelayInfos();
            }}
            style={styles.fullManageButton}
          >
            <Plus size={22} color={theme.colors.primaryContent} />
          </Pressable>
          {displayRelays.map(relay => {
            const key = normalizeRelayUrl(relay);
            const status = statuses[key];
            const statusKind = fullStatusKind(status);
            const info = relayInfos[key]?.info;
            const name = communityName(relay, info?.name);
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={name}
                className={`items-center justify-center rounded-full ${
                  statusKind === 'success'
                    ? 'border-success'
                    : statusKind === 'failed'
                    ? 'border-error'
                    : 'border-transparent'
                }`}
                hitSlop={8}
                onPress={event => {
                  event.stopPropagation();
                  openCommunityRelay(relay);
                }}
                style={[
                  styles.fullRelayButton,
                  statusKind === 'loading' && styles.fullRelayButtonLoading,
                ]}
              >
                {statusKind === 'loading' ? (
                  <ActivityIndicator
                    color={theme.colors.primary}
                    size={48}
                    style={styles.loadingRing}
                  />
                ) : null}
                <View
                  className={`items-center justify-center overflow-hidden rounded-full ${relayColorClass(
                    key,
                  )}`}
                  style={styles.fullRelayAvatar}
                >
                  {info?.icon ? (
                    <Image
                      source={{ uri: info.icon }}
                      style={styles.iconImage}
                    />
                  ) : (
                    <Text className="text-[10px] font-bold text-base-100">
                      {initials(name)}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <Pressable
      className={`self-start overflow-hidden ${heightClass}`}
      hitSlop={10}
      onPress={event => {
        event.stopPropagation();
        openRelayInfos();
      }}
      style={styles.container}
    >
      <ScrollView
        className={heightClass}
        horizontal
        onScrollBeginDrag={event => {
          event.stopPropagation();
        }}
        onTouchStart={event => {
          event.stopPropagation();
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName={`flex-row items-center gap-1 ${
          mini ? '' : 'px-4'
        }`}
      >
        <View
          className="items-center justify-center rounded-full border border-dashed border-base-200 bg-base-300"
          style={styles.miniManageButton}
        >
          <Plus size={12} color={theme.colors.primaryContent} />
        </View>
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
                className={`${
                  mini ? 'h-1 w-1' : 'h-1.5 w-1.5'
                } rounded-full ${statusClass(status)}`}
              />
              <Text
                className={`${
                  mini ? 'text-[10px]' : 'text-[11px]'
                } text-primary-content`}
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

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
    maxWidth: '100%',
  },
  fullContainer: {
    flexShrink: 1,
    maxWidth: '100%',
  },
  fullRelayButton: {
    width: 52,
    height: 52,
    borderWidth: 1,
  },
  fullRelayButtonLoading: {
    borderWidth: 2,
  },
  fullRelayAvatar: {
    width: 44,
    height: 44,
  },
  fullManageButton: {
    width: 48,
    height: 48,
  },
  miniManageButton: {
    width: 22,
    height: 22,
  },
  iconImage: {
    height: '100%',
    width: '100%',
  },
  loadingRing: {
    position: 'absolute',
  },
});
