import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asKind1,
  asNostrData,
  asParsedEvent,
  fbArray,
  isKind10002,
} from '@candypoets/nipworker/utils';
import { ContentData } from '@candypoets/nipworker';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { BOOTSTRAP_RELAYS } from '../../stores';
import { ContentBlocks } from './ContentBlocks';
import { Footer } from './Footer';
import { Header } from './Header';

const EMPTY_RELAYS: string[] = [];
const EMPTY_CONTEXT: ParsedEvent[] = [];

function nostrDataRelays(nostr: ReturnType<typeof asNostrData>) {
  if (!nostr) return [];
  return Array.from({ length: nostr.relaysLength() }, (_, index) =>
    nostr.relays(index),
  ).filter((relay): relay is string => !!relay);
}

function kind10002WriteRelays(kind10002: ReturnType<typeof isKind10002>) {
  if (!kind10002) return [];
  return Array.from({ length: kind10002.relaysLength() }, (_, index) =>
    kind10002.relays(index),
  )
    .filter(relay => relay?.write())
    .map(relay => relay?.url())
    .filter((relay): relay is string => !!relay)
    .slice(0, 3);
}

function isUserEntity(entity?: string | null) {
  return !!entity?.match(/n(profile|pub)/);
}

type NoteProps = {
  note?: ParsedEvent;
  noteId?: string;
  context?: ParsedEvent[];
  relays?: string[];
  visible?: boolean;
  footer?: boolean;
  showQuote?: boolean;
  depth?: number;
  leading?: boolean;
  tailing?: boolean;
  ancestorIds?: string[];
  onProfileOpen?: (pubkey: string) => void;
};

export function Note({
  note,
  noteId,
  context = EMPTY_CONTEXT,
  relays = EMPTY_RELAYS,
  visible = true,
  footer = true,
  showQuote = true,
  depth = 0,
  leading = false,
  tailing = false,
  ancestorIds = [],
  onProfileOpen,
}: NoteProps) {
  const fetchedRef = useRef<ParsedEvent | null>(null);
  const contextRef = useRef<ParsedEvent[]>(context);
  const [contextVersion, setContextVersion] = useState(0);
  const [quoteAuthorRelays, setQuoteAuthorRelays] = useState<
    Record<string, string[]>
  >({});
  const contextNote = useMemo(
    () =>
      noteId ? context.find(event => event?.id?.() === noteId) ?? null : null,
    [context, noteId],
  );
  const effectiveNote = note || contextNote || fetchedRef.current;
  const effectiveId = noteId || effectiveNote?.id() || '';
  const lookupRelays = useMemo(
    () => [...new Set([...relays, ...DEFAULT_FEED_RELAYS])],
    [relays],
  );
  const effectiveRelays = useMemo(() => {
    const noteRelays =
      effectiveNote && typeof effectiveNote.relaysLength === 'function'
        ? Array.from({ length: effectiveNote.relaysLength() }, (_, index) =>
            effectiveNote.relays(index),
          ).filter((relay): relay is string => !!relay)
        : [];
    return [...new Set([...relays, ...noteRelays, ...DEFAULT_FEED_RELAYS])];
  }, [effectiveNote, relays]);

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

  useEffect(() => {
    if (note || contextNote || !noteId || !visible) return;
    fetchedRef.current = null;
    setContextVersion(version => version + 1);

    const unsubscribe = subscribeToNostr(
      `note_${noteId}`,
      [{ ids: [noteId], limit: 1, relays: lookupRelays }],
      message => {
        const parsed = asParsedEvent(message);
        if (!parsed || parsed.id() !== noteId) return;
        fetchedRef.current = parsed;
        addContextEvent(parsed);
        setContextVersion(version => version + 1);
      },
      { closeOnEose: false },
    );

    return () => {
      fetchedRef.current = null;
      unsubscribe();
    };
  }, [addContextEvent, contextNote, lookupRelays, note, noteId, visible]);

  const kind1 = effectiveNote ? asKind1(effectiveNote) : null;
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
    replyId &&
    replyId !== effectiveId &&
    depth === 0 &&
    !allMentionIds.includes(replyId) &&
    !ancestorIds.includes(replyId)
  );
  const isQuote = depth > 0;
  const hasTopThreadConnector = shouldRenderAncestor || tailing;
  const hasBottomThreadConnector = leading;
  const containerClassName = [
    isQuote
      ? 'relative rounded-lg border-l border-t border-slate-200 bg-white/95 px-2 py-2'
      : 'relative rounded-lg border border-slate-200 bg-white/95 px-3 py-3',
    hasTopThreadConnector || hasBottomThreadConnector
      ? 'shadow-none'
      : isQuote
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
        const kind10002 = isKind10002(message);
        if (!kind10002) return;
        const author = asParsedEvent(message)?.pubkey();
        if (!author) return;
        const writeRelays = kind10002WriteRelays(kind10002);
        setQuoteAuthorRelays(current => ({
          ...current,
          [author]: writeRelays,
        }));
      },
      { closeOnEose: false },
    );

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [effectiveId, quoteAuthorRelays, quoteAuthors, showQuote, visible]);

  useEffect(() => {
    if (!visible || !showQuote || !quoteIds.length) return;

    const unsubscribe = subscribeToNostr(
      `note_quotes_${effectiveId}`,
      [
        {
          ids: quoteIds,
          limit: 5 * quoteIds.length,
          relays: [
            ...new Set([
              ...effectiveRelays,
              ...discoveredQuoteRelays,
              ...contentQuotes.flatMap(quote => quote.relays),
            ]),
          ],
        },
      ],
      message => {
        const parsed = asParsedEvent(message);
        if (parsed) addContextEvent(parsed);
      },
      { closeOnEose: false },
    );

    return unsubscribe;
  }, [
    addContextEvent,
    effectiveId,
    effectiveRelays,
    discoveredQuoteRelays,
    contentQuotes,
    quoteIds,
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
          ...new Set([
            ...quoteRelays,
            ...(author ? quoteAuthorRelays[author] ?? [] : []),
            ...effectiveRelays,
          ]),
        ]}
        footer={false}
        onProfileOpen={onProfileOpen}
      />
    ),
    [effectiveRelays, quoteAuthorRelays, visible],
  );

  if (depth > 3) {
    return null;
  }

  if (!effectiveNote) {
    return (
      <View className={containerClassName}>
        {threadConnectors}
        <Text className="text-xs text-slate-500">
          Loading note {effectiveId ? `${effectiveId.slice(0, 12)}...` : ''}
        </Text>
      </View>
    );
  }

  if (effectiveNote.kind() !== 1 || !kind1) {
    return (
      <View className={containerClassName}>
        {threadConnectors}
        <Text className="text-sm text-slate-500">
          Kind {effectiveNote.kind()} is not supported yet.
        </Text>
      </View>
    );
  }

  return (
    <>
      {shouldRenderAncestor ? (
        <Note
          noteId={replyId}
          context={contextRef.current}
          visible={visible}
          relays={effectiveRelays}
          showQuote={showQuote}
          leading
          depth={depth}
          ancestorIds={
            effectiveId ? [...ancestorIds, effectiveId] : ancestorIds
          }
          onProfileOpen={onProfileOpen}
        />
      ) : null}
      <View className={containerClassName}>
        {threadConnectors}
        <Header note={effectiveNote} depth={depth} onProfileOpen={onProfileOpen} />
        <View
          className={isQuote ? 'mt-1 flex-row gap-0' : 'mt-1 flex-row gap-2'}
        >
          <View className={isQuote ? 'w-0' : 'w-8'} />
          <View className="min-w-0 flex-1">
            <ContentBlocks
              content={parsedContent}
              shortContent={shortContent}
              note={effectiveNote}
              context={contextRef.current}
              visible={visible}
              depth={depth}
              showQuote={showQuote}
              onProfileOpen={onProfileOpen}
              renderQuote={renderQuote}
            />
          </View>
        </View>
        {footer && depth === 0 ? (
          <Footer note={effectiveNote} visible={visible} />
        ) : null}
      </View>
    </>
  );
}
