import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Captions,
  Camera,
  Check,
  ChevronLeft,
  CircleAlert,
  Image as ImageIcon,
  ImagePlus,
  LockKeyhole,
  Maximize2,
  Smile,
  Sparkles,
  X,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
} from 'react-native-enriched';

import { type AppTheme, useAppTheme } from '../../theme';
import { Avatar } from '../../components/notes/Avatar';
import { useUIStore } from '../../stores/uiStore';
import {
  type SelectedImage,
  editorHtmlStyle,
  readableContentColor,
} from './shared';

type MediaNoteHeaderProps = {
  canSubmit: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onShare: () => void;
  submitLabel: string;
};

export function MediaNoteHeader({
  canSubmit,
  isSubmitting,
  onBack,
  onShare,
  submitLabel,
}: MediaNoteHeaderProps) {
  const theme = useAppTheme();
  return (
    <>
      <View
        className="absolute inset-0 items-center justify-center"
        pointerEvents="box-none"
      >
        <Text className="text-[16px] font-bold text-base-content">
          New media
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Back to post formats"
        accessibilityRole="button"
        className="h-[42px] w-[42px] items-center justify-center rounded-full border border-base-content/20 bg-base-300"
        hitSlop={12}
        onPress={onBack}
      >
        <ChevronLeft
          size={27}
          color={theme.colors.primaryContent}
          strokeWidth={2.3}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={
          isSubmitting ? `${submitLabel}, please wait` : 'Share media'
        }
        accessibilityRole="button"
        accessibilityState={{ busy: isSubmitting, disabled: !canSubmit }}
        className={
          canSubmit
            ? 'min-h-10 min-w-[72px] items-center justify-center rounded-[18px] border border-[#4388ff] bg-[#4388ff] px-3.5'
            : 'min-h-10 min-w-[72px] items-center justify-center rounded-[18px] border border-base-content/10 bg-base-content/15 px-3.5'
        }
        disabled={!canSubmit}
        onPress={onShare}
      >
        <Text
          className={
            canSubmit
              ? 'text-[15px] font-medium text-white'
              : 'text-[15px] font-medium text-primary-content'
          }
        >
          {isSubmitting ? submitLabel : 'Share'}
        </Text>
      </Pressable>
    </>
  );
}

type MediaNoteComposerProps = {
  activePanel: 'gif' | null;
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  images: SelectedImage[];
  onGifPress: () => void;
  onInsertImage: (
    uri: string,
    width: number,
    height: number,
    mimeType?: string | null,
    fileName?: string | null,
  ) => void;
  onMentionQuery: (query: string | null) => void;
  onPickMedia: () => void;
  onRemove: (uri: string) => void;
  onTextChange: (value: string) => void;
  pubkey: string;
  text: string;
};

export function MediaNoteComposer({
  activePanel,
  editorRef,
  images,
  onGifPress,
  onInsertImage,
  onMentionQuery,
  onPickMedia,
  onRemove,
  onTextChange,
  pubkey,
  text,
}: MediaNoteComposerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const previewRef = useRef<ScrollView>(null);
  const [previewWidth, setPreviewWidth] = useState(1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, images.length - 1));
  const activeImage = images[activeIndex];
  const setImageZoom = useUIStore(state => state.setImageZoom);

  const selectImage = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      previewRef.current?.scrollTo({ x: index * previewWidth, animated: true });
    },
    [previewWidth],
  );
  const openActiveImage = useCallback(() => {
    if (!images.length) return;
    setImageZoom({
      links: images.map(image => ({ src: image.uri, type: 'image' })),
      note: undefined,
      zoomed: activeIndex,
    });
  }, [activeIndex, images, setImageZoom]);
  const insertEmoji = useCallback(() => {
    const spacer = text && !text.endsWith(' ') ? ' ' : '';
    const next = `${text}${spacer}😊`;
    onTextChange(next);
    editorRef.current?.setValue(next);
    editorRef.current?.focus();
    editorRef.current?.setSelection(next.length, next.length);
  }, [editorRef, onTextChange, text]);
  const dismissCaption = useCallback(() => {
    editorRef.current?.blur();
    onMentionQuery(null);
    Keyboard.dismiss();
  }, [editorRef, onMentionQuery]);
  const insertCameraAsset = useCallback(
    (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) return;
      onInsertImage(
        asset.uri,
        Math.max(1, Math.round(asset.width || 320)),
        Math.max(1, Math.round(asset.height || 240)),
        asset.mimeType,
        asset.fileName,
      );
    },
    [onInsertImage],
  );
  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
      quality: 0.92,
    });
    if (!result.canceled && result.assets[0]) {
      insertCameraAsset(result.assets[0]);
    }
  }, [insertCameraAsset]);

  return (
    <TouchableWithoutFeedback accessible={false} onPress={dismissCaption}>
      <View
        className={
          images.length ? 'gap-4' : 'min-h-[700px] justify-between gap-4'
        }
      >
        {images.length ? (
          <>
            <View
              className="relative aspect-square overflow-hidden rounded-[18px] bg-base-200"
              onLayout={event => {
                setPreviewWidth(Math.max(1, event.nativeEvent.layout.width));
              }}
            >
              <ScrollView
                ref={previewRef}
                horizontal
                pagingEnabled
                bounces={false}
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(
                  event: NativeSyntheticEvent<NativeScrollEvent>,
                ) => {
                  setSelectedIndex(
                    Math.round(
                      event.nativeEvent.contentOffset.x / previewWidth,
                    ),
                  );
                }}
              >
                {images.map(image => (
                  <Image
                    key={image.uri}
                    source={{ uri: image.uri }}
                    style={[
                      styles.mediaBuilderPreviewImage,
                      { width: previewWidth },
                    ]}
                    contentFit="cover"
                  />
                ))}
              </ScrollView>

              <Pressable
                accessibilityLabel="View media fullscreen"
                accessibilityRole="button"
                className="absolute left-3 top-3 h-10 w-10 items-center justify-center rounded-full bg-black/45"
                hitSlop={8}
                onPress={openActiveImage}
              >
                <Maximize2 size={20} color="#ffffff" strokeWidth={2.2} />
              </Pressable>
              <View className="absolute right-3 top-3 rounded-full bg-black/45 px-3 py-1.5">
                <Text className="text-[14px] font-medium text-white/80">
                  {activeIndex + 1} / {images.length}
                </Text>
              </View>
              {images.length > 1 ? (
                <View className="absolute bottom-5 left-0 right-0 flex-row justify-center gap-2">
                  {images.map((image, index) => (
                    <View
                      key={image.uri}
                      className={
                        index === activeIndex
                          ? 'h-2 w-2 rounded-full bg-white'
                          : 'h-2 w-2 rounded-full bg-white/30'
                      }
                    />
                  ))}
                </View>
              ) : null}
              {activeImage?.status === 'uploading' ||
              activeImage?.status === 'failed' ? (
                <View className="absolute inset-0 items-center justify-center gap-2 bg-black/45">
                  {activeImage.status === 'uploading' ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <CircleAlert size={24} color="#ffffff" strokeWidth={2.2} />
                  )}
                  <Text className="text-sm font-bold text-white">
                    {activeImage.status === 'uploading'
                      ? 'Uploading'
                      : 'Upload failed'}
                  </Text>
                </View>
              ) : null}
            </View>

            <ScrollView
              horizontal
              contentContainerClassName="gap-2.5 px-0.5"
              showsHorizontalScrollIndicator={false}
            >
              {images.map((image, index) => (
                <Pressable
                  key={image.uri}
                  accessibilityLabel={`Select media ${index + 1}`}
                  accessibilityRole="button"
                  className={
                    index === activeIndex
                      ? 'relative h-[82px] w-[82px] overflow-hidden rounded-[14px] border-[3px] border-[#4388ff] bg-base-200'
                      : 'relative h-[82px] w-[82px] overflow-hidden rounded-[14px] border border-base-200 bg-base-200'
                  }
                  onPress={() => selectImage(index)}
                >
                  <Image
                    source={{ uri: image.uri }}
                    style={styles.mediaBuilderThumbnailImage}
                    contentFit="cover"
                  />
                  <Pressable
                    accessibilityLabel={`Remove media ${index + 1}`}
                    accessibilityRole="button"
                    className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60"
                    hitSlop={6}
                    onPress={() => onRemove(image.uri)}
                  >
                    <X size={13} color="#ffffff" strokeWidth={2.5} />
                  </Pressable>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="Add more media"
                accessibilityRole="button"
                className="h-[82px] w-[82px] items-center justify-center rounded-[14px] border border-dashed border-base-content/45 bg-base-300"
                onPress={onPickMedia}
              >
                <ImagePlus
                  size={28}
                  color={theme.colors.primaryContent}
                  strokeWidth={1.8}
                />
              </Pressable>
            </ScrollView>
          </>
        ) : (
          <MediaComposerPrompt
            onGifPress={onGifPress}
            onPickMedia={onPickMedia}
            onTakePhoto={takePhoto}
          />
        )}

        <View className="flex-row items-center gap-2.5">
          {pubkey ? <Avatar pubkey={pubkey} size="md" /> : null}
          <View className="min-h-12 min-w-0 flex-1 flex-row items-center overflow-hidden rounded-[14px] border border-base-content/20 bg-base-300">
            <EnrichedTextInput
              ref={editorRef}
              autoFocus={false}
              autoCapitalize="sentences"
              editable={images.length > 0}
              mentionIndicators={['@']}
              placeholder={
                images.length
                  ? 'Write a caption...'
                  : 'Add a caption after choosing media'
              }
              placeholderTextColor={theme.colors.primaryContent}
              selectionColor={theme.colors.primary}
              cursorColor={theme.colors.primary}
              linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
              scrollEnabled
              onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
                onTextChange(event.nativeEvent.value)
              }
              onStartMention={indicator => {
                if (indicator === '@') onMentionQuery('');
              }}
              onChangeMention={event => {
                if (event.indicator === '@') onMentionQuery(event.text);
              }}
              onEndMention={indicator => {
                if (indicator === '@') onMentionQuery(null);
              }}
              htmlStyle={editorHtmlStyle}
              returnKeyType="done"
              style={styles.mediaBuilderCaptionEditor}
              submitBehavior="blurAndSubmit"
              onSubmitEditing={dismissCaption}
            />
            <Pressable
              accessibilityLabel="Add smile emoji"
              accessibilityRole="button"
              className={
                images.length
                  ? 'h-12 w-12 items-center justify-center'
                  : 'h-12 w-12 items-center justify-center opacity-60'
              }
              disabled={!images.length}
              hitSlop={6}
              onPress={insertEmoji}
            >
              <Smile
                size={23}
                color={theme.colors.primaryContent}
                strokeWidth={2}
              />
            </Pressable>
          </View>
        </View>

        {images.length ? (
          <MediaNoteToolbar
            activePanel={activePanel}
            onGifPress={onGifPress}
            onInsertImage={onInsertImage}
            onPickMedia={onPickMedia}
          />
        ) : null}
      </View>
    </TouchableWithoutFeedback>
  );
}

function MediaNoteToolbar({
  activePanel,
  onGifPress,
  onInsertImage,
  onPickMedia,
}: {
  activePanel: 'gif' | null;
  onGifPress: () => void;
  onInsertImage: MediaNoteComposerProps['onInsertImage'];
  onPickMedia: () => void;
}) {
  const theme = useAppTheme();
  const insertAsset = useCallback(
    (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) return;
      onInsertImage(
        asset.uri,
        Math.max(1, Math.round(asset.width || 320)),
        Math.max(1, Math.round(asset.height || 240)),
        asset.mimeType,
        asset.fileName,
      );
    },
    [onInsertImage],
  );
  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
      quality: 0.92,
    });
    if (!result.canceled && result.assets[0]) insertAsset(result.assets[0]);
  }, [insertAsset]);

  return (
    <View className="min-h-[64px] flex-row items-center justify-around rounded-[16px] border border-base-content/20 bg-base-300 px-8">
      <MediaToolbarButton
        accessibilityLabel="Add photos"
        active
        icon={<ImageIcon size={25} color="#4b87ff" strokeWidth={2.1} />}
        onPress={onPickMedia}
      />
      <MediaToolbarButton
        accessibilityLabel="Open camera"
        icon={
          <Camera
            size={25}
            color={theme.colors.primaryContent}
            strokeWidth={2.1}
          />
        }
        onPress={takePhoto}
      />
      <MediaToolbarButton
        accessibilityLabel="Add GIF"
        active={activePanel === 'gif'}
        icon={
          <View className="h-[20px] min-w-[28px] items-center justify-center rounded-[4px] border-2 border-primary-content px-1">
            <Text className="text-[10px] font-extrabold leading-3 text-primary-content">
              GIF
            </Text>
          </View>
        }
        onPress={onGifPress}
      />
    </View>
  );
}

function MediaToolbarButton({
  accessibilityLabel,
  active = false,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={
        active
          ? 'h-[46px] w-[46px] items-center justify-center rounded-full border-2 border-[#4388ff] bg-[#4388ff]/10'
          : 'h-[46px] w-[46px] items-center justify-center rounded-full border border-base-content/25 bg-base-300'
      }
      hitSlop={6}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}

export function MediaComposerPrompt({
  onGifPress,
  onPickMedia,
  onTakePhoto,
}: {
  onGifPress: () => void;
  onPickMedia: () => void;
  onTakePhoto: () => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View className="min-h-[560px] justify-center gap-8">
      <View className="items-center gap-5">
        <View className="relative h-[170px] w-[230px]">
          <View className="absolute right-7 top-5 h-[136px] w-[108px] rotate-6 items-center justify-center rounded-[18px] border border-base-content/25 bg-base-300">
            <View className="h-9 min-w-[48px] items-center justify-center rounded-md border-2 border-base-content/30 px-2">
              <Text className="text-[15px] font-extrabold text-primary-content/60">
                GIF
              </Text>
            </View>
          </View>
          <View className="absolute left-7 top-1 h-[150px] w-[120px] -rotate-6 items-center justify-center rounded-[18px] border border-base-content/30 bg-base-300">
            <ImageIcon size={48} color="#4b87ff" strokeWidth={1.9} />
            <Sparkles
              size={28}
              color="#4b87ff"
              strokeWidth={1.9}
              style={styles.mediaPromptSparkles}
            />
          </View>
        </View>
        <View className="items-center gap-2">
          <Text className="text-center text-[24px] font-extrabold leading-8 text-base-content">
            Start with a photo or GIF
          </Text>
          <Text className="text-center text-[16px] leading-[22px] text-primary-content">
            Choose something worth sharing.
          </Text>
        </View>
      </View>

      <View className="gap-3">
        <Pressable
          accessibilityLabel="Choose media from library"
          accessibilityRole="button"
          className="min-h-[60px] flex-row items-center justify-center gap-3 rounded-[18px] bg-[#4388ff] px-5"
          onPress={onPickMedia}
        >
          <ImageIcon size={25} color="#ffffff" strokeWidth={2.1} />
          <Text className="text-[17px] font-semibold text-white">
            Choose from library
          </Text>
        </Pressable>
        <View className="flex-row gap-3">
          <Pressable
            accessibilityLabel="Take a photo"
            accessibilityRole="button"
            className="min-h-[62px] flex-1 flex-row items-center justify-center gap-2.5 rounded-[16px] border border-base-content/25 bg-base-300"
            onPress={onTakePhoto}
          >
            <Camera
              size={25}
              color={theme.colors.primaryContent}
              strokeWidth={2.1}
            />
            <Text className="text-[15px] font-semibold text-base-content">
              Take a photo
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Find a GIF"
            accessibilityRole="button"
            className="min-h-[62px] flex-1 flex-row items-center justify-center gap-2.5 rounded-[16px] border border-base-content/25 bg-base-300"
            onPress={onGifPress}
          >
            <View className="h-[22px] min-w-[34px] items-center justify-center rounded-[4px] border-2 border-primary-content px-1">
              <Text className="text-[11px] font-extrabold leading-3 text-primary-content">
                GIF
              </Text>
            </View>
            <Text className="text-[15px] font-semibold text-base-content">
              Find a GIF
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row items-center justify-center gap-2">
        <LockKeyhole
          size={16}
          color={theme.colors.primaryContent}
          strokeWidth={2}
        />
        <Text className="text-[14px] text-primary-content/70">
          Your media stays private until you share.
        </Text>
      </View>
    </View>
  );
}

export function SelectedMediaGrid({
  images,
  onRemove,
}: {
  images: SelectedImage[];
  onRemove: (uri: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const columns = images.length === 1 ? 1 : images.length === 2 ? 2 : 3;
  const tileWidth = columns === 1 ? '100%' : columns === 2 ? '48.6%' : '32.1%';
  const tileAspectRatio = columns === 1 ? 4 / 3 : 1;
  const errors = images
    .map((image, index) =>
      image.status === 'failed' && image.error
        ? `Image ${index + 1}: ${image.error}`
        : null,
    )
    .filter((error): error is string => Boolean(error));

  return (
    <View style={styles.selectedMediaBlock}>
      <View style={styles.selectedMediaGrid}>
        {images.map((image, index) => {
          const uploading = image.status === 'uploading';
          const uploaded = image.status === 'uploaded';
          const failed = image.status === 'failed';
          const statusLabel = uploading ? 'Uploading' : failed ? 'Failed' : '';
          const badgeLabel = image.status === 'waiting' ? `${index + 1}` : '';

          return (
            <View
              key={image.uri}
              style={[
                styles.selectedMediaTile,
                { width: tileWidth, aspectRatio: tileAspectRatio },
                failed && styles.selectedMediaTileFailed,
              ]}
            >
              <Image
                source={{ uri: image.uri }}
                style={styles.selectedMediaImage}
                contentFit="cover"
              />
              {!image.remote && (uploading || failed) ? (
                <View style={styles.selectedMediaOverlay}>
                  {uploading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <CircleAlert size={20} color="#ffffff" strokeWidth={2.2} />
                  )}
                  {statusLabel ? (
                    <Text style={styles.selectedMediaStatusLabel}>
                      {statusLabel}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {!image.remote && uploaded ? (
                <View style={styles.selectedMediaUploadedBadge}>
                  <Check size={13} color="#ffffff" strokeWidth={3} />
                </View>
              ) : null}
              {!image.remote && badgeLabel ? (
                <Text style={styles.selectedMediaBadge}>{badgeLabel}</Text>
              ) : null}
              {!uploading ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove media"
                  hitSlop={10}
                  style={styles.mediaRemove}
                  onPress={() => onRemove(image.uri)}
                >
                  <X size={14} color="#ffffff" strokeWidth={2.5} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {errors.length ? (
        <View style={styles.selectedMediaErrors}>
          {errors.map(error => (
            <View key={error} style={styles.selectedMediaErrorRow}>
              <CircleAlert
                size={13}
                color={theme.colors.error}
                strokeWidth={2.4}
              />
              <Text style={styles.selectedMediaError}>{error}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function MediaCaptionInput({
  editorRef,
  onMentionQuery,
  onTextChange,
  placeholder,
}: {
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  onMentionQuery: (query: string | null) => void;
  onTextChange: (value: string) => void;
  placeholder: string;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.mediaCaptionBlock}>
      <View style={styles.mediaCaptionLabelRow}>
        <Captions
          size={13}
          color={theme.colors.primaryContent}
          strokeWidth={2.4}
        />
        <Text style={styles.mediaCaptionLabel}>Caption</Text>
      </View>
      <View style={styles.mediaCaptionAccessory}>
        <EnrichedTextInput
          ref={editorRef}
          autoFocus
          autoCapitalize="sentences"
          mentionIndicators={['@']}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.primaryContent}
          selectionColor={theme.colors.primary}
          cursorColor={theme.colors.primary}
          linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
          scrollEnabled
          onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
            onTextChange(event.nativeEvent.value)
          }
          onStartMention={indicator => {
            if (indicator === '@') onMentionQuery('');
          }}
          onChangeMention={event => {
            if (event.indicator === '@') onMentionQuery(event.text);
          }}
          onEndMention={indicator => {
            if (indicator === '@') onMentionQuery(null);
          }}
          onPasteImages={event => {
            console.log('[post] pasted images', event.nativeEvent);
          }}
          htmlStyle={editorHtmlStyle}
          style={styles.mediaCaptionEditor}
        />
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    mediaBuilderCaptionEditor: {
      minHeight: 48,
      maxHeight: 112,
      flex: 1,
      paddingLeft: 14,
      paddingVertical: 12,
      fontSize: 15,
      lineHeight: 20,
      color: contentColor,
      textAlignVertical: 'top',
    },
    mediaBuilderPreviewImage: {
      height: '100%',
    },
    mediaBuilderThumbnailImage: {
      width: '100%',
      height: '100%',
    },
    mediaPromptSparkles: {
      position: 'absolute',
      right: 14,
      top: 34,
    },
    selectedMediaBlock: {
      gap: 10,
    },
    selectedMediaGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    selectedMediaTile: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base300,
      backgroundColor: theme.colors.base200,
      overflow: 'hidden',
    },
    selectedMediaTileFailed: {
      borderColor: theme.colors.error,
    },
    selectedMediaImage: {
      width: '100%',
      height: '100%',
    },
    selectedMediaOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: 'rgba(15, 23, 42, 0.45)',
    },
    selectedMediaStatusLabel: {
      color: '#ffffff',
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 14,
      textAlign: 'center',
    },
    selectedMediaUploadedBadge: {
      position: 'absolute',
      left: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.success,
    },
    selectedMediaBadge: {
      position: 'absolute',
      left: 6,
      top: 6,
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      overflow: 'hidden',
      paddingHorizontal: 6,
      backgroundColor: 'rgba(15, 23, 42, 0.66)',
      color: '#ffffff',
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 22,
      textAlign: 'center',
    },
    selectedMediaErrors: {
      gap: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: `${theme.colors.error}33`,
      backgroundColor: `${theme.colors.error}14`,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    selectedMediaErrorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    selectedMediaError: {
      flex: 1,
      color: theme.colors.error,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16,
    },
    mediaRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(15, 23, 42, 0.66)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaCaptionBlock: {
      gap: 6,
    },
    mediaCaptionLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 2,
    },
    mediaCaptionLabel: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '700',
    },
    mediaCaptionAccessory: {
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      overflow: 'hidden',
    },
    mediaCaptionEditor: {
      minHeight: 48,
      maxHeight: 112,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 15,
      lineHeight: 20,
      color: contentColor,
      textAlignVertical: 'top',
    },
  });
}
