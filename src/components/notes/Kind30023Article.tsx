import React, {memo, useMemo} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
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

import {LightningInvoiceCard} from '../LightningInvoiceCard';
import {Avatar} from './Avatar';
import {Footer} from './Footer';
import {User} from './User';
import {eventTags, formatTimestamp, stringValue, tagValue, tagValues} from './kindHelpers';
import {
  normalizeLightningInvoice,
  splitLightningInvoices,
} from '../../lib/lightningInvoice';
import {pushDistinct} from '../../navigation/pushDistinct';
import type {AppNavigationProp} from '../../navigation/types';

type Kind30023ArticleProps = {
  note: ParsedEvent;
  relays: string[];
  visible: boolean;
};

const styles = StyleSheet.create({
  articleImage: {width: '100%', aspectRatio: 16 / 9},
});

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

function inlineIdentity(inline: ArticleInline) {
  return [
    inline.type(),
    stringValue(inline.text()),
    stringValue(inline.url()),
    stringValue(inline.tag()),
    stringValue(inline.entity()?.entity()),
  ].join(':');
}

function blockIdentity(block: ArticleBlock) {
  return [
    block.type(),
    block.depth(),
    stringValue(block.text()),
    stringValue(block.url()),
  ].join(':');
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

function ArticleInlineImage({inline}: {inline: ArticleInline}) {
  const url = stringValue(inline.url());
  if (!url) return null;

  const description = stringValue(inline.text()) || 'Article image';

  return (
    <Pressable
      accessibilityLabel={description}
      accessibilityRole="imagebutton"
      className="overflow-hidden rounded-lg bg-base-200"
      onPress={() => Linking.openURL(url).catch(() => {})}>
      <Image
        accessibilityLabel={description}
        source={{uri: url}}
        contentFit="contain"
        cachePolicy="memory-disk"
        style={styles.articleImage}
      />
    </Pressable>
  );
}

function InlineContent({
  inlines,
  navigation,
  textClassName,
}: {
  inlines: ArticleInline[];
  navigation: AppNavigationProp;
  textClassName: string;
}) {
  const segments: Array<
    | {type: 'text'; key: string; inlines: ArticleInline[]}
    | {type: 'plainText'; key: string; text: string}
    | {type: 'image'; key: string; inline: ArticleInline}
    | {type: 'invoice'; key: string; invoice: string}
  > = [];
  const keyCounts = new Map<string, number>();
  let textInlines: ArticleInline[] = [];

  const uniqueKey = (value: string) => {
    const count = keyCounts.get(value) ?? 0;
    keyCounts.set(value, count + 1);
    return `${value}:${count}`;
  };

  const flushText = () => {
    if (!textInlines.length) return;
    const nextInlines = textInlines;
    textInlines = [];
    segments.push({
      type: 'text',
      key: uniqueKey(`text:${nextInlines.map(inlineIdentity).join('|')}`),
      inlines: nextInlines,
    });
  };

  inlines.forEach(inline => {
    if (inline.type() === ArticleInlineType.Image) {
      flushText();
      segments.push({
        type: 'image',
        key: uniqueKey(`image:${inlineIdentity(inline)}`),
        inline,
      });
      return;
    }

    if (inline.type() === ArticleInlineType.Link) {
      const invoice =
        normalizeLightningInvoice(stringValue(inline.url())) ||
        normalizeLightningInvoice(stringValue(inline.text()));
      if (invoice) {
        flushText();
        segments.push({
          type: 'invoice',
          key: uniqueKey(`invoice:${invoice.slice(0, 32)}`),
          invoice,
        });
        return;
      }
    }

    if (inline.type() === ArticleInlineType.Text) {
      const parts = splitLightningInvoices(stringValue(inline.text()));
      if (parts.some(part => part.type === 'invoice')) {
        flushText();
        parts.forEach(part => {
          if (part.type === 'invoice') {
            segments.push({
              type: 'invoice',
              key: uniqueKey(`invoice:${part.invoice.slice(0, 32)}`),
              invoice: part.invoice,
            });
            return;
          }

          const text = part.text.trim();
          if (text) {
            segments.push({
              type: 'plainText',
              key: uniqueKey(`plain:${text.slice(0, 32)}`),
              text,
            });
          }
        });
        return;
      }
    }

    textInlines.push(inline);
  });

  flushText();

  return (
    <View className="gap-3">
      {segments.map(segment =>
        segment.type === 'image' ? (
          <ArticleInlineImage
            key={segment.key}
            inline={segment.inline}
          />
        ) : segment.type === 'invoice' ? (
          <LightningInvoiceCard key={segment.key} invoice={segment.invoice} />
        ) : segment.type === 'plainText' ? (
          <Text key={segment.key} className={textClassName}>
            {segment.text}
          </Text>
        ) : (
          <Text key={segment.key} className={textClassName}>
            <InlineNodes inlines={segment.inlines} navigation={navigation} />
          </Text>
        ),
      )}
    </View>
  );
}

function ArticleBlocks({
  blocks,
  navigation,
}: {
  blocks: ArticleBlock[];
  navigation: AppNavigationProp;
}) {
  const keyCounts = new Map<string, number>();

  return (
    <View className="gap-3">
      {blocks.map(block => {
        const identity = blockIdentity(block);
        const count = keyCounts.get(identity) ?? 0;
        keyCounts.set(identity, count + 1);
        const key = `${identity}:${count}`;
        const inlines = blockInlines(block);
        const children = blockChildren(block);

        switch (block.type()) {
          case ArticleBlockType.Heading:
            return (
              <InlineContent
                key={key}
                inlines={inlines}
                navigation={navigation}
                textClassName={[
                  'font-bold text-base-content',
                  block.depth() <= 1
                    ? 'text-2xl leading-8'
                    : block.depth() === 2
                      ? 'text-xl leading-7'
                      : 'text-lg leading-6',
                ].join(' ')}
              />
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
                    <InlineContent
                      inlines={inlines}
                      navigation={navigation}
                      textClassName="text-base leading-6 text-base-content"
                    />
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
                  style={styles.articleImage}
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
              <InlineContent
                key={key}
                inlines={inlines}
                navigation={navigation}
                textClassName="text-base leading-6 text-base-content"
              />
            );
        }
      })}
    </View>
  );
}

function Kind30023ArticleComponent({
  note,
  relays,
  visible,
}: Kind30023ArticleProps) {
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
            style={styles.articleImage}
          />
        </View>
      ) : null}

      <View className="border-y border-base-200 px-3 py-3">
        <Footer note={note} visible={visible} main relays={relays} />
      </View>

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
