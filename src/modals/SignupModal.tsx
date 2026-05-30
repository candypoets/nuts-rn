import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import type {
  ConnectionStatus,
  NostrManagerLike,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import * as ImagePicker from 'expo-image-picker';
import {asNip51, asParsedEvent} from '@candypoets/nipworker/utils';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import {Camera, Check, ChevronLeft, Search, UserPlus, X} from 'lucide-react-native';
import type {EventTemplate} from 'nostr-tools';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {
  DEFAULT_MINTS,
  deriveSignupKeypair,
  generateSignupMnemonic,
} from '../nostr/keys';
import {
  DEFAULT_UPLOAD_SERVER,
  uploadFile,
  type LocalUploadAsset,
} from '../nostr/upload';
import { AppButton } from '../components/AppButton';
import {
  buildFollowListRequests,
  includePack,
  packSelectionFromEvent,
} from './FeedBuilderModal';
import {
  type FeedPackSelection,
  useAuthStore,
  useFeedBuilderStore,
  useNostrStore,
  useSendStatusStore,
  useWalletStore,
} from '../stores';

type SignupModalProps = {
  manager: NostrManagerLike | null;
  onBackToLogin: () => void;
  onDone: () => void;
};

type SignupStep = 'profile' | 'packs';
type SignupStackParamList = {
  SignupProfile: undefined;
  SignupPacks: undefined;
};

type SelectedAvatar = LocalUploadAsset & {
  previewUri: string;
};

type SeenList = {
  createdAt: number;
  index: number;
};

const SignupStack = createNativeStackNavigator<SignupStackParamList>();

function now() {
  return Math.floor(Date.now() / 1000);
}

function uniquePubkeys(packs: FeedPackSelection[]) {
  return Array.from(new Set(packs.flatMap(pack => pack.people))).filter(Boolean);
}

function publishWithStatus(
  sendId: string,
  event: EventTemplate,
  relays: string[],
  updateSendStatus: (sendId: string, status: Record<string, ConnectionStatus>) => void,
) {
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
    {defaultRelays: relays, trackStatus: true},
  );
}

export function SignupModal({manager, onBackToLogin, onDone}: SignupModalProps) {
  const insets = useSafeAreaInsets();
  const setAuth = useAuthStore(state => state.setAuth);
  const setProfile = useNostrStore(state => state.setProfile);
  const setFollows = useNostrStore(state => state.setFollows);
  const setTrustedMints = useNostrStore(state => state.setTrustedMints);
  const setWalletReadRelays = useNostrStore(state => state.setWalletReadRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const applySelection = useFeedBuilderStore(state => state.applySelection);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletMnemonicIndex = useWalletStore(state => state.setWalletMnemonicIndex);
  const setWalletPassphrase = useWalletStore(state => state.setWalletPassphrase);
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const keypairRef = useRef<ReturnType<typeof deriveSignupKeypair> | null>(null);
  const mnemonicRef = useRef<string | null>(null);
  const publicPacksRef = useRef<ParsedEvent[]>([]);
  const seenPublicPacksRef = useRef(new Map<string, SeenList>());
  const [step, setStep] = useState<SignupStep>('profile');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<SelectedAvatar | null>(null);
  const [search, setSearch] = useState('');
  const [selectedPacks, setSelectedPacks] = useState<FeedPackSelection[]>([]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );
  const footerPaddingBottom = Math.max(24, insets.bottom + 12);

  const prepareFreshAccount = useCallback(() => {
    if (!manager) return null;
    if (keypairRef.current) return keypairRef.current;
    const mnemonic = generateSignupMnemonic();
    const keypair = deriveSignupKeypair(mnemonic, '', 0);
    mnemonicRef.current = mnemonic;
    keypairRef.current = keypair;
    manager.setSigner('privkey', keypair.privkey);
    setAuth({
      pubkey: keypair.pubkey,
      npub: keypair.npub,
      privkey: keypair.privkey,
      nsec: keypair.nsec,
      hasSigner: true,
    });
    setWalletMnemonic(mnemonic);
    setWalletMnemonicIndex(0);
    setWalletPassphrase('');
    setWalletMintUrls(DEFAULT_MINTS);
    setActiveMintUrl(DEFAULT_MINTS[0] ?? null);
    setTrustedMints(DEFAULT_MINTS);
    return keypair;
  }, [
    manager,
    setActiveMintUrl,
    setAuth,
    setTrustedMints,
    setWalletMintUrls,
    setWalletMnemonic,
    setWalletMnemonicIndex,
    setWalletPassphrase,
  ]);

  useEffect(() => {
    if (step !== 'packs') return undefined;
    const seenPublicPacks = seenPublicPacksRef.current;
    publicPacksRef.current = [];
    seenPublicPacks.clear();
    setRevision(current => current + 1);

    const unsubscribe = subscribeToNostr(
      'signup_followpacks',
      buildFollowListRequests(null),
      message => {
        const parsedEvent = asParsedEvent(message);
        if (!parsedEvent) return;
        const list = asNip51(parsedEvent);
        if (!list?.title()) return;
        const dTag = list.d();
        if (!dTag || !includePack(parsedEvent, search)) return;
        const existing = seenPublicPacks.get(dTag);
        if (existing) {
          if (parsedEvent.createdAt() <= existing.createdAt) return;
          publicPacksRef.current[existing.index] = parsedEvent;
        } else {
          publicPacksRef.current = [...publicPacksRef.current, parsedEvent];
        }
        publicPacksRef.current = publicPacksRef.current.sort(
          (left, right) => right.createdAt() - left.createdAt(),
        );
        seenPublicPacks.clear();
        publicPacksRef.current.forEach((event, index) => {
          const eventDTag = asNip51(event)?.d();
          if (!eventDTag) return;
          seenPublicPacks.set(eventDTag, {
            createdAt: event.createdAt(),
            index,
          });
        });
        setRevision(current => current + 1);
      },
      {closeOnEose: false},
    );

    return () => unsubscribe();
  }, [search, step]);

  const packItems = useMemo(
    () => {
      void revision;
      return publicPacksRef.current.filter(event => includePack(event, search));
    },
    [revision, search],
  );
  const selectedPackIds = useMemo(
    () => new Set(selectedPacks.map(pack => pack.id)),
    [selectedPacks],
  );

  const pickAvatar = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      setAvatar({
        uri: asset.uri,
        previewUri: asset.uri,
        width: Math.max(1, Math.round(asset.width || 320)),
        height: Math.max(1, Math.round(asset.height || 320)),
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
    } catch (error) {
      console.warn('[signup] image picker failed', error);
    }
  }, []);

  const continueFromProfile = useCallback(() => {
    const keypair = prepareFreshAccount();
    const trimmedName = name.trim();
    if (!manager || !keypair || !trimmedName) return false;
    const signupAvatar = avatar;
    const trimmedBio = bio.trim();
    const publishRelays = relays;

    setProfile({
      pubkey: keypair.pubkey,
      name: trimmedName,
      displayName: trimmedName,
      picture: signupAvatar?.previewUri ?? null,
      updatedAt: now(),
    });
    setWalletReadRelays(publishRelays);
    setStatus(null);

    void (async () => {
      try {
        let picture: string | null = null;
        if (signupAvatar) {
          const uploaded = await uploadFile(signupAvatar, {
            server: DEFAULT_UPLOAD_SERVER,
            serverType: 'blossom',
          });
          picture = uploaded.url;
          setProfile({
            pubkey: keypair.pubkey,
            name: trimmedName,
            displayName: trimmedName,
            picture,
            updatedAt: now(),
          });
        }

        const metadata = {
          name: trimmedName,
          display_name: trimmedName,
          about: trimmedBio,
          picture: picture || undefined,
        };
        const event: EventTemplate = {
          kind: 0,
          content: JSON.stringify(metadata),
          created_at: now(),
          tags: [],
        };
        publishWithStatus(`signup_profile_${Date.now()}`, event, publishRelays, updateSendStatus);
        publishWithStatus(
          `signup_wallet_${Date.now()}`,
          {
            kind: 17375,
            content: JSON.stringify([
              ['privkey', keypair.privkey],
              ...DEFAULT_MINTS.map(mint => ['mint', mint]),
            ]),
            created_at: now(),
            tags: [],
          },
          publishRelays,
          updateSendStatus,
        );
        publishWithStatus(
          `signup_trusted_mints_${Date.now()}`,
          {
            kind: 10019,
            content: '',
            created_at: now(),
            tags: [
              ...DEFAULT_MINTS.map(mint => ['mint', mint]),
              ['pubkey', keypair.pubkey],
              ...publishRelays.map(relay => ['relay', relay]),
            ],
          },
          publishRelays,
          updateSendStatus,
        );
      } catch (error) {
        console.warn('[signup] profile publish failed', error);
      }
    })();
    return true;
  }, [
    avatar,
    bio,
    manager,
    name,
    prepareFreshAccount,
    relays,
    setProfile,
    setWalletReadRelays,
    updateSendStatus,
  ]);

  const togglePack = useCallback((pack: FeedPackSelection) => {
    setSelectedPacks(current =>
      current.some(selected => selected.id === pack.id)
        ? current.filter(selected => selected.id !== pack.id)
        : [...current, pack],
    );
  }, []);

  const finish = useCallback(() => {
    const people = uniquePubkeys(selectedPacks);
    const followListPack: FeedPackSelection = {
      id: 'followlist',
      kind: 39089,
      title: 'Follow List',
      description: 'People you chose during signup',
      image: null,
      localImage: 'followlist',
      people,
      dTag: 'followlist',
    };
    const event: EventTemplate = {
      kind: 3,
      content: '',
      created_at: now(),
      tags: people.map(pubkey => ['p', pubkey]),
    };
    publishWithStatus(`signup_follows_${Date.now()}`, event, relays, updateSendStatus);
    setFollows(people);
    applySelection([1], [followListPack]);
    onDone();
  }, [applySelection, onDone, relays, selectedPacks, setFollows, updateSendStatus]);

  return (
    <SignupStack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: {backgroundColor: '#f8fafc'},
      }}
    >
      <SignupStack.Screen name="SignupProfile">
        {({navigation}) => (
          <SignupProfileStep
            avatar={avatar}
            bio={bio}
            canContinue={Boolean(name.trim() && manager)}
            footerPaddingBottom={footerPaddingBottom}
            name={name}
            status={status}
            onBack={onBackToLogin}
            onBioChange={setBio}
            onContinue={() => {
              navigation.navigate('SignupPacks');
              InteractionManager.runAfterInteractions(() => {
                continueFromProfile();
              });
            }}
            onFocus={() => setStep('profile')}
            onNameChange={setName}
            onPickAvatar={pickAvatar}
          />
        )}
      </SignupStack.Screen>
      <SignupStack.Screen name="SignupPacks">
        {({navigation}) => (
          <SignupPacksStep
            footerPaddingBottom={footerPaddingBottom}
            items={packItems}
            selectedPackIds={selectedPackIds}
            selectedPacksCount={selectedPacks.length}
            search={search}
            onBack={navigation.goBack}
            onFinish={finish}
            onFocus={() => setStep('packs')}
            onSearchChange={setSearch}
            onTogglePack={togglePack}
          />
        )}
      </SignupStack.Screen>
    </SignupStack.Navigator>
  );
}

function SignupProfileStep({
  avatar,
  bio,
  canContinue,
  footerPaddingBottom,
  name,
  status,
  onBack,
  onBioChange,
  onContinue,
  onFocus,
  onNameChange,
  onPickAvatar,
}: {
  avatar: SelectedAvatar | null;
  bio: string;
  canContinue: boolean;
  footerPaddingBottom: number;
  name: string;
  status: string | null;
  onBack: () => void;
  onBioChange: (value: string) => void;
  onContinue: () => void;
  onFocus: () => void;
  onNameChange: (value: string) => void;
  onPickAvatar: () => void;
}) {
  const focused = useIsFocused();

  useEffect(() => {
    if (focused) onFocus();
  }, [focused, onFocus]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="h-full bg-slate-50"
    >
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <View className="h-full px-4 pt-4">
          <SignupHeader title="Create account" onBack={onBack} />
          <View className="mt-6 items-center">
            <Pressable
              className="h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm"
              onPress={onPickAvatar}
            >
              {avatar ? (
                <Image source={{uri: avatar.previewUri}} className="h-full w-full" resizeMode="cover" />
              ) : (
                <Camera size={30} color="#52616f" strokeWidth={2.1} />
              )}
            </Pressable>
          </View>
          <View className="w-full" style={styles.profileForm}>
            <Text className="mb-2 mt-8 text-sm font-semibold text-slate-700">Name</Text>
            <TextInput
              className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-base text-slate-900"
              placeholder="Your name"
              placeholderTextColor="#8794a0"
              returnKeyType="done"
              value={name}
              onChangeText={onNameChange}
              onSubmitEditing={Keyboard.dismiss}
            />
            <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700">Bio</Text>
            <TextInput
              className="min-h-28 rounded-lg border border-slate-200 bg-white px-3 py-3 text-base text-slate-900"
              multiline
              placeholder="A short bio"
              placeholderTextColor="#8794a0"
              blurOnSubmit
              textAlignVertical="top"
              returnKeyType="done"
              value={bio}
              onChangeText={onBioChange}
              onSubmitEditing={Keyboard.dismiss}
            />
            {status ? <Text className="mt-3 text-sm text-slate-500">{status}</Text> : null}
          </View>
          <View
            className="mt-auto w-full"
            style={[styles.profileForm, {paddingBottom: footerPaddingBottom}]}
          >
            <AppButton
              disabled={!canContinue}
              title="Continue"
              onPress={onContinue}
            />
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function SignupPacksStep({
  footerPaddingBottom,
  items,
  search,
  selectedPackIds,
  selectedPacksCount,
  onBack,
  onFinish,
  onFocus,
  onSearchChange,
  onTogglePack,
}: {
  footerPaddingBottom: number;
  items: ParsedEvent[];
  search: string;
  selectedPackIds: Set<string>;
  selectedPacksCount: number;
  onBack: () => void;
  onFinish: () => void;
  onFocus: () => void;
  onSearchChange: (value: string) => void;
  onTogglePack: (selection: FeedPackSelection) => void;
}) {
  const focused = useIsFocused();

  useEffect(() => {
    if (focused) onFocus();
  }, [focused, onFocus]);

  return (
    <View className="h-full bg-slate-50">
      <View className="px-4 pt-4">
        <SignupHeader title="Choose what to see" onBack={onBack} />
        <Text className="mt-2 text-sm leading-5 text-slate-600">
          Select follow packs. We will create your follow list from the people inside them.
        </Text>
        <SearchBox value={search} onChangeText={onSearchChange} />
        <Text className="mb-2 text-xs font-semibold text-slate-500">
          {selectedPacksCount} selected
        </Text>
      </View>
      <FlatList
        className="flex-1"
        contentContainerClassName="px-3 pb-24"
        data={items}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item, index) => item.id() || `pack_${index}`}
        renderItem={({item}) => (
          <SignupPackItem
            item={item}
            selected={selectedPackIds.has(packSelectionFromEvent(item)?.id || '')}
            onToggle={onTogglePack}
          />
        )}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={
          <Text className="px-4 py-10 text-center text-sm text-slate-500">
            Waiting for follow packs.
          </Text>
        }
      />
      <View
        className="border-t border-slate-200 bg-white px-4 pt-4"
        style={{paddingBottom: footerPaddingBottom}}
      >
        <AppButton title="Finish" onPress={onFinish} />
      </View>
    </View>
  );
}

function SignupHeader({title, onBack}: {title: string; onBack: () => void}) {
  return (
    <View className="h-12 flex-row items-center justify-between">
      <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-white" hitSlop={12} onPress={onBack}>
        <ChevronLeft size={22} color="#17212b" strokeWidth={2.2} />
      </Pressable>
      <Text className="text-lg font-bold text-slate-900">{title}</Text>
      <View className="h-10 w-10" />
    </View>
  );
}

function SearchBox({
  onChangeText,
  value,
}: {
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View className="mb-3 mt-4 h-11 flex-row items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
      <Search size={17} color="#8794a0" strokeWidth={2.1} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-base text-slate-900"
        placeholder="Search follow packs..."
        placeholderTextColor="#8794a0"
        value={value}
        onChangeText={onChangeText}
      />
      {value ? (
        <Pressable hitSlop={10} onPress={() => onChangeText('')}>
          <X size={17} color="#52616f" strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = {
  profileForm: {
    alignSelf: 'center' as const,
    maxWidth: 448,
  },
};

const SignupPackItem = memo(function SignupPackItem({
  item,
  selected,
  onToggle,
}: {
  item: ParsedEvent;
  selected: boolean;
  onToggle: (selection: FeedPackSelection) => void;
}) {
  const selection = useMemo(() => packSelectionFromEvent(item), [item]);
  const handlePress = useCallback(() => {
    if (selection) onToggle(selection);
  }, [onToggle, selection]);
  if (!selection) return null;
  const hasImage = selection.image && !selection.image.startsWith('data:');

  return (
    <Pressable className="overflow-hidden rounded-lg border border-slate-200 bg-white" onPress={handlePress}>
      <View className="h-28 bg-slate-200">
        {hasImage ? (
          <Image className="h-full w-full" resizeMode="cover" source={{uri: selection.image ?? undefined}} />
        ) : (
          <View className="h-full w-full items-center justify-center bg-slate-200">
            <UserPlus size={34} color="#8794a0" strokeWidth={1.8} />
          </View>
        )}
        {selected ? (
          <View className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full bg-emerald-700">
            <Check size={18} color="#ffffff" strokeWidth={2.4} />
          </View>
        ) : null}
      </View>
      <View className="px-3 py-3">
        <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
          {selection.title}
        </Text>
        {selection.description ? (
          <Text className="mt-1 text-sm leading-5 text-slate-600" numberOfLines={2}>
            {selection.description}
          </Text>
        ) : null}
        <Text className="mt-2 text-xs font-semibold text-slate-500">
          {selection.people.length} people
        </Text>
      </View>
    </Pressable>
  );
});
