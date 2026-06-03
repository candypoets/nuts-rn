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
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {useSharedVideoPlayer} from '../../media/videoPlayers';
import {useUIStore} from '../../stores/uiStore';

export type ImageGridLink = {
  src: string;
  type?: 'image' | 'video';
  blurhash?: string;
  dim?: string | null;
};

const MAX_IMAGE_HEIGHT = 384;
const IMAGE_GRID_HEIGHT = 192;

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

function getColumns(count: number) {
  return Math.ceil(Math.sqrt(count || 1));
}

function getRounded(i: number, total: number, columns: number) {
  if (total === 1) return 'rounded-lg';
  const row = Math.floor(i / columns);
  const col = i % columns;
  const totalRows = Math.ceil(total / columns);
  const firstRow = row === 0;
  const lastRow = row === totalRows - 1;
  const firstCol = col === 0;
  const lastCol = col === columns - 1 || i === total - 1;

  return [
    firstRow && firstCol ? 'rounded-tl-lg' : '',
    firstRow && lastCol ? 'rounded-tr-lg' : '',
    lastRow && firstCol ? 'rounded-bl-lg' : '',
    lastRow && lastCol ? 'rounded-br-lg' : '',
  ]
    .filter(Boolean)
    .join(' ');
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
  const [playRequested, setPlayRequested] = useState(autoplay);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progressWidth, setProgressWidth] = useState(1);
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
  const progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;

  const handleProgressLayout = (event: LayoutChangeEvent) => {
    setProgressWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  const seekFromLocation = (locationX: number) => {
    if (!duration) return;
    const nextProgress = Math.min(Math.max(locationX / progressWidth, 0), 1);
    player.currentTime = duration * nextProgress;
    setCurrentTime(duration * nextProgress);
  };

  const handleVideoPress = () => {
    if (muted) {
      player.muted = false;
      player.volume = 1;
      setMuted(false);
      setPlayRequested(true);
      player.play();
      return;
    }

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
        <Image
          source={{uri: poster}}
          contentFit={single ? 'contain' : 'cover'}
          cachePolicy="memory-disk"
          style={styles.posterImage}
          onError={() => setFailed(true)}
        />
      ) : null}
      {!playRequested ? (
        <Pressable
          className="absolute inset-0 items-center justify-center bg-black/15"
          onPress={event => {
            event.stopPropagation();
            setPlayRequested(true);
            setFirstFrameRendered(true);
            player.play();
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
            }}
            style={styles.controlButton}
          >
            {muted ? (
              <VolumeX size={17} color="#fff" strokeWidth={2.4} />
            ) : (
              <Volume2 size={17} color="#fff" strokeWidth={2.4} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Video progress"
            onLayout={handleProgressLayout}
            onPress={event => {
              event.stopPropagation();
              seekFromLocation(event.nativeEvent.locationX);
            }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, {width: `${progress * 100}%`}]} />
          </Pressable>
          <Text style={styles.remainingTime}>-{formatRemaining(remaining)}</Text>
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
    width: 32,
  },
  progressFill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.34)',
    borderRadius: 999,
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  remainingTime: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 42,
    textAlign: 'right',
  },
  videoControls: {
    alignItems: 'center',
    bottom: 8,
    flexDirection: 'row',
    gap: 8,
    left: 8,
    position: 'absolute',
    right: 8,
  },
});

export function ImageGrid({links, note}: {links: ImageGridLink[]; note?: ParsedEvent}) {
  const {width} = useWindowDimensions();
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const displayLinks = useMemo(
    () => links.filter(link => link.src).slice(0, 5),
    [links],
  );
  const remainingCount = Math.max(0, links.length - displayLinks.length);
  const columns = getColumns(displayLinks.length);
  const containerWidth = Math.max(160, width - 88);

  useEffect(() => {
    for (const link of displayLinks) {
      if (link.type === 'video') continue;
      Image.prefetch(link.src, 'memory-disk').catch(() => {});
    }
  }, [displayLinks]);

  if (!displayLinks.length) return null;

  return (
    <View className="mb-2 overflow-hidden rounded-lg">
      <View className="flex-row flex-wrap gap-1">
        {displayLinks.map((link, index) => {
          const single = displayLinks.length === 1;
          const tileWidth = single
            ? containerWidth
            : (containerWidth - (columns - 1) * 4) / columns;
          const height = single
            ? getImageHeight(link.dim, containerWidth)
            : IMAGE_GRID_HEIGHT;
          const rounded = getRounded(index, displayLinks.length, columns);
          const imageUri = link.type === 'video' && link.blurhash ? link.blurhash : link.src;
          const autoplay = link.type === 'video' && (single || index === 0);
          const openZoom = () => {
            setImageZoom({
              links: links.filter(item => item.src),
              note,
              zoomed: index,
              gridId: `${links[0]?.src || 'media'}-${links.length}`,
              videoTime: 0,
            });
          };

          if (link.type === 'video') {
            return (
              <View
                key={`${link.src}-${index}`}
                className={['relative overflow-hidden bg-slate-100', rounded].join(' ')}
                style={{width: tileWidth, height}}
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
              className={['relative overflow-hidden bg-slate-100', rounded].join(' ')}
              style={{width: tileWidth, height}}
              onPress={event => {
                event.stopPropagation();
                openZoom();
              }}
            >
              <Image
                source={{uri: imageUri}}
                contentFit={single ? 'contain' : 'cover'}
                cachePolicy="memory-disk"
                style={styles.fill}
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
