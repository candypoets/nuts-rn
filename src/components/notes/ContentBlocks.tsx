import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {Image} from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import {ExternalLink, Play} from 'lucide-react-native';
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
import {
  cachedLinkPreview,
  fetchLinkPreview,
  type OpenGraphData,
} from '../../lib/linkPreview';
import {
  NativeMediaViewer,
  isNativeMediaViewerAvailable,
} from '../native/NativeMediaViewer';
import {
  NativeLinkPreview,
  isNativeLinkPreviewAvailable,
} from '../native/NativeLinkPreview';

type ContentBlocksProps = {
  content: ContentBlock[];
  shortContent?: ContentBlock[];
  note?: ParsedEvent;
  context?: ParsedEvent[];
  relays?: string[];
  depth?: number;
  showQuote?: boolean;
  showMedia?: boolean;
  visible?: boolean;
  forceFullContent?: boolean;
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
  const openUrl = normalizeLinkUrl(url);

  return (
    <Text
      className="font-medium text-primary"
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
          openLink(openUrl);
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

function normalizeLinkUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function openLink(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {
    Linking.openURL(url).catch(() => {});
  });
}

function getUrlParts(url: string) {
  try {
    const parsed = new URL(normalizeLinkUrl(url));
    const hostname = parsed.hostname.replace(/^www\./, '');
    return {
      hostname,
      label: hostname || url,
      path: `${parsed.pathname}${parsed.search}`.replace(/\/$/, ''),
    };
  } catch {
    return {
      hostname: '',
      label:
        url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ||
        url,
      path: '',
    };
  }
}

function getYoutubeVideoId(url: string) {
  try {
    const parsed = new URL(normalizeLinkUrl(url));
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com'
    ) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');

      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function LinkPreviewCard({url, text}: {url: string; text: string}) {
  const parts = useMemo(() => getUrlParts(url), [url]);
  const youtubeVideoId = useMemo(() => getYoutubeVideoId(url), [url]);
  const openUrl = useMemo(() => normalizeLinkUrl(url), [url]);
  const [metadata, setMetadata] = useState<OpenGraphData | null | undefined>(
    () => cachedLinkPreview(url),
  );
  const [thumbnailFallback, setThumbnailFallback] = useState(0);
  const thumbnailUrl =
    youtubeVideoId && thumbnailFallback < YOUTUBE_THUMBNAILS.length
      ? `https://i.ytimg.com/vi/${youtubeVideoId}/${YOUTUBE_THUMBNAILS[thumbnailFallback]}`
      : metadata?.image || null;
  const displayText = text && text !== url ? text : parts.path || url;

  useEffect(() => {
    const cached = cachedLinkPreview(url);
    if (cached !== undefined) {
      setMetadata(cached);
      return;
    }

    let active = true;
    setMetadata(undefined);
    fetchLinkPreview(url)
      .then(result => {
        if (active) setMetadata(result);
      })
      .catch(() => {
        if (active) setMetadata(null);
      });

    return () => {
      active = false;
    };
  }, [url]);

  return (
    <Pressable
      className="overflow-hidden rounded-lg border border-base-200 bg-base-300"
      onPress={event => {
        event.stopPropagation();
        openLink(openUrl);
      }}
    >
      {thumbnailUrl ? (
        <View className="relative aspect-video w-full bg-base-200">
          <Image
            source={{uri: thumbnailUrl}}
            contentFit="cover"
            cachePolicy="memory-disk"
            style={StyleSheet.absoluteFill}
            onError={() => {
              if (youtubeVideoId) setThumbnailFallback(value => value + 1);
            }}
          />
          {youtubeVideoId ? (
            <View className="absolute inset-0 items-center justify-center">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-black/70">
                <Play size={22} color="white" fill="white" />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <View className="gap-1 px-3 py-2.5">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="flex-1 text-xs font-medium uppercase text-base-content/60"
            numberOfLines={1}
          >
            {metadata?.siteName || (youtubeVideoId ? 'YouTube' : parts.label)}
          </Text>
          <ExternalLink size={13} color="rgba(120,120,120,0.9)" />
        </View>
        <Text
          className="text-[15px] font-medium leading-5 text-base-content"
          numberOfLines={2}
        >
          {metadata?.title || displayText.replace(/^https?:\/\/(www\.)?/, '')}
        </Text>
        {metadata?.description ? (
          <Text className="text-xs text-base-content/60" numberOfLines={2}>
            {metadata.description}
          </Text>
        ) : !youtubeVideoId ? (
          <Text className="text-xs text-base-content/60" numberOfLines={1}>
            {truncateMiddle(url, 72)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const YOUTUBE_THUMBNAILS = [
  'maxresdefault.jpg',
  'hqdefault.jpg',
  'mqdefault.jpg',
  'default.jpg',
];

function isUserEntity(entity?: string | null) {
  return !!entity?.match(/n(profile|pub)/);
}

function isInlineContentBlock(block: ContentBlock, showMedia: boolean) {
  if (block.type() === 'text') return true;

  const dataType = block.dataType();
  if (
    (!showMedia && dataType === ContentData.LinkPreviewData) ||
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

function isLastTextBlock(index: number, blocks: ContentBlock[]) {
  return !blocks.slice(index + 1).some(block => block.type() === 'text');
}

function ContentBlocksComponent({
  content,
  shortContent,
  note,
  depth = 0,
  showQuote = true,
  showMedia = true,
  visible = true,
  forceFullContent = false,
  renderQuote,
  relays,
}: ContentBlocksProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [showFull, setShowFull] = useState(false);
  const hasShortContent = !!shortContent?.length;
  const canToggleFullContent = hasShortContent && !forceFullContent;
  const displayContent = canToggleFullContent && !showFull ? shortContent : content;

  if (!displayContent.length) {
    return <Text className="text-sm text-primary-content">No text content.</Text>;
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
          {canToggleFullContent && isLastTextBlock(index, displayContent) ? (
            <Text
            className="font-medium text-primary"
              onPress={event => {
                event.stopPropagation();
                setShowFull(value => !value);
              }}
            >
              {` ${showFull ? 'See less' : 'See more'}`}
            </Text>
          ) : null}
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
          className="text-[15px] font-medium text-primary"
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
          className="text-[15px] font-medium text-primary"
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

    if (isInlineContentBlock(block, showMedia)) {
      const inlineBlocks: ContentBlock[] = [];
      const inlineStartIndex = index;
      while (
        index < displayContent.length &&
        isInlineContentBlock(displayContent[index], showMedia)
      ) {
        inlineBlocks.push(displayContent[index]);
        index += 1;
      }

      const nextBlock = displayContent[index];
      const trimEnd = !nextBlock || !isInlineContentBlock(nextBlock, showMedia);
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
            className="text-[15px] font-normal leading-5 text-base-content"
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
      } else if (isUserEntity(entity)) {
        renderedBlocks.push(
          <Text key={blockKey} className="text-[15px] font-medium text-primary">
            {entity || id || block.text()}
          </Text>,
        );
      } else {
        renderedBlocks.push(
          <Text key={blockKey} className="text-[15px] font-normal text-base-content">
            {block.text() || entity || id || ''}
          </Text>,
        );
      }
      index += 1;
      continue;
    }

    if (block.dataType() === ContentData.LinkPreviewData) {
      const preview = asLinkPreview(block);
      const url = preview?.url?.() || block.text() || '';
      if (!url) {
        index += 1;
        continue;
      }
      renderedBlocks.push(
        isNativeLinkPreviewAvailable ? (
          <NativeLinkPreview key={blockKey} text={block.text() || url} url={url} />
        ) : (
          <LinkPreviewCard key={blockKey} text={block.text() || url} url={url} />
        ),
      );
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
        <React.Fragment key={blockKey}>
          {isNativeMediaViewerAvailable ? (
            <NativeMediaViewer
              note={note}
              relays={relays}
              visible={visible}
              links={[
                {
                  src: image?.url?.() || block.text() || '',
                  type: 'image',
                  dim: image?.dim?.(),
                },
              ]}
            />
          ) : (
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
          )}
        </React.Fragment>,
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
        <React.Fragment key={blockKey}>
          {isNativeMediaViewerAvailable ? (
            <NativeMediaViewer
              note={note}
              relays={relays}
              visible={visible}
              links={[
                {
                  src: video?.url?.() || block.text() || '',
                  type: 'video',
                  blurhash: video?.thumbnail?.() || undefined,
                  dim: video?.dim?.(),
                },
              ]}
            />
          ) : (
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
          )}
        </React.Fragment>,
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
        <React.Fragment key={blockKey}>
          {isNativeMediaViewerAvailable ? (
            <NativeMediaViewer
              note={note}
              relays={relays}
              visible={visible}
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
          ) : (
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
          )}
        </React.Fragment>,
      );
      index += 1;
      continue;
    }

    renderedBlocks.push(
      <Text key={blockKey} className="text-sm text-primary-content">
        {block.text() || `Unsupported content block ${block.dataType()}`}
      </Text>,
    );
    index += 1;
  }

  if (canToggleFullContent && !showFull) {
    return (
      <Pressable
        className="gap-2"
        onPress={event => {
          event.stopPropagation();
          setShowFull(true);
        }}
      >
        {renderedBlocks}
      </Pressable>
    );
  }

  return <View className="gap-2">{renderedBlocks}</View>;
}

export const ContentBlocks = memo(
  ContentBlocksComponent,
  (previous, next) =>
    previous.content === next.content &&
    previous.shortContent === next.shortContent &&
    previous.note?.id() === next.note?.id() &&
    previous.relays === next.relays &&
    (previous.depth ?? 0) === (next.depth ?? 0) &&
    (previous.showQuote ?? true) === (next.showQuote ?? true) &&
    (previous.showMedia ?? true) === (next.showMedia ?? true) &&
    (previous.visible ?? true) === (next.visible ?? true) &&
    (previous.forceFullContent ?? false) === (next.forceFullContent ?? false) &&
    previous.renderQuote === next.renderQuote,
);
