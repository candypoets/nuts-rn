import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asKind1, asParsedEvent, fbArray} from '@candypoets/nipworker/utils';
import {ContentBlocks} from './ContentBlocks';
import {Footer} from './Footer';
import {Header} from './Header';

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
};

export function Note({
  note,
  noteId,
  context = [],
  relays = [],
  visible = true,
  footer = true,
  showQuote = true,
  depth = 0,
  leading = false,
  tailing = false,
}: NoteProps) {
  const fetchedRef = useRef<ParsedEvent | null>(null);
  const [, setTick] = useState(0);
  const effectiveNote = note || fetchedRef.current;
  const effectiveId = noteId || effectiveNote?.id() || '';

  useEffect(() => {
    if (note || !noteId || !visible) return;
    fetchedRef.current = null;
    setTick(tick => tick + 1);

    const unsubscribe = subscribeToNostr(
      `note_${noteId}`,
      [{ids: [noteId], limit: 1, relays}],
      message => {
        const parsed = asParsedEvent(message);
        if (!parsed || parsed.id() !== noteId) return;
        fetchedRef.current = parsed;
        setTick(tick => tick + 1);
      },
      {closeOnEose: false, bytesPerEvent: 24 * 1024},
    );

    return () => {
      fetchedRef.current = null;
      unsubscribe();
    };
  }, [note, noteId, relays, visible]);

  const kind1 = effectiveNote ? asKind1(effectiveNote) : null;
  const parsedContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'parsedContent') : []),
    [kind1],
  );
  const shortContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'shortenedContent') : []),
    [kind1],
  );

  const renderQuote = useCallback(
    ({
      id,
      relays: quoteRelays,
      depth: quoteDepth,
      key,
    }: {
      id: string;
      relays: string[];
      depth: number;
      key: string;
    }) => (
      <Note
        key={key}
        noteId={id}
        context={context}
        visible={visible}
        depth={quoteDepth}
        relays={quoteRelays}
        footer={false}
      />
    ),
    [context, visible],
  );

  if (!effectiveNote) {
    return (
      <View className="rounded-lg border border-slate-200 bg-white/90 px-3 py-3">
        <Text className="text-xs text-slate-500">
          Loading note {effectiveId ? `${effectiveId.slice(0, 12)}...` : ''}
        </Text>
      </View>
    );
  }

  if (effectiveNote.kind() !== 1 || !kind1) {
    return (
      <View className="rounded-lg border border-slate-200 bg-white/90 px-3 py-3">
        <Text className="text-sm text-slate-500">
          Kind {effectiveNote.kind()} is not supported yet.
        </Text>
      </View>
    );
  }

  return (
    <View
      className={[
        'relative mt-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-3 shadow-sm',
        depth ? 'ml-4' : '',
        leading || tailing ? 'rounded-t-none' : '',
      ].join(' ')}
    >
      {leading ? (
        <View className="absolute bottom-0 left-7 top-8 w-0.5 bg-slate-200" />
      ) : null}
      <Header note={effectiveNote} depth={depth} />
      <View className="mt-1 flex-row gap-2">
        <View className={depth ? 'w-5' : 'w-8'} />
        <View className="min-w-0 flex-1">
          <ContentBlocks
            content={parsedContent}
            shortContent={shortContent}
            note={effectiveNote}
            context={context}
            visible={visible}
            depth={depth}
            showQuote={showQuote}
            renderQuote={renderQuote}
          />
        </View>
      </View>
      {footer && depth === 0 ? <Footer note={effectiveNote} /> : null}
    </View>
  );
}
