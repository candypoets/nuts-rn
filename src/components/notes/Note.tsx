import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ContentBlock, ParsedEvent, WorkerMessage } from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asNostrData,
  asParsedEvent,
  fbArray,
  isKind10002,
} from '@candypoets/nipworker/utils';
import { ContentData } from '@candypoets/nipworker';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import {
  relaysFromKind10002,
  useEffectiveAuthorRelays,
} from '../../hooks/useAuthorRelays';
import {pushDistinct} from '../../navigation/pushDistinct';
import type { RootStackParamList } from '../../navigation/types';
import { BOOTSTRAP_RELAYS } from '../../stores';
import { ContentBlocks } from './ContentBlocks';
import { Footer } from './Footer';
import { Header } from './Header';
import type { RelayStatusSink } from './RelaysList';
import { wasRecentSwipeGesture } from './press';
import { neventEncode } from 'nostr-tools/nip19';

const EMPTY_RELAYS: string[] = [];
const EMPTY_CONTEXT: ParsedEvent[] = [];

function isRelayUrl(value: unknown): value is string {
  return typeof value === 'string' && /^wss?:\/\//.test(value);
}

function relayList(values: unknown[]) {
  return [...new Set(values.filter(isRelayUrl))];
}

function nostrDataRelays(nostr: ReturnType<typeof asNostrData>) {
  if (!nostr) return [];
  return relayList(
    Array.from({ length: nostr.relaysLength() }, (_, index) =>
      nostr.relays(index),
    ),
  );
}

function isUserEntity(entity?: string | null) {
  return !!entity?.match(/n(profile|pub)/);
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

type NoteProps = {
  note?: ParsedEvent;
  noteId?: string;
  context?: ParsedEvent[];
  relays?: string[];
  visible?: boolean;
  footer?: boolean;
  main?: boolean;
  showQuote?: boolean;
  showMedia?: boolean;
  showRoot?: boolean;
  threadCard?: boolean;
  disableOpen?: boolean;
  depth?: number;
  leading?: boolean;
  tailing?: boolean;
  ancestorIds?: string[];
};

function parsedEventId(event?: ParsedEvent) {
  return event?.id?.() ?? null;
}

type RenderQuote = (quote: {
  id: string;
  author?: string;
  relays: string[];
  depth: number;
  key: string;
}) => React.ReactNode;

type NoteBodyProps = {
  ancestor?: React.ReactNode;
  containerClassName: string;
  depth: number;
  effectiveNote: ParsedEvent;
  subId: string;
  footer: boolean;
  main: boolean;
  isQuote: boolean;
  parsedContent: ContentBlock[];
  renderQuote: RenderQuote;
  shortContent: ContentBlock[];
  showQuote: boolean;
  showMedia: boolean;
  threadConnectors: React.ReactNode;
  visible: boolean;
  onOpen: () => void;
  relays?: string[];
  showRelays: boolean;
  relayStatusSink: RelayStatusSink;
};

type LoadingNoteBodyProps = {
  containerClassName: string;
  effectiveId: string;
  threadConnectors: React.ReactNode;
};

type UnsupportedNoteBodyProps = {
  containerClassName: string;
  effectiveNote: ParsedEvent;
  threadConnectors: React.ReactNode;
};

const LoadingNoteBody = memo(function LoadingNoteBody({
  containerClassName,
  effectiveId,
  threadConnectors,
}: LoadingNoteBodyProps) {
  return (
    <View className={containerClassName}>
      {threadConnectors}
      <Text className="text-xs text-slate-500">
        Loading note {effectiveId ? `${effectiveId.slice(0, 12)}...` : ''}
      </Text>
    </View>
  );
});

const UnsupportedNoteBody = memo(function UnsupportedNoteBody({
  containerClassName,
  effectiveNote,
  threadConnectors,
}: UnsupportedNoteBodyProps) {
  return (
    <View className={containerClassName}>
      {threadConnectors}
      <Text className="text-sm text-slate-500">
        Kind {effectiveNote.kind()} is not supported yet.
      </Text>
    </View>
  );
});

const NoteBody = memo(
  function NoteBody({
    ancestor,
    containerClassName,
    depth,
    effectiveNote,
    subId,
    footer,
    main,
    isQuote,
    renderQuote,
    shortContent,
    parsedContent,
    showQuote,
    showMedia,
    threadConnectors,
    visible,
    onOpen,
    relays,
    showRelays,
    relayStatusSink,
  }: NoteBodyProps) {
    return (
      <>
        {ancestor}
        <View className={containerClassName}>
          {threadConnectors}
          <Header
            note={effectiveNote}
            subId={subId}
            depth={depth}
            main={main}
            relays={relays}
            showRelays={showRelays}
            relayStatusSink={relayStatusSink}
          />
          <Pressable
            className={
              main
                ? 'mt-1 flex-row gap-0'
                : isQuote
                  ? '-mt-1 flex-row gap-0'
                  : '-mt-4 flex-row gap-2'
            }
            onPress={event => {
              event.stopPropagation();
              if (!wasRecentSwipeGesture()) onOpen();
            }}
          >
            <View className={isQuote || main ? 'w-0' : 'w-8'} />
            <View className={depth >= 1 ? 'min-w-0 flex-1 pt-1' : 'min-w-0 flex-1'}>
              <ContentBlocks
                content={parsedContent}
                shortContent={shortContent}
                note={effectiveNote}
                depth={depth}
                showQuote={showQuote}
                showMedia={showMedia}
                renderQuote={renderQuote}
              />
            </View>
          </Pressable>
          {footer && depth === 0 ? (
            <Footer
              note={effectiveNote}
              visible={visible}
              main={main}
              relays={relays ?? EMPTY_RELAYS}
              relayStatusSink={relayStatusSink}
            />
          ) : null}
        </View>
      </>
    );
  },
  (previous, next) =>
    previous.ancestor === next.ancestor &&
    previous.containerClassName === next.containerClassName &&
    previous.depth === next.depth &&
    parsedEventId(previous.effectiveNote) ===
      parsedEventId(next.effectiveNote) &&
    previous.subId === next.subId &&
    previous.footer === next.footer &&
    previous.main === next.main &&
    previous.isQuote === next.isQuote &&
    previous.parsedContent === next.parsedContent &&
    previous.renderQuote === next.renderQuote &&
    previous.shortContent === next.shortContent &&
    previous.showQuote === next.showQuote &&
    previous.showMedia === next.showMedia &&
    previous.threadConnectors === next.threadConnectors &&
    previous.visible === next.visible &&
    previous.onOpen === next.onOpen &&
    previous.relays === next.relays &&
    previous.showRelays === next.showRelays &&
    previous.relayStatusSink === next.relayStatusSink,
);

function NoteComponent({
  note,
  noteId,
  context = EMPTY_CONTEXT,
  relays = EMPTY_RELAYS,
  visible = true,
  footer = true,
  main = false,
  showQuote = true,
  showMedia = true,
  showRoot = true,
  threadCard = false,
  disableOpen = false,
  depth = 0,
  leading = false,
  tailing = false,
  ancestorIds = [],
}: NoteProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const fetchedRef = useRef<ParsedEvent | null>(null);
  const contextRef = useRef<ParsedEvent[]>(context);
  const relayStatusSink = useRef<((relayUrl: string, status: string) => void) | null>(
    null,
  );
  const [contextVersion, setContextVersion] = useState(0);
  const [quoteAuthorRelays, setQuoteAuthorRelays] = useState<
    Record<string, string[]>
  >({});
  const contextNote = useMemo(
    () =>
      noteId ? context.find(event => event?.id?.() === noteId) ?? null : null,
    [context, noteId],
  );
  const fetchedNote =
    !noteId || fetchedRef.current?.id?.() === noteId
      ? fetchedRef.current
      : null;
  const effectiveNote = note || contextNote || fetchedNote;
  const effectiveId = noteId || effectiveNote?.id() || '';
  const lookupRelays = useMemo(
    () => relayList([...relays, ...DEFAULT_FEED_RELAYS]),
    [relays],
  );
  const headerRelays = useEffectiveAuthorRelays({
    subId: effectiveId || undefined,
    pubkey: effectiveNote?.pubkey(),
    marker: 'read',
    fallbackRelays: relays,
  });
  const noteRelays = headerRelays;
  const noteRelayKey = noteRelays.join('|');
  const openNote = useCallback(() => {
    if (disableOpen) {
      Keyboard.dismiss();
      return;
    }
    if (!effectiveId) return;
    pushDistinct(navigation, 'Kind1Thread', {
      nevent: neventEncode({
        id: effectiveId,
        author: effectiveNote?.pubkey() || undefined,
        relays: noteRelays,
        kind: effectiveNote?.kind() || 1,
      }),
    });
  }, [disableOpen, effectiveId, effectiveNote, navigation, noteRelays]);

  useEffect(() => {
    const nextContext = [...contextRef.current];
    let changed = false;
    context.forEach(event => {
      const id = event?.id?.();
      if (!id || nextContext.some(existing => existing?.id?.() === id)) return;
      nextContext.push(event);
      changed = true;
    });
    if (changed) {
      contextRef.current = nextContext;
      setContextVersion(version => version + 1);
    }
  }, [context]);

  const addContextEvent = useCallback((parsed: ParsedEvent) => {
    const id = parsed.id();
    if (!id) return;
    if (contextRef.current.some(event => event?.id?.() === id)) return;
    contextRef.current = [...contextRef.current, parsed];
    setContextVersion(version => version + 1);
  }, []);

  const handleRelayStatus = useCallback((message: WorkerMessage) => {
    const status = asConnectionStatus(message);
    const relayUrl = status?.relayUrl();
    const statusValue = status?.status();
    if (!relayUrl || !statusValue) return false;
    relayStatusSink.current?.(relayUrl, statusValue);
    return true;
  }, []);

  useEffect(() => {
    if (note || contextNote || fetchedNote || !noteId || !visible)
      return;

    const unsubscribe = subscribeToNostr(
      `note_${noteId}`,
      [{ ids: [noteId], limit: 1, relays: lookupRelays }],
      message => {
        if (handleRelayStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (!parsed || parsed.id() !== noteId) return;
        fetchedRef.current = parsed;
        addContextEvent(parsed);
      },
      { closeOnEose: false },
    );

    return () => {
      unsubscribe();
    };
  }, [addContextEvent, contextNote, fetchedNote, handleRelayStatus, lookupRelays, note, noteId, visible]);

  const kind1 = useMemo(
    () => (effectiveNote ? asKind1(effectiveNote) : null),
    [effectiveNote],
  );
  const replyId = kind1?.reply()?.id();
  const allMentionIds = useMemo(() => {
    if (!kind1 || typeof kind1.mentionsLength !== 'function') {
      return [];
    }

    const ids: string[] = [];
    for (let index = 0; index < kind1.mentionsLength(); index += 1) {
      const id = kind1.mentions(index)?.id?.();
      if (id) ids.push(id);
    }
    return [...new Set(ids)];
  }, [kind1]);
  const mentionQuotes = useMemo(() => {
    if (!kind1 || typeof kind1.mentionsLength !== 'function') {
      return [];
    }

    const quotes: Array<{ id: string; author?: string }> = [];
    for (let index = 0; index < kind1.mentionsLength(); index += 1) {
      const mention = kind1.mentions(index);
      const id = mention?.id?.();
      if (!id) continue;
      quotes.push({ id, author: mention?.author?.() || undefined });
    }
    return quotes;
  }, [kind1]);
  const parsedContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'parsedContent') : []),
    [kind1],
  );
  const shortContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'shortenedContent') : []),
    [kind1],
  );
  const contentQuotes = useMemo(() => {
    const blocks = shortContent.length ? shortContent : parsedContent;
    const quotes: Array<{ id: string; author?: string; relays: string[] }> = [];
    blocks.forEach(block => {
      if (block.dataType() !== ContentData.NostrData) return;
      const nostr = asNostrData(block);
      const id = nostr?.id?.();
      if (!id) return;
      if (nostr?.author?.() && isUserEntity(nostr?.entity?.())) return;
      quotes.push({
        id,
        author: nostr?.author?.() || undefined,
        relays: nostrDataRelays(nostr),
      });
    });
    return quotes;
  }, [parsedContent, shortContent]);
  const quoteAuthors = useMemo(
    () => [
      ...new Set(
        [...mentionQuotes, ...contentQuotes]
          .map(quote => quote.author)
          .filter((author): author is string => !!author),
      ),
    ],
    [contentQuotes, mentionQuotes],
  );
  const discoveredQuoteRelays = useMemo(
    () => [
      ...new Set(
        quoteAuthors.flatMap(author => quoteAuthorRelays[author] ?? []),
      ),
    ],
    [quoteAuthorRelays, quoteAuthors],
  );
  const quoteIds = useMemo(() => {
    contextVersion;
    if (!showQuote) return [];
    return [
      ...new Set([...mentionQuotes, ...contentQuotes].map(quote => quote.id)),
    ].filter(
      id =>
        id !== effectiveId &&
        !contextRef.current.some(event => event?.id?.() === id),
    );
  }, [contentQuotes, contextVersion, effectiveId, mentionQuotes, showQuote]);
  const shouldRenderAncestor = !!(
    showRoot &&
    replyId &&
    replyId !== effectiveId &&
    depth === 0 &&
    !allMentionIds.includes(replyId) &&
    !ancestorIds.includes(replyId)
  );
  const ancestorRelays = useEffectiveAuthorRelays({
    subId: shouldRenderAncestor ? replyId : undefined,
    pubkey: shouldRenderAncestor ? kind1?.reply()?.author() : undefined,
    marker: 'read',
    fallbackRelays: noteRelays,
  });
  const isQuote = depth > 0;
  const hasTopThreadConnector = shouldRenderAncestor || tailing;
  const hasBottomThreadConnector = leading;
  const containerClassName = threadCard
    ? [
        'relative rounded-xl border border-slate-200 bg-white/95 px-3 py-3',
        hasTopThreadConnector || hasBottomThreadConnector ? 'shadow-none' : 'shadow-sm',
        hasTopThreadConnector ? '-mt-px rounded-t-none border-t-0' : '',
        hasBottomThreadConnector ? 'rounded-b-none border-b-0' : '',
      ].join(' ')
    : [
        main
          ? 'relative px-0 py-1'
          : isQuote
          ? 'relative rounded-lg border-l border-t border-slate-200 bg-white/95 px-2 py-2'
          : 'relative rounded-lg border border-slate-200 bg-white/95 px-3 py-3',
        hasTopThreadConnector || hasBottomThreadConnector
          ? 'shadow-none'
          : main || isQuote
          ? 'shadow-none'
          : 'shadow-sm',
        hasTopThreadConnector ? '-mt-px border-t-0' : 'mt-1',
        hasBottomThreadConnector ? 'rounded-b-none border-b-0' : '',
        hasTopThreadConnector ? 'rounded-t-none' : '',
      ].join(' ');
  const threadConnectors = (
    <>
      {hasBottomThreadConnector ? (
        <View className="absolute bottom-0 left-7 top-8 w-0.5 bg-slate-200" />
      ) : null}
      {hasTopThreadConnector ? (
        <View className="absolute left-7 top-0 h-8 w-0.5 bg-slate-200" />
      ) : null}
    </>
  );

  useEffect(() => {
    if (!visible || !showQuote || !quoteAuthors.length) return;
    const missingAuthors = quoteAuthors.filter(
      author => quoteAuthorRelays[author] === undefined,
    );
    if (!missingAuthors.length) return;

    const timeout = setTimeout(() => {
      setQuoteAuthorRelays(current => {
        const next = { ...current };
        let changed = false;
        missingAuthors.forEach(author => {
          if (next[author] !== undefined) return;
          next[author] = [];
          changed = true;
        });
        return changed ? next : current;
      });
    }, 1000);

    const unsubscribe = subscribeToNostr(
      `quote_relays_${effectiveId}`,
      [
        {
          kinds: [10002],
          authors: missingAuthors,
          limit: missingAuthors.length,
          relays: BOOTSTRAP_RELAYS,
          cacheFirst: true,
        },
      ],
      message => {
        if (handleRelayStatus(message)) return;
        const kind10002 = isKind10002(message);
        if (!kind10002) return;
        const author = asParsedEvent(message)?.pubkey();
        if (!author) return;
        const writeRelays = relaysFromKind10002(kind10002, 'write', 3);
        setQuoteAuthorRelays(current =>
          sameStringArray(current[author] ?? [], writeRelays)
            ? current
            : {
                ...current,
                [author]: writeRelays,
              },
        );
      },
      { closeOnEose: false },
    );

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [effectiveId, handleRelayStatus, quoteAuthorRelays, quoteAuthors, showQuote, visible]);

  useEffect(() => {
    if (!visible || !showQuote || !quoteIds.length) return;

    const unsubscribe = subscribeToNostr(
      `note_quotes_${effectiveId}_${noteRelayKey}`,
      [
        {
          ids: quoteIds,
          limit: 5 * quoteIds.length,
          relays: [
            ...relayList([
              ...noteRelays,
              ...discoveredQuoteRelays,
              ...contentQuotes.flatMap(quote => quote.relays),
            ]),
          ],
        },
      ],
      message => {
        if (handleRelayStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (parsed) addContextEvent(parsed);
      },
      { closeOnEose: false },
    );

    return () => {
      unsubscribe();
    };
  }, [
    addContextEvent,
    effectiveId,
    noteRelayKey,
    noteRelays,
    discoveredQuoteRelays,
    contentQuotes,
    quoteIds,
    handleRelayStatus,
    showQuote,
    visible,
  ]);

  const renderQuote = useCallback(
    ({
      id,
      author,
      relays: quoteRelays,
      depth: quoteDepth,
      key,
    }: {
      id: string;
      author?: string;
      relays: string[];
      depth: number;
      key: string;
    }) => (
      <Note
        key={key}
        noteId={id}
        context={contextRef.current}
        visible={visible}
        depth={quoteDepth}
        relays={[
          ...relayList([
            ...quoteRelays,
            ...(author ? quoteAuthorRelays[author] ?? [] : []),
            ...noteRelays,
          ]),
        ]}
        footer={false}
      />
    ),
    [noteRelays, quoteAuthorRelays, visible],
  );

  if (depth > 3) {
    return null;
  }

  if (!effectiveNote) {
    return (
      <LoadingNoteBody
        containerClassName={containerClassName}
        effectiveId={effectiveId}
        threadConnectors={threadConnectors}
      />
    );
  }

  if (effectiveNote.kind() !== 1 || !kind1) {
    return (
      <UnsupportedNoteBody
        containerClassName={containerClassName}
        effectiveNote={effectiveNote}
        threadConnectors={threadConnectors}
      />
    );
  }

  const ancestor = shouldRenderAncestor ? (
    <Note
      noteId={replyId}
      context={contextRef.current}
      visible={visible}
      relays={ancestorRelays}
        showQuote={showQuote}
        showMedia={showMedia}
        leading
      depth={depth}
      ancestorIds={effectiveId ? [...ancestorIds, effectiveId] : ancestorIds}
    />
  ) : null;

  return (
    <NoteBody
      ancestor={ancestor}
      containerClassName={containerClassName}
      depth={depth}
      effectiveNote={effectiveNote}
      subId={effectiveId}
      footer={footer}
      main={main}
      isQuote={isQuote}
      parsedContent={parsedContent}
      renderQuote={renderQuote}
      shortContent={shortContent}
      showQuote={showQuote}
      showMedia={showMedia}
      threadConnectors={threadConnectors}
      visible={visible}
      onOpen={openNote}
      relays={noteRelays}
      showRelays={!!noteRelays.length}
      relayStatusSink={relayStatusSink}
    />
  );
}

function sameParsedEventArray(left?: ParsedEvent[], right?: ParsedEvent[]) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (event, index) => parsedEventId(event) === parsedEventId(right[index]),
  );
}

export const Note = memo(
  NoteComponent,
  (previous, next) =>
    parsedEventId(previous.note) === parsedEventId(next.note) &&
    previous.noteId === next.noteId &&
    sameParsedEventArray(previous.context, next.context) &&
    sameStringArray(
      previous.relays ?? EMPTY_RELAYS,
      next.relays ?? EMPTY_RELAYS,
    ) &&
    (previous.visible ?? true) === (next.visible ?? true) &&
    (previous.footer ?? true) === (next.footer ?? true) &&
    (previous.main ?? false) === (next.main ?? false) &&
    (previous.showQuote ?? true) === (next.showQuote ?? true) &&
    (previous.showMedia ?? true) === (next.showMedia ?? true) &&
    (previous.showRoot ?? true) === (next.showRoot ?? true) &&
    (previous.threadCard ?? false) === (next.threadCard ?? false) &&
    (previous.disableOpen ?? false) === (next.disableOpen ?? false) &&
    (previous.depth ?? 0) === (next.depth ?? 0) &&
    (previous.leading ?? false) === (next.leading ?? false) &&
    (previous.tailing ?? false) === (next.tailing ?? false) &&
    sameStringArray(
      previous.ancestorIds ?? EMPTY_RELAYS,
      next.ancestorIds ?? EMPTY_RELAYS,
    ),
);
