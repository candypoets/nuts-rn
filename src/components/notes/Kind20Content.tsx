import React, {memo, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {Image} from 'expo-image';
import type {Kind20Parsed, ParsedEvent} from '@candypoets/nipworker';
import {asKind20, fbArray} from '@candypoets/nipworker/utils';

type Kind20ContentProps = {
  note: ParsedEvent;
};

function parseAspectRatio(dim: string | null | undefined) {
  if (!dim) return null;
  const match = dim.match(/(\d+)x(\d+)/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height || Number.isNaN(width) || Number.isNaN(height)) {
    return null;
  }
  return Math.max(0.5, Math.min(2, width / height));
}

function Kind20ContentComponent({note}: Kind20ContentProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const kind20 = useMemo(() => asKind20(note) as Kind20Parsed | null, [note]);
  const images = useMemo(
    () =>
      kind20
        ? fbArray(kind20, 'images').map(image => ({
            src: image.url() || '',
            type: 'image' as const,
            blurhash: image.blurhash() || undefined,
            dimensions: image.dim() || undefined,
          }))
        : [],
    [kind20],
  );
  const title = kind20?.title?.() || '';
  const description = kind20?.description?.() || '';
  const hashtags = kind20 ? fbArray(kind20, 'hashtags') : [];
  const aspectRatio = parseAspectRatio(images[0]?.dimensions) || 4 / 3;
  const mediaWidth = Math.max(1, containerWidth);
  const mediaHeight = mediaWidth / aspectRatio;

  return (
    <View
      className="gap-2"
      onLayout={event => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth > 0) setContainerWidth(nextWidth);
      }}
    >
      {images.length === 1 ? (
        <View className="w-full overflow-hidden bg-base-200" style={{aspectRatio}}>
          <Image
            source={{uri: images[0].src}}
            placeholder={images[0].blurhash}
            contentFit="contain"
            cachePolicy="memory-disk"
            style={{height: '100%', width: '100%'}}
          />
        </View>
      ) : images.length > 1 && containerWidth > 0 ? (
        <View className="w-full overflow-hidden bg-base-200" style={{height: mediaHeight}}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => {
              const nextIndex = Math.round(
                event.nativeEvent.contentOffset.x / mediaWidth,
              );
              setActiveIndex(Math.max(0, Math.min(images.length - 1, nextIndex)));
            }}
          >
            {images.map((image, index) => (
              <View
                key={`${image.src}-${index}`}
                className="items-center justify-center bg-base-200"
                style={{height: mediaHeight, width: mediaWidth}}
              >
                <Image
                  source={{uri: image.src}}
                  placeholder={image.blurhash}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  style={{height: '100%', width: '100%'}}
                />
              </View>
            ))}
          </ScrollView>
          <View className="absolute bottom-2 left-0 right-0 flex-row justify-center gap-1">
            {images.map((image, index) => (
              <View
                key={`${image.src}-dot-${index}`}
                className={[
                  'h-1.5 w-1.5 rounded-full',
                  index === activeIndex ? 'bg-base-content' : 'bg-base-content/30',
                ].join(' ')}
              />
            ))}
          </View>
        </View>
      ) : null}
      {title ? (
        <Text className="px-1 text-lg font-semibold text-base-content">{title}</Text>
      ) : null}
      {description ? (
        <Text className="px-1 text-sm leading-5 text-base-content">
          {description}
        </Text>
      ) : null}
      {hashtags.length ? (
        <View className="flex-row flex-wrap gap-1 px-1">
          {hashtags.map((tag, index) => (
            <Text key={`${String(tag)}-${index}`} className="text-sm text-primary">
              #{String(tag)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const Kind20Content = memo(Kind20ContentComponent);
