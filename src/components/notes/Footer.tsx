import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  CounterPipeConfigT,
  MuteFilterPipeConfigT,
  PipeConfig,
  PipeT,
  SaveToDbPipeConfigT,
  type ParsedEvent,
  type RequestObject,
  type WorkerMessage,
} from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import { asCountResponse } from '@candypoets/nipworker/utils';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { useAuthStore, useNostrStore } from '../../stores';
import { IconLike, IconReply, IconRepost, IconShare } from './ActionIcons';

type FooterProps = {
  note: ParsedEvent;
  visible: boolean;
};

const tint = '#9b9ea4';
const primary = '#158777';
const accent = '#6d28d9';
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

function countLabel(count: number) {
  return count > 0 ? String(count) : undefined;
}

function createCounterOptions(
  kinds: number[],
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
        new CounterPipeConfigT(kinds, pubkey),
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
}: {
  kind: ActionKind;
  label?: string;
  activeColor?: string;
  activeState?: boolean;
  animation?: 'bounce' | 'repost' | 'share';
}) {
  const progress = useSharedValue(0);
  const color = activeState && activeColor ? activeColor : tint;

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
      className="flex-row items-center gap-1 rounded px-0.5 py-0.5"
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
            'text-xs',
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

function ZapAction() {
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
      className="flex-row items-center gap-1"
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

export function Footer({ note, visible }: FooterProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const mutedPubkeys = useNostrStore(state => state.mutedPubkeys);
  const mutedHashtags = useNostrStore(state => state.mutedHashtags);
  const mutedWords = useNostrStore(state => state.mutedWords);
  const mutedEventIds = useNostrStore(state => state.mutedEventIds);
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [active, setActive] = useState({
    replied: false,
    reposted: false,
    reacted: false,
  });
  const noteId = note.id() || '';
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
    setCounts(emptyCounts);
    setActive({ replied: false, reposted: false, reacted: false });
  }, [noteId]);

  useEffect(() => {
    if (!visible || !noteId) return;

    return subscribeToNostr(
      `f_${noteId}_${relayKey}`,
      mainRequest,
      (message: WorkerMessage) => {
        const count = asCountResponse(message);
        if (!count) return;

        switch (count.kind()) {
          case 1:
            setCounts(current =>
              current.replies === count.count()
                ? current
                : { ...current, replies: count.count() },
            );
            if (count.you()) {
              setActive(current =>
                current.replied ? current : { ...current, replied: true },
              );
            }
            break;
          case 6:
            setCounts(current =>
              current.reposts === count.count()
                ? current
                : { ...current, reposts: count.count() },
            );
            if (count.you()) {
              setActive(current =>
                current.reposted ? current : { ...current, reposted: true },
              );
            }
            break;
          case 7:
            setCounts(current =>
              current.reactions === count.count()
                ? current
                : { ...current, reactions: count.count() },
            );
            if (count.you()) {
              setActive(current =>
                current.reacted ? current : { ...current, reacted: true },
              );
            }
            break;
        }
      },
      mainOptions,
    );
  }, [mainOptions, mainRequest, noteId, relayKey, visible]);

  useEffect(() => {
    if (!visible || !noteId) return;

    return subscribeToNostr(
      `fq_${noteId}_${relayKey}`,
      quoteRequest,
      (message: WorkerMessage) => {
        const count = asCountResponse(message);
        if (!count || count.kind() !== 1) return;

        setCounts(current =>
          current.quotes === count.count()
            ? current
            : { ...current, quotes: count.count() },
        );
        if (count.you()) {
          setActive(current =>
            current.reposted ? current : { ...current, reposted: true },
          );
        }
      },
      quoteOptions,
    );
  }, [noteId, quoteOptions, quoteRequest, relayKey, visible]);

  return (
    <View
      accessibilityLabel={`Actions for note ${note.id() || ''}`}
      className="mt-2 h-6 w-full flex-row items-center px-2 pl-10"
    >
      <View className="flex-1 flex-row items-center gap-2">
        <Action
          kind="reply"
          label={countLabel(counts.replies)}
          activeColor={accent}
          activeState={active.replied}
        />
        <Action
          kind="repost"
          label={countLabel(counts.reposts + counts.quotes)}
          activeColor={primary}
          activeState={active.reposted}
          animation="repost"
        />
        <Action
          kind="like"
          label={countLabel(counts.reactions)}
          activeColor={accent}
          activeState={active.reacted}
        />
        <Action kind="share" animation="share" />
      </View>
      <ZapAction />
    </View>
  );
}
