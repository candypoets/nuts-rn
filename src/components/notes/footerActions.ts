import React from 'react';
import {useNavigation} from 'expo-router/react-navigation';
import type {
  ConnectionStatus,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import {kinds, type EventTemplate} from 'nostr-tools';
import {naddrEncode, neventEncode} from 'nostr-tools/nip19';
import type {AppNavigationProp} from '../../navigation/types';
import {useAuthStore, useSendStatusStore} from '../../stores';
import {eventTags, tagValue} from './kindHelpers';

export type FooterAction =
  | 'reply'
  | 'comments'
  | 'repost'
  | 'like'
  | 'share'
  | 'zap';

const EMPTY_RELAYS: string[] = [];

export const footerColors = {
  tint: '#9b9ea4',
  primary: '#158777',
  accent: '#6d28d9',
};

export function useNoteFooterActions(
  note: ParsedEvent | undefined,
  relays: string[] = EMPTY_RELAYS,
) {
  const navigation =
    useNavigation<AppNavigationProp>();
  const pubkey = useAuthStore(state => state.pubkey);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const reactedRef = React.useRef(false);
  const [optimisticReactionNonce, setOptimisticReactionNonce] =
    React.useState(0);
  const noteId = note?.id() || '';
  const notePubkey = note?.pubkey() || '';
  const noteKind = note?.kind() || 1;

  React.useEffect(() => {
    reactedRef.current = false;
  }, [noteId]);

  const openReply = React.useCallback(() => {
    if (!noteId) return;
    navigation.navigate('Post', {
      reply: neventEncode({
        id: noteId,
        author: notePubkey || undefined,
        kind: noteKind,
        relays,
      }),
    });
  }, [navigation, noteId, noteKind, notePubkey, relays]);

  const openComments = React.useCallback(() => {
    if (!noteId) return;
    navigation.navigate('Kind1111Comments', {
      nevent: neventEncode({
        id: noteId,
        author: notePubkey || undefined,
        kind: noteKind,
        relays,
      }),
    });
  }, [navigation, noteId, noteKind, notePubkey, relays]);

  const openQuote = React.useCallback(() => {
    if (!noteId) return;
    navigation.navigate('Post', {
      quote: neventEncode({
        id: noteId,
        author: notePubkey || undefined,
        kind: noteKind,
        relays,
      }),
    });
  }, [navigation, noteId, noteKind, notePubkey, relays]);

  const openShare = React.useCallback(() => {
    if (!note || !noteId) return;
    const kind = note.kind();
    const identifier =
      kind >= 30000 && kind < 40000 ? tagValue(eventTags(note), 'd') : '';
    navigation.navigate('Share', {
      nevent: neventEncode({
        id: noteId,
        author: notePubkey || undefined,
        kind,
        relays,
      }),
      naddr:
        notePubkey && identifier
          ? naddrEncode({
              kind,
              pubkey: notePubkey,
              identifier,
              relays,
            })
          : undefined,
    });
  }, [navigation, note, noteId, notePubkey, relays]);

  const openZap = React.useCallback(() => {
    if (!note || !noteId || !notePubkey) return;
    const kind = note.kind();
    const identifier =
      kind >= 30000 && kind < 40000 ? tagValue(eventTags(note), 'd') : '';
    navigation.navigate('SendEcash', {
      pubkey: notePubkey,
      noteId: neventEncode({
        id: noteId,
        author: notePubkey || undefined,
        kind,
        relays,
      }),
      targetKind: kind,
      targetAddress:
        identifier ? `${kind}:${notePubkey}:${identifier}` : undefined,
    });
  }, [navigation, note, noteId, notePubkey, relays]);

  const handleLike = React.useCallback(() => {
    if (
      !pubkey ||
      !noteId ||
      !notePubkey ||
      !relays.length ||
      reactedRef.current
    ) {
      return;
    }

    reactedRef.current = true;
    setOptimisticReactionNonce(nonce => nonce + 1);

    const event: EventTemplate = {
      kind: kinds.Reaction,
      tags: [
        ['e', noteId],
        ['p', notePubkey],
      ],
      content: '+',
      created_at: Math.floor(Date.now() / 1000),
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `reaction_${noteId}`;

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
      {defaultRelays: relays, trackStatus: true},
    );
  }, [noteId, notePubkey, pubkey, relays, updateSendStatus]);

  const handleAction = React.useCallback(
    (action: string) => {
      switch (action as FooterAction) {
        case 'reply':
          openReply();
          break;
        case 'comments':
          openComments();
          break;
        case 'repost':
          openQuote();
          break;
        case 'like':
          handleLike();
          break;
        case 'share':
          openShare();
          break;
        case 'zap':
          openZap();
          break;
      }
    },
    [handleLike, openComments, openQuote, openReply, openShare, openZap],
  );

  return {
    currentUserPubkey: pubkey || undefined,
    optimisticReactionNonce,
    handleAction,
    onReply: openReply,
    onComments: openComments,
    onRepost: openQuote,
    onLike: handleLike,
    onShare: openShare,
    onZap: openZap,
  };
}
