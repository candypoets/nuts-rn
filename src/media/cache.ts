import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {Image} from 'expo-image';
import {Platform} from 'react-native';

export const IMAGE_DISK_CACHE_LIMIT_BYTES = 256 * 1024 * 1024;

const IMAGE_CACHE_MIGRATION_KEY = 'media:image-cache:256mb:v1';
const IMAGE_PICKER_CACHE_DIRECTORY = 'ImagePicker';

function filePath(uri: string | null | undefined) {
  if (!uri?.startsWith('file://')) return null;

  try {
    const decoded = decodeURIComponent(new URL(uri).pathname).replace(
      /\/+/g,
      '/',
    );
    const segments: string[] = [];
    for (const segment of decoded.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
    return `/${segments.join('/')}`;
  } catch {
    return null;
  }
}

function imagePickerCacheUri() {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) return null;
  return `${cacheDirectory.replace(/\/+$/, '')}/${IMAGE_PICKER_CACHE_DIRECTORY}`;
}

export function isImagePickerCacheUri(uri: string | null | undefined) {
  const path = filePath(uri);
  const directoryPath = filePath(imagePickerCacheUri());
  if (!path || !directoryPath) return false;
  return path.startsWith(`${directoryPath}/`);
}

export async function deleteImagePickerAsset(uri: string | null | undefined) {
  if (!uri || !isImagePickerCacheUri(uri)) return false;

  try {
    await FileSystem.deleteAsync(uri, {idempotent: true});
    return true;
  } catch (error) {
    console.warn('[media-cache] failed to delete picker asset', error);
    return false;
  }
}

export async function deleteImagePickerAssets(
  uris: Array<string | null | undefined>,
) {
  const uniqueUris = [...new Set(uris.filter((uri): uri is string => !!uri))];
  await Promise.all(uniqueUris.map(deleteImagePickerAsset));
}

export async function clearOrphanedImagePickerAssets() {
  const directoryUri = imagePickerCacheUri();
  if (!directoryUri) return false;

  try {
    await FileSystem.deleteAsync(directoryUri, {idempotent: true});
    return true;
  } catch (error) {
    console.warn('[media-cache] failed to clear picker cache', error);
    return false;
  }
}

export function configureImageCache() {
  if (Platform.OS !== 'ios') return;
  Image.configureCache({maxDiskSize: IMAGE_DISK_CACHE_LIMIT_BYTES});
}

export async function runMediaCacheMaintenance() {
  await clearOrphanedImagePickerAssets();

  if (Platform.OS !== 'ios') return;
  const migrated = await AsyncStorage.getItem(IMAGE_CACHE_MIGRATION_KEY);
  if (migrated === '1') return;

  const cleared = await Image.clearDiskCache();
  if (cleared) {
    await AsyncStorage.setItem(IMAGE_CACHE_MIGRATION_KEY, '1');
  }
}
