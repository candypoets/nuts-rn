import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Keyboard, Pressable, Text, View, type ViewStyle } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  ContentBlock,
  ParsedEvent,
  Request,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asKind6,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { useEffectiveAuthorRelays } from '../../hooks/useAuthorRelays';
import {pushDistinct} from '../../navigation/pushDistinct';
import type { RootStackParamList } from '../../navigation/types';
import {useAppTheme} from '../../theme';
import { BOOTSTRAP_RELAYS, useNostrStore, useRelayStore } from '../../stores';
import { ContentBlocks } from './ContentBlocks';
import { Footer } from './Footer';
import { Header } from './Header';
import { Kind20Content } from './Kind20Content';
import { Kind1068Content } from './Kind1068Content';
import { Kind30023Content } from './Kind30023Content';
import { KindPreGenericContent } from './KindPreGenericContent';
import { ZapSummary } from './ZapSummary';
import {eventTags, tagValue} from './kindHelpers';
import type { RelayStatusSink } from './RelaysList';
import { wasRecentSwipeGesture } from './press';
import { naddrEncode, neventEncode } from 'nostr-tools/nip19';

const EMPTY_RELAYS: string[] = [];
const EMPTY_CONTEXT: ParsedEvent[] = [];
const NOTE_SEARCH_TIMEOUT_MS = 2500;
const NOTE_BYTES_PER_EVENT = 10 * 1024;
const NOTE_FALLBACK_RELAYS = [
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

function isRelayUrl(value: unknown): value is string {
  return typeof value === 'string' && /^wss?:\/\//.test(value);
}

function relayList(values: unknown[]) {
  return [...new Set(values.filter(isRelayUrl))];
}

function toRequestObject(request: Request): RequestObject {
  return {
    ids: fbArray(request, 'ids').map(id => String(id)),
    authors: fbArray(request, 'authors').map(author => String(author)),
    kinds: fbArray(request, 'kinds').filter(
      (kind): kind is number => typeof kind === 'number',
    ),
    tags: fbArray(request, 'tags').reduce<Record<string, string[]>>(
      (tags, tag) => {
        const items = fbArray(tag, 'items');
        if (items.length >= 2) {
          const key = String(items[0]);
          if (key) tags[key] = items.slice(1).map(item => String(item));
        }
        return tags;
      },
      {},
    ),
    limit: request.limit() || undefined,
    since: request.since() || undefined,
    until: request.until() || undefined,
    search: request.search() || undefined,
    relays: fbArray(request, 'relays').map(relay => String(relay)),
    closeOnEOSE: request.closeOnEose(),
    cacheFirst: request.cacheFirst(),
    noCache: request.noCache(),
    maxRelays: request.maxRelays() || undefined,
  };
}

function withKnownRelays(request: RequestObject, relays: string[]): RequestObject {
  return {
    ...request,
    relays: relayList([...(request.relays || []), ...relays]),
  };
}

function isMediaEventKind(kind?: number) {
  return kind === 20 || kind === 22;
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
  cardStyle?: ViewStyle;
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
  reposterPubkey?: string;
  contentOverride?: React.ReactNode;
  fullBleedContent?: boolean;
};

type LoadingNoteBodyProps = {
  containerClassName: string;
  cardStyle?: ViewStyle;
  effectiveId: string;
  threadConnectors: React.ReactNode;
  visible: boolean;
};

type NotFoundNoteBodyProps = LoadingNoteBodyProps & {
  onRetry: () => void;
  retrying: boolean;
};

type UnsupportedNoteBodyProps = {
  containerClassName: string;
  cardStyle?: ViewStyle;
  effectiveNote: ParsedEvent;
  threadConnectors: React.ReactNode;
  visible: boolean;
};

function NoteVisibilityDebug({visible}: {visible: boolean}) {
  if (!__DEV__) return null;
  return (
    <Text className="mb-1 font-mono text-[10px] text-primary-content opacity-50">
      {visible ? 'visible' : 'not visible'}
    </Text>
  );
}

const LoadingNoteBody = memo(function LoadingNoteBody({
  cardStyle,
  containerClassName,
  effectiveId,
  threadConnectors,
  visible,
}: LoadingNoteBodyProps) {
  return (
    <View className={containerClassName} style={cardStyle}>
      {threadConnectors}
      {/* <NoteVisibilityDebug visible={visible} /> */}
      <Text className="text-xs text-primary-content">
        Loading note {effectiveId ? `${effectiveId.slice(0, 12)}...` : ''}
      </Text>
    </View>
  );
});

const NotFoundNoteBody = memo(function NotFoundNoteBody({
  cardStyle,
  containerClassName,
  effectiveId,
  onRetry,
  retrying,
  threadConnectors,
  visible,
}: NotFoundNoteBodyProps) {
  const theme = useAppTheme();
  return (
    <View className={containerClassName} style={cardStyle}>
      {threadConnectors}
      {/* <NoteVisibilityDebug visible={visible} /> */}
      <View className="flex-row items-center gap-2">
        <CloudOff
          size={16}
          color={theme.colors.primaryContent}
          opacity={0.55}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xs text-primary-content opacity-70">
            Not found
          </Text>
          {effectiveId ? (
            <Text className="font-mono text-[10px] text-primary-content opacity-45">
              {effectiveId.slice(0, 12)}...
            </Text>
          ) : null}
        </View>
        <Pressable
          className="flex-row items-center gap-1 rounded-md border px-2 py-1"
          hitSlop={8}
          onPress={event => {
            event.stopPropagation();
            onRetry();
          }}
          style={{
            backgroundColor: theme.colors.base200,
            borderColor: theme.colors.base200,
          }}
        >
          <RefreshCw size={14} color={theme.colors.primaryContent} />
          <Text className="text-xs font-semibold text-primary-content">
            {retrying ? 'Searching' : 'Deep search'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const UnsupportedNoteBody = memo(function UnsupportedNoteBody({
  cardStyle,
  containerClassName,
  effectiveNote,
  threadConnectors,
  visible,
}: UnsupportedNoteBodyProps) {
  return (
    <View className={containerClassName} style={cardStyle}>
      {threadConnectors}
      {/* <NoteVisibilityDebug visible={visible} /> */}
      <Text className="text-sm text-primary-content">
        Kind {effectiveNote.kind()} is not supported yet.
      </Text>
    </View>
  );
});

const NoteBody = memo(
  function NoteBody({
    ancestor,
    cardStyle,
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
    reposterPubkey,
    contentOverride,
    fullBleedContent,
  }: NoteBodyProps) {
    return (
      <>
        {ancestor}
        <View className={containerClassName} style={cardStyle}>
          {threadConnectors}
          {/* <NoteVisibilityDebug visible={visible} /> */}
          <Header
            note={effectiveNote}
            subId={subId}
            depth={depth}
            main={main}
            relays={relays}
            showRelays={showRelays}
            relayStatusSink={relayStatusSink}
            reposterPubkey={reposterPubkey}
          />
          <Pressable
            className={
              main
                ? 'mt-1 flex-row gap-0'
                : isQuote
                  ? '-mt-1 flex-row gap-0'
                  : fullBleedContent
                    ? 'mt-2 flex-row gap-0'
                    : '-mt-4 flex-row gap-2'
            }
            onPress={event => {
              event.stopPropagation();
              if (!wasRecentSwipeGesture()) onOpen();
            }}
          >
            <View className={isQuote || main || fullBleedContent ? 'w-0' : 'w-8'} />
            <View
              className={[
                depth >= 1 ? 'min-w-0 flex-1 pt-1' : 'min-w-0 flex-1',
                fullBleedContent && !isQuote && !main ? '-mx-3' : '',
              ].join(' ')}
            >
              {contentOverride ?? (
                <ContentBlocks
                  content={parsedContent}
                  shortContent={shortContent}
                  note={effectiveNote}
                  depth={depth}
                  showQuote={showQuote}
                  showMedia={showMedia}
                  forceFullContent={main}
                  renderQuote={renderQuote}
                />
              )}
            </View>
          </Pressable>
          {depth === 0 ? (
            <ZapSummary
              note={effectiveNote}
              visible={visible}
              relays={relays}
              className={[
                '-mt-1 -mb-5 w-full pl-2 pr-2.5',
                main || fullBleedContent ? 'pl-2' : 'pl-10',
              ].join(' ')}
            />
          ) : null}
          {footer && depth === 0 ? (
            <Footer
              note={effectiveNote}
              visible={visible}
              main={main || fullBleedContent}
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
    previous.cardStyle === next.cardStyle &&
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
    previous.relayStatusSink === next.relayStatusSink &&
    previous.reposterPubkey === next.reposterPubkey &&
    previous.contentOverride === next.contentOverride &&
    previous.fullBleedContent === next.fullBleedContent,
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
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const fetchedRef = useRef<ParsedEvent | null>(null);
  const contextRef = useRef<ParsedEvent[]>(context);
  const relayStatusSink = useRef<((relayUrl: string, status: string) => void) | null>(
    null,
  );
  const [contextVersion, setContextVersion] = useState(0);
  const readRelays = useNostrStore(state => state.readRelays);
  const relayStatuses = useRelayStore(state => state.relayStatuses);
  const [extraSearchRelays, setExtraSearchRelays] = useState<string[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [missingSearchState, setMissingSearchState] = useState<
    'loading' | 'not-found'
  >('loading');
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
  const kind6 = useMemo(
    () => (effectiveNote ? asKind6(effectiveNote) : null),
    [effectiveNote],
  );
  const isRepost = !!kind6?.repostedEvent?.();
  const displayNote = isRepost
    ? kind6?.repostedEvent?.() ?? effectiveNote
    : effectiveNote;
  const displayId = displayNote?.id() || effectiveId;
  const reposterPubkey = isRepost ? effectiveNote?.pubkey() || undefined : undefined;
  const lookupRelays = useMemo(
    () => relayList([...relays, ...extraSearchRelays, ...DEFAULT_FEED_RELAYS]),
    [extraSearchRelays, relays],
  );
  const lookupRelayKey = lookupRelays.join('|');
  const noteFallbackRelays = useMemo(
    () => relayList([...readRelays, ...relays]),
    [readRelays, relays],
  );
  const headerRelays = useEffectiveAuthorRelays({
    subId: displayId || undefined,
    pubkey: displayNote?.pubkey(),
    marker: 'read',
    fallbackRelays: noteFallbackRelays,
  });
  const noteRelays = headerRelays;
  const noteRelayKey = noteRelays.join('|');
  const openNote = useCallback(() => {
    if (disableOpen) {
      Keyboard.dismiss();
      return;
    }
    if (!effectiveId) return;
    if (isMediaEventKind(displayNote?.kind())) return;
    const kind = displayNote?.kind() || 1;
    const nevent = neventEncode({
      id: displayId,
      author: displayNote?.pubkey() || undefined,
      relays: noteRelays,
      kind,
    });
    if (kind === 30023) {
      const pubkey = displayNote?.pubkey() || '';
      const identifier = displayNote ? tagValue(eventTags(displayNote), 'd') : '';
      console.log('[kind30023] open article', {
        articleId: displayId,
        pubkey: pubkey ? `${pubkey.slice(0, 12)}...` : null,
        identifier,
        relays: noteRelays,
      });
      if (!pubkey || !identifier) {
        console.warn('[kind30023] cannot open article without pubkey and d tag', {
          articleId: displayId,
          hasPubkey: !!pubkey,
          identifier,
        });
        return;
      }
      pushDistinct(navigation, 'Kind30023Thread', {
        naddr: naddrEncode({
          kind,
          pubkey,
          identifier,
          relays: noteRelays,
        }),
      });
      return;
    }
    pushDistinct(navigation, 'Kind1Thread', {nevent});
  }, [disableOpen, displayId, displayNote, effectiveId, navigation, noteRelays]);

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
    if (!noteId || effectiveNote || !visible) return;
    setMissingSearchState('loading');
    const timeout = setTimeout(() => {
      setMissingSearchState(current =>
        fetchedRef.current?.id?.() === noteId ? current : 'not-found',
      );
    }, NOTE_SEARCH_TIMEOUT_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [effectiveNote, lookupRelayKey, noteId, retryNonce, visible]);

  const retryWithFallbackRelays = useCallback(() => {
    const workingRelays = Object.entries(relayStatuses)
      .filter(([, status]) => status !== 'FAILED' && status !== 'CLOSED')
      .map(([url]) => url);
    const nextRelays = relayList([
      ...extraSearchRelays,
      ...workingRelays,
      ...readRelays,
      ...BOOTSTRAP_RELAYS,
      ...DEFAULT_FEED_RELAYS,
      ...NOTE_FALLBACK_RELAYS,
    ]);

    setExtraSearchRelays(current =>
      sameStringArray(current, nextRelays) ? current : nextRelays,
    );
    setMissingSearchState('loading');
    setRetryNonce(nonce => nonce + 1);
  }, [extraSearchRelays, readRelays, relayStatuses]);

  const kind1 = useMemo(
    () => (displayNote ? asKind1(displayNote) : null),
    [displayNote],
  );
  const contentOverride = useMemo(() => {
    if (!displayNote) return null;
    if (isMediaEventKind(displayNote.kind())) {
      return <Kind20Content note={displayNote} />;
    }
    if (displayNote.kind() === 1068) {
      return <Kind1068Content note={displayNote} visible={visible} />;
    }
    if (displayNote.kind() === 30023) {
      return <Kind30023Content note={displayNote} />;
    }
    if (displayNote.kind() === 30311) {
      return <KindPreGenericContent note={displayNote} />;
    }
    return null;
  }, [displayNote, visible]);
  const isMediaEvent = isMediaEventKind(displayNote?.kind());
  const isKind30023 = displayNote?.kind() === 30023;
  const effectiveMain = main || ((isMediaEvent || isKind30023) && depth === 0);
  const cardlessMain = main && depth === 0;
  const fullWidthCardMain = !cardlessMain && effectiveMain && isMediaEvent;
  const replyId = kind1?.reply()?.id();
  const eventRefs = useMemo(
    () => (kind1 ? fbArray(kind1, 'eventRefs') : []),
    [kind1],
  );
  const eventRefIds = useMemo(
    () => [
      ...new Set(
        eventRefs
          .map(ref => ref.id?.())
          .filter((id): id is string => !!id),
      ),
    ],
    [eventRefs],
  );
  const parsedContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'parsedContent') : []),
    [kind1],
  );
  const shortContent = useMemo(
    () => (kind1 ? fbArray(kind1, 'shortenedContent') : []),
    [kind1],
  );
  const shouldRenderAncestor = !!(
    showRoot &&
    replyId &&
    replyId !== displayId &&
    depth === 0 &&
    !eventRefIds.includes(replyId) &&
    !ancestorIds.includes(replyId)
  );
  const ancestorRelays = useEffectiveAuthorRelays({
    subId: shouldRenderAncestor ? replyId : undefined,
    pubkey: shouldRenderAncestor ? kind1?.reply()?.author() : undefined,
    marker: 'read',
    fallbackRelays: noteRelays,
  });
  const noteSubscriptionId = displayId || effectiveId;
  const noteSubscriptionRequests = useMemo<RequestObject[]>(() => {
    if (!noteSubscriptionId) return [];

    const mainRequest: RequestObject | null = effectiveNote
      ? null
      : {
          ids: [noteSubscriptionId],
          limit: 5,
          relays: lookupRelays,
          cacheFirst: true,
        };
    const ancestorRequestIds = replyId
      ? [replyId].filter(
          id =>
            !eventRefIds.includes(id) &&
            !ancestorIds.includes(id) &&
            !contextRef.current.some(event => event?.id?.() === id),
        )
      : [];
    const ancestorRequests: RequestObject[] = ancestorRequestIds.length
      ? [
          {
            ids: ancestorRequestIds,
            limit: ancestorRequestIds.length * 2,
            relays: ancestorRelays.length ? ancestorRelays : noteRelays,
          },
        ]
      : [];
    const replyRequest: RequestObject = {
      limit: 10,
      tags: { '#e': [noteSubscriptionId] },
      relays: noteRelays,
    };
    const parsedEventRequests = displayNote
      ? fbArray(displayNote, 'requests').map(request =>
          withKnownRelays(toRequestObject(request), noteRelays),
        )
      : [];

    return [
      ...(mainRequest ? [mainRequest] : []),
      ...ancestorRequests,
      replyRequest,
      ...parsedEventRequests,
    ];
  }, [
    ancestorIds,
    ancestorRelays,
    contextVersion,
    displayNote,
    effectiveNote,
    effectiveId,
    eventRefIds,
    lookupRelayKey,
    lookupRelays,
    noteRelays,
    noteSubscriptionId,
    replyId,
  ]);
  const isQuote = depth > 0;
  const hasTopThreadConnector = shouldRenderAncestor || tailing;
  const hasBottomThreadConnector = leading;
  const containerClassName = threadCard
    ? [
        'relative rounded-xl border border-base-200 bg-base-300/95 px-3 py-3',
        hasTopThreadConnector || hasBottomThreadConnector ? 'shadow-none' : 'shadow-sm',
        hasTopThreadConnector ? '-mt-px rounded-t-none border-t-0' : '',
        hasBottomThreadConnector ? 'rounded-b-none border-b-0' : '',
      ].join(' ')
    : [
        cardlessMain
          ? 'relative px-0 py-1'
          : isQuote
          ? 'relative rounded-lg border-l border-t border-base-200 bg-base-300/95 px-2 py-2'
          : fullWidthCardMain
          ? 'relative rounded-lg border border-base-200 bg-base-300/95 px-0 py-3'
          : 'relative rounded-lg border border-base-200 bg-base-300/95 px-3 py-3',
        hasTopThreadConnector || hasBottomThreadConnector
          ? 'shadow-none'
          : cardlessMain || isQuote
          ? 'shadow-none'
          : 'shadow-sm',
        hasTopThreadConnector ? '-mt-px border-t-0' : 'mt-1',
        hasBottomThreadConnector ? 'rounded-b-none border-b-0' : '',
        hasTopThreadConnector ? 'rounded-t-none' : '',
      ].join(' ');
  const cardStyle = useMemo<ViewStyle | undefined>(() => {
    if (cardlessMain || isQuote) return undefined;
    if (theme.colors.base100 !== '#111111') return undefined;
    return {
      shadowColor: '#000000',
      shadowOffset: {width: 0, height: 3},
      shadowOpacity: 0.36,
      shadowRadius: 8,
      elevation: 3,
    };
  }, [cardlessMain, isQuote, theme.colors.base100]);
  const threadConnectorStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: theme.id === 'snowwhite' ? '#dddddd' : theme.colors.base200,
    }),
    [theme.colors.base200, theme.id],
  );
  const threadConnectors = (
    <>
      {hasBottomThreadConnector ? (
        <View
          className={[
            'absolute bottom-0 left-7 top-8 w-0.5',
            isMediaEvent ? 'hidden' : '',
          ].join(' ')}
          style={threadConnectorStyle}
        />
      ) : null}
      {hasTopThreadConnector ? (
        <View
          className={[
            'absolute left-7 top-0 h-8 w-0.5',
            isMediaEvent ? 'hidden' : '',
          ].join(' ')}
          style={threadConnectorStyle}
        />
      ) : null}
    </>
  );

  useEffect(() => {
    if (!visible || !noteSubscriptionId || !noteSubscriptionRequests.length)
      return;

    const unsubscribe = subscribeToNostr(
      noteSubscriptionId,
      noteSubscriptionRequests,
      message => {
        if (handleRelayStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (!parsed) return;
        if (noteId && parsed.id() === noteId) {
          fetchedRef.current = parsed;
        }
        addContextEvent(parsed);
      },
      { bytesPerEvent: NOTE_BYTES_PER_EVENT },
    );

    return () => {
      unsubscribe();
    };
  }, [
    addContextEvent,
    handleRelayStatus,
    noteId,
    noteSubscriptionId,
    noteSubscriptionRequests,
    visible,
  ]);

  const renderQuote = useCallback(
    ({
      id,
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
            ...noteRelays,
          ]),
        ]}
        footer={false}
      />
    ),
    [noteRelays, visible],
  );

  if (depth > 3) {
    return null;
  }

  if (!effectiveNote) {
    if (missingSearchState === 'not-found') {
      return (
        <NotFoundNoteBody
          cardStyle={cardStyle}
          containerClassName={containerClassName}
          effectiveId={effectiveId}
          onRetry={retryWithFallbackRelays}
          retrying={retryNonce > 0}
          threadConnectors={threadConnectors}
          visible={visible}
        />
      );
    }

    return (
      <LoadingNoteBody
        cardStyle={cardStyle}
        containerClassName={containerClassName}
        effectiveId={effectiveId}
        threadConnectors={threadConnectors}
        visible={visible}
      />
    );
  }

  if (!displayNote || (!contentOverride && (displayNote.kind() !== 1 || !kind1))) {
    return (
      <UnsupportedNoteBody
        cardStyle={cardStyle}
        containerClassName={containerClassName}
        effectiveNote={displayNote ?? effectiveNote}
        threadConnectors={threadConnectors}
        visible={visible}
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
      ancestorIds={displayId ? [...ancestorIds, displayId] : ancestorIds}
    />
  ) : null;

  return (
    <NoteBody
      ancestor={ancestor}
      cardStyle={cardStyle}
      containerClassName={containerClassName}
      depth={depth}
      effectiveNote={displayNote}
      subId={displayId}
      footer={footer}
      main={effectiveMain}
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
      reposterPubkey={reposterPubkey}
      contentOverride={contentOverride}
      fullBleedContent={isMediaEvent}
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
