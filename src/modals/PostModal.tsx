import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
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
import {Image} from 'expo-image';
import {BlurView} from 'expo-blur';
import {
  Camera,
  ChevronDown,
  Film,
  Globe2,
  Image as ImageIcon,
  Plus,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react-native';
import {KeyboardStickyView, useKeyboardState} from 'react-native-keyboard-controller';
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
import { decode, neventEncode, nprofileEncode } from 'nostr-tools/nip19';

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
  type RelayRoleSetSnapshot,
  useSendStatusStore,
} from '../stores';
import { Note } from '../components/notes/Note';
import {SegmentedTabs, type SegmentedTab} from '../components/SegmentedTabs';
import { useKind0Value } from '../hooks/useKind0Value';
import {type AppTheme, useAppTheme} from '../theme';

type Props = {
  reply?: string;
  quote?: string;
  onClose: () => void;
};

type PostModalStyles = ReturnType<typeof createPostModalStyles>;
const PostModalStylesContext = createContext<PostModalStyles | null>(null);

function usePostModalStyles() {
  const styles = useContext(PostModalStylesContext);
  if (!styles) throw new Error('PostModal styles missing');
  return styles;
}

type PollType = 'singlechoice' | 'multiplechoice';
type ComposerStep = 'setup' | 'compose';
type ComposeMode = 'note' | 'media' | 'event' | 'poll';
type EventCategory = 'training' | 'match' | 'meeting' | 'social';
type ComposerPanel = 'gif';
type CommunityRole = 'Admin' | 'Member' | 'Following';
type ComposerKindTabId = ComposeMode;
type TenorGif = {
  id: string;
  content_description?: string;
  media_formats: {
    gif?: {url: string; dims?: [number, number]};
    mediumgif?: {url: string; dims?: [number, number]};
    tinygif?: {url: string; dims?: [number, number]};
  };
};
type SelectedImage = LocalUploadAsset & {
  remote?: boolean;
  uploadUrl?: string;
  uploadTags?: string[][];
  status: 'waiting' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
};
type UploadedImage = SelectedImage & {
  uploadUrl: string;
  uploadTags: string[][];
  status: 'uploaded';
};
type SelectedMention = {
  name: string;
  handle: string;
  pubkey: string;
  relays: string[];
};

const now = () => Math.floor(Date.now() / 1000);
const fallbackProfileImage = require('../../assets/miss-profile.png');
const TENOR_API_KEY = 'AIzaSyB692q5nvoGphnMusHRvm1D_98a-DSQJRA';
const TENOR_LIMIT = 24;
const COMPOSER_KIND_TABS: Array<SegmentedTab<ComposerKindTabId>> = [
  {id: 'note', label: 'Note'},
  {id: 'media', label: 'Media'},
  {id: 'event', label: 'Events'},
  {id: 'poll', label: 'Poll'},
];
const EVENT_CATEGORIES: EventCategory[] = [
  'training',
  'match',
  'meeting',
  'social',
];

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

function imetaTagFromUpload(image: SelectedImage) {
  if (!image.uploadUrl) return null;
  const tag = ['imeta', `url ${image.uploadUrl}`];
  const uploadTags = image.uploadTags || [];
  const fields = new Map(uploadTags.map(item => [item[0], item[1]]));
  const dim =
    fields.get('dim') ||
    (image.width && image.height
      ? `${Math.round(image.width)}x${Math.round(image.height)}`
      : '');
  const mimeType = fields.get('m') || image.mimeType || '';
  const sha256Hex = fields.get('x') || '';
  const alt = fields.get('alt') || image.fileName || '';

  if (mimeType) tag.push(`m ${mimeType}`);
  if (dim) tag.push(`dim ${dim}`);
  if (sha256Hex) tag.push(`x ${sha256Hex}`);
  if (alt) tag.push(`alt ${alt}`);

  return tag;
}

function isTag(tag: string[] | null): tag is string[] {
  return Array.isArray(tag);
}

function hasContentPart(value: string | undefined | null): value is string {
  return Boolean(value?.trim());
}

function waitForNextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

function relaySetRole(d: string): CommunityRole {
  if (d.includes('admin')) return 'Admin';
  if (d.includes('member')) return 'Member';
  return 'Following';
}

function communityList(roleSets: RelayRoleSetSnapshot[]) {
  const seen = new Set<string>();
  const communities: Array<{url: string; role: CommunityRole}> = [];

  roleSets.forEach(roleSet => {
    const role = relaySetRole(roleSet.d);
    roleSet.relays.forEach(relay => {
      const url = normalizeRelayUrl(relay);
      if (!url || seen.has(url)) return;
      seen.add(url);
      communities.push({url, role});
    });
  });

  return communities;
}

function defaultDateTimeLocal(hoursFromNow: number) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function timestampFromLocal(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : now();
}

function slugFromTitle(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `event-${Date.now()}`;
}

export function PostModal({ reply, quote, onClose }: Props) {
  const theme = useAppTheme();
  const styles = useMemo(() => createPostModalStyles(theme), [theme]);
  const closeModal = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

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
  const iconColor = theme.colors.primaryContent;
  const editorRef = useRef<EnrichedTextInputInstance>(null);
  const scrollRef = useRef<ScrollView>(null);
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
  const [pollType, setPollType] = useState<PollType>('singlechoice');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollEndsAt, setPollEndsAt] = useState<number | null>(null);
  const [replyNote, setReplyNote] = useState<ParsedEvent | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<ParsedEvent[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionFinished, setMentionFinished] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const keyboardOpen = useKeyboardState(state => state.isVisible);
  const keyboardHeight = useKeyboardState(state => state.height);
  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(320);
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
    reply || quote ? 'compose' : 'setup',
  );
  const [composeMode, setComposeMode] = useState<ComposeMode>('note');
  const [selectedRelay, setSelectedRelay] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventSummary, setEventSummary] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventCategory, setEventCategory] = useState<EventCategory>('social');
  const [eventStartsAt, setEventStartsAt] = useState(defaultDateTimeLocal(24));
  const [eventEndsAt, setEventEndsAt] = useState('');
  const [eventCapacity, setEventCapacity] = useState('');
  const destinationLabel = selectedRelay ? relayLabel(selectedRelay) : 'Public';
  const isEventMode = composeMode === 'event';
  const isMediaMode = composeMode === 'media';
  const canSubmitEvent = Boolean(
    selectedRelay && eventTitle.trim() && eventStartsAt,
  );
  const effectivePublishRelays = useMemo(
    () => (selectedRelay ? [selectedRelay] : relays),
    [relays, selectedRelay],
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
            (isMediaMode && selectedImages.length) ||
            (pollEnabled && validPollOptions.length >= 2),
        )
    );
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
      : `Post to ${destinationLabel}`;

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
    if (!noteTarget?.id) return;
    const timeout = setTimeout(scrollToComposer, 120);
    return () => clearTimeout(timeout);
  }, [replyNote, noteTarget, scrollToComposer]);

  useEffect(() => {
    if (!keyboardOpen) return;
    if (keyboardHeight > 0) setLastKeyboardHeight(keyboardHeight);
    const timeout = setTimeout(scrollToComposer, 80);
    return () => clearTimeout(timeout);
  }, [keyboardHeight, keyboardOpen, scrollToComposer]);

  const contentContainerStyle = useMemo(
    () => [
      styles.content,
      keyboardOpen || activePanel
        ? {
            paddingBottom: Math.max(
              86,
              (keyboardOpen ? keyboardHeight : lastKeyboardHeight) + 86,
            ),
          }
        : null,
    ],
    [
      activePanel,
      keyboardHeight,
      keyboardOpen,
      lastKeyboardHeight,
      styles.content,
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

  const selectDestination = useCallback((relay: string) => {
    setSelectedRelay(relay);
    setStep('compose');
  }, []);

  const selectComposeMode = useCallback((mode: ComposeMode) => {
    setComposeMode(mode);
    setPollEnabled(mode === 'poll');
    if (mode !== 'media') {
      setSelectedImages([]);
    }
    if (mode !== 'poll') {
      setPollType('singlechoice');
      setPollOptions(['', '']);
      setPollEndsAt(null);
    }
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

  const submitEvent = useCallback(() => {
    if (!canSubmitEvent || !pubkey || !hasSigner) return;
    setIsSubmitting(true);
    setSubmitStatusIfMounted('Publishing event...');

    try {
      const title = eventTitle.trim();
      const summary = eventSummary.trim();
      const capacity = eventCapacity
        ? Math.max(1, Math.floor(Number(eventCapacity)))
        : 0;
      const tags: string[][] = [
        ['d', slugFromTitle(title)],
        ['title', title],
        ['summary', summary],
        ['start', String(timestampFromLocal(eventStartsAt))],
        ['t', eventCategory],
        ['client', 'nutscash'],
      ];
      if (eventEndsAt) tags.push(['end', String(timestampFromLocal(eventEndsAt))]);
      if (eventLocation.trim()) tags.push(['location', eventLocation.trim()]);
      if (capacity) tags.push(['capacity', String(capacity)]);

      const event: EventTemplate = {
        kind: 31923,
        content: summary,
        created_at: now(),
        tags,
      };
      const sendId = `community_event_${Date.now()}`;
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
        {defaultRelays: [selectedRelay], trackStatus: true},
      );

      if (mountedRef.current) {
        setEventTitle('');
        setEventSummary('');
        setEventLocation('');
        setEventCapacity('');
        setEventCategory('social');
        setEventStartsAt(defaultDateTimeLocal(24));
        setEventEndsAt('');
        setSubmitStatus(null);
        onClose();
      }
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  }, [
    canSubmitEvent,
    eventCapacity,
    eventCategory,
    eventEndsAt,
    eventLocation,
    eventStartsAt,
    eventSummary,
    eventTitle,
    hasSigner,
    onClose,
    pubkey,
    selectedRelay,
    setSubmitStatusIfMounted,
    updateSendStatus,
  ]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    if (isEventMode) {
      submitEvent();
      return;
    }
    setIsSubmitting(true);

    try {
      const activeImages = isMediaMode ? selectedImages : [];
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
        tags: baseTags,
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
          subId: noteTarget?.id
            ? [`f_${noteTarget.id}`, `replies_${noteTarget.id}`]
            : undefined,
        },
      );

      if (mountedRef.current) {
        editorRef.current?.setValue('');
        setText('');
        setSelectedMentions([]);
        setSelectedImages([]);
        setSubmitStatus(null);
        setActivePanel(null);
        setPollEnabled(false);
        setPollOptions(['', '']);
        setPollType('singlechoice');
        setPollEndsAt(null);
        onClose();
      }
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  }, [
    canSubmit,
    onClose,
    pollEnabled,
    pollEndsAt,
    pollType,
    quote,
    reply,
    replyNote,
    quoteTarget,
    noteTarget,
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
    isMediaMode,
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
      setComposeMode('media');
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
    setSelectedImages(current => current.filter(image => image.uri !== uri));
  }, []);

  const insertRemoteImage = useCallback(
    (uri: string, width: number, height: number) => {
      setComposeMode('media');
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
      const media = gif.media_formats.gif || gif.media_formats.mediumgif || gif.media_formats.tinygif;
      if (!media?.url) return;
      const [width, height] = media.dims || [320, 240];
      insertRemoteImage(media.url, width, height);
      setActivePanel(null);
      refocusComposer();
    },
    [insertRemoteImage, refocusComposer],
  );

  const openNativeMediaPicker = useCallback(async () => {
    setComposeMode('media');
    setActivePanel(null);
    editorRef.current?.focus();

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      refocusComposer();
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
      editorRef.current?.focus();

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

    refocusComposer();
  }, [insertImage, refocusComposer]);

  const showComposerAccessory = activePanel !== 'gif';

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
          : "What's up?";

  const mediaCaptionInput = (
    <View style={styles.mediaCaptionAccessory}>
      <EnrichedTextInput
        ref={editorRef}
        autoFocus
        autoCapitalize="sentences"
        mentionIndicators={['@']}
        placeholder={editorPlaceholder}
        placeholderTextColor={theme.colors.primaryContent}
        selectionColor={theme.colors.primary}
        cursorColor={theme.colors.primary}
        linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
        scrollEnabled
        onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
          setText(event.nativeEvent.value)
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
        style={styles.mediaCaptionEditor}
      />
    </View>
  );

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
        <ComposerToolbar
          activePanel={activePanel}
          onInsertImage={insertImage}
          onMediaPress={openNativeMediaPicker}
          onGifPress={() => {
            setComposeMode('media');
            openComposerPanel('gif');
          }}
        />
      ) : null}
      {step === 'compose' && composeMode === 'media' ? (
        mediaCaptionInput
      ) : null}
    </>
  );

  return (
    <PostModalStylesContext.Provider value={styles}>
      <View style={styles.root}>
      {activePanel !== 'gif' ? (
        <>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Close post composer"
              accessibilityRole="button"
              style={styles.iconButton}
              hitSlop={12}
              onPress={closeModal}
            >
              {Platform.OS === 'android' ? (
                <X size={22} color={iconColor} strokeWidth={2.3} />
              ) : (
                <ChevronDown size={23} color={iconColor} strokeWidth={2.3} />
              )}
            </Pressable>
            <Pressable
              style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
              disabled={!canSubmit}
              onPress={submit}
            >
              <Text style={styles.submitText} numberOfLines={1}>
                {submitLabel}
              </Text>
              <Send size={16} color={theme.button.primary.text} strokeWidth={2.4} />
            </Pressable>
          </View>
          {step === 'compose' && !noteTarget?.id ? (
            <View style={styles.topModeBar}>
              <ModeSelector
                activeMode={composeMode}
                onSelectMode={selectComposeMode}
              />
            </View>
          ) : null}
        </>
      ) : null}
      <ScrollView
        ref={scrollRef}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={contentContainerStyle}
        onScrollBeginDrag={Keyboard.dismiss}
        scrollEventThrottle={16}
      >
        {!pubkey || !hasSigner ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Connect a signer before publishing posts.
            </Text>
          </View>
        ) : null}

        {step === 'setup' ? (
          <ComposerSetup
            communities={communityOptions}
            onSelect={selectDestination}
          />
        ) : null}

        {step === 'compose' && isEventMode ? (
          <EventComposer
            category={eventCategory}
            capacity={eventCapacity}
            endsAt={eventEndsAt}
            location={eventLocation}
            startsAt={eventStartsAt}
            summary={eventSummary}
            title={eventTitle}
            onChangeCategory={setEventCategory}
            onChangeCapacity={setEventCapacity}
            onChangeEndsAt={setEventEndsAt}
            onChangeLocation={setEventLocation}
            onChangeStartsAt={setEventStartsAt}
            onChangeSummary={setEventSummary}
            onChangeTitle={setEventTitle}
          />
        ) : null}

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
              <Text style={styles.replyLoadingText}>Loading note...</Text>
            </View>
          )
        ) : null}

        {step === 'compose' && !isEventMode && composeMode !== 'media' ? (
        <View
          style={[
            styles.editorShell,
            composeMode === 'poll' && styles.pollEditorShell,
            noteTarget && styles.replyEditorShell,
          ]}
          onLayout={event => {
            editorYRef.current = event.nativeEvent.layout.y;
            editorHeightRef.current = event.nativeEvent.layout.height;
            editorWidthRef.current = event.nativeEvent.layout.width;
          }}
        >
          <EnrichedTextInput
            ref={editorRef}
            autoFocus
            autoCapitalize="sentences"
            mentionIndicators={['@']}
            placeholder={editorPlaceholder}
            placeholderTextColor={theme.colors.primaryContent}
            selectionColor={theme.colors.primary}
            cursorColor={theme.colors.primary}
            linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
            scrollEnabled
            onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
              setText(event.nativeEvent.value)
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
            style={
              noteTarget
                ? styles.replyEditor
                : composeMode === 'poll'
                    ? styles.pollEditor
                    : styles.editor
            }
          />
        </View>
        ) : null}

        {step === 'compose' && isMediaMode && !selectedImages.length ? (
          <MediaComposerPrompt onPickMedia={openNativeMediaPicker} />
        ) : null}

        {step === 'compose' && isMediaMode && selectedImages.length ? (
          <SelectedMediaGrid images={selectedImages} onRemove={removeImage} />
        ) : null}

        {step === 'compose' && isMediaMode && !keyboardOpen ? (
          mediaCaptionInput
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

      </ScrollView>

      {showComposerAccessory && keyboardOpen ? (
        <KeyboardStickyView
          offset={{closed: 0, opened: 0}}
          style={[
            styles.toolbarAccessory,
            styles.keyboardAccessory,
          ]}
        >
          {composerAccessory}
        </KeyboardStickyView>
      ) : showComposerAccessory && activePanel ? (
        <View style={[styles.toolbarAccessory, styles.keyboardAccessory]}>
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
              refocusComposer();
            }}
          />
        </View>
      ) : null}
    </View>
    </PostModalStylesContext.Provider>
  );
}

function ComposerSetup({
  communities,
  onSelect,
}: {
  communities: Array<{url: string; role: CommunityRole}>;
  onSelect: (relay: string) => void;
}) {
  const styles = usePostModalStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.setupPanel}>
      <View>
        <Text style={styles.setupKicker}>New post</Text>
        <Text style={styles.setupTitle}>Where should it go?</Text>
      </View>
      <View style={styles.destinationGrid}>
        <Pressable style={styles.destinationCardPrimary} onPress={() => onSelect('')}>
          <View>
            <Globe2 size={20} color={theme.colors.info} strokeWidth={2.3} />
            <Text style={styles.destinationCardTitle}>Public</Text>
          </View>
          <Text style={styles.destinationCardMeta}>Your write relays</Text>
        </Pressable>
        {communities.map(community => (
          <Pressable
            key={community.url}
            style={styles.destinationCard}
            onPress={() => onSelect(community.url)}
          >
            <View style={styles.destinationCardCopy}>
              <Users size={20} color={theme.colors.primaryContent} strokeWidth={2.3} />
              <Text style={styles.destinationCardTitle} numberOfLines={1}>
                {relayLabel(community.url)}
              </Text>
            </View>
            <Text style={styles.destinationCardMeta} numberOfLines={1}>
              {community.role}
            </Text>
          </Pressable>
        ))}
      </View>
      {!communities.length ? (
        <Text style={styles.setupEmpty}>No communities found yet. Public is available.</Text>
      ) : null}
    </View>
  );
}

function ModeSelector({
  activeMode,
  onSelectMode,
}: {
  activeMode: ComposeMode;
  onSelectMode: (mode: ComposeMode) => void;
}) {
  return (
    <SegmentedTabs
      tabs={COMPOSER_KIND_TABS}
      selectedId={activeMode}
      onSelect={onSelectMode}
      layout="scroll"
    />
  );
}

function MediaComposerPrompt({onPickMedia}: {onPickMedia: () => void}) {
  const styles = usePostModalStyles();
  const theme = useAppTheme();
  return (
    <Pressable style={styles.mediaPrompt} onPress={onPickMedia}>
      <View style={styles.mediaPromptFrame}>
        <View style={styles.mediaPromptIcon}>
          <ImageIcon size={28} color={theme.colors.primary} strokeWidth={2.2} />
        </View>
      </View>
      <Text style={styles.mediaPromptTitle}>Add photos or GIFs</Text>
      <Text style={styles.mediaPromptText}>Choose from your library, open camera, or search GIFs below.</Text>
    </Pressable>
  );
}

function EventComposer({
  category,
  capacity,
  endsAt,
  location,
  onChangeCapacity,
  onChangeCategory,
  onChangeEndsAt,
  onChangeLocation,
  onChangeStartsAt,
  onChangeSummary,
  onChangeTitle,
  startsAt,
  summary,
  title,
}: {
  category: EventCategory;
  capacity: string;
  endsAt: string;
  location: string;
  onChangeCapacity: (value: string) => void;
  onChangeCategory: (value: EventCategory) => void;
  onChangeEndsAt: (value: string) => void;
  onChangeLocation: (value: string) => void;
  onChangeStartsAt: (value: string) => void;
  onChangeSummary: (value: string) => void;
  onChangeTitle: (value: string) => void;
  startsAt: string;
  summary: string;
  title: string;
}) {
  const styles = usePostModalStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.eventBox}>
      <TextInput
        autoFocus
        value={title}
        onChangeText={onChangeTitle}
        placeholder="Event title"
        placeholderTextColor={theme.colors.primaryContent}
        style={styles.eventInput}
      />
      <TextInput
        value={summary}
        onChangeText={onChangeSummary}
        placeholder="Short summary"
        placeholderTextColor={theme.colors.primaryContent}
        multiline
        style={[styles.eventInput, styles.eventSummary]}
      />
      <View style={styles.eventTwoColumn}>
        <TextInput
          value={startsAt}
          onChangeText={onChangeStartsAt}
          placeholder="Starts: 2026-06-30T18:00"
          placeholderTextColor={theme.colors.primaryContent}
          style={[styles.eventInput, styles.eventHalfInput]}
        />
        <TextInput
          value={endsAt}
          onChangeText={onChangeEndsAt}
          placeholder="Ends"
          placeholderTextColor={theme.colors.primaryContent}
          style={[styles.eventInput, styles.eventHalfInput]}
        />
      </View>
      <View style={styles.eventTwoColumn}>
        <TextInput
          value={location}
          onChangeText={onChangeLocation}
          placeholder="Location"
          placeholderTextColor={theme.colors.primaryContent}
          style={[styles.eventInput, styles.eventHalfInput]}
        />
        <TextInput
          value={capacity}
          onChangeText={onChangeCapacity}
          placeholder="Capacity"
          placeholderTextColor={theme.colors.primaryContent}
          keyboardType="number-pad"
          style={[styles.eventInput, styles.eventHalfInput]}
        />
      </View>
      <View style={styles.categoryRow}>
        {EVENT_CATEGORIES.map(item => (
          <Pressable
            key={item}
            style={[
              styles.categoryButton,
              category === item && styles.categoryButtonActive,
            ]}
            onPress={() => onChangeCategory(item)}
          >
            <Text
              style={[
                styles.categoryText,
                category === item && styles.categoryTextActive,
              ]}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
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
  const styles = usePostModalStyles();
  return (
    <View style={styles.mentionBox}>
      {loading ? (
        <View style={styles.mentionStateRow}>
          <Text style={styles.mentionStateText}>Searching...</Text>
        </View>
      ) : null}
      {candidates.length ? (
        <ScrollView
          style={styles.mentionScroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {candidates.map(candidate => {
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
                    contentFit="cover"
                    cachePolicy="memory-disk"
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
          })}
        </ScrollView>
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

function SelectedMediaGrid({
  images,
  onRemove,
}: {
  images: SelectedImage[];
  onRemove: (uri: string) => void;
}) {
  const styles = usePostModalStyles();
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
          const overlayLabel = uploaded
            ? 'Uploaded'
            : failed
              ? 'Failed'
              : '';
          const badgeLabel = image.status === 'waiting' ? `${index + 1}` : '';

          return (
            <View
              key={image.uri}
              style={[
                styles.selectedMediaTile,
                failed && styles.selectedMediaTileFailed,
              ]}
            >
              <Image
                source={{uri: image.uri}}
                style={styles.selectedMediaImage}
                contentFit="cover"
              />
              {!image.remote && (uploading || uploaded || failed) ? (
                <View style={styles.selectedMediaOverlay}>
                  {uploading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.selectedMediaStateText}>
                      {uploaded ? '✓' : '!'}
                    </Text>
                  )}
                  {overlayLabel ? (
                    <Text style={styles.selectedMediaStatusLabel}>
                      {overlayLabel}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {!image.remote && badgeLabel ? (
                <Text style={styles.selectedMediaBadge}>
                  {badgeLabel}
                </Text>
              ) : null}
              {!uploading ? (
                <Pressable
                  accessibilityLabel="Remove media"
                  hitSlop={8}
                  style={styles.mediaRemove}
                  onPress={() => onRemove(image.uri)}
                >
                  <X size={13} color="#ffffff" strokeWidth={2.5} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {errors.length ? (
        <View style={styles.selectedMediaErrors}>
          {errors.map(error => (
            <Text key={error} style={styles.selectedMediaError}>
              {error}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ComposerToolbar({
  activePanel,
  onInsertImage,
  onMediaPress,
  onGifPress,
}: {
  activePanel: ComposerPanel | null;
  onInsertImage: (
    uri: string,
    width: number,
    height: number,
    mimeType?: string | null,
    fileName?: string | null,
  ) => void;
  onMediaPress: () => void;
  onGifPress: () => void;
}) {
  const styles = usePostModalStyles();
  const theme = useAppTheme();
  const inactiveIconColor = theme.colors.primaryContent;
  const activeIconColor = '#ffffff';
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
    <View style={styles.toolbar}>
      <ToolbarButton
        accessibilityLabel="Add media"
        icon={<ImageIcon size={19} color={inactiveIconColor} />}
        onPress={onMediaPress}
      />
      <ToolbarButton
        accessibilityLabel="Open camera"
        icon={<Camera size={19} color={inactiveIconColor} />}
        onPress={takePhoto}
      />
      <ToolbarButton
        accessibilityLabel="Add GIF"
        active={activePanel === 'gif'}
        icon={
          <Film
            size={19}
            color={activePanel === 'gif' ? activeIconColor : inactiveIconColor}
          />
        }
        onPress={onGifPress}
      />
    </View>
  );
}

function GifPicker({
  onSelect,
  onDone,
}: {
  onSelect: (gif: TenorGif) => void;
  onDone: () => void;
}) {
  const styles = usePostModalStyles();
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [featuredGifs, setFeaturedGifs] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const requestIdRef = useRef(0);

  const fetchTenorGifs = useCallback(
    async (endpoint: 'featured' | 'search', params: Record<string, string> = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const searchParams = new URLSearchParams({
          key: TENOR_API_KEY,
          limit: String(TENOR_LIMIT),
          media_filter: 'gif,tinygif,mediumgif',
          ...params,
        });
        const response = await fetch(
          `https://tenor.googleapis.com/v2/${endpoint}?${searchParams}`,
        );

        if (!response.ok) {
          throw new Error(`Tenor request failed with status ${response.status}`);
        }

        const data = (await response.json()) as {results?: TenorGif[]};
        if (requestId !== requestIdRef.current) return;
        const results = data.results || [];
        setGifs(results);
        if (endpoint === 'featured') setFeaturedGifs(results);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load GIFs');
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchTenorGifs('featured');
  }, [fetchTenorGifs]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 80);

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const timeout = setTimeout(() => {
      if (!trimmed) {
        setGifs(featuredGifs);
        return;
      }
      fetchTenorGifs('search', {q: trimmed});
    }, trimmed ? 450 : 0);

    return () => clearTimeout(timeout);
  }, [featuredGifs, fetchTenorGifs, query]);

  const renderGif = useCallback(
    ({item}: {item: TenorGif}) => {
      const thumb = item.media_formats.tinygif || item.media_formats.mediumgif || item.media_formats.gif;
      if (!thumb?.url) return null;

      return (
        <Pressable
          style={styles.gifTile}
          accessibilityRole="button"
          accessibilityLabel={item.content_description || 'Select GIF'}
          onPress={() => onSelect(item)}
        >
          <Image
            source={{uri: thumb.url}}
            style={styles.gifTileImage}
            contentFit="cover"
          />
        </Pressable>
      );
    },
    [onSelect, styles],
  );

  return (
    <View style={styles.panel}>
      <View style={styles.gifStickyHeader}>
        <BlurView intensity={42} tint="systemMaterial" style={styles.gifSearchBox}>
          <Search size={16} color={theme.colors.primaryContent} />
          <TextInput
            ref={searchInputRef}
            value={query}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search GIFs"
            placeholderTextColor={theme.colors.primaryContent}
            style={styles.gifSearchInput}
            returnKeyType="search"
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const trimmed = query.trim();
              if (trimmed) fetchTenorGifs('search', {q: trimmed});
            }}
          />
        </BlurView>
        <Pressable style={styles.gifDoneButton} onPress={onDone}>
          <Text style={styles.panelDoneText}>OK</Text>
        </Pressable>
      </View>
      {loading && gifs.length === 0 ? (
        <View style={styles.panelEmpty}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.panelEmpty}>
          <Film size={30} color={theme.colors.primaryContent} />
          <Text style={styles.panelEmptyTitle}>Could not load GIFs</Text>
          <Text style={styles.panelEmptyText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={gifs}
          keyExtractor={item => item.id}
          numColumns={2}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.gifGridContent}
          columnWrapperStyle={styles.gifGridRow}
          renderItem={renderGif}
          ListEmptyComponent={
            <View style={styles.panelEmpty}>
              <Text style={styles.panelEmptyTitle}>No GIFs found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function ToolbarButton({
  accessibilityLabel,
  active = false,
  disabled = false,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  const styles = usePostModalStyles();
  return (
    <Pressable
      style={[
        styles.toolbarButton,
        active && styles.toolbarButtonActive,
        disabled && styles.toolbarButtonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
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
  const styles = usePostModalStyles();
  const theme = useAppTheme();
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
            placeholderTextColor={theme.colors.primaryContent}
            value={option}
            onChangeText={value => updateOption(index, value)}
          />
          {options.length > 2 ? (
            <Pressable
              style={styles.pollRemove}
              hitSlop={8}
              onPress={() => removeOption(index)}
            >
              <X size={17} color={theme.colors.primaryContent} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.pollFooter}>
        {options.length < 10 ? (
          <Pressable style={styles.addOption} onPress={addOption}>
            <Plus size={16} color={theme.colors.primaryContent} strokeWidth={2.3} />
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
              <X size={14} color={theme.colors.primaryContent} strokeWidth={2.2} />
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

function readableContentColor(theme: AppTheme) {
  return theme.id === 'snowwhite' || theme.id === 'touchgrass'
    ? '#1a1a1a'
    : '#f8fafc';
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
  },
  topModeBar: {
    paddingTop: 10,
    paddingBottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
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
    maxWidth: '78%',
    minWidth: 82,
    height: 38,
    borderRadius: 19,
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
  content: {
    padding: 16,
    gap: 12,
  },
  contentWithKeyboardAccessory: {
    paddingBottom: 86,
  },
  setupPanel: {
    gap: 16,
    paddingBottom: 16,
  },
  setupKicker: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    fontWeight: '600',
  },
  setupTitle: {
    marginTop: 2,
    color: contentColor,
    fontSize: 20,
    fontWeight: '700',
  },
  setupEmpty: {
    color: theme.colors.primaryContent,
    fontSize: 13,
    fontWeight: '500',
  },
  destinationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  destinationCard: {
    width: '48.5%',
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base200,
    padding: 12,
    justifyContent: 'space-between',
  },
  destinationCardPrimary: {
    width: '48.5%',
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.info,
    backgroundColor: theme.colors.base200,
    padding: 12,
    justifyContent: 'space-between',
  },
  destinationCardCopy: {
    minWidth: 0,
  },
  destinationCardTitle: {
    marginTop: 8,
    color: contentColor,
    fontSize: 15,
    fontWeight: '700',
  },
  destinationCardMeta: {
    color: theme.colors.primaryContent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  eventBox: {
    alignSelf: 'stretch',
    width: '100%',
    gap: 10,
  },
  eventInput: {
    minHeight: 44,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
    color: contentColor,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '600',
  },
  eventSummary: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  eventTwoColumn: {
    flexDirection: 'row',
    gap: 8,
  },
  eventHalfInput: {
    flex: 1,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 5,
    borderRadius: 8,
    backgroundColor: theme.colors.base100,
    padding: 4,
  },
  categoryButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  categoryText: {
    color: theme.colors.primaryContent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  categoryTextActive: {
    color: theme.button.primary.text,
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
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyLoadingText: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    fontWeight: '600',
  },
  editorShell: {
    height: 128,
    overflow: 'hidden',
  },
  replyEditorShell: {
    height: 104,
  },
  pollEditorShell: {
    height: 86,
  },
  editor: {
    height: 128,
    padding: 14,
    fontSize: 17,
    lineHeight: 24,
    color: contentColor,
  },
  pollEditor: {
    height: 86,
    padding: 14,
    fontSize: 17,
    lineHeight: 24,
    color: contentColor,
  },
  replyEditor: {
    height: 104,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 22,
    color: contentColor,
  },
  mediaCaptionAccessory: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base300,
    overflow: 'hidden',
  },
  mediaCaptionEditor: {
    minHeight: 52,
    maxHeight: 112,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 20,
    color: contentColor,
    textAlignVertical: 'top',
  },
  mentionBox: {
    maxHeight: 216,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base300,
    overflow: 'hidden',
  },
  mentionScroll: {
    maxHeight: 216,
  },
  mentionRow: {
    minHeight: 54,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.base200,
  },
  mentionStateRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionStateText: {
    color: theme.colors.primaryContent,
    fontSize: 13,
    fontWeight: '600',
  },
  mentionAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.base200,
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
    color: contentColor,
    fontSize: 14,
    fontWeight: '700',
  },
  mentionHandle: {
    color: theme.colors.primaryContent,
    fontSize: 12,
    marginTop: 2,
  },
  toolbar: {
    minHeight: 54,
    backgroundColor: theme.colors.base100,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
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
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  toolbarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  toolbarButtonDisabled: {
    opacity: 0.35,
  },
  panel: {
    flex: 1,
    backgroundColor: theme.colors.base100,
    paddingHorizontal: 12,
  },
  panelHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  panelTitle: {
    color: contentColor,
    fontSize: 15,
    fontWeight: '800',
  },
  panelAction: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.base300,
  },
  panelActionText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelDone: {
    minHeight: 34,
    minWidth: 48,
    borderRadius: 17,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  panelDoneText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  panelEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  panelEmptyTitle: {
    marginTop: 10,
    color: contentColor,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  panelEmptyText: {
    marginTop: 5,
    color: theme.colors.primaryContent,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  gifStickyHeader: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gifSearchBox: {
    flex: 1,
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  gifSearchInput: {
    flex: 1,
    minWidth: 0,
    color: contentColor,
    fontSize: 15,
    paddingVertical: 8,
  },
  gifDoneButton: {
    minHeight: 42,
    minWidth: 50,
    borderRadius: 21,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  gifGridContent: {
    paddingTop: 64,
    paddingBottom: 12,
  },
  gifGridRow: {
    gap: 8,
    marginBottom: 8,
  },
  gifTile: {
    flex: 1,
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: theme.colors.base200,
    overflow: 'hidden',
  },
  gifTileImage: {
    width: '100%',
    height: '100%',
  },
  panelPrimaryAction: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 16,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  panelPrimaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  mediaListContent: {
    paddingBottom: 18,
  },
  mediaAsset: {
    aspectRatio: 1,
    margin: 3,
    borderRadius: 8,
    backgroundColor: theme.colors.base200,
    overflow: 'hidden',
  },
  mediaAssetImage: {
    width: '100%',
    height: '100%',
  },
  mediaTypeBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  mediaTypeBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  mediaPrompt: {
    minHeight: 260,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base200,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  mediaPromptFrame: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 178,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.primaryContent,
    backgroundColor: theme.colors.base300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaPromptIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.base100,
  },
  mediaPromptTitle: {
    color: contentColor,
    fontSize: 17,
    fontWeight: '900',
  },
  mediaPromptText: {
    maxWidth: 260,
    color: theme.colors.primaryContent,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  mediaSelectBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaSelectBadgeActive: {
    backgroundColor: theme.colors.primary,
  },
  mediaSelectBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  selectedMediaBlock: {
    gap: 10,
  },
  selectedMediaGrid: {
    gap: 10,
  },
  selectedMediaTile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: theme.colors.base200,
    overflow: 'hidden',
  },
  selectedMediaTileFailed: {
    borderWidth: 1,
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
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  selectedMediaStateText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
  },
  selectedMediaStatusLabel: {
    marginTop: 5,
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
    textAlign: 'center',
  },
  selectedMediaBadge: {
    position: 'absolute',
    left: 10,
    top: 10,
    minWidth: 28,
    maxWidth: 84,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 28,
    textAlign: 'center',
  },
  selectedMediaErrors: {
    gap: 4,
  },
  selectedMediaError: {
    color: theme.colors.error,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  mediaRemove: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollBox: {
    alignSelf: 'stretch',
    width: '100%',
    gap: 10,
  },
  segmented: {
    height: 36,
    borderRadius: 8,
    backgroundColor: theme.colors.base200,
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
    backgroundColor: theme.colors.base300,
  },
  segmentText: {
    color: theme.colors.primaryContent,
    fontWeight: '700',
    fontSize: 13,
  },
  segmentTextActive: {
    color: contentColor,
  },
  pollOptionRow: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.base200,
    backgroundColor: theme.colors.base100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  pollInput: {
    flex: 1,
    minHeight: 42,
    color: contentColor,
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
    color: theme.colors.primaryContent,
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
    backgroundColor: theme.colors.base200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationButtonActive: {
    backgroundColor: theme.colors.base200,
  },
  durationText: {
    color: theme.colors.primaryContent,
    fontWeight: '700',
    fontSize: 12,
  },
  });
}
