import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  Image as ImageIcon,
  TriangleAlert,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  MenuView,
  type MenuAction,
  type NativeActionEvent,
} from '@react-native-menu/menu';
import type { EnrichedTextInputInstance } from 'react-native-enriched';

import { Avatar } from '../../components/notes/Avatar';
import { useAppTheme } from '../../theme';
import { NoteComposer } from './NoteComposer';
import type { ComposerPanel } from './shared';

type ShortNoteComposerProps = {
  characterCount: number;
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  onLayout: (event: LayoutChangeEvent) => void;
  onMentionQuery: (query: string | null) => void;
  onTextChange: (value: string) => void;
  placeholder: string;
  pubkey: string;
};

type ShortNoteHeaderProps = {
  canSubmit: boolean;
  destinationActions: MenuAction[];
  destinationLabel: string;
  isSubmitting: boolean;
  onBack: () => void;
  onDestinationAction: (event: NativeActionEvent) => void;
  onPublish: () => void;
  selectedRelay: string;
  submitLabel: string;
};

export function ShortNoteHeader({
  canSubmit,
  destinationActions,
  destinationLabel,
  isSubmitting,
  onBack,
  onDestinationAction,
  onPublish,
  selectedRelay,
  submitLabel,
}: ShortNoteHeaderProps) {
  const theme = useAppTheme();
  return (
    <>
      <View
        className="absolute inset-0 items-center justify-center"
        pointerEvents="box-none"
      >
        <MenuView
          title="Post to"
          actions={destinationActions}
          onPressAction={onDestinationAction}
        >
          <View
            accessibilityLabel={`Post destination: ${destinationLabel}`}
            accessibilityRole="button"
            className="min-h-9 max-w-[190px] flex-row items-center gap-1.5 rounded-full px-3"
          >
            <Text
              className="shrink text-[16px] font-bold text-base-content"
              numberOfLines={1}
            >
              {selectedRelay ? `${destinationLabel} note` : 'Public note'}
            </Text>
            <ChevronDown
              size={14}
              color={theme.colors.primaryContent}
              strokeWidth={2.4}
            />
          </View>
        </MenuView>
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
          isSubmitting ? `${submitLabel}, please wait` : 'Publish note'
        }
        accessibilityRole="button"
        accessibilityState={{ busy: isSubmitting, disabled: !canSubmit }}
        className="min-h-10 min-w-[74px] items-center justify-center rounded-[18px] border border-[#4388ff] bg-[#4388ff] px-3.5"
        disabled={!canSubmit}
        onPress={onPublish}
      >
        <Text className="text-[15px] font-medium text-white">
          {isSubmitting ? submitLabel : 'Publish'}
        </Text>
      </Pressable>
    </>
  );
}

export function ShortNoteComposer({
  characterCount,
  editorRef,
  onLayout,
  onMentionQuery,
  onTextChange,
  placeholder,
  pubkey,
}: ShortNoteComposerProps) {
  return (
    <View className="gap-3">
      {pubkey ? (
        <View className="flex-row items-center gap-3">
          <Avatar pubkey={pubkey} size="lg" />
          <Text className="min-w-0 flex-1 text-[16px] font-bold leading-5 text-base-content">
            You
          </Text>
        </View>
      ) : null}

      <View className="relative">
        <NoteComposer
          editorRef={editorRef}
          isPoll={false}
          isReply={false}
          onLayout={onLayout}
          onMentionQuery={onMentionQuery}
          onTextChange={onTextChange}
          placeholder={placeholder}
        />
        <Text className="absolute bottom-1 right-0 text-[15px] leading-5 text-primary-content">
          {characterCount}
        </Text>
      </View>
    </View>
  );
}

type ShortNoteToolbarProps = {
  activePanel: ComposerPanel | null;
  contentWarning: boolean;
  onContentWarningPress: () => void;
  onGifPress: () => void;
  onInsertImage: (
    uri: string,
    width: number,
    height: number,
    mimeType?: string | null,
    fileName?: string | null,
  ) => void;
  onMediaPress: () => void;
};

export function ShortNoteToolbar({
  activePanel,
  contentWarning,
  onContentWarningPress,
  onGifPress,
  onInsertImage,
  onMediaPress,
}: ShortNoteToolbarProps) {
  const theme = useAppTheme();
  const inactiveIconColor = theme.colors.primaryContent;
  const actionIconColor = '#4b87ff';
  const insertAsset = useCallback(
    (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) return;
      const width = Math.max(1, Math.round(asset.width || 320));
      const height = Math.max(1, Math.round(asset.height || 240));
      onInsertImage(asset.uri, width, height, asset.mimeType, asset.fileName);
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

    if (result.canceled) return;
    const [asset] = result.assets;
    if (asset) insertAsset(asset);
  }, [insertAsset]);

  return (
    <View className="min-h-[73px] flex-row items-center gap-3 border-t border-base-content/20 bg-base-100 px-[18px]">
      <ToolbarButton
        accessibilityLabel="Add media"
        icon={<ImageIcon size={25} color={actionIconColor} strokeWidth={2.1} />}
        onPress={onMediaPress}
      />
      <ToolbarButton
        accessibilityLabel="Add GIF"
        active={activePanel === 'gif'}
        icon={
          <View className="h-[20px] min-w-[28px] items-center justify-center rounded-[4px] border-2 border-[#4b87ff] px-1">
            <Text className="text-[10px] font-extrabold leading-3 text-[#4b87ff]">
              GIF
            </Text>
          </View>
        }
        onPress={onGifPress}
      />
      <ToolbarButton
        accessibilityLabel="Open camera"
        icon={<Camera size={25} color={inactiveIconColor} strokeWidth={2.1} />}
        onPress={takePhoto}
      />
      <ToolbarButton
        accessibilityLabel={
          contentWarning ? 'Remove content warning' : 'Add content warning'
        }
        active={contentWarning}
        icon={
          <TriangleAlert
            size={25}
            color={contentWarning ? actionIconColor : inactiveIconColor}
            strokeWidth={2.1}
          />
        }
        onPress={onContentWarningPress}
      />
    </View>
  );
}

function ToolbarButton({
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
      className="h-[46px] w-[46px] items-center justify-center rounded-full border border-base-content/25 bg-base-300"
      hitSlop={6}
      style={({ pressed }) => pressed && styles.toolbarButtonPressed}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbarButtonPressed: {
    opacity: 0.72,
  },
});
