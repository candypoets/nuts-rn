import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from 'expo-router/build/react-navigation/native-stack';
import {useIsFocused} from 'expo-router/react-navigation';
import {useReducedMotion} from 'react-native-reanimated';
import type {
  ConnectionStatus,
  NostrManagerLike,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import * as ImagePicker from 'expo-image-picker';
import {asNip51, asParsedEvent} from '@candypoets/nipworker/utils';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import {
  Camera,
  Check,
  ChevronLeft,
  CircleAlert,
  Search,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react-native';
import type {EventTemplate} from 'nostr-tools';

import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {buildRelayListPublishPlan} from '../nostr/relayList';
import {subscribeUntilEose} from '../nostr/subscribeUntilEose';
import {deriveSignupKeypair, generateSignupMnemonic} from '../nostr/keys';
import {
  cashuMintRecommendationEvent,
  discoverRecommendedCashuMint,
  type RecommendedCashuMint,
} from '../nostr/cashu';
import {
  DEFAULT_UPLOAD_SERVER,
  uploadFile,
  type LocalUploadAsset,
} from '../nostr/upload';
import {deleteImagePickerAsset} from '../media/cache';
import {AppButton} from '../components/AppButton';
import {useAppTheme} from '../theme';
import {
  buildFollowListRequests,
  includePack,
  packSelectionFromEvent,
} from './FeedBuilderModal';
import {
  BOOTSTRAP_RELAYS,
  INDEXER_RELAYS,
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
  /**
   * Whether the hosting screen is focused. The pack-search subscription only
   * runs while the packs step is active AND the screen is focused.
   */
  focused?: boolean;
};

type SignupStackParamList = {
  SignupProfile: undefined;
  SignupPacks: undefined;
};

// expo-router 57 hard-errors when app code imports @react-navigation/*, but
// its own vendored fork is reachable via deep imports inside the expo-router
// package, which passes the Metro check. This recreates the original
// pre-migration embedded native stack (slide_from_right, swipe-back).
const SignupStack = createNativeStackNavigator<SignupStackParamList>();

type SignupWizardContextValue = {
  focused: boolean;
  footerPaddingBottom: number;
  manager: NostrManagerLike | null;
  onBackToLogin: () => void;
  onDone: () => void;
};

const SignupWizardContext = createContext<SignupWizardContextValue | null>(
  null,
);

function useSignupWizard() {
  const value = useContext(SignupWizardContext);
  if (!value)
    throw new Error('Signup wizard screen rendered outside SignupModal');
  return value;
}

type SelectedAvatar = LocalUploadAsset & {
  previewUri: string;
};

type SeenList = {
  createdAt: number;
  index: number;
};

function now() {
  return Math.floor(Date.now() / 1000);
}

function uniquePubkeys(packs: FeedPackSelection[]) {
  return Array.from(new Set(packs.flatMap(pack => pack.people))).filter(
    Boolean,
  );
}

function publishWithStatus(
  sendId: string,
  event: EventTemplate,
  relays: string[],
  updateSendStatus: (
    sendId: string,
    status: Record<string, ConnectionStatus>,
  ) => void,
) {
  const sendStatus: Record<string, ConnectionStatus> = {};
  console.log('[signup-publish] start', {
    sendId,
    kind: event.kind,
    relays,
  });
  publishToNostr(
    sendId,
    event,
    (message: WorkerMessage) => {
      const status = isConnectionStatus(message);
      const relayUrl = status?.relayUrl();
      if (!status || !relayUrl) return;
      sendStatus[relayUrl] = status;
      console.log('[signup-publish] relay status', {
        sendId,
        kind: event.kind,
        relay: relayUrl,
        status: status.status()?.toString(),
        message: status.message?.(),
      });
      updateSendStatus(sendId, sendStatus);
    },
    {defaultRelays: relays, trackStatus: true},
  );
}

// Profile step state/logic. Nothing here is read by the packs step: the profile
// fields are consumed by continueFromProfile, which fires when leaving the
// profile step, so no shared store is needed.
export function useSignupProfileController(
  manager: NostrManagerLike | null,
  {requireRecommendedMint = true}: {requireRecommendedMint?: boolean} = {},
) {
  const setAuth = useAuthStore(state => state.setAuth);
  const setProfile = useNostrStore(state => state.setProfile);
  const setRelayMarkers = useNostrStore(state => state.setRelayMarkers);
  const setTrustedMints = useNostrStore(state => state.setTrustedMints);
  const setWalletReadRelays = useNostrStore(state => state.setWalletReadRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletMnemonicIndex = useWalletStore(
    state => state.setWalletMnemonicIndex,
  );
  const setWalletPassphrase = useWalletStore(
    state => state.setWalletPassphrase,
  );
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const keypairRef = useRef<ReturnType<typeof deriveSignupKeypair> | null>(
    null,
  );
  const mnemonicRef = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<SelectedAvatar | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [recommendedMint, setRecommendedMint] =
    useState<RecommendedCashuMint | null>(null);
  const [mintDiscoveryReady, setMintDiscoveryReady] = useState(false);
  const avatarRef = useRef(avatar);
  const avatarUploadsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );

  useEffect(() => {
    let alive = true;
    setMintDiscoveryReady(false);
    setStatus('Preparing your wallet…');
    discoverRecommendedCashuMint(BOOTSTRAP_RELAYS).then(mint => {
      if (!alive) return;
      setRecommendedMint(mint);
      setMintDiscoveryReady(true);
      setStatus(
        mint
          ? 'Your wallet is ready.'
          : 'We couldn’t prepare your wallet right now.',
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  useEffect(() => {
    mountedRef.current = true;
    const avatarUploads = avatarUploadsRef.current;
    return () => {
      mountedRef.current = false;
      const uri = avatarRef.current?.uri;
      if (uri && !avatarUploads.has(uri)) {
        deleteImagePickerAsset(uri);
      }
    };
  }, []);

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
    return keypair;
  }, [
    manager,
    setAuth,
    setWalletMnemonic,
    setWalletMnemonicIndex,
    setWalletPassphrase,
  ]);

  const pickAvatar = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      const previousUri = avatarRef.current?.uri;
      if (previousUri && !avatarUploadsRef.current.has(previousUri)) {
        deleteImagePickerAsset(previousUri);
      }
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
    if (
      !manager ||
      !keypair ||
      !trimmedName ||
      (requireRecommendedMint && !recommendedMint)
    ) {
      return null;
    }
    const signupAvatar = avatar;
    const trimmedBio = bio.trim();
    const relayPlan = buildRelayListPublishPlan({
      readRelays: relays,
      writeRelays: relays,
      discoveryRelays: INDEXER_RELAYS,
      createdAt: now(),
    });
    const publishRelays = relayPlan.writeRelays;
    const selectedMints = recommendedMint ? [recommendedMint.mint] : [];
    const profileContent = JSON.stringify({
      name: trimmedName,
      display_name: trimmedName,
      about: trimmedBio,
    });
    if (recommendedMint) {
      setWalletMintUrls(selectedMints);
      setActiveMintUrl(recommendedMint.mint);
      setTrustedMints(selectedMints);
    }

    setProfile({
      pubkey: keypair.pubkey,
      name: trimmedName,
      displayName: trimmedName,
      picture: signupAvatar?.previewUri ?? null,
      updatedAt: now(),
    });
    setWalletReadRelays(publishRelays);
    setRelayMarkers(relayPlan.markers);
    setStatus(null);

    void (async () => {
      try {
        publishWithStatus(
          `signup_relays_${Date.now()}`,
          relayPlan.event,
          relayPlan.publishRelays,
          updateSendStatus,
        );
        let picture: string | null = null;
        if (signupAvatar) {
          let uploadSucceeded = false;
          avatarUploadsRef.current.add(signupAvatar.uri);
          try {
            const uploaded = await uploadFile(signupAvatar, {
              server: DEFAULT_UPLOAD_SERVER,
              serverType: 'blossom',
            });
            picture = uploaded.url;
            uploadSucceeded = true;
          } finally {
            avatarUploadsRef.current.delete(signupAvatar.uri);
            if (uploadSucceeded || !mountedRef.current) {
              deleteImagePickerAsset(signupAvatar.uri);
            }
          }
          setProfile({
            pubkey: keypair.pubkey,
            name: trimmedName,
            displayName: trimmedName,
            picture,
            updatedAt: now(),
          });
          if (mountedRef.current) {
            setAvatar(current =>
              current?.uri === signupAvatar.uri && picture
                ? {...current, uri: picture, previewUri: picture}
                : current,
            );
          }
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
        console.log('[signup-publish] prepared kind0 profile', {
          pubkey: keypair.pubkey,
          relays: publishRelays,
          hasPicture: !!metadata.picture,
        });
        publishWithStatus(
          `signup_profile_${Date.now()}`,
          event,
          publishRelays,
          updateSendStatus,
        );
        if (recommendedMint) {
          publishWithStatus(
            `signup_wallet_${Date.now()}`,
            {
              kind: 17375,
              content: JSON.stringify([
                ['privkey', keypair.privkey],
                ...selectedMints.map(mint => ['mint', mint]),
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
                ...selectedMints.map(mint => ['mint', mint]),
                ['pubkey', keypair.pubkey],
                ...publishRelays.map(relay => ['relay', relay]),
              ],
            },
            publishRelays,
            updateSendStatus,
          );
          publishWithStatus(
            `signup_mint_recommendation_${Date.now()}`,
            cashuMintRecommendationEvent(recommendedMint),
            publishRelays,
            updateSendStatus,
          );
        }
      } catch (error) {
        console.warn('[signup] profile publish failed', error);
      }
    })();
    return {profileContent};
  }, [
    avatar,
    bio,
    manager,
    name,
    prepareFreshAccount,
    recommendedMint,
    requireRecommendedMint,
    relays,
    setActiveMintUrl,
    setProfile,
    setRelayMarkers,
    setTrustedMints,
    setWalletMintUrls,
    setWalletReadRelays,
    updateSendStatus,
  ]);

  return {
    avatar,
    bio,
    canContinue: Boolean(
      name.trim() &&
        manager &&
        (!requireRecommendedMint || (mintDiscoveryReady && recommendedMint)),
    ),
    continueFromProfile,
    name,
    pickAvatar,
    setBio,
    setName,
    status,
  };
}

// Packs step state/logic. The follow-pack search subscription is only active
// while `active` is true (packs step shown AND hosting screen focused).
export function useSignupPacksController({
  active,
  onDone,
}: {
  active: boolean;
  onDone: () => void;
}) {
  const setFollows = useNostrStore(state => state.setFollows);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const applySelection = useFeedBuilderStore(state => state.applySelection);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const publicPacksRef = useRef<ParsedEvent[]>([]);
  const seenPublicPacksRef = useRef(new Map<string, SeenList>());
  const [search, setSearch] = useState('');
  const [selectedPacks, setSelectedPacks] = useState<FeedPackSelection[]>([]);
  const [revision, setRevision] = useState(0);
  const relays = useMemo(
    () => (writeRelays.length ? writeRelays : DEFAULT_FEED_RELAYS),
    [writeRelays],
  );

  useEffect(() => {
    if (!active) return undefined;
    const seenPublicPacks = seenPublicPacksRef.current;
    publicPacksRef.current = [];
    seenPublicPacks.clear();
    setRevision(current => current + 1);

    const unsubscribe = subscribeUntilEose(
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
    );

    return () => unsubscribe();
  }, [active, search]);

  const packItems = useMemo(() => {
    void revision;
    return publicPacksRef.current.filter(event => includePack(event, search));
  }, [revision, search]);
  const selectedPackIds = useMemo(
    () => new Set(selectedPacks.map(pack => pack.id)),
    [selectedPacks],
  );

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
    publishWithStatus(
      `signup_follows_${Date.now()}`,
      event,
      relays,
      updateSendStatus,
    );
    setFollows(people);
    applySelection([1], [followListPack]);
    onDone();
  }, [
    applySelection,
    onDone,
    relays,
    selectedPacks,
    setFollows,
    updateSendStatus,
  ]);

  return {
    finish,
    packItems,
    search,
    selectedPackIds,
    selectedPacksCount: selectedPacks.length,
    setSearch,
    togglePack,
  };
}

// Signup wizard: one screen hosting an embedded native stack (profile ->
// packs), like the original pre-migration modal. No NavigationContainer — the
// inner stack attaches to expo-router's root navigation context (same fork).
// Also rendered by the pre-expo-router App.tsx monolith, so keep props and
// shape compatible.
export function SignupModal({
  focused = true,
  manager,
  onBackToLogin,
  onDone,
}: SignupModalProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const topPadding = Platform.OS === 'android' ? insets.top : 0;
  const footerPaddingBottom = Math.max(24, insets.bottom + 12);
  const contextValue = useMemo(
    () => ({focused, footerPaddingBottom, manager, onBackToLogin, onDone}),
    [focused, footerPaddingBottom, manager, onBackToLogin, onDone],
  );

  return (
    <SignupWizardContext.Provider value={contextValue}>
      {/* Android's edge-to-edge modal needs an explicit status-bar inset.
          The native iOS modal sheet already starts inside its safe area, so
          applying the window inset there creates a second, oversized gap. */}
      <View className="h-full bg-base-100" style={{paddingTop: topPadding}}>
        <SignupStack.Navigator
          screenOptions={{
            animation: reducedMotion ? 'fade' : 'slide_from_right',
            gestureEnabled: true,
            headerShown: false,
          }}
        >
          <SignupStack.Screen
            component={SignupProfileScreen}
            name="SignupProfile"
          />
          <SignupStack.Screen
            component={SignupPacksScreen}
            name="SignupPacks"
          />
        </SignupStack.Navigator>
      </View>
    </SignupWizardContext.Provider>
  );
}

function SignupProfileScreen({
  navigation,
}: NativeStackScreenProps<SignupStackParamList, 'SignupProfile'>) {
  const {footerPaddingBottom, manager, onBackToLogin} = useSignupWizard();
  const profile = useSignupProfileController(manager);

  const onContinue = useCallback(() => {
    navigation.navigate('SignupPacks');
    // Defer the kind 0/17375/10019 publishes until the push transition has
    // finished so the network work doesn't jank the animation.
    InteractionManager.runAfterInteractions(() => {
      profile.continueFromProfile();
    });
  }, [navigation, profile]);

  return (
    <SignupProfileStep
      avatar={profile.avatar}
      bio={profile.bio}
      canContinue={profile.canContinue}
      footerPaddingBottom={footerPaddingBottom}
      name={profile.name}
      status={profile.status}
      onBack={onBackToLogin}
      onBioChange={profile.setBio}
      onContinue={onContinue}
      onNameChange={profile.setName}
      onPickAvatar={profile.pickAvatar}
    />
  );
}

function SignupPacksScreen({
  navigation,
}: NativeStackScreenProps<SignupStackParamList, 'SignupPacks'>) {
  const {focused, footerPaddingBottom, onDone} = useSignupWizard();
  // Focus of this screen within the embedded stack (fork context).
  const stepFocused = useIsFocused();
  const packs = useSignupPacksController({
    active: stepFocused && focused,
    onDone,
  });
  const onBack = useCallback(() => navigation.goBack(), [navigation]);
  // onDone router.back()s the hosting /Login route. Pop the embedded stack to
  // its root first, otherwise the back action is consumed by the inner
  // navigator (packs -> profile) and the wizard never closes.
  const onFinish = useCallback(() => {
    navigation.popToTop();
    packs.finish();
  }, [navigation, packs]);

  return (
    <SignupPacksStep
      footerPaddingBottom={footerPaddingBottom}
      items={packs.packItems}
      selectedPackIds={packs.selectedPackIds}
      selectedPacksCount={packs.selectedPacksCount}
      search={packs.search}
      onBack={onBack}
      onFinish={onFinish}
      onSearchChange={packs.setSearch}
      onTogglePack={packs.togglePack}
    />
  );
}

export function SignupProfileStep({
  avatar,
  bio,
  canContinue,
  continueTitle = 'Continue',
  footerPaddingBottom,
  name,
  progress = '1 of 2',
  showAccountSwitch = true,
  showWalletStatus = true,
  status,
  subtitle = 'This is how people will recognize you. You can change it anytime.',
  onBack,
  onBioChange,
  onContinue,
  onNameChange,
  onPickAvatar,
}: {
  avatar: SelectedAvatar | null;
  bio: string;
  canContinue: boolean;
  continueTitle?: string;
  footerPaddingBottom: number;
  name: string;
  progress?: string;
  showAccountSwitch?: boolean;
  showWalletStatus?: boolean;
  status: string | null;
  subtitle?: string;
  onBack: () => void;
  onBioChange: (value: string) => void;
  onContinue: () => void;
  onNameChange: (value: string) => void;
  onPickAvatar: () => void;
}) {
  const theme = useAppTheme();
  const preparingWallet = status === 'Preparing your wallet…';
  const walletReady = status === 'Your wallet is ready.';

  return (
    <View className="h-full bg-base-100">
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <View className="h-full px-4 pt-4">
          <SignupHeader progress={progress} onBack={onBack} />
          <View className="w-full" style={styles.profileForm}>
            <Text className="mt-3 text-3xl font-extrabold tracking-tight text-base-content">
              Create your profile
            </Text>
            <Text className="mt-2 text-sm leading-5 text-primary-content">
              {subtitle}
            </Text>
          </View>
          <View className="mt-5 items-center">
            <Pressable
              accessibilityLabel="Add profile photo"
              className="items-center justify-center"
              onPress={onPickAvatar}
            >
              <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-base-200 bg-base-300">
                {avatar ? (
                  <Image
                    source={{uri: avatar.previewUri}}
                    className="h-full w-full"
                    resizeMode="cover"
                  />
                ) : (
                  <UserRound
                    size={34}
                    color={theme.colors.primaryContent}
                    strokeWidth={1.8}
                  />
                )}
              </View>
              <View
                className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-2 border-base-100"
                style={{backgroundColor: theme.colors.primary}}
              >
                <Camera
                  size={15}
                  color={theme.button.primary.text}
                  strokeWidth={2.4}
                />
              </View>
            </Pressable>
            <Text className="mt-2 text-sm font-bold text-primary">
              Add photo
            </Text>
          </View>
          <View className="w-full" style={styles.profileForm}>
            <Text className="mb-2 mt-5 text-sm font-semibold text-base-content">
              Display name
            </Text>
            <TextInput
              className="rounded-lg border border-base-200 bg-base-300 px-3 py-3 text-base text-base-content"
              placeholder="What should people call you?"
              placeholderTextColor={theme.colors.primaryContent}
              returnKeyType="done"
              value={name}
              onChangeText={onNameChange}
              onSubmitEditing={Keyboard.dismiss}
            />
            <View className="mb-2 mt-4 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-base-content">
                About you
              </Text>
              <Text className="text-xs text-primary-content">Optional</Text>
            </View>
            <TextInput
              className="min-h-24 rounded-lg border border-base-200 bg-base-300 px-3 py-3 text-base text-base-content"
              multiline
              placeholder="A few words about you"
              placeholderTextColor={theme.colors.primaryContent}
              blurOnSubmit
              textAlignVertical="top"
              returnKeyType="done"
              value={bio}
              onChangeText={onBioChange}
              onSubmitEditing={Keyboard.dismiss}
            />
            {showWalletStatus && status ? (
              <View className="mt-3 flex-row items-center gap-2">
                {preparingWallet ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.primary}
                  />
                ) : walletReady ? (
                  <Check
                    size={16}
                    color={theme.colors.primary}
                    strokeWidth={2.5}
                  />
                ) : (
                  <CircleAlert
                    size={16}
                    color={theme.colors.error}
                    strokeWidth={2.2}
                  />
                )}
                <Text
                  className="flex-1 text-sm"
                  style={{
                    color:
                      walletReady || preparingWallet
                        ? theme.colors.primaryContent
                        : theme.colors.error,
                  }}
                >
                  {status}
                </Text>
              </View>
            ) : null}
          </View>
          <View
            className="mt-auto w-full"
            style={[styles.profileForm, {paddingBottom: footerPaddingBottom}]}
          >
            <AppButton
              disabled={!canContinue}
              title={continueTitle}
              onPress={onContinue}
            />
            {showAccountSwitch ? (
              <View className="mt-3 min-h-10 flex-row items-center justify-center gap-1">
                <Text className="text-sm text-primary-content">
                  Already have an account?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onBack}
                >
                  <Text className="text-sm font-extrabold text-primary">
                    Sign in
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </View>
  );
}

export function SignupPacksStep({
  footerPaddingBottom,
  items,
  search,
  selectedPackIds,
  selectedPacksCount,
  onBack,
  onFinish,
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
  onSearchChange: (value: string) => void;
  onTogglePack: (selection: FeedPackSelection) => void;
}) {
  return (
    <View className="h-full bg-base-100">
      <View className="px-4 pt-4">
        <SignupHeader progress="2 of 2" onBack={onBack} />
        <Text className="mt-3 text-3xl font-extrabold tracking-tight text-base-content">
          Choose what to see
        </Text>
        <Text className="mt-2 text-sm leading-5 text-primary-content">
          Select follow packs. We will create your follow list from the people
          inside them.
        </Text>
        <SearchBox value={search} onChangeText={onSearchChange} />
        <Text className="mb-2 text-xs font-semibold text-primary-content">
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
            selected={selectedPackIds.has(
              packSelectionFromEvent(item)?.id || '',
            )}
            onToggle={onTogglePack}
          />
        )}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={
          <Text className="px-4 py-10 text-center text-sm text-primary-content">
            Waiting for follow packs.
          </Text>
        }
      />
      <View
        className="border-t border-base-200 bg-base-300 px-4 pt-4"
        style={{paddingBottom: footerPaddingBottom}}
      >
        <AppButton title="Finish" onPress={onFinish} />
      </View>
    </View>
  );
}

function SignupHeader({
  progress,
  onBack,
}: {
  progress: string;
  onBack: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View className="h-12 flex-row items-center justify-between">
      <Pressable
        accessibilityLabel="Back"
        className="h-10 w-10 items-center justify-center rounded-full bg-base-300"
        hitSlop={12}
        onPress={onBack}
      >
        <ChevronLeft
          size={22}
          color={theme.colors.primaryContent}
          strokeWidth={2.2}
        />
      </Pressable>
      <Text className="text-sm font-semibold text-primary-content">
        {progress}
      </Text>
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
  const theme = useAppTheme();
  return (
    <View className="mb-3 mt-4 h-11 flex-row items-center gap-2 rounded-lg border border-base-200 bg-base-300 px-3">
      <Search size={17} color={theme.colors.primaryContent} strokeWidth={2.1} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-base text-base-content"
        placeholder="Search follow packs..."
        placeholderTextColor={theme.colors.primaryContent}
        value={value}
        onChangeText={onChangeText}
      />
      {value ? (
        <Pressable hitSlop={10} onPress={() => onChangeText('')}>
          <X size={17} color={theme.colors.primaryContent} strokeWidth={2.2} />
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
  const theme = useAppTheme();
  const selection = useMemo(() => packSelectionFromEvent(item), [item]);
  const handlePress = useCallback(() => {
    if (selection) onToggle(selection);
  }, [onToggle, selection]);
  if (!selection) return null;
  const hasImage = selection.image && !selection.image.startsWith('data:');

  return (
    <Pressable
      className="overflow-hidden rounded-lg border border-base-200 bg-base-300"
      onPress={handlePress}
    >
      <View className="h-28 bg-base-200">
        {hasImage ? (
          <Image
            className="h-full w-full"
            resizeMode="cover"
            source={{uri: selection.image ?? undefined}}
          />
        ) : (
          <View className="h-full w-full items-center justify-center bg-base-200">
            <UserPlus
              size={34}
              color={theme.colors.primaryContent}
              strokeWidth={1.8}
            />
          </View>
        )}
        {selected ? (
          <View className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full bg-primary">
            <Check size={18} color="#ffffff" strokeWidth={2.4} />
          </View>
        ) : null}
      </View>
      <View className="px-3 py-3">
        <Text
          className="text-base font-bold text-base-content"
          numberOfLines={1}
        >
          {selection.title}
        </Text>
        {selection.description ? (
          <Text
            className="mt-1 text-sm leading-5 text-primary-content"
            numberOfLines={2}
          >
            {selection.description}
          </Text>
        ) : null}
        <Text className="mt-2 text-xs font-semibold text-primary-content">
          {selection.people.length} people
        </Text>
      </View>
    </Pressable>
  );
});
