import React, {memo, useMemo} from 'react';
import {Linking, Pressable, Text, View} from 'react-native';
import {Image} from 'expo-image';
import {router} from 'expo-router';
import {useNavigation} from 'expo-router/react-navigation';
import {
  decode,
  naddrEncode,
  neventEncode,
  type AddressPointer,
  type EventPointer,
  type ProfilePointer,
} from 'nostr-tools/nip19';
import type {ParsedEvent} from '@candypoets/nipworker';
import {
  ArticleBlock,
  ArticleBlockType,
  ArticleInline,
  ArticleInlineType,
  Kind30023Parsed,
} from '@candypoets/nipworker';

import {Avatar} from './Avatar';
import {User} from './User';
import {eventTags, formatTimestamp, stringValue, tagValue, tagValues} from './kindHelpers';
import {pushDistinct} from '../../navigation/pushDistinct';
import type {AppNavigationProp} from '../../navigation/types';

type Kind30023ArticleProps = {
  note: ParsedEvent;
};

function getKind30023(note: ParsedEvent) {
  try {
    return note.parsed(new Kind30023Parsed()) as Kind30023Parsed | null;
  } catch {
    return null;
  }
}

function blockChildren(block: ArticleBlock) {
  return Array.from({length: block.childrenLength()}, (_, index) =>
    block.children(index),
  ).filter((child): child is ArticleBlock => !!child);
}

function blockInlines(block: ArticleBlock) {
  return Array.from({length: block.inlinesLength()}, (_, index) =>
    block.inlines(index),
  ).filter((inline): inline is ArticleInline => !!inline);
}

function inlineChildren(inline: ArticleInline) {
  return Array.from({length: inline.childrenLength()}, (_, index) =>
    inline.children(index),
  ).filter((child): child is ArticleInline => !!child);
}

function openNostrEntity(entity: string) {
  if (!entity) return;

  const bech32 = entity.replace(/^nostr:/i, '');
  try {
    const decoded = decode(bech32);
    switch (decoded.type) {
      case 'npub':
        pushDistinct(router, {
          pathname: '/PublicProfile',
          params: {pubkey: decoded.data},
        });
        return;
      case 'nprofile': {
        const profile = decoded.data as ProfilePointer;
        if (profile.pubkey) {
          pushDistinct(router, {
            pathname: '/PublicProfile',
            params: {pubkey: profile.pubkey},
          });
        }
        return;
      }
      case 'note':
        pushDistinct(router, {
          pathname: '/Kind1Thread',
          params: {nevent: neventEncode({id: decoded.data})},
        });
        return;
      case 'nevent': {
        const event = decoded.data as EventPointer;
        if (!event.id) return;
        pushDistinct(router, {
          pathname: '/Kind1Thread',
          params: {
            nevent: neventEncode({
              id: event.id,
              author: event.author,
              relays: event.relays,
              kind: event.kind,
            }),
          },
        });
        return;
      }
      case 'naddr': {
        const address = decoded.data as AddressPointer;
        if (address.kind === 30023) {
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
        }
        return;
      }
      default:
        return;
    }
  } catch (error) {
    console.warn('[kind30023] failed to open nostr entity', {
      entity: bech32.slice(0, 24),
      error,
    });
  }
}

function InlineNodes({
  inlines,
  navigation,
}: {
  inlines: ArticleInline[];
  navigation: AppNavigationProp;
}) {
  return (
    <>
      {inlines.map((inline, index) => {
        const key = `${inline.type()}-${index}-${stringValue(inline.text())}`;
        const children = inlineChildren(inline);
        const childNodes = children.length ? (
          <InlineNodes inlines={children} navigation={navigation} />
        ) : (
          stringValue(inline.text())
        );

        switch (inline.type()) {
          case ArticleInlineType.Emphasis:
            return (
              <Text key={key} className="italic">
                {childNodes}
              </Text>
            );
          case ArticleInlineType.Strong:
            return (
              <Text key={key} className="font-bold">
                {childNodes}
              </Text>
            );
          case ArticleInlineType.Link: {
            const url = stringValue(inline.url());
            return (
              <Text
                key={key}
                className="text-primary"
                onPress={() => {
                  if (url) Linking.openURL(url).catch(() => {});
                }}
              >
                {childNodes || url}
              </Text>
            );
          }
          case ArticleInlineType.Image: {
            const url = stringValue(inline.url());
            return (
              <Text
                key={key}
                className="text-primary"
                onPress={() => {
                  if (url) Linking.openURL(url).catch(() => {});
                }}
              >
                {stringValue(inline.text()) || url}
              </Text>
            );
          }
          case ArticleInlineType.Code:
            return (
              <Text key={key} className="font-mono text-primary-content">
                {stringValue(inline.text())}
              </Text>
            );
          case ArticleInlineType.NostrEntity: {
            const entity = inline.entity();
            const bech32 = stringValue(entity?.entity());
            return (
              <Text
                key={key}
                className="text-primary"
                onPress={() => {
                  openNostrEntity(bech32);
                }}
              >
                {stringValue(inline.text()) || bech32}
              </Text>
            );
          }
          case ArticleInlineType.Hashtag: {
            const tag = stringValue(inline.tag());
            return (
              <Text
                key={key}
                className="font-semibold text-primary"
                onPress={() => {
                  if (tag) navigation.navigate('Tags', {tags: [tag]});
                }}
              >
                {stringValue(inline.text()) || `#${tag}`}
              </Text>
            );
          }
          case ArticleInlineType.LineBreak:
            return '\n';
          case ArticleInlineType.SoftBreak:
            return ' ';
          default:
            return <Text key={key}>{stringValue(inline.text())}</Text>;
        }
      })}
    </>
  );
}

function ArticleBlocks({
  blocks,
  navigation,
}: {
  blocks: ArticleBlock[];
  navigation: AppNavigationProp;
}) {
  return (
    <View className="gap-3">
      {blocks.map((block, index) => {
        const key = `${block.type()}-${index}-${stringValue(block.text())}`;
        const inlines = blockInlines(block);
        const children = blockChildren(block);

        switch (block.type()) {
          case ArticleBlockType.Heading:
            return (
              <Text
                key={key}
                className={[
                  'font-bold text-base-content',
                  block.depth() <= 1
                    ? 'text-2xl leading-8'
                    : block.depth() === 2
                      ? 'text-xl leading-7'
                      : 'text-lg leading-6',
                ].join(' ')}
              >
                <InlineNodes inlines={inlines} navigation={navigation} />
              </Text>
            );
          case ArticleBlockType.Blockquote:
            return (
              <View key={key} className="border-l-4 border-primary/60 pl-3">
                <ArticleBlocks blocks={children} navigation={navigation} />
              </View>
            );
          case ArticleBlockType.List:
            return (
              <View key={key} className="gap-2">
                <ArticleBlocks blocks={children} navigation={navigation} />
              </View>
            );
          case ArticleBlockType.ListItem:
            return (
              <View key={key} className="flex-row gap-2">
                <Text className="text-base leading-6 text-base-content">-</Text>
                <View className="min-w-0 flex-1 gap-2">
                  {inlines.length ? (
                    <Text className="text-base leading-6 text-base-content">
                      <InlineNodes inlines={inlines} navigation={navigation} />
                    </Text>
                  ) : null}
                  {children.length ? (
                    <ArticleBlocks blocks={children} navigation={navigation} />
                  ) : null}
                </View>
              </View>
            );
          case ArticleBlockType.CodeBlock:
            return (
              <View key={key} className="rounded-lg bg-base-200 p-3">
                <Text className="font-mono text-sm leading-5 text-base-content">
                  {stringValue(block.text())}
                </Text>
              </View>
            );
          case ArticleBlockType.Image: {
            const url = stringValue(block.url());
            if (!url) return null;
            return (
              <View key={key} className="overflow-hidden rounded-lg bg-base-200">
                <Image
                  source={{uri: url}}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  style={{width: '100%', aspectRatio: 16 / 9}}
                />
              </View>
            );
          }
          case ArticleBlockType.ThematicBreak:
            return <View key={key} className="my-2 h-px bg-base-200" />;
          case ArticleBlockType.Html:
            return null;
          default:
            return (
              <Text key={key} className="text-base leading-6 text-base-content">
                <InlineNodes inlines={inlines} navigation={navigation} />
              </Text>
            );
        }
      })}
    </View>
  );
}

function Kind30023ArticleComponent({note}: Kind30023ArticleProps) {
  const navigation =
    useNavigation<AppNavigationProp>();
  const parsed = useMemo(() => getKind30023(note), [note]);
  const tags = useMemo(() => eventTags(note), [note]);
  const title = stringValue(parsed?.title()) || tagValue(tags, 'title');
  const summary = stringValue(parsed?.summary()) || tagValue(tags, 'summary');
  const image = stringValue(parsed?.image()) || tagValue(tags, 'image');
  const publishedAt =
    parsed?.publishedAt() && parsed.publishedAt() !== BigInt(0)
      ? formatTimestamp(parsed.publishedAt())
      : formatTimestamp(Number(tagValue(tags, 'published_at') || 0));
  const topics = useMemo(() => {
    if (parsed) {
      return Array.from({length: parsed.topicsLength()}, (_, index) =>
        stringValue(parsed.topics(index)),
      ).filter(Boolean);
    }
    return tagValues(tags, 't');
  }, [parsed, tags]);
  const articleBlocks = useMemo(
    () =>
      parsed
        ? Array.from({length: parsed.articleBlocksLength()}, (_, index) =>
            parsed.articleBlocks(index),
          ).filter((block): block is ArticleBlock => !!block)
        : [],
    [parsed],
  );

  return (
    <View className="bg-base-300/90 pb-8">
      <View className="p-5">
        <View className="mb-4 flex-row items-center gap-3">
          <Avatar pubkey={note.pubkey() || ''} size="md" link />
          <View className="min-w-0 flex-1">
            <User pubkey={note.pubkey() || ''} link />
            {publishedAt ? (
              <Text className="mt-0.5 text-xs text-base-content/60">
                {publishedAt}
              </Text>
            ) : null}
          </View>
        </View>

        {title ? (
          <Text className="mb-3 text-2xl font-bold leading-8 text-base-content">
            {title}
          </Text>
        ) : null}

        {summary ? (
          <Text className="mb-4 text-base leading-6 text-base-content/80">
            {summary}
          </Text>
        ) : null}

        {topics.length ? (
          <View className="flex-row flex-wrap gap-2">
            {topics.map((topic, index) => (
              <Pressable
                key={`${topic}-${index}`}
                className="rounded-full bg-base-200 px-3 py-1"
                onPress={() => navigation.navigate('Tags', {tags: [topic]})}
              >
                <Text className="text-sm text-base-content">#{topic}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {image ? (
        <View className="bg-base-200">
          <Image
            source={{uri: image}}
            contentFit="cover"
            cachePolicy="memory-disk"
            style={{width: '100%', aspectRatio: 16 / 9}}
          />
        </View>
      ) : null}

      <View className="p-5">
        {articleBlocks.length ? (
          <ArticleBlocks blocks={articleBlocks} navigation={navigation} />
        ) : (
          <Text className="text-sm text-base-content/60">
            No parsed article content.
          </Text>
        )}
      </View>
    </View>
  );
}

export const Kind30023Article = memo(Kind30023ArticleComponent);
