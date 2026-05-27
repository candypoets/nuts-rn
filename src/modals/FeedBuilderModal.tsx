import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import type {ListParsed, ParsedEvent, RequestObject} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asNip51, asParsedEvent, fbArray} from '@candypoets/nipworker/utils';
import {
  Check,
  ChevronDown,
  FileText,
  Search,
  Users,
  X,
} from 'lucide-react-native';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {
  ALL_FEED_KINDS,
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  type FeedKind,
  type FeedPackSelection,
  useAuthStore,
  useFeedBuilderStore,
} from '../stores';

type FeedBuilderModalProps = {
  onClose: () => void;
};

type Tab = 'packs' | 'content';

type SeenList = {
  createdAt: number;
  index: number;
};

type UnifiedSelection =
  | {type: 'pack'; id: string; title: string}
  | {type: 'kind'; kind: FeedKind; title: string};

export function FeedBuilderModal({onClose}: FeedBuilderModalProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const selectedPacks = useFeedBuilderStore(state => state.selectedPacks);
  const selectedKinds = useFeedBuilderStore(state => state.selectedKinds);
  const togglePack = useFeedBuilderStore(state => state.togglePack);
  const removePack = useFeedBuilderStore(state => state.removePack);
  const toggleKind = useFeedBuilderStore(state => state.toggleKind);
  const followSetsRef = useRef<ParsedEvent[]>([]);
  const publicPacksRef = useRef<ParsedEvent[]>([]);
  const seenFollowSetsRef = useRef(new Map<string, SeenList>());
  const seenPublicPacksRef = useRef(new Map<string, SeenList>());
  const [tab, setTab] = useState<Tab>('packs');
  const [search, setSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [, setRevision] = useState(0);

  const updateList = useCallback((parsedEvent: ParsedEvent, list: ListParsed) => {
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
      seenRef.current.set(eventDTag, {createdAt: event.createdAt(), index});
    });
    setRevision(current => current + 1);
  }, []);

  useEffect(() => {
    const seenFollowSets = seenFollowSetsRef.current;
    const seenPublicPacks = seenPublicPacksRef.current;

    followSetsRef.current = [];
    publicPacksRef.current = [];
    seenFollowSets.clear();
    seenPublicPacks.clear();
    setRevision(current => current + 1);

    const requests = buildFollowListRequests(pubkey);
    const unsubscribe = subscribeToNostr(
      `followlists_${pubkey ?? 'public'}`,
      requests,
      message => {
        const parsedEvent = asParsedEvent(message);
        if (!parsedEvent) return;
        const list = asNip51(parsedEvent);
        if (!list?.title()) return;
        updateList(parsedEvent, list);
      },
      {closeOnEose: false, bytesPerEvent: 10 * 1024},
    );

    return () => {
      followSetsRef.current = [];
      publicPacksRef.current = [];
      seenFollowSets.clear();
      seenPublicPacks.clear();
      unsubscribe();
    };
  }, [pubkey, updateList]);

  const packItems = [...followSetsRef.current, ...publicPacksRef.current].filter(
    event => includePack(event, search),
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
  const selections = useMemo<UnifiedSelection[]>(
    () => [
      ...selectedPacks.map(pack => ({
        type: 'pack' as const,
        id: pack.id,
        title: pack.title,
      })),
      ...selectedKinds.map(kind => ({
        type: 'kind' as const,
        kind,
        title: KIND_LABELS[kind],
      })),
    ],
    [selectedKinds, selectedPacks],
  );

  const renderHeader = useCallback(
    () => (
      <FeedBuilderHeader
        contentSearch={contentSearch}
        onClose={onClose}
        onContentSearchChange={setContentSearch}
        onPackSearchChange={setSearch}
        onRemoveSelection={selection => {
          if (selection.type === 'pack') removePack(selection.id);
          else toggleKind(selection.kind);
        }}
        onTabChange={setTab}
        packSearch={search}
        selections={selections}
        tab={tab}
      />
    ),
    [
      contentSearch,
      onClose,
      removePack,
      search,
      selections,
      tab,
      toggleKind,
    ],
  );

  const empty = (
    <View className="px-2 py-10">
      <Text className="text-center text-sm text-slate-500">
        {tab === 'packs' ? 'Waiting for follow packs.' : 'No content types found.'}
      </Text>
    </View>
  );

  return (
    <View className="h-full bg-slate-50">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-3 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        {renderHeader()}
        <View className="gap-3">
          {tab === 'packs' ? (
            packItems.length ? (
              packItems.map((item, index) => {
                const selection = packSelectionFromEvent(item);
                if (!selection) return null;
                const selected = selectedPacks.some(
                  pack => pack.id === selection.id,
                );
                return (
                  <PackCard
                    key={
                      item.id() || `${item.kind()}_${item.createdAt()}_${index}`
                    }
                    event={item}
                    selected={selected}
                    selection={selection}
                    onPress={() => togglePack(selection)}
                  />
                );
              })
            ) : (
              empty
            )
          ) : contentKinds.length ? (
            contentKinds.map(kind => (
              <KindCard
                key={kind}
                kind={kind}
                selected={selectedKinds.includes(kind)}
                onPress={() => toggleKind(kind)}
              />
            ))
          ) : (
            empty
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function buildFollowListRequests(pubkey: string | null): RequestObject[] {
  return [
    ...(pubkey
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
    {
      kinds: [39089],
      limit: 50,
      noCache: true,
      relays: DEFAULT_FEED_RELAYS,
    },
  ];
}

function includePack(event: ParsedEvent, search: string) {
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

function packSelectionFromEvent(event: ParsedEvent): FeedPackSelection | null {
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
  return (
    <View className="bg-slate-50 px-1 pt-4">
      <View className="h-14 flex-row items-center justify-between px-2">
        <Pressable
          accessibilityRole="button"
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
          hitSlop={12}
          onPress={onClose}
        >
          <ChevronDown size={22} color="#17212b" strokeWidth={2.2} />
        </Pressable>
        <Text className="text-lg font-bold text-slate-900">Feed Builder</Text>
        <View className="h-10 w-10" />
      </View>
      <View className="mt-2 flex-row rounded-lg bg-slate-200/80 p-1">
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
        onChangeText={tab === 'packs' ? onPackSearchChange : onContentSearchChange}
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
        active ? 'bg-white shadow-sm' : ''
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-sm font-semibold ${
          active ? 'text-slate-900' : 'text-slate-500'
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
          key={selection.type === 'pack' ? selection.id : `kind_${selection.kind}`}
          className="flex-row items-center gap-1 rounded-full bg-emerald-700 px-3 py-1.5"
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
  return (
    <View className="mx-1 mb-3 mt-3 h-11 flex-row items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
      <Search size={17} color="#8794a0" strokeWidth={2.1} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-base text-slate-900"
        placeholder={placeholder}
        placeholderTextColor="#8794a0"
        value={value}
        onChangeText={onChangeText}
      />
      {value ? (
        <Pressable hitSlop={10} onPress={() => onChangeText('')}>
          <X size={17} color="#52616f" strokeWidth={2.2} />
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
  event: ParsedEvent;
  onPress: () => void;
  selected: boolean;
  selection: FeedPackSelection;
}) {
  const hasImage = selection.image && !selection.image.startsWith('data:');
  const isFollowSet = event.kind() === 30000;

  return (
    <Pressable className="px-1 py-2" onPress={onPress}>
      <View
        className={`overflow-hidden rounded-lg border bg-white ${
          selected ? 'border-emerald-600' : 'border-slate-200'
        }`}
      >
        <View className="h-32 bg-slate-200">
          {hasImage ? (
            <Image
              className="h-full w-full"
              resizeMode="cover"
              source={{uri: selection.image ?? undefined}}
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-slate-200">
              <Users size={36} color="#8794a0" strokeWidth={1.8} />
            </View>
          )}
          <View className="absolute bottom-0 left-0 right-0 bg-black/55 px-3 py-2">
            <Text
              className="text-base font-bold text-white"
              numberOfLines={1}
            >
              {selection.title}
            </Text>
          </View>
          {selected ? (
            <View className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full bg-emerald-700">
              <Check size={18} color="#ffffff" strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <View className="gap-2 px-3 py-3">
          {selection.description ? (
            <Text className="text-sm leading-5 text-slate-600" numberOfLines={2}>
              {selection.description}
            </Text>
          ) : null}
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-slate-500">
              {selection.people.length} people
            </Text>
            <Text className="text-xs font-semibold text-slate-500">
              {isFollowSet ? 'Follow set' : 'Public pack'}
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
  return (
    <Pressable
      className={`rounded-lg border bg-white p-4 ${
        selected ? 'border-emerald-600' : 'border-slate-200'
      }`}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
          <FileText size={24} color="#17212b" strokeWidth={2.1} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-bold text-slate-900">
            {KIND_LABELS[kind]}
          </Text>
          <Text className="mt-1 text-sm text-slate-500">
            {KIND_DESCRIPTIONS[kind]}
          </Text>
        </View>
        {selected ? <Check size={20} color="#047857" strokeWidth={2.4} /> : null}
      </View>
    </Pressable>
  );
}
