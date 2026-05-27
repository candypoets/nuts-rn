import React, {useRef} from 'react';
import {Linking, Text, View} from 'react-native';
import type {ContentBlock, ParsedEvent} from '@candypoets/nipworker';
import {ContentData} from '@candypoets/nipworker';
import {
  asHashtagData,
  asImageData,
  asLinkPreview,
  asMediaGroupData,
  asNostrData,
  asVideoData,
  fbArray,
} from '@candypoets/nipworker/utils';
import {ImageGrid} from './ImageGrid';
import {movedTooFar} from './press';

type ContentBlocksProps = {
  content: ContentBlock[];
  shortContent?: ContentBlock[];
  note?: ParsedEvent;
  context?: ParsedEvent[];
  visible?: boolean;
  depth?: number;
  showQuote?: boolean;
  renderQuote?: (quote: {
    id: string;
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

function InlineLink({text, url}: {text: string; url: string}) {
  const pressStartRef = useRef<{x: number; y: number} | null>(null);

  return (
    <Text
      className="text-emerald-700"
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

export function ContentBlocks({
  content,
  shortContent,
  depth = 0,
  showQuote = true,
  renderQuote,
}: ContentBlocksProps) {
  const displayContent = shortContent?.length ? shortContent : content;

  if (!displayContent.length) {
    return <Text className="text-sm text-slate-500">No text content.</Text>;
  }

  return (
    <View className="gap-2">
      {displayContent.map((block, index) => {
        const blockKey = `${block.type() || 'block'}-${index}-${block.text() || ''}`;

        if (block.type() === 'text') {
          const text = normalizeText(block.text() || '');
          return (
            <Text key={blockKey} className="text-[15px] leading-5 text-slate-900">
              {index === 0
                ? text.trimStart()
                : index === displayContent.length - 1
                  ? text.trimEnd()
                  : text}
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
          return (
            <Text key={blockKey} className="text-[15px] font-semibold text-emerald-700">
              #{hashtag?.tag?.() || block.text() || ''}
            </Text>
          );
        }

        if (block.dataType() === ContentData.NostrData) {
          const nostr = asNostrData(block);
          const id = nostr?.id?.();
          const entity = nostr?.entity?.();
          if (showQuote && id && depth < 3) {
            const entityRelays = nostr
              ? fbArray(nostr, 'relays').map(relay => String(relay))
              : [];
            return renderQuote?.({
              id,
              relays: entityRelays,
              depth: depth + 1,
              key: blockKey,
            });
          }

          return (
            <Text key={blockKey} className="text-[15px] text-emerald-700">
              {entity || id || block.text()}
            </Text>
          );
        }

        if (
          block.dataType() === ContentData.ImageData
        ) {
          const image = asImageData(block);
          return (
            <ImageGrid
              key={blockKey}
              links={[{
                src: image?.url?.() || block.text() || '',
                type: 'image',
                dim: image?.dim?.(),
              }]}
            />
          );
        }

        if (
          block.dataType() === ContentData.VideoData
        ) {
          const video = asVideoData(block);
          return (
            <ImageGrid
              key={blockKey}
              links={[{
                src: video?.url?.() || block.text() || '',
                type: 'video',
                blurhash: video?.thumbnail?.() || undefined,
                dim: video?.dim?.(),
              }]}
            />
          );
        }

        if (block.dataType() === ContentData.MediaGroupData) {
          const mediaGroup = asMediaGroupData(block);
          return (
            <ImageGrid
              key={blockKey}
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
          );
        }

        return (
          <Text key={blockKey} className="text-sm text-slate-500">
            {block.text() || `Unsupported content block ${block.dataType()}`}
          </Text>
        );
      })}
    </View>
  );
}
