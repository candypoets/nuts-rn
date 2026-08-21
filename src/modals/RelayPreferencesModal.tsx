import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {ConnectionStatus, WorkerMessage} from '@candypoets/nipworker';
import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import {Check, Radio, Search} from 'lucide-react-native';

import {
  BOOTSTRAP_RELAYS,
  INDEXER_RELAYS,
  useNostrStore,
  useRelayStore,
  useSendStatusStore,
} from '../stores';
import { fetchRelayInfosForRelays } from '../nostr/nip11';
import {
  buildRelayListPublishPlan,
  normalizeRelayUrl,
  uniqueRelays,
} from '../nostr/relayList';
import {type AppTheme, type AppThemeColors, useAppTheme} from '../theme';

type RelayMode = 'read' | 'write';

type RelayItem = {
  url: string;
  selected: boolean;
  status?: string;
  name: string;
  description?: string;
};

type RelayPreferencesModalProps = {
  onClose: () => void;
};

function relayLabel(url: string) {
  const normalized = normalizeRelayUrl(url);
  try {
    return new URL(normalized.replace(/^wss?:\/\//, 'https://')).host;
  } catch {
    return normalized.replace(/^wss?:\/\//, '');
  }
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function statusColor(status: string | undefined, colors: AppThemeColors) {
  switch (status?.toLowerCase()) {
    case 'open':
    case 'connected':
    case 'eose':
    case 'ok':
      return colors.success;
    case 'subscribed':
    case 'connecting':
      return '#3b82f6';
    case 'failed':
      return '#ef4444';
    case 'close':
    case 'closed':
      return '#94a3b8';
    default:
      return '#cbd5e1';
  }
}

export function RelayPreferencesModal({onClose: _onClose}: RelayPreferencesModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createRelayPreferencesStyles(theme), [theme]);
  const relayInfos = useRelayStore(state => state.relayInfos);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const setRelayMarkers = useNostrStore(state => state.setRelayMarkers);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [mode, setMode] = useState<RelayMode>('read');
  const [search, setSearch] = useState('');
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [draftReadRelays, setDraftReadRelays] = useState(() =>
    uniqueRelays(readRelays),
  );
  const [draftWriteRelays, setDraftWriteRelays] = useState(() =>
    uniqueRelays(writeRelays),
  );
  const [error, setError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const selectedRelays = mode === 'read' ? draftReadRelays : draftWriteRelays;
  const savedRelays = mode === 'read' ? readRelays : writeRelays;
  const hasChanges =
    !sameStringArray(uniqueRelays(readRelays), draftReadRelays) ||
    !sameStringArray(uniqueRelays(writeRelays), draftWriteRelays);

  const items = useMemo<RelayItem[]>(() => {
    const selectedSet = new Set(selectedRelays);
    const query = search.trim().toLowerCase();
    const urls = uniqueRelays([
      ...BOOTSTRAP_RELAYS,
      ...readRelays,
      ...writeRelays,
      ...Object.keys(relayStatuses),
      ...Object.keys(relayInfos),
      ...draftReadRelays,
      ...draftWriteRelays,
    ]);

    return urls
      .map(url => {
        const info = relayInfos[url]?.info;
        return {
          url,
          selected: selectedSet.has(url),
          status: relayStatuses[url],
          name: info?.name || relayLabel(url),
          description: info?.description,
        };
      })
      .filter(item => {
        if (!query) return true;
        return (
          item.url.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query)
        );
      })
      .sort((left, right) => {
        if (left.selected !== right.selected) return left.selected ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }, [
    draftReadRelays,
    draftWriteRelays,
    readRelays,
    relayInfos,
    relayStatuses,
    search,
    selectedRelays,
    writeRelays,
  ]);

  useEffect(() => {
    fetchRelayInfosForRelays(items.map(item => item.url));
  }, [items]);

  const setSelectedRelays = useCallback(
    (next: string[]) => {
      const normalized = uniqueRelays(next);
      if (mode === 'read') setDraftReadRelays(normalized);
      else setDraftWriteRelays(normalized);
    },
    [mode],
  );

  const toggleRelay = useCallback(
    (url: string) => {
      const normalizedUrl = normalizeRelayUrl(url);
      setSelectedRelays(
        selectedRelays.includes(normalizedUrl)
          ? selectedRelays.filter(relay => relay !== normalizedUrl)
          : [...selectedRelays, normalizedUrl],
      );
      setError(null);
      setSaveFeedback(null);
    },
    [selectedRelays, setSelectedRelays],
  );

  const addRelay = useCallback(() => {
    const normalized = normalizeRelayUrl(newRelayUrl);
    if (!normalized) return;
    if (!/^wss?:\/\//i.test(normalized)) {
      setError('Relay URL must start with ws:// or wss://.');
      return;
    }
    setSelectedRelays([...selectedRelays, normalized]);
    setNewRelayUrl('');
    setSearch('');
    setError(null);
    setSaveFeedback(null);
  }, [newRelayUrl, selectedRelays, setSelectedRelays]);

  const saveRelays = useCallback(() => {
    if (!hasChanges) return;

    const relayPlan = buildRelayListPublishPlan({
      readRelays: draftReadRelays,
      writeRelays: draftWriteRelays,
      discoveryRelays: INDEXER_RELAYS,
      createdAt: Math.floor(Date.now() / 1000),
    });
    const sendId = `relays_${Date.now()}`;
    const sendStatus: Record<string, ConnectionStatus> = {};

    setSaveFeedback('Publishing relay preferences...');
    setRelayMarkers(relayPlan.markers);
    publishToNostr(
      sendId,
      relayPlan.event,
      (message: WorkerMessage) => {
        const status = isConnectionStatus(message);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;
        sendStatus[normalizeRelayUrl(relayUrl)] = status;
        updateSendStatus(sendId, sendStatus);
        const statusValue = status.status()?.toString().toLowerCase();
        if (statusValue === 'ok' || statusValue === 'eose') {
          setSaveFeedback('Relay preferences published');
        } else if (statusValue === 'failed' || statusValue === 'closed') {
          setSaveFeedback('Some relays did not accept the update');
        }
      },
      {defaultRelays: relayPlan.publishRelays, trackStatus: true},
    );
  }, [
    draftReadRelays,
    draftWriteRelays,
    hasChanges,
    setRelayMarkers,
    updateSendStatus,
  ]);

  const renderItem = useCallback(
    ({item}: {item: RelayItem}) => (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{checked: item.selected}}
        style={[styles.relayRow, item.selected && styles.relayRowSelected]}
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
        <View style={styles.relayText}>
          <Text style={styles.relayName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.relayUrl} numberOfLines={1}>
            {item.description || item.url}
          </Text>
        </View>
      </Pressable>
    ),
    [styles, theme.colors, toggleRelay],
  );

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>
              {mode === 'read' ? 'Read Relays' : 'Write Relays'}
            </Text>
            <Text style={styles.subtitle}>
              {selectedRelays.length} selected
            </Text>
          </View>
          <Pressable
            disabled={!hasChanges}
            style={[styles.saveButton, !hasChanges && styles.saveButtonDisabled]}
            onPress={saveRelays}
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </Pressable>
        </View>
        {saveFeedback ? (
          <Text style={styles.feedbackText}>{saveFeedback}</Text>
        ) : null}

        <View style={styles.modeControl}>
          <Pressable
            style={[styles.modeButton, mode === 'read' && styles.modeButtonActive]}
            onPress={() => setMode('read')}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'read' && styles.modeButtonTextActive,
              ]}
            >
              Read
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'write' && styles.modeButtonActive]}
            onPress={() => setMode('write')}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'write' && styles.modeButtonTextActive,
              ]}
            >
              Write
            </Text>
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Search size={18} color={theme.colors.primaryContent} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search relays"
            placeholderTextColor={theme.colors.primaryContent}
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            onBlur={Keyboard.dismiss}
          />
        </View>

        <View style={styles.addRow}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="wss://relay.example.com"
            placeholderTextColor={theme.colors.primaryContent}
            style={styles.addInput}
            value={newRelayUrl}
            onChangeText={text => {
              setNewRelayUrl(text);
              setError(null);
            }}
            onSubmitEditing={addRelay}
          />
          <Pressable style={styles.addButton} onPress={addRelay}>
            <Radio size={18} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!sameStringArray(uniqueRelays(savedRelays), selectedRelays) ? (
          <Text style={styles.dirtyText}>
            Unsaved {mode} relay changes
          </Text>
        ) : null}

        <FlatList
          data={items}
          keyExtractor={item => item.url}
          renderItem={renderItem}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>No relays to show.</Text>}
        />
      </View>
    </View>
  );
}

function createRelayPreferencesStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme.colors.base100);
  return StyleSheet.create({
    modalBody: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    fullModalSheet: {
      backgroundColor: theme.colors.base100,
      flex: 1,
      paddingBottom: 20,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    modalHandle: {
      alignSelf: 'center',
      backgroundColor: theme.colors.primaryContent,
      borderRadius: 2,
      height: 4,
      marginBottom: 14,
      width: 42,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    titleBlock: {
      alignItems: 'flex-start',
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: contentColor,
      fontSize: 20,
      fontWeight: '800',
    },
    subtitle: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      marginTop: 2,
    },
    saveButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 10,
      justifyContent: 'center',
      minHeight: 38,
      minWidth: 64,
      paddingHorizontal: 12,
    },
    saveButtonDisabled: {
      backgroundColor: theme.colors.base200,
    },
    saveButtonText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '800',
    },
    modeControl: {
      backgroundColor: theme.colors.base300,
      borderRadius: 10,
      flexDirection: 'row',
      marginBottom: 12,
      padding: 3,
    },
    modeButton: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      minHeight: 38,
      justifyContent: 'center',
    },
    modeButtonActive: {
      backgroundColor: theme.colors.primary,
    },
    modeButtonText: {
      color: theme.colors.primaryContent,
      fontSize: 14,
      fontWeight: '800',
    },
    modeButtonTextActive: {
      color: '#ffffff',
    },
    searchBox: {
      alignItems: 'center',
      backgroundColor: theme.colors.base300,
      borderColor: theme.colors.base200,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 44,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    searchInput: {
      color: contentColor,
      flex: 1,
      fontSize: 15,
      marginLeft: 8,
      minHeight: 44,
      paddingVertical: 0,
    },
    addRow: {
      flexDirection: 'row',
      gap: 8,
    },
    addInput: {
      backgroundColor: theme.colors.base300,
      borderColor: theme.colors.base200,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      color: contentColor,
      flex: 1,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 12,
    },
    addButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 10,
      justifyContent: 'center',
      minHeight: 44,
      width: 48,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 13,
      marginTop: 8,
    },
    feedbackText: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      marginBottom: 10,
    },
    dirtyText: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      marginTop: 8,
    },
    listContent: {
      gap: 8,
      paddingTop: 12,
      paddingBottom: 20,
    },
    relayRow: {
      alignItems: 'center',
      backgroundColor: theme.colors.base300,
      borderColor: theme.colors.base200,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      minHeight: 60,
      paddingHorizontal: 12,
    },
    relayRowSelected: {
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },
    selectionBox: {
      alignItems: 'center',
      borderRadius: 5,
      height: 18,
      justifyContent: 'center',
      width: 18,
    },
    selectionBoxSelected: {
      backgroundColor: theme.colors.primary,
    },
    selectionBoxIdle: {
      backgroundColor: theme.colors.base300,
      borderColor: theme.colors.base200,
      borderWidth: 1,
    },
    statusDot: {
      borderRadius: 4,
      height: 8,
      width: 8,
    },
    relayText: {
      flex: 1,
      minWidth: 0,
    },
    relayName: {
      color: contentColor,
      fontSize: 14,
      fontWeight: '800',
    },
    relayUrl: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      marginTop: 2,
    },
    empty: {
      color: theme.colors.primaryContent,
      paddingTop: 28,
      textAlign: 'center',
    },
  });
}

function readableContentColor(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return '#ffffff';
  const red = Math.floor(value / 65536) % 256;
  const green = Math.floor(value / 256) % 256;
  const blue = value % 256;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140
    ? '#ffffff'
    : '#1a1a1a';
}
