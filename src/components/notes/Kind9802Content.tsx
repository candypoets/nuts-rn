import React, {memo, useMemo} from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {asPreGeneric} from '@candypoets/nipworker/utils';
import { ExternalLink, Quote } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import {
  decode,
  naddrEncode,
  neventEncode,
  type AddressPointer,
} from 'nostr-tools/nip19';

import {
  highlightSourceFromTags,
  highlightTagValue,
} from '../../nostr/highlights';
import { pushDistinct } from '../../navigation/pushDistinct';
import { useAppTheme } from '../../theme';
import {eventTags, stringValue} from './kindHelpers';

type Kind9802ContentProps = {
  note: ParsedEvent;
};

function Kind9802ContentComponent({note}: Kind9802ContentProps) {
  const router = useRouter();
  const theme = useAppTheme();
  const highlight = useMemo(() => asPreGeneric(note), [note]);
  const tags = useMemo(() => eventTags(note), [note]);
  const source = useMemo(() => highlightSourceFromTags(tags), [tags]);
  const context = highlightTagValue(tags, 'context');
  const comment = highlightTagValue(tags, 'comment');
  const content = stringValue(highlight?.content());

  function openSource() {
    if (!source) return;
    if (source.type === 'url') {
      Linking.openURL(source.url).catch(() => {});
      return;
    }
    if (source.type === 'event') {
      pushDistinct(router, {
        pathname: '/Kind1Thread',
        params: {
          nevent: neventEncode({
            id: source.id,
            relays: source.relay ? [source.relay] : [],
          }),
        },
      });
      return;
    }

    try {
      const decoded = decode(source.path?.replace(/^naddr:/, '') || '');
      const address = decoded.data as AddressPointer;
      if (decoded.type !== 'naddr' || address.kind !== 30023) return;
      pushDistinct(router, {
        pathname: '/Kind30023Thread',
        params: {
          naddr: naddrEncode({
            kind: address.kind,
            pubkey: address.pubkey,
            identifier: address.identifier,
            relays: address.relays,
          }),
        },
      });
    } catch {
      // Invalid Nostr source tags are intentionally inert.
    }
  }

  return (
    <View accessibilityLabel="Nostr highlight" className="pt-2">
      <View className="relative rounded-lg bg-base-200/70 px-3 py-3 pr-9">
        <View className="absolute right-3 top-3">
          <Quote size={19} color={theme.colors.primary} />
        </View>
        {content ? (
          <Text className="text-[16px] leading-7 text-base-content">
            {content}
          </Text>
        ) : (
          <Text className="text-sm italic text-base-content/55">
            A highlight from non-text media.
          </Text>
        )}
      </View>

      {context ? (
        <Text
          className="mt-2 text-xs leading-5 text-base-content/55"
          numberOfLines={2}
        >
          {context}
        </Text>
      ) : null}
      {comment ? (
        <Text className="mt-3 text-sm text-base-content/75">{comment}</Text>
      ) : null}

      {source ? (
        <View className="mt-3 items-end border-t border-base-200 pt-2">
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${source.label}`}
            className="min-w-0 flex-row items-center gap-1"
            hitSlop={8}
            onPress={pressEvent => {
              pressEvent.stopPropagation();
              openSource();
            }}
          >
            <Text
              className="max-w-64 text-xs font-semibold text-primary"
              numberOfLines={1}
            >
              {source.label}
            </Text>
            <ExternalLink size={14} color={theme.colors.primary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export const Kind9802Content = memo(
  Kind9802ContentComponent,
  (previous, next) => previous.note.id() === next.note.id(),
);
