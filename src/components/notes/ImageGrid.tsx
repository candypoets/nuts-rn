import {VideoView} from 'expo-video';
import {Image} from 'expo-image';
import {Volume2, VolumeX} from 'lucide-react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {useSharedVideoPlayer} from '../../media/videoPlayers';
import {useUIStore} from '../../stores/uiStore';

export type ImageGridLink = {
  src: string;
  type?: 'image' | 'video';
  blurhash?: string;
  dim?: string | null;
};

type ImageGridProps = {
  links: ImageGridLink[];
  note?: ParsedEvent;
  containerWidth?: number;
  className?: string;
};

const MAX_IMAGE_HEIGHT = 384;
const IMAGE_GRID_HEIGHT = 192;
const IMAGE_GRID_GAP = 4;
const MAX_DISPLAY_LINKS = 6;

export function MediaShimmerPlaceholder() {
  const viewportWidth = useUIStore(state => state.dimensions.width);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {duration: 1200, easing: Easing.inOut(Easing.quad)}),
      -1,
      false,
    );
  }, [progress]);

  const travelDistance = Math.max(240, viewportWidth);
  const shimmerStyle = useAnimatedStyle(
    () => ({
      opacity: 0.14 + progress.value * 0.08,
      transform: [
        {translateX: progress.value * travelDistance - travelDistance * 0.35},
        {skewX: '-18deg'},
      ],
    }),
    [travelDistance],
  );

  return (
    <View pointerEvents="none" style={styles.loadingOverlay}>
      <View style={styles.shimmerBase}>
        <View style={styles.shimmerIcon} />
        <Animated.View style={[styles.shimmerBand, shimmerStyle]} />
      </View>
    </View>
  );
}

function formatRemaining(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const rounded = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function parseDim(dim: string | null | undefined) {
  if (!dim) return null;
  const [width, height] = dim.split('x').map(Number);
  if (!width || !height || Number.isNaN(width) || Number.isNaN(height)) {
    return null;
  }
  return {width, height};
}

function getImageHeight(dim: string | null | undefined, containerWidth: number) {
  const parsed = parseDim(dim);
  if (!parsed) return Math.min(containerWidth, MAX_IMAGE_HEIGHT);
  return Math.min((parsed.height * containerWidth) / parsed.width, MAX_IMAGE_HEIGHT);
}

function getGridTileLayout(total: number, index: number, width: number): ViewStyle {
  const halfWidth = (width - IMAGE_GRID_GAP) / 2;
  const halfHeight = (IMAGE_GRID_HEIGHT - IMAGE_GRID_GAP) / 2;
  const thirdWidth = (width - IMAGE_GRID_GAP * 2) / 3;
  const twoThirdsWidth = thirdWidth * 2 + IMAGE_GRID_GAP;

  if (total === 2) {
    return {
      height: IMAGE_GRID_HEIGHT,
      left: index === 0 ? 0 : halfWidth + IMAGE_GRID_GAP,
      top: 0,
      width: halfWidth,
    };
  }

  if (total === 3) {
    if (index === 0) {
      return {height: IMAGE_GRID_HEIGHT, left: 0, top: 0, width: halfWidth};
    }

    return {
      height: halfHeight,
      left: halfWidth + IMAGE_GRID_GAP,
      top: index === 1 ? 0 : halfHeight + IMAGE_GRID_GAP,
      width: halfWidth,
    };
  }

  if (total === 4) {
    return {
      height: halfHeight,
      left: index % 2 === 0 ? 0 : halfWidth + IMAGE_GRID_GAP,
      top: index < 2 ? 0 : halfHeight + IMAGE_GRID_GAP,
      width: halfWidth,
    };
  }

  if (total === 5) {
    if (index === 0) {
      return {height: IMAGE_GRID_HEIGHT, left: 0, top: 0, width: halfWidth};
    }

    const offsetIndex = index - 1;
    const smallWidth = (halfWidth - IMAGE_GRID_GAP) / 2;
    return {
      height: halfHeight,
      left:
        halfWidth +
        IMAGE_GRID_GAP +
        (offsetIndex % 2) * (smallWidth + IMAGE_GRID_GAP),
      top: offsetIndex < 2 ? 0 : halfHeight + IMAGE_GRID_GAP,
      width: smallWidth,
    };
  }

  if (total === 6) {
    return {
      height: halfHeight,
      left: (index % 3) * (thirdWidth + IMAGE_GRID_GAP),
      top: index < 3 ? 0 : halfHeight + IMAGE_GRID_GAP,
      width: thirdWidth,
    };
  }

  return {height: IMAGE_GRID_HEIGHT, left: 0, top: 0, width: twoThirdsWidth};
}

function VideoTile({
  src,
  poster,
  autoplay,
  single,
  onOpenZoom,
}: {
  src: string;
  poster?: string;
  autoplay: boolean;
  single: boolean;
  onOpenZoom: () => void;
}) {
  const zoomedVideoSrc = useUIStore(state => {
    const zoomed = state.imageZoom.zoomed;
    if (zoomed === undefined) return null;
    const link = state.imageZoom.links[zoomed];
    return link?.type === 'video' ? link.src : null;
  });
  const zoomOwnsPlayer = zoomedVideoSrc === src;
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterLoading, setPosterLoading] = useState(Boolean(poster));
  const [playRequested, setPlayRequested] = useState(autoplay);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const player = useSharedVideoPlayer(src);

  useEffect(() => {
    if (zoomOwnsPlayer) return;
    setPlayRequested(autoplay);
    player.loop = true;
    player.muted = true;
    player.volume = 0;
    player.timeUpdateEventInterval = 0.25;
    player.showNowPlayingNotification = false;
    player.staysActiveInBackground = false;
    setMuted(true);
    setDuration(player.duration || 0);
    setCurrentTime(player.currentTime || 0);
    if (autoplay) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
    }
  }, [autoplay, player, zoomOwnsPlayer]);

  useEffect(() => {
    setPosterLoading(Boolean(poster));
    setFailed(false);
  }, [poster]);

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', event => {
      setCurrentTime(event.currentTime);
      setDuration(player.duration || 0);
    });
    const sourceSub = player.addListener('sourceLoad', event => {
      setDuration(event.duration || player.duration || 0);
      setCurrentTime(player.currentTime || 0);
    });
    const mutedSub = player.addListener('mutedChange', event => {
      setMuted(event.muted);
    });

    return () => {
      timeSub.remove();
      sourceSub.remove();
      mutedSub.remove();
    };
  }, [player]);

  const remaining = Math.max(0, duration - currentTime);

  const handleVideoPress = () => {
    player.muted = false;
    player.volume = 1;
    setMuted(false);
    setPlayRequested(true);
    player.play();
    onOpenZoom();
  };

  return (
    <Pressable
      className="h-full w-full bg-slate-950"
      onPress={event => {
        event.stopPropagation();
        handleVideoPress();
      }}
    >
      {posterLoading && poster && !firstFrameRendered && !failed ? (
        <MediaShimmerPlaceholder />
      ) : null}
      {zoomOwnsPlayer ? null : (
        <VideoView
          player={player}
          nativeControls={false}
          contentFit={single ? 'contain' : 'cover'}
          allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={false}
          style={styles.video}
          onFirstFrameRender={() => setFirstFrameRendered(true)}
        />
      )}
      {poster && !firstFrameRendered && !failed ? (
        <>
          <Image
            source={{uri: poster}}
            contentFit={single ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            style={styles.posterImage}
            onLoadEnd={() => setPosterLoading(false)}
            onError={() => {
              setFailed(true);
            }}
          />
        </>
      ) : null}
      {!playRequested ? (
        <Pressable
          className="absolute inset-0 items-center justify-center bg-black/15"
          onPress={event => {
            event.stopPropagation();
            handleVideoPress();
          }}
        >
          <View className="h-14 w-14 items-center justify-center rounded-full bg-black/65">
            <Text className="ml-1 text-3xl text-white">▶</Text>
          </View>
        </Pressable>
      ) : null}
      {playRequested ? (
        <View pointerEvents="box-none" style={styles.videoControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
            hitSlop={8}
            onPress={event => {
              event.stopPropagation();
              const nextMuted = !muted;
              player.muted = nextMuted;
              player.volume = nextMuted ? 0 : 1;
              setMuted(nextMuted);
              setPlayRequested(true);
              player.play();
            }}
            style={styles.controlButton}
          >
            {muted ? (
              <VolumeX size={17} color="#fff" strokeWidth={2.4} />
            ) : (
              <Volume2 size={17} color="#fff" strokeWidth={2.4} />
            )}
          </Pressable>
          <Text style={styles.remainingTime}>{formatRemaining(remaining)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
  loadingOverlay: {
    bottom: 2,
    left: 2,
    overflow: 'hidden',
    position: 'absolute',
    right: 2,
    top: 2,
  },
  shimmerBand: {
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    height: '100%',
    position: 'absolute',
    width: '28%',
  },
  shimmerBase: {
    alignItems: 'center',
    backgroundColor: 'rgba(226, 232, 240, 0.56)',
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  shimmerIcon: {
    borderColor: 'rgba(100, 116, 139, 0.12)',
    borderRadius: 10,
    borderWidth: 2,
    height: 34,
    opacity: 0.75,
    width: 44,
  },
  posterImage: {
    bottom: 0,
    height: '100%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  video: {
    height: '100%',
    width: '100%',
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 32,
  },
  remainingTime: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 12,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 46,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    right: 8,
    bottom: 8,
    textAlign: 'center',
  },
  videoControls: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});

function GridImage({
  sourceUri,
  contentFit,
}: {
  sourceUri: string;
  contentFit: 'contain' | 'cover';
}) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [sourceUri]);

  return (
    <>
      {loading ? (
        <MediaShimmerPlaceholder />
      ) : null}
      <Image
        source={{uri: sourceUri}}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        style={styles.fill}
        onLoadEnd={() => setLoading(false)}
      />
    </>
  );
}

export function ImageGrid({
  links,
  note,
  containerWidth,
  className,
}: ImageGridProps) {
  const viewportWidth = useUIStore(state => state.dimensions.width);
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const validLinks = useMemo(() => links.filter(link => link.src), [links]);
  const displayLinks = useMemo(
    () => validLinks.slice(0, MAX_DISPLAY_LINKS),
    [validLinks],
  );
  const remainingCount = Math.max(0, validLinks.length - displayLinks.length);
  const resolvedContainerWidth = Math.max(160, containerWidth ?? viewportWidth - 88);

  useEffect(() => {
    for (const link of displayLinks) {
      if (link.type === 'video') continue;
      Image.prefetch(link.src, 'memory-disk').catch(() => {});
    }
  }, [displayLinks]);

  if (!displayLinks.length) return null;

  return (
    <View
      className={className ?? 'mb-2 overflow-hidden rounded-lg'}
      style={{width: resolvedContainerWidth}}
    >
      <View
        style={
          displayLinks.length === 1
            ? {height: getImageHeight(displayLinks[0]?.dim, resolvedContainerWidth)}
            : {height: IMAGE_GRID_HEIGHT}
        }
      >
        {displayLinks.map((link, index) => {
          const single = displayLinks.length === 1;
          const tileStyle: ViewStyle = single
            ? {height: '100%', left: 0, top: 0, width: resolvedContainerWidth}
            : getGridTileLayout(displayLinks.length, index, resolvedContainerWidth);
          const imageUri = link.type === 'video' && link.blurhash ? link.blurhash : link.src;
          const autoplay = link.type === 'video' && (single || index === 0);
          const openZoom = () => {
            setImageZoom({
              links: validLinks,
              note,
              zoomed: index,
              gridId: `${validLinks[0]?.src || 'media'}-${validLinks.length}`,
              videoTime: 0,
            });
          };

          if (link.type === 'video') {
            return (
              <View
                key={`${link.src}-${index}`}
                className="absolute overflow-hidden"
                style={tileStyle}
              >
                <VideoTile
                  src={link.src}
                  poster={link.blurhash || undefined}
                  autoplay={autoplay}
                  single={single}
                  onOpenZoom={openZoom}
                />
                {remainingCount > 0 && index === displayLinks.length - 1 ? (
                  <View className="absolute inset-0 items-center justify-center bg-black/60">
                    <Text className="text-2xl font-bold text-white">+{remainingCount}</Text>
                    <Text className="text-sm text-white">more</Text>
                  </View>
                ) : null}
              </View>
            );
          }

          return (
            <Pressable
              key={`${link.src}-${index}`}
              className="absolute overflow-hidden"
              style={tileStyle}
              onPress={event => {
                event.stopPropagation();
                openZoom();
              }}
            >
              <GridImage
                sourceUri={imageUri}
                contentFit={single ? 'contain' : 'cover'}
              />
              {remainingCount > 0 && index === displayLinks.length - 1 ? (
                <View className="absolute inset-0 items-center justify-center bg-black/60">
                  <Text className="text-2xl font-bold text-white">+{remainingCount}</Text>
                  <Text className="text-sm text-white">more</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
