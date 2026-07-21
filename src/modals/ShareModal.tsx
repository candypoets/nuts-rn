import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type {ConnectionStatus, Kind0Parsed, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {usePublish as publishToNostr, useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asKind0, asParsedEvent, isConnectionStatus} from '@candypoets/nipworker/utils';
import {Copy, FileText, Link, Search, Send, X} from 'lucide-react-native';
import type {EventTemplate} from 'nostr-tools';
import {decode} from 'nostr-tools/nip19';

import {Avatar} from '../components/notes/Avatar';
import {shortNpub} from '../lib/identity';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useNostrStore, useSendStatusStore} from '../stores';
import {useAppTheme} from '../theme';

type ShareModalProps = {
  nevent: string;
  naddr?: string;
  onClose?: () => void;
};

type ContactProfile = {
  pubkey: string;
  name: string;
  event: ParsedEvent | null;
};

function displayName(kind0: Kind0Parsed | null, pubkey: string) {
  return (
    kind0?.name?.()?.trim() ||
    kind0?.displayName?.()?.trim() ||
    shortNpub(pubkey)
  );
}

function contactKey(pubkey: string) {
  return pubkey.toLowerCase();
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function decodeNevent(value: string) {
  try {
    const decoded = decode(value);
    if (decoded.type === 'nevent') return decoded.data;
  } catch {
    return null;
  }
  return null;
}

export function ShareModal({nevent, naddr}: ShareModalProps) {
  const theme = useAppTheme();
  const {height} = useWindowDimensions();
  const follows = useNostrStore(state => state.follows);
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ContactProfile>>({});
  const [notice, setNotice] = useState('');
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const pointer = useMemo(() => decodeNevent(nevent), [nevent]);
  const relaysText = pointer?.relays?.length
    ? pointer.relays.join('\n')
    : 'No relay hints';
  const address = naddr ?? nevent;
  const noteUrl = `https://nuts.cash/explore/nevent:${nevent}`;

  const relays = useMemo(() => {
    const resolved = [...new Set([...walletReadRelays, ...readRelays, ...writeRelays])];
    return resolved.length ? resolved : DEFAULT_FEED_RELAYS;
  }, [readRelays, walletReadRelays, writeRelays]);

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    return follows.filter(pubkey => {
      const key = contactKey(pubkey);
      if (!pubkey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [follows]);

  const contactRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts
      .map(pubkey => profiles[contactKey(pubkey)] ?? {
        pubkey,
        name: shortNpub(pubkey),
        event: null,
      })
      .filter(contact => {
        if (!query) return true;
        return (
          contact.name.toLowerCase().includes(query) ||
          contact.pubkey.toLowerCase().includes(query)
        );
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {sensitivity: 'base'}),
      );
  }, [contacts, profiles, search]);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setProfiles({});

    if (!contacts.length) return undefined;

    unsubscribeRef.current = subscribeToNostr(
      `share_contacts_${contacts.length}_${relayHash(relays)}`,
      contacts.map(pubkey => ({
        kinds: [0],
        authors: [pubkey],
        cacheFirst: true,
        noContext: true,
        relays,
      })),
      (workerMessage: WorkerMessage) => {
        const parsed = asParsedEvent(workerMessage);
        if (!parsed || parsed.kind() !== 0) return;
        const pubkey = parsed.pubkey();
        if (!pubkey) return;
        const kind0 = asKind0(parsed);
        setProfiles(current => ({
          ...current,
          [contactKey(pubkey)]: {
            pubkey,
            name: displayName(kind0, pubkey),
            event: parsed,
          },
        }));
      },
      {closeOnEose: false},
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [contacts, relays]);

  const copyAddress = useCallback(async () => {
    await Clipboard.setStringAsync(`nostr:${address}`);
    setNotice(naddr ? 'Copied address' : 'Copied event address');
    setTimeout(() => setNotice(''), 2400);
  }, [address, naddr]);

  const copyDetails = useCallback(async () => {
    await Clipboard.setStringAsync(
      [
        `address: nostr:${address}`,
        `url: ${noteUrl}`,
        `note id: ${pointer?.id ?? ''}`,
        `author: ${pointer?.author ?? ''}`,
        `kind: ${pointer?.kind ?? ''}`,
        'relays:',
        relaysText,
      ].join('\n'),
    );
    setNotice('Copied details');
    setTimeout(() => setNotice(''), 2400);
  }, [address, noteUrl, pointer, relaysText]);

  const copyNoteUrl = useCallback(async () => {
    await Clipboard.setStringAsync(noteUrl);
    setNotice('Copied note URL');
    setTimeout(() => setNotice(''), 2400);
  }, [noteUrl]);

  const sendMessage = useCallback(() => {
    if (!selectedPubkey) return;
    const content = `${message.trim() ? `${message.trim()}\n\n` : ''}nostr:${nevent}`;
    const event: EventTemplate = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [['p', selectedPubkey]],
    };
    const sendId = `share_${pointer?.id ?? Date.now()}`;
    const sendStatus: Record<string, ConnectionStatus> = {};

    publishToNostr(
      sendId,
      event,
      (workerMessage: WorkerMessage) => {
        const status = isConnectionStatus(workerMessage);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;
        sendStatus[relayUrl] = status;
        updateSendStatus(sendId, sendStatus);
        if (status.status()?.toString() === 'true') {
          setNotice('Sent');
          setMessage('');
        }
      },
      {defaultRelays: relays, trackStatus: true},
    );
  }, [message, nevent, pointer, relays, selectedPubkey, updateSendStatus]);

  const selectedContact = selectedPubkey
    ? profiles[contactKey(selectedPubkey)] ?? {
        pubkey: selectedPubkey,
        name: shortNpub(selectedPubkey),
        event: null,
      }
    : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="bg-base-100"
      style={{height: Math.round(height * 0.56)}}
    >
      <View className="bg-base-100 px-4 pt-2" style={styles.content}>
        <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-base-300" />
        <Pressable
          className="flex-row items-center rounded-lg border border-base-200 bg-base-300 px-3"
          style={styles.searchBar}
          onPress={() => searchInputRef.current?.focus()}
        >
          <Search size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
          <TextInput
            ref={searchInputRef}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-12 flex-1 px-3 text-base text-base-content"
            placeholder="Search"
            placeholderTextColor={theme.colors.primaryContent}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch('')}>
              <X size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </Pressable>

        {contactRows.length ? (
          <FlatList
            className="mt-4 flex-1"
            data={contactRows}
            keyExtractor={item => item.pubkey}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            renderItem={({item}) => {
              const selected = item.pubkey === selectedPubkey;
              return (
                <Pressable
                  className="mb-4 w-1/3 items-center px-1"
                  onPress={() => setSelectedPubkey(selected ? null : item.pubkey)}
                >
                  <View
                    className={[
                      'rounded-full border-2 p-0.5',
                      selected ? 'border-primary' : 'border-transparent',
                    ].join(' ')}
                  >
                    <Avatar pubkey={item.pubkey} size="lg" />
                  </View>
                  <Text
                    className={[
                      'mt-1 max-w-[96px] text-center text-xs text-base-content',
                      selected ? 'font-bold' : '',
                    ].join(' ')}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              );
            }}
          />
        ) : (
          <View className="mt-4 flex-1 items-center px-6 pt-12">
            <Text className="text-center text-sm text-primary-content">
              No contacts to show yet.
            </Text>
          </View>
        )}

        <View
          className="border-t border-base-200 bg-green-500 px-4 py-4"
          style={styles.footer}
        >
          {selectedContact ? (
            <View className="mb-4 flex-row items-center gap-2">
              <TextInput
                className="min-h-11 flex-1 rounded-lg border border-base-200 bg-base-300 px-3 text-base text-base-content"
                placeholder={`Send as BM to ${selectedContact.name}`}
                placeholderTextColor={theme.colors.primaryContent}
                value={message}
                onChangeText={setMessage}
              />
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full bg-primary"
                onPress={sendMessage}
              >
                <Send size={19} color="#ffffff" strokeWidth={2.4} />
              </Pressable>
            </View>
          ) : null}
          <View className="flex-row justify-center gap-7">
            <View className="items-center">
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-base-200 bg-base-300"
                onPress={copyAddress}
              >
                <Copy size={19} color={theme.colors.primaryContent} strokeWidth={2.2} />
              </Pressable>
              <Text className="mt-1 text-xs text-primary-content">
                {naddr ? 'Copy naddr' : 'Copy nevent'}
              </Text>
            </View>
            <View className="items-center">
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-base-200 bg-base-300"
                onPress={copyNoteUrl}
              >
                <Link size={19} color={theme.colors.primaryContent} strokeWidth={2.2} />
              </Pressable>
              <Text className="mt-1 text-xs text-primary-content">Copy URL</Text>
            </View>
            <View className="items-center">
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full border border-base-200 bg-base-300"
                onPress={copyDetails}
              >
                <FileText size={19} color={theme.colors.primaryContent} strokeWidth={2.2} />
              </Pressable>
              <Text className="mt-1 text-xs text-primary-content">Copy details</Text>
            </View>
          </View>
          {notice ? (
            <Text className="mt-2 text-center text-sm font-semibold text-primary">
              {notice}
            </Text>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  footer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  listContent: {
    paddingBottom: 132,
  },
  searchBar: {
    elevation: 3,
    zIndex: 3,
  },
});
