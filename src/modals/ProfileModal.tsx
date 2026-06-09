import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import { Image } from 'expo-image';
import { Mint } from '@cashu/cashu-ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import type {
  ConnectionStatus,
  NostrManagerLike,
  WorkerMessage,
} from '@candypoets/nipworker';
import { usePublish as publishToNostr } from '@candypoets/nipworker/hooks';
import { connectWithQRCode, isConnectionStatus } from '@candypoets/nipworker/utils';
import {
  Check,
  ClipboardCopy,
  ChevronRight,
  Binoculars,
  KeyRound,
  LogOut,
  Palette,
  RefreshCw,
  Plus,
  Radio,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react-native';
import { nip19, type EventTemplate } from 'nostr-tools';
import type {SearchBarCommands} from 'react-native-screens';

import { HeaderProfileButton } from '../components/HeaderProfileButton';
import { pushDistinct } from '../navigation/pushDistinct';
import type { RootStackParamList } from '../navigation/types';
import {
  BOOTSTRAP_RELAYS,
  useAuthStore,
  useNostrStore,
  useSendStatusStore,
  useWalletStore,
  type AuthState,
} from '../stores';
import {
  DEFAULT_MINTS,
  deriveSignupKeypair,
  generateSignupMnemonic,
} from '../nostr/keys';
import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import {
  appThemeIds,
  appThemes,
  defaultTheme,
  type AppTheme,
  type AppThemeId,
  type AppThemeColors,
  useAppTheme,
} from '../theme';
import { useUIStore } from '../stores/uiStore';

type ProfileModalTarget =
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'keys' }
  | { type: 'mints' }
  | { type: 'theme' }
  | { type: 'profileStub'; path: 'relays' | 'wallet' | 'nprofile' };

type ProfileModalProps = {
  auth: Pick<AuthState, 'pubkey' | 'hasSigner' | 'nsec'>;
  onClose: () => void;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodePrivateKey(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter a private key.');

  if (value.toLowerCase().startsWith('nsec')) {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec')
      throw new Error('Enter a valid private key.');
    return decoded.data;
  }

  const hex = value.replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Enter a valid private key or connection link.');
  }
  return hexToBytes(hex);
}

function decodePublicKey(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter a public key.');

  if (value.toLowerCase().startsWith('npub')) {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'npub')
      throw new Error('Enter a valid public key.');
    return decoded.data;
  }

  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Enter a valid public key.');
  }
  return value.toLowerCase();
}

export function ProfileModal({ auth }: ProfileModalProps) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;
  const loginMethod = auth.pubkey
    ? auth.nsec
      ? 'key'
      : auth.hasSigner
        ? 'remote'
        : 'readonly'
    : null;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const navigate = useCallback(
    (item: ProfileModalTarget) => {
      if (item.type === 'login') {
        navigation.navigate('Login');
        return;
      }
      if (item.type === 'logout') {
        navigation.navigate('Logout');
        return;
      }
      if (item.type === 'keys') {
        navigation.navigate('Keys');
        return;
      }
      if (item.type === 'theme') {
        navigation.navigate('Theme');
        return;
      }
      if (item.type === 'mints') {
        navigation.navigate('Mints');
        return;
      }
      if (item.path === 'relays') {
        navigation.navigate('RelayPreferences');
        return;
      }
      if (item.path === 'wallet') {
        navigation.navigate('Wallet');
        return;
      }
      if (item.path === 'nprofile' && auth.pubkey) {
        pushDistinct(navigation, 'PublicProfile', { pubkey: auth.pubkey });
        return;
      }
      navigation.navigate('ProfileStub', { path: item.path });
    },
    [auth.pubkey, navigation],
  );

  return (
    <View style={styles.modalBody}>
      <View style={styles.profileSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Profile</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.accountButtons}>
            {auth.pubkey ? (
              <View style={styles.profileAvatarWrap}>
                <HeaderProfileButton
                  pubkey={auth.pubkey}
                  className="h-14 w-14 border-primary bg-base-300"
                />
                {loginMethod ? (
                  <View style={styles.loginMethodBadge}>
                    {loginMethod === 'readonly' ? (
                      <Binoculars size={15} color="#ffffff" strokeWidth={2.4} />
                    ) : loginMethod === 'key' ? (
                      <KeyRound size={15} color="#ffffff" strokeWidth={2.4} />
                    ) : (
                      <Radio size={15} color="#ffffff" strokeWidth={2.4} />
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              style={styles.addAccountButton}
              onPress={() => navigate({ type: 'login' })}
            >
              <Plus size={22} color={iconColor} strokeWidth={2.4} />
            </Pressable>
          </View>

          <View style={styles.menuGroup}>
            {auth.pubkey ? (
              <ProfileMenuRow
                icon={<LogOut size={21} color={iconColor} strokeWidth={2.1} />}
                label="Log out"
                onPress={() => navigate({ type: 'logout' })}
              />
            ) : (
              <ProfileMenuRow
                icon={<KeyRound size={21} color={iconColor} strokeWidth={2.1} />}
                label="Sign in"
                onPress={() => navigate({ type: 'login' })}
              />
            )}
          </View>

          {auth.pubkey && auth.nsec ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                Save your key. It is the only way to recover this account on another device.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.menuGroup}>
            <ProfileMenuRow
              icon={<User size={21} color={iconColor} strokeWidth={2.1} />}
              label="My Profile"
              onPress={() =>
                navigate({ type: 'profileStub', path: 'nprofile' })
              }
            />
            <ProfileMenuRow
              icon={<KeyRound size={21} color={iconColor} strokeWidth={2.1} />}
              label="Keys"
              onPress={() => navigate({ type: 'keys' })}
            />
            <ProfileMenuRow
              icon={<Radio size={21} color={iconColor} strokeWidth={2.1} />}
              label="Relays"
              detail="Your relay preferences"
              onPress={() => navigate({ type: 'profileStub', path: 'relays' })}
            />
            <ProfileMenuRow
              icon={<Wallet size={21} color={iconColor} strokeWidth={2.1} />}
              label="Wallet"
              detail="Wallet preferences"
              onPress={() => navigate({ type: 'profileStub', path: 'wallet' })}
            />
            <ProfileMenuRow
              icon={<Plus size={21} color={iconColor} strokeWidth={2.1} />}
              label="Mints"
              detail="Select trusted Cashu mints"
              onPress={() => navigate({ type: 'mints' })}
            />
            <ProfileMenuRow
              icon={<Palette size={21} color={iconColor} strokeWidth={2.1} />}
              label="Theme"
              detail="Appearance settings"
              onPress={() => navigate({ type: 'theme' })}
              last
            />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function ProfileMenuRow({
  icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  return (
    <Pressable
      style={[styles.menuRow, last ? styles.menuRowLast : null]}
      onPress={onPress}
    >
      <View style={styles.menuIcon}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      </View>
      <ChevronRight size={21} color={mutedIconColor} strokeWidth={2.1} />
    </Pressable>
  );
}

export function PrivateKeyLogin({
  manager,
  auth,
  onDone,
  onSignup,
}: {
  manager: NostrManagerLike | null;
  auth: Pick<AuthState, 'pubkey'>;
  onDone: () => void;
  onSignup?: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const [privateKey, setPrivateKey] = useState('');
  const [qrText, setQrText] = useState('');
  const [qrLinkCopied, setQrLinkCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const initialPubkeyRef = useRef(auth.pubkey);

  useEffect(() => {
    if (!loginPending || !auth.pubkey) return;
    if (auth.pubkey === initialPubkeyRef.current) return;
    setLoginPending(false);
    onDone();
  }, [auth.pubkey, loginPending, onDone]);

  const submit = useCallback(() => {
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }

    try {
      const value = privateKey.trim();
      if (value.startsWith('bunker://')) {
        setLoginPending(true);
        manager.setNip46Bunker(value);
        setPrivateKey('');
        setQrText('');
        setError(null);
        return;
      }

      if (value.toLowerCase().startsWith('npub')) {
        const pubkey = decodePublicKey(value);
        setLoginPending(true);
        manager.setPubkey(pubkey);
        setPrivateKey('');
        setQrText('');
        setError(null);
        return;
      }

      const secretKey = decodePrivateKey(privateKey);
      const privkey = bytesToHex(secretKey);
      setLoginPending(true);
      manager.setSigner('privkey', privkey);
      setPrivateKey('');
      setError(null);
    } catch (nextError) {
      setLoginPending(false);
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [manager, privateKey]);

  const startQrConnect = useCallback(async () => {
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }

    try {
      setError(null);
      setLoginPending(true);
      const nextQrText = await connectWithQRCode('Nuts', DEFAULT_FEED_RELAYS);
      setPrivateKey('');
      setQrText(nextQrText);
      setQrLinkCopied(false);
    } catch (nextError) {
      setLoginPending(false);
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [manager]);

  const copyQrText = useCallback(async () => {
    if (!qrText) return;
    await Clipboard.setStringAsync(qrText);
    setQrLinkCopied(true);
    setTimeout(() => setQrLinkCopied(false), 1800);
  }, [qrText]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Authenticate</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.loginContent}
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={styles.stackBody}>
              Connect with your signing app, or paste a key.
            </Text>
            <Pressable
              style={[
                styles.nip46Button,
                manager ? null : styles.disabledNip46Button,
              ]}
              onPress={startQrConnect}
            >
              <View style={styles.nip46Icon}>
                <Radio size={22} color={theme.colors.primary} strokeWidth={2.2} />
              </View>
              <View style={styles.nip46Text}>
                <Text style={styles.nip46Title}>Connect with another app</Text>
                <Text style={styles.nip46Detail}>
                  Scan the code to approve access
                </Text>
              </View>
              <ChevronRight size={20} color={mutedIconColor} strokeWidth={2.1} />
            </Pressable>
            {qrText ? (
              <View style={styles.qrPanel}>
                <Pressable style={styles.qrCodeBox} onPress={copyQrText}>
                  <QRCode value={qrText} size={230} quietZone={8} ecl="L" />
                </Pressable>
                <Text style={styles.qrHelpText}>
                  Scan this code with your signing app.
                </Text>
                <Pressable style={styles.secondaryAction} onPress={copyQrText}>
                  <View style={styles.copyConnectionRow}>
                    {qrLinkCopied ? (
                      <Check size={16} color={theme.colors.primary} strokeWidth={2.5} />
                    ) : null}
                    <Text style={styles.secondaryActionText}>
                      {qrLinkCopied ? 'Copied' : 'Copy connection link'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="nsec, npub, or connection link"
              placeholderTextColor={theme.colors.primaryContent}
              secureTextEntry
              style={styles.input}
              value={privateKey}
              onChangeText={text => {
                setPrivateKey(text);
                setQrText('');
                setError(null);
              }}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {auth.pubkey ? (
              <Text style={styles.successText}>
                Signed in as {auth.pubkey.slice(0, 16)}...
              </Text>
            ) : null}
          </View>
          <View style={styles.loginActions}>
            <Pressable
              style={[
                styles.action,
                manager && privateKey.trim()
                  ? styles.loginAction
                  : styles.disabledAction,
              ]}
              onPress={submit}
            >
              <Text style={styles.actionText}>Sign in</Text>
            </Pressable>
            {onSignup ? (
              <Pressable style={styles.secondaryAction} onPress={onSignup}>
                <Text style={styles.secondaryActionText}>Create account</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export function LogoutModal({
  manager,
  onDone,
}: {
  manager: NostrManagerLike | null;
  onDone: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const clearAuth = useAuthStore(state => state.clearAuth);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletPassphrase = useWalletStore(
    state => state.setWalletPassphrase,
  );

  const logout = () => {
    clearAuth();
    setWalletMnemonic('');
    setWalletPassphrase('');
    manager?.removeAccount();
    manager?.logout();
    onDone();
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.logoutSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Log out</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            Make sure you saved your private key before logging out.
          </Text>
        </View>
        <Pressable style={[styles.action, styles.loginAction]} onPress={logout}>
          <Text style={styles.actionText}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function KeysModal({ onClose }: { onClose: () => void }) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const pubkey = useAuthStore(state => state.pubkey);
  const storedNpub = useAuthStore(state => state.npub);
  const nsec = useAuthStore(state => state.nsec);
  const privkey = useAuthStore(state => state.privkey);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState<string | null>(null);
  const npub = storedNpub ?? (pubkey ? nip19.npubEncode(pubkey) : '');
  const privateMask = '•'.repeat(privkey?.length || nsec?.length || 0);

  const copyToClipboard = useCallback(async (value: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopyError(null);
    setCopied(value);
    setTimeout(() => setCopied(current => (current === value ? '' : current)), 2000);
  }, []);

  const copyPrivateKey = useCallback(async () => {
    if (!nsec) return;

    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const hasFaceId = supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    );
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasFaceId || !isEnrolled) {
      setCopyError('Set up Face ID before copying your private key.');
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      fallbackLabel: '',
      promptMessage: 'Use Face ID to copy your private key',
    });

    if (!result.success) {
      setCopyError('Authentication canceled.');
      return;
    }

    await copyToClipboard(nsec);
  }, [copyToClipboard, nsec]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Keys</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.keySectionLabel}>Your public key</Text>
          <View style={styles.keyCard}>
            {pubkey ? (
              <HeaderProfileButton
                pubkey={pubkey}
                className="h-10 w-10 border-base-200 bg-base-300"
              />
            ) : null}
            <Text style={styles.keyValue}>{npub}</Text>
          </View>
          <Pressable
            style={[styles.action, styles.loginAction]}
            onPress={() => copyToClipboard(npub)}
          >
            {copied === npub ? (
              <Check size={18} color="#ffffff" strokeWidth={2.5} />
            ) : (
              <ClipboardCopy size={18} color="#ffffff" strokeWidth={2.2} />
            )}
            <Text style={styles.actionText}>
              {copied === npub ? 'Copied' : 'Copy public key'}
            </Text>
          </Pressable>
          <Text style={styles.keyHelpText}>
            Anyone on Nostr can find you via your public key. Feel free to share it with others.
          </Text>

          <Text style={[styles.keySectionLabel, styles.privateKeyLabel]}>
            Your private key
          </Text>
          <View style={styles.keyCard}>
            <View style={styles.keyIcon}>
              <KeyRound size={34} color={theme.colors.warning} strokeWidth={2.2} />
            </View>
            <Text style={styles.keyValue}>{privateMask}</Text>
          </View>
          <Pressable
            style={[styles.action, styles.warningAction]}
            onPress={copyPrivateKey}
          >
            {copied === nsec ? (
              <Check size={18} color="#ffffff" strokeWidth={2.5} />
            ) : (
              <ClipboardCopy size={18} color="#ffffff" strokeWidth={2.2} />
            )}
            <Text style={styles.actionText}>
              {copied === nsec ? 'Copied' : 'Copy private key'}
            </Text>
          </Pressable>
          {copyError ? <Text style={styles.errorText}>{copyError}</Text> : null}
          <Text style={styles.privateWarningText}>
            Warning: Keep your private key secret. Anyone with your private key can access your account.
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const CASHU_BASE_PATH = "m/44'/1237'/17375'/0";
const WALLET_PUBLISH_RELAYS = ['wss://relay.nuts.cash'];

type MintCatalogInfo = {
  title: string;
  url: string;
  description: string;
  iconUrl: string | null;
  state: string;
  rating: number;
  n_mints?: number;
  n_melts?: number;
  n_errors?: number;
};

function walletKeypairFromPrivateKey(secretKey: Uint8Array) {
  const privkey = bytesToHex(secretKey);
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  return {
    privkey,
    pubkey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(pubkey),
  };
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

function normalizeMintUrl(url: string) {
  let value = url.trim();
  if (!value) return '';
  if (value.startsWith('http://')) value = value.replace(/^http:/, 'https:');
  if (!value.startsWith('https://')) value = `https://${value}`;
  return value.replace(/\/$/, '');
}

function displayMintName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

async function fetchAvailableMints(): Promise<MintCatalogInfo[]> {
  try {
    const response = await fetch('https://api.audit.8333.space/mints/');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as Array<Record<string, unknown>>;
    return data
      .map(mintData => {
        let description = '';
        let title =
          typeof mintData.name === 'string' ? mintData.name : 'Unknown Mint';
        let iconUrl: string | null = null;
        if (typeof mintData.info === 'string') {
          try {
            const info = JSON.parse(mintData.info) as {
              description?: string;
              name?: string;
              icon_url?: string;
            };
            description = info.description || '';
            title = info.name || title;
            iconUrl = info.icon_url || null;
          } catch {
            // Some audit entries contain non-JSON info payloads.
          }
        }
        const nMints = Number(mintData.n_mints || 0);
        const nMelts = Number(mintData.n_melts || 0);
        const nErrors = Number(mintData.n_errors || 0);
        const operations = nMints + nMelts;
        const rating = operations > 0 ? nErrors / operations : nErrors ? 1 : 0;
        return {
          title,
          url: normalizeMintUrl(String(mintData.url || '')),
          description,
          iconUrl,
          state: String(mintData.state || 'UNKNOWN'),
          rating,
          n_mints: nMints,
          n_melts: nMelts,
          n_errors: nErrors,
        };
      })
      .filter(mint => Boolean(mint.url))
      .sort((left, right) => {
        if (left.state === 'OK' && right.state !== 'OK') return -1;
        if (left.state !== 'OK' && right.state === 'OK') return 1;
        return left.rating - right.rating;
      });
  } catch {
    return [];
  }
}

async function isMintUrlValid(url: string) {
  try {
    await new Mint(url).getInfo();
    return true;
  } catch {
    return false;
  }
}

function getRatingDisplay(rating: number) {
  if (rating === 0) return '★★★★★';
  if (rating < 0.01) return '★★★★☆';
  if (rating < 0.05) return '★★★☆☆';
  if (rating < 0.1) return '★★☆☆☆';
  return '★☆☆☆☆';
}

function getStatsText(mint: MintCatalogInfo) {
  const operations = (mint.n_mints || 0) + (mint.n_melts || 0);
  if (!operations) return 'No operations';
  return `${operations} ops, ${mint.n_errors || 0} errors`;
}

function mintStatusColor(state: string, colors: AppThemeColors) {
  if (state === 'OK') return colors.success;
  if (state === 'ERROR') return colors.error;
  return colors.warning;
}

export function WalletModal({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const authPubkey = useAuthStore(state => state.pubkey);
  const walletMnemonic = useWalletStore(state => state.walletMnemonic);
  const walletMnemonicIndex = useWalletStore(state => state.walletMnemonicIndex);
  const walletPrivateKey = useWalletStore(state => state.walletPrivateKey);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletMnemonicIndex = useWalletStore(state => state.setWalletMnemonicIndex);
  const setWalletKeys = useWalletStore(state => state.setWalletKeys);
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const setTrustedMints = useNostrStore(state => state.setTrustedMints);
  const setWalletReadRelays = useNostrStore(state => state.setWalletReadRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const hasStoredMnemonic = Boolean(walletMnemonic.trim());
  const hasWalletMetadata = Boolean(walletPrivateKey || walletMintUrls.length);
  const hasExistingWallet = Boolean(hasWalletMetadata || hasStoredMnemonic);
  const [mnemonic, setMnemonic] = useState(
    walletMnemonic || generateSignupMnemonic(),
  );
  const [index, setIndex] = useState(String(walletMnemonicIndex || 0));
  const [copied, setCopied] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const keypair = useMemo(() => {
    try {
      if (!hasStoredMnemonic && walletPrivateKey) {
        return walletKeypairFromPrivateKey(decodePrivateKey(walletPrivateKey));
      }
      return deriveSignupKeypair(
        mnemonic,
        '',
        Math.max(0, Number.parseInt(index, 10) || 0),
      );
    } catch {
      return null;
    }
  }, [hasStoredMnemonic, index, mnemonic, walletPrivateKey]);

  const copyToClipboard = useCallback(async (value: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopied(value);
    setTimeout(() => setCopied(current => (current === value ? '' : current)), 1800);
  }, []);

  const regenerateMnemonic = useCallback(() => {
    setMnemonic(generateSignupMnemonic());
    setIndex('0');
    setError(null);
    setSaved(false);
  }, []);

  const saveWallet = useCallback(() => {
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }
    if (!keypair) {
      setError('Enter a valid wallet key source.');
      return;
    }
    const selectedMints = DEFAULT_MINTS;
    const publishRelays = [
      ...new Set([...(writeRelays.length ? writeRelays : BOOTSTRAP_RELAYS), ...WALLET_PUBLISH_RELAYS]),
    ];
    if (!authPubkey) {
      manager.setSigner('privkey', keypair.privkey);
      useAuthStore.getState().setAuth({
        pubkey: keypair.pubkey,
        npub: keypair.npub,
        privkey: keypair.privkey,
        nsec: keypair.nsec,
        hasSigner: true,
      });
    }
    setWalletMnemonic(mnemonic.trim().replace(/\s+/g, ' '));
    setWalletMnemonicIndex(Math.max(0, Number.parseInt(index, 10) || 0));
    setWalletKeys({privateKey: keypair.privkey, publicKey: keypair.pubkey});
    setWalletMintUrls(selectedMints);
    setTrustedMints(selectedMints);
    setWalletReadRelays(publishRelays);
    publishWithStatus(
      `wallet_${Date.now()}`,
      {
        kind: 17375,
        content: JSON.stringify([
          ['privkey', keypair.privkey],
          ...selectedMints.map(mint => ['mint', mint]),
        ]),
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
      },
      publishRelays,
      updateSendStatus,
    );
    publishWithStatus(
      `wallet_trusted_mints_${Date.now()}`,
      {
        kind: 10019,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ...selectedMints.map(mint => ['mint', mint]),
          ['pubkey', keypair.pubkey],
          ...publishRelays.map(relay => ['relay', relay]),
        ],
      },
      publishRelays,
      updateSendStatus,
    );
    setSaved(true);
    setError(null);
  }, [
    authPubkey,
    index,
    keypair,
    manager,
    mnemonic,
    setWalletMnemonic,
    setWalletMnemonicIndex,
    setWalletKeys,
    setWalletMintUrls,
    setTrustedMints,
    setWalletReadRelays,
    updateSendStatus,
    writeRelays,
  ]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Cashu Wallet</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.keySectionLabel}>
            {hasExistingWallet ? 'Recovery phrase' : 'Create wallet'}
          </Text>
          {hasStoredMnemonic ? (
            <WalletKeyRow
              copied={copied === mnemonic}
              label="mnemonic"
              value={mnemonic}
              onCopy={() => copyToClipboard(mnemonic)}
            />
          ) : hasExistingWallet ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                Recovery phrase is not stored on this device.
              </Text>
            </View>
          ) : (
            <View style={styles.walletFields}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                placeholder="BIP-39 mnemonic"
                placeholderTextColor={theme.colors.primaryContent}
                style={[styles.input, styles.mnemonicInput]}
                value={mnemonic}
                onChangeText={text => {
                  setMnemonic(text);
                  setError(null);
                  setSaved(false);
                }}
              />
              <Pressable style={styles.secondaryInlineAction} onPress={regenerateMnemonic}>
                <RefreshCw size={17} color={theme.colors.primaryContent} strokeWidth={2.2} />
                <Text style={styles.secondaryInlineText}>Regenerate mnemonic</Text>
              </Pressable>
            </View>
          )}

          <Text style={[styles.keySectionLabel, styles.privateKeyLabel]}>
            Wallet keys
          </Text>
          <WalletKeyRow
            copied={copied === keypair?.npub}
            label="npub"
            value={keypair?.npub ?? ''}
            onCopy={() => copyToClipboard(keypair?.npub ?? '')}
          />
          <WalletKeyRow
            copied={copied === keypair?.nsec}
            label="nsec"
            privateValue
            value={keypair?.nsec ?? ''}
            onCopy={() => copyToClipboard(keypair?.nsec ?? '')}
          />
          {hasExistingWallet ? (
            <>
              <Text style={[styles.keySectionLabel, styles.privateKeyLabel]}>
                Advanced
              </Text>
              <WalletKeyRow
                copied={false}
                label="derivation path"
                value={`${CASHU_BASE_PATH}/${Math.max(0, Number.parseInt(index, 10) || 0)}`}
                onCopy={() => copyToClipboard(`${CASHU_BASE_PATH}/${Math.max(0, Number.parseInt(index, 10) || 0)}`)}
              />
            </>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {saved ? <Text style={styles.successText}>Wallet saved.</Text> : null}
          {!hasExistingWallet ? (
            <Pressable
              style={[
                styles.action,
                keypair && manager ? styles.loginAction : styles.disabledAction,
              ]}
              onPress={saveWallet}
            >
              <Text style={styles.actionText}>Create Wallet</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function WalletKeyRow({
  label,
  value,
  copied,
  privateValue = false,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  privateValue?: boolean;
  onCopy: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.walletKeyRow}>
      <View style={styles.walletKeyText}>
        <Text style={styles.meta}>{label}</Text>
        <Text style={styles.keyValue}>
          {privateValue && value ? '•'.repeat(Math.min(48, value.length)) : value}
        </Text>
      </View>
      <Pressable style={styles.copyButton} onPress={onCopy}>
        {copied ? (
          <Check size={18} color={theme.colors.primary} strokeWidth={2.5} />
        ) : (
          <ClipboardCopy size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
        )}
      </Pressable>
    </View>
  );
}

export function MintsModal({
  manager,
  onClose,
}: {
  manager: NostrManagerLike | null;
  onClose: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, 'Mints'>>();
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const walletPrivateKey = useWalletStore(state => state.walletPrivateKey);
  const setWalletMintUrls = useWalletStore(state => state.setWalletMintUrls);
  const setTrustedMints = useNostrStore(state => state.setTrustedMints);
  const setWalletReadRelays = useNostrStore(state => state.setWalletReadRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [availableMints, setAvailableMints] = useState<MintCatalogInfo[]>([]);
  const [selectedMints, setSelectedMints] = useState(() =>
    Array.from(new Set((walletMintUrls.length ? walletMintUrls : DEFAULT_MINTS).map(normalizeMintUrl))),
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchActive, setSearchActive] = useState(false);
  const searchBarRef = useRef<SearchBarCommands | null>(null);
  const isDarkHeader = useMemo(
    () => isDarkColor(theme.colors.base300),
    [theme.colors.base300],
  );
  const searchBarColor = isDarkHeader ? '#f1f5f9' : theme.colors.base100;
  const searchTextColor = '#111827';
  const searchPlaceholderColor = '#64748b';

  useEffect(() => {
    let alive = true;
    fetchAvailableMints().then(mints => {
      if (alive) setAvailableMints(mints);
    });
    return () => {
      alive = false;
    };
  }, []);

  const availableSearchMints = useMemo(() => {
    const term = search.trim().toLowerCase();
    const selected = new Set(selectedMints);
    return availableMints
      .filter(mint => !selected.has(mint.url))
      .filter(mint => {
        if (!term) return true;
        return (
          mint.title.toLowerCase().includes(term) ||
          mint.url.toLowerCase().includes(term) ||
          mint.description.toLowerCase().includes(term)
        );
      })
      .slice(0, 24);
  }, [availableMints, search, selectedMints]);

  const addMintUrl = useCallback(
    async (url: string) => {
      const normalized = normalizeMintUrl(url);
      if (!normalized) return;
      setLoading(true);
      setError(null);
      const valid = await isMintUrlValid(normalized);
      setLoading(false);
      if (!valid) {
        setError('Invalid mint URL.');
        return;
      }
      setSelectedMints(current =>
        Array.from(new Set([normalized, ...current.map(normalizeMintUrl)])),
      );
      setSearch('');
      setSearchActive(false);
      searchBarRef.current?.cancelSearch();
      setSaved(false);
    },
    [],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: '',
      headerLargeTitleEnabled: false,
      headerShadowVisible: false,
      headerLeft: () => (
        <Text
          style={{
            color: theme.colors.primaryContent,
            fontSize: 18,
            fontWeight: '700',
          }}
        >
          Mints
        </Text>
      ),
      headerBackground: () => (
        <View style={[StyleSheet.absoluteFill, {backgroundColor: theme.colors.base300}]}>
          <View
            style={{
              alignSelf: 'center',
              backgroundColor: theme.colors.primaryContent,
              borderRadius: 2,
              height: 4,
              marginTop: 8,
              opacity: 0.65,
              width: 42,
            }}
          />
        </View>
      ),
      headerStyle: {backgroundColor: theme.colors.base300},
      headerTintColor: theme.colors.primary,
      headerSearchBarOptions: {
        ref: searchBarRef,
        autoCapitalize: 'none',
        barTintColor: searchBarColor,
        headerIconColor: searchPlaceholderColor,
        hintTextColor: searchPlaceholderColor,
        textColor: searchTextColor,
        tintColor: theme.colors.primary,
        placeholder: 'Search mints to add...',
        placement: 'automatic',
        hideWhenScrolling: false,
        obscureBackground: false,
        onCancelButtonPress: () => {
          setSearch('');
          setSearchActive(false);
        },
        onChangeText: event => {
          setSearch(event.nativeEvent.text);
          setError(null);
        },
        onClose: () => {
          setSearch('');
          setSearchActive(false);
        },
        onFocus: () => setSearchActive(true),
        onOpen: () => setSearchActive(true),
        onSearchButtonPress: event => {
          const text = event.nativeEvent.text;
          if (availableSearchMints[0]) addMintUrl(availableSearchMints[0].url);
          else addMintUrl(text);
        },
      },
    });
  }, [
    addMintUrl,
    availableSearchMints,
    isDarkHeader,
    navigation,
    searchBarColor,
    searchPlaceholderColor,
    searchTextColor,
    theme,
  ]);

  const removeMint = useCallback((mint: string) => {
    setSelectedMints(current => current.filter(value => value !== mint));
    setSaved(false);
  }, []);

  const saveMints = useCallback(() => {
    if (loading || !selectedMints.length) return;
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }
    if (!walletPrivateKey) {
      setError('Create or restore the wallet before saving mints.');
      return;
    }
    const normalized = Array.from(new Set(selectedMints.map(normalizeMintUrl))).filter(Boolean);
    let keypair: ReturnType<typeof walletKeypairFromPrivateKey>;
    try {
      keypair = walletKeypairFromPrivateKey(decodePrivateKey(walletPrivateKey));
    } catch {
      setError('Stored wallet private key is invalid.');
      return;
    }
    const publishRelays = [
      ...new Set([...(writeRelays.length ? writeRelays : BOOTSTRAP_RELAYS), ...WALLET_PUBLISH_RELAYS]),
    ];
    setWalletMintUrls(normalized);
    setTrustedMints(normalized);
    setWalletReadRelays(publishRelays);
    publishWithStatus(
      `wallet_mints_${Date.now()}`,
      {
        kind: 17375,
        content: JSON.stringify([
          ['privkey', keypair.privkey],
          ...normalized.map(mint => ['mint', mint]),
        ]),
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
      },
      publishRelays,
      updateSendStatus,
    );
    publishWithStatus(
      `wallet_trusted_mints_${Date.now()}`,
      {
        kind: 10019,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ...normalized.map(mint => ['mint', mint]),
          ['pubkey', keypair.pubkey],
          ...publishRelays.map(relay => ['relay', relay]),
        ],
      },
      publishRelays,
      updateSendStatus,
    );
    setSaved(true);
    setError(null);
  }, [
    loading,
    manager,
    selectedMints,
    setTrustedMints,
    setWalletMintUrls,
    setWalletReadRelays,
    updateSendStatus,
    walletPrivateKey,
    writeRelays,
  ]);

  return (
    <View style={styles.modalBody}>
      <View style={styles.mintsNativeSheet}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {searchActive ? (
            <View style={styles.mintResults}>
              {availableSearchMints.length ? (
                availableSearchMints.map(mint => (
                  <MintCatalogRow
                    key={mint.url}
                    mint={mint}
                    onPress={() => addMintUrl(mint.url)}
                  />
                ))
              ) : search.trim() ? (
                <Pressable
                  style={styles.mintResultRow}
                  onPress={() => addMintUrl(search)}
                >
                  <View style={styles.mintAvatar}>
                    <Plus size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
                  </View>
                  <View style={styles.mintRowText}>
                    <Text style={styles.menuLabel}>Add custom mint</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {normalizeMintUrl(search)}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <Text style={styles.emptySearchText}>
                  {availableMints.length ? 'No more mints available.' : 'Loading mints...'}
                </Text>
              )}
            </View>
          ) : (
            <>
              <Text style={[styles.keySectionLabel, styles.privateKeyLabel]}>
                Your Mints ({selectedMints.length})
              </Text>
              <View style={styles.selectedMintList}>
                {selectedMints.length ? (
                  selectedMints.map(mint => (
                    <SelectedMintRow
                      key={mint}
                      mintUrl={mint}
                      mint={availableMints.find(info => info.url === mint)}
                      onRemove={() => removeMint(mint)}
                    />
                  ))
                ) : (
                  <Text style={styles.stackBody}>No mints selected.</Text>
                )}
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {saved ? <Text style={styles.successText}>Mints saved.</Text> : null}
              <Pressable
                style={[
                  styles.action,
                  selectedMints.length && !loading ? styles.loginAction : styles.disabledAction,
                ]}
                onPress={saveMints}
              >
                <Text style={styles.actionText}>{loading ? 'Checking mint...' : 'Save Mints'}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function MintCatalogRow({
  mint,
  onPress,
}: {
  mint: MintCatalogInfo;
  onPress: () => void;
}) {
  const styles = useProfileModalStyles();
  return (
    <Pressable style={styles.mintResultRow} onPress={onPress}>
      <MintAvatar mint={mint} />
      <View style={styles.mintRowText}>
        <Text style={styles.menuLabel} numberOfLines={1}>{mint.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{mint.url}</Text>
        <Text style={styles.mintStats} numberOfLines={1}>
          {getStatsText(mint)}  {getRatingDisplay(mint.rating)}
        </Text>
      </View>
      <MintStatusDot state={mint.state} />
    </Pressable>
  );
}

function SelectedMintRow({
  mintUrl,
  mint,
  onRemove,
}: {
  mintUrl: string;
  mint?: MintCatalogInfo;
  onRemove: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  return (
    <View style={styles.selectedMintRow}>
      <MintAvatar mint={mint} mintUrl={mintUrl} />
      <View style={styles.mintRowText}>
        <Text style={styles.menuLabel} numberOfLines={1}>
          {mint?.title || displayMintName(mintUrl)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>{mintUrl}</Text>
        {mint ? (
          <Text style={styles.mintStats} numberOfLines={1}>
            {getStatsText(mint)}
          </Text>
        ) : null}
      </View>
      {mint ? <MintStatusDot state={mint.state} /> : null}
      <Pressable style={styles.copyButton} onPress={onRemove}>
        <Trash2 size={19} color={theme.colors.primaryContent} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function MintAvatar({
  mint,
  mintUrl,
}: {
  mint?: MintCatalogInfo;
  mintUrl?: string;
}) {
  const styles = useProfileModalStyles();
  const label = mint?.title || (mintUrl ? displayMintName(mintUrl) : 'Mint');
  return (
    <View style={styles.mintAvatar}>
      {mint?.iconUrl ? (
        <Image source={{uri: mint.iconUrl}} style={styles.mintAvatarImage} contentFit="cover" />
      ) : (
        <Text style={styles.mintAvatarText}>{label.slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

function MintStatusDot({state}: {state: string}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.mintStatusDot,
        {backgroundColor: mintStatusColor(state, theme.colors)},
      ]}
    />
  );
}

export function ProfileStubModal({
  path,
  auth,
  onClose,
}: {
  path: 'relays' | 'wallet' | 'nprofile';
  auth: Pick<AuthState, 'pubkey' | 'hasSigner'>;
  onClose: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const titles = {
    relays: 'Relays',
    wallet: 'Wallet',
    nprofile: 'My Profile',
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>{titles[path]}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={styles.stackBody}>
          {auth.pubkey
            ? `${titles[path]} settings for ${auth.pubkey.slice(0, 16)}...`
            : 'Sign in to manage this section.'}
        </Text>
      </View>
    </View>
  );
}

export function ThemeModal() {
  const styles = useProfileModalStyles();
  const selectedThemeId = useUIStore(state => state.themeId);
  const setThemeId = useUIStore(state => state.setThemeId);
  const activeThemeId =
    selectedThemeId && selectedThemeId in appThemes
      ? (selectedThemeId as AppThemeId)
      : defaultTheme.id;
  const selectTheme = useCallback(
    (themeId: AppThemeId) => {
      setThemeId(themeId);
    },
    [setThemeId],
  );

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Theme</Text>
        </View>
        <ThemeSettings
          activeThemeId={activeThemeId}
          onSelectTheme={selectTheme}
        />
      </View>
    </View>
  );
}

function ThemeSettings({
  activeThemeId,
  onSelectTheme,
}: {
  activeThemeId: AppThemeId;
  onSelectTheme: (themeId: AppThemeId) => void;
}) {
  const styles = useProfileModalStyles();
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stackBody}>Choose your preferred theme.</Text>
      <View style={styles.themeList}>
        {appThemeIds.map(themeId => {
          const theme = appThemes[themeId];
          return (
            <ThemeRow
              key={theme.id}
              active={theme.id === activeThemeId}
              theme={theme}
              onPress={() => onSelectTheme(theme.id)}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

function ThemeRow({
  active,
  theme,
  onPress,
}: {
  active: boolean;
  theme: AppTheme;
  onPress: () => void;
}) {
  const styles = useProfileModalStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.themeRow, active && styles.themeRowActive]}
      onPress={onPress}
    >
      <View style={styles.themeSwatches}>
        <View
          style={[
            styles.themeSwatch,
            { backgroundColor: theme.colors.primary },
          ]}
        />
        <View
          style={[
            styles.themeSwatch,
            { backgroundColor: theme.colors.base100 },
          ]}
        />
        <View
          style={[
            styles.themeSwatch,
            { backgroundColor: theme.colors.accent },
          ]}
        />
      </View>
      <View style={styles.themeText}>
        <Text style={styles.menuLabel}>{theme.name}</Text>
        <Text style={styles.meta}>{theme.id}</Text>
      </View>
      {active ? (
        <View style={styles.themeCheck}>
          <Check size={17} color="#ffffff" strokeWidth={2.5} />
        </View>
      ) : null}
    </Pressable>
  );
}

function useProfileModalStyles() {
  const theme = useAppTheme();
  return useMemo(() => createProfileModalStyles(theme.colors), [theme]);
}

function createProfileModalStyles(colors: AppThemeColors) {
  const contentColor = readableContentColor(colors.base100);
  return StyleSheet.create({
  modalBody: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  profileSheet: {
    backgroundColor: colors.base100,
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  modalSheet: {
    backgroundColor: colors.base300,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  logoutSheet: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  fullModalSheet: {
    backgroundColor: colors.base300,
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  mintsNativeSheet: {
    backgroundColor: colors.base300,
    flex: 1,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: colors.primaryContent,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 42,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  stackTitle: {
    color: contentColor,
    fontSize: 22,
    fontWeight: '800',
  },
  modalTitleSlot: {
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stackBody: {
    color: colors.primaryContent,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  loginContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  loginActions: {
    paddingBottom: 8,
  },
  nip46Button: {
    alignItems: 'center',
    backgroundColor: colors.base300,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 14,
    minHeight: 64,
    paddingHorizontal: 14,
  },
  disabledNip46Button: {
    opacity: 0.55,
  },
  nip46Icon: {
    alignItems: 'center',
    backgroundColor: colors.base100,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginRight: 12,
    width: 44,
  },
  nip46Text: {
    flex: 1,
  },
  nip46Title: {
    color: contentColor,
    fontSize: 16,
    fontWeight: '800',
  },
  nip46Detail: {
    color: colors.primaryContent,
    fontSize: 13,
    marginTop: 2,
  },
  qrPanel: {
    alignItems: 'center',
    backgroundColor: colors.base300,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
    padding: 16,
  },
  qrCodeBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
  },
  qrHelpText: {
    color: colors.primaryContent,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    textAlign: 'center',
  },
  accountButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
    overflow: 'visible',
  },
  profileAvatarWrap: {
    height: 56,
    overflow: 'visible',
    width: 56,
  },
  loginMethodBadge: {
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 11,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    top: -6,
    width: 20,
  },
  addAccountButton: {
    alignItems: 'center',
    backgroundColor: colors.base300,
    borderColor: colors.base200,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sectionTitle: {
    color: colors.primaryContent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  menuGroup: {
    backgroundColor: colors.base300,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    overflow: 'hidden',
  },
  menuRow: {
    alignItems: 'center',
    borderBottomColor: colors.base200,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 14,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuIcon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginRight: 12,
    width: 28,
  },
  menuText: {
    flex: 1,
  },
  menuLabel: {
    color: contentColor,
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    color: colors.primaryContent,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 10,
    borderWidth: 1,
    color: contentColor,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  mnemonicInput: {
    minHeight: 96,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  segmentedControl: {
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 14,
    overflow: 'hidden',
  },
  segmentButton: {
    alignItems: 'center',
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    color: colors.primaryContent,
    fontSize: 13,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  walletFields: {
    gap: 10,
  },
  derivationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  derivationPath: {
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.primaryContent,
    flex: 1,
    fontSize: 13,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  indexInput: {
    width: 86,
  },
  secondaryInlineAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 36,
  },
  secondaryInlineText: {
    color: colors.primaryContent,
    fontSize: 14,
    fontWeight: '700',
  },
  walletKeyRow: {
    alignItems: 'center',
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 10,
    minHeight: 68,
    paddingHorizontal: 12,
  },
  walletKeyText: {
    flex: 1,
    paddingRight: 10,
  },
  mintResults: {
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    overflow: 'hidden',
  },
  emptySearchText: {
    color: colors.primaryContent,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  mintResultRow: {
    alignItems: 'center',
    borderBottomColor: colors.base200,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectedMintList: {
    gap: 10,
  },
  selectedMintRow: {
    alignItems: 'center',
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mintAvatar: {
    alignItems: 'center',
    backgroundColor: colors.base200,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    width: 36,
  },
  mintAvatarImage: {
    height: 36,
    width: 36,
  },
  mintAvatarText: {
    color: colors.primaryContent,
    fontSize: 14,
    fontWeight: '900',
  },
  mintRowText: {
    flex: 1,
    minWidth: 0,
  },
  mintStats: {
    color: colors.primaryContent,
    fontSize: 12,
    marginTop: 3,
  },
  mintStatusDot: {
    borderRadius: 4,
    height: 8,
    marginHorizontal: 10,
    width: 8,
  },
  copyButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  action: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 48,
  },
  loginAction: {
    backgroundColor: colors.primary,
  },
  disabledAction: {
    backgroundColor: colors.base200,
  },
  warningAction: {
    backgroundColor: colors.warning,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 42,
  },
  copyConnectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.primaryContent,
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: 8,
  },
  successText: {
    color: colors.primary,
    fontSize: 13,
    marginTop: 8,
  },
  warningBox: {
    backgroundColor: colors.base300,
    borderColor: colors.warning,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  warningText: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
  keySectionLabel: {
    color: contentColor,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  privateKeyLabel: {
    marginTop: 30,
  },
  keyCard: {
    alignItems: 'center',
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    padding: 14,
  },
  keyIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  keyValue: {
    color: contentColor,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  keyHelpText: {
    color: colors.primaryContent,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  privateWarningText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  themeList: {
    gap: 10,
    paddingBottom: 16,
  },
  themeRow: {
    alignItems: 'center',
    backgroundColor: colors.base100,
    borderColor: colors.base200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: 12,
  },
  themeRowActive: {
    borderColor: colors.primary,
  },
  themeSwatches: {
    flexDirection: 'row',
    marginRight: 12,
  },
  themeSwatch: {
    borderColor: colors.base200,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 28,
    marginLeft: -6,
    width: 28,
  },
  themeText: {
    flex: 1,
  },
  themeCheck: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  });
}

function readableContentColor(hex: string) {
  return isDarkColor(hex) ? '#ffffff' : '#1a1a1a';
}

function isDarkColor(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return true;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140;
}
