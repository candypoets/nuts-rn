import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
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
  Image as ImageIcon,
  Italic,
  List,
  ListChecks,
  Plus,
  Send,
  X,
} from 'lucide-react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
} from 'react-native-enriched';
import * as ImagePicker from 'expo-image-picker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asKind0,
  asParsedEvent,
  fbArray,
  isConnectionStatus,
  isKind0,
} from '@candypoets/nipworker/utils';
import {MessageType} from '@candypoets/nipworker';
import type {
  ConnectionStatus,
  Kind0Parsed,
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import type { EventTemplate } from 'nostr-tools';
import { decode, nprofileEncode } from 'nostr-tools/nip19';

import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { prepareEvent } from '../nostr/prepareEvent';
import {
  DEFAULT_UPLOAD_SERVER,
  uploadFile,
  type LocalUploadAsset,
} from '../nostr/upload';
import {
  selectPreferredUploadServer,
  SEARCH_RELAYS,
  useAuthStore,
  useNostrStore,
  useSendStatusStore,
} from '../stores';
import { Note } from '../components/notes/Note';
import { useKind0Value } from '../hooks/useKind0Value';

type Props = {
  reply?: string;
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
type SelectedMention = {
  name: string;
  handle: string;
  pubkey: string;
  relays: string[];
};

const now = () => Math.floor(Date.now() / 1000);
const fallbackProfileImage = require('../../assets/miss-profile.png');

function mentionHandle(value: string) {
  return value.replace(/\s+/g, '');
}

function mentionEventName(event: ParsedEvent) {
  const kind0 = asKind0(event);
  return (
    kind0?.name?.()?.trim() ||
    kind0?.displayName?.()?.trim() ||
    event.pubkey()?.slice(0, 12) ||
    'Unknown'
  );
}

function kind0DisplayName(kind0: Kind0Parsed, pubkey: string) {
  return (
    kind0.displayName?.()?.trim() ||
    kind0.name?.()?.trim() ||
    `${pubkey.slice(0, 8)}...`
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textWithNostrMentions(
  value: string,
  mentions: SelectedMention[],
) {
  let next = value;
  for (const mention of mentions) {
    const handle = mentionHandle(mention.handle);
    const nprofile = nprofileEncode({
      pubkey: mention.pubkey,
      relays: mention.relays,
    });
    next = next.replace(
      new RegExp(`@${escapeRegExp(handle)}\\b`, 'g'),
      `nostr:${nprofile}`,
    );
  }
  return next;
}

function mentionScore(
  event: ParsedEvent,
  searchQuery: string,
  cachedPubkeys: Set<string>,
) {
  const name = mentionEventName(event);
  if (!name || !searchQuery) return 0;
  const lowerName = name.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  let score = 0;
  if (lowerName === lowerQuery) score = 3;
  if (lowerName.startsWith(lowerQuery)) score = 2;
  if (lowerName.includes(lowerQuery)) score = 1;
  if (cachedPubkeys.has(event.pubkey() || '')) score += 3;
  return score;
}

function sortMentionEvents(
  events: ParsedEvent[],
  query: string,
  cachedPubkeys: Set<string>,
  descending = true,
) {
  const unique = new Map<string, ParsedEvent>();
  for (const event of events) {
    const pubkey = event.pubkey();
    if (pubkey && !unique.has(pubkey)) unique.set(pubkey, event);
  }
  return [...unique.values()].sort((left, right) => {
    const delta =
      mentionScore(right, query, cachedPubkeys) -
      mentionScore(left, query, cachedPubkeys);
    return descending ? delta : -delta;
  });
}

function decodeReplyTarget(reply?: string) {
  if (!reply) return null;

  try {
    const decoded = decode(reply);
    if (decoded.type === 'nevent') {
      return {
        id: decoded.data.id,
        author: decoded.data.author,
        kind: decoded.data.kind,
        relays: decoded.data.relays ?? [],
      };
    }
  } catch {
    // Plain hex ids are accepted for internal callers and tests.
  }

  return { id: reply, relays: [] as string[] };
}

export function PostModal({ reply, onClose }: Props) {
  const editorRef = useRef<EnrichedTextInputInstance>(null);
  const scrollRef = useRef<ScrollView>(null);
  const editorYRef = useRef(0);
  const editorHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const mentionSearchUnsubscribeRef = useRef<(() => void) | null>(null);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const readRelays = useNostrStore(state => state.readRelays);
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
  const [replyNote, setReplyNote] = useState<ParsedEvent | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<ParsedEvent[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionFinished, setMentionFinished] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const keyboardAccessoryBottom = useSharedValue(0);
  const replyTarget = useMemo(() => decodeReplyTarget(reply), [reply]);
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );
  const lookupRelays = useMemo(
    () => [
      ...new Set([
        ...(replyTarget?.relays ?? []),
        ...readRelays,
        ...writeRelays,
        ...DEFAULT_FEED_RELAYS,
      ]),
    ],
    [readRelays, replyTarget, writeRelays],
  );
  const mediaServerType = uploadPreference?.type || 'blossom';
  const mediaServer = uploadPreference?.servers[0] || DEFAULT_UPLOAD_SERVER;
  const validPollOptions = useMemo(
    () => pollOptions.map(option => option.trim()).filter(Boolean),
    [pollOptions],
  );
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null || !mentionQuery.trim()) return [];
    const query = mentionQuery.trim().toLowerCase();
    return sortMentionEvents(
      mentionResults.filter(event => {
        const name = mentionEventName(event).toLowerCase();
        const candidatePubkey = event.pubkey()?.toLowerCase() || '';
        return (
          name.includes(query) ||
          mentionHandle(name).includes(query) ||
          candidatePubkey.includes(query)
        );
      }),
      query,
      new Set(),
    ).slice(0, 4);
  }, [mentionQuery, mentionResults]);
  const showMentionPanel = Boolean(
    mentionQuery?.trim() &&
      (mentionLoading || mentionFinished || mentionSuggestions.length),
  );
  const replyAuthorPubkey = replyNote?.pubkey() || '';
  const replyAuthorFallback = replyAuthorPubkey
    ? `${replyAuthorPubkey.slice(0, 8)}...`
    : '';
  const selectReplyAuthorName = useCallback(
    (profile: Kind0Parsed) => kind0DisplayName(profile, replyAuthorPubkey),
    [replyAuthorPubkey],
  );
  const replyAuthorName = useKind0Value(replyAuthorPubkey, {
    enabled: Boolean(replyAuthorPubkey),
    fallback: replyAuthorFallback,
    selector: selectReplyAuthorName,
  });
  const canSubmit =
    Boolean(pubkey && hasSigner) &&
    !isSubmitting &&
    Boolean(
      text.trim() ||
        selectedImages.length ||
        (pollEnabled && validPollOptions.length >= 2),
    );

  const scrollToComposer = useCallback(() => {
    if (!replyTarget?.id) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, editorYRef.current - 12),
        animated: true,
      });
      editorRef.current?.focus();
    });
  }, [replyTarget]);

  const blurComposer = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const blurComposerWhenTouchingOutsideEditor = useCallback(
    (event: NativeSyntheticEvent<{ locationY: number }>) => {
      const touchY = event.nativeEvent.locationY + scrollOffsetRef.current;
      const editorTop = editorYRef.current;
      const editorBottom = editorTop + editorHeightRef.current;
      if (touchY < editorTop || touchY > editorBottom) {
        blurComposer();
      }
    },
    [blurComposer],
  );

  useEffect(() => {
    const keyboardShowEvent =
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const keyboardHideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const keyboardShow = Keyboard.addListener(keyboardShowEvent, event => {
      const height = Math.max(0, event.endCoordinates.height);
      setKeyboardOpen(true);
      keyboardAccessoryBottom.value = withTiming(height, {
        duration: Math.max(1, event.duration || 250),
      });
    });
    const keyboardHide = Keyboard.addListener(keyboardHideEvent, event => {
      keyboardAccessoryBottom.value = withTiming(
        0,
        {duration: Math.max(1, event.duration || 250)},
        finished => {
          if (finished) runOnJS(setKeyboardOpen)(false);
        },
      );
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, [keyboardAccessoryBottom]);

  const keyboardAccessoryStyle = useAnimatedStyle(() => ({
    bottom: keyboardAccessoryBottom.value,
  }));

  useEffect(() => {
    setReplyNote(null);
    if (!replyTarget?.id) return undefined;

    const request: RequestObject[] = [
      {
        ids: [replyTarget.id],
        limit: 1,
        relays: lookupRelays,
        cacheFirst: true,
      },
    ];

    return subscribeToNostr(
      `post_${replyTarget.id}_${lookupRelays.join('|')}`,
      request,
      (message: WorkerMessage) => {
        const event = asParsedEvent(message);
        if (event?.id() === replyTarget.id) {
          setReplyNote(event);
        }
      },
    );
  }, [lookupRelays, replyTarget]);

  useEffect(() => {
    const query = mentionQuery?.trim();
    if (!query) {
      setMentionResults([]);
      setMentionLoading(false);
      setMentionFinished(false);
      return undefined;
    }

    mentionSearchUnsubscribeRef.current?.();
    setMentionResults([]);
    setMentionLoading(true);
    setMentionFinished(false);

    const cachedEvents: ParsedEvent[] = [];
    const fetchedEvents: ParsedEvent[] = [];
    const items: ParsedEvent[] = [];
    const cachedPubkeys = new Set<string>();
    let eose = false;
    let eoce = false;

    const updateItems = (
      events: ParsedEvent[],
      descending = true,
    ) => {
      setMentionResults(sortMentionEvents(events, query, cachedPubkeys, descending));
    };

    const unsubscribe = subscribeToNostr(
      `mentionlist_${query}`,
      [
        {
          kinds: [0],
          search: query,
          limit: 10,
          relays: SEARCH_RELAYS,
          noCache: true,
        },
      ],
      (message: WorkerMessage) => {
        switch (message.type()) {
          case MessageType.ConnectionStatus:
            setMentionLoading(false);
            setMentionFinished(true);
            eose = true;
            updateItems([...cachedEvents, ...fetchedEvents, ...items]);
            break;
          case MessageType.Eoce:
            eoce = true;
            updateItems(
              [...cachedEvents, ...fetchedEvents, ...items],
              false,
            );
            break;
          case MessageType.ParsedNostrEvent: {
            const kind0 = isKind0(message);
            if (!kind0) return;
            const event = asParsedEvent(message);
            const candidatePubkey = event?.pubkey();
            if (!event || !candidatePubkey) return;
            if (!eoce) {
              cachedPubkeys.add(candidatePubkey);
              cachedEvents.unshift(event);
            } else if (!eose) {
              fetchedEvents.unshift(event);
            } else {
              items.unshift(event);
              updateItems(items);
            }
            break;
          }
        }
      },
    );
    mentionSearchUnsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      if (mentionSearchUnsubscribeRef.current === unsubscribe) {
        mentionSearchUnsubscribeRef.current = null;
      }
    };
  }, [mentionQuery]);

  useEffect(() => {
    if (!replyTarget?.id) return;
    const timeout = setTimeout(scrollToComposer, 120);
    return () => clearTimeout(timeout);
  }, [replyNote, replyTarget, scrollToComposer]);

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

  const selectMention = useCallback((event: ParsedEvent) => {
    const candidatePubkey = event.pubkey();
    if (!candidatePubkey) return;
    const name = mentionEventName(event);
    const handle = mentionHandle(name);
    editorRef.current?.setMention('@', `@${handle}`, {
      name,
      pubkey: candidatePubkey,
      relays: SEARCH_RELAYS.join(','),
    });
    setSelectedMentions(current =>
      current.some(mention => mention.pubkey === candidatePubkey)
        ? current
        : [
            ...current,
            {name, handle, pubkey: candidatePubkey, relays: SEARCH_RELAYS},
          ],
    );
    setMentionQuery(null);
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
      let baseTags: string[][] = [];
      if (replyTarget?.id && replyNote) {
        baseTags = fbArray(replyNote, 'tags').map(tag =>
          fbArray(tag, 'items').map(item => String(item)),
        );
      }
      const content = [
        textWithNostrMentions(text.trim(), selectedMentions),
        ...uploadedImages.map(image => image.uploadUrl).filter(Boolean),
      ]
        .filter(Boolean)
        .join('\n\n');
      let event: EventTemplate & { id?: string } = {
        kind: pollEnabled ? 1068 : 1,
        content,
        created_at: now(),
        tags: baseTags,
      };
      if (replyTarget?.id && replyNote) {
        event.id = replyTarget.id;
      }

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

      const sendId = `${pollEnabled ? 'poll' : reply ? 'reply' : 'post'}_${Date.now()}`;
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
        {
          defaultRelays: relays,
          trackStatus: true,
          subId: replyTarget?.id
            ? [`f_${replyTarget.id}`, `replies_${replyTarget.id}`]
            : undefined,
        },
      );

      editorRef.current?.setValue('');
      setText('');
      setSelectedMentions([]);
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
    reply,
    replyNote,
    replyTarget,
    relays,
    text,
    updateSendStatus,
    validPollOptions,
    selectedImages,
    selectedMentions,
    mediaServer,
    mediaServerType,
  ]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} hitSlop={12} onPress={onClose}>
          <ChevronDown size={23} color="#17212b" strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {reply ? 'Reply' : 'New post'}
        </Text>
        <Pressable
          style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={styles.submitText}>
            {isSubmitting
              ? 'Signing'
              : pollEnabled
                ? 'Poll'
                : reply
                  ? 'Reply'
                  : 'Post'}
          </Text>
          <Send size={16} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          keyboardOpen && styles.contentWithKeyboardAccessory,
        ]}
        onScroll={event => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        onTouchStart={blurComposerWhenTouchingOutsideEditor}
        scrollEventThrottle={16}
      >
        {!pubkey || !hasSigner ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Connect a signer before publishing posts.
            </Text>
          </View>
        ) : null}

        {replyTarget?.id ? (
          replyNote ? (
            <Note
              note={replyNote}
              context={[replyNote]}
              visible
              footer={false}
              main
              disableOpen
              showQuote={false}
              showMedia={false}
              showRoot={false}
              depth={0}
            />
          ) : (
            <View style={styles.replyLoading}>
              <Text style={styles.replyLoadingText}>Loading note...</Text>
            </View>
          )
        ) : null}

        <View
          style={[styles.editorShell, reply && styles.replyEditorShell]}
          onLayout={event => {
            editorYRef.current = event.nativeEvent.layout.y;
            editorHeightRef.current = event.nativeEvent.layout.height;
          }}
        >
          <EnrichedTextInput
            ref={editorRef}
            autoFocus
            autoCapitalize="sentences"
            mentionIndicators={['@']}
            placeholder={
              reply
                ? replyNote
                  ? `Reply to ${replyAuthorName}`
                  : 'Write your reply...'
                : "What's up?"
            }
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
            onStartMention={indicator => {
              if (indicator === '@') setMentionQuery('');
            }}
            onChangeMention={event => {
              if (event.indicator === '@') setMentionQuery(event.text);
            }}
            onEndMention={indicator => {
              if (indicator === '@') setMentionQuery(null);
            }}
            onPasteImages={event => {
              console.log('[post] pasted images', event.nativeEvent);
            }}
            htmlStyle={editorHtmlStyle}
            style={reply ? styles.replyEditor : styles.editor}
          />
        </View>

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

      {keyboardOpen ? (
        <Animated.View
          style={[
            styles.toolbarAccessory,
            styles.keyboardAccessory,
            keyboardAccessoryStyle,
          ]}
        >
          {showMentionPanel ? (
            <MentionSuggestions
              candidates={mentionSuggestions}
              loading={mentionLoading}
              finished={mentionFinished}
              onSelect={selectMention}
            />
          ) : null}
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
            onDismissKeyboard={blurComposer}
          />
        </Animated.View>
      ) : null}
    </View>
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

function MentionSuggestions({
  candidates,
  loading,
  finished,
  onSelect,
}: {
  candidates: ParsedEvent[];
  loading: boolean;
  finished: boolean;
  onSelect: (candidate: ParsedEvent) => void;
}) {
  return (
    <View style={styles.mentionBox}>
      {loading ? (
        <View style={styles.mentionStateRow}>
          <Text style={styles.mentionStateText}>Searching...</Text>
        </View>
      ) : null}
      {candidates.length ? (
        candidates.map(candidate => {
          const pubkey = candidate.pubkey() || '';
          const kind0 = asKind0(candidate);
          const name = mentionEventName(candidate);
          const handle = mentionHandle(name);
          const picture = kind0?.picture?.();
          return (
            <Pressable
              key={pubkey}
              style={styles.mentionRow}
              onPress={() => onSelect(candidate)}
            >
              <View style={styles.mentionAvatar}>
                <Image
                  source={picture ? {uri: picture} : fallbackProfileImage}
                  style={styles.mentionAvatarImage}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.mentionTextBlock}>
                <Text style={styles.mentionName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.mentionHandle} numberOfLines={1}>
                  @{handle}
                </Text>
              </View>
            </Pressable>
          );
        })
      ) : finished && !loading ? (
        <View style={styles.mentionStateRow}>
          <Text style={styles.mentionStateText}>
            No matching profiles found
          </Text>
        </View>
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
  onDismissKeyboard,
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
  onDismissKeyboard: () => void;
}) {
  const pickImage = useCallback(async () => {
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
        icon={<ImageIcon size={19} color="#52616f" />}
        onPress={pickImage}
      />
      <ToolbarButton
        active={pollEnabled}
        icon={
          <ListChecks size={18} color={pollEnabled ? '#ffffff' : '#52616f'} />
        }
        onPress={onTogglePoll}
      />
      <ToolbarDivider />
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
        icon={<ChevronDown size={20} color="#52616f" strokeWidth={2.3} />}
        onPress={onDismissKeyboard}
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
  contentWithKeyboardAccessory: {
    paddingBottom: 86,
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
  replyLoading: {
    minHeight: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyLoadingText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
  },
  editorShell: {
    minHeight: 190,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  replyEditorShell: {
    minHeight: 104,
  },
  editor: {
    minHeight: 190,
    padding: 14,
    fontSize: 17,
    lineHeight: 24,
    color: '#17212b',
  },
  replyEditor: {
    minHeight: 104,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 22,
    color: '#17212b',
  },
  mentionBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ea',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  mentionRow: {
    minHeight: 54,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  mentionStateRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionStateText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  mentionAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ccfbf1',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mentionAvatarImage: {
    width: '100%',
    height: '100%',
  },
  mentionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  mentionName: {
    color: '#17212b',
    fontSize: 14,
    fontWeight: '700',
  },
  mentionHandle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  toolbar: {
    minHeight: 54,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  toolbarAccessory: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  keyboardAccessory: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  toolbarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
