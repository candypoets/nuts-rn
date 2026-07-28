import React, {useCallback, useMemo, useState} from 'react';
import {
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {FlashList, type ListRenderItemInfo} from '@shopify/flash-list';
import {useNavigation} from 'expo-router/react-navigation';
import {nip19} from 'nostr-tools';
import {ChevronDown, MessageCirclePlus, X} from 'lucide-react-native';

import {AppButton} from '../components/AppButton';
import {Avatar, User} from '../components/notes';
import {shortNpub} from '../lib/identity';
import {pushDistinct} from '../navigation/pushDistinct';
import type {AppNavigationProp} from '../navigation/types';
import {useNostrStore} from '../stores';
import {useAppTheme} from '../theme';

type NewChatModalProps = {
  onClose: () => void;
};

type ValidationResult = {
  pubkey: string;
  error: string;
  valid: boolean;
};

function validateRecipient(value: string): ValidationResult {
  const input = value.trim();
  if (!input) return {pubkey: '', error: '', valid: false};

  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return {pubkey: input.toLowerCase(), error: '', valid: true};
  }

  try {
    const decoded = nip19.decode(input);
    if (decoded.type === 'npub') {
      return {pubkey: decoded.data, error: '', valid: true};
    }
    if (decoded.type === 'nprofile') {
      return {
        pubkey: decoded.data.pubkey,
        error: '',
        valid: true,
      };
    }
    return {
      pubkey: '',
      error: 'Unsupported bech32 type. Paste an npub or nprofile.',
      valid: false,
    };
  } catch {
    return {
      pubkey: '',
      error: 'Invalid npub or hex pubkey.',
      valid: false,
    };
  }
}

export function NewChatModal({onClose}: NewChatModalProps) {
  const navigation =
    useNavigation<AppNavigationProp>();
  const theme = useAppTheme();
  const follows = useNostrStore(state => state.follows);
  const [value, setValue] = useState('');
  const validation = useMemo(() => validateRecipient(value), [value]);
  const contacts = useMemo(() => {
    const seen = new Set<string>();
    return follows.filter(pubkey => {
      const key = pubkey.toLowerCase();
      if (!pubkey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [follows]);

  const openChat = useCallback(
    (pubkey: string) => {
      Keyboard.dismiss();
      onClose();
      requestAnimationFrame(() => {
        pushDistinct(navigation, 'ChatThread', {peerPubkey: pubkey});
      });
    },
    [navigation, onClose],
  );

  const submit = useCallback(() => {
    const next = validateRecipient(value);
    if (!next.valid || !next.pubkey) return;
    openChat(next.pubkey);
  }, [openChat, value]);

  const renderHeader = useCallback(
    () => (
      <View className="px-4 pt-4">
        <View className="h-14 flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-10 w-10 items-center justify-center rounded-full border border-base-200 bg-base-300"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronDown size={22} color={theme.colors.primaryContent} strokeWidth={2.3} />
          </Pressable>
        </View>

        <View className="mt-4 rounded-lg border border-base-200 bg-base-300/95 px-5 py-6 shadow-sm">
          <View className="items-center">
            <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-base-200">
              <MessageCirclePlus size={30} color={theme.colors.primary} strokeWidth={2.2} />
            </View>
            <Text className="text-center text-2xl font-semibold text-base-content">
              Start a Blurred Chat
            </Text>
            <Text className="mt-2 text-center text-sm leading-5 text-primary-content">
              End-to-end encrypted DMs on Nostr. Others may see who you are talking to, but never what you say.
            </Text>
          </View>

          <Text className="mt-6 text-sm font-semibold text-base-content">
            Paste an npub, nprofile, or hex pubkey
          </Text>
          <View className="mt-2 min-h-12 flex-row items-center rounded-lg border border-base-200 bg-base-100 px-3">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-12 flex-1 py-2 text-base text-base-content"
              inputMode="text"
              onChangeText={setValue}
              onSubmitEditing={submit}
              placeholder="npub1..."
              placeholderTextColor={theme.colors.primaryContent}
              returnKeyType="go"
              spellCheck={false}
              value={value}
            />
            {value ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear"
                hitSlop={8}
                onPress={() => setValue('')}
              >
                <X size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
          {validation.error ? (
            <Text className="mt-2 text-sm font-semibold text-error">
              {validation.error}
            </Text>
          ) : null}
          <AppButton
            title="Start a new chat"
            className="mt-4"
            disabled={!validation.valid}
            onPress={submit}
          />
        </View>

        {contacts.length ? (
          <View className="mt-6 rounded-t-lg border-x border-t border-base-200 bg-base-300/95 px-3 py-3">
            <Text className="mb-2 text-lg font-bold text-base-content">
              Message a contact
            </Text>
          </View>
        ) : null}
      </View>
    ),
    [
      contacts.length,
      onClose,
      submit,
      theme.colors.primary,
      theme.colors.primaryContent,
      validation.error,
      validation.valid,
      value,
    ],
  );

  const renderContact = useCallback(
    ({item: pubkey, index}: ListRenderItemInfo<string>) => (
      <View className="px-4">
        <Pressable
          className={`min-h-16 flex-row items-center gap-3 border-x border-base-200 bg-base-300/95 px-3 py-3 ${
            index > 0 ? 'border-t border-base-200' : ''
          } ${index === contacts.length - 1 ? 'rounded-b-lg border-b' : ''}`}
          onPress={() => openChat(pubkey)}
        >
          <Avatar pubkey={pubkey} size="md" />
          <View className="min-w-0 flex-1">
            <User
              pubkey={pubkey}
              className="text-base font-semibold text-base-content"
            />
            <Text
              className="mt-0.5 text-xs text-primary-content"
              numberOfLines={1}
            >
              {shortNpub(pubkey)}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-primary">Message</Text>
        </Pressable>
      </View>
    ),
    [contacts.length, openChat],
  );

  return (
    <View className="flex-1 bg-base-100">
      <FlashList
        data={contacts}
        keyExtractor={item => item}
        renderItem={renderContact}
        ListHeaderComponent={renderHeader}
        className="flex-1"
        contentContainerClassName="pb-12"
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
