import {VideoView} from 'expo-video';
import React, {useEffect, useMemo, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
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
}: {
  src: string;
  poster?: string;
  autoplay: boolean;
  single: boolean;
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
  const player = useSharedVideoPlayer(src);

  useEffect(() => {
    if (zoomOwnsPlayer) return;
    setPlayRequested(autoplay);
    player.loop = true;
    player.muted = true;
    player.volume = 0;
    player.showNowPlayingNotification = false;
    player.staysActiveInBackground = false;
    if (autoplay) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
    }
  }, [autoplay, player, zoomOwnsPlayer]);

  return (
    <View className="h-full w-full bg-slate-950">
      {zoomOwnsPlayer ? null : (
        <VideoView
          player={player}
          nativeControls
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
          resizeMode={single ? 'contain' : 'cover'}
          className="absolute inset-0 h-full w-full"
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
    </View>
  );
}

const styles = StyleSheet.create({
  video: {
    height: '100%',
    width: '100%',
  },
});

export function ImageGrid({links}: {links: ImageGridLink[]}) {
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
      Image.prefetch(link.src).catch(() => {});
    }
  }, [displayLinks]);

  if (!displayLinks.length) return null;

  return (
    <View className="my-2 overflow-hidden rounded-lg">
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

          return (
            <Pressable
              key={`${link.src}-${index}`}
              className={['relative overflow-hidden bg-slate-100', rounded].join(' ')}
              style={{width: tileWidth, height}}
              onPress={event => {
                event.stopPropagation();
                setImageZoom({
                  links: links.filter(item => item.src),
                  zoomed: index,
                  gridId: `${links[0]?.src || 'media'}-${links.length}`,
                  videoTime: 0,
                });
              }}
            >
              {link.type === 'video' ? (
                <VideoTile
                  src={link.src}
                  poster={link.blurhash || undefined}
                  autoplay={autoplay}
                  single={single}
                />
              ) : (
                <Image
                  source={{uri: imageUri}}
                  resizeMode={single ? 'contain' : 'cover'}
                  className="h-full w-full"
                />
              )}
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
