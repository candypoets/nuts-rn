import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import {KeyboardStickyView} from 'react-native-keyboard-controller';
import type {
  ConnectionStatus,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import {Send} from 'lucide-react-native';
import {nip10} from 'nostr-tools';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {DEFAULT_FEED_RELAYS} from '../../nostr/relays';
import {replyOptimisticSubIds} from '../../nostr/subscriptionIds';
import {useAuthStore} from '../../stores/authStore';
import {useNostrStore} from '../../stores/nostrStore';
import {useSendStatusStore} from '../../stores/sendStatusStore';
import {useAppTheme} from '../../theme';
import {buildKind1QuickReplyEvent} from './buildKind1QuickReplyEvent';

type Kind1QuickReplyProps = {
  note: ParsedEvent;
  relays: string[];
  visible: boolean;
};

const PUBLISH_TIMEOUT_MS = 30_000;

export function Kind1QuickReply({
  note,
  relays,
  visible,
}: Kind1QuickReplyProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInputType>(null);
  const publishUnsubRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const acknowledgedRef = useRef(false);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState('');
  const footerInsetsStyle = useMemo(
    () => ({paddingBottom: Math.max(12, insets.bottom)}),
    [insets.bottom],
  );
  const publishRelays = writeRelays.length
    ? writeRelays
    : relays.length
      ? relays
      : DEFAULT_FEED_RELAYS;
  const canSubmit = Boolean(
    pubkey && hasSigner && text.trim() && !isSubmitting,
  );

  const clearPublishTimeout = useCallback(() => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPublishTimeout();
      publishUnsubRef.current?.();
      publishUnsubRef.current = null;
    };
  }, [clearPublishTimeout]);

  useEffect(() => {
    if (visible) return;
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, [visible]);

  const finishWithError = useCallback(() => {
    if (!mountedRef.current || acknowledgedRef.current) return;
    clearPublishTimeout();
    publishUnsubRef.current?.();
    publishUnsubRef.current = null;
    setIsSubmitting(false);
    setSendError('Reply was not published. Try again.');
  }, [clearPublishTimeout]);

  const submit = useCallback(() => {
    const parentId = note.id();
    const submittedContent = text.trim();
    const event = buildKind1QuickReplyEvent(
      note,
      submittedContent,
      publishRelays[0] || '',
    );
    if (!parentId || !event || !canSubmit) return;

    setIsSubmitting(true);
    setSendError('');
    acknowledgedRef.current = false;
    publishUnsubRef.current?.();
    clearPublishTimeout();

    const sendId = `quick_reply_${parentId}_${Date.now()}`;
    const sendStatus: Record<string, ConnectionStatus> = {};
    const threadRootId = nip10.parse(event).root?.id || parentId;

    publishUnsubRef.current = publishToNostr(
      sendId,
      event,
      (message: WorkerMessage) => {
        const status = isConnectionStatus(message);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;

        sendStatus[relayUrl] = status;
        updateSendStatus(sendId, sendStatus);
        if (
          status.status()?.toString() !== 'true' ||
          acknowledgedRef.current
        ) {
          return;
        }

        acknowledgedRef.current = true;
        clearPublishTimeout();
        publishUnsubRef.current?.();
        publishUnsubRef.current = null;
        if (!mountedRef.current) return;
        setText(current =>
          current.trim() === submittedContent ? '' : current,
        );
        setIsSubmitting(false);
      },
      {
        defaultRelays: publishRelays,
        subId: replyOptimisticSubIds(parentId, threadRootId),
        trackStatus: true,
      },
    );

    timeoutRef.current = setTimeout(finishWithError, PUBLISH_TIMEOUT_MS);
  }, [
    canSubmit,
    clearPublishTimeout,
    finishWithError,
    note,
    publishRelays,
    text,
    updateSendStatus,
  ]);

  if (!pubkey || !hasSigner) {
    return (
      <View
        className="border-t border-base-200 bg-base-300 px-4 pt-3"
        style={footerInsetsStyle}
      >
        <View className="min-h-12 items-center justify-center rounded-2xl bg-base-200 px-4">
          <Text className="text-sm font-medium text-primary-content">
            Sign in to reply.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardStickyView enabled={visible} offset={{closed: 0, opened: 0}}>
      <View
        className="border-t border-base-200 bg-base-300 px-4 pt-3"
        style={footerInsetsStyle}
      >
        {sendError ? (
          <Text className="mb-2 text-xs font-medium text-error">
            {sendError}
          </Text>
        ) : null}
        <View className="flex-row items-end gap-2">
          <TextInput
            ref={inputRef}
            accessibilityLabel="Quick reply"
            className="max-h-32 min-h-12 flex-1 rounded-2xl bg-base-200 px-4 py-3 text-base text-base-content"
            cursorColor={theme.colors.primary}
            maxLength={2000}
            multiline
            onChangeText={value => {
              setText(value);
              if (sendError) setSendError('');
            }}
            onSubmitEditing={submit}
            placeholder="Write a quick reply"
            placeholderTextColor={theme.colors.primaryContent}
            returnKeyType="send"
            submitBehavior="submit"
            value={text}
          />
          <Pressable
            accessibilityLabel="Send quick reply"
            accessibilityRole="button"
            accessibilityState={{busy: isSubmitting, disabled: !canSubmit}}
            className={[
              'h-12 w-12 items-center justify-center rounded-full',
              canSubmit ? 'bg-primary' : 'bg-base-200',
            ].join(' ')}
            disabled={!canSubmit}
            hitSlop={8}
            onPress={submit}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.colors.primaryContent} />
            ) : (
              <Send
                size={19}
                color={canSubmit ? '#ffffff' : theme.colors.primaryContent}
                strokeWidth={2.4}
              />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardStickyView>
  );
}
