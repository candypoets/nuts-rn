import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  MenuView,
  type MenuAction,
  type NativeActionEvent,
} from '@react-native-menu/menu';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Globe,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Send,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
  useKeyboardState,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { type EnrichedTextInputInstance } from 'react-native-enriched';
import * as ImagePicker from 'expo-image-picker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {
  asParsedEvent,
  fbArray,
  isConnectionStatus,
  isKind0,
} from '@candypoets/nipworker/utils';
import { MessageType } from '@candypoets/nipworker';
import type {
  ConnectionStatus,
  Kind0Parsed,
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import { nip10, type EventTemplate } from 'nostr-tools';
import { neventEncode } from 'nostr-tools/nip19';

import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';
import { prepareEvent } from '../../nostr/prepareEvent';
import {
  quoteOptimisticSubIds,
  replyOptimisticSubIds,
} from '../../nostr/subscriptionIds';
import { DEFAULT_UPLOAD_SERVER, uploadFile } from '../../nostr/upload';
import {
  selectPreferredUploadServer,
  SEARCH_RELAYS,
  useAuthStore,
  useNostrStore,
  useSendStatusStore,
} from '../../stores';
import { Note } from '../../components/notes/Note';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKind0Value } from '../../hooks/useKind0Value';
import { shortNpub } from '../../lib/identity';
import {CLASSIFIED_LISTING_KIND} from '../../lib/nip97';
import {
  deleteImagePickerAsset,
  deleteImagePickerAssets,
} from '../../media/cache';
import { type AppTheme, useAppTheme } from '../../theme';
import { GifPicker, type TenorGif } from './GifPicker';
import { MentionSuggestions, NoteComposer } from './NoteComposer';
import {
  ShortNoteComposer,
  ShortNoteHeader,
  ShortNoteToolbar,
} from './ShortNoteComposer';
import {
  MediaNoteComposer,
  MediaNoteHeader,
  SelectedMediaGrid,
} from './MediaComposer';
import { NostrEventCreation } from './EventComposer';
import { PollComposer } from './PollComposer';
import {
  type ComposeMode,
  type ComposerPanel,
  type ComposerStep,
  type EventCategory,
  type PollType,
  type SelectedImage,
  type SelectedMention,
  type UploadedImage,
  communityList,
  decodeReplyTarget,
  defaultDateTimeLocal,
  hasContentPart,
  imetaTagFromUpload,
  isTag,
  kind0DisplayName,
  mentionEventName,
  mentionHandle,
  now,
  readableContentColor,
  relayLabel,
  slugFromTitle,
  textWithNostrMentions,
  timestampFromLocal,
  waitForNextFrame,
} from './shared';

type Props = {
  reply?: string;
  quote?: string;
  onClose: () => void;
};

const KIND_OPTIONS: Array<{
  id: ComposeMode;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: 'note',
    title: 'Note',
    description: 'Share a thought or start a conversation',
    icon: MessageSquare,
    accent: '#4b87ff',
  },
  {
    id: 'media',
    title: 'Media',
    description: 'Post photos, videos or GIFs',
    icon: ImageIcon,
    accent: '#f24f9b',
  },
  {
    id: 'event',
    title: 'Event',
    description: 'Plan something in person or online',
    icon: CalendarDays,
    accent: '#4b87ff',
  },
  {
    id: 'poll',
    title: 'Poll',
    description: 'Ask a question and collect votes',
    icon: ListChecks,
    accent: '#2fc8b1',
  },
];

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

export function PostModal({ reply, quote, onClose }: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createPostModalStyles(theme), [theme]);
  const iconColor = theme.colors.primaryContent;
  const editorRef = useRef<EnrichedTextInputInstance>(null);
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const editorYRef = useRef(0);
  const editorHeightRef = useRef(0);
  const editorWidthRef = useRef(0);
  const mountedRef = useRef(true);
  const mentionSearchUnsubscribeRef = useRef<(() => void) | null>(null);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const relayRoleSets = useNostrStore(state => state.relayRoleSets);
  const uploadPreference = useNostrStore(selectPreferredUploadServer);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [text, setText] = useState('');
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [contentWarning, setContentWarning] = useState(false);
  const [pollType, setPollType] = useState<PollType>('singlechoice');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollEndsAt, setPollEndsAt] = useState<number | null>(null);
  const [replyNote, setReplyNote] = useState<ParsedEvent | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<ParsedEvent[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionFinished, setMentionFinished] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>(
    [],
  );
  const keyboardOpen = useKeyboardState(state => state.isVisible);
  const keyboardHeight = useKeyboardState(state => state.height);
  const [activePanel, setActivePanel] = useState<ComposerPanel | null>(null);
  const replyTarget = useMemo(() => decodeReplyTarget(reply), [reply]);
  const quoteTarget = useMemo(() => decodeReplyTarget(quote), [quote]);
  const noteTarget = replyTarget ?? quoteTarget;
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );
  const lookupRelays = useMemo(
    () => [
      ...new Set([
        ...(noteTarget?.relays ?? []),
        ...readRelays,
        ...writeRelays,
        ...DEFAULT_FEED_RELAYS,
      ]),
    ],
    [readRelays, noteTarget, writeRelays],
  );
  const mediaServerType = uploadPreference?.type || 'blossom';
  const mediaServer = uploadPreference?.servers[0] || DEFAULT_UPLOAD_SERVER;
  const communityOptions = useMemo(
    () => communityList(relayRoleSets),
    [relayRoleSets],
  );
  const validPollOptions = useMemo(
    () => pollOptions.map(option => option.trim()).filter(Boolean),
    [pollOptions],
  );
  const [step, setStep] = useState<ComposerStep>(
    reply || quote ? 'compose' : 'kind',
  );
  const [composeMode, setComposeMode] = useState<ComposeMode>('note');
  const [selectedRelay, setSelectedRelay] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventSummary, setEventSummary] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventCategory, setEventCategory] = useState<EventCategory>('social');
  const [eventStartsAt, setEventStartsAt] = useState(() =>
    defaultDateTimeLocal(24),
  );
  const [eventEndsAt, setEventEndsAt] = useState('');
  const [eventCapacity, setEventCapacity] = useState('');
  const [eventCover, setEventCover] = useState<SelectedImage | null>(null);
  const [eventAccess, setEventAccess] = useState<'everyone' | 'selected'>(
    'everyone',
  );
  const [eventCommunityRelays, setEventCommunityRelays] = useState<string[]>(
    [],
  );
  const [eventBadges, setEventBadges] = useState<string[]>([]);
  const [eventPaid, setEventPaid] = useState(false);
  const [eventPrice, setEventPrice] = useState('');
  const [eventCurrency, setEventCurrency] = useState('EUR');
  const [eventSats, setEventSats] = useState('');
  const selectedImagesRef = useRef(selectedImages);
  const eventCoverRef = useRef(eventCover);
  const isSubmittingRef = useRef(isSubmitting);

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    eventCoverRef.current = eventCover;
  }, [eventCover]);

  const cleanupDraftMedia = useCallback(() => {
    const uris = [
      ...selectedImagesRef.current.map(image => image.uri),
      eventCoverRef.current?.uri,
    ];
    selectedImagesRef.current = [];
    eventCoverRef.current = null;
    deleteImagePickerAssets(uris);
  }, []);

  const closeModal = useCallback(() => {
    Keyboard.dismiss();
    if (!isSubmittingRef.current) cleanupDraftMedia();
    onClose();
  }, [cleanupDraftMedia, onClose]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        closeModal();
        return true;
      },
    );
    return () => subscription.remove();
  }, [closeModal]);

  const destinationLabel = selectedRelay ? relayLabel(selectedRelay) : 'Public';
  const DestinationIcon = selectedRelay ? Users : Globe;
  const isEventMode = composeMode === 'event';
  const isMediaMode = composeMode === 'media';
  const isShortNoteComposer =
    step === 'compose' && composeMode === 'note' && !noteTarget;
  const isMediaNoteComposer = step === 'compose' && isMediaMode;
  const eventStartMs = new Date(eventStartsAt).getTime();
  const eventEndMs = eventEndsAt ? new Date(eventEndsAt).getTime() : null;
  const eventScheduleValid =
    Number.isFinite(eventStartMs) &&
    eventStartMs > Date.now() &&
    (eventEndMs === null ||
      (Number.isFinite(eventEndMs) && eventEndMs > eventStartMs));
  const canSubmitEvent = Boolean(
    eventTitle.trim() &&
      eventScheduleValid &&
      (!eventCommunityRelays.length ||
        ((eventAccess === 'everyone' || eventBadges.length > 0) &&
          (!eventPaid || Number(eventPrice) > 0))),
  );
  const effectivePublishRelays = useMemo(
    () => (selectedRelay ? [selectedRelay] : relays),
    [relays, selectedRelay],
  );
  const eventPublishRelays = useMemo(
    () => (eventCommunityRelays.length ? eventCommunityRelays : relays),
    [eventCommunityRelays, relays],
  );
  const destinationActions = useMemo<MenuAction[]>(
    () => [
      {
        id: 'public',
        title: 'Public',
        state: selectedRelay ? 'off' : 'on',
      },
      ...communityOptions.map(community => ({
        id: community.url,
        title: relayLabel(community.url),
        state: (selectedRelay === community.url ? 'on' : 'off') as 'on' | 'off',
      })),
    ],
    [communityOptions, selectedRelay],
  );
  const onDestinationAction = useCallback(
    ({ nativeEvent }: NativeActionEvent) => {
      setSelectedRelay(nativeEvent.event === 'public' ? '' : nativeEvent.event);
    },
    [],
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
    ).slice(0, 10);
  }, [mentionQuery, mentionResults]);
  const showMentionPanel = Boolean(
    mentionQuery?.trim() &&
      (mentionLoading || mentionFinished || mentionSuggestions.length),
  );
  const replyAuthorPubkey = replyNote?.pubkey() || '';
  const replyAuthorFallback = replyAuthorPubkey
    ? shortNpub(replyAuthorPubkey)
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
  const quoteReady = !quoteTarget?.id || Boolean(replyNote);
  const canSubmit =
    Boolean(pubkey && hasSigner) &&
    !isSubmitting &&
    quoteReady &&
    (isEventMode
      ? canSubmitEvent
      : Boolean(
          text.trim() ||
            quoteTarget?.id ||
            selectedImages.length ||
            (pollEnabled && validPollOptions.length >= 2),
        ));
  const submitLabel = isSubmitting
    ? submitStatus?.startsWith('Uploading')
      ? 'Uploading'
      : submitStatus?.startsWith('Publishing')
      ? 'Publishing'
      : 'Signing'
    : reply
    ? 'Reply'
    : quote
    ? 'Quote'
    : 'Post';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!isSubmittingRef.current) cleanupDraftMedia();
    };
  }, [cleanupDraftMedia]);

  const updateSelectedImagesIfMounted = useCallback(
    (update: React.SetStateAction<SelectedImage[]>) => {
      if (mountedRef.current) setSelectedImages(update);
    },
    [],
  );

  const setSubmitStatusIfMounted = useCallback((value: string | null) => {
    if (mountedRef.current) setSubmitStatus(value);
  }, []);

  const scrollToComposer = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, editorYRef.current - 12),
        animated: true,
      });
      editorRef.current?.focus();
    });
  }, []);

  const handleEditorLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height, width } = event.nativeEvent.layout;
      const editorMoved = Math.abs(editorYRef.current - y) > 1;
      editorYRef.current = y;
      editorHeightRef.current = height;
      editorWidthRef.current = width;

      if (editorMoved && keyboardOpen && noteTarget?.id) {
        scrollToComposer();
      }
    },
    [keyboardOpen, noteTarget?.id, scrollToComposer],
  );

  const openComposerPanel = useCallback(
    (panel: ComposerPanel) => {
      if (activePanel === panel) {
        setActivePanel(null);
        editorRef.current?.focus();
        return;
      }
      setActivePanel(panel);
      editorRef.current?.focus();
    },
    [activePanel],
  );

  const refocusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    setReplyNote(null);
    if (!noteTarget?.id) return undefined;

    const request: RequestObject[] = [
      {
        ids: [noteTarget.id],
        limit: 1,
        relays: lookupRelays,
        cacheFirst: true,
      },
    ];

    return subscribeToNostr(
      `post_${noteTarget.id}_${lookupRelays.join('|')}`,
      request,
      (message: WorkerMessage) => {
        const event = asParsedEvent(message);
        if (event?.id() === noteTarget.id) {
          setReplyNote(event);
        }
      },
    );
  }, [lookupRelays, noteTarget]);

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

    const updateItems = (events: ParsedEvent[], descending = true) => {
      setMentionResults(
        sortMentionEvents(events, query, cachedPubkeys, descending),
      );
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
            updateItems([...cachedEvents, ...fetchedEvents, ...items], false);
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
    if (!noteTarget?.id) return;
    const timeout = setTimeout(scrollToComposer, 120);
    return () => clearTimeout(timeout);
  }, [replyNote, noteTarget, scrollToComposer]);

  useEffect(() => {
    if (!keyboardOpen) return;
    const timeout = setTimeout(scrollToComposer, 80);
    return () => clearTimeout(timeout);
  }, [keyboardHeight, keyboardOpen, scrollToComposer]);

  const contentContainerStyle = useMemo(
    () => [
      styles.content,
      step === 'kind' ? styles.kindContent : null,
      isShortNoteComposer ? styles.shortNoteContent : null,
      keyboardOpen || activePanel ? { paddingBottom: 96 } : null,
    ],
    [
      activePanel,
      isShortNoteComposer,
      keyboardOpen,
      step,
      styles.content,
      styles.kindContent,
      styles.shortNoteContent,
    ],
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

  const selectKind = useCallback((mode: ComposeMode) => {
    if (mode === 'media') Keyboard.dismiss();
    setComposeMode(mode);
    setContentWarning(false);
    setPollEnabled(mode === 'poll');
    if (mode !== 'media') {
      deleteImagePickerAssets(
        selectedImagesRef.current.map(image => image.uri),
      );
      selectedImagesRef.current = [];
      setSelectedImages([]);
    }
    if (mode !== 'poll') {
      setPollType('singlechoice');
      setPollOptions(['', '']);
      setPollEndsAt(null);
    }
    setStep('compose');
  }, []);

  const returnToKindPicker = useCallback(() => {
    Keyboard.dismiss();
    setActivePanel(null);
    setStep('kind');
  }, []);

  const selectEventAccess = useCallback((value: 'everyone' | 'selected') => {
    setEventAccess(value);
    if (value === 'everyone') {
      setEventPaid(false);
      setEventPrice('');
      setEventSats('');
    }
  }, []);

  const selectEventCommunities = useCallback((communityRelays: string[]) => {
    setEventCommunityRelays(communityRelays);
    setEventBadges([]);
    if (!communityRelays.length) {
      setEventAccess('everyone');
      setEventPaid(false);
      setEventPrice('');
      setEventSats('');
    }
  }, []);

  const toggleEventBadge = useCallback((address: string) => {
    setEventBadges(current =>
      current.includes(address)
        ? current.filter(item => item !== address)
        : [...current, address],
    );
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
            { name, handle, pubkey: candidatePubkey, relays: SEARCH_RELAYS },
          ],
    );
    setMentionQuery(null);
  }, []);

  const submitEvent = useCallback(async () => {
    if (!canSubmitEvent || !pubkey || !hasSigner) return;
    const startTimestamp = timestampFromLocal(eventStartsAt);
    const endTimestamp = eventEndsAt ? timestampFromLocal(eventEndsAt) : null;
    if (
      startTimestamp <= now() ||
      (endTimestamp !== null && endTimestamp <= startTimestamp)
    ) {
      setSubmitStatusIfMounted('Event start time must be in the future.');
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      let coverUrl = '';
      let coverUploadTags: string[][] = [];
      if (eventCover) {
        setSubmitStatusIfMounted('Uploading cover...');
        try {
          const result = await uploadFile(eventCover, {
            server: mediaServer,
            serverType: mediaServerType,
          });
          coverUrl = result.url;
          coverUploadTags = result.tags;
        } catch (error) {
          setSubmitStatusIfMounted(
            error instanceof Error ? error.message : 'Cover upload failed',
          );
          return;
        }
      }
      if (!mountedRef.current) return;
      setSubmitStatusIfMounted('Publishing event...');

      const title = eventTitle.trim();
      const summary = eventSummary.trim();
      const capacity = eventCapacity
        ? Math.max(1, Math.floor(Number(eventCapacity)))
        : 0;
      const d = `${slugFromTitle(title)}-${startTimestamp}`;
      const tags: string[][] = [
        ['d', d],
        ['title', title],
        ['summary', summary],
        ['start', String(startTimestamp)],
        ['t', eventCategory],
        ['client', 'nutscash'],
      ];
      if (endTimestamp !== null) tags.push(['end', String(endTimestamp)]);
      if (eventLocation.trim()) tags.push(['location', eventLocation.trim()]);
      if (capacity) tags.push(['capacity', String(capacity)]);
      if (coverUrl && eventCover) {
        tags.push(['image', coverUrl]);
        const coverImeta = imetaTagFromUpload({
          ...eventCover,
          uploadUrl: coverUrl,
          uploadTags: coverUploadTags,
          status: 'uploaded',
        });
        if (coverImeta) tags.push(coverImeta);
      }

      // Admission is a community-relay concept; skip it for public events.
      const admissionApplies = eventCommunityRelays.length > 0;
      if (admissionApplies) {
        tags.push([
          'access',
          eventAccess === 'everyone' ? 'open' : 'restricted',
        ]);
        if (eventAccess === 'selected') {
          eventBadges.forEach(address =>
            tags.push(['required_badge', address]),
          );
        }
      }
      const priceValue = String(Number(eventPrice) || 0);
      const entranceBadgeD = `event-${d}-entrance`;
      const entranceBadgeAddress = `${CLASSIFIED_LISTING_KIND}:${pubkey}:${entranceBadgeD}`;
      const publishEntranceBadge = admissionApplies && eventPaid;
      if (publishEntranceBadge) {
        tags.push(['entrance_price', priceValue, eventCurrency]);
        tags.push(['entrance_badge', entranceBadgeAddress]);
        if (Number(eventSats) > 0) {
          tags.push(['entrance_sats', String(Math.floor(Number(eventSats)))]);
        }
      }

      const event: EventTemplate = {
        kind: 31923,
        content: summary,
        created_at: now(),
        tags,
      };
      const sendId = `community_event_${Date.now()}`;
      const sendStatus: Record<string, ConnectionStatus> = {};
      const trackRelay =
        (id: string, status: Record<string, ConnectionStatus>) =>
        (message: WorkerMessage) => {
          const connectionStatus = isConnectionStatus(message);
          const relayUrl = connectionStatus?.relayUrl();
          if (!connectionStatus || !relayUrl) return;
          status[relayUrl] = connectionStatus;
          updateSendStatus(id, status);
        };

      publishToNostr(sendId, event, trackRelay(sendId, sendStatus), {
        defaultRelays: eventPublishRelays,
        trackStatus: true,
      });

      if (publishEntranceBadge) {
        const badgeTags: string[][] = [
          ['d', entranceBadgeD],
          ['t', 'ticket'],
          ['title', `${title} entrance`],
          ['summary', `Paid entrance for ${title}`],
          ['status', 'active'],
          ['a', `31923:${pubkey}:${d}`],
          ['price', priceValue, eventCurrency],
          ['max_uses', '1'],
        ];
        if (eventEndsAt) {
          badgeTags.push([
            'expiration',
            String(timestampFromLocal(eventEndsAt)),
          ]);
        }
        if (Number(eventSats) > 0) {
          badgeTags.push(['price_sats', String(Math.floor(Number(eventSats)))]);
        }
        if (coverUrl) badgeTags.push(['image', coverUrl]);
        const badgeEvent: EventTemplate = {
          kind: CLASSIFIED_LISTING_KIND,
          content: `Paid entrance for ${title}`,
          created_at: now(),
          tags: badgeTags,
        };
        const badgeSendId = `event_badge_${Date.now()}`;
        const badgeSendStatus: Record<string, ConnectionStatus> = {};
        publishToNostr(
          badgeSendId,
          badgeEvent,
          trackRelay(badgeSendId, badgeSendStatus),
          { defaultRelays: eventCommunityRelays, trackStatus: true },
        );
      }

      if (eventCover) {
        deleteImagePickerAsset(eventCover.uri);
      }
      if (mountedRef.current) {
        setEventTitle('');
        setEventSummary('');
        setEventLocation('');
        setEventCapacity('');
        setEventCategory('social');
        setEventStartsAt(defaultDateTimeLocal(24));
        setEventEndsAt('');
        setEventAccess('everyone');
        setEventCommunityRelays([]);
        setEventBadges([]);
        setEventCover(null);
        setEventPaid(false);
        setEventPrice('');
        setEventCurrency('EUR');
        setEventSats('');
        setSubmitStatus(null);
        onClose();
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }, [
    canSubmitEvent,
    eventAccess,
    eventBadges,
    eventCapacity,
    eventCategory,
    eventCover,
    eventCurrency,
    eventCommunityRelays,
    eventEndsAt,
    eventLocation,
    eventPaid,
    eventPublishRelays,
    eventPrice,
    eventSats,
    eventStartsAt,
    eventSummary,
    eventTitle,
    hasSigner,
    mediaServer,
    mediaServerType,
    onClose,
    pubkey,
    setSubmitStatusIfMounted,
    updateSendStatus,
  ]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    if (isEventMode) {
      await submitEvent();
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const activeImages = selectedImages;
      const localImages = activeImages.filter(image => !image.remote);
      const remoteImages = activeImages
        .filter(image => image.remote)
        .map(image => ({
          ...image,
          status: 'uploaded' as const,
          uploadUrl: image.uploadUrl || image.uri,
          uploadTags: image.uploadTags || [],
        }));

      setSubmitStatusIfMounted(
        localImages.length
          ? `Uploading ${localImages.length} image${
              localImages.length === 1 ? '' : 's'
            } to ${mediaServer}...`
          : 'Preparing event...',
      );
      updateSelectedImagesIfMounted(current =>
        current.map(item =>
          localImages.some(image => image.uri === item.uri)
            ? { ...item, status: 'uploading' }
            : item,
        ),
      );

      const uploadResults = await Promise.all(
        localImages.map(async image => {
          try {
            const result = await uploadFile(image, {
              server: mediaServer,
              serverType: mediaServerType,
            });
            const uploaded = {
              ...image,
              status: 'uploaded' as const,
              uploadUrl: result.url,
              uploadTags: result.tags,
            };
            updateSelectedImagesIfMounted(current =>
              current.map(item => (item.uri === image.uri ? uploaded : item)),
            );
            return uploaded;
          } catch (error) {
            const failed = {
              ...image,
              status: 'failed' as const,
              error: error instanceof Error ? error.message : 'Upload failed',
            };
            updateSelectedImagesIfMounted(current =>
              current.map(item => (item.uri === image.uri ? failed : item)),
            );
            return failed;
          }
        }),
      );
      const failedUpload = uploadResults.find(
        image => image.status === 'failed',
      );
      if (failedUpload) {
        setSubmitStatusIfMounted(failedUpload.error || 'Upload failed');
        return;
      }
      const uploadedImages = uploadResults.filter(
        (image): image is UploadedImage => image.status === 'uploaded',
      );
      const mediaImages = [...uploadedImages, ...remoteImages].sort(
        (left, right) =>
          activeImages.findIndex(image => image.uri === left.uri) -
          activeImages.findIndex(image => image.uri === right.uri),
      );

      setSubmitStatusIfMounted('Publishing post...');
      let baseTags: string[][] = [];
      if (replyTarget?.id && replyNote) {
        baseTags = fbArray(replyNote, 'tags').map(tag =>
          fbArray(tag, 'items').map(item => String(item)),
        );
      }
      const quoteLink =
        quoteTarget?.id && replyNote
          ? `nostr:${neventEncode({
              id: quoteTarget.id,
              author: replyNote.pubkey() || quoteTarget.author,
              kind: replyNote.kind() || quoteTarget.kind,
              relays: quoteTarget.relays,
            })}`
          : '';
      const content = [
        textWithNostrMentions(text, selectedMentions),
        ...mediaImages.map(image => image.uploadUrl),
        quoteLink,
      ]
        .filter(hasContentPart)
        .join('\n\n')
        .trim();
      let event: EventTemplate & { id?: string } = {
        kind: pollEnabled ? 1068 : 1,
        content,
        created_at: now(),
        tags: contentWarning
          ? [...baseTags, ['content-warning', '']]
          : baseTags,
      };
      if (replyTarget?.id && replyNote) {
        event.id = replyTarget.id;
      }

      event = prepareEvent(event);
      event.tags = [
        ...event.tags,
        ...mediaImages.map(imetaTagFromUpload).filter(isTag),
      ];

      if (quoteTarget?.id && replyNote) {
        const relayHint = quoteTarget.relays[0] || '';
        const quoteAuthor = replyNote.pubkey() || quoteTarget.author || '';
        event.tags = [
          ...event.tags.filter(
            tag => !(tag[0] === 'q' && tag[1] === quoteTarget.id),
          ),
          ['q', quoteTarget.id, relayHint, quoteAuthor],
          ...(quoteAuthor ? [['p', quoteAuthor]] : []),
        ];
      }

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

      const sendId = `${
        pollEnabled ? 'poll' : reply ? 'reply' : quote ? 'quote' : 'post'
      }_${Date.now()}`;
      const sendStatus: Record<string, ConnectionStatus> = {};
      const replyRootId = replyTarget?.id
        ? nip10.parse(event).root?.id || replyTarget.id
        : '';
      const optimisticSubIds = replyTarget?.id
        ? replyOptimisticSubIds(replyTarget.id, replyRootId)
        : quoteTarget?.id
        ? quoteOptimisticSubIds(quoteTarget.id)
        : undefined;

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
          defaultRelays: effectivePublishRelays,
          trackStatus: true,
          subId: optimisticSubIds,
        },
      );

      deleteImagePickerAssets(selectedImages.map(image => image.uri));
      if (mountedRef.current) {
        editorRef.current?.setValue('');
        setText('');
        setSelectedMentions([]);
        setSelectedImages([]);
        setSubmitStatus(null);
        setActivePanel(null);
        setPollEnabled(false);
        setContentWarning(false);
        setPollOptions(['', '']);
        setPollType('singlechoice');
        setPollEndsAt(null);
        onClose();
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }, [
    canSubmit,
    contentWarning,
    onClose,
    pollEnabled,
    pollEndsAt,
    pollType,
    quote,
    reply,
    replyNote,
    quoteTarget,
    replyTarget,
    effectivePublishRelays,
    text,
    updateSendStatus,
    validPollOptions,
    selectedImages,
    selectedMentions,
    setSubmitStatusIfMounted,
    updateSelectedImagesIfMounted,
    mediaServer,
    mediaServerType,
    isEventMode,
    submitEvent,
  ]);

  const insertImage = useCallback(
    (
      uri: string,
      width: number,
      height: number,
      mimeType?: string | null,
      fileName?: string | null,
    ) => {
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
    },
    [],
  );

  const removeImage = useCallback((uri: string) => {
    deleteImagePickerAsset(uri);
    setSelectedImages(current => current.filter(image => image.uri !== uri));
  }, []);

  const changeEventCover = useCallback((cover: SelectedImage | null) => {
    const previousUri = eventCoverRef.current?.uri;
    if (previousUri && previousUri !== cover?.uri) {
      deleteImagePickerAsset(previousUri);
    }
    eventCoverRef.current = cover;
    setEventCover(cover);
  }, []);

  const insertRemoteImage = useCallback(
    (uri: string, width: number, height: number) => {
      setSelectedImages(current =>
        current.some(image => image.uri === uri)
          ? current
          : [
              ...current,
              {
                uri,
                width,
                height,
                remote: true,
                uploadUrl: uri,
                status: 'uploaded',
              },
            ],
      );
    },
    [],
  );

  const selectGif = useCallback(
    (gif: TenorGif) => {
      const media =
        gif.media_formats.gif ||
        gif.media_formats.mediumgif ||
        gif.media_formats.tinygif;
      if (!media?.url) return;
      const [width, height] = media.dims || [320, 240];
      insertRemoteImage(media.url, width, height);
      setActivePanel(null);
      if (!isMediaMode) refocusComposer();
    },
    [insertRemoteImage, isMediaMode, refocusComposer],
  );

  const openNativeMediaPicker = useCallback(async () => {
    setActivePanel(null);
    if (!isMediaMode) editorRef.current?.focus();

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      if (!isMediaMode) refocusComposer();
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
      quality: 0.92,
    });

    if (!result.canceled) {
      await waitForNextFrame();
      if (!isMediaMode) editorRef.current?.focus();

      for (const asset of result.assets) {
        if (!asset.uri) continue;
        insertImage(
          asset.uri,
          Math.max(1, Math.round(asset.width || 320)),
          Math.max(1, Math.round(asset.height || 240)),
          asset.mimeType,
          asset.fileName,
        );
        await waitForNextFrame();
      }
    }

    if (!isMediaMode) refocusComposer();
  }, [insertImage, isMediaMode, refocusComposer]);

  const showComposerAccessory = activePanel !== 'gif';
  const hasComposerAccessory =
    showComposerAccessory &&
    (showMentionPanel || (step === 'compose' && composeMode === 'note'));

  const editorPlaceholder = reply
    ? replyNote
      ? `Reply to ${replyAuthorName}`
      : 'Write your reply...'
    : quote
    ? 'Add a quote?'
    : composeMode === 'media'
    ? 'Caption this.'
    : composeMode === 'poll'
    ? 'Ask your friends'
    : "What's on your mind?";

  const composerAccessory = (
    <>
      {showMentionPanel ? (
        <MentionSuggestions
          candidates={mentionSuggestions}
          loading={mentionLoading}
          finished={mentionFinished}
          onSelect={selectMention}
        />
      ) : null}
      {step === 'compose' && composeMode === 'note' ? (
        <ShortNoteToolbar
          activePanel={activePanel}
          contentWarning={contentWarning}
          onInsertImage={insertImage}
          onMediaPress={openNativeMediaPicker}
          onGifPress={() => {
            openComposerPanel('gif');
          }}
          onContentWarningPress={() => {
            setContentWarning(current => !current);
          }}
        />
      ) : null}
    </>
  );

  if (step === 'compose' && isEventMode) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <NostrEventCreation
          access={eventAccess}
          badges={eventBadges}
          canPublish={canSubmit}
          capacity={eventCapacity}
          category={eventCategory}
          communities={communityOptions}
          communityRelays={eventCommunityRelays}
          cover={eventCover}
          currency={eventCurrency}
          endsAt={eventEndsAt}
          isPublishing={isSubmitting}
          location={eventLocation}
          paid={eventPaid}
          price={eventPrice}
          publishLabel={submitLabel}
          sats={eventSats}
          startsAt={eventStartsAt}
          summary={eventSummary}
          title={eventTitle}
          onBack={returnToKindPicker}
          onChangeAccess={selectEventAccess}
          onChangeCapacity={setEventCapacity}
          onChangeCategory={setEventCategory}
          onChangeCommunityRelays={selectEventCommunities}
          onChangeCover={changeEventCover}
          onChangeCurrency={setEventCurrency}
          onChangeEndsAt={setEventEndsAt}
          onChangeLocation={setEventLocation}
          onChangePaid={setEventPaid}
          onChangePrice={setEventPrice}
          onChangeSats={setEventSats}
          onChangeStartsAt={setEventStartsAt}
          onChangeSummary={setEventSummary}
          onChangeTitle={setEventTitle}
          onClose={closeModal}
          onPublish={submit}
          onToggleBadge={toggleEventBadge}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {activePanel !== 'gif' ? (
        <>
          <View
            style={[
              styles.header,
              step === 'kind' && styles.kindModalHeader,
              (isShortNoteComposer || isMediaNoteComposer) &&
                styles.shortNoteHeader,
            ]}
          >
            {isShortNoteComposer ? (
              <ShortNoteHeader
                canSubmit={canSubmit}
                destinationActions={destinationActions}
                destinationLabel={destinationLabel}
                isSubmitting={isSubmitting}
                onBack={returnToKindPicker}
                onDestinationAction={onDestinationAction}
                onPublish={submit}
                selectedRelay={selectedRelay}
                submitLabel={submitLabel}
              />
            ) : null}
            {isMediaNoteComposer ? (
              <MediaNoteHeader
                canSubmit={canSubmit}
                isSubmitting={isSubmitting}
                onBack={returnToKindPicker}
                onShare={submit}
                submitLabel={submitLabel}
              />
            ) : null}
            {step === 'kind' ? (
              <View style={styles.headerCenter} pointerEvents="box-none">
                <Text style={styles.headerTitle}>New post</Text>
              </View>
            ) : null}
            {step === 'compose' &&
            !isShortNoteComposer &&
            !isMediaNoteComposer ? (
              <View style={styles.headerCenter} pointerEvents="box-none">
                <MenuView
                  title="Post to"
                  actions={destinationActions}
                  onPressAction={onDestinationAction}
                >
                  <View
                    accessibilityLabel={`Post destination: ${destinationLabel}`}
                    accessibilityRole="button"
                    style={styles.destinationCaption}
                  >
                    <DestinationIcon
                      size={12}
                      color={theme.colors.primaryContent}
                      strokeWidth={2.4}
                    />
                    <Text
                      style={styles.destinationCaptionText}
                      numberOfLines={1}
                    >
                      {destinationLabel}
                    </Text>
                    <ChevronDown
                      size={13}
                      color={theme.colors.primaryContent}
                      strokeWidth={2.4}
                    />
                  </View>
                </MenuView>
              </View>
            ) : null}
            {!isShortNoteComposer && !isMediaNoteComposer ? (
              <Pressable
                accessibilityLabel="Close post composer"
                accessibilityRole="button"
                style={[
                  styles.iconButton,
                  step === 'kind' && styles.kindCloseButton,
                ]}
                hitSlop={12}
                onPress={closeModal}
              >
                {step === 'kind' || Platform.OS === 'android' ? (
                  <X
                    size={step === 'kind' ? 25 : 22}
                    color={iconColor}
                    strokeWidth={2.3}
                  />
                ) : (
                  <ChevronDown size={23} color={iconColor} strokeWidth={2.3} />
                )}
              </Pressable>
            ) : null}
            {step === 'compose' &&
            !isShortNoteComposer &&
            !isMediaNoteComposer ? (
              <Pressable
                accessibilityLabel={
                  isSubmitting
                    ? `${submitLabel}, please wait`
                    : `${submitLabel} post`
                }
                accessibilityRole="button"
                accessibilityState={{
                  busy: isSubmitting,
                  disabled: !canSubmit,
                }}
                style={[
                  styles.submitButton,
                  !canSubmit && styles.submitDisabled,
                ]}
                disabled={!canSubmit}
                onPress={submit}
              >
                <Text
                  style={[
                    styles.submitText,
                    !canSubmit && styles.submitTextDisabled,
                  ]}
                  numberOfLines={1}
                >
                  {submitLabel}
                </Text>
                <Send
                  size={16}
                  color={
                    canSubmit
                      ? theme.button.primary.text
                      : theme.button.disabled.text
                  }
                  strokeWidth={2.4}
                />
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
      <KeyboardAwareScrollView
        ref={scrollRef}
        bottomOffset={64}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={contentContainerStyle}
        onScrollBeginDrag={Keyboard.dismiss}
        scrollEventThrottle={16}
      >
        {!pubkey || !hasSigner ? (
          <View style={styles.notice}>
            <TriangleAlert
              size={16}
              color={theme.colors.warning}
              strokeWidth={2.2}
            />
            <Text style={styles.noticeText}>
              Connect a signer before publishing posts.
            </Text>
          </View>
        ) : null}

        {step === 'kind' ? <KindPicker onSelect={selectKind} /> : null}

        {noteTarget?.id ? (
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
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.replyLoadingText}>Loading note...</Text>
            </View>
          )
        ) : null}

        {isShortNoteComposer ? (
          <ShortNoteComposer
            characterCount={text.length}
            editorRef={editorRef}
            onLayout={handleEditorLayout}
            onMentionQuery={setMentionQuery}
            onTextChange={setText}
            placeholder={editorPlaceholder}
            pubkey={pubkey || ''}
          />
        ) : null}

        {isMediaNoteComposer ? (
          <MediaNoteComposer
            activePanel={activePanel}
            editorRef={editorRef}
            images={selectedImages}
            onGifPress={() => {
              openComposerPanel('gif');
            }}
            onInsertImage={insertImage}
            onMentionQuery={setMentionQuery}
            onPickMedia={openNativeMediaPicker}
            onRemove={removeImage}
            onTextChange={setText}
            pubkey={pubkey || ''}
            text={text}
          />
        ) : null}

        {step === 'compose' &&
        !isEventMode &&
        composeMode !== 'media' &&
        !isShortNoteComposer ? (
          <NoteComposer
            editorRef={editorRef}
            isPoll={composeMode === 'poll'}
            isReply={Boolean(noteTarget)}
            onLayout={handleEditorLayout}
            onMentionQuery={setMentionQuery}
            onTextChange={setText}
            placeholder={editorPlaceholder}
          />
        ) : null}

        {step === 'compose' &&
        !isEventMode &&
        !isMediaMode &&
        selectedImages.length ? (
          <SelectedMediaGrid images={selectedImages} onRemove={removeImage} />
        ) : null}

        {step === 'compose' && pollEnabled ? (
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
      </KeyboardAwareScrollView>

      {hasComposerAccessory && keyboardOpen ? (
        <KeyboardStickyView
          offset={{ closed: 0, opened: 0 }}
          style={[
            styles.toolbarAccessory,
            styles.keyboardAccessory,
            isShortNoteComposer && styles.shortNoteToolbarAccessory,
          ]}
        >
          {composerAccessory}
        </KeyboardStickyView>
      ) : hasComposerAccessory && activePanel ? (
        <View
          style={[
            styles.toolbarAccessory,
            styles.keyboardAccessory,
            isShortNoteComposer && styles.shortNoteToolbarAccessory,
          ]}
        >
          {composerAccessory}
        </View>
      ) : null}

      {activePanel === 'gif' ? (
        <View
          style={[
            styles.gifModal,
            {
              bottom: Math.max(0, (keyboardOpen ? keyboardHeight : 0) - 18),
            },
          ]}
        >
          <GifPicker
            onSelect={selectGif}
            onDone={() => {
              setActivePanel(null);
              if (!isMediaMode) refocusComposer();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function KindPicker({ onSelect }: { onSelect: (mode: ComposeMode) => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createPostModalStyles(theme), [theme]);
  return (
    <View className="gap-[25px] pb-4 pt-3">
      <View className="gap-[11px]">
        <Text className="text-[30px] font-extrabold leading-[40px] tracking-[-0.7px] text-base-content">
          What do you want to share?
        </Text>
        <Text className="text-[17px] font-normal leading-[22px] text-primary-content">
          Choose a format to get started.
        </Text>
      </View>
      <View className="-m-[4.5px] flex-row flex-wrap">
        {KIND_OPTIONS.map(option => {
          const Icon = option.icon;
          const accent =
            option.id === 'event' ? theme.colors.primary : option.accent;
          return (
            <View key={option.id} className="w-1/2 p-[4.5px]">
              <Pressable
                accessibilityLabel={`${option.title}. ${option.description}`}
                accessibilityRole="button"
                className={[
                  'min-h-[202px] flex-1 justify-between overflow-hidden rounded-[20px] border p-[23px] pb-7',
                  theme.id === 'matteblack'
                    ? 'border-[#484848] bg-[#1c1c1c]'
                    : 'border-base-200 bg-base-300',
                ].join(' ')}
                style={({ pressed }) => [
                  styles.kindCard,
                  pressed && styles.kindCardPressed,
                ]}
                onPress={() => onSelect(option.id)}
              >
                <View className="flex-row items-center justify-between">
                  <View
                    className="h-[58px] w-[58px] items-center justify-center rounded-2xl border"
                    style={[
                      {
                        backgroundColor: `${accent}30`,
                        borderColor: `${accent}d9`,
                      },
                    ]}
                  >
                    <Icon size={30} color={accent} strokeWidth={2.2} />
                  </View>
                  <ChevronRight
                    size={22}
                    color={theme.colors.primaryContent}
                    strokeWidth={2.5}
                  />
                </View>
                <View className="mt-3 min-h-[91px] gap-1.5">
                  <Text className="text-[20px] font-extrabold leading-[25px] text-base-content">
                    {option.title}
                  </Text>
                  <Text className="text-[15px] font-normal leading-5 text-primary-content">
                    {option.description}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function createPostModalStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.base100,
    },
    header: {
      minHeight: 72,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.base200,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    headerCenter: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      color: contentColor,
      fontSize: 15,
      fontWeight: '700',
    },
    destinationCaption: {
      maxWidth: '52%',
      minHeight: 32,
      borderRadius: 16,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: theme.colors.base300,
      borderWidth: 1,
      borderColor: theme.colors.base200,
    },
    destinationCaptionText: {
      flexShrink: 1,
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '700',
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitButton: {
      flexShrink: 1,
      minWidth: 72,
      height: 40,
      borderRadius: 20,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.button.primary.border,
      backgroundColor: theme.button.primary.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    submitDisabled: {
      borderColor: theme.button.disabled.border,
      backgroundColor: theme.button.disabled.background,
    },
    submitText: {
      flexShrink: 1,
      color: theme.button.primary.text,
      fontSize: 14,
      fontWeight: '700',
    },
    submitTextDisabled: {
      color: theme.button.disabled.text,
    },
    content: {
      padding: 16,
      gap: 12,
    },
    kindContent: {
      paddingTop: 0,
      paddingHorizontal: 18,
    },
    shortNoteContent: {
      paddingTop: 12,
      paddingHorizontal: 18,
      gap: 12,
    },
    kindModalHeader: {
      paddingHorizontal: 18,
      borderBottomColor: 'transparent',
    },
    shortNoteHeader: {
      paddingHorizontal: 18,
      borderBottomColor: 'transparent',
    },
    kindCloseButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderColor: `${theme.colors.primaryContent}33`,
    },
    kindCard: {
      borderCurve: 'continuous',
    },
    kindCardPressed: {
      opacity: 0.75,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.warning,
      backgroundColor: theme.colors.base300,
      padding: 12,
    },
    noticeText: {
      flex: 1,
      color: theme.colors.warning,
      fontSize: 14,
      fontWeight: '500',
    },
    replyLoading: {
      minHeight: 96,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    replyLoadingText: {
      color: theme.colors.primaryContent,
      fontSize: 14,
      fontWeight: '600',
    },
    toolbarAccessory: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
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
    shortNoteToolbarAccessory: {
      paddingHorizontal: 0,
      paddingTop: 0,
      borderTopWidth: 0,
    },
    gifModal: {
      position: 'absolute',
      top: 0,
      left: 12,
      right: 12,
      zIndex: 30,
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  });
}
