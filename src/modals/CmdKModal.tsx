import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  MessageType,
  type ParsedEvent,
  type WorkerMessage,
} from '@candypoets/nipworker';
import {asKind0, asParsedEvent, isKind0} from '@candypoets/nipworker/utils';
import {Hash, Search, User, X} from 'lucide-react-native';
import {SEARCH_RELAYS} from '../stores';
import {subscribeUntilEose} from '../nostr/subscribeUntilEose';
import {type AppTheme, useAppTheme} from '../theme';

const HASHTAG_HISTORY_KEY = 'cmdk_hashtag_history';
const SEARCH_DEBOUNCE_MS = 450;

type CmdKMode = 'profiles' | 'hashtags';

type CmdKModalProps = {
  onClose: () => void;
  onSelectProfile: (pubkey: string) => void;
  onSelectHashtag: (tag: string) => void;
};

type CmdKStyles = ReturnType<typeof createCmdKStyles>;
const CmdKStylesContext = createContext<CmdKStyles | null>(null);

function useCmdKStyles() {
  const styles = useContext(CmdKStylesContext);
  if (!styles) throw new Error('CmdK styles missing');
  return styles;
}

export function CmdKModal({
  onClose,
  onSelectProfile,
  onSelectHashtag,
}: CmdKModalProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createCmdKStyles(theme), [theme]);
  const iconColor = theme.colors.primaryContent;
  const inputRef = useRef<TextInput>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<CmdKMode>('profiles');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ParsedEvent[]>([]);
  const [hashtagHistory, setHashtagHistory] = useState<string[]>([]);
  const cleanQuery = query.trim();
  const cleanTag = cleanQuery.replace(/^#/, '');

  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HASHTAG_HISTORY_KEY)
      .then(value => {
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setHashtagHistory(parsed.filter(item => typeof item === 'string'));
        }
      })
      .catch(() => undefined);
  }, []);

  const scoreItem = useCallback((item: ParsedEvent, search: string) => {
    const kind0 = asKind0(item);
    if (!kind0 || !search) return 0;
    const lowerQuery = search.toLowerCase();
    const fields = [
      {value: kind0.name(), exact: 100, prefix: 50, contains: 10},
      {value: kind0.displayName(), exact: 90, prefix: 40, contains: 5},
      {value: kind0.nip05(), exact: 80, prefix: 30, contains: 8},
    ];
    return fields.reduce((score, field) => {
      const value = field.value?.toLowerCase();
      if (!value) return score;
      if (value === lowerQuery) return Math.max(score, field.exact);
      if (value.startsWith(lowerQuery)) return Math.max(score, field.prefix);
      if (value.includes(lowerQuery)) return Math.max(score, field.contains);
      return score;
    }, 0);
  }, []);

  const sortItems = useCallback(
    (
      events: ParsedEvent[],
      search: string,
      cachedPubkeys: Set<string>,
      descending = true,
    ) =>
      [...events].sort((left, right) => {
        const score =
          scoreItem(right, search) -
          scoreItem(left, search) +
          (cachedPubkeys.has(right.pubkey() || '') ? 5 : 0) -
          (cachedPubkeys.has(left.pubkey() || '') ? 5 : 0);
        return descending ? score : -score;
      }),
    [scoreItem],
  );

  useEffect(() => {
    if (mode !== 'profiles' || !cleanQuery) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setLoading(false);
      setItems([]);
      return undefined;
    }

    const timeout = setTimeout(() => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setItems([]);
      setLoading(true);
      const cachedEvents: ParsedEvent[] = [];
      const fetchedEvents: ParsedEvent[] = [];
      const liveEvents: ParsedEvent[] = [];
      const seenPubkeys = new Set<string>();
      const cachedPubkeys = new Set<string>();
      let eose = false;
      let eoce = false;

      const addUnique = (target: ParsedEvent[], event: ParsedEvent) => {
        const pubkey = event.pubkey();
        if (!pubkey || seenPubkeys.has(pubkey)) return;
        seenPubkeys.add(pubkey);
        target.unshift(event);
      };

      const updateItems = (descending = true) => {
        setItems(
          sortItems(
            [...cachedEvents, ...fetchedEvents, ...liveEvents],
            cleanQuery,
            cachedPubkeys,
            descending,
          ),
        );
      };

      unsubscribeRef.current = subscribeUntilEose(
        `cmdk_${cleanQuery}`,
        [
          {
            kinds: [0],
            search: cleanQuery,
            limit: 10,
            noCache: true,
            relays: SEARCH_RELAYS,
          },
        ],
        (message: WorkerMessage) => {
          switch (message.type()) {
            case MessageType.ConnectionStatus:
              setLoading(false);
              eose = true;
              updateItems();
              break;
            case MessageType.Eoce:
              eoce = true;
              updateItems(false);
              break;
            case MessageType.ParsedNostrEvent: {
              const kind0 = isKind0(message);
              if (!kind0) return;
              const event = asParsedEvent(message);
              const pubkey = event?.pubkey();
              if (!event || !pubkey) return;
              if (!eoce) {
                cachedPubkeys.add(pubkey);
                addUnique(cachedEvents, event);
              } else if (!eose) {
                addUnique(fetchedEvents, event);
              } else {
                addUnique(liveEvents, event);
                updateItems();
              }
              break;
            }
          }
        },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [cleanQuery, mode, sortItems]);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    },
    [],
  );

  const saveHashtag = useCallback(async (tag: string) => {
    const normalized = tag.replace(/^#/, '').trim();
    if (!normalized) return;
    setHashtagHistory(current => {
      const next = [
        normalized,
        ...current.filter(item => item.toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, 10);
      AsyncStorage.setItem(HASHTAG_HISTORY_KEY, JSON.stringify(next)).catch(
        () => undefined,
      );
      return next;
    });
  }, []);

  const submitHashtag = useCallback(
    (tag: string) => {
      const normalized = tag.replace(/^#/, '').trim();
      if (!normalized) return;
      Keyboard.dismiss();
      saveHashtag(normalized).catch(() => undefined);
      onClose();
      requestAnimationFrame(() => onSelectHashtag(normalized));
    },
    [onClose, onSelectHashtag, saveHashtag],
  );

  const submitProfile = useCallback(
    (pubkey: string) => {
      Keyboard.dismiss();
      onClose();
      requestAnimationFrame(() => onSelectProfile(pubkey));
    },
    [onClose, onSelectProfile],
  );

  const emptyText = useMemo(() => {
    if (mode === 'hashtags') return 'Type a hashtag to view its feed';
    if (!cleanQuery) return 'Start typing to search profiles';
    if (loading) return 'Searching...';
    return `No results found for "${cleanQuery}"`;
  }, [cleanQuery, loading, mode]);

  return (
    <CmdKStylesContext.Provider value={styles}>
    <View style={[styles.screen, {paddingTop: insets.top}]}>
      <View style={styles.panel}>
        <View style={styles.inputRow}>
          {mode === 'hashtags' ? (
            <Hash size={21} color={iconColor} strokeWidth={2.2} />
          ) : (
            <Search size={21} color={iconColor} strokeWidth={2.2} />
          )}
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              if (mode === 'hashtags') submitHashtag(cleanTag);
              else {
                const pubkey = items[0]?.pubkey();
                if (pubkey) submitProfile(pubkey);
              }
            }}
            placeholder={mode === 'hashtags' ? 'Enter hashtag...' : 'Search...'}
            placeholderTextColor={theme.colors.primaryContent}
            returnKeyType={mode === 'hashtags' ? 'go' : 'search'}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable
            accessibilityLabel="Close search"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
            style={styles.closeButton}
          >
            <X size={21} color={iconColor} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.modeRow}>
          <ModeButton
            active={mode === 'profiles'}
            label="Profiles"
            onPress={() => setMode('profiles')}
          />
          <ModeButton
            active={mode === 'hashtags'}
            label="Hashtags"
            onPress={() => setMode('hashtags')}
          />
        </View>

        {mode === 'hashtags' ? (
          <FlatList
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => inputRef.current?.blur()}
            data={cleanTag ? [cleanTag] : hashtagHistory}
            keyExtractor={(item, index) => `${item}:${index}`}
            ListEmptyComponent={<EmptyState loading={false} text={emptyText} />}
            renderItem={({item, index}) => (
              <Pressable
                style={[
                  styles.resultRow,
                  index === 0 && cleanTag ? styles.activeRow : null,
                ]}
                onPress={() => submitHashtag(item)}
              >
                <View style={styles.resultIcon}>
                  <Hash size={18} color={iconColor} strokeWidth={2.2} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle}>#{item}</Text>
                  <Text style={styles.resultSubtitle}>
                    {cleanTag ? 'View tag feed' : 'Recent hashtag'}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        ) : (
          <FlatList
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => inputRef.current?.blur()}
            data={items}
            keyExtractor={(item, index) =>
              item.id() || `${item.pubkey() ?? 'missing'}:${index}`
            }
            ListEmptyComponent={<EmptyState loading={loading} text={emptyText} />}
            renderItem={({item, index}) => (
              <ProfileRow
                item={item}
                active={index === 0}
                onPress={() => {
                  const pubkey = item.pubkey();
                  if (pubkey) submitProfile(pubkey);
                }}
              />
            )}
          />
        )}
      </View>
    </View>
    </CmdKStylesContext.Provider>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useCmdKStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={[styles.modeButton, active ? styles.modeButtonActive : null]}
    >
      <Text style={[styles.modeText, active ? styles.modeTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyState({loading, text}: {loading: boolean; text: string}) {
  const styles = useCmdKStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.emptyState}>
      {loading ? <ActivityIndicator color={theme.colors.primaryContent} /> : null}
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ProfileRow({
  active,
  item,
  onPress,
}: {
  active: boolean;
  item: ParsedEvent;
  onPress: () => void;
}) {
  const styles = useCmdKStyles();
  const theme = useAppTheme();
  const kind0 = asKind0(item);
  const name = kind0?.displayName() || kind0?.name() || 'unnamed';
  const username = kind0?.name();
  const nip05 = kind0?.nip05();
  const picture = kind0?.picture();
  const pubkey = item.pubkey();

  return (
    <Pressable
      style={[styles.resultRow, active ? styles.activeRow : null]}
      onPress={onPress}
    >
      <View style={styles.avatar}>
        {picture ? (
          <Image source={{uri: picture}} style={styles.fill} contentFit="cover" />
        ) : (
          <User size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
        )}
      </View>
      <View style={styles.resultText}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.resultSubtitle} numberOfLines={1}>
          {nip05 || username || pubkey?.slice(0, 16) || 'unknown pubkey'}
        </Text>
      </View>
    </Pressable>
  );
}

function readableContentColor(theme: AppTheme) {
  const normalized = theme.colors.base100.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return '#ffffff';
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance < 140 ? '#ffffff' : '#1a1a1a';
}

function createCmdKStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.base100,
    justifyContent: 'flex-start',
  },
  panel: {
    flex: 1,
    backgroundColor: theme.colors.base100,
    overflow: 'hidden',
  },
  inputRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
  },
  input: {
    flex: 1,
    minHeight: 48,
    color: contentColor,
    fontSize: 19,
    fontWeight: '500',
  },
  closeButton: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
  },
  modeButton: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: theme.colors.base200,
  },
  modeButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  modeText: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    fontWeight: '700',
  },
  modeTextActive: {
    color: '#ffffff',
  },
  resultRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
  },
  activeRow: {
    backgroundColor: theme.colors.base200,
  },
  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.base200,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.base200,
  },
  fill: {
    height: '100%',
    width: '100%',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    color: contentColor,
    fontSize: 16,
    fontWeight: '700',
  },
  resultSubtitle: {
    marginTop: 2,
    color: theme.colors.primaryContent,
    fontSize: 13,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: {
    color: theme.colors.primaryContent,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  });
}
