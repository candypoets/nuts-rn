import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import type {
  ConnectionStatus,
  ParsedEvent,
  RequestObject,
  WorkerMessage,
} from '@candypoets/nipworker';
import {usePublish as publishToNostr, useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {
  asConnectionStatus,
  asKind1111,
  asParsedEvent,
  fbArray,
  isConnectionStatus,
} from '@candypoets/nipworker/utils';
import {decode, type EventPointer} from 'nostr-tools/nip19';
import type {EventTemplate} from 'nostr-tools';
import {Heart, MessageCircle, Send} from 'lucide-react-native';
import {StackActions, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Animated, {
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {useAuthStore, useNostrStore, useSendStatusStore} from '../stores';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {Avatar, User} from '../components/notes';
import {ContentBlocks} from '../components/notes/ContentBlocks';
import {formatTimeShort} from '../components/notes/time';
import {shortNpub} from '../lib/identity';
import {useKind0Value} from '../hooks/useKind0Value';
import {useAppTheme} from '../theme';
import type {RootStackParamList} from '../navigation/types';
import {rootNavigationRef} from '../navigation/rootNavigation';

type Kind1111CommentsModalProps = {
  nevent: string;
  onClose: () => void;
};

type CommentNode = {
  event: ParsedEvent;
  children: CommentNode[];
  depth: number;
};

type FlatComment = {
  event: ParsedEvent;
  depth: number;
};

type ReplyTarget = {
  id: string;
  pubkey: string;
  name: string;
};

function decodeTarget(value: string): EventPointer | null {
  try {
    const decoded = decode(value);
    if (decoded.type === 'nevent') return decoded.data;
    if (decoded.type === 'note') return {id: decoded.data, relays: []};
  } catch {
    return null;
  }
  return null;
}

function buildCommentTree(comments: ParsedEvent[], rootId: string) {
  const nodeMap = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  comments.forEach(event => {
    const id = event.id();
    if (!id) return;
    nodeMap.set(id, {event, children: [], depth: 0});
  });

  comments.forEach(event => {
    const id = event.id();
    if (!id) return;
    const kind1111 = asKind1111(event);
    const node = nodeMap.get(id);
    if (!kind1111 || !node) return;

    const parentId = kind1111.parentId?.();
    const rootEventId = kind1111.rootId?.();
    if (parentId && parentId !== rootId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId);
      if (!parent) return;
      node.depth = parent.depth + 1;
      parent.children.push(node);
      return;
    }
    if (rootEventId === rootId || !parentId) {
      roots.push(node);
    }
  });

  const sortByTime = (left: CommentNode, right: CommentNode) =>
    left.event.createdAt() - right.event.createdAt();
  roots.sort(sortByTime);
  nodeMap.forEach(node => node.children.sort(sortByTime));
  return roots;
}

function flattenTree(nodes: CommentNode[]) {
  const flat: FlatComment[] = [];
  function visit(nextNodes: CommentNode[]) {
    nextNodes.forEach(node => {
      flat.push({event: node.event, depth: node.depth});
      if (node.children.length) visit(node.children);
    });
  }
  visit(nodes);
  return flat;
}

function uniqueEvents(events: ParsedEvent[], event: ParsedEvent) {
  const id = event.id();
  if (!id || events.some(current => current.id() === id)) return events;
  return [...events, event];
}

const CommentItem = memo(function CommentItem({
  item,
  isLiked,
  isReplyTarget,
  onLike,
  onProfileOpen,
  onReply,
}: {
  item: FlatComment;
  isLiked: boolean;
  isReplyTarget: boolean;
  onLike: (event: ParsedEvent) => void;
  onProfileOpen: (pubkey: string) => void;
  onReply: (event: ParsedEvent, name: string) => void;
}) {
  const kind1111 = asKind1111(item.event);
  const pubkey = item.event.pubkey() || '';
  const content = kind1111 ? fbArray(kind1111, 'parsedContent') : [];
  const name = useKind0Value(pubkey, {
    fallback: shortNpub(pubkey),
    selector: profile =>
      profile.name?.()?.trim() ||
      profile.displayName?.()?.trim() ||
      shortNpub(pubkey),
  });
  const highlightStyle = useAnimatedStyle(() => ({
    backgroundColor: isReplyTarget
      ? 'rgba(21, 135, 119, 0.14)'
      : 'rgba(21, 135, 119, 0)',
    transform: [
      {
        translateX: isReplyTarget
          ? withSequence(
              withTiming(12, {duration: 140}),
              withTiming(8, {duration: 180}),
            )
          : withTiming(0, {duration: 160}),
      },
    ],
  }));

  return (
    <Animated.View
      className="rounded-lg px-1 py-2"
      style={[{marginLeft: item.depth * 24}, highlightStyle]}
    >
      <View className="flex-row items-start gap-2">
        <Avatar pubkey={pubkey} size="sm" link onProfileOpen={onProfileOpen} />
        <View className="min-w-0 flex-1">
          <View className="mb-1 flex-row items-center gap-2">
            <User
              pubkey={pubkey}
              link
              className="text-sm font-semibold text-base-content"
              onProfileOpen={onProfileOpen}
            />
            <Text className="text-xs text-primary-content">
              {formatTimeShort(item.event.createdAt())}
            </Text>
          </View>
          <ContentBlocks
            content={content}
            note={item.event}
            depth={item.depth}
            showMedia
            showQuote={false}
            forceFullContent
          />
          <View className="mt-1 flex-row items-center gap-4">
            <Pressable
              className="flex-row items-center gap-1 py-1"
              hitSlop={8}
              onPress={event => {
                event.stopPropagation();
                onReply(item.event, name);
              }}
            >
              <MessageCircle size={14} color={isReplyTarget ? '#158777' : themeTint} />
              <Text className="text-xs font-medium text-primary-content">Reply</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center gap-1 py-1"
              hitSlop={8}
              onPress={event => {
                event.stopPropagation();
                onLike(item.event);
              }}
            >
              <Heart
                size={14}
                color={isLiked ? '#6d28d9' : themeTint}
                fill={isLiked ? '#6d28d9' : 'transparent'}
              />
              <Text
                className={[
                  'text-xs font-medium',
                  isLiked ? 'text-primary' : 'text-primary-content',
                ].join(' ')}
              >
                Like
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
});

const themeTint = '#9b9ea4';

export function Kind1111CommentsModal({
  nevent,
  onClose: _onClose,
}: Kind1111CommentsModalProps) {
  const theme = useAppTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const target = useMemo(() => decodeTarget(nevent), [nevent]);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const inputRef = useRef<TextInputType>(null);
  const [comments, setComments] = useState<ParsedEvent[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(() => new Set());
  const relays = useMemo(
    () => [
      ...new Set([
        ...(target?.relays ?? []),
        ...(writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
      ]),
    ],
    [target, writeRelays],
  );
  const flatComments = useMemo(
    () => (target ? flattenTree(buildCommentTree(comments, target.id)) : []),
    [comments, target],
  );
  const canSubmit = Boolean(
    target?.id && pubkey && hasSigner && text.trim() && !isSubmitting,
  );
  const dismissComposer = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
    setReplyTarget(null);
  }, []);

  useEffect(() => {
    if (!target?.id) return;
    setComments([]);
    setLoading(true);
    const timeout = setTimeout(() => setLoading(false), 5000);
    const request: RequestObject = {
      kinds: [1111],
      tags: {'#E': [target.id]},
      relays,
      noContext: true,
    };
    const unsubscribe = subscribeToNostr(
      `kind1111_${target.id}_${relays.join('|')}`,
      [request],
      (message: WorkerMessage) => {
        if (asConnectionStatus(message)) {
          setLoading(false);
          return;
        }
        const parsed = asParsedEvent(message);
        if (parsed?.kind() !== 1111 || !asKind1111(parsed)) return;
        setComments(current => uniqueEvents(current, parsed));
      },
      {closeOnEose: false},
    );
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [relays, target]);

  const submit = useCallback(() => {
    if (!target?.id || !canSubmit) return;
    setIsSubmitting(true);
    const rootTags: string[][] = [
      ['E', target.id, relays[0] || ''],
      ...(target.kind ? [['K', String(target.kind)]] : []),
      ...(target.author ? [['P', target.author]] : []),
    ];
    const replyTags: string[][] = replyTarget
      ? [
          ['e', replyTarget.id, relays[0] || '', 'reply'],
          ['p', replyTarget.pubkey],
        ]
      : [];
    const event: EventTemplate = {
      kind: 1111,
      created_at: Math.floor(Date.now() / 1000),
      content: text.trim(),
      tags: [...rootTags, ...replyTags, ['client', 'nutscash']],
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `kind1111_comment_${target.id}_${Date.now()}`;
    publishToNostr(
      sendId,
      event,
      (message: WorkerMessage) => {
        const status = isConnectionStatus(message);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;
        sendStatus[relayUrl] = status;
        updateSendStatus(sendId, sendStatus);
        if (status.status()?.toString() === 'true') {
          setText('');
          setReplyTarget(null);
          setIsSubmitting(false);
        }
      },
      {
        defaultRelays: relays,
        subId: [`kind1111_${target.id}`, `comment_${target.id}`, `f_${target.id}`],
        trackStatus: true,
      },
    );
    setTimeout(() => setIsSubmitting(false), 5000);
  }, [canSubmit, relays, replyTarget, target, text, updateSendStatus]);
  const sendReaction = useCallback((comment: ParsedEvent) => {
    dismissComposer();
    const commentId = comment.id();
    const commentPubkey = comment.pubkey();
    if (
      !pubkey ||
      !commentId ||
      !commentPubkey ||
      !relays.length ||
      likedCommentIds.has(commentId)
    ) {
      return;
    }

    setLikedCommentIds(current => {
      if (current.has(commentId)) return current;
      const next = new Set(current);
      next.add(commentId);
      return next;
    });

    const event: EventTemplate = {
      kind: 7,
      tags: [
        ['e', commentId],
        ['p', commentPubkey],
      ],
      content: '+',
      created_at: Math.floor(Date.now() / 1000),
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `reaction_${commentId}_${Date.now()}`;
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
        subId: [`kind1111_${target?.id || commentId}`, `reaction_${commentId}`],
        trackStatus: true,
      },
    );
  }, [dismissComposer, likedCommentIds, pubkey, relays, target, updateSendStatus]);
  const startReply = useCallback((comment: ParsedEvent, name: string) => {
    const commentId = comment.id();
    const commentPubkey = comment.pubkey();
    if (!commentId || !commentPubkey) return;
    setReplyTarget({
      id: commentId,
      pubkey: commentPubkey,
      name,
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const openProfile = useCallback((nextPubkey: string) => {
    navigation.goBack();
    setTimeout(() => {
      if (!rootNavigationRef.isReady()) return;
      rootNavigationRef.dispatch(
        StackActions.push('PublicProfile', {pubkey: nextPubkey}),
      );
    }, 350);
  }, [navigation]);
  const emptyContent = !target ? (
    <View className="flex-1 items-center justify-center py-8">
      <Text className="text-primary-content">Invalid note id</Text>
    </View>
  ) : loading ? (
    <View className="flex-1 items-center justify-center py-8">
      <Text className="text-primary-content">Loading comments...</Text>
    </View>
  ) : (
    <View className="flex-1 items-center justify-center py-8">
      <Text className="text-base-content">No comments yet</Text>
      <Text className="text-sm text-primary-content">Be the first to comment.</Text>
    </View>
  );

  const headerContent = (
    <>
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-row items-center gap-2">
          <MessageCircle size={22} color={theme.colors.primary} />
          <Text className="text-xl font-bold text-base-content">Comments</Text>
          <Text className="text-sm text-primary-content">({comments.length})</Text>
        </View>
      </View>

      <Pressable
        className="border-b border-base-200 px-4 pb-3"
        onPress={event => event.stopPropagation()}
      >
        <View className="rounded-lg border border-base-200 bg-base-100/80 px-3 py-2">
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={replyTarget ? `Reply to ${replyTarget.name}` : 'Add a comment'}
            placeholderTextColor={theme.colors.primaryContent}
            multiline
            className="min-h-10 text-base text-base-content"
          />
          {replyTarget ? (
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xs text-primary-content">
                Replying to {replyTarget.name}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={event => {
                  event.stopPropagation();
                  setReplyTarget(null);
                }}
              >
                <Text className="text-xs font-semibold text-primary">Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          {(text.trim() || isSubmitting) ? (
            <View className="mt-2 flex-row justify-end">
              <Pressable
                className={[
                  'flex-row items-center gap-2 rounded-full px-4 py-2',
                  canSubmit ? 'bg-primary' : 'bg-base-200',
                ].join(' ')}
                disabled={!canSubmit}
                onPress={event => {
                  event.stopPropagation();
                  submit();
                }}
              >
                <Text className={canSubmit ? 'font-semibold text-white' : 'font-semibold text-primary-content'}>
                  {isSubmitting ? 'Signing...' : 'Comment'}
                </Text>
                <Send size={16} color={canSubmit ? '#ffffff' : theme.colors.primaryContent} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </Pressable>
    </>
  );

  return (
    <FlatList
      className="flex-1 bg-base-100"
      data={flatComments}
      keyExtractor={item => item.event.id() || `${item.event.createdAt()}-${item.depth}`}
      renderItem={({item}) => (
        <CommentItem
          item={item}
          isLiked={likedCommentIds.has(item.event.id() || '')}
          isReplyTarget={replyTarget?.id === item.event.id()}
          onLike={sendReaction}
          onProfileOpen={openProfile}
          onReply={startReply}
        />
      )}
      ListHeaderComponent={headerContent}
      ListEmptyComponent={emptyContent}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 8,
        paddingBottom: 20,
      }}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={Platform.OS === 'ios' ? undefined : dismissComposer}
      removeClippedSubviews
    />
  );
}
