import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import {MessageType} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1,
  asKind1111,
  asParsedEvent,
  fbArray,
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
const EMPTY_EVENTS: ParsedEvent[] = [];
const EMPTY_RELAY_LIST: string[] = [];
const KIND1_DEBUG = false;
const KIND1_TRACE = false;
const KIND1_REACTIVITY_DEBUG = false;
const KIND1_RENDER_HEADER_NOTE = true;

function shouldLogReactivityCount(count: number) {
  return count <= 10 || count % 25 === 0;
}

type Kind1SubProps = {
  enableHeaderSubscription?: boolean;
  enableReplySubscriptions?: boolean;
  nevent: string;
  keepSubscriptionsOnBlur?: boolean;
  renderFeed?: boolean;
  runLifecycleEffects?: boolean;
  visible: boolean;
  onClose: () => void;
};

type Kind1MotionHeaderProps = {
  headerItem: ParsedEvent | null;
  onClose: () => void;
  relays: string[];
};

type Kind1PostHeaderProps = {
  headerItem: ParsedEvent | null;
  visible: boolean;
};

type ReplyItemProps = {
  headerAuthorPubkey?: string;
  index: number;
  item: ParsedEvent;
  visible: boolean;
};

type ReplyThreadNodeProps = {
  headerAuthorPubkey?: string;
  item: ParsedEvent;
  tailing?: boolean;
  visible: boolean;
};

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  // Hash the full joined relay list: truncating the concatenated urls made
  // different relay sets with the same first relay(s) collide, letting the
  // worker silently reuse a stale subscription id.
  const joined = relays
    .map(relay => relay.replace(/[^a-zA-Z0-9]/g, ''))
    .join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 31 + joined.charCodeAt(index)) % 2147483647;
  }
  return hash.toString(36);
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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

function replyParentId(event: ParsedEvent) {
  if (event.kind() === 1) return asKind1(event)?.reply()?.id() || undefined;
  if (event.kind() === 1111)
    return asKind1111(event)?.parentId?.() || undefined;
  return undefined;
}

function replyRequests(
  rootId: string,
  relays: string[],
  options: Pick<RequestObject, 'cacheFirst' | 'noCache'>,
): RequestObject[] {
  const common = {
    limit: PAGE_LIMIT,
    noContext: true,
    relays,
    ...options,
  };
  return [
    { ...common, kinds: [1], tags: {'#e': [rootId]} },
    { ...common, kinds: [1111], tags: {'#E': [rootId]} },
  ];
}

const Kind1MotionHeader = memo(function Kind1MotionHeader({
  headerItem,
  onClose,
  relays,
}: Kind1MotionHeaderProps) {
  const theme = useAppTheme();

  return (
    <View className="border-b border-base-200 bg-base-300/95">
      <View className="h-16 flex-row items-center justify-between px-4">
        <Pressable
          accessibilityLabel="Close post"
          className="h-9 w-9 items-center justify-center rounded-full bg-base-200"
          hitSlop={12}
          onPress={onClose}>
          <ChevronLeft size={22} color={theme.colors.primaryContent} />
        </Pressable>
        <View
          className="absolute inset-0 items-center justify-center"
          pointerEvents="none">
          <Text className="text-base font-semibold text-base-content">
            Post
          </Text>
        </View>
        <View className="min-h-9 min-w-9 items-end justify-center">
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
    </View>
  );
});

const Kind1PostHeader = memo(function Kind1PostHeader({
  headerItem,
  visible,
}: Kind1PostHeaderProps) {
  if (!headerItem) return null;

  return (
    <View className="px-1 pb-2">
      {KIND1_RENDER_HEADER_NOTE ? (
        <Note note={headerItem} visible={visible} main threadCard />
      ) : (
        <View className="rounded-xl border border-base-200 bg-base-300/95 px-4 py-6">
          <Text className="text-sm text-primary-content">
            Kind1 header loaded: {headerItem.id()?.slice(0, 12)}
          </Text>
        </View>
      )}
    </View>
  );
});

const ReplyItem = memo(
  function ReplyItem({headerAuthorPubkey, index, item, visible}: ReplyItemProps) {
    return (
      <View className={index === 0 ? 'px-1 pb-1.5 pt-1' : 'px-1 pb-1.5'}>
        <ReplyThreadNode
          headerAuthorPubkey={headerAuthorPubkey}
          item={item}
          visible={visible}
        />
      </View>
    );
  },
  (previous, next) =>
    previous.headerAuthorPubkey === next.headerAuthorPubkey &&
    previous.index === next.index &&
    previous.item.id() === next.item.id() &&
    previous.visible === next.visible,
);

const ReplyThreadNode = memo(
  function ReplyThreadNode({
    headerAuthorPubkey,
    item,
    tailing = false,
    visible,
  }: ReplyThreadNodeProps) {
    const showReplies = useCallback(
      (newPost: ParsedEvent) => (replies: ParsedEvent[]) => {
        const matchingReplies = replies.filter(reply => {
          return (
            (reply.pubkey() === item.pubkey() ||
              reply.pubkey() === headerAuthorPubkey) &&
            replyParentId(reply) === newPost.id()
          );
        });

        if (!matchingReplies.length) return matchingReplies;

        return [
          matchingReplies.reduce((oldest, reply) =>
            reply.createdAt() < oldest.createdAt() ? reply : oldest,
          ),
        ];
      },
      [headerAuthorPubkey, item],
    );

    return (
      <Note
        note={item}
        visible={visible}
        footer
        showQuote={false}
        showRoot={false}
        showReplies={showReplies}
        tailing={tailing}
        threadCard
      />
    );
  },
  (previous, next) =>
    previous.headerAuthorPubkey === next.headerAuthorPubkey &&
    previous.item.id() === next.item.id() &&
    (previous.tailing ?? false) === (next.tailing ?? false) &&
    previous.visible === next.visible,
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

export function Kind1Sub({
  enableHeaderSubscription = true,
  enableReplySubscriptions = true,
  nevent,
  keepSubscriptionsOnBlur = false,
  renderFeed = true,
  runLifecycleEffects = true,
  visible,
  onClose,
}: Kind1SubProps) {
  const instanceIdRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const renderCountRef = useRef(0);
  const effectCountsRef = useRef<Record<string, number>>({});
  const traceStartedAtRef = useRef(Date.now());
  const data = useMemo(() => decodeEventPointer(nevent), [nevent]);
  const rootId = data.id ?? '';
  const subscriptionVisible = visible || keepSubscriptionsOnBlur;
  const diagnosticContextRef = useRef({rootId, visible});
  diagnosticContextRef.current = {rootId, visible};
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
  // Primitive projections of headerItem. Effects and row renderers depend on
  // these instead of the headerItem object so a duplicate header delivery
  // (same id, new FlatBuffers instance) cannot retrigger them.
  const hasHeader = headerItem !== null;
  const headerAuthorPubkey = headerItem?.pubkey() ?? undefined;

  renderCountRef.current += 1;
  if (
    __DEV__ &&
    KIND1_REACTIVITY_DEBUG &&
    shouldLogReactivityCount(renderCountRef.current)
  ) {
    console.log('[kind1-reactivity] render', {
      instance: instanceIdRef.current,
      count: renderCountRef.current,
      rootId: rootId.slice(0, 12),
      visible,
      header: headerItem?.id()?.slice(0, 12) ?? null,
      items: items.length,
      allReplies: allReplies.length,
      loading,
      hasMore,
      rootReadRelays: rootReadRelays.length,
      activeRelays: activeRelays.length,
      authorReadRelays: authorReadRelays.length,
      displayedRelays: displayedRelays.length,
    });
  }

  const logEffectCycle = useCallback(
    (
      effect: string,
      phase: 'run' | 'cleanup',
      details?: Record<string, unknown>,
    ) => {
      if (!__DEV__ || !KIND1_REACTIVITY_DEBUG) return;
      const key = `${effect}:${phase}`;
      const count = (effectCountsRef.current[key] ?? 0) + 1;
      effectCountsRef.current[key] = count;
      if (!shouldLogReactivityCount(count)) return;
      console.log(`[kind1-reactivity] effect ${phase}`, {
        instance: instanceIdRef.current,
        effect,
        count,
        rootId: diagnosticContextRef.current.rootId.slice(0, 12),
        visible: diagnosticContextRef.current.visible,
        ...details,
      });
    },
    [],
  );

  useEffect(() => {
    if (!runLifecycleEffects) return;
    logEffectCycle('trace-root', 'run', {
      activeRelays: activeRelays.length,
      initialRelays: initialRelays.length,
      rootReadRelays: rootReadRelays.length,
    });
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
  }, [
    activeRelays,
    initialRelays,
    logEffectCycle,
    rootId,
    rootReadRelays,
    runLifecycleEffects,
  ]);

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
      const kind1 = event.kind() === 1 ? asKind1(event) : null;
      const kind1111 = event.kind() === 1111 ? asKind1111(event) : null;
      if (!kind1 && !kind1111) {
        statsRef.current.dropKind += 1;
        return;
      }

      const parentId = kind1?.reply()?.id() || kind1111?.parentId?.();
      if (kind1) {
        const rootRefId = kind1.root()?.id();
        if (parentId && parentId !== rootId) {
          statsRef.current.dropNoRootTag += 1;
          return;
        }
        if ((!parentId || parentId === rootRefId) && rootRefId !== rootId) {
          statsRef.current.dropNoRootTag += 1;
          return;
        }
        if (
          fbArray(kind1, 'eventRefs').some(eventRef => eventRef.id() === rootId)
        ) {
          statsRef.current.dropQuote += 1;
          return;
        }
      } else if (kind1111?.rootId?.() !== rootId) {
        statsRef.current.dropNoRootTag += 1;
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
      if (!parentId || parentId === rootId) {
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
    // Bail when already empty: fresh [] literals would change state identity
    // and force an extra render pass on every mount and root change.
    setAuthorReadRelays(current => (current.length ? EMPTY_RELAY_LIST : current));
    setItems(current => (current.length ? EMPTY_EVENTS : current));
    setAllReplies(current => (current.length ? EMPTY_EVENTS : current));
    setHasMore(true);
    setLoading(false);
    cleanupSubscriptions();
  }, [cleanupSubscriptions, rootId]);

  useEffect(() => {
    if (!runLifecycleEffects) return undefined;
    logEffectCycle('unmount-cleanup', 'run');
    return () => {
      logEffectCycle('unmount-cleanup', 'cleanup');
      cleanupSubscriptions();
    };
  }, [cleanupSubscriptions, logEffectCycle, runLifecycleEffects]);

  useEffect(() => {
    if (!runLifecycleEffects) return;
    logEffectCycle('reset-root', 'run');
    reset();
  }, [logEffectCycle, reset, rootId, runLifecycleEffects]);

  useEffect(() => {
    if (!runLifecycleEffects) return undefined;
    logEffectCycle('header-subscription', 'run', {
      activeRelays: activeRelays.length,
      enabled: enableHeaderSubscription,
      eligible: enableHeaderSubscription && !!rootId,
    });
    // Not gated on visible: the header sub is cheap (single id, cacheFirst)
    // and starting it at mount lets the root event resolve during the push
    // animation instead of after it (same as the kind0 profile sub).
    if (!enableHeaderSubscription || !rootId) {
      return undefined;
    }

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
      [{ids: [rootId], limit: 1, relays: activeRelays, cacheFirst: true}],
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
        if (!parsedEvent || parsedEvent.id() !== rootId) return;
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
        // Guard identity: relays/cache can redeliver the same root event as a
        // new FlatBuffers instance; keep the previous object so dependents of
        // headerItem do not re-run.
        setHeaderItem(current =>
          current?.id() === parsedEvent.id() ? current : parsedEvent,
        );
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
      logEffectCycle('header-subscription', 'cleanup');
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
    enableHeaderSubscription,
    initialRelays,
    logEffectCycle,
    rootId,
    rootReadRelays,
    runLifecycleEffects,
    setRelayStatus,
    setSubRelays,
  ]);

  useEffect(() => {
    if (!runLifecycleEffects) return undefined;
    logEffectCycle('reply-cache-subscription', 'run', {
      activeRelays: activeRelays.length,
      enabled: enableReplySubscriptions,
      eligible:
        enableReplySubscriptions &&
        subscriptionVisible &&
        !!rootId &&
        hasHeader,
      header: hasHeader,
    });
    if (
      !enableReplySubscriptions ||
      !subscriptionVisible ||
      !rootId ||
      !hasHeader
    ) {
      return undefined;
    }
    repliesSubSeqRef.current += 1;
    const repliesSeq = repliesSubSeqRef.current;
    const repliesStartedAt = Date.now();
    const cacheSubId = `replies_cache_${rootId}_${relayHash(activeRelays)}`;
    repliesCacheUnsubRef.current?.();
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
      replyRequests(rootId, activeRelays, {cacheFirst: true}),
      handleReplyMessage,
      {bytesPerEvent: REPLY_BYTES_PER_EVENT},
    );
    repliesDebugTimeoutRef.current = setTimeout(() => {
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

    return () => {
      logEffectCycle('reply-cache-subscription', 'cleanup');
      kind1Trace(traceStartedAtRef.current, 'cache replies cleanup', {
        seq: repliesSeq,
        elapsed: Date.now() - repliesStartedAt,
        rootId: rootId.slice(0, 12),
      });
      repliesCacheUnsubRef.current?.();
      repliesCacheUnsubRef.current = null;
      if (repliesDebugTimeoutRef.current) {
        clearTimeout(repliesDebugTimeoutRef.current);
        repliesDebugTimeoutRef.current = null;
      }
    };
  }, [
    activeRelays,
    enableReplySubscriptions,
    handleReplyMessage,
    hasHeader,
    logEffectCycle,
    rootId,
    runLifecycleEffects,
    subscriptionVisible,
  ]);

  useEffect(() => {
    if (!runLifecycleEffects) return undefined;
    const authorPubkey = headerAuthorPubkey;
    logEffectCycle('author-relay-subscription', 'run', {
      activeRelays: activeRelays.length,
      enabled: enableReplySubscriptions,
      eligible:
        enableReplySubscriptions &&
        visible &&
        !!rootId &&
        !!authorPubkey,
      author: authorPubkey?.slice(0, 12) ?? null,
    });
    if (
      !enableReplySubscriptions ||
      !visible ||
      !rootId ||
      !authorPubkey
    ) {
      return undefined;
    }

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
        replyRequests(rootId, activeRelays, {noCache: true}),
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
        // Bail when discovery resolves to the same relays: a new array here
        // would rerender and churn displayedRelays/motionHeader for nothing.
        setAuthorReadRelays(current =>
          sameStringArray(current, incrementalRelays) ? current : incrementalRelays,
        );
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
          replyRequests(rootId, incrementalRelays, {noCache: true}),
          handleReplyMessage,
          {bytesPerEvent: REPLY_BYTES_PER_EVENT},
        );
      },
      {bytesPerEvent: REPLY_BYTES_PER_EVENT},
    );

    return () => {
      logEffectCycle('author-relay-subscription', 'cleanup');
      if (timeout) clearTimeout(timeout);
      authorRelayDiscoveryUnsubRef.current?.();
      authorRelayDiscoveryUnsubRef.current = null;
      authorRepliesUnsubRef.current?.();
      authorRepliesUnsubRef.current = null;
    };
  }, [
    activeRelays,
    enableReplySubscriptions,
    handleReplyMessage,
    headerAuthorPubkey,
    logEffectCycle,
    rootId,
    runLifecycleEffects,
    setRelayStatus,
    setSubRelays,
    visible,
  ]);

  useEffect(() => {
    if (!runLifecycleEffects) return;
    logEffectCycle('rendered-state', 'run', {
      items: items.length,
      allReplies: allReplies.length,
      header: headerItem?.id()?.slice(0, 12) ?? null,
      loading,
    });
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
  }, [
    allReplies.length,
    headerItem,
    items,
    loading,
    logEffectCycle,
    rootId,
    runLifecycleEffects,
  ]);

  useEffect(() => {
    if (!runLifecycleEffects) return undefined;
    logEffectCycle('pagination-settle', 'run', {
      loading,
      items: items.length,
      itemsBeforePagination: itemsBeforePaginationRef.current,
    });
    if (loading || itemsBeforePaginationRef.current === 0) return;
    const itemsBefore = itemsBeforePaginationRef.current;
    const timeout = setTimeout(() => {
      if (itemsRef.current.length === itemsBefore) setHasMore(false);
      itemsBeforePaginationRef.current = 0;
      paginationUnsubRef.current?.();
      paginationUnsubRef.current = null;
    }, 500);
    return () => {
      logEffectCycle('pagination-settle', 'cleanup');
      clearTimeout(timeout);
    };
  }, [loading, items.length, logEffectCycle, runLifecycleEffects]);

  const handleNearBottom = useCallback(() => {
    // Temporarily disabled: do not paginate replies while testing Kind1Sub load behavior.
  }, []);

  const motionHeader = useCallback(
    () => (
      <Kind1MotionHeader
        headerItem={headerItem}
        onClose={onClose}
        relays={displayedRelays}
      />
    ),
    [displayedRelays, headerItem, onClose],
  );
  const header = useCallback(
    () => <Kind1PostHeader headerItem={headerItem} visible={visible} />,
    [headerItem, visible],
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
          headerAuthorPubkey={headerAuthorPubkey}
          index={index}
          item={item}
          visible={visible && itemVisible}
        />
      );
    },
    [headerAuthorPubkey, rootId, visible],
  );
  const getItemId = useCallback(
    (item: ParsedEvent) => item.id() || String(item.createdAt()),
    [],
  );

  if (!renderFeed) {
    return (
      <View className="flex-1 items-center justify-center bg-base-100 px-6">
        <Text className="text-center text-base text-base-content">
          Nested Kind1Sub hooks active; Feed disabled
        </Text>
      </View>
    );
  }

  return (
    <Feed
      items={items}
      getItemId={getItemId}
      renderItem={renderItem}
      motionHeader={motionHeader}
      header={header}
      headerSafeArea
      visible={visible}
      loading={loading}
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
