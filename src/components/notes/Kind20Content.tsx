import React, { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { asKind20, asKind22, fbArray } from '@candypoets/nipworker/utils';
import { ImageGrid, type ImageGridLink } from './ImageGrid';
import {
  NativeMediaViewer,
  isNativeMediaViewerAvailable,
} from '../native/NativeMediaViewer';
import { useUIStore } from '../../stores/uiStore';

type Kind20ContentProps = {
  note: ParsedEvent;
  relays?: string[];
};

function Kind20ContentComponent({ note, relays }: Kind20ContentProps) {
  const viewportWidth = useUIStore(state => state.dimensions.width);
  const kind20 = useMemo(() => asKind20(note), [note]);
  const kind22 = useMemo(() => asKind22(note), [note]);
  const media = useMemo<ImageGridLink[]>(() => {
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
  }, [kind20, kind22]);
  const title = kind20?.title?.() || kind22?.title?.() || '';
  const description = kind20?.description?.() || kind22?.description?.() || '';
  const hashtags = kind20
    ? fbArray(kind20, 'hashtags')
    : kind22
    ? fbArray(kind22, 'hashtags')
    : [];
  const mediaWidth = Math.max(160, viewportWidth);

  return (
    <View className="gap-2">
      {isNativeMediaViewerAvailable ? (
        <NativeMediaViewer
          note={note}
          relays={relays}
          links={media}
          containerWidth={mediaWidth}
        />
      ) : (
        <ImageGrid
          note={note}
          links={media}
          containerWidth={mediaWidth}
          className="w-full overflow-hidden bg-base-200"
        />
      )}
      {title ? (
        <Text className="px-1 text-lg font-semibold text-base-content">
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text className="px-1 text-sm leading-5 text-base-content">
          {description}
        </Text>
      ) : null}
      {hashtags.length ? (
        <View className="flex-row flex-wrap gap-1 px-1">
          {hashtags.map((tag, index) => (
            <Text
              key={`${String(tag)}-${index}`}
              className="text-sm text-primary"
            >
              #{String(tag)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const Kind20Content = memo(Kind20ContentComponent);
