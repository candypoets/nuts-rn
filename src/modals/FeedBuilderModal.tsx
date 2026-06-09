import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  ListParsed,
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asEoce,
  asNip51,
  asParsedEvent,
  ConnectionTracker,
  fbArray,
} from '@candypoets/nipworker/utils';
import {
  Check,
  ChevronDown,
  Search,
  Users,
  X,
} from 'lucide-react-native';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import {
  ALL_FEED_KINDS,
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  type FeedKind,
  type FeedPackSelection,
  useAuthStore,
  useFeedBuilderStore,
  useNostrStore,
} from '../stores';
import {useAppTheme} from '../theme';
import { FeedKindIcon } from '../components/FeedKindIcon';

type FeedBuilderModalProps = {
  onClose: () => void;
};

type Tab = 'packs' | 'content';

type SeenList = {
  createdAt: number;
  index: number;
};

type UnifiedSelection =
  | { type: 'pack'; id: string; title: string }
  | { type: 'kind'; kind: FeedKind; title: string };

export type PackItem = ParsedEvent | { selection: FeedPackSelection };
type FeedBuilderListItem = PackItem | FeedKind;

const followListImage = require('../../assets/followlist.png');

function feedBuilderDebug(message: string, data?: Record<string, unknown>) {
  console.log(`[feed-builder] ${message}`, data ?? {});
}

export function FeedBuilderModal({ onClose }: FeedBuilderModalProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const selectedPacks = useFeedBuilderStore(state => state.selectedPacks);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const applySelection = useFeedBuilderStore(state => state.applySelection);
  const follows = useNostrStore(state => state.follows);
  const followListPack = useMemo(
    () => createFollowListPack(follows),
    [follows],
  );
  const followSetsRef = useRef<ParsedEvent[]>([]);
  const publicPacksRef = useRef<ParsedEvent[]>([]);
  const seenFollowSetsRef = useRef(new Map<string, SeenList>());
  const seenPublicPacksRef = useRef(new Map<string, SeenList>());
  const [tab, setTab] = useState<Tab>('packs');
  const [search, setSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [draftPacks, setDraftPacks] =
    useState<FeedPackSelection[]>(selectedPacks);
  const [draftKinds, setDraftKinds] = useState<FeedKind[]>(selectedKinds);
  const draftPacksRef = useRef(draftPacks);
  const draftKindsRef = useRef(draftKinds);
  const committedRef = useRef(false);
  const unsubscribePaginationRef = useRef<(() => void) | null>(null);
  const paginationCounterRef = useRef(0);
  const prevPaginationSubIdRef = useRef<string | null>(null);
  const publicPacksUntilRef = useRef<number | undefined>(undefined);
  const rawPageEventsRef = useRef(0);
  const paginationTrackerRef = useRef(new ConnectionTracker());
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const paginationProgressTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const paginationCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [loadingMorePacks, setLoadingMorePacks] = useState(false);
  const [hasMorePacks, setHasMorePacks] = useState(true);

  useEffect(() => {
    draftPacksRef.current = draftPacks;
  }, [draftPacks]);

  useEffect(() => {
    draftKindsRef.current = draftKinds;
  }, [draftKinds]);

  const commitDraft = useCallback(() => {
    committedRef.current = true;
    const kinds = draftKindsRef.current;
    const packs = draftPacksRef.current;
    requestAnimationFrame(() => {
      setTimeout(() => applySelection(kinds, packs), 0);
    });
  }, [applySelection]);

  useEffect(
    () => () => {
      if (!committedRef.current) {
        const kinds = draftKindsRef.current;
        const packs = draftPacksRef.current;
        requestAnimationFrame(() => {
          setTimeout(() => applySelection(kinds, packs), 0);
        });
      }
    },
    [applySelection],
  );

  const packEventCount = useCallback(
    () => followSetsRef.current.length + publicPacksRef.current.length,
    [],
  );

  const clearPaginationTimeout = useCallback(() => {
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
    if (paginationProgressTimeoutRef.current) {
      clearTimeout(paginationProgressTimeoutRef.current);
      paginationProgressTimeoutRef.current = null;
    }
    if (paginationCheckTimeoutRef.current) {
      clearTimeout(paginationCheckTimeoutRef.current);
      paginationCheckTimeoutRef.current = null;
    }
  }, []);

  const completePagination = useCallback(() => {
    clearPaginationTimeout();
    setLoadingMorePacks(false);
  }, [clearPaginationTimeout]);

  const updateList = useCallback(
    (parsedEvent: ParsedEvent, list: ListParsed) => {
      const kind = parsedEvent.kind();
      if (kind !== 30000 && kind !== 39089) return;
      if (kind === 39089 && parsedEvent.id() === 'followlist') return;

      const dTag = list.d();
      if (!dTag) return;
      const targetRef = kind === 30000 ? followSetsRef : publicPacksRef;
      const seenRef = kind === 30000 ? seenFollowSetsRef : seenPublicPacksRef;
      const existing = seenRef.current.get(dTag);

      if (existing) {
        if (parsedEvent.createdAt() <= existing.createdAt) return;
        targetRef.current[existing.index] = parsedEvent;
      } else {
        targetRef.current = [...targetRef.current, parsedEvent];
      }

      targetRef.current = targetRef.current.sort(
        (left, right) => right.createdAt() - left.createdAt(),
      );
      seenRef.current.clear();
      targetRef.current.forEach((event, index) => {
        const eventDTag = asNip51(event)?.d();
        if (!eventDTag) return;
        seenRef.current.set(eventDTag, { createdAt: event.createdAt(), index });
      });
      setRevision(current => current + 1);
    },
    [],
  );

  const handleFollowListMessage = useCallback(
    (message: WorkerMessage, forPagination = false) => {
      if (asEoce(message)) {
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        if (forPagination) {
          paginationTrackerRef.current.handleMessage(message);
          if (paginationTrackerRef.current.resolutionRate > 0.5) {
            completePagination();
          }
        }
        return;
      }

      const parsedEvent = asParsedEvent(message);
      if (!parsedEvent) return;
      const list = asNip51(parsedEvent);
      if (!list?.title()) return;
      if (forPagination) {
        rawPageEventsRef.current += 1;
        if (!paginationProgressTimeoutRef.current) {
          paginationProgressTimeoutRef.current = setTimeout(() => {
            paginationProgressTimeoutRef.current = null;
            completePagination();
          }, 500);
        }
        const nextUntil = parsedEvent.createdAt() - 1;
        if (parsedEvent.kind() === 39089) {
          publicPacksUntilRef.current =
            publicPacksUntilRef.current === undefined
              ? nextUntil
              : Math.min(publicPacksUntilRef.current, nextUntil);
        }
        feedBuilderDebug('page event', {
          id: parsedEvent.id(),
          kind: parsedEvent.kind(),
          createdAt: parsedEvent.createdAt(),
          d: list.d(),
        });
      }
      updateList(parsedEvent, list);
    },
    [completePagination, updateList],
  );

  useEffect(() => {
    if (loadingMorePacks) return;
    if (paginationCounterRef.current === 0) return;
    if (paginationCheckTimeoutRef.current) {
      clearTimeout(paginationCheckTimeoutRef.current);
    }

    paginationCheckTimeoutRef.current = setTimeout(() => {
      paginationCheckTimeoutRef.current = null;
      if (rawPageEventsRef.current === 0) {
        setHasMorePacks(false);
      }
    }, 500);
  }, [loadingMorePacks]);

  useEffect(() => {
    const seenFollowSets = seenFollowSetsRef.current;
    const seenPublicPacks = seenPublicPacksRef.current;

    followSetsRef.current = [];
    publicPacksRef.current = [];
    seenFollowSets.clear();
    seenPublicPacks.clear();
    unsubscribePaginationRef.current?.();
    unsubscribePaginationRef.current = null;
    paginationCounterRef.current = 0;
    prevPaginationSubIdRef.current = null;
    publicPacksUntilRef.current = undefined;
    rawPageEventsRef.current = 0;
    paginationTrackerRef.current.reset();
    clearPaginationTimeout();
    setLoadingMorePacks(false);
    setHasMorePacks(true);
    setRevision(current => current + 1);

    const requests = buildFollowListRequests(pubkey);
    const subId = `followlists_${pubkey ?? 'public'}`;
    const unsubscribe = subscribeToNostr(
      subId,
      requests,
      message => handleFollowListMessage(message),
      { closeOnEose: false },
    );
    prevPaginationSubIdRef.current = subId;

    return () => {
      followSetsRef.current = [];
      publicPacksRef.current = [];
      seenFollowSets.clear();
      seenPublicPacks.clear();
      unsubscribePaginationRef.current?.();
      unsubscribePaginationRef.current = null;
      clearPaginationTimeout();
      unsubscribe();
    };
  }, [clearPaginationTimeout, handleFollowListMessage, pubkey]);

  const packItems = useMemo(
    () => {
      void revision;
      return [
        followListPack,
        ...followSetsRef.current,
        ...publicPacksRef.current,
      ].filter(event => includePack(event, search));
    },
    [followListPack, revision, search],
  );

  const contentKinds = useMemo(
    () =>
      ALL_FEED_KINDS.filter(kind => {
        if (!contentSearch) return true;
        const term = contentSearch.toLowerCase();
        return (
          KIND_LABELS[kind].toLowerCase().includes(term) ||
          KIND_DESCRIPTIONS[kind].toLowerCase().includes(term)
        );
      }),
    [contentSearch],
  );
  const selectedPackIds = useMemo(
    () => new Set(draftPacks.map(pack => pack.id)),
    [draftPacks],
  );
  const selectedKindSet = useMemo(() => new Set(draftKinds), [draftKinds]);

  const selections = useMemo<UnifiedSelection[]>(
    () => [
      ...draftPacks.map(pack => ({
        type: 'pack' as const,
        id: pack.id,
        title: pack.title,
      })),
      ...draftKinds.map(kind => ({
        type: 'kind' as const,
        kind,
        title: KIND_LABELS[kind],
      })),
    ],
    [draftKinds, draftPacks],
  );

  const handleClose = useCallback(() => {
    onClose();
    commitDraft();
  }, [commitDraft, onClose]);

  const handleTogglePack = useCallback((pack: FeedPackSelection) => {
    setDraftPacks(current => {
      const exists = current.some(selected => selected.id === pack.id);
      return exists
        ? current.filter(selected => selected.id !== pack.id)
        : [...current, pack];
    });
  }, []);

  const handleToggleKind = useCallback((kind: FeedKind) => {
    setDraftKinds(current => {
      const exists = current.includes(kind);
      return exists
        ? current.filter(selected => selected !== kind)
        : [...current, kind].sort((left, right) => left - right);
    });
  }, []);

  const handleRemoveSelection = useCallback((selection: UnifiedSelection) => {
    if (selection.type === 'pack') {
      setDraftPacks(current =>
        current.filter(pack => pack.id !== selection.id),
      );
      return;
    }
    setDraftKinds(current => current.filter(kind => kind !== selection.kind));
  }, []);

  const handleEndReached = useCallback(() => {
    if (tab !== 'packs' || loadingMorePacks || !hasMorePacks) return;
    if (packEventCount() === 0) return;

    const lastPublicPack =
      publicPacksRef.current[publicPacksRef.current.length - 1];
    if (publicPacksUntilRef.current === undefined) {
      publicPacksUntilRef.current = lastPublicPack?.createdAt()
        ? lastPublicPack.createdAt() - 1
        : undefined;
    }

    const requests = buildFollowListRequests(pubkey, {
      publicPacksUntil: publicPacksUntilRef.current,
    });
    if (requests.length === 0) {
      setHasMorePacks(false);
      return;
    }

    setLoadingMorePacks(true);
    rawPageEventsRef.current = 0;
    paginationTrackerRef.current.reset();
    paginationCounterRef.current += 1;
    unsubscribePaginationRef.current?.();
    const pageSubId = [
      `followlists_${pubkey ?? 'public'}_page`,
      paginationCounterRef.current,
      publicPacksUntilRef.current ?? 'none',
    ].join('_');
    feedBuilderDebug('create page subscription', {
      subId: pageSubId,
      previousSubId: prevPaginationSubIdRef.current,
      publicPacksUntil: publicPacksUntilRef.current,
      requests: requests.map(request => ({
        kinds: request.kinds,
        authors: request.authors?.length ?? 0,
        until: request.until,
        limit: request.limit,
        relays: request.relays,
      })),
    });
    unsubscribePaginationRef.current = subscribeToNostr(
      pageSubId,
      requests,
      message => handleFollowListMessage(message, true),
      {
        closeOnEose: false,
        pagination: prevPaginationSubIdRef.current,
      },
    );
    prevPaginationSubIdRef.current = pageSubId;
    paginationTimeoutRef.current = setTimeout(completePagination, 2000);
  }, [
    completePagination,
    hasMorePacks,
    loadingMorePacks,
    packEventCount,
    pubkey,
    tab,
    handleFollowListMessage,
  ]);

  const renderHeader = useCallback(
    () => (
      <FeedBuilderHeader
        contentSearch={contentSearch}
        onClose={handleClose}
        onContentSearchChange={setContentSearch}
        onPackSearchChange={setSearch}
        onRemoveSelection={handleRemoveSelection}
        onTabChange={setTab}
        packSearch={search}
        selections={selections}
        tab={tab}
      />
    ),
    [
      contentSearch,
      handleClose,
      handleRemoveSelection,
      search,
      selections,
      tab,
    ],
  );

  const empty = (
    <View className="px-2 py-10">
      <Text className="text-center text-sm text-primary-content">
        {tab === 'packs'
          ? 'Waiting for follow packs.'
          : 'No content types found.'}
      </Text>
    </View>
  );
  const listData = useMemo<FeedBuilderListItem[]>(
    () => (tab === 'packs' ? packItems : contentKinds),
    [contentKinds, packItems, tab],
  );
  const renderItem = useCallback(
    ({ item }: { item: FeedBuilderListItem; index: number }) => {
      if (tab === 'content') {
        const kind = item as FeedKind;
        return (
          <KindListItem
            kind={kind}
            selected={selectedKindSet.has(kind)}
            onToggle={handleToggleKind}
          />
        );
      }

      const packItem = item as PackItem;
      return (
        <PackListItem
          item={packItem}
          selectedPackIds={selectedPackIds}
          onToggle={handleTogglePack}
        />
      );
    },
    [handleToggleKind, handleTogglePack, selectedKindSet, selectedPackIds, tab],
  );
  const keyExtractor = useCallback(
    (item: FeedBuilderListItem, index: number) =>
      tab === 'content'
        ? `kind_${item as FeedKind}`
        : packItemKey(item as PackItem, index),
    [tab],
  );

  return (
    <View className="h-full bg-base-100">
      <FlatList
        className="flex-1"
        contentContainerClassName="px-3 pb-10"
        data={listData}
        initialNumToRender={5}
        keyboardShouldPersistTaps="handled"
        key={tab}
        keyExtractor={keyExtractor}
        ListEmptyComponent={empty}
        ListHeaderComponent={renderHeader}
        maxToRenderPerBatch={5}
        onEndReached={tab === 'packs' ? handleEndReached : undefined}
        onEndReachedThreshold={0.4}
        removeClippedSubviews
        renderItem={renderItem}
        ItemSeparatorComponent={FeedBuilderItemSeparator}
        windowSize={7}
      />
    </View>
  );
}

function FeedBuilderItemSeparator() {
  return <View className="h-3" />;
}

const PackListItem = memo(function PackListItem({
  item,
  selectedPackIds,
  onToggle,
}: {
  item: PackItem;
  selectedPackIds: Set<string>;
  onToggle: (selection: FeedPackSelection) => void;
}) {
  const selection = useMemo(
    () => ('selection' in item ? item.selection : packSelectionFromEvent(item)),
    [item],
  );
  const selected = !!selection && selectedPackIds.has(selection.id);
  const handlePress = useCallback(() => {
    if (selection) onToggle(selection);
  }, [onToggle, selection]);

  if (!selection) return null;

  return (
    <PackCard
      event={item}
      selected={selected}
      selection={selection}
      onPress={handlePress}
    />
  );
});

const KindListItem = memo(function KindListItem({
  kind,
  selected,
  onToggle,
}: {
  kind: FeedKind;
  selected: boolean;
  onToggle: (kind: FeedKind) => void;
}) {
  const handlePress = useCallback(() => onToggle(kind), [kind, onToggle]);

  return <KindCard kind={kind} selected={selected} onPress={handlePress} />;
});

export function buildFollowListRequests(
  pubkey: string | null,
  cursors?: {
    publicPacksUntil?: number;
  },
): RequestObject[] {
  const forPagination = !!cursors;
  return [
    ...(pubkey && !forPagination
      ? [
          {
            kinds: [30000],
            authors: [pubkey],
            limit: 50,
            noCache: true,
            relays: DEFAULT_FEED_RELAYS,
          },
        ]
      : []),
    ...(!forPagination || cursors?.publicPacksUntil !== undefined
      ? [
          {
            kinds: [39089],
            limit: 50,
            until: cursors?.publicPacksUntil,
            noCache: true,
            relays: DEFAULT_FEED_RELAYS,
          },
        ]
      : []),
  ];
}

function createFollowListPack(follows: string[]): {
  selection: FeedPackSelection;
} {
  return {
    selection: {
      id: 'followlist',
      kind: 39089,
      title: 'Follow List',
      description: 'People you follow',
      image: null,
      localImage: 'followlist',
      people: follows,
      dTag: 'followlist',
    },
  };
}

export function includePack(event: PackItem, search: string) {
  if ('selection' in event) {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      event.selection.title.toLowerCase().includes(term) ||
      (event.selection.description?.toLowerCase().includes(term) ?? false)
    );
  }

  const list = asNip51(event);
  if (!list?.title()) return false;
  const kind = event.kind();

  if (kind === 39089) {
    const image = list.image();
    if (!image || image.startsWith('data:')) return false;
    if (list.peopleLength() < 10) return false;
  }

  if (!search) return true;
  const term = search.toLowerCase();
  return (
    (list.title()?.toLowerCase().includes(term) ?? false) ||
    (list.description()?.toLowerCase().includes(term) ?? false)
  );
}

export function packSelectionFromEvent(event: ParsedEvent): FeedPackSelection | null {
  const list = asNip51(event);
  const title = list?.title() || list?.d() || null;
  if (!list || !title) return null;
  return {
    id: event.id() || `${event.kind()}_${list.d() ?? title}`,
    kind: event.kind(),
    title,
    description: list.description() || null,
    image: list.image() || null,
    people: fbArray(list, 'people').filter(
      (person): person is string => typeof person === 'string',
    ),
    dTag: list.d() || null,
  };
}

function packItemKey(item: PackItem, index: number) {
  if ('selection' in item) return item.selection.id;
  return item.id() || `${item.kind()}_${item.createdAt()}_${index}`;
}

function FeedBuilderHeader({
  contentSearch,
  onClose,
  onContentSearchChange,
  onPackSearchChange,
  onRemoveSelection,
  onTabChange,
  packSearch,
  selections,
  tab,
}: {
  contentSearch: string;
  onClose: () => void;
  onContentSearchChange: (value: string) => void;
  onPackSearchChange: (value: string) => void;
  onRemoveSelection: (selection: UnifiedSelection) => void;
  onTabChange: (tab: Tab) => void;
  packSearch: string;
  selections: UnifiedSelection[];
  tab: Tab;
}) {
  const theme = useAppTheme();
  return (
    <View className="bg-base-100 px-1 pt-4">
      <View className="h-14 flex-row items-center justify-between px-2">
        <Pressable
          accessibilityRole="button"
          className="h-10 w-10 items-center justify-center rounded-full bg-base-300"
          hitSlop={12}
          onPress={onClose}
        >
          <ChevronDown size={22} color={theme.colors.primaryContent} strokeWidth={2.2} />
        </Pressable>
        <Text className="text-lg font-bold text-base-content">Feed Builder</Text>
        <View className="h-10 w-10" />
      </View>
      <View className="mt-2 flex-row rounded-lg bg-base-200/80 p-1">
        <TabButton
          active={tab === 'packs'}
          label="Follow Packs"
          onPress={() => onTabChange('packs')}
        />
        <TabButton
          active={tab === 'content'}
          label="Content Types"
          onPress={() => onTabChange('content')}
        />
      </View>
      <SelectionChips selections={selections} onRemove={onRemoveSelection} />
      <SearchBox
        value={tab === 'packs' ? packSearch : contentSearch}
        placeholder={
          tab === 'packs' ? 'Search follow packs...' : 'Search content types...'
        }
        onChangeText={
          tab === 'packs' ? onPackSearchChange : onContentSearchChange
        }
      />
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`flex-1 items-center rounded-md px-3 py-2 ${
        active ? 'bg-base-300 shadow-sm' : ''
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-sm font-semibold ${
          active ? 'text-base-content' : 'text-primary-content'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SelectionChips({
  selections,
  onRemove,
}: {
  selections: UnifiedSelection[];
  onRemove: (selection: UnifiedSelection) => void;
}) {
  if (!selections.length) {
    return <View className="h-2" />;
  }

  return (
    <View className="mt-3 flex-row flex-wrap gap-2 px-1">
      {selections.map(selection => (
        <Pressable
          key={
            selection.type === 'pack' ? selection.id : `kind_${selection.kind}`
          }
          className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1.5"
          onPress={() => onRemove(selection)}
        >
          <Text className="max-w-[180px] text-xs font-semibold text-white">
            {selection.title}
          </Text>
          <X size={13} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      ))}
    </View>
  );
}

function SearchBox({
  onChangeText,
  placeholder,
  value,
}: {
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const theme = useAppTheme();
  return (
    <View className="mx-1 mb-3 mt-3 h-11 flex-row items-center gap-2 rounded-lg border border-base-200 bg-base-300 px-3">
      <Search size={17} color={theme.colors.primaryContent} strokeWidth={2.1} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-base text-base-content"
        placeholder={placeholder}
        placeholderTextColor={theme.colors.primaryContent}
        value={value}
        onChangeText={onChangeText}
      />
      {value ? (
        <Pressable hitSlop={10} onPress={() => onChangeText('')}>
          <X size={17} color={theme.colors.primaryContent} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function PackCard({
  event,
  onPress,
  selected,
  selection,
}: {
  event: PackItem;
  onPress: () => void;
  selected: boolean;
  selection: FeedPackSelection;
}) {
  const theme = useAppTheme();
  const hasImage = selection.image && !selection.image.startsWith('data:');
  const hasLocalImage = selection.localImage === 'followlist';
  const isFollowList = selection.id === 'followlist';
  const isFollowSet = !('selection' in event) && event.kind() === 30000;

  return (
    <Pressable className="px-1 py-2" onPress={onPress}>
      <View
        className={`overflow-hidden rounded-lg border bg-base-300 ${
          selected ? 'border-primary' : 'border-base-200'
        }`}
      >
        <View className="h-32 bg-base-200">
          {hasLocalImage || hasImage ? (
            <Image
              className="h-full w-full"
              resizeMode="cover"
              source={
                hasLocalImage
                  ? followListImage
                  : { uri: selection.image ?? undefined }
              }
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-base-200">
              <Users size={36} color={theme.colors.primaryContent} strokeWidth={1.8} />
            </View>
          )}
          <View className="absolute bottom-0 left-0 right-0 bg-black/55 px-3 py-2">
            <Text className="text-base font-bold text-white" numberOfLines={1}>
              {selection.title}
            </Text>
          </View>
          {selected ? (
            <View className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full bg-primary">
              <Check size={18} color="#ffffff" strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <View className="gap-2 px-3 py-3">
          {selection.description ? (
            <Text
              className="text-sm leading-5 text-primary-content"
              numberOfLines={2}
            >
              {selection.description}
            </Text>
          ) : null}
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-primary-content">
              {selection.people.length} people
            </Text>
            <Text className="text-xs font-semibold text-primary-content">
              {isFollowList
                ? 'Your follows'
                : isFollowSet
                ? 'Follow set'
                : 'Public pack'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function KindCard({
  kind,
  onPress,
  selected,
}: {
  kind: FeedKind;
  onPress: () => void;
  selected: boolean;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      className={`relative rounded-lg border bg-base-300 p-4 ${
        selected ? 'border-primary' : 'border-base-200'
      }`}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-lg bg-base-200">
          <FeedKindIcon
            kind={kind}
            size={24}
            color={theme.colors.primaryContent}
            strokeWidth={2.1}
          />
        </View>
        <View className="flex-1">
          <Text className="text-base font-bold text-base-content">
            {KIND_LABELS[kind]}
          </Text>
          <Text className="mt-1 text-sm text-primary-content">
            {KIND_DESCRIPTIONS[kind]}
          </Text>
        </View>
      </View>
      {selected ? (
        <View className="absolute right-3 top-3 h-6 w-6 items-center justify-center rounded-full bg-base-100">
          <Check size={16} color="#047857" strokeWidth={2.4} />
        </View>
      ) : null}
    </Pressable>
  );
}
