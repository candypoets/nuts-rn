import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type {
  ConnectionStatus,
  Kind0Parsed,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import { usePublish as publishToNostr } from '@candypoets/nipworker/hooks';
import {
  asKind0,
  asParsedEvent,
  isConnectionStatus,
} from '@candypoets/nipworker/utils';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Hash,
  Link,
  Search,
  Send,
  X,
} from 'lucide-react-native';
import type { EventTemplate } from 'nostr-tools';
import { decode } from 'nostr-tools/nip19';

import { Avatar } from '../components/notes/Avatar';
import { shortNpub } from '../lib/identity';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { subscribeUntilEose } from '../nostr/subscribeUntilEose';
import { useNostrStore } from '../stores/nostrStore';
import { useSendStatusStore } from '../stores/sendStatusStore';
import { useAppTheme } from '../theme';

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
  return relays
    .map(relay => relay.replace(/[^a-zA-Z0-9]/g, ''))
    .join('')
    .slice(0, 24);
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

function ContactSeparator() {
  return <View style={styles.contactGap} />;
}

function ContactItem({
  compact,
  contact,
  selected,
  checkColor,
  onToggle,
}: {
  compact: boolean;
  contact: ContactProfile;
  selected: boolean;
  checkColor: string;
  onToggle: (pubkey: string | null) => void;
}) {
  const toggle = useCallback(
    () => onToggle(selected ? null : contact.pubkey),
    [contact.pubkey, onToggle, selected],
  );

  return (
    <Pressable
      accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${contact.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="items-center"
      style={styles.contactButton}
      onPress={toggle}
    >
      <View className="relative">
        <View
          className={[
            'rounded-full border-2 p-0.5',
            selected ? 'border-primary' : 'border-base-200',
          ].join(' ')}
        >
          <Avatar pubkey={contact.pubkey} size={compact ? 'lg' : 'xl'} />
        </View>
        {selected ? (
          <View className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-base-100 bg-primary">
            <Check size={13} color={checkColor} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <Text
        className={[
          'mt-1 max-w-[68px] text-center text-xs text-base-content',
          selected ? 'font-bold' : '',
        ].join(' ')}
        numberOfLines={1}
      >
        {contact.name}
      </Text>
    </Pressable>
  );
}

function ShareHeader({
  mutedColor,
  search,
  searchInputRef,
  onClose,
  onSearchChange,
}: {
  mutedColor: string;
  search: string;
  searchInputRef: React.RefObject<TextInput | null>;
  onClose?: () => void;
  onSearchChange: (value: string) => void;
}) {
  return (
    <>
      <View className="mx-auto mb-2 h-1 w-12 rounded-full bg-base-200" />
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xl font-black text-base-content">Share note</Text>
        {onClose ? (
          <Pressable
            accessibilityLabel="Close share sheet"
            accessibilityRole="button"
            className="h-12 w-12 items-center justify-center rounded-full bg-base-200"
            onPress={onClose}
          >
            <X size={21} color={mutedColor} strokeWidth={2.3} />
          </Pressable>
        ) : null}
      </View>
      <Text className="mb-2 text-sm font-semibold text-base-content">
        Send to someone
      </Text>
      <View className="h-12 flex-row items-center rounded-xl border border-base-200 bg-base-300 pl-3">
        <Search size={19} color={mutedColor} strokeWidth={2.1} />
        <TextInput
          ref={searchInputRef}
          accessibilityLabel="Search contacts"
          autoCapitalize="none"
          autoCorrect={false}
          className="h-12 flex-1 px-3 text-[15px] text-base-content"
          placeholder="Search contacts"
          placeholderTextColor={mutedColor}
          returnKeyType="search"
          value={search}
          onChangeText={onSearchChange}
        />
        {search ? (
          <Pressable
            accessibilityLabel="Clear contact search"
            accessibilityRole="button"
            className="h-12 w-12 items-center justify-center"
            onPress={() => onSearchChange('')}
          >
            <X size={18} color={mutedColor} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function RecipientPicker({
  checkColor,
  compact,
  contacts,
  hasSearch,
  selectedPubkey,
  onToggle,
}: {
  checkColor: string;
  compact: boolean;
  contacts: ContactProfile[];
  hasSearch: boolean;
  selectedPubkey: string | null;
  onToggle: (pubkey: string | null) => void;
}) {
  const renderContact = useCallback(
    ({ item }: ListRenderItemInfo<ContactProfile>) => (
      <ContactItem
        checkColor={checkColor}
        compact={compact}
        contact={item}
        selected={item.pubkey === selectedPubkey}
        onToggle={onToggle}
      />
    ),
    [checkColor, compact, onToggle, selectedPubkey],
  );

  if (!contacts.length) {
    return (
      <View
        style={styles.emptyContacts}
        className="items-center justify-center px-6"
      >
        <Text className="text-center text-sm text-primary-content">
          {hasSearch ? 'No matching contacts.' : 'No contacts to show yet.'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      horizontal
      className="mt-3"
      style={styles.contactsList}
      data={contacts}
      ItemSeparatorComponent={ContactSeparator}
      keyboardShouldPersistTaps="handled"
      keyExtractor={contact => contact.pubkey}
      renderItem={renderContact}
      showsHorizontalScrollIndicator={false}
    />
  );
}

function MessageComposer({
  contact,
  message,
  mutedColor,
  sendIconColor,
  onMessageChange,
  onSend,
}: {
  contact: ContactProfile;
  message: string;
  mutedColor: string;
  sendIconColor: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <View className="mb-3 h-14 flex-row items-center rounded-2xl border border-base-200 bg-base-300 pl-2 pr-1.5">
      <Avatar pubkey={contact.pubkey} size="md" />
      <TextInput
        accessibilityLabel={`Message for ${contact.name}`}
        className="h-12 flex-1 px-3 text-[15px] text-base-content"
        placeholder="Add a message…"
        placeholderTextColor={mutedColor}
        returnKeyType="send"
        value={message}
        onChangeText={onMessageChange}
        onSubmitEditing={onSend}
      />
      <Pressable
        accessibilityLabel={`Send note to ${contact.name}`}
        accessibilityRole="button"
        className="h-12 w-12 items-center justify-center rounded-full bg-primary"
        onPress={onSend}
      >
        <Send size={20} color={sendIconColor} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function ShareActionRow({
  bordered = false,
  icon,
  label,
  mutedColor,
  onPress,
}: {
  bordered?: boolean;
  icon: React.ReactNode;
  label: string;
  mutedColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={[
        'min-h-12 flex-row items-center px-3',
        bordered ? 'border-t border-base-200' : '',
      ].join(' ')}
      onPress={onPress}
    >
      <View className="w-10 items-center">{icon}</View>
      <Text className="flex-1 text-[15px] font-semibold text-base-content">
        {label}
      </Text>
      <ChevronRight size={19} color={mutedColor} strokeWidth={2.1} />
    </Pressable>
  );
}

function OtherWays({
  addressLabel,
  mutedColor,
  onCopyAddress,
  onCopyDetails,
  onCopyLink,
}: {
  addressLabel: string;
  mutedColor: string;
  onCopyAddress: () => void;
  onCopyDetails: () => void;
  onCopyLink: () => void;
}) {
  return (
    <>
      <View className="mb-2 h-px bg-base-200" />
      <Text className="mb-2 text-sm font-semibold text-base-content">
        Other ways
      </Text>
      <View className="overflow-hidden rounded-xl border border-base-200 bg-base-300">
        <ShareActionRow
          icon={<Link size={20} color={mutedColor} strokeWidth={2.1} />}
          label="Copy link"
          mutedColor={mutedColor}
          onPress={onCopyLink}
        />
        <ShareActionRow
          bordered
          icon={<Hash size={20} color={mutedColor} strokeWidth={2.1} />}
          label={addressLabel}
          mutedColor={mutedColor}
          onPress={onCopyAddress}
        />
        <ShareActionRow
          bordered
          icon={<FileText size={20} color={mutedColor} strokeWidth={2.1} />}
          label="Copy details"
          mutedColor={mutedColor}
          onPress={onCopyDetails}
        />
      </View>
    </>
  );
}

function ShareNotice({
  notice,
  primaryColor,
}: {
  notice: string;
  primaryColor: string;
}) {
  if (!notice) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="absolute bottom-3 self-center"
      pointerEvents="none"
      style={styles.notice}
    >
      <View className="flex-row items-center gap-2 rounded-xl border border-base-200 bg-base-300 px-4 py-3">
        <CheckCircle2 size={18} color={primaryColor} strokeWidth={2.4} />
        <Text
          accessibilityRole="alert"
          className="text-sm font-semibold text-base-content"
        >
          {notice}
        </Text>
      </View>
    </View>
  );
}

export function ShareModal({ nevent, naddr, onClose }: ShareModalProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
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
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const pointer = useMemo(() => decodeNevent(nevent), [nevent]);
  const relaysText = pointer?.relays?.length
    ? pointer.relays.join('\n')
    : 'No relay hints';
  const address = naddr ?? nevent;
  const noteUrl = `https://nuts.cash/explore/nevent:${nevent}`;

  const relays = useMemo(() => {
    const resolved = [
      ...new Set([...walletReadRelays, ...readRelays, ...writeRelays]),
    ];
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
    const matches = contacts.reduce<ContactProfile[]>((rows, pubkey) => {
      const contact = profiles[contactKey(pubkey)] ?? {
        pubkey,
        name: shortNpub(pubkey),
        event: null,
      };
      if (
        !query ||
        contact.name.toLowerCase().includes(query) ||
        contact.pubkey.toLowerCase().includes(query)
      ) {
        rows.push(contact);
      }
      return rows;
    }, []);
    matches.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
    );
    return matches;
  }, [contacts, profiles, search]);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setProfiles({});

    if (!contacts.length) return undefined;

    unsubscribeRef.current = subscribeUntilEose(
      `share_contacts_${contacts.length}_${relayHash(relays)}`,
      [
        {
          kinds: [0],
          authors: contacts,
          limit: contacts.length,
          cacheFirst: true,
          noContext: true,
          relays,
        },
      ],
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
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [contacts, relays]);

  useEffect(
    () => () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    },
    [],
  );

  const showNotice = useCallback((nextNotice: string) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNotice(nextNotice);
    noticeTimeoutRef.current = setTimeout(() => setNotice(''), 2400);
  }, []);

  const copyAddress = useCallback(async () => {
    await Clipboard.setStringAsync(`nostr:${address}`);
    showNotice(naddr ? 'Note address copied' : 'Note ID copied');
  }, [address, naddr, showNotice]);

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
    showNotice('Details copied');
  }, [address, noteUrl, pointer, relaysText, showNotice]);

  const copyNoteUrl = useCallback(async () => {
    await Clipboard.setStringAsync(noteUrl);
    showNotice('Link copied');
  }, [noteUrl, showNotice]);

  const selectedContact = selectedPubkey
    ? profiles[contactKey(selectedPubkey)] ?? {
        pubkey: selectedPubkey,
        name: shortNpub(selectedPubkey),
        event: null,
      }
    : null;

  const sendMessage = useCallback(() => {
    if (!selectedPubkey) return;
    const content = `${
      message.trim() ? `${message.trim()}\n\n` : ''
    }nostr:${nevent}`;
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
          showNotice(`Sent to ${selectedContact?.name ?? 'contact'}`);
          setMessage('');
        }
      },
      { defaultRelays: relays, trackStatus: true },
    );
  }, [
    message,
    nevent,
    pointer,
    relays,
    selectedContact?.name,
    selectedPubkey,
    showNotice,
    updateSendStatus,
  ]);

  const compact = width < 360;

  const handleContactToggle = useCallback((pubkey: string | null) => {
    setSelectedPubkey(pubkey);
  }, []);

  // Direction A contract: compact native sheet, recipient-first sharing,
  // grouped copy fallbacks, and transient feedback without a fixed footer.
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="bg-base-100"
      style={styles.container}
    >
      <View className="bg-base-100" style={styles.content}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ShareHeader
            mutedColor={theme.colors.primaryContent}
            search={search}
            searchInputRef={searchInputRef}
            onClose={onClose}
            onSearchChange={setSearch}
          />
          <RecipientPicker
            checkColor={theme.button.primary.text}
            compact={compact}
            contacts={contactRows}
            hasSearch={Boolean(search)}
            selectedPubkey={selectedPubkey}
            onToggle={handleContactToggle}
          />
          {selectedContact ? (
            <MessageComposer
              contact={selectedContact}
              message={message}
              mutedColor={theme.colors.primaryContent}
              sendIconColor={theme.button.primary.text}
              onMessageChange={setMessage}
              onSend={sendMessage}
            />
          ) : null}
          <OtherWays
            addressLabel={naddr ? 'Copy note address' : 'Copy note ID'}
            mutedColor={theme.colors.primaryContent}
            onCopyAddress={copyAddress}
            onCopyDetails={copyDetails}
            onCopyLink={copyNoteUrl}
          />
        </ScrollView>
        <ShareNotice notice={notice} primaryColor={theme.colors.primary} />
      </View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contactButton: {
    minHeight: 78,
    width: 68,
  },
  contactGap: {
    width: 12,
  },
  contactsList: {
    alignSelf: 'stretch',
    flexGrow: 0,
    minHeight: 82,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyContacts: {
    minHeight: 82,
  },
  notice: {
    maxWidth: '92%',
    zIndex: 4,
  },
  scrollContent: {
    alignItems: 'stretch',
    paddingBottom: 16,
    paddingTop: 8,
    width: '100%',
  },
});
