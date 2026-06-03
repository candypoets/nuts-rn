import React, { memo, useRef } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type { ContentBlock, ParsedEvent } from '@candypoets/nipworker';
import { ContentData } from '@candypoets/nipworker';
import {
  asHashtagData,
  asImageData,
  asLinkPreview,
  asMediaGroupData,
  asNostrData,
  asVideoData,
  fbArray,
} from '@candypoets/nipworker/utils';
import { ImageGrid } from './ImageGrid';
import { movedTooFar } from './press';
import { User } from './User';
import type {RootStackParamList} from '../../navigation/types';

type ContentBlocksProps = {
  content: ContentBlock[];
  shortContent?: ContentBlock[];
  note?: ParsedEvent;
  context?: ParsedEvent[];
  depth?: number;
  showQuote?: boolean;
  showMedia?: boolean;
  renderQuote?: (quote: {
    id: string;
    author?: string;
    relays: string[];
    depth: number;
    key: string;
  }) => React.ReactNode;
};

function normalizeText(text: string) {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text.replace(/\\/g, '');
  }
}

function InlineLink({ text, url }: { text: string; url: string }) {
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <Text
      className="text-emerald-700"
      onPress={event => {
        event.stopPropagation();
      }}
      onPressIn={event => {
        pressStartRef.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        };
      }}
      onPressOut={event => {
        const end = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        };
        if (!movedTooFar(pressStartRef.current, end)) {
          Linking.openURL(url).catch(() => {});
        }
        pressStartRef.current = null;
      }}
    >
      {text}
    </Text>
  );
}

function truncateMiddle(value: string, maxLength = 54) {
  if (value.length <= maxLength) return value;
  const edgeLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, edgeLength)}...${value.slice(-edgeLength)}`;
}

function isUserEntity(entity?: string | null) {
  return !!entity?.match(/n(profile|pub)/);
}

function isInlineContentBlock(block: ContentBlock) {
  if (block.type() === 'text') return true;

  const dataType = block.dataType();
  if (
    dataType === ContentData.LinkPreviewData ||
    dataType === ContentData.HashtagData
  ) {
    return true;
  }

  if (dataType === ContentData.NostrData) {
    const nostr = asNostrData(block);
    return !!(nostr?.author?.() && isUserEntity(nostr?.entity?.()));
  }

  return false;
}

function ContentBlocksComponent({
  content,
  shortContent,
  note,
  depth = 0,
  showQuote = true,
  showMedia = true,
  renderQuote,
}: ContentBlocksProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const displayContent = shortContent?.length ? shortContent : content;

  if (!displayContent.length) {
    return <Text className="text-sm text-slate-500">No text content.</Text>;
  }

  const renderInlineBlock = (
    block: ContentBlock,
    index: number,
    blockKey: string,
    trimTrailingWhitespace = false,
  ) => {
    if (block.type() === 'text') {
      const text = normalizeText(block.text() || '');
      const displayText = trimTrailingWhitespace ? text.trimEnd() : text;
      if (!displayText) return null;
      return (
        <Text key={blockKey}>
          {index === 0
            ? displayText.trimStart()
            : index === displayContent.length - 1
            ? displayText.trimEnd()
            : displayText}
        </Text>
      );
    }

    if (block.dataType() === ContentData.LinkPreviewData) {
      const preview = asLinkPreview(block);
      const url = preview?.url?.() || block.text() || '';
      return <InlineLink key={blockKey} text={block.text() || url} url={url} />;
    }

    if (block.dataType() === ContentData.HashtagData) {
      const hashtag = asHashtagData(block);
      const tag = hashtag?.tag?.() || block.text()?.replace(/^#/, '') || '';
      return (
        <Text
          key={blockKey}
          className="text-[15px] font-semibold text-emerald-700"
          onPress={event => {
            event.stopPropagation();
            if (tag) navigation.navigate('Tags', {tags: [tag]});
          }}
        >
          {block.text() || `#${tag}`}
        </Text>
      );
    }

    const nostr = asNostrData(block);
    const author = nostr?.author?.() || undefined;
    if (author && isUserEntity(nostr?.entity?.())) {
      return (
        <User
          key={blockKey}
          pubkey={author}
          link
          className="text-[15px] font-semibold text-emerald-700"
        />
      );
    }

    return null;
  };

  const renderedBlocks: React.ReactNode[] = [];
  let index = 0;

  while (index < displayContent.length) {
    const block = displayContent[index];
    const blockKey = `${block.type() || 'block'}-${index}-${
      block.text() || ''
    }`;

    if (isInlineContentBlock(block)) {
      const inlineBlocks: ContentBlock[] = [];
      const inlineStartIndex = index;
      while (
        index < displayContent.length &&
        isInlineContentBlock(displayContent[index])
      ) {
        inlineBlocks.push(displayContent[index]);
        index += 1;
      }

      const nextBlock = displayContent[index];
      const trimEnd = !nextBlock || !isInlineContentBlock(nextBlock);
      const inlineChildren: React.ReactNode[] = [];
      inlineBlocks.forEach((inlineBlock, inlineBlockIndex) => {
        const displayIndex = inlineStartIndex + inlineBlockIndex;
        const inlineKey = `${inlineBlock.type() || 'block'}-${displayIndex}-${
          inlineBlock.text() || ''
        }`;
        inlineChildren.push(
          renderInlineBlock(
            inlineBlock,
            displayIndex,
            inlineKey,
            trimEnd && inlineBlockIndex === inlineBlocks.length - 1,
          ),
        );
      });

      if (inlineChildren.some(Boolean)) {
        renderedBlocks.push(
          <Text
            key={`inline-${blockKey}`}
            className="text-[15px] leading-5 text-slate-900"
          >
            {inlineChildren}
          </Text>,
        );
      }
      continue;
    }

    if (block.dataType() === ContentData.NostrData) {
      const nostr = asNostrData(block);
      const id = nostr?.id?.();
      const entity = nostr?.entity?.();
      const author = nostr?.author?.() || undefined;

      if (showQuote && id && depth < 3) {
        const entityRelays = nostr
          ? fbArray(nostr, 'relays').map(relay => String(relay))
          : [];
        renderedBlocks.push(
          renderQuote?.({
            id,
            author,
            relays: entityRelays,
            depth: depth + 1,
            key: blockKey,
          }),
        );
      } else {
        renderedBlocks.push(
          <Text key={blockKey} className="text-[15px] text-emerald-700">
            {entity || id || block.text()}
          </Text>,
        );
      }
      index += 1;
      continue;
    }

    if (block.dataType() === ContentData.ImageData) {
      const image = asImageData(block);
      const url = image?.url?.() || block.text() || '';
      if (!showMedia) {
        renderedBlocks.push(
          <InlineLink key={blockKey} text={truncateMiddle(url)} url={url} />,
        );
        index += 1;
        continue;
      }
      renderedBlocks.push(
        <Pressable
          key={blockKey}
          onPress={event => {
            event.stopPropagation();
          }}
        >
          <ImageGrid
            note={note}
            links={[
              {
                src: image?.url?.() || block.text() || '',
                type: 'image',
                dim: image?.dim?.(),
              },
            ]}
          />
        </Pressable>,
      );
      index += 1;
      continue;
    }

    if (block.dataType() === ContentData.VideoData) {
      const video = asVideoData(block);
      const url = video?.url?.() || block.text() || '';
      if (!showMedia) {
        renderedBlocks.push(
          <InlineLink key={blockKey} text={truncateMiddle(url)} url={url} />,
        );
        index += 1;
        continue;
      }
      renderedBlocks.push(
        <Pressable
          key={blockKey}
          onPress={event => {
            event.stopPropagation();
          }}
        >
          <ImageGrid
            note={note}
            links={[
              {
                src: video?.url?.() || block.text() || '',
                type: 'video',
                blurhash: video?.thumbnail?.() || undefined,
                dim: video?.dim?.(),
              },
            ]}
          />
        </Pressable>,
      );
      index += 1;
      continue;
    }

    if (block.dataType() === ContentData.MediaGroupData) {
      const mediaGroup = asMediaGroupData(block);
      if (!showMedia) {
        const mediaLinks = mediaGroup
          ? fbArray(mediaGroup, 'items')
              .map(item => item.image()?.url() || item.video()?.url() || '')
              .filter(Boolean)
          : [];
        renderedBlocks.push(
          <View key={blockKey} className="gap-1">
            {mediaLinks.map((url, mediaIndex) => (
              <InlineLink
                key={`${blockKey}-${mediaIndex}`}
                text={truncateMiddle(url)}
                url={url}
              />
            ))}
          </View>,
        );
        index += 1;
        continue;
      }
      renderedBlocks.push(
        <Pressable
          key={blockKey}
          onPress={event => {
            event.stopPropagation();
          }}
        >
          <ImageGrid
            note={note}
            links={
              mediaGroup
                ? fbArray(mediaGroup, 'items').map(item => {
                    const image = item.image();
                    const video = item.video();
                    return image
                      ? {
                          src: image.url() || '',
                          type: 'image',
                          dim: image.dim(),
                        }
                      : {
                          src: video?.url() || '',
                          type: 'video',
                          blurhash: video?.thumbnail() || undefined,
                          dim: video?.dim(),
                        };
                  })
                : []
            }
          />
        </Pressable>,
      );
      index += 1;
      continue;
    }

    renderedBlocks.push(
      <Text key={blockKey} className="text-sm text-slate-500">
        {block.text() || `Unsupported content block ${block.dataType()}`}
      </Text>,
    );
    index += 1;
  }

  return <View className="gap-2">{renderedBlocks}</View>;
}

export const ContentBlocks = memo(
  ContentBlocksComponent,
  (previous, next) =>
    previous.content === next.content &&
    previous.shortContent === next.shortContent &&
    previous.note?.id() === next.note?.id() &&
    (previous.depth ?? 0) === (next.depth ?? 0) &&
    (previous.showQuote ?? true) === (next.showQuote ?? true) &&
    (previous.showMedia ?? true) === (next.showMedia ?? true) &&
    previous.renderQuote === next.renderQuote,
);
