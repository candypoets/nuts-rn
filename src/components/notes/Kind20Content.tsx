import React, {memo, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {Image} from 'expo-image';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type {ParsedEvent} from '@candypoets/nipworker';
import {asKind20, asKind22, fbArray} from '@candypoets/nipworker/utils';
import {
  ImageGrid,
  MediaShimmerPlaceholder,
  type ImageGridLink,
} from './ImageGrid';
import {useUIStore} from '../../stores/uiStore';

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

function InlineZoomImage({
  image,
  onZoomChange,
}: {
  image: ImageGridLink;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const zoomedState = useSharedValue(false);

  const setZoomed = (zoomed: boolean) => {
    'worklet';
    if (zoomedState.value === zoomed) return;
    zoomedState.value = zoomed;
    if (onZoomChange) runOnJS(onZoomChange)(zoomed);
  };

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
      setZoomed(scale.value > 1.02);
    })
    .onEnd(() => {
      scale.value = withSpring(1);
      savedScale.value = 1;
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      savedX.value = 0;
      savedY.value = 0;
      setZoomed(false);
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      if (scale.value <= 1.02) {
        state.fail();
        return;
      }
      state.activate();
    })
    .onUpdate(event => {
      if (scale.value <= 1.02) return;
      translateX.value = savedX.value + event.translationX;
      translateY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const imageStyle = useAnimatedStyle(() => ({
    elevation: scale.value > 1.02 ? 32 : 0,
    transform: [
      {translateX: translateX.value},
      {translateY: translateY.value},
      {scale: scale.value},
    ],
    zIndex: scale.value > 1.02 ? 100 : 0,
  }));

  useEffect(() => {
    setLoading(true);
  }, [image.src]);

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <Animated.View style={[styles.fill, imageStyle]}>
        {loading ? (
          <MediaShimmerPlaceholder />
        ) : null}
        <Image
          source={{uri: image.src}}
          placeholder={image.blurhash}
          contentFit="contain"
          cachePolicy="memory-disk"
          style={styles.fill}
          onLoadEnd={() => setLoading(false)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
  mediaFrame: {
    zIndex: 0,
  },
  zoomedFrame: {
    zIndex: 20,
  },
});

function Kind20ContentComponent({note}: Kind20ContentProps) {
  const viewportWidth = useUIStore(state => state.dimensions.width);
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);
  const kind20 = useMemo(() => asKind20(note), [note]);
  const kind22 = useMemo(() => asKind22(note), [note]);
  const media = useMemo<ImageGridLink[]>(
    () => {
      if (kind20) {
        return fbArray(kind20, 'images').map(image => ({
            src: image.url() || '',
            type: 'image' as const,
            blurhash: image.blurhash() || undefined,
            dim: image.dim() || undefined,
          }));
      }

      if (kind22) {
        return fbArray(kind22, 'videos').map(video => ({
          src: video.url() || '',
          type: 'video' as const,
          blurhash: video.image() || undefined,
          dim: video.dim() || undefined,
        }));
      }

      return [];
    },
    [kind20, kind22],
  );
  const title = kind20?.title?.() || kind22?.title?.() || '';
  const description = kind20?.description?.() || kind22?.description?.() || '';
  const hashtags = kind20
    ? fbArray(kind20, 'hashtags')
    : kind22
    ? fbArray(kind22, 'hashtags')
    : [];
  const aspectRatio = parseAspectRatio(media[0]?.dim) || 4 / 3;
  const mediaWidth = Math.max(160, viewportWidth);
  const mediaHeight = mediaWidth / aspectRatio;
  const isVideo = media.some(item => item.type === 'video');

  return (
    <View className="gap-2">
      {isVideo ? (
        <ImageGrid
          note={note}
          links={media}
          containerWidth={mediaWidth}
          className="w-full overflow-hidden bg-base-200"
        />
      ) : media.length === 1 ? (
        <View
          className="w-full bg-base-200"
          style={[
            styles.mediaFrame,
            {height: mediaHeight},
            zoomedIndex === 0 ? styles.zoomedFrame : null,
          ]}
        >
          <InlineZoomImage
            image={media[0]}
            onZoomChange={zoomed => setZoomedIndex(zoomed ? 0 : null)}
          />
        </View>
      ) : media.length > 1 ? (
        <View
          className="w-full bg-base-200"
          style={[
            styles.mediaFrame,
            {height: mediaHeight},
            zoomedIndex === null ? null : styles.zoomedFrame,
          ]}
        >
          <ScrollView
            horizontal
            pagingEnabled
            scrollEnabled={zoomedIndex === null}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => {
              const nextIndex = Math.round(
                event.nativeEvent.contentOffset.x / mediaWidth,
              );
              setActiveIndex(Math.max(0, Math.min(media.length - 1, nextIndex)));
            }}
          >
            {media.map((image, index) => (
              <View
                key={`${image.src}-${index}`}
                className="items-center justify-center bg-base-200"
                style={{height: mediaHeight, width: mediaWidth}}
              >
                <InlineZoomImage
                  image={image}
                  onZoomChange={zoomed =>
                    setZoomedIndex(zoomed ? index : current =>
                      current === index ? null : current,
                    )
                  }
                />
              </View>
            ))}
          </ScrollView>
          <View className="absolute bottom-2 left-0 right-0 flex-row justify-center gap-1">
            {media.map((image, index) => (
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
