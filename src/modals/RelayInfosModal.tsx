import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as ReactNative from 'react-native';
import {
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { useRelayStore } from '../stores';
import { fetchRelayInfosForRelays, normalizeRelayUrl } from '../nostr/nip11';
import { type AppTheme, type AppThemeColors, useAppTheme } from '../theme';

type RelayInfosModalProps = {
  subId?: string;
  relays: string[];
  statuses?: Record<string, string>;
  mode?: 'relays' | 'communities';
  onClose: () => void;
};

type RelayInfoItem = {
  url: string;
};

type VirtualCollection<T> = {
  readonly size: number;
  at(index: number): T;
};

type VirtualColumnProps<TItem> = {
  children: (item: TItem, key: string) => ReactNode;
  items: VirtualCollection<TItem>;
  itemToKey?: (item: TItem) => string;
  removeClippedSubviews?: boolean;
  testID?: null | string;
};

const VirtualColumn = (
  ReactNative as typeof ReactNative & {
    unstable_VirtualColumn: <TItem>(
      props: VirtualColumnProps<TItem>,
    ) => ReactNode;
  }
).unstable_VirtualColumn;

function relayLabel(url: string) {
  const normalized = normalizeRelayUrl(url);
  try {
    return new URL(normalized.replace(/^wss?:\/\//, 'https://')).host;
  } catch {
    return normalized.replace(/^wss?:\/\//, '');
  }
}

function relayInitials(name: string) {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function statusColor(status: string | undefined, colors: AppThemeColors) {
  switch (status) {
    case 'EOSE':
    case 'OK':
      return colors.success;
    case 'SUBSCRIBED':
      return '#3b82f6';
    case 'FAILED':
      return '#ef4444';
    case 'CLOSED':
      return '#94a3b8';
    default:
      return '#cbd5e1';
  }
}

function statusLabel(status?: string) {
  if (!status) return '';
  if (
    status === 'open' ||
    status === 'connected' ||
    status === 'EOSE' ||
    status === 'OK'
  )
    return 'live';
  if (status === 'SUBSCRIBED') return 'sub';
  if (status === 'connecting') return 'sync';
  if (status === 'failed' || status === 'FAILED') return 'fail';
  if (status === 'close' || status === 'CLOSED') return 'idle';
  return '';
}

function softwareLabel(software?: string) {
  if (!software) return '';
  return software
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^nostr-/, '')
    .replace(/-relay$/, '')
    .replace(/\.git$/, '');
}

function uniqueRelays(relays: string[]) {
  return [...new Set(relays.map(normalizeRelayUrl).filter(Boolean))];
}

function hexLuminance(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  if (normalized.length !== 6) return 0;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return 0;
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

function readableTextColor(background: string) {
  return hexLuminance(background) < 140 ? '#ffffff' : '#1a1a1a';
}

function RelayInfoRow({
  communityMode,
  item,
  selected,
  statusOverride,
  styles,
  theme,
  toggleRelay,
}: {
  communityMode: boolean;
  item: RelayInfoItem;
  selected: boolean;
  statusOverride?: string;
  styles: ReturnType<typeof createRelayInfosStyles>;
  theme: AppTheme;
  toggleRelay: (url: string) => void;
}) {
  const info = useRelayStore(state => state.relayInfos[item.url]?.info);
  const storeStatus = useRelayStore(state => state.relayStatuses[item.url]);
  const status = statusOverride ?? storeStatus;
  const name = info?.name || relayLabel(item.url);
  const nips = Array.isArray(info?.supported_nips) ? info.supported_nips : [];
  const software = softwareLabel(info?.software);
  const label = statusLabel(status);

  return (
    <Pressable
      style={[styles.card, selected && styles.selectedRow]}
      onPress={() => {
        if (!communityMode) toggleRelay(item.url);
      }}
    >
      <View style={styles.row}>
        {communityMode ? null : (
          <Pressable
            hitSlop={8}
            style={[
              styles.selectionBox,
              selected ? styles.selectionBoxSelected : styles.selectionBoxIdle,
            ]}
            onPress={event => {
              event.stopPropagation();
              toggleRelay(item.url);
            }}
          >
            {selected ? (
              <Check
                size={13}
                color={theme.button.primary.text}
                strokeWidth={3}
              />
            ) : null}
          </Pressable>
        )}
        <View style={styles.relayIconWrap}>
          {info?.icon ? (
            <Image
              source={{ uri: info.icon }}
              style={styles.relayIcon}
              contentFit="cover"
            />
          ) : (
            <View style={styles.relayIconFallback}>
              <Text style={styles.relayInitials}>{relayInitials(name)}</Text>
            </View>
          )}
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: statusColor(status, theme.colors),
              },
            ]}
          />
        </View>
        <View style={styles.textBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.relayName} numberOfLines={1}>
              {name}
            </Text>
            {label ? <Text style={styles.inlineStatus}>{label}</Text> : null}
          </View>
          <Text style={styles.relayUrl} numberOfLines={1}>
            {communityMode
              ? info?.description || 'Public community'
              : info?.description || relayLabel(item.url)}
          </Text>
        </View>
        <View style={styles.badges}>
          {nips.includes(50) ? (
            <Text style={[styles.badge, styles.searchBadge]}>search</Text>
          ) : null}
          {nips.includes(42) ? (
            <Text style={[styles.badge, styles.authBadge]}>auth</Text>
          ) : null}
          {nips.length ? (
            <Text
              style={[
                styles.badge,
                selected ? styles.selectedNipBadge : styles.nipBadge,
              ]}
            >
              {nips.length}
            </Text>
          ) : null}
          {software ? (
            <Text
              style={[styles.badge, styles.softwareBadge]}
              numberOfLines={1}
            >
              {software}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function RelayInfosModal({
  subId,
  relays,
  statuses = {},
  mode = 'relays',
  onClose: _onClose,
}: RelayInfosModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createRelayInfosStyles(theme), [theme]);
  const storeRelays = useRelayStore(state =>
    subId ? state.relaySubs[subId] : undefined,
  );
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [selectedRelays, setSelectedRelays] = useState(() =>
    uniqueRelays(storeRelays ?? relays),
  );
  const selectedRelaysRef = useRef(selectedRelays);
  const initialSelectedRelaysRef = useRef(selectedRelays);
  const initialKnownRelaysRef = useRef<string[] | null>(null);
  if (initialKnownRelaysRef.current === null) {
    initialKnownRelaysRef.current = uniqueRelays([
      ...Object.keys(useRelayStore.getState().relayStatuses),
      ...Object.keys(useRelayStore.getState().relayInfos),
    ]);
  }
  const itemOrderRef = useRef<string[] | null>(null);
  const communityMode = mode === 'communities';

  useEffect(() => {
    setSelectedRelays(uniqueRelays(storeRelays ?? relays));
  }, [relays, storeRelays]);

  useEffect(() => {
    selectedRelaysRef.current = selectedRelays;
  }, [selectedRelays]);

  useEffect(
    () => () => {
      if (subId && !communityMode)
        setSubRelays(subId, selectedRelaysRef.current);
    },
    [communityMode, setSubRelays, subId],
  );

  const toggleRelay = useCallback((url: string) => {
    const normalizedUrl = normalizeRelayUrl(url);
    setSelectedRelays(currentRelays => {
      const nextRelays = currentRelays.includes(normalizedUrl)
        ? currentRelays.filter(relay => relay !== normalizedUrl)
        : [...currentRelays, normalizedUrl];
      return [...new Set(nextRelays.map(normalizeRelayUrl).filter(Boolean))];
    });
  }, []);

  const items = useMemo(() => {
    const routeRelays = uniqueRelays(relays);
    const candidateRelays = communityMode
      ? routeRelays
      : uniqueRelays([
          ...routeRelays,
          ...selectedRelays,
          ...Object.keys(statuses),
          ...initialKnownRelaysRef.current,
        ]);
    const currentOrder = itemOrderRef.current;
    const initialSelectedRelaySet = new Set(initialSelectedRelaysRef.current);
    const allRelays =
      currentOrder === null
        ? [
            ...candidateRelays.filter(url => initialSelectedRelaySet.has(url)),
            ...candidateRelays.filter(url => !initialSelectedRelaySet.has(url)),
          ]
        : [
            ...currentOrder.filter(url => candidateRelays.includes(url)),
            ...candidateRelays.filter(url => !currentOrder.includes(url)),
          ];
    itemOrderRef.current = allRelays;

    return allRelays.map(url => ({ url }));
  }, [communityMode, relays, selectedRelays, statuses]);

  const itemUrls = useMemo(() => items.map(item => item.url), [items]);
  const virtualItems = useMemo<VirtualCollection<RelayInfoItem>>(
    () => ({
      get size() {
        return items.length;
      },
      at(index: number) {
        return items[index];
      },
    }),
    [items],
  );
  const renderVirtualItem = useCallback(
    (item: RelayInfoItem) => (
      <RelayInfoRow
        communityMode={communityMode}
        item={item}
        selected={selectedRelays.includes(item.url)}
        statusOverride={statuses[item.url]}
        styles={styles}
        theme={theme}
        toggleRelay={toggleRelay}
      />
    ),
    [communityMode, selectedRelays, statuses, styles, theme, toggleRelay],
  );

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchRelayInfosForRelays(itemUrls);
    });

    return () => {
      task.cancel();
    };
  }, [itemUrls]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.title}>Communities</Text>
            {communityMode ? (
              <Text style={styles.subtitle}>Your spaces. Your people.</Text>
            ) : null}
          </View>
        </View>
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {items.length ? (
            <VirtualColumn
              items={virtualItems}
              itemToKey={item => item.url}
              removeClippedSubviews
              testID="relay-infos-virtual-column"
            >
              {renderVirtualItem}
            </VirtualColumn>
          ) : (
            <Text style={styles.empty}>No relays to show yet.</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function createRelayInfosStyles(theme: AppTheme) {
  const cardTextColor = readableTextColor(theme.colors.base300);
  const surfaceTextColor = readableTextColor(theme.colors.base100);

  return StyleSheet.create({
    modalBody: {
      flex: 1,
      backgroundColor: theme.colors.base100,
    },
    modalSheet: {
      flex: 1,
      position: 'relative',
      backgroundColor: theme.colors.base100,
      paddingBottom: 24,
    },
    modalHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      minHeight: 44,
      paddingTop: 12,
      paddingHorizontal: 18,
      paddingBottom: 10,
      backgroundColor: theme.colors.base100,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      color: surfaceTextColor,
      fontSize: 24,
      fontWeight: '600',
    },
    subtitle: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 2,
    },
    content: {
      paddingHorizontal: 12,
      paddingTop: 62,
      paddingBottom: 12,
      gap: 8,
    },
    list: {
      flex: 1,
    },
    card: {
      borderRadius: 8,
      backgroundColor: theme.colors.base300,
      borderWidth: 1,
      borderColor: 'transparent',
      overflow: 'hidden',
    },
    row: {
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    selectedRow: {
      backgroundColor: theme.colors.base300,
      borderColor: theme.colors.primary,
    },
    selectionBox: {
      width: 18,
      height: 18,
      borderRadius: 5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectionBoxSelected: {
      backgroundColor: theme.colors.primary,
    },
    selectionBoxIdle: {
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
    },
    statusDot: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.base300,
    },
    relayIconWrap: {
      position: 'relative',
      flexShrink: 0,
    },
    relayIcon: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: theme.colors.base200,
    },
    relayIconFallback: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    relayInitials: {
      color: theme.colors.primaryContent,
      fontSize: 11,
      fontWeight: '900',
    },
    textBlock: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    relayName: {
      color: cardTextColor,
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    relayUrl: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      marginTop: 2,
    },
    inlineStatus: {
      color: theme.colors.primaryContent,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'lowercase',
    },
    badges: {
      maxWidth: 118,
      flexShrink: 0,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: 5,
    },
    badge: {
      borderRadius: 5,
      overflow: 'hidden',
      paddingHorizontal: 7,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: '900',
      lineHeight: 11,
    },
    searchBadge: {
      backgroundColor: theme.colors.info,
      color: readableTextColor(theme.colors.info),
    },
    authBadge: {
      backgroundColor: theme.colors.warning,
      color: readableTextColor(theme.colors.warning),
    },
    nipBadge: {
      backgroundColor: theme.colors.base100,
      color: surfaceTextColor,
    },
    selectedNipBadge: {
      backgroundColor: theme.colors.primary,
      color: theme.colors.primaryContent,
    },
    softwareBadge: {
      maxWidth: 72,
      backgroundColor: theme.colors.base100,
      color: theme.colors.primaryContent,
    },
    empty: {
      color: theme.colors.primaryContent,
      textAlign: 'center',
      padding: 24,
    },
  });
}
