import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Check} from 'lucide-react-native';
import {useRelayStore} from '../stores';
import {type AppTheme, type AppThemeColors, useAppTheme} from '../theme';

type RelayInfosModalProps = {
  subId?: string;
  relays: string[];
  statuses?: Record<string, string>;
  onClose: () => void;
};

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayLabel(url: string) {
  const normalized = normalizeRelayUrl(url);
  try {
    return new URL(normalized.replace(/^wss?:\/\//, 'https://')).host;
  } catch {
    return normalized.replace(/^wss?:\/\//, '');
  }
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
  return status || 'unknown';
}

export function RelayInfosModal({
  subId,
  relays,
  statuses = {},
  onClose: _onClose,
}: RelayInfosModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createRelayInfosStyles(theme), [theme]);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const relayInfos = useRelayStore(state => state.relayInfos);
  const storeRelays = useRelayStore(state =>
    subId ? state.relaySubs[subId] : undefined,
  );
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const [selectedRelays, setSelectedRelays] = useState(() =>
    (storeRelays ?? relays).map(normalizeRelayUrl).filter(Boolean),
  );
  const selectedRelaysRef = useRef(selectedRelays);

  useEffect(() => {
    setSelectedRelays((storeRelays ?? relays).map(normalizeRelayUrl).filter(Boolean));
  }, [relays, storeRelays]);

  useEffect(() => {
    selectedRelaysRef.current = selectedRelays;
  }, [selectedRelays]);

  useEffect(
    () => () => {
      if (subId) setSubRelays(subId, selectedRelaysRef.current);
    },
    [setSubRelays, subId],
  );

  const toggleRelay = useCallback(
    (url: string) => {
      const normalizedUrl = normalizeRelayUrl(url);
      const nextRelays =
        selectedRelays.includes(normalizedUrl)
          ? selectedRelays.filter(relay => relay !== normalizedUrl)
          : [...selectedRelays, normalizedUrl];
      setSelectedRelays([...new Set(nextRelays.map(normalizeRelayUrl).filter(Boolean))]);
    },
    [selectedRelays],
  );

  const items = useMemo(
    () => {
      const selectedRelaySet = new Set(selectedRelays);
      const allRelays = [
        ...new Set([
          ...selectedRelaySet,
          ...Object.keys(relayStatuses),
          ...Object.keys(statuses).map(normalizeRelayUrl),
          ...Object.keys(relayInfos),
        ]),
      ];

      return allRelays
        .map(url => ({
          url,
          selected: selectedRelaySet.has(url),
          status: statuses[url] ?? relayStatuses[url],
          info: relayInfos[url],
        }))
        .sort((left, right) => Number(right.selected) - Number(left.selected));
    },
    [relayInfos, relayStatuses, selectedRelays, statuses],
  );

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <Text style={styles.title}>Relays</Text>
        </View>
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {items.length ? (
            items.map(item => (
              <Pressable
                key={item.url}
                style={[styles.row, item.selected && styles.selectedRow]}
                onPress={() => toggleRelay(item.url)}
              >
                <View
                  style={[
                    styles.selectionBox,
                    item.selected
                      ? styles.selectionBoxSelected
                      : styles.selectionBoxIdle,
                  ]}
                >
                  {item.selected ? (
                    <Check size={13} color="#ffffff" strokeWidth={3} />
                  ) : null}
                </View>
                <View
                  style={[
                    styles.statusDot,
                    {backgroundColor: statusColor(item.status, theme.colors)},
                  ]}
                />
                <View style={styles.textBlock}>
                  <Text style={styles.relayName} numberOfLines={1}>
                    {item.info?.name || relayLabel(item.url)}
                  </Text>
                  <Text style={styles.relayUrl} numberOfLines={1}>
                    {item.info?.description || item.url}
                  </Text>
                </View>
                {item.status === 'EOSE' || item.status === 'OK' ? (
                  <Check size={18} color={theme.colors.success} strokeWidth={2.4} />
                ) : (
                  <Text style={styles.statusText}>{statusLabel(item.status)}</Text>
                )}
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>No relays to show yet.</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function createRelayInfosStyles(theme: AppTheme) {
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
    color: theme.colors.base100 === '#111111' ? '#ffffff' : '#1a1a1a',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 52,
    paddingBottom: 12,
    gap: 8,
  },
  list: {
    flex: 1,
  },
  row: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: theme.colors.base300,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedRow: {
    backgroundColor: theme.colors.base300,
    borderWidth: 1,
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
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  relayName: {
    color: theme.colors.base100 === '#111111' ? '#ffffff' : '#1a1a1a',
    fontSize: 14,
    fontWeight: '700',
  },
  relayUrl: {
    color: theme.colors.primaryContent,
    fontSize: 12,
    marginTop: 2,
  },
  statusText: {
    color: theme.colors.primaryContent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'lowercase',
  },
  empty: {
    color: theme.colors.primaryContent,
    textAlign: 'center',
    padding: 24,
  },
  });
}
