import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {MessageType} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asParsedEvent,
  fbArray,
  isKind1,
  isKind10002,
  isParsedEvent,
} from '@candypoets/nipworker/utils';
import {ChevronLeft} from 'lucide-react-native';
import {decode, type EventPointer} from 'nostr-tools/nip19';

import {Feed} from '../components/Feed';
import {Note} from '../components/notes';
import {RelaysList as NoteRelaysList} from '../components/notes/RelaysList';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useNostrStore, useRelayStore} from '../stores';
import {useAppTheme} from '../theme';

const PAGE_LIMIT = 50;
const REPLY_BYTES_PER_EVENT = 96 * 1024;
const KIND1_DEBUG = false;
const KIND1_TRACE = false;
const EMPTY_IDS: string[] = [];

type Kind1SubProps = {
  nevent: string;
  visible: boolean;
  onClose: () => void;
};

type Kind1HeaderProps = {
  headerItem: ParsedEvent | null;
  onClose: () => void;
  relays: string[];
  visible: boolean;
};

type ReplyItemProps = {
  headerPubkey: string | null;
  index: number;
  item: ParsedEvent;
  replies: ParsedEvent[];
  visible: boolean;
};

type ReplyThreadNodeProps = {
  headerPubkey: string | null;
  item: ParsedEvent;
  replies: ParsedEvent[];
  tailing?: boolean;
  threadPubkey: string | null;
  visitedIds?: string[];
  visible: boolean;
};

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function decodeEventPointer(nevent: string): EventPointer {
  try {
    const decoded = decode(nevent) as unknown as {data?: EventPointer};
    return decoded?.data ?? ({id: '', relays: []} as EventPointer);
  } catch (error) {
    console.warn('[kind1] failed to decode nevent', error);
    return {id: '', relays: []} as EventPointer;
  }
}

function pointerRelays(data: EventPointer) {
  return [...new Set((data.relays ?? []).filter(Boolean).map(normalizeRelayUrl))];
}

function oldestVisibleChildReply(
  replies: ParsedEvent[],
  item: ParsedEvent,
  threadPubkey: string | null,
  headerPubkey: string | null,
): ParsedEvent | null {
  const itemId = item.id();
  if (!itemId) return null;

  let oldest: ParsedEvent | null = null;
  replies.forEach(reply => {
    if (reply.id() === itemId) return;
    const kind1 = asKind1(reply);
    if (kind1?.reply()?.id() !== itemId) return;
    if (reply.pubkey() !== threadPubkey && reply.pubkey() !== headerPubkey) return;
    if (!oldest || reply.createdAt() < oldest.createdAt()) oldest = reply;
  });
  return oldest;
}

const Kind1StickyHeader = memo(function Kind1StickyHeader({
  onClose,
}: {
  onClose: () => void;
}) {
  const theme = useAppTheme();
    return (
    <View className="h-16 flex-row items-center justify-between px-4">
      <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-200" hitSlop={12} onPress={onClose}>
        <ChevronLeft size={22} color={theme.colors.primaryContent} />
      </Pressable>
      <Text className="text-base font-semibold text-base-content">Post</Text>
      <View className="h-9 w-9" />
    </View>
  );
});

const Kind1Header = memo(function Kind1Header({
  headerItem,
  onClose,
  relays,
  visible,
}: Kind1HeaderProps) {
  const theme = useAppTheme();

  return (
    <View>
      <View className="h-20 flex-row items-center justify-between rounded-lg bg-base-300/90 px-4 shadow-sm">
        <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-base-200" hitSlop={12} onPress={onClose}>
          <ChevronLeft size={22} color={theme.colors.primaryContent} />
        </Pressable>
        <View className="flex-1 items-end justify-center pl-3">
          {headerItem ? (
            <NoteRelaysList
              note={headerItem}
              subId={`kind1_header_${headerItem.id() || 'missing'}`}
              relays={relays}
              mini
            />
          ) : null}
        </View>
      </View>
      {headerItem ? (
        <View className="mt-2 px-1">
          <Note note={headerItem} visible={visible} main threadCard />
        </View>
      ) : null}
    </View>
  );
});

const ReplyItem = memo(
  function ReplyItem({headerPubkey, index, item, replies, visible}: ReplyItemProps) {
    return (
      <View className={index === 0 ? 'px-1 pb-1.5 pt-1' : 'px-1 pb-1.5'}>
        <ReplyThreadNode
          headerPubkey={headerPubkey}
          item={item}
          replies={replies}
          threadPubkey={item.pubkey() || null}
          visible={visible}
        />
      </View>
    );
  },
  (previous, next) =>
    previous.headerPubkey === next.headerPubkey &&
    previous.index === next.index &&
    previous.item.id() === next.item.id() &&
    previous.replies === next.replies &&
    previous.visible === next.visible,
);

const ReplyThreadNode = memo(
  function ReplyThreadNode({
    headerPubkey,
    item,
    replies,
    tailing = false,
    threadPubkey,
    visitedIds = [],
    visible,
  }: ReplyThreadNodeProps) {
    const itemId = item.id();
    const nextVisitedIds = useMemo(
      () => (itemId ? [...visitedIds, itemId] : visitedIds),
      [itemId, visitedIds],
    );
    const showReplies = useCallback(
      (post: ParsedEvent) => () => {
        const child = oldestVisibleChildReply(
          replies,
          post,
          threadPubkey,
          headerPubkey,
        );
        const childId = child?.id();
        if (!childId || nextVisitedIds.includes(childId)) return [];
        return child ? [child] : [];
      },
      [headerPubkey, nextVisitedIds, replies, threadPubkey],
    );

    return (
      <Note
        note={item}
        visible={visible}
        footer
        showQuote={false}
        showReplies={showReplies}
        showRoot={false}
        tailing={tailing}
        threadCard
      />
    );
  },
  (previous, next) =>
    previous.headerPubkey === next.headerPubkey &&
    previous.item.id() === next.item.id() &&
    previous.replies === next.replies &&
    (previous.tailing ?? false) === (next.tailing ?? false) &&
    previous.threadPubkey === next.threadPubkey &&
    previous.visible === next.visible &&
    (previous.visitedIds ?? EMPTY_IDS).join(',') ===
      (next.visitedIds ?? EMPTY_IDS).join(','),
);

function kind1Debug(message: string, data?: Record<string, unknown>) {
  if (!__DEV__ || !KIND1_DEBUG) return;
  console.log(`[kind1-sub] ${message}`, data ?? {});
}

function kind1Trace(
  startedAt: number,
  message: string,
  data?: Record<string, unknown>,
) {
  if (!__DEV__ || !KIND1_TRACE) return;
  console.log(`[kind1-trace] t+${Date.now() - startedAt}ms ${message}`, data ?? {});
}

export function Kind1Sub({nevent, visible, onClose}: Kind1SubProps) {
  const traceStartedAtRef = useRef(Date.now());
  const data = useMemo(() => decodeEventPointer(nevent), [nevent]);
  const rootId = data.id ?? '';
  const initialRelays = useMemo(() => pointerRelays(data), [data]);
  const [headerItem, setHeaderItem] = useState<ParsedEvent | null>(null);
  const [authorReadRelays, setAuthorReadRelays] = useState<string[]>([]);
  const [items, setItems] = useState<ParsedEvent[]>([]);
  const [allReplies, setAllReplies] = useState<ParsedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const itemsRef = useRef<ParsedEvent[]>([]);
  const allRepliesRef = useRef<ParsedEvent[]>([]);
  const renderedItemsLengthRef = useRef(0);
  const seenIdsRef = useRef(new Set<string>());
  const statsRef = useRef({
    arrived: 0,
    accepted: 0,
    duplicate: 0,
    dropKind: 0,
    dropNoRootTag: 0,
    dropQuote: 0,
    dropRoot: 0,
  });
  const commitFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const mainUnsubRef = useRef<(() => void) | null>(null);
  const authorRelayDiscoveryUnsubRef = useRef<(() => void) | null>(null);
  const authorRepliesUnsubRef = useRef<(() => void) | null>(null);
  const repliesCacheUnsubRef = useRef<(() => void) | null>(null);
  const repliesUnsubRef = useRef<(() => void) | null>(null);
  const paginationUnsubRef = useRef<(() => void) | null>(null);
  const authorReplyStartFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const cacheReplyStartFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repliesDebugTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsBeforePaginationRef = useRef(0);
  const paginationCounterRef = useRef(0);
  const headerSubSeqRef = useRef(0);
  const repliesSubSeqRef = useRef(0);
  const firstReplyAtRef = useRef<number | null>(null);
  const firstCommitAtRef = useRef<number | null>(null);
  const headerFoundRef = useRef(false);
  const rootReadRelays = useNostrStore(state => state.readRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const activeRelays = useMemo(
    () => [
      ...new Set([
        ...rootReadRelays,
        ...initialRelays,
        ...DEFAULT_FEED_RELAYS,
      ].map(normalizeRelayUrl)),
    ],
    [initialRelays, rootReadRelays],
  );
  const displayedRelays = useMemo(
    () => [...new Set([...activeRelays, ...authorReadRelays])],
    [activeRelays, authorReadRelays],
  );

  useEffect(() => {
    traceStartedAtRef.current = Date.now();
    firstReplyAtRef.current = null;
    firstCommitAtRef.current = null;
    headerFoundRef.current = false;
    kind1Trace(traceStartedAtRef.current, 'root changed', {
      rootId: rootId.slice(0, 12),
      initialRelays,
      rootReadRelays,
      activeRelays,
    });
  }, [activeRelays, initialRelays, rootId, rootReadRelays]);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current);
      paginationTimeoutRef.current = null;
    }
    if (repliesDebugTimeoutRef.current) {
      clearTimeout(repliesDebugTimeoutRef.current);
      repliesDebugTimeoutRef.current = null;
    }
    if (authorReplyStartFrameRef.current) {
      cancelAnimationFrame(authorReplyStartFrameRef.current);
      authorReplyStartFrameRef.current = null;
    }
    if (cacheReplyStartFrameRef.current) {
      cancelAnimationFrame(cacheReplyStartFrameRef.current);
      cacheReplyStartFrameRef.current = null;
    }
    if (commitFrameRef.current) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
  }, []);

  const commitItems = useCallback(() => {
    if (commitFrameRef.current) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    itemsRef.current.sort((left, right) => right.createdAt() - left.createdAt());
    allRepliesRef.current.sort((left, right) => right.createdAt() - left.createdAt());
    const nextItems = [...itemsRef.current];
    renderedItemsLengthRef.current = nextItems.length;
    setItems(nextItems);
    setAllReplies([...allRepliesRef.current]);
    if (firstCommitAtRef.current === null) {
      firstCommitAtRef.current = Date.now();
      kind1Trace(traceStartedAtRef.current, 'first reply commit', {
        rootId: rootId.slice(0, 12),
        items: itemsRef.current.length,
        allReplies: allRepliesRef.current.length,
        accepted: statsRef.current.accepted,
      });
    }
    kind1Debug('commit', {
      rootId: rootId.slice(0, 12),
      items: itemsRef.current.length,
      first: itemsRef.current[0]?.id()?.slice(0, 12),
      last: itemsRef.current[itemsRef.current.length - 1]?.id()?.slice(0, 12),
      ...statsRef.current,
    });
  }, [rootId]);

  const commitItemsIfNeeded = useCallback(
    (reason: string) => {
      const refItems = itemsRef.current.length;
      const renderedItems = renderedItemsLengthRef.current;
      if (refItems !== renderedItems || commitFrameRef.current) {
        commitItems();
      }
      kind1Debug(reason, {
        rootId: rootId.slice(0, 12),
        items: itemsRef.current.length,
        renderedItems: renderedItemsLengthRef.current,
        ...statsRef.current,
      });
    },
    [commitItems, rootId],
  );

  const scheduleCommit = useCallback(() => {
    if (commitFrameRef.current) return;
    commitFrameRef.current = requestAnimationFrame(commitItems);
  }, [commitItems]);

  const addReply = useCallback(
    (event: ParsedEvent) => {
      statsRef.current.arrived += 1;
      if (event.kind() !== 1) {
        statsRef.current.dropKind += 1;
        return;
      }
      const kind1 = asKind1(event);
      if (!kind1) {
        statsRef.current.dropKind += 1;
        return;
      }
      const replyId = kind1.reply()?.id();
      const rootRefId = kind1.root()?.id();
      if (replyId && replyId !== rootId) {
        statsRef.current.dropNoRootTag += 1;
        return;
      }
      if ((!replyId || replyId === rootRefId) && rootRefId !== rootId) {
        statsRef.current.dropNoRootTag += 1;
        return;
      }
      if (fbArray(kind1, 'eventRefs').some(eventRef => eventRef.id() === rootId)) {
        statsRef.current.dropQuote += 1;
        return;
      }
      if (event.id() === rootId) {
        statsRef.current.dropRoot += 1;
        return;
      }
      const id = event.id();
      if (!id || seenIdsRef.current.has(id)) {
        statsRef.current.duplicate += 1;
        return;
      }
      seenIdsRef.current.add(id);
      statsRef.current.accepted += 1;
      if (firstReplyAtRef.current === null) {
        firstReplyAtRef.current = Date.now();
        kind1Trace(traceStartedAtRef.current, 'first accepted reply', {
          rootId: rootId.slice(0, 12),
          id: id.slice(0, 12),
          pubkey: event.pubkey()?.slice(0, 12),
          createdAt: event.createdAt(),
        });
      }
      allRepliesRef.current.push(event);
      if (!replyId || replyId === rootId) {
        itemsRef.current.push(event);
      }
      scheduleCommit();
    },
    [rootId, scheduleCommit],
  );

  const handleReplyMessage = useCallback(
    (message: WorkerMessage) => {
      if (message.type() === MessageType.Eoce) {
        kind1Trace(traceStartedAtRef.current, 'reply eoce', {
          rootId: rootId.slice(0, 12),
          items: itemsRef.current.length,
          allReplies: allRepliesRef.current.length,
          ...statsRef.current,
        });
        commitItemsIfNeeded('reply eoce');
        setLoading(false);
        return;
      }

      const status = asConnectionStatus(message);
      if (status) {
        const relayUrl = status.relayUrl();
        const relayStatus = status.status()?.toString();
        if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
        if (relayStatus === 'EOSE') {
          kind1Trace(traceStartedAtRef.current, 'reply relay eose', {
            rootId: rootId.slice(0, 12),
            relay: relayUrl,
            items: itemsRef.current.length,
            allReplies: allRepliesRef.current.length,
            ...statsRef.current,
          });
          commitItemsIfNeeded('reply relay eose');
          setLoading(false);
        }
        return;
      }

      const parsed = asParsedEvent(message);
      if (parsed) {
        addReply(parsed);
        if (statsRef.current.arrived % 25 === 0) {
          kind1Debug('reply progress', {
            rootId: rootId.slice(0, 12),
            items: itemsRef.current.length,
            ...statsRef.current,
          });
        }
      }
    },
    [addReply, commitItemsIfNeeded, rootId, setRelayStatus],
  );

  const cleanupSubscriptions = useCallback(() => {
    mainUnsubRef.current?.();
    authorRelayDiscoveryUnsubRef.current?.();
    authorRepliesUnsubRef.current?.();
    repliesCacheUnsubRef.current?.();
    repliesUnsubRef.current?.();
    paginationUnsubRef.current?.();
    mainUnsubRef.current = null;
    authorRelayDiscoveryUnsubRef.current = null;
    authorRepliesUnsubRef.current = null;
    repliesCacheUnsubRef.current = null;
    repliesUnsubRef.current = null;
    paginationUnsubRef.current = null;
    clearTimers();
  }, [clearTimers]);

  const reset = useCallback(() => {
    kind1Trace(traceStartedAtRef.current, 'reset', {
      rootId: rootId.slice(0, 12),
      items: itemsRef.current.length,
      allReplies: allRepliesRef.current.length,
    });
    itemsRef.current = [];
    allRepliesRef.current = [];
    renderedItemsLengthRef.current = 0;
    seenIdsRef.current.clear();
    statsRef.current = {
      arrived: 0,
      accepted: 0,
      duplicate: 0,
      dropKind: 0,
      dropNoRootTag: 0,
      dropQuote: 0,
      dropRoot: 0,
    };
    paginationCounterRef.current = 0;
    itemsBeforePaginationRef.current = 0;
    headerFoundRef.current = false;
    firstReplyAtRef.current = null;
    firstCommitAtRef.current = null;
    setHeaderItem(null);
    setAuthorReadRelays([]);
    setItems([]);
    setAllReplies([]);
    setHasMore(true);
    setLoading(false);
    cleanupSubscriptions();
  }, [cleanupSubscriptions, rootId]);

  useEffect(() => cleanupSubscriptions, [cleanupSubscriptions]);

  useEffect(() => {
    reset();
  }, [rootId, reset]);

  useEffect(() => {
    if (!visible || !rootId) return undefined;

    headerSubSeqRef.current += 1;
    const headerSeq = headerSubSeqRef.current;
    const headerSubId = `kind1_${rootId}_${relayHash(activeRelays)}`;
    const headerStartedAt = Date.now();
    setLoading(true);
    setSubRelays(headerSubId, activeRelays);
    activeRelays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    kind1Trace(traceStartedAtRef.current, 'header subscribe', {
      seq: headerSeq,
      subId: headerSubId,
      rootId: rootId.slice(0, 12),
      relays: activeRelays,
      initialRelays,
      rootReadRelays,
    });
    kind1Debug('subscribe header', {
      rootId: rootId.slice(0, 12),
      relays: activeRelays,
    });

    timeoutRef.current = setTimeout(() => {
      kind1Trace(traceStartedAtRef.current, 'header timeout', {
        seq: headerSeq,
        elapsed: Date.now() - headerStartedAt,
        rootId: rootId.slice(0, 12),
        hasHeader: headerFoundRef.current,
      });
      setLoading(false);
    }, 1500);
    mainUnsubRef.current = subscribeToNostr(
      headerSubId,
      [{kinds: [1], ids: [rootId], limit: 1, relays: activeRelays, cacheFirst: true}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          kind1Trace(traceStartedAtRef.current, 'header status', {
            seq: headerSeq,
            elapsed: Date.now() - headerStartedAt,
            relay: status.relayUrl(),
            status: status.status()?.toString(),
          });
        }
        const parsedEvent = isParsedEvent(message);
        const kind1 = isKind1(message);
        if (!kind1 || !parsedEvent || parsedEvent.id() !== rootId) return;
        kind1Trace(traceStartedAtRef.current, 'header found', {
          seq: headerSeq,
          elapsed: Date.now() - headerStartedAt,
          rootId: rootId.slice(0, 12),
          pubkey: parsedEvent.pubkey()?.slice(0, 12),
          createdAt: parsedEvent.createdAt(),
          items: itemsRef.current.length,
          allReplies: allRepliesRef.current.length,
          firstReplyElapsed: firstReplyAtRef.current
            ? firstReplyAtRef.current - traceStartedAtRef.current
            : null,
        });
        headerFoundRef.current = true;
        setHeaderItem(parsedEvent);
        kind1Debug('header found', {
          rootId: rootId.slice(0, 12),
          pubkey: parsedEvent.pubkey()?.slice(0, 12),
        });
        setLoading(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      },
      {bytesPerEvent: REPLY_BYTES_PER_EVENT},
    );

    return () => {
      kind1Trace(traceStartedAtRef.current, 'header cleanup', {
        seq: headerSeq,
        elapsed: Date.now() - headerStartedAt,
        rootId: rootId.slice(0, 12),
      });
      mainUnsubRef.current?.();
      mainUnsubRef.current = null;
      clearTimers();
    };
  }, [
    activeRelays,
    clearTimers,
    handleReplyMessage,
    initialRelays,
    reset,
    rootId,
    rootReadRelays,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !rootId || !headerItem) return undefined;
    repliesSubSeqRef.current += 1;
    const repliesSeq = repliesSubSeqRef.current;
    const repliesStartedAt = Date.now();
    const cacheSubId = `replies_cache_${rootId}_${relayHash(activeRelays)}`;
    let startTimeout: ReturnType<typeof setTimeout> | null = null;
    let debugTimeout: ReturnType<typeof setTimeout> | null = null;
    repliesCacheUnsubRef.current?.();
    startTimeout = setTimeout(() => {
      kind1Trace(traceStartedAtRef.current, 'cache replies subscribe', {
        seq: repliesSeq,
        cacheSubId,
        rootId: rootId.slice(0, 12),
        relays: activeRelays,
      });
      kind1Debug('subscribe replies cache', {
        rootId: rootId.slice(0, 12),
        relays: activeRelays,
      });
      repliesCacheUnsubRef.current = subscribeToNostr(
        cacheSubId,
        [{kinds: [1], tags: {'#e': [rootId]}, limit: PAGE_LIMIT, cacheFirst: true, noContext: true, relays: activeRelays}],
        handleReplyMessage,
        {bytesPerEvent: REPLY_BYTES_PER_EVENT},
      );
      debugTimeout = setTimeout(() => {
        kind1Trace(traceStartedAtRef.current, 'cache replies timeout snapshot', {
          seq: repliesSeq,
          elapsed: Date.now() - repliesStartedAt,
          rootId: rootId.slice(0, 12),
          items: itemsRef.current.length,
          allReplies: allRepliesRef.current.length,
          hasHeader: headerFoundRef.current,
          ...statsRef.current,
        });
        kind1Debug('reply timeout snapshot', {
          rootId: rootId.slice(0, 12),
          items: itemsRef.current.length,
          ...statsRef.current,
        });
      }, 2500);
      repliesDebugTimeoutRef.current = debugTimeout;
    }, 120);

    return () => {
      if (startTimeout) clearTimeout(startTimeout);
      kind1Trace(traceStartedAtRef.current, 'cache replies cleanup', {
        seq: repliesSeq,
        elapsed: Date.now() - repliesStartedAt,
        rootId: rootId.slice(0, 12),
      });
      repliesCacheUnsubRef.current?.();
      repliesCacheUnsubRef.current = null;
      if (debugTimeout) clearTimeout(debugTimeout);
      if (repliesDebugTimeoutRef.current) {
        clearTimeout(repliesDebugTimeoutRef.current);
        repliesDebugTimeoutRef.current = null;
      }
    };
  }, [activeRelays, handleReplyMessage, headerItem, rootId, visible]);

  useEffect(() => {
    const authorPubkey = headerItem?.pubkey();
    if (!visible || !rootId || !authorPubkey) return undefined;

    const authorDiscoveryStartedAt = Date.now();
    let called = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const startFallbackReplies = (reason: string) => {
      const repliesSubId = `replies_live_${rootId}_${relayHash(activeRelays)}`;
      repliesUnsubRef.current?.();
      setSubRelays(repliesSubId, activeRelays);
      activeRelays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
      kind1Trace(traceStartedAtRef.current, 'fallback replies subscribe', {
        reason,
        elapsed: Date.now() - authorDiscoveryStartedAt,
        subId: repliesSubId,
        rootId: rootId.slice(0, 12),
        relays: activeRelays,
      });
      repliesUnsubRef.current = subscribeToNostr(
        repliesSubId,
        [{kinds: [1], tags: {'#e': [rootId]}, limit: PAGE_LIMIT, noCache: true, noContext: true, relays: activeRelays}],
        handleReplyMessage,
        {bytesPerEvent: REPLY_BYTES_PER_EVENT},
      );
    };
    timeout = setTimeout(() => {
      if (called) return;
      called = true;
      kind1Trace(traceStartedAtRef.current, 'author relays timeout', {
        elapsed: Date.now() - authorDiscoveryStartedAt,
        rootId: rootId.slice(0, 12),
        author: authorPubkey.slice(0, 12),
      });
      kind1Debug('author relays timeout', {
        rootId: rootId.slice(0, 12),
        author: authorPubkey.slice(0, 12),
      });
      authorRelayDiscoveryUnsubRef.current?.();
      authorRelayDiscoveryUnsubRef.current = null;
      startFallbackReplies('author-relays-timeout');
    }, 1000);

    const discoverySubId = `kind1_author_relays_${authorPubkey}_${relayHash(activeRelays)}`;
    authorRelayDiscoveryUnsubRef.current?.();
    kind1Trace(traceStartedAtRef.current, 'author relays subscribe', {
      subId: discoverySubId,
      rootId: rootId.slice(0, 12),
      author: authorPubkey.slice(0, 12),
      relays: activeRelays,
    });
    authorRelayDiscoveryUnsubRef.current = subscribeToNostr(
      discoverySubId,
      [
        {
          kinds: [10002],
          authors: [authorPubkey],
          limit: 1,
          cacheFirst: true,
          closeOnEOSE: true,
          relays: activeRelays,
        },
      ],
      message => {
        if (called) return;
        const kind10002 = isKind10002(message);
        const event = asParsedEvent(message);
        if (!kind10002 || event?.pubkey() !== authorPubkey) return;
        called = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }

        const relays = fbArray(kind10002, 'relays')
          .filter(relay => relay.read())
          .map(relay => relay.url() ?? '')
          .filter(Boolean)
          .map(normalizeRelayUrl);
        const incrementalRelays = [
          ...new Set(relays.filter(relay => !activeRelays.includes(relay))),
        ];
        setAuthorReadRelays(incrementalRelays);
        kind1Trace(traceStartedAtRef.current, 'author relays found', {
          elapsed: Date.now() - authorDiscoveryStartedAt,
          rootId: rootId.slice(0, 12),
          author: authorPubkey.slice(0, 12),
          relays,
          incrementalRelays,
        });
        kind1Debug('author relays found', {
          rootId: rootId.slice(0, 12),
          author: authorPubkey.slice(0, 12),
          relays: incrementalRelays,
        });
        if (!incrementalRelays.length) {
          startFallbackReplies('author-relays-empty');
          return;
        }

        const repliesSubId = `replies_author_live_${rootId}_${relayHash(incrementalRelays)}`;
        authorRepliesUnsubRef.current?.();
        setSubRelays(repliesSubId, incrementalRelays);
        incrementalRelays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
        kind1Trace(traceStartedAtRef.current, 'author replies subscribe', {
          subId: repliesSubId,
          rootId: rootId.slice(0, 12),
          relays: incrementalRelays,
        });
        authorRepliesUnsubRef.current = subscribeToNostr(
          repliesSubId,
          [
            {
              kinds: [1],
              tags: {'#e': [rootId]},
              limit: PAGE_LIMIT,
              noCache: true,
              noContext: true,
              relays: incrementalRelays,
            },
          ],
            handleReplyMessage,
            {bytesPerEvent: REPLY_BYTES_PER_EVENT},
          );
      },
      {bytesPerEvent: REPLY_BYTES_PER_EVENT},
    );

    return () => {
      if (authorReplyStartFrameRef.current) {
        cancelAnimationFrame(authorReplyStartFrameRef.current);
        authorReplyStartFrameRef.current = null;
      }
      if (timeout) clearTimeout(timeout);
      authorRelayDiscoveryUnsubRef.current?.();
      authorRelayDiscoveryUnsubRef.current = null;
      authorRepliesUnsubRef.current?.();
      authorRepliesUnsubRef.current = null;
    };
  }, [
    activeRelays,
    handleReplyMessage,
    headerItem,
    rootId,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  useEffect(() => {
    renderedItemsLengthRef.current = items.length;
    kind1Trace(traceStartedAtRef.current, 'render items', {
      rootId: rootId.slice(0, 12),
      renderedItems: items.length,
      refItems: itemsRef.current.length,
      allReplies: allReplies.length,
      hasHeader: !!headerItem,
      loading,
    });
    kind1Debug('render items', {
      rootId: rootId.slice(0, 12),
      renderedItems: items.length,
      refItems: itemsRef.current.length,
      first: items[0]?.id()?.slice(0, 12),
      last: items[items.length - 1]?.id()?.slice(0, 12),
      loading,
    });
  }, [allReplies.length, headerItem, items, loading, rootId]);

  useEffect(() => {
    if (loading || itemsBeforePaginationRef.current === 0) return;
    const itemsBefore = itemsBeforePaginationRef.current;
    const timeout = setTimeout(() => {
      if (itemsRef.current.length === itemsBefore) setHasMore(false);
      itemsBeforePaginationRef.current = 0;
      paginationUnsubRef.current?.();
      paginationUnsubRef.current = null;
    }, 500);
    return () => clearTimeout(timeout);
  }, [loading, items.length]);

  const handleNearBottom = useCallback(() => {
    // Temporarily disabled: do not paginate replies while testing Kind1Sub load behavior.
    return;

    if (loading || !hasMore || !itemsRef.current.length) return;
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    const until = lastItem?.createdAt() ? lastItem.createdAt() - 1 : undefined;
    if (!until) return;

    setLoading(true);
    itemsBeforePaginationRef.current = itemsRef.current.length;
    paginationCounterRef.current += 1;
    paginationUnsubRef.current?.();
    const pageSubId = `replies_${rootId}_page_${paginationCounterRef.current}_${until}_${relayHash(activeRelays)}`;
    paginationUnsubRef.current = subscribeToNostr(
      pageSubId,
      [{kinds: [1], tags: {'#e': [rootId]}, limit: PAGE_LIMIT, until, noContext: true, relays: activeRelays}],
      handleReplyMessage,
      {bytesPerEvent: REPLY_BYTES_PER_EVENT},
    );
    paginationTimeoutRef.current = setTimeout(() => setLoading(false), 10000);
  }, [activeRelays, handleReplyMessage, hasMore, loading, rootId]);

  const stickyHeader = useCallback(
    () => <Kind1StickyHeader onClose={onClose} />,
    [onClose],
  );
  const header = useCallback(
    () => (
      <Kind1Header
        headerItem={headerItem}
        onClose={onClose}
        relays={displayedRelays}
        visible={visible}
      />
    ),
    [displayedRelays, headerItem, onClose, visible],
  );
  const renderItem = useCallback(
    ({item, index, visible: itemVisible}: {item: ParsedEvent; index: number; visible: boolean}) => {
      if (__DEV__ && index < 3) {
        kind1Debug('render row', {
          rootId: rootId.slice(0, 12),
          index,
          id: item.id()?.slice(0, 12),
          createdAt: item.createdAt(),
          visible: visible && itemVisible,
        });
      }
      return (
        <ReplyItem
          headerPubkey={headerItem?.pubkey() ?? null}
          index={index}
          item={item}
          replies={allReplies}
          visible={visible && itemVisible}
        />
      );
    },
    [allReplies, headerItem, rootId, visible],
  );
  const getItemId = useCallback(
    (item: ParsedEvent) => item.id() || String(item.createdAt()),
    [],
  );

  return (
    <Feed
      items={items}
      getItemId={getItemId}
      renderItem={renderItem}
      header={header}
      headerSafeArea
      stickyHeader={stickyHeader}
      visible={visible}
      loading={false}
      onNearBottom={handleNearBottom}
      removeClippedSubviews={false}
      empty={headerItem ? (
        <View className="px-6 py-12">
          <Text className="text-center text-sm text-primary-content">
            No replies found.
          </Text>
        </View>
      ) : null}
      contentContainerClassName="pb-28"
    />
  );
}
