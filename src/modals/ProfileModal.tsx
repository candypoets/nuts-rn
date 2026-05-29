import React, {useCallback, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {NostrManagerLike} from '@candypoets/nipworker';
import {
  ChevronRight,
  KeyRound,
  LogOut,
  Palette,
  Plus,
  Radio,
  User,
  Wallet,
  X,
} from 'lucide-react-native';
import {nip19} from 'nostr-tools';

import {HeaderProfileButton} from '../components/HeaderProfileButton';
import {pushDistinct} from '../navigation/pushDistinct';
import type {RootStackParamList} from '../navigation/types';
import {useAuthStore, useWalletStore, type AuthState} from '../stores';

type ProfileModalTarget =
  | {type: 'login'}
  | {type: 'logout'}
  | {type: 'profileStub'; path: 'relays' | 'wallet' | 'theme' | 'nprofile'};

type ProfileModalProps = {
  auth: Pick<AuthState, 'pubkey' | 'hasSigner'>;
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
    if (decoded.type !== 'nsec') throw new Error('Expected an nsec private key.');
    return decoded.data;
  }

  const hex = value.replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Use an nsec key or a 64-character hex private key.');
  }
  return hexToBytes(hex);
}

export function ProfileModal({auth, onClose}: ProfileModalProps) {
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
      if (item.path === 'nprofile' && auth.pubkey) {
        pushDistinct(navigation, 'PublicProfile', {pubkey: auth.pubkey});
        return;
      }
      navigation.navigate('ProfileStub', {path: item.path});
    },
    [auth.pubkey, navigation],
  );

  return (
    <View style={styles.modalBody}>
      <View style={styles.profileSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Profile</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.accountButtons}>
            {auth.pubkey ? (
              <HeaderProfileButton
                pubkey={auth.pubkey}
                className="h-14 w-14 border-emerald-600 bg-white"
              />
            ) : null}
            <Pressable style={styles.addAccountButton} onPress={() => navigate({type: 'login'})}>
              <Plus size={22} color="#17212b" strokeWidth={2.4} />
            </Pressable>
          </View>

          <View style={styles.menuGroup}>
            {auth.pubkey ? (
              <ProfileMenuRow
                icon={<LogOut size={21} color="#17212b" strokeWidth={2.1} />}
                label="Log out"
                onPress={() => navigate({type: 'logout'})}
              />
            ) : (
              <ProfileMenuRow
                icon={<KeyRound size={21} color="#17212b" strokeWidth={2.1} />}
                label="Sign in"
                onPress={() => navigate({type: 'login'})}
              />
            )}
          </View>

          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.menuGroup}>
            <ProfileMenuRow
              icon={<User size={21} color="#17212b" strokeWidth={2.1} />}
              label="My Profile"
              onPress={() => navigate({type: 'profileStub', path: 'nprofile'})}
            />
            <ProfileMenuRow
              icon={<KeyRound size={21} color="#17212b" strokeWidth={2.1} />}
              label="Keys"
              onPress={() => navigate({type: 'login'})}
            />
            <ProfileMenuRow
              icon={<Radio size={21} color="#17212b" strokeWidth={2.1} />}
              label="Relays"
              detail="Your relay preferences"
              onPress={() => navigate({type: 'profileStub', path: 'relays'})}
            />
            <ProfileMenuRow
              icon={<Wallet size={21} color="#17212b" strokeWidth={2.1} />}
              label="Wallet"
              detail="Wallet preferences"
              onPress={() => navigate({type: 'profileStub', path: 'wallet'})}
            />
            <ProfileMenuRow
              icon={<Palette size={21} color="#17212b" strokeWidth={2.1} />}
              label="Theme"
              detail="Appearance settings"
              onPress={() => navigate({type: 'profileStub', path: 'theme'})}
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
  return (
    <Pressable style={[styles.menuRow, last ? styles.menuRowLast : null]} onPress={onPress}>
      <View style={styles.menuIcon}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      </View>
      <ChevronRight size={21} color="#8794a0" strokeWidth={2.1} />
    </Pressable>
  );
}

export function PrivateKeyLogin({
  manager,
  auth,
  onDone,
}: {
  manager: NostrManagerLike | null;
  auth: Pick<AuthState, 'pubkey'>;
  onDone: () => void;
}) {
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore(state => state.setAuth);

  const submit = () => {
    if (!manager) {
      setError('Nipworker native module is not ready.');
      return;
    }

    try {
      const secretKey = decodePrivateKey(privateKey);
      const privkey = bytesToHex(secretKey);
      const nsec = privateKey.trim().toLowerCase().startsWith('nsec')
        ? privateKey.trim()
        : nip19.nsecEncode(secretKey);
      manager.setSigner('privkey', privkey);
      setAuth({privkey, nsec});
      setPrivateKey('');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Authenticate</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={styles.stackBody}>
          Paste an nsec or 64-character hex private key. The native nipworker backend derives the public key and reports login through its auth event.
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="nsec1... or hex private key"
          placeholderTextColor="#8794a0"
          secureTextEntry
          style={styles.input}
          value={privateKey}
          onChangeText={text => {
            setPrivateKey(text);
            setError(null);
          }}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {auth.pubkey ? (
          <Text style={styles.successText}>Signed in as {auth.pubkey.slice(0, 16)}...</Text>
        ) : null}
        <Pressable style={[styles.action, manager ? styles.loginAction : styles.disabledAction]} onPress={submit}>
          <Text style={styles.actionText}>Sign in</Text>
        </Pressable>
        <Pressable style={styles.secondaryAction} onPress={onDone}>
          <Text style={styles.secondaryActionText}>Close</Text>
        </Pressable>
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
  const clearAuth = useAuthStore(state => state.clearAuth);
  const setWalletMnemonic = useWalletStore(state => state.setWalletMnemonic);
  const setWalletPassphrase = useWalletStore(state => state.setWalletPassphrase);

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
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Log out</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>Make sure you saved your private key before logging out.</Text>
        </View>
        <Pressable style={[styles.action, styles.loginAction]} onPress={logout}>
          <Text style={styles.actionText}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ProfileStubModal({
  path,
  auth,
  onClose,
}: {
  path: 'relays' | 'wallet' | 'theme' | 'nprofile';
  auth: Pick<AuthState, 'pubkey' | 'hasSigner'>;
  onClose: () => void;
}) {
  const titles = {
    relays: 'Relays',
    wallet: 'Wallet',
    theme: 'Theme',
    nprofile: 'My Profile',
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>{titles[path]}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color="#52616f" strokeWidth={2.2} />
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

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  profileSheet: {
    backgroundColor: '#f8fafc',
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: '#cbd5e1',
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
    color: '#17212b',
    fontSize: 22,
    fontWeight: '800',
  },
  stackBody: {
    color: '#52616f',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  accountButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  addAccountButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce3e8',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sectionTitle: {
    color: '#8794a0',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  menuGroup: {
    backgroundColor: '#ffffff',
    borderColor: '#dce3e8',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    overflow: 'hidden',
  },
  menuRow: {
    alignItems: 'center',
    borderBottomColor: '#edf2f7',
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
    color: '#17212b',
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    color: '#8794a0',
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderColor: '#dce3e8',
    borderRadius: 10,
    borderWidth: 1,
    color: '#17212b',
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  action: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 48,
  },
  loginAction: {
    backgroundColor: '#17212b',
  },
  disabledAction: {
    backgroundColor: '#cbd5e1',
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
  secondaryActionText: {
    color: '#52616f',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
    marginTop: 8,
  },
  successText: {
    color: '#1f7a5a',
    fontSize: 13,
    marginTop: 8,
  },
  warningBox: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  warningText: {
    color: '#9a3412',
    fontSize: 14,
    lineHeight: 20,
  },
});
