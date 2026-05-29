import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, InteractionManager, Pressable, Text, View } from 'react-native';
import {
  CounterPipeConfigT,
  MuteFilterPipeConfigT,
  PipeConfig,
  PipeT,
  SaveToDbPipeConfigT,
  type ParsedEvent,
  type RequestObject,
  type WorkerMessage,
  type ConnectionStatus,
} from '@candypoets/nipworker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asCountResponse,
  asEoce,
  isConnectionStatus,
  ConnectionTracker,
} from '@candypoets/nipworker/utils';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { kinds, type EventTemplate } from 'nostr-tools';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { useAuthStore, useNostrStore, useSendStatusStore } from '../../stores';
import { IconLike, IconReply, IconRepost, IconShare } from './ActionIcons';

type FooterProps = {
  note: ParsedEvent;
  visible: boolean;
  main?: boolean;
  mode?: 'inline' | 'zoom';
};

const tint = '#9b9ea4';
const primary = '#158777';
const accent = '#6d28d9';
const zoomActionStyle = { backgroundColor: 'rgba(15, 23, 42, 0.46)' };
const nutscashIcon = require('../../../assets/nutscash.svg');
const nutscashUri = Image.resolveAssetSource(nutscashIcon).uri;
let nutscashXmlCache: string | null = null;
let nutscashXmlPromise: Promise<string> | null = null;

type ActionKind = 'reply' | 'repost' | 'like' | 'share';
type Counts = {
  replies: number;
  reposts: number;
  quotes: number;
  reactions: number;
};

const emptyCounts: Counts = {
  replies: 0,
  reposts: 0,
  quotes: 0,
  reactions: 0,
};

type ActiveState = {
  replied: boolean;
  reposted: boolean;
  reacted: boolean;
};

const emptyActive: ActiveState = {
  replied: false,
  reposted: false,
  reacted: false,
};

function countLabel(count: number) {
  return count > 0 ? String(count) : undefined;
}

function createCounterOptions(
  targetKinds: number[],
  mutedPubkeys: string[],
  mutedHashtags: string[],
  mutedWords: string[],
  mutedEventIds: string[],
  pubkey: string,
) {
  return {
    pipeline: [
      new PipeT(
        PipeConfig.MuteFilterPipeConfig,
        new MuteFilterPipeConfigT(
          mutedPubkeys,
          mutedHashtags,
          mutedWords,
          mutedEventIds,
        ),
      ),
      new PipeT(PipeConfig.SaveToDbPipeConfig, new SaveToDbPipeConfigT()),
      new PipeT(
        PipeConfig.CounterPipeConfig,
        new CounterPipeConfigT(targetKinds, pubkey),
      ),
    ],
    bytesPerEvent: 256,
  };
}

function loadNutscashXml() {
  if (nutscashXmlCache) return Promise.resolve(nutscashXmlCache);

  nutscashXmlPromise ??= fetch(nutscashUri)
    .then(response => response.text())
    .then(xml => {
      nutscashXmlCache = xml
        .replace(/<\?xml[\s\S]*?\?>/, '')
        .replace(/<!DOCTYPE[\s\S]*?>/, '')
        .replace(/style="[^"]*"/, '')
        .replace(/fill="var\(--icon-fill\)"/g, `fill="${tint}"`);

      return nutscashXmlCache;
    });

  return nutscashXmlPromise;
}

function renderActionIcon(kind: ActionKind, color: string, animated: boolean) {
  switch (kind) {
    case 'reply':
      return <IconReply width={20} height={20} color={color} />;
    case 'repost':
      return <IconRepost width={20} height={20} color={color} />;
    case 'like':
      return (
        <IconLike
          width={20}
          height={20}
          color={color}
          filled={animated}
          showParticles={animated}
        />
      );
    case 'share':
      return <IconShare width={20} height={20} color={color} />;
  }
}

function Action({
  kind,
  label,
  activeColor,
  activeState = false,
  animation = 'bounce',
  mode = 'inline',
  onPress,
}: {
  kind: ActionKind;
  label?: string;
  activeColor?: string;
  activeState?: boolean;
  animation?: 'bounce' | 'repost' | 'share';
  mode?: 'inline' | 'zoom';
  onPress?: () => void;
}) {
  const progress = useSharedValue(0);
  const color =
    mode === 'zoom'
      ? '#fff'
      : activeState && activeColor
        ? activeColor
        : tint;

  useEffect(() => {
    if (!activeState) return;
    progress.value =
      animation === 'repost'
        ? withTiming(1, { duration: 500 })
        : withSequence(
            withTiming(1, { duration: 120 }),
            withTiming(0.4, { duration: 100 }),
            withTiming(0.75, { duration: 90 }),
            withTiming(0, { duration: 90 }),
          );
  }, [activeState, animation, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    if (animation === 'repost') {
      return {
        transform: [{ rotate: `${progress.value * -360}deg` }],
      };
    }
    if (animation === 'share') {
      return {
        opacity: 1 - progress.value * 0.2,
        transform: [
          { translateX: progress.value * 3 },
          { translateY: progress.value * -3 },
          { rotate: `${progress.value * -20}deg` },
        ],
      };
    }
    return {
      transform: [
        { scale: 1 + progress.value * 0.2 },
        { rotate: `${progress.value * -8}deg` },
      ],
    };
  });

  const pressIn = () => {
    if (activeState) return;
    progress.value = withTiming(1, { duration: 140 });
  };
  const pressOut = () => {
    if (activeState) return;
    progress.value = withTiming(0, { duration: 160 });
  };

  return (
    <Pressable
      className={
        mode === 'zoom'
          ? 'min-w-[72px] flex-row items-center justify-center gap-2 rounded-full px-4 py-3'
          : 'flex-row items-center gap-1 rounded px-0.5 py-0.5'
      }
      style={
        mode === 'zoom' ? zoomActionStyle : undefined
      }
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
    >
      <Animated.View
        className="h-5 w-5 items-center justify-center"
        style={animatedStyle}
      >
        {renderActionIcon(kind, color, activeState)}
      </Animated.View>
      {label ? (
        <Text
          className={[
            mode === 'zoom' ? 'text-base' : 'text-xs',
            activeState ? 'font-semibold' : '',
          ].join(' ')}
          style={{ color }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ZapAction({ mode = 'inline' }: { mode?: 'inline' | 'zoom' }) {
  const [nutscashXml, setNutscashXml] = useState<string | null>(null);
  const progress = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.value * -2 },
      { scale: 1 + progress.value * 0.08 },
    ],
  }));

  useEffect(() => {
    let cancelled = false;

    loadNutscashXml()
      .then(xml => {
        if (cancelled) return;
        setNutscashXml(xml);
      })
      .catch(() => {
        if (!cancelled) setNutscashXml(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Pressable
      className={
        mode === 'zoom'
          ? 'h-12 w-12 items-center justify-center rounded-full'
          : 'flex-row items-center gap-1'
      }
      style={
        mode === 'zoom' ? zoomActionStyle : undefined
      }
      onPressIn={() => {
        progress.value = withTiming(1, { duration: 140 });
      }}
      onPressOut={() => {
        progress.value = withTiming(0, { duration: 160 });
      }}
    >
      <Animated.View style={style}>
        {nutscashXml ? (
          <SvgXml xml={nutscashXml} width={24} height={24} color={tint} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

export function Footer({
  note,
  visible,
  main = false,
  mode = 'inline',
}: FooterProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [active, setActive] = useState<ActiveState>(emptyActive);
  const countsRef = useRef<Counts>(emptyCounts);
  const activeRef = useRef<ActiveState>(emptyActive);
  const pendingCountsRef = useRef<Counts>(emptyCounts);
  const pendingActiveRef = useRef<ActiveState>(emptyActive);
  const noteId = note.id() || '';
  const notePubkey = note.pubkey() || '';
  const relays = useMemo(
    () => (readRelays.length ? readRelays : DEFAULT_FEED_RELAYS),
    [readRelays],
  );
  const relayKey = relays.join(',');
  const mainRequest = useMemo<RequestObject[]>(
    () => [
      {
        kinds: [1, 6, 7],
        tags: { '#e': [noteId] },
        noContext: true,
        relays,
      },
    ],
    [noteId, relays],
  );
  const quoteRequest = useMemo<RequestObject[]>(
    () => [
      {
        kinds: [1],
        tags: { '#q': [noteId] },
        noContext: true,
        relays,
      },
    ],
    [noteId, relays],
  );
  const mainOptions = useMemo(
    () =>
      createCounterOptions(
        [1, 6, 7],
        mutedPubkeys,
        mutedHashtags,
        mutedWords,
        mutedEventIds,
        pubkey || '',
      ),
    [
      mutedEventIds,
      mutedHashtags,
      mutedPubkeys,
      mutedWords,
      pubkey,
    ],
  );
  const quoteOptions = useMemo(
    () =>
      createCounterOptions(
        [1],
        mutedPubkeys,
        mutedHashtags,
        mutedWords,
        mutedEventIds,
        pubkey || '',
      ),
    [
      mutedEventIds,
      mutedHashtags,
      mutedPubkeys,
      mutedWords,
      pubkey,
    ],
  );

  useEffect(() => {
    countsRef.current = emptyCounts;
    activeRef.current = emptyActive;
    pendingCountsRef.current = emptyCounts;
    pendingActiveRef.current = emptyActive;
    setCounts(emptyCounts);
    setActive(emptyActive);
  }, [noteId]);

  const commitPendingState = useCallback(() => {
    const pendingCounts = pendingCountsRef.current;
    const pendingActive = pendingActiveRef.current;

    setCounts(current => {
      if (
        current.replies === pendingCounts.replies &&
        current.reposts === pendingCounts.reposts &&
        current.quotes === pendingCounts.quotes &&
        current.reactions === pendingCounts.reactions
      ) {
        return current;
      }
      countsRef.current = pendingCounts;
      return pendingCounts;
    });

    setActive(current => {
      if (
        current.replied === pendingActive.replied &&
        current.reposted === pendingActive.reposted &&
        current.reacted === pendingActive.reacted
      ) {
        return current;
      }
      activeRef.current = pendingActive;
      return pendingActive;
    });
  }, []);

  const updatePendingMainCount = useCallback((message: WorkerMessage) => {
    const count = asCountResponse(message);
    if (!count) return;

    const nextCounts = {...pendingCountsRef.current};
    const nextActive = {...pendingActiveRef.current};

    switch (count.kind()) {
      case 1:
        nextCounts.replies = count.count();
        if (count.you()) nextActive.replied = true;
        break;
      case 6:
        nextCounts.reposts = count.count();
        if (count.you()) nextActive.reposted = true;
        break;
      case 7:
        nextCounts.reactions = count.count();
        if (count.you()) nextActive.reacted = true;
        break;
    }

    pendingCountsRef.current = nextCounts;
    pendingActiveRef.current = nextActive;
  }, []);

  const updatePendingQuoteCount = useCallback((message: WorkerMessage) => {
    const count = asCountResponse(message);
    if (!count || count.kind() !== 1) return;

    pendingCountsRef.current = {
      ...pendingCountsRef.current,
      quotes: count.count(),
    };
    if (count.you()) {
      pendingActiveRef.current = {
        ...pendingActiveRef.current,
        reposted: true,
      };
    }
  }, []);

  const sendReaction = useCallback(() => {
    if (!pubkey || !noteId || !notePubkey || activeRef.current.reacted) return;

    const event: EventTemplate = {
      kind: kinds.Reaction,
      tags: [
        ['e', noteId],
        ['p', notePubkey],
      ],
      content: '+',
      created_at: Math.floor(Date.now() / 1000),
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `reaction_${noteId}`;

    publishToNostr(
      sendId,
      event,
      (message: WorkerMessage) => {
        const status = isConnectionStatus(message);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;

        sendStatus[relayUrl] = status;
        updateSendStatus(sendId, sendStatus);
        if (status.status()?.toString() === 'true' && !activeRef.current.reacted) {
          pendingActiveRef.current = {
            ...pendingActiveRef.current,
            reacted: true,
          };
          pendingCountsRef.current = {
            ...pendingCountsRef.current,
            reactions: pendingCountsRef.current.reactions + 1,
          };
          commitPendingState();
        }
      },
      {defaultRelays: relays, trackStatus: true},
    );
  }, [commitPendingState, noteId, notePubkey, pubkey, relays, updateSendStatus]);

  useEffect(() => {
    if (!visible || !noteId) return;

    let unsubscribe: (() => void) | null = null;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      const tracker = new ConnectionTracker();
      let resolving = true;
      fallbackTimeout = setTimeout(() => {
        resolving = false;
        commitPendingState();
      }, 1500);
      unsubscribe = subscribeToNostr(
        `f_${noteId}_${relayKey}`,
        mainRequest,
        (message: WorkerMessage) => {
          if (asEoce(message)) {
            commitPendingState();
            return;
          }
          const status = asConnectionStatus(message);
          if (status) {
            tracker.handleMessage(message);
            if (tracker.resolutionRate > 0.5) {
              resolving = false;
              if (fallbackTimeout) {
                clearTimeout(fallbackTimeout);
                fallbackTimeout = null;
              }
              commitPendingState();
            }
            return;
          }
          updatePendingMainCount(message);
          if (!resolving) commitPendingState();
        },
        mainOptions,
      );
    });

    return () => {
      interaction.cancel();
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
      unsubscribe?.();
    };
  }, [
    commitPendingState,
    mainOptions,
    mainRequest,
    noteId,
    relayKey,
    updatePendingMainCount,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !noteId) return;

    let unsubscribe: (() => void) | null = null;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      const tracker = new ConnectionTracker();
      let resolving = true;
      fallbackTimeout = setTimeout(() => {
        resolving = false;
        commitPendingState();
      }, 1500);
      unsubscribe = subscribeToNostr(
        `fq_${noteId}_${relayKey}`,
        quoteRequest,
        (message: WorkerMessage) => {
          if (asEoce(message)) {
            commitPendingState();
            return;
          }
          const status = asConnectionStatus(message);
          if (status) {
            tracker.handleMessage(message);
            if (tracker.resolutionRate > 0.5) {
              resolving = false;
              if (fallbackTimeout) {
                clearTimeout(fallbackTimeout);
                fallbackTimeout = null;
              }
              commitPendingState();
            }
            return;
          }
          updatePendingQuoteCount(message);
          if (!resolving) commitPendingState();
        },
        quoteOptions,
      );
    });

    return () => {
      interaction.cancel();
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
      unsubscribe?.();
    };
  }, [
    commitPendingState,
    noteId,
    quoteOptions,
    quoteRequest,
    relayKey,
    updatePendingQuoteCount,
    visible,
  ]);

  return (
    <View
      accessibilityLabel={`Actions for note ${note.id() || ''}`}
      className={[
        mode === 'zoom'
          ? 'mt-3 w-full flex-row items-center justify-between'
          : 'mt-2 h-6 w-full flex-row items-center px-2',
        mode === 'zoom' ? '' : main ? 'pl-2' : 'pl-10',
      ].join(' ')}
    >
      <View
        className={
          mode === 'zoom'
            ? 'flex-1 flex-row items-center justify-between gap-3'
            : 'flex-1 flex-row items-center gap-2'
        }
      >
        <Action
          kind="reply"
          label={countLabel(counts.replies)}
          activeColor={accent}
          activeState={active.replied}
          mode={mode}
        />
        <Action
          kind="repost"
          label={countLabel(counts.reposts + counts.quotes)}
          activeColor={primary}
          activeState={active.reposted}
          animation="repost"
          mode={mode}
        />
        <Action
          kind="like"
          label={countLabel(counts.reactions)}
          activeColor={accent}
          activeState={active.reacted}
          mode={mode}
          onPress={sendReaction}
        />
        <Action kind="share" animation="share" mode={mode} />
      </View>
      {mode === 'zoom' ? null : <ZapAction />}
    </View>
  );
}
