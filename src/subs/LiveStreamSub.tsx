import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import {VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource} from 'expo-video';
import type {ConnectionStatus, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {usePublish as publishToNostr, useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1311,
  asParsedEvent,
  asPreGeneric,
  fbArray,
  isConnectionStatus,
  isParsedEvent,
} from '@candypoets/nipworker/utils';
import {Calendar, ExternalLink, MessageCircle, Radio, Send} from 'lucide-react-native';
import {decode, type EventPointer} from 'nostr-tools/nip19';
import type {EventTemplate} from 'nostr-tools';
import {KeyboardStickyView} from 'react-native-keyboard-controller';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useAuthStore, useNostrStore, useRelayStore, useSendStatusStore} from '../stores';
import {useAppTheme} from '../theme';
import {Avatar} from '../components/notes/Avatar';
import {ContentBlocks} from '../components/notes/ContentBlocks';
import {User} from '../components/notes/User';
import {eventTags, formatTimestamp, stringValue, tagValue} from '../components/notes/kindHelpers';

type LiveStreamSubProps = {
  nevent: string;
  visible: boolean;
};

const LIVE_EVENT_BYTES_PER_EVENT = 96 * 1024;
const CHAT_BYTES_PER_EVENT = 32 * 1024;

function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function decodeEventPointer(nevent: string): EventPointer {
  try {
    const decoded = decode(nevent) as unknown as {data?: EventPointer};
    return decoded?.data ?? ({id: '', relays: []} as EventPointer);
  } catch (error) {
    console.warn('[live-stream] failed to decode nevent', error);
    return {id: '', relays: []} as EventPointer;
  }
}

function pointerRelays(data: EventPointer) {
  return [...new Set((data.relays ?? []).filter(Boolean).map(normalizeRelayUrl))];
}

function statusLabel(status: string) {
  if (status === 'live') return 'Live Now';
  if (status === 'ended') return 'Ended';
  return 'Upcoming';
}

function formatTimeAgo(timestamp: number) {
  const diff = Date.now() - timestamp * 1000;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${days}d`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function sourceForStream(streamUrl: string): VideoSource {
  const lowerUrl = streamUrl.toLowerCase();
  const isHls = lowerUrl.includes('.m3u8') || lowerUrl.includes('m3u8');
  return isHls ? {uri: streamUrl, contentType: 'hls'} : {uri: streamUrl};
}

function LiveVideo({
  streamUrl,
  onStatusChange,
}: {
  streamUrl: string;
  onStatusChange: (status: VideoPlayerStatus, errorMessage?: string) => void;
}) {
  const source = useMemo(() => sourceForStream(streamUrl), [streamUrl]);
  const player = useVideoPlayer(source, nextPlayer => {
    nextPlayer.loop = false;
    nextPlayer.muted = false;
    nextPlayer.volume = 1;
    nextPlayer.audioMixingMode = 'doNotMix';
    nextPlayer.timeUpdateEventInterval = 0.5;
    nextPlayer.showNowPlayingNotification = false;
    nextPlayer.staysActiveInBackground = false;
  });

  useEffect(() => {
    const statusSub = player.addListener('statusChange', event => {
      onStatusChange(event.status, event.error?.message);
    });
    player.play();
    return () => {
      statusSub.remove();
    };
  }, [onStatusChange, player]);

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture
      startsPictureInPictureAutomatically={false}
      style={styles.video}
    />
  );
}

const ChatMessage = memo(function ChatMessage({item}: {item: ParsedEvent}) {
  const parsed = asKind1311(item);
  const content = parsed ? fbArray(parsed, 'parsedContent') : [];
  const fallbackContent = stringValue(parsed?.content()) || '';
  const pubkey = item.pubkey() || '';

  return (
    <View className="flex-row gap-2 px-4 py-2">
      <Avatar pubkey={pubkey} size="sm" link />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <User pubkey={pubkey} link className="max-w-[70%] text-sm font-semibold text-white" />
          <Text className="text-xs text-white/45">{formatTimeAgo(item.createdAt() || 0)}</Text>
        </View>
        {content.length ? (
          <ContentBlocks content={content} note={item} forceFullContent showMedia={false} />
        ) : (
          <Text className="mt-0.5 text-sm leading-5 text-white/82">{fallbackContent}</Text>
        )}
      </View>
    </View>
  );
});

export function LiveStreamSub({nevent, visible}: LiveStreamSubProps) {
  const theme = useAppTheme();
  const data = useMemo(() => decodeEventPointer(nevent), [nevent]);
  const eventId = data.id || '';
  const initialRelays = useMemo(() => pointerRelays(data), [data]);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [event, setEvent] = useState<ParsedEvent | null>(null);
  const [chatMessages, setChatMessages] = useState<ParsedEvent[]>([]);
  const [playerStatus, setPlayerStatus] = useState<VideoPlayerStatus>('idle');
  const [playerError, setPlayerError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState('');
  const seenChatIdsRef = useRef(new Set<string>());
  const eventUnsubRef = useRef<(() => void) | null>(null);
  const chatUnsubRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const relays = useMemo(
    () =>
      [
        ...new Set([
          ...readRelays,
          ...initialRelays,
          ...DEFAULT_FEED_RELAYS,
        ].map(normalizeRelayUrl)),
      ],
    [initialRelays, readRelays],
  );
  const publishRelays = useMemo(
    () => [
      ...new Set([
        ...(writeRelays.length ? writeRelays : []),
        ...relays,
      ].map(normalizeRelayUrl)),
    ],
    [relays, writeRelays],
  );

  useEffect(() => {
    if (!visible || !eventId) return undefined;
    const subId = `live_event_${eventId}_${relayHash(relays)}`;
    setSubRelays(subId, relays);
    relays.forEach(relay => setRelayStatus(relay, 'SUBSCRIBED'));
    eventUnsubRef.current?.();
    eventUnsubRef.current = subscribeToNostr(
      subId,
      [{kinds: [30311], ids: [eventId], limit: 1, relays, cacheFirst: true}],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          return;
        }

        const parsed = asParsedEvent(message);
        if (parsed?.id() === eventId && parsed.kind() === 30311) setEvent(parsed);
      },
      {bytesPerEvent: LIVE_EVENT_BYTES_PER_EVENT},
    );

    timeoutRef.current = setTimeout(() => {
      eventUnsubRef.current?.();
      eventUnsubRef.current = null;
    }, 5000);

    return () => {
      eventUnsubRef.current?.();
      eventUnsubRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [eventId, relays, setRelayStatus, setSubRelays, visible]);

  const generic = useMemo(() => (event ? asPreGeneric(event) : null), [event]);
  const tags = useMemo(() => (event ? eventTags(event) : []), [event]);
  const dTag = tagValue(tags, 'd');
  const title = stringValue(generic?.title()) || stringValue(generic?.content()) || 'Live event';
  const description = stringValue(generic?.description());
  const image = stringValue(generic?.image());
  const status = stringValue(generic?.status()) || 'planned';
  const streaming = stringValue(generic?.streaming());
  const recording = stringValue(generic?.recording());
  const streamUrl = status === 'live' ? streaming : recording || streaming;
  const startsAt = generic?.starts() && generic.starts() !== BigInt(0)
    ? formatTimestamp(generic.starts())
    : '';
  const aTag = event?.pubkey() && dTag ? `30311:${event.pubkey()}:${dTag}` : '';
  const hostPubkey = event?.pubkey() || '';
  const canSend = Boolean(
    pubkey &&
    hasSigner &&
    aTag &&
    chatInput.trim() &&
    !isSubmitting,
  );

  useEffect(() => {
    if (!visible || !aTag) return undefined;
    seenChatIdsRef.current.clear();
    setChatMessages([]);
    const subId = `livestream_chat_${eventId}_${dTag}_${relayHash(relays)}`;
    chatUnsubRef.current?.();
    chatUnsubRef.current = subscribeToNostr(
      subId,
      [{kinds: [1311], tags: {'#a': [aTag]}, limit: 80, relays}],
      message => {
        if (!isParsedEvent(message)) return;
        const parsed = asParsedEvent(message);
        if (!parsed || parsed.kind() !== 1311) return;
        const id = parsed.id();
        if (!id || seenChatIdsRef.current.has(id)) return;
        seenChatIdsRef.current.add(id);
        setChatMessages(current =>
          [...current, parsed].sort((left, right) => right.createdAt() - left.createdAt()),
        );
      },
      {bytesPerEvent: CHAT_BYTES_PER_EVENT},
    );

    return () => {
      chatUnsubRef.current?.();
      chatUnsubRef.current = null;
    };
  }, [aTag, dTag, eventId, relays, visible]);

  const openExternal = useCallback(() => {
    if (streamUrl) Linking.openURL(streamUrl).catch(() => {});
  }, [streamUrl]);
  const sendMessage = useCallback(() => {
    const content = chatInput.trim();
    if (!canSend || !content || !aTag) return;
    setIsSubmitting(true);
    setSendError('');
    Keyboard.dismiss();

    const post: EventTemplate = {
      kind: 1311,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [
        ['a', aTag],
        ...(hostPubkey ? [['p', hostPubkey]] : []),
        ['client', 'nutscash'],
      ],
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `livestream_chat_${eventId}_${Date.now()}`;

    publishToNostr(
      sendId,
      post,
      (message: WorkerMessage) => {
        const statusMessage = isConnectionStatus(message);
        const relayUrl = statusMessage?.relayUrl();
        if (!statusMessage || !relayUrl) return;
        sendStatus[relayUrl] = statusMessage;
        updateSendStatus(sendId, sendStatus);
        if (statusMessage.status()?.toString() === 'true') {
          setChatInput('');
          setIsSubmitting(false);
        }
      },
      {
        defaultRelays: publishRelays,
        subId: [`livestream_chat_${eventId}`, `live_event_${eventId}`],
        trackStatus: true,
      },
    );

    setTimeout(() => {
      setIsSubmitting(false);
      setSendError(current => current || 'Message may still be sending.');
    }, 5000);
  }, [
    aTag,
    canSend,
    chatInput,
    eventId,
    hostPubkey,
    publishRelays,
    updateSendStatus,
  ]);
  const handlePlayerStatusChange = useCallback(
    (nextStatus: VideoPlayerStatus, errorMessage?: string) => {
      setPlayerStatus(nextStatus);
      setPlayerError(errorMessage || '');
      if (nextStatus === 'error') {
        console.warn('[live-stream] player error', {streamUrl, errorMessage});
      }
    },
    [streamUrl],
  );
  const renderChatMessage = useCallback(
    ({item}: {item: ParsedEvent}) => <ChatMessage item={item} />,
    [],
  );

  return (
    <View className="flex-1 bg-black">
      <Pressable className="border-b border-white/10 bg-slate-950" onPress={Keyboard.dismiss}>
        <View className="aspect-video w-full items-center justify-center bg-black">
          {streamUrl ? (
            <LiveVideo streamUrl={streamUrl} onStatusChange={handlePlayerStatusChange} />
          ) : image ? (
            <Image source={{uri: image}} contentFit="cover" cachePolicy="memory-disk" style={styles.poster} />
          ) : (
            <View className="items-center gap-2">
              <Radio size={34} color={theme.colors.primary} />
              <Text className="text-sm text-white/60">No stream URL</Text>
            </View>
          )}
        </View>
      </Pressable>

      <Pressable className="border-b border-white/10 px-4 py-3" onPress={Keyboard.dismiss}>
        <View className="mb-2 flex-row items-center gap-2">
          <View className={status === 'live' ? 'flex-row items-center gap-1.5 rounded-full bg-red-500/25 px-2.5 py-1' : 'flex-row items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1'}>
            {status === 'live' ? <Radio size={14} color="#ffffff" /> : <Calendar size={14} color="#ffffff" />}
            <Text className="text-xs font-semibold text-white">{statusLabel(status)}</Text>
          </View>
          {startsAt ? <Text className="text-xs text-white/50">{startsAt}</Text> : null}
          {streamUrl ? (
            <Pressable className="ml-auto flex-row items-center gap-1" hitSlop={8} onPress={openExternal}>
              <ExternalLink size={14} color="rgba(255,255,255,0.64)" />
              <Text className="text-xs text-white/64">Open</Text>
            </Pressable>
          ) : null}
        </View>
        {streamUrl ? (
          <Text className="mb-1 text-xs text-white/45" numberOfLines={1} ellipsizeMode="middle">
            {playerStatus === 'error'
              ? `Player error${playerError ? `: ${playerError}` : ''}`
              : `Player: ${playerStatus}`}
          </Text>
        ) : null}
        {streamUrl ? (
          <Text className="mb-2 text-xs text-white/35" numberOfLines={1} ellipsizeMode="middle">
            {streamUrl}
          </Text>
        ) : null}
        <Text className="text-lg font-bold text-white" numberOfLines={2}>{title}</Text>
        {description ? (
          <Text className="mt-1 text-sm leading-5 text-white/70" numberOfLines={3}>{description}</Text>
        ) : null}
      </Pressable>

      <Pressable className="flex-row items-center gap-2 px-4 py-3" onPress={Keyboard.dismiss}>
        <MessageCircle size={18} color="rgba(255,255,255,0.78)" />
        <Text className="text-sm font-semibold text-white">Live chat</Text>
        <Text className="text-xs text-white/45">{chatMessages.length}</Text>
      </Pressable>
      <FlatList
        data={chatMessages}
        keyExtractor={(item, index) => item.id() || `chat-${index}`}
        renderItem={renderChatMessage}
        contentContainerStyle={chatMessages.length ? styles.chatList : styles.emptyChat}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        ListEmptyComponent={
          <Text className="text-center text-sm text-white/45">
            {event ? 'No chat messages yet.' : 'Loading live event...'}
          </Text>
        }
        onScrollBeginDrag={Keyboard.dismiss}
        keyboardShouldPersistTaps="handled"
      />
      <KeyboardStickyView
        offset={{closed: 0, opened: 0}}
        style={styles.composerSticky}
      >
        <View className="border-t border-white/10 bg-black px-4 pb-8 pt-3">
        {!pubkey || !hasSigner ? (
          <Text className="text-center text-sm text-white/45">
            Sign in to join the live chat.
          </Text>
        ) : !aTag ? (
          <Text className="text-center text-sm text-white/45">
            Live chat is unavailable for this event.
          </Text>
        ) : (
          <>
            {sendError ? (
              <Text className="mb-2 text-xs text-yellow-300/80">{sendError}</Text>
            ) : null}
            <View className="flex-row items-end gap-2">
              <TextInput
                className="max-h-28 min-h-11 flex-1 rounded-2xl bg-white/10 px-4 py-3 text-base text-white"
                cursorColor={theme.colors.primary}
                editable={!isSubmitting}
                multiline
                onChangeText={text => {
                  setChatInput(text);
                  if (sendError) setSendError('');
                }}
                onSubmitEditing={sendMessage}
                placeholder="Message live chat"
                placeholderTextColor="rgba(255,255,255,0.42)"
                returnKeyType="send"
                submitBehavior="blurAndSubmit"
                value={chatInput}
              />
              <Pressable
                accessibilityLabel="Send live chat message"
                className={[
                  'h-11 w-11 items-center justify-center rounded-full',
                  canSend ? 'bg-primary' : 'bg-white/10',
                ].join(' ')}
                disabled={!canSend}
                hitSlop={8}
                onPress={sendMessage}
              >
                <Send
                  size={18}
                  color={canSend ? '#ffffff' : 'rgba(255,255,255,0.38)'}
                />
              </Pressable>
            </View>
          </>
        )}
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  video: {
    height: '100%',
    width: '100%',
  },
  poster: {
    height: '100%',
    opacity: 0.74,
    width: '100%',
  },
  chatList: {
    paddingBottom: 28,
  },
  emptyChat: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  composerSticky: {
    backgroundColor: '#000000',
  },
});
