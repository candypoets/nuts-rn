import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NostrManagerLike } from '@candypoets/nipworker';
import {
  Check,
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
import { nip19 } from 'nostr-tools';

import { HeaderProfileButton } from '../components/HeaderProfileButton';
import { pushDistinct } from '../navigation/pushDistinct';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore, useWalletStore, type AuthState } from '../stores';
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
  | { type: 'profileStub'; path: 'relays' | 'wallet' | 'theme' | 'nprofile' };

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
      throw new Error('Expected an nsec private key.');
    return decoded.data;
  }

  const hex = value.replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Use an nsec key or a 64-character hex private key.');
  }
  return hexToBytes(hex);
}

export function ProfileModal({ auth, onClose }: ProfileModalProps) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const iconColor = theme.colors.primaryContent;
  const mutedIconColor = theme.colors.primaryContent;
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
          <Pressable hitSlop={12} onPress={onClose}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.accountButtons}>
            {auth.pubkey ? (
              <HeaderProfileButton
                pubkey={auth.pubkey}
                className="h-14 w-14 border-primary bg-base-300"
              />
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
              onPress={() => navigate({ type: 'login' })}
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
              icon={<Palette size={21} color={iconColor} strokeWidth={2.1} />}
              label="Theme"
              detail="Appearance settings"
              onPress={() => navigate({ type: 'profileStub', path: 'theme' })}
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
      setAuth({ privkey, nsec });
      setPrivateKey('');
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  };

  return (
    <View style={styles.modalBody}>
      <View style={styles.fullModalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.stackTitle}>Authenticate</Text>
          <Pressable hitSlop={12} onPress={onDone}>
            <X size={22} color={mutedIconColor} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.loginContent}>
          <View>
            <Text style={styles.stackBody}>
              Paste an nsec or 64-character hex private key. The native
              nipworker backend derives the public key and reports login through
              its auth event.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="nsec1... or hex private key"
              placeholderTextColor={theme.colors.primaryContent}
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
              <Text style={styles.successText}>
                Signed in as {auth.pubkey.slice(0, 16)}...
              </Text>
            ) : null}
          </View>
          <View style={styles.loginActions}>
            <Pressable
              style={[
                styles.action,
                manager ? styles.loginAction : styles.disabledAction,
              ]}
              onPress={submit}
            >
              <Text style={styles.actionText}>Sign in</Text>
            </Pressable>
            <Pressable style={styles.secondaryAction} onPress={onDone}>
              <Text style={styles.secondaryActionText}>Close</Text>
            </Pressable>
            {onSignup ? (
              <Pressable style={styles.secondaryAction} onPress={onSignup}>
                <Text style={styles.secondaryActionText}>Create account</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
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
      <View style={styles.modalSheet}>
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

export function ProfileStubModal({
  path,
  auth,
  onClose,
}: {
  path: 'relays' | 'wallet' | 'theme' | 'nprofile';
  auth: Pick<AuthState, 'pubkey' | 'hasSigner'>;
  onClose: () => void;
}) {
  const styles = useProfileModalStyles();
  const theme = useAppTheme();
  const mutedIconColor = theme.colors.primaryContent;
  const selectedThemeId = useUIStore(state => state.themeId);
  const setThemeId = useUIStore(state => state.setThemeId);
  const activeThemeId = selectedThemeId && selectedThemeId in appThemes
    ? (selectedThemeId as AppThemeId)
    : defaultTheme.id;
  const titles = {
    relays: 'Relays',
    wallet: 'Wallet',
    theme: 'Theme',
    nprofile: 'My Profile',
  };
  const selectTheme = useCallback(
    (themeId: AppThemeId) => {
      setThemeId(themeId);
    },
    [setThemeId],
  );

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
        {path === 'theme' ? (
          <ThemeSettings
            activeThemeId={activeThemeId}
            onSelectTheme={selectTheme}
          />
        ) : (
          <Text style={styles.stackBody}>
            {auth.pubkey
              ? `${titles[path]} settings for ${auth.pubkey.slice(0, 16)}...`
              : 'Sign in to manage this section.'}
          </Text>
        )}
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

const styles = createProfileModalStyles(defaultTheme.colors);

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
  fullModalSheet: {
    backgroundColor: colors.base300,
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
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
  accountButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
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
  action: {
    alignItems: 'center',
    borderRadius: 10,
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
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return '#ffffff';
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140
    ? '#ffffff'
    : '#1a1a1a';
}
