import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from 'expo-router/react-navigation';
import type {Kind0Parsed, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {asKind0, asParsedEvent} from '@candypoets/nipworker/utils';
import {ChevronDown, ChevronRight, CreditCard, ScanLine, Search, X, Zap} from 'lucide-react-native';

import {Feed} from '../components/Feed';
import {shortNpub, shortPubkey} from '../lib/identity';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {subscribeUntilEose} from '../nostr/subscribeUntilEose';
import type {AppNavigationProp} from '../navigation/types';
import {useNostrStore} from '../stores';
import {useAppTheme} from '../theme';

type ContactProfile = {
  pubkey: string;
  name: string;
  nip05: string | null;
  picture: string | null;
  event: ParsedEvent | null;
};

type SendModalProps = {
  onClose: () => void;
};

const fallbackProfileImage = require('../../assets/miss-profile.png');

function displayName(kind0: Kind0Parsed | null, pubkey: string) {
  return (
    kind0?.name?.()?.trim() ||
    kind0?.displayName?.()?.trim() ||
    shortNpub(pubkey)
  );
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function contactKey(pubkey: string) {
  return pubkey.toLowerCase();
}

export function SendModal({onClose}: SendModalProps) {
  const navigation =
    useNavigation<AppNavigationProp>();
  const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;
  const follows = useNostrStore(state => state.follows);
  const readRelays = useNostrStore(state => state.readRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const [search, setSearch] = useState('');
  const [profiles, setProfiles] = useState<Record<string, ContactProfile>>({});
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const relays = useMemo(() => {
    const resolved = [...new Set([...walletReadRelays, ...readRelays])];
    return resolved.length ? resolved : DEFAULT_FEED_RELAYS;
  }, [readRelays, walletReadRelays]);

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    return follows.filter(pubkey => {
      const key = contactKey(pubkey);
      if (!pubkey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [follows]);

  const handleContactMessage = useCallback((message: WorkerMessage) => {
    const parsed = asParsedEvent(message);
    if (!parsed || parsed.kind() !== 0) return;
    const pubkey = parsed.pubkey();
    if (!pubkey) return;
    const kind0 = asKind0(parsed);
    setProfiles(current => ({
      ...current,
      [contactKey(pubkey)]: {
        pubkey,
        name: displayName(kind0, pubkey),
        nip05: kind0?.nip05?.()?.trim() || null,
        picture: kind0?.picture?.() || null,
        event: parsed,
      },
    }));
  }, []);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setProfiles({});

    if (!contacts.length) return undefined;

    unsubscribeRef.current = subscribeUntilEose(
      `send_contacts_${contacts.length}_${relayHash(relays)}`,
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
      handleContactMessage,
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [contacts, handleContactMessage, relays]);

  const contactRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts
      .map(pubkey => {
        const profile = profiles[contactKey(pubkey)];
        return profile ?? {
          pubkey,
          name: shortNpub(pubkey),
          nip05: null,
          picture: null,
          event: null,
        };
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

  const openRecipient = useCallback(
    (pubkey: string) => {
      navigation.navigate('SendEcash', {pubkey});
    },
    [navigation],
  );

  const renderHeader = useCallback(
    () => (
      <View className="bg-base-100 px-4 pt-4">
        <View className="h-14 flex-row items-center justify-between">
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full border border-base-200 bg-base-300"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronDown size={22} color={iconColor} strokeWidth={2.3} />
          </Pressable>
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full border border-base-200 bg-base-300"
            hitSlop={12}
            onPress={() => navigation.navigate('Scan')}
          >
            <ScanLine size={21} color={iconColor} strokeWidth={2.3} />
          </Pressable>
        </View>
        <Text className="mt-4 text-2xl font-bold text-base-content">Send Money</Text>
        <View className="mt-4 flex-row items-center rounded-lg border border-base-200 bg-base-300 px-3">
          <Search size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-12 flex-1 px-3 text-base text-base-content"
            placeholder="Search contacts"
            placeholderTextColor={theme.colors.primaryContent}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch('')}>
              <X size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
        <View className="my-4 overflow-hidden rounded-lg border border-base-200 bg-base-300">
          <SendOption
            disabled
            icon={<Zap size={23} color={theme.colors.primaryContent} strokeWidth={2.2} />}
            title="Tap cash"
            subtitle="Offline instant payment"
            onPress={() => navigation.navigate('Tapcash')}
          />
          <SendOption
            icon={<Zap size={23} color={theme.colors.primary} strokeWidth={2.2} />}
            title="Pay an invoice"
            subtitle="Pay out with lightning"
            onPress={() => navigation.navigate('Lightning')}
          />
        </View>
        <Text className="mb-2 text-lg font-bold text-base-content">Contacts</Text>
      </View>
    ),
    [iconColor, navigation, onClose, search, theme],
  );

  return (
    <View style={[styles.modalBody, {backgroundColor: theme.colors.base100}]}>
      <Feed
        items={contactRows}
        getItemId={item => item.pubkey}
        header={renderHeader}
        headerSafeArea
        disableMaintainVisibleContentPosition
        renderItem={({item, index}) => (
          <ContactRow
            contact={item}
            previous={contactRows[index - 1]}
            next={contactRows[index + 1]}
            searching={!!search.trim()}
            onPress={() => openRecipient(item.pubkey)}
          />
        )}
        empty={<EmptyContacts hasContacts={contacts.length > 0} />}
        contentContainerClassName="pb-28"
      />
    </View>
  );
}

function SendOption({
  disabled = false,
  icon,
  title,
  subtitle,
  onPress,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      className={`min-h-16 flex-row items-center border-b border-base-200 px-4 ${disabled ? 'opacity-45' : ''}`}
      disabled={disabled}
      onPress={onPress}
    >
      <View className="w-12 items-start">{icon}</View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-bold text-base-content">{title}</Text>
        <Text className="mt-0.5 text-xs text-primary-content">{subtitle}</Text>
      </View>
      <ChevronRight size={21} color={theme.colors.primaryContent} strokeWidth={2.2} />
    </Pressable>
  );
}

function contactLetter(contact?: ContactProfile) {
  if (!contact) return undefined;
  const name = contact.name.trim();
  if (!name || name === shortNpub(contact.pubkey)) return '#';
  return name.slice(0, 1).toUpperCase();
}

function ContactRow({
  contact,
  previous,
  next,
  searching,
  onPress,
}: {
  contact: ContactProfile;
  previous?: ContactProfile;
  next?: ContactProfile;
  searching: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const firstLetter = contactLetter(contact) || '#';
  const previousLetter = contactLetter(previous);
  const nextLetter = contactLetter(next);
  const isFirst = searching || firstLetter !== previousLetter;
  const isLast = searching || firstLetter !== nextLetter;
  const fallbackName = shortNpub(contact.pubkey);
  const subtitle =
    contact.nip05 || (contact.name === fallbackName ? '' : fallbackName);

  return (
    <View>
      {isFirst && !searching ? (
        <Text className="px-6 pb-1 pt-3 text-sm font-bold text-primary-content">
          {firstLetter}
        </Text>
      ) : null}
      <Pressable
        className={`mx-3 flex-row items-center border border-base-200 bg-base-300 px-3 py-3 ${isFirst ? 'rounded-t-lg' : 'border-t-0'} ${isLast ? 'rounded-b-lg' : 'border-b-0'} ${searching ? 'mt-1 rounded-lg border-t' : ''}`}
        onPress={onPress}
      >
        <View className="h-10 w-10 overflow-hidden rounded-full border border-base-200 bg-base-200">
          <Image
            source={contact.picture ? {uri: contact.picture} : fallbackProfileImage}
            className="h-full w-full"
            resizeMode="cover"
          />
        </View>
        <View className="ml-3 min-w-0 flex-1">
          <Text className="text-base font-semibold text-base-content" numberOfLines={1}>
            {contact.name}
          </Text>
          {subtitle ? (
            <Text className="mt-0.5 text-xs text-primary-content" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={20} color={theme.colors.primaryContent} strokeWidth={2.1} />
      </Pressable>
    </View>
  );
}

function EmptyContacts({hasContacts}: {hasContacts: boolean}) {
  const theme = useAppTheme();
  return (
    <View className="mx-3 rounded-lg border border-base-200 bg-base-300 px-5 py-6">
      <View className="items-center">
        <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-base-200">
          <CreditCard size={25} color={theme.colors.primary} strokeWidth={2.2} />
        </View>
        <Text className="text-center text-lg font-bold text-base-content">
          {hasContacts ? 'No matching contacts' : 'No contacts yet'}
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-primary-content">
          {hasContacts
            ? 'Try searching by display name or public key.'
            : 'Your Nostr follow list will appear here once it is loaded.'}
        </Text>
      </View>
    </View>
  );
}

export function SendPlaceholderModal({
  title,
  pubkey,
  invoice,
  onClose,
}: {
  title: string;
  pubkey?: string;
  invoice?: string;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const themedStyles = useMemo(
    () => createSendModalStyles(theme),
    [theme],
  );

  return (
    <View style={themedStyles.modalBody}>
      <View style={themedStyles.placeholderSheet}>
        <View style={themedStyles.modalHandle} />
        <View style={themedStyles.placeholderHeader}>
          <Text style={themedStyles.placeholderTitle}>{title}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color={theme.colors.primaryContent} strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={themedStyles.placeholderBody}>
          {invoice
            ? `Scanned invoice/LNURL: ${invoice}`
            : pubkey
            ? `Payment flow for ${shortPubkey(pubkey)} is not wired in this RN build yet.`
            : 'This payment flow is not wired in this RN build yet.'}
        </Text>
      </View>
    </View>
  );
}

function createSendModalStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
  modalBody: {
    backgroundColor: theme.colors.base100,
    flex: 1,
  },
  placeholderSheet: {
    backgroundColor: theme.colors.base300,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 'auto',
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: theme.colors.primaryContent,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 42,
  },
  placeholderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  placeholderTitle: {
    color: theme.colors.base100 === '#111111' ? '#ffffff' : '#1a1a1a',
    fontSize: 22,
    fontWeight: '800',
  },
  placeholderBody: {
    color: theme.colors.primaryContent,
    fontSize: 15,
    lineHeight: 22,
  },
  });
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
});
