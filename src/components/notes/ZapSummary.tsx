import React, { memo, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type {
  Kind9321Parsed,
  Kind9735Parsed,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import { ParsedData } from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import {
  asKind9321,
  asKind9735,
  asParsedEvent,
} from '@candypoets/nipworker/utils';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { Avatar } from './Avatar';

type ZapSummaryProps = {
  note: ParsedEvent;
  visible: boolean;
  relays?: string[];
  className?: string;
};

type ZapItem = {
  id: string;
  amount: number;
  sender: string;
  comment: string;
  kind: 9321 | 9735;
};

const EMPTY_RELAYS: string[] = [];

function uniqueRelays(relays: string[]) {
  return [...new Set(relays.filter(Boolean))];
}

function zapFromParsed(event: ParsedEvent): ZapItem | null {
  if (event.parsedType() === ParsedData.Kind9321Parsed) {
    const zap = asKind9321(event) as Kind9321Parsed | null;
    if (!zap) return null;
    return {
      id: zap.id() || event.id() || '',
      amount: Number(zap.amount() || 0),
      sender: zap.sender() || event.pubkey() || '',
      comment: zap.comment() || '',
      kind: 9321,
    };
  }

  if (event.parsedType() === ParsedData.Kind9735Parsed) {
    const zap = asKind9735(event) as Kind9735Parsed | null;
    if (!zap) return null;
    return {
      id: zap.id() || event.id() || '',
      amount: Number(zap.amount() || 0),
      sender: zap.sender() || event.pubkey() || '',
      comment: zap.content() || '',
      kind: 9735,
    };
  }

  return null;
}

function upsertZap(items: ZapItem[], item: ZapItem) {
  if (!item.id) return items;
  const next = items.filter(current => current.id !== item.id);
  next.push(item);
  return next.sort((left, right) => right.amount - left.amount);
}

function ZapSummaryComponent({
  note,
  visible,
  relays = EMPTY_RELAYS,
  className,
}: ZapSummaryProps) {
  const [zaps, setZaps] = useState<ZapItem[]>([]);
  const noteId = note.id() || '';
  const subscriptionRelays = useMemo(
    () => uniqueRelays([...relays, ...DEFAULT_FEED_RELAYS]),
    [relays],
  );
  const totalAmount = zaps.reduce((sum, zap) => sum + zap.amount, 0);
  const biggestZap = zaps[0];
  const otherSenderZaps = biggestZap
    ? zaps.filter(zap => zap.sender && zap.sender !== biggestZap.sender)
    : zaps;

  useEffect(() => {
    setZaps([]);
  }, [noteId]);

  useEffect(() => {
    if (!visible || !noteId || !subscriptionRelays.length) return;

    const timeout = setTimeout(() => {
      const unsubscribe = subscribeToNostr(
        `z_${noteId}_${subscriptionRelays.join(',')}`,
        [
          {
            kinds: [9735, 9321],
            tags: { '#e': [noteId] },
            noContext: true,
            limit: 100,
            since: note.createdAt(),
            relays: subscriptionRelays,
          },
        ],
        (message: WorkerMessage) => {
          const parsed = asParsedEvent(message);
          if (!parsed) return;
          const zap = zapFromParsed(parsed);
          if (!zap) return;
          setZaps(current => upsertZap(current, zap));
        },
        { closeOnEose: false },
      );

      cleanup = unsubscribe;
    }, 1000);

    let cleanup: (() => void) | null = null;
    return () => {
      clearTimeout(timeout);
      cleanup?.();
    };
  }, [note, noteId, subscriptionRelays, visible]);

  if (!zaps.length) {
    return null;
  }

  return (
    <View
      className={[
        'relative z-0 flex-row items-center justify-end pl-10',
        className || '',
      ].join(' ')}
    >
      {biggestZap ? (
        <View className="min-w-0 flex-row items-center justify-end gap-1">
          {biggestZap.comment ? (
            <Text
              className="min-w-0 max-w-[48%] flex-shrink text-xs text-primary-content"
              numberOfLines={1}
            >
              "{biggestZap.comment}"
            </Text>
          ) : null}
          <View className="flex-row items-center">
            <Text className="text-xs font-semibold text-white">⚡</Text>
            <Text className="text-xs font-semibold text-base-content">
              {totalAmount.toLocaleString()}
            </Text>
          </View>
          {otherSenderZaps.length ? (
            <View className="z-20 -mr-2 flex-row items-center">
              {otherSenderZaps.slice(0, 5).map((zap, index) => (
                <View key={zap.id} className={index === 0 ? '' : '-ml-2'}>
                  <Avatar pubkey={zap.sender} size="xs" link />
                </View>
              ))}
              {otherSenderZaps.length > 5 ? (
                <View className="-ml-2 rounded-full border border-base-100 bg-base-200 px-1.5 py-0.5">
                  <Text className="text-[10px] font-bold text-base-content">
                    +{otherSenderZaps.length - 5}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View className="z-10 -ml-0.5 mt-0.5">
            <Avatar pubkey={biggestZap.sender} size="zap" link />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export const ZapSummary = memo(ZapSummaryComponent);
