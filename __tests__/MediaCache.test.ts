import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';

const mockDeleteAsync = jest.fn(
  (_uri: string, _options: {idempotent: boolean}) => Promise.resolve(),
);
const mockConfigureCache = jest.fn(
  (_config: {maxDiskSize: number}) => undefined,
);
const mockClearDiskCache = jest.fn(() => Promise.resolve(true));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///data/user/0/com.nutsrn/cache/',
  deleteAsync: (uri: string, options: {idempotent: boolean}) =>
    mockDeleteAsync(uri, options),
}));

jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: () => mockClearDiskCache(),
    configureCache: (config: {maxDiskSize: number}) =>
      mockConfigureCache(config),
  },
}));

import {
  IMAGE_DISK_CACHE_LIMIT_BYTES,
  clearOrphanedImagePickerAssets,
  configureImageCache,
  deleteImagePickerAsset,
  isImagePickerCacheUri,
  runMediaCacheMaintenance,
} from '../src/media/cache';

describe('media cache', () => {
  const originalPlatform = Platform.OS;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });
  });

  it('only recognizes files owned by the ImagePicker cache directory', () => {
    expect(
      isImagePickerCacheUri(
        'file:///data/user/0/com.nutsrn/cache/ImagePicker/photo.jpg',
      ),
    ).toBe(true);
    expect(
      isImagePickerCacheUri(
        'file:///data/user/0/com.nutsrn/cache/ImagePicker%2F..%2Fsecret.jpg',
      ),
    ).toBe(false);
    expect(
      isImagePickerCacheUri(
        'file:///data/user/0/com.nutsrn/cache/ImagePickerBackup/photo.jpg',
      ),
    ).toBe(false);
    expect(isImagePickerCacheUri('https://cdn.example/photo.jpg')).toBe(false);
  });

  it('deletes picker assets without touching other local files', async () => {
    const pickerUri =
      'file:///data/user/0/com.nutsrn/cache/ImagePicker/photo.jpg';

    await expect(deleteImagePickerAsset(pickerUri)).resolves.toBe(true);
    await expect(
      deleteImagePickerAsset(
        'file:///data/user/0/com.nutsrn/Documents/wallet.json',
      ),
    ).resolves.toBe(false);

    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledWith(pickerUri, {
      idempotent: true,
    });
  });

  it('clears orphaned picker files from previous app sessions', async () => {
    await expect(clearOrphanedImagePickerAssets()).resolves.toBe(true);
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      'file:///data/user/0/com.nutsrn/cache/ImagePicker',
      {idempotent: true},
    );
  });

  it('configures a 256 MiB iOS image cache', () => {
    configureImageCache();
    expect(mockConfigureCache).toHaveBeenCalledWith({
      maxDiskSize: IMAGE_DISK_CACHE_LIMIT_BYTES,
    });
  });

  it('leaves Android image eviction to Glide while still sweeping picker files', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    configureImageCache();
    await runMediaCacheMaintenance();

    expect(mockConfigureCache).not.toHaveBeenCalled();
    expect(mockClearDiskCache).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
  });

  it('clears the legacy unbounded image cache only once', async () => {
    await runMediaCacheMaintenance();
    await runMediaCacheMaintenance();

    expect(mockClearDiskCache).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
  });
});
