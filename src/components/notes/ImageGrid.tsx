import React from 'react';
import {Image, Text, useWindowDimensions, View} from 'react-native';

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

export function ImageGrid({links}: {links: ImageGridLink[]}) {
  const {width} = useWindowDimensions();
  const displayLinks = links.filter(link => link.src).slice(0, 5);
  const remainingCount = Math.max(0, links.length - displayLinks.length);
  const columns = getColumns(displayLinks.length);
  const containerWidth = Math.max(160, width - 88);

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

          return (
            <View
              key={`${link.src}-${index}`}
              className={['relative overflow-hidden bg-slate-100', rounded].join(' ')}
              style={{width: tileWidth, height}}
            >
              {link.type === 'video' && !link.blurhash ? (
                <View className="h-full w-full items-center justify-center bg-slate-900">
                  <Text className="text-sm font-semibold text-white">Video</Text>
                </View>
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
            </View>
          );
        })}
      </View>
    </View>
  );
}
