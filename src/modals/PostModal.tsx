import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  AlignLeft,
  Bold,
  ChevronDown,
  Code2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Plus,
  Send,
  Square,
  Strikethrough,
  X,
} from 'lucide-react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
} from 'react-native-enriched';
import { usePublish as publishToNostr } from '@candypoets/nipworker/hooks';
import { isConnectionStatus } from '@candypoets/nipworker/utils';
import type { ConnectionStatus, WorkerMessage } from '@candypoets/nipworker';
import type { EventTemplate } from 'nostr-tools';

import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { prepareEvent } from '../nostr/prepareEvent';
import {
  DEFAULT_UPLOAD_SERVER,
  uploadFile,
  type LocalUploadAsset,
} from '../nostr/upload';
import {
  selectPreferredUploadServer,
  useAuthStore,
  useNostrStore,
  useSendStatusStore,
} from '../stores';

type Props = {
  onClose: () => void;
};

type PollType = 'singlechoice' | 'multiplechoice';
type StyleState = {
  bold?: { isActive: boolean; isBlocking: boolean };
  italic?: { isActive: boolean; isBlocking: boolean };
  strikeThrough?: { isActive: boolean; isBlocking: boolean };
  inlineCode?: { isActive: boolean; isBlocking: boolean };
  unorderedList?: { isActive: boolean; isBlocking: boolean };
  orderedList?: { isActive: boolean; isBlocking: boolean };
  blockQuote?: { isActive: boolean; isBlocking: boolean };
};
type SelectedImage = LocalUploadAsset & {
  uploadUrl?: string;
  status: 'waiting' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
};

const now = () => Math.floor(Date.now() / 1000);

export function PostModal({ onClose }: Props) {
  const editorRef = useRef<EnrichedTextInputInstance>(null);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const uploadPreference = useNostrStore(selectPreferredUploadServer);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [text, setText] = useState('');
  const [htmlPreview, setHtmlPreview] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [styleState, setStyleState] = useState<StyleState>({});
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollType, setPollType] = useState<PollType>('singlechoice');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollEndsAt, setPollEndsAt] = useState<number | null>(null);
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );
  const mediaServerType = uploadPreference?.type || 'blossom';
  const mediaServer = uploadPreference?.servers[0] || DEFAULT_UPLOAD_SERVER;
  const validPollOptions = useMemo(
    () => pollOptions.map(option => option.trim()).filter(Boolean),
    [pollOptions],
  );
  const canSubmit =
    Boolean(pubkey && hasSigner) &&
    !isSubmitting &&
    Boolean(
      text.trim() ||
        selectedImages.length ||
        (pollEnabled && validPollOptions.length >= 2),
    );

  const updatePollOption = useCallback((index: number, value: string) => {
    setPollOptions(current =>
      current.map((option, currentIndex) =>
        currentIndex === index ? value : option,
      ),
    );
  }, []);

  const removePollOption = useCallback((index: number) => {
    setPollOptions(current =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  }, []);

  const addPollOption = useCallback(() => {
    setPollOptions(current =>
      current.length >= 10 ? current : [...current, ''],
    );
  }, []);

  const togglePoll = useCallback(() => {
    setPollEnabled(current => {
      if (current) {
        setPollType('singlechoice');
        setPollOptions(['', '']);
        setPollEndsAt(null);
      }
      return !current;
    });
  }, []);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      setSubmitStatus(
        selectedImages.length
          ? `Uploading ${selectedImages.length} image${
              selectedImages.length === 1 ? '' : 's'
            } to ${mediaServer}...`
          : 'Preparing event...',
      );
      const html = await editorRef.current?.getHTML();
      setHtmlPreview(typeof html === 'string' ? html : null);
      const uploadedImages: SelectedImage[] = [];

      for (const image of selectedImages) {
        setSelectedImages(current =>
          current.map(item =>
            item.uri === image.uri ? { ...item, status: 'uploading' } : item,
          ),
        );

        try {
          const result = await uploadFile(image, {
            server: mediaServer,
            serverType: mediaServerType,
          });
          const uploaded = {
            ...image,
            status: 'uploaded' as const,
            uploadUrl: result.url,
          };
          uploadedImages.push(uploaded);
          setSelectedImages(current =>
            current.map(item => (item.uri === image.uri ? uploaded : item)),
          );
        } catch (error) {
          const failed = {
            ...image,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Upload failed',
          };
          setSelectedImages(current =>
            current.map(item => (item.uri === image.uri ? failed : item)),
          );
          setSubmitStatus(failed.error);
          return;
        }
      }

      setSubmitStatus('Publishing post...');
      const baseTags: string[][] = [];
      const content = [
        text.trim(),
        ...uploadedImages.map(image => image.uploadUrl).filter(Boolean),
      ]
        .filter(Boolean)
        .join('\n\n');
      let event: EventTemplate = {
        kind: pollEnabled ? 1068 : 1,
        content,
        created_at: now(),
        tags: baseTags,
      };

      event = prepareEvent(event);

      if (pollEnabled) {
        event.tags = [
          ...event.tags,
          ['polltype', pollType],
          ...validPollOptions.map((option, index) => [
            'option',
            String(index),
            option,
          ]),
          ...(pollEndsAt ? [['endsAt', String(pollEndsAt)]] : []),
        ];
      }

      const sendId = `${pollEnabled ? 'poll' : 'post'}_${Date.now()}`;
      const sendStatus: Record<string, ConnectionStatus> = {};

      publishToNostr(
        sendId,
        event,
        (message: WorkerMessage) => {
          const status = isConnectionStatus(message);
          const relayUrl = status?.relayUrl();
          if (!status || !relayUrl) return;
          sendStatus[relayUrl] = status;
          updateSendStatus(sendId, sendStatus);
        },
        { defaultRelays: relays, trackStatus: true },
      );

      editorRef.current?.setValue('');
      setText('');
      setSelectedImages([]);
      setSubmitStatus(null);
      setPollEnabled(false);
      setPollOptions(['', '']);
      setPollType('singlechoice');
      setPollEndsAt(null);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    onClose,
    pollEnabled,
    pollEndsAt,
    pollType,
    relays,
    text,
    updateSendStatus,
    validPollOptions,
    selectedImages,
    mediaServer,
    mediaServerType,
  ]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <View style={styles.header}>
        <Pressable style={styles.iconButton} hitSlop={12} onPress={onClose}>
          <ChevronDown size={23} color="#17212b" strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.headerTitle}>New post</Text>
        <Pressable
          style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={styles.submitText}>
            {isSubmitting ? 'Signing' : pollEnabled ? 'Poll' : 'Post'}
          </Text>
          <Send size={16} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {!pubkey || !hasSigner ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Connect a signer before publishing posts.
            </Text>
          </View>
        ) : null}

        <View style={styles.editorShell}>
          <EnrichedTextInput
            ref={editorRef}
            autoFocus
            autoCapitalize="sentences"
            mentionIndicators={['@']}
            placeholder="What's up?"
            placeholderTextColor="#8794a0"
            selectionColor="#158777"
            cursorColor="#158777"
            linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
            onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
              setText(event.nativeEvent.value)
            }
            onChangeState={(event: NativeSyntheticEvent<StyleState>) =>
              setStyleState(event.nativeEvent)
            }
            onPasteImages={event => {
              console.log('[post] pasted images', event.nativeEvent);
            }}
            htmlStyle={editorHtmlStyle}
            style={styles.editor}
          />
        </View>

        <ComposerToolbar
          editorRef={editorRef}
          onInsertImage={(uri, width, height, mimeType, fileName) => {
            editorRef.current?.setImage(uri, width, height);
            setSelectedImages(current =>
              current.some(image => image.uri === uri)
                ? current
                : [
                    ...current,
                    {
                      uri,
                      width,
                      height,
                      mimeType,
                      fileName,
                      status: 'waiting',
                    },
                  ],
            );
          }}
          styleState={styleState}
          pollEnabled={pollEnabled}
          onTogglePoll={togglePoll}
        />

        {selectedImages.length ? (
          <UploadStatus
            images={selectedImages}
            mediaServer={mediaServer}
            mediaServerType={mediaServerType}
            submitStatus={submitStatus}
          />
        ) : null}

        {pollEnabled ? (
          <PollComposer
            endsAt={pollEndsAt}
            options={pollOptions}
            pollType={pollType}
            setEndsAt={setPollEndsAt}
            setPollType={setPollType}
            addOption={addPollOption}
            removeOption={removePollOption}
            updateOption={updatePollOption}
          />
        ) : null}

        {htmlPreview ? (
          <Text style={styles.debugHtml} numberOfLines={2}>
            {htmlPreview}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function UploadStatus({
  images,
  mediaServer,
  mediaServerType,
  submitStatus,
}: {
  images: SelectedImage[];
  mediaServer: string;
  mediaServerType: 'blossom' | 'nip96';
  submitStatus: string | null;
}) {
  return (
    <View style={styles.uploadBox}>
      <Text style={styles.uploadTitle}>Media server</Text>
      <Text style={styles.uploadServer} numberOfLines={1}>
        {mediaServerType === 'blossom' ? 'Blossom' : 'NIP-96'} - {mediaServer}
      </Text>
      {images.map((image, index) => (
        <Text
          key={image.uri}
          style={[
            styles.uploadLine,
            image.status === 'failed' && styles.uploadError,
          ]}
          numberOfLines={2}
        >
          Image {index + 1}: {image.status}
          {image.uploadUrl ? ` - ${image.uploadUrl}` : ''}
          {image.error ? ` - ${image.error}` : ''}
        </Text>
      ))}
      {submitStatus ? (
        <Text style={styles.uploadLine}>{submitStatus}</Text>
      ) : null}
    </View>
  );
}

function ComposerToolbar({
  editorRef,
  onInsertImage,
  styleState,
  pollEnabled,
  onTogglePoll,
}: {
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  onInsertImage: (
    uri: string,
    width: number,
    height: number,
    mimeType?: string | null,
    fileName?: string | null,
  ) => void;
  styleState: StyleState;
  pollEnabled: boolean;
  onTogglePoll: () => void;
}) {
  const pickImage = useCallback(async () => {
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch (error) {
      console.warn('[post] image picker unavailable', error);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.92,
    });

    if (result.canceled) return;

    for (const asset of result.assets) {
      if (!asset.uri) continue;
      const width = Math.max(1, Math.round(asset.width || 320));
      const height = Math.max(1, Math.round(asset.height || 240));
      onInsertImage(asset.uri, width, height, asset.mimeType, asset.fileName);
    }
  }, [onInsertImage]);

  return (
    <View style={styles.toolbar}>
      <ToolbarButton
        active={styleState.bold?.isActive}
        disabled={styleState.bold?.isBlocking}
        icon={
          <Bold
            size={19}
            color={styleState.bold?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleBold()}
      />
      <ToolbarButton
        active={styleState.italic?.isActive}
        disabled={styleState.italic?.isBlocking}
        icon={
          <Italic
            size={19}
            color={styleState.italic?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleItalic()}
      />
      <ToolbarButton
        active={styleState.strikeThrough?.isActive}
        disabled={styleState.strikeThrough?.isBlocking}
        icon={
          <Strikethrough
            size={18}
            color={styleState.strikeThrough?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleStrikeThrough()}
      />
      <ToolbarButton
        active={styleState.inlineCode?.isActive}
        disabled={styleState.inlineCode?.isBlocking}
        icon={
          <Code2
            size={18}
            color={styleState.inlineCode?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleInlineCode()}
      />
      <ToolbarDivider />
      <ToolbarButton
        active={styleState.unorderedList?.isActive}
        disabled={styleState.unorderedList?.isBlocking}
        icon={
          <List
            size={19}
            color={styleState.unorderedList?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleUnorderedList()}
      />
      <ToolbarButton
        active={styleState.orderedList?.isActive}
        disabled={styleState.orderedList?.isBlocking}
        icon={
          <ListOrdered
            size={19}
            color={styleState.orderedList?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleOrderedList()}
      />
      <ToolbarButton
        active={styleState.blockQuote?.isActive}
        disabled={styleState.blockQuote?.isBlocking}
        icon={
          <AlignLeft
            size={18}
            color={styleState.blockQuote?.isActive ? '#ffffff' : '#52616f'}
          />
        }
        onPress={() => editorRef.current?.toggleBlockQuote()}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<ImageIcon size={18} color="#52616f" />}
        onPress={pickImage}
      />
      <ToolbarButton
        active={pollEnabled}
        icon={<Square size={17} color={pollEnabled ? '#ffffff' : '#52616f'} />}
        onPress={onTogglePoll}
      />
    </View>
  );
}

function ToolbarButton({
  active = false,
  disabled = false,
  icon,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.toolbarButton,
        active && styles.toolbarButtonActive,
        disabled && styles.toolbarButtonDisabled,
      ]}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}

function ToolbarDivider() {
  return <View style={styles.toolbarDivider} />;
}

function PollComposer({
  endsAt,
  options,
  pollType,
  setEndsAt,
  setPollType,
  addOption,
  removeOption,
  updateOption,
}: {
  endsAt: number | null;
  options: string[];
  pollType: PollType;
  setEndsAt: (value: number | null) => void;
  setPollType: (value: PollType) => void;
  addOption: () => void;
  removeOption: (index: number) => void;
  updateOption: (index: number, value: string) => void;
}) {
  const setDuration = useCallback(
    (days: number) => setEndsAt(now() + days * 24 * 60 * 60),
    [setEndsAt],
  );

  return (
    <View style={styles.pollBox}>
      <View style={styles.segmented}>
        <Pressable
          style={[
            styles.segment,
            pollType === 'singlechoice' && styles.segmentActive,
          ]}
          onPress={() => setPollType('singlechoice')}
        >
          <Text
            style={[
              styles.segmentText,
              pollType === 'singlechoice' && styles.segmentTextActive,
            ]}
          >
            Single
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.segment,
            pollType === 'multiplechoice' && styles.segmentActive,
          ]}
          onPress={() => setPollType('multiplechoice')}
        >
          <Text
            style={[
              styles.segmentText,
              pollType === 'multiplechoice' && styles.segmentTextActive,
            ]}
          >
            Multiple
          </Text>
        </Pressable>
      </View>

      {options.map((option, index) => (
        <View key={index} style={styles.pollOptionRow}>
          <TextInput
            style={styles.pollInput}
            placeholder={`Option ${index + 1}`}
            placeholderTextColor="#8794a0"
            value={option}
            onChangeText={value => updateOption(index, value)}
          />
          {options.length > 2 ? (
            <Pressable
              style={styles.pollRemove}
              hitSlop={8}
              onPress={() => removeOption(index)}
            >
              <X size={17} color="#8794a0" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.pollFooter}>
        {options.length < 10 ? (
          <Pressable style={styles.addOption} onPress={addOption}>
            <Plus size={16} color="#52616f" strokeWidth={2.3} />
            <Text style={styles.addOptionText}>Add option</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.durationButtons}>
          {[1, 3, 7].map(days => (
            <Pressable
              key={days}
              style={[
                styles.durationButton,
                endsAt !== null &&
                  Math.ceil((endsAt - now()) / (24 * 60 * 60)) === days &&
                  styles.durationButtonActive,
              ]}
              onPress={() => setDuration(days)}
            >
              <Text style={styles.durationText}>{days}d</Text>
            </Pressable>
          ))}
          {endsAt ? (
            <Pressable
              style={styles.durationButton}
              onPress={() => setEndsAt(null)}
            >
              <X size={14} color="#52616f" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const editorHtmlStyle = {
  a: { color: '#158777', textDecorationLine: 'none' as const },
  mention: {
    color: '#0f766e',
    backgroundColor: '#ccfbf1',
    textDecorationLine: 'none' as const,
  },
  code: { color: '#334155', backgroundColor: '#e2e8f0' },
  blockquote: { borderColor: '#94a3b8', borderWidth: 3, gapWidth: 10 },
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cbd5e1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#17212b',
  },
  submitButton: {
    minWidth: 82,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: '#158777',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  submitDisabled: {
    backgroundColor: '#cbd5e1',
  },
  submitText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  notice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    padding: 12,
  },
  noticeText: {
    color: '#92400e',
    fontSize: 14,
  },
  editorShell: {
    minHeight: 190,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  editor: {
    minHeight: 190,
    padding: 14,
    fontSize: 17,
    lineHeight: 24,
    color: '#17212b',
  },
  toolbar: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toolbarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarButtonActive: {
    backgroundColor: '#158777',
  },
  toolbarButtonDisabled: {
    opacity: 0.35,
  },
  toolbarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: '#cbd5e1',
    marginHorizontal: 4,
  },
  uploadBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ea',
    backgroundColor: '#ffffff',
    padding: 12,
    gap: 4,
  },
  uploadTitle: {
    color: '#17212b',
    fontSize: 13,
    fontWeight: '700',
  },
  uploadServer: {
    color: '#158777',
    fontSize: 13,
    fontWeight: '600',
  },
  uploadLine: {
    color: '#52616f',
    fontSize: 12,
    lineHeight: 17,
  },
  uploadError: {
    color: '#b91c1c',
  },
  pollBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ea',
    backgroundColor: '#ffffff',
    padding: 12,
    gap: 10,
  },
  segmented: {
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eef2f7',
    padding: 3,
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  segmentText: {
    color: '#52616f',
    fontWeight: '700',
    fontSize: 13,
  },
  segmentTextActive: {
    color: '#17212b',
  },
  pollOptionRow: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  pollInput: {
    flex: 1,
    minHeight: 42,
    color: '#17212b',
    fontSize: 15,
  },
  pollRemove: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  addOption: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addOptionText: {
    color: '#52616f',
    fontWeight: '700',
    fontSize: 13,
  },
  durationButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  durationButton: {
    minWidth: 34,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationButtonActive: {
    backgroundColor: '#ccfbf1',
  },
  durationText: {
    color: '#52616f',
    fontWeight: '700',
    fontSize: 12,
  },
  debugHtml: {
    color: '#94a3b8',
    fontSize: 11,
  },
});
