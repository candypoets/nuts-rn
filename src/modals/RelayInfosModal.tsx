import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, ChevronDown, RadioTower } from 'lucide-react-native';
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

function shortPubkey(pubkey?: string) {
  if (!pubkey) return '';
  return pubkey.length > 18
    ? `${pubkey.slice(0, 10)}...${pubkey.slice(-8)}`
    : pubkey;
}

function formatValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  return '';
}

function limitationRows(limitation?: Record<string, unknown>) {
  if (!limitation) return [];
  return Object.entries(limitation)
    .map(
      ([key, value]) => [key.replace(/_/g, ' '), formatValue(value)] as const,
    )
    .filter(([, value]) => Boolean(value));
}

function hasFees(fees?: Record<string, unknown>) {
  return Boolean(fees && Object.keys(fees).length);
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

export function RelayInfosModal({
  subId,
  relays,
  statuses = {},
  mode = 'relays',
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
  const [expandedRelay, setExpandedRelay] = useState<string | null>(null);
  const selectedRelaysRef = useRef(selectedRelays);
  const communityMode = mode === 'communities';

  useEffect(() => {
    setSelectedRelays(
      (storeRelays ?? relays).map(normalizeRelayUrl).filter(Boolean),
    );
  }, [relays, storeRelays]);

  useEffect(() => {
    selectedRelaysRef.current = selectedRelays;
  }, [selectedRelays]);

  useEffect(
    () => () => {
      if (subId && !communityMode) setSubRelays(subId, selectedRelaysRef.current);
    },
    [communityMode, setSubRelays, subId],
  );

  const toggleRelay = useCallback(
    (url: string) => {
      const normalizedUrl = normalizeRelayUrl(url);
      const nextRelays = selectedRelays.includes(normalizedUrl)
        ? selectedRelays.filter(relay => relay !== normalizedUrl)
        : [...selectedRelays, normalizedUrl];
      setSelectedRelays([
        ...new Set(nextRelays.map(normalizeRelayUrl).filter(Boolean)),
      ]);
    },
    [selectedRelays],
  );

  const items = useMemo(() => {
    const selectedRelaySet = new Set(selectedRelays);
    const routeRelays = relays.map(normalizeRelayUrl).filter(Boolean);
    const allRelays = communityMode
      ? routeRelays
      : [
          ...new Set([
            ...routeRelays,
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
        infoEntry: relayInfos[url],
        info: relayInfos[url]?.info,
      }));
  }, [communityMode, relayInfos, relayStatuses, relays, selectedRelays, statuses]);

  useEffect(() => {
    fetchRelayInfosForRelays(items.map(item => item.url));
  }, [items]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.title}>
              Communities
            </Text>
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
            items.map(item => {
              const expanded = expandedRelay === item.url;
              const infoStatus = item.infoEntry?.status ?? 'idle';
              const limitation = limitationRows(item.info?.limitation);
              const paid =
                item.info?.limitation?.payment_required === true ||
                Boolean(item.info?.payments_url) ||
                hasFees(item.info?.fees);
              const badges = [
                paid ? 'paid' : null,
                item.info?.limitation?.auth_required === true ? 'auth' : null,
                item.info?.supported_nips?.includes(42) ? 'nip42' : null,
              ].filter((badge): badge is string => Boolean(badge));

              return (
                <Pressable
                  key={item.url}
                  style={[styles.card, item.selected && styles.selectedRow]}
                  onPress={() => setExpandedRelay(expanded ? null : item.url)}
                >
                  <View style={styles.row}>
                    {communityMode ? null : (
                      <Pressable
                        hitSlop={8}
                        style={[
                          styles.selectionBox,
                          item.selected
                            ? styles.selectionBoxSelected
                            : styles.selectionBoxIdle,
                        ]}
                        onPress={event => {
                          event.stopPropagation();
                          toggleRelay(item.url);
                        }}
                      >
                        {item.selected ? (
                          <Check
                            size={13}
                            color={theme.button.primary.text}
                            strokeWidth={3}
                          />
                        ) : null}
                      </Pressable>
                    )}
                    {item.info?.icon ? (
                      <Image
                        source={{ uri: item.info.icon }}
                        style={styles.relayIcon}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.relayIconFallback}>
                        <RadioTower
                          size={15}
                          color={theme.colors.primary}
                          strokeWidth={2.2}
                        />
                      </View>
                    )}
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor: statusColor(
                            item.status,
                            theme.colors,
                          ),
                        },
                      ]}
                    />
                    <View style={styles.textBlock}>
                      <Text style={styles.relayName} numberOfLines={1}>
                        {item.info?.name || relayLabel(item.url)}
                      </Text>
                      <Text style={styles.relayUrl} numberOfLines={1}>
                        {communityMode
                          ? item.info?.description || 'Public community'
                          : item.url}
                      </Text>
                    </View>
                    {communityMode ? (
                      <Text style={styles.statusText}>Public</Text>
                    ) : item.status === 'EOSE' || item.status === 'OK' ? (
                      <Check
                        size={18}
                        color={theme.colors.success}
                        strokeWidth={2.4}
                      />
                    ) : (
                      <Text style={styles.statusText}>
                        {statusLabel(item.status)}
                      </Text>
                    )}
                    <ChevronDown
                      size={17}
                      color={theme.colors.primaryContent}
                      strokeWidth={2.2}
                      style={expanded ? styles.chevronExpanded : undefined}
                    />
                  </View>

                  {expanded ? (
                    <View style={styles.details}>
                      {item.info?.description && !communityMode ? (
                        <Text style={styles.description}>
                          {item.info.description}
                        </Text>
                      ) : null}

                      <View style={styles.infoStatusRow}>
                        <Text style={styles.metaLabel}>
                          {communityMode ? 'visibility' : 'NIP-11'}
                        </Text>
                        <Text style={styles.metaValue}>
                          {communityMode
                            ? 'public'
                            : infoStatus === 'ok'
                            ? 'metadata loaded'
                            : infoStatus === 'loading'
                            ? 'loading metadata'
                            : infoStatus === 'failed'
                            ? item.infoEntry?.error || 'metadata unavailable'
                            : 'metadata not loaded'}
                        </Text>
                      </View>

                      {badges.length ? (
                        <View style={styles.chips}>
                          {badges.map(badge => (
                            <Text key={badge} style={styles.badge}>
                              {badge}
                            </Text>
                          ))}
                        </View>
                      ) : null}

                      {item.info?.supported_nips?.length ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionTitle}>
                            Supported NIPs
                          </Text>
                          <View style={styles.chips}>
                            {item.info.supported_nips.slice(0, 28).map(nip => (
                              <Text key={nip} style={styles.chip}>
                                {nip}
                              </Text>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      {limitation.length ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionTitle}>Limits</Text>
                          {limitation.slice(0, 10).map(([label, value]) => (
                            <View key={label} style={styles.metaRow}>
                              <Text style={styles.metaLabel}>{label}</Text>
                              <Text style={styles.metaValue} numberOfLines={2}>
                                {value}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      <View style={styles.section}>
                        {item.info?.software ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>software</Text>
                            <Text style={styles.metaValue} numberOfLines={1}>
                              {item.info.software}
                            </Text>
                          </View>
                        ) : null}
                        {item.info?.version ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>version</Text>
                            <Text style={styles.metaValue}>
                              {item.info.version}
                            </Text>
                          </View>
                        ) : null}
                        {item.info?.contact ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>contact</Text>
                            <Text style={styles.metaValue} numberOfLines={1}>
                              {item.info.contact}
                            </Text>
                          </View>
                        ) : null}
                        {item.info?.pubkey || item.info?.self ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>pubkey</Text>
                            <Text style={styles.metaValue}>
                              {shortPubkey(item.info.self || item.info.pubkey)}
                            </Text>
                          </View>
                        ) : null}
                        {item.info?.posting_policy ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>policy</Text>
                            <Text style={styles.metaValue} numberOfLines={1}>
                              {item.info.posting_policy}
                            </Text>
                          </View>
                        ) : null}
                        {item.info?.payments_url ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaLabel}>payments</Text>
                            <Text style={styles.metaValue} numberOfLines={1}>
                              {item.info.payments_url}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {item.info?.relay_countries?.length ||
                      item.info?.language_tags?.length ||
                      item.info?.tags?.length ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionTitle}>Community</Text>
                          <Text style={styles.metaValue}>
                            {[
                              ...(item.info.relay_countries ?? []),
                              ...(item.info.language_tags ?? []),
                              ...(item.info.tags ?? []),
                            ].join('  ')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            })
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
      overflow: 'hidden',
    },
    row: {
      minHeight: 58,
      paddingHorizontal: 12,
      paddingVertical: 8,
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
    relayIcon: {
      width: 28,
      height: 28,
      borderRadius: 6,
      backgroundColor: theme.colors.base200,
    },
    relayIconFallback: {
      width: 28,
      height: 28,
      borderRadius: 6,
      backgroundColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textBlock: {
      flex: 1,
      minWidth: 0,
    },
    relayName: {
      color: cardTextColor,
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
    chevronExpanded: {
      transform: [{ rotate: '180deg' }],
    },
    details: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.base200,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 12,
      gap: 10,
    },
    description: {
      color: cardTextColor,
      fontSize: 13,
      lineHeight: 18,
    },
    infoStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    section: {
      gap: 7,
    },
    sectionTitle: {
      color: cardTextColor,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      minWidth: 28,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: theme.colors.base200,
      paddingHorizontal: 8,
      paddingVertical: 4,
      color: theme.colors.primaryContent,
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'center',
    },
    badge: {
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      color: theme.button.primary.text,
      fontSize: 11,
      fontWeight: '800',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    metaLabel: {
      width: 92,
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'lowercase',
    },
    metaValue: {
      flex: 1,
      minWidth: 0,
      color: cardTextColor,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      textAlign: 'right',
    },
    empty: {
      color: theme.colors.primaryContent,
      textAlign: 'center',
      padding: 24,
    },
  });
}
