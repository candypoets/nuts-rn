import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {Kind0Parsed, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asKind0, asParsedEvent} from '@candypoets/nipworker/utils';
import {ChevronDown, ChevronRight, CreditCard, ScanLine, Search, X, Zap} from 'lucide-react-native';

import {Feed} from '../components/Feed';
import {shortPubkey} from '../components/notes/time';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import type {RootStackParamList} from '../navigation/types';
import {useNostrStore} from '../stores';

type ContactProfile = {
  pubkey: string;
  name: string;
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
    shortPubkey(pubkey)
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
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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

    const requests = contacts.map(pubkey => ({
      kinds: [0],
      authors: [pubkey],
      cacheFirst: true,
      noContext: true,
      relays,
    }));

    unsubscribeRef.current = subscribeToNostr(
      `send_contacts_${contacts.length}_${relayHash(relays)}`,
      requests,
      handleContactMessage,
      {closeOnEose: false},
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
          name: shortPubkey(pubkey),
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
      <View className="bg-slate-50 px-4 pt-4">
        <View className="h-14 flex-row items-center justify-between">
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white"
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronDown size={22} color="#17212b" strokeWidth={2.3} />
          </Pressable>
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white"
            hitSlop={12}
            onPress={() => navigation.navigate('Scan')}
          >
            <ScanLine size={21} color="#17212b" strokeWidth={2.3} />
          </Pressable>
        </View>
        <Text className="mt-4 text-2xl font-bold text-slate-950">Send Money</Text>
        <View className="mt-4 flex-row items-center rounded-lg border border-slate-200 bg-white px-3">
          <Search size={18} color="#8794a0" strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-12 flex-1 px-3 text-base text-slate-950"
            placeholder="Search contacts"
            placeholderTextColor="#8794a0"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch('')}>
              <X size={18} color="#8794a0" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
        <View className="my-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <SendOption
            disabled
            icon={<Zap size={23} color="#8794a0" strokeWidth={2.2} />}
            title="Tap cash"
            subtitle="Offline instant payment"
            onPress={() => navigation.navigate('Tapcash')}
          />
          <SendOption
            icon={<Zap size={23} color="#1f7a5a" strokeWidth={2.2} />}
            title="Pay an invoice"
            subtitle="Pay out with lightning"
            onPress={() => navigation.navigate('Lightning')}
          />
        </View>
        <Text className="mb-2 text-lg font-bold text-slate-950">Contacts</Text>
      </View>
    ),
    [navigation, onClose, search],
  );

  return (
    <View style={styles.modalBody}>
      <Feed
        items={contactRows}
        getItemId={item => item.pubkey}
        header={renderHeader}
        headerSafeArea
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
  return (
    <Pressable
      className={`min-h-16 flex-row items-center border-b border-slate-100 px-4 ${disabled ? 'opacity-45' : ''}`}
      disabled={disabled}
      onPress={onPress}
    >
      <View className="w-12 items-start">{icon}</View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-bold text-slate-950">{title}</Text>
        <Text className="mt-0.5 text-xs text-slate-500">{subtitle}</Text>
      </View>
      <ChevronRight size={21} color="#8794a0" strokeWidth={2.2} />
    </Pressable>
  );
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
  const firstLetter = contact.name.trim().slice(0, 1).toUpperCase() || '#';
  const previousLetter = previous?.name.trim().slice(0, 1).toUpperCase();
  const nextLetter = next?.name.trim().slice(0, 1).toUpperCase();
  const isFirst = searching || firstLetter !== previousLetter;
  const isLast = searching || firstLetter !== nextLetter;

  return (
    <View>
      {isFirst && !searching ? (
        <Text className="px-6 pb-1 pt-3 text-sm font-bold text-slate-500">
          {firstLetter}
        </Text>
      ) : null}
      <Pressable
        className={`mx-3 flex-row items-center border border-slate-200 bg-white px-3 py-3 ${isFirst ? 'rounded-t-lg' : 'border-t-0'} ${isLast ? 'rounded-b-lg' : 'border-b-0'} ${searching ? 'mt-1 rounded-lg border-t' : ''}`}
        onPress={onPress}
      >
        <View className="h-10 w-10 overflow-hidden rounded-full border border-slate-200 bg-slate-200">
          <Image
            source={contact.picture ? {uri: contact.picture} : fallbackProfileImage}
            className="h-full w-full"
            resizeMode="cover"
          />
        </View>
        <View className="ml-3 min-w-0 flex-1">
          <Text className="text-base font-semibold text-slate-950" numberOfLines={1}>
            {contact.name}
          </Text>
          <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
            {shortPubkey(contact.pubkey)}
          </Text>
        </View>
        <ChevronRight size={20} color="#8794a0" strokeWidth={2.1} />
      </Pressable>
    </View>
  );
}

function EmptyContacts({hasContacts}: {hasContacts: boolean}) {
  return (
    <View className="mx-3 rounded-lg border border-slate-200 bg-white px-5 py-6">
      <View className="items-center">
        <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <CreditCard size={25} color="#1f7a5a" strokeWidth={2.2} />
        </View>
        <Text className="text-center text-lg font-bold text-slate-950">
          {hasContacts ? 'No matching contacts' : 'No contacts yet'}
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
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
  return (
    <View style={styles.modalBody}>
      <View style={styles.placeholderSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.placeholderHeader}>
          <Text style={styles.placeholderTitle}>{title}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={styles.placeholderBody}>
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

const styles = StyleSheet.create({
  modalBody: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  placeholderSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 'auto',
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: '#cbd5e1',
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
    color: '#17212b',
    fontSize: 22,
    fontWeight: '800',
  },
  placeholderBody: {
    color: '#52616f',
    fontSize: 15,
    lineHeight: 22,
  },
});
