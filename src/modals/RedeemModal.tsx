import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NostrManagerLike} from '@candypoets/nipworker';
import { BadgeCheck, ShieldCheck, Ticket, X } from 'lucide-react-native';

import {
  checkExistingMembership,
  communityNameFromRelay,
  fetchCommunityInfo,
  normalizeRelayBaseUrl,
  redeemInvite,
  relayUrlFromBaseUrl,
  type RedeemStage,
} from '../nostr/invites';
import { useAuthStore } from '../stores';
import { type AppTheme, useAppTheme } from '../theme';
import {getSharedNostrManager} from '../nostr/manager';
import {PrivateKeyLogin} from './ProfileModal';
import {SignupProfileStep, useSignupProfileController} from './SignupModal';

type RedeemModalProps = {
  relay: string;
  token: string;
  onDone: () => void;
};

type RedeemState = 'idle' | 'redeeming' | 'error';
type RedeemView = 'invite' | 'signup' | 'login';

const STAGE_LABELS: Record<RedeemStage, string> = {
  request: 'Claiming your invite…',
  indexes: 'Saving your membership…',
  profile: 'Copying your profile…',
};

export function RedeemModal({ relay, token, onDone }: RedeemModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createRedeemStyles(theme), [theme]);
  const router = useRouter();
  const manager = getSharedNostrManager();

  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const auth = useMemo(() => ({pubkey}), [pubkey]);

  const relayBaseUrl = useMemo(() => normalizeRelayBaseUrl(relay || ''), [relay]);
  const communityRelayUrl = useMemo(
    () => relayUrlFromBaseUrl(relayBaseUrl),
    [relayBaseUrl],
  );
  const linkValid = Boolean(relayBaseUrl && token);

  const [communityName, setCommunityName] = useState('');
  const [communityImage, setCommunityImage] = useState('');
  const [view, setView] = useState<RedeemView>('invite');
  const [state, setState] = useState<RedeemState>('idle');
  const [stage, setStage] = useState<RedeemStage>('request');
  const [error, setError] = useState('');
  const [checkingMembership, setCheckingMembership] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const joinAfterAuthRef = useRef(false);
  const signupProfileContentRef = useRef<string | undefined>(undefined);
  const navigatingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!relayBaseUrl) return;
    let cancelled = false;
    fetchCommunityInfo(relayBaseUrl).then(info => {
      if (cancelled) return;
      if (info.name) setCommunityName(info.name);
      if (info.image) setCommunityImage(info.image);
    });
    return () => {
      cancelled = true;
    };
  }, [relayBaseUrl]);

  useEffect(() => {
    if (!pubkey || !communityRelayUrl || !linkValid) {
      setMembershipChecked(false);
      return;
    }
    let cancelled = false;
    setAlreadyMember(false);
    setMembershipChecked(false);
    setCheckingMembership(true);
    checkExistingMembership(pubkey, communityRelayUrl)
      .then(member => {
        if (cancelled) return;
        setAlreadyMember(member);
        setCheckingMembership(false);
        setMembershipChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCheckingMembership(false);
          setMembershipChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey, communityRelayUrl, linkValid]);

  const displayName = communityName || communityNameFromRelay(relayBaseUrl);

  const openCommunity = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.replace({
      pathname: '/Community',
      params: {
        relay: communityRelayUrl,
        name: displayName,
        icon: communityImage || undefined,
        relationship: 'belong',
      },
    });
  }, [router, communityRelayUrl, displayName, communityImage]);

  const claim = useCallback(async () => {
    if (!pubkey || !linkValid || state === 'redeeming') return;
    setState('redeeming');
    setError('');
    try {
      // A previous failed attempt may already have granted membership — the
      // award is granted before the later stages (indexes, profile replica)
      // run — so a retry must not burn another invite redemption.
      if (state === 'error') {
        const member = await checkExistingMembership(pubkey, communityRelayUrl);
        if (!mountedRef.current) return;
        if (member) {
          setAlreadyMember(true);
          openCommunity();
          return;
        }
      }
      await redeemInvite({
        token,
        relayBaseUrl,
        pubkey,
        profileContent: signupProfileContentRef.current,
        onStage: nextStage => {
          if (mountedRef.current) setStage(nextStage);
        },
      });
      if (!mountedRef.current) return;
      setAlreadyMember(true);
      openCommunity();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not redeem invite.');
      setState('error');
    }
  }, [pubkey, linkValid, state, token, relayBaseUrl, communityRelayUrl, openCommunity]);

  const loggedIn = Boolean(pubkey && hasSigner);
  const canClaim =
    linkValid && loggedIn && membershipChecked && !alreadyMember && !checkingMembership;

  useEffect(() => {
    if (!linkValid || !loggedIn || !membershipChecked || checkingMembership) return;
    if (alreadyMember) {
      joinAfterAuthRef.current = false;
      openCommunity();
      return;
    }
    if (!joinAfterAuthRef.current || state === 'redeeming') return;
    joinAfterAuthRef.current = false;
    claim().catch(() => {});
  }, [
    alreadyMember,
    checkingMembership,
    claim,
    linkValid,
    loggedIn,
    membershipChecked,
    openCommunity,
    state,
  ]);

  const finishAuthentication = useCallback(() => {
    joinAfterAuthRef.current = true;
    setView('invite');
  }, []);

  const finishSignup = useCallback((profileContent: string) => {
    signupProfileContentRef.current = profileContent;
    joinAfterAuthRef.current = true;
    setView('invite');
  }, []);

  if (view === 'signup') {
    return (
      <InviteSignupView
        communityName={displayName}
        manager={manager}
        onBack={() => setView('invite')}
        onDone={finishSignup}
      />
    );
  }

  if (view === 'login') {
    return (
      <PrivateKeyLogin
        auth={auth}
        manager={manager}
        onDone={finishAuthentication}
        onSignup={() => setView('signup')}
      />
    );
  }

  return (
    <InviteLandingView
      canClaim={canClaim}
      checkingMembership={checkingMembership}
      communityImage={communityImage}
      displayName={displayName}
      error={error}
      linkValid={linkValid}
      loggedIn={loggedIn}
      membershipChecked={membershipChecked}
      stage={stage}
      state={state}
      styles={styles}
      theme={theme}
      onClaim={claim}
      onClose={onDone}
      onCreateProfile={() => setView('signup')}
      onLogin={() => setView('login')}
    />
  );
}

function InviteLandingView({
  canClaim,
  checkingMembership,
  communityImage,
  displayName,
  error,
  linkValid,
  loggedIn,
  membershipChecked,
  stage,
  state,
  styles,
  theme,
  onClaim,
  onClose,
  onCreateProfile,
  onLogin,
}: {
  canClaim: boolean;
  checkingMembership: boolean;
  communityImage: string;
  displayName: string;
  error: string;
  linkValid: boolean;
  loggedIn: boolean;
  membershipChecked: boolean;
  stage: RedeemStage;
  state: RedeemState;
  styles: ReturnType<typeof createRedeemStyles>;
  theme: AppTheme;
  onClaim: () => Promise<void>;
  onClose: () => void;
  onCreateProfile: () => void;
  onLogin: () => void;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroOrbPrimary} />
          <View style={styles.heroOrbAccent} />
          <View style={styles.heroRing} />
          <Pressable
            accessibilityLabel="Close invitation"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.closeButton}
            onPress={onClose}
          >
            <X size={21} color={theme.colors.primaryContent} strokeWidth={2.4} />
          </Pressable>

          <View style={styles.communityImageFrame}>
            {communityImage ? (
              <Image
                contentFit="cover"
                source={{ uri: communityImage }}
                style={styles.communityImage}
                transition={180}
              />
            ) : (
              <View style={styles.communityImagePlaceholder}>
                <Ticket
                  size={36}
                  color={theme.button.primary.text}
                  strokeWidth={2.2}
                />
              </View>
            )}
          </View>
          <Text style={styles.inviteFrom}>COMMUNITY INVITE</Text>
          <View style={styles.nameRow}>
            <Text style={styles.communityName} numberOfLines={1}>
              {displayName}
            </Text>
            <BadgeCheck size={20} color={theme.colors.primary} strokeWidth={2.4} />
          </View>
        </View>

        <Text style={styles.title}>You’re invited.</Text>
        <Text style={styles.subtitle}>
          Join {displayName} and connect with its members on Nuts.
        </Text>

        {!linkValid ? (
          <Text style={styles.errorText}>
            This invite link is missing required information.
          </Text>
        ) : null}

        {linkValid && !loggedIn ? (
          <>
            <Text style={styles.infoText}>
              Create a profile to accept this invite, or bring an account you
              already use.
            </Text>
            <Pressable
              accessibilityLabel="Create profile and join community"
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={onCreateProfile}
            >
              <Text style={styles.primaryButtonText}>Create profile &amp; join</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Use an existing account"
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={onLogin}
            >
              <Text style={styles.secondaryButtonText}>
                I already have an account
              </Text>
            </Pressable>
            <View style={styles.privacyRow}>
              <ShieldCheck
                size={17}
                color={theme.colors.primary}
                strokeWidth={2.3}
              />
              <Text style={styles.privacyText}>
                Your public profile is shared. Your keys stay yours.
              </Text>
            </View>
          </>
        ) : null}

        {linkValid && loggedIn && (!membershipChecked || checkingMembership) ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.infoText}>Checking your membership…</Text>
          </View>
        ) : null}

        {linkValid && loggedIn && canClaim ? (
          <>
            {state === 'redeeming' ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={styles.infoText}>{STAGE_LABELS[stage]}</Text>
              </View>
            ) : (
              <Pressable
                accessibilityLabel={
                  state === 'error' ? 'Retry invitation' : 'Claim invite'
                }
                accessibilityRole="button"
                style={styles.primaryButton}
                onPress={onClaim}
              >
                <Text style={styles.primaryButtonText}>
                  {state === 'error' ? 'Try again' : 'Claim invite'}
                </Text>
              </Pressable>
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InviteSignupView({
  communityName,
  manager,
  onBack,
  onDone,
}: {
  communityName: string;
  manager: NostrManagerLike | null;
  onBack: () => void;
  onDone: (profileContent: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const profile = useSignupProfileController(manager, {
    requireRecommendedMint: false,
  });
  const continueFromProfile = profile.continueFromProfile;
  const continueSignup = useCallback(() => {
    const result = continueFromProfile();
    if (result) onDone(result.profileContent);
  }, [continueFromProfile, onDone]);

  return (
    <SignupProfileStep
      avatar={profile.avatar}
      bio={profile.bio}
      canContinue={profile.canContinue}
      continueTitle="Create profile & join"
      footerPaddingBottom={Math.max(24, insets.bottom + 12)}
      name={profile.name}
      progress="Your invitation"
      showAccountSwitch={false}
      showWalletStatus={false}
      status={profile.status}
      subtitle={`This is how people in ${communityName} will recognize you. You can change it anytime.`}
      onBack={onBack}
      onBioChange={profile.setBio}
      onContinue={continueSignup}
      onNameChange={profile.setName}
      onPickAvatar={profile.pickAvatar}
    />
  );
}

function createRedeemStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme.colors.base100);
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.colors.base100,
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    content: {
      paddingBottom: 28,
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: theme.colors.primaryContent,
      borderRadius: 2,
      height: 4,
      marginBottom: 14,
      width: 42,
    },
    hero: {
      alignItems: 'center',
      backgroundColor: theme.colors.base300,
      borderRadius: 28,
      justifyContent: 'center',
      marginBottom: 28,
      minHeight: 286,
      overflow: 'hidden',
      padding: 24,
    },
    heroOrbPrimary: {
      backgroundColor: theme.colors.primary,
      borderRadius: 120,
      height: 240,
      opacity: 0.17,
      position: 'absolute',
      right: -82,
      top: -94,
      width: 240,
    },
    heroOrbAccent: {
      backgroundColor: theme.colors.accent,
      borderRadius: 90,
      bottom: -94,
      height: 180,
      left: -55,
      opacity: 0.15,
      position: 'absolute',
      width: 180,
    },
    heroRing: {
      borderColor: theme.colors.primary,
      borderRadius: 100,
      borderWidth: 1,
      height: 200,
      opacity: 0.24,
      position: 'absolute',
      width: 200,
    },
    communityImageFrame: {
      alignItems: 'center',
      backgroundColor: theme.colors.base100,
      borderColor: theme.colors.primary,
      borderRadius: 30,
      borderWidth: 2,
      height: 102,
      justifyContent: 'center',
      marginBottom: 18,
      padding: 5,
      width: 102,
    },
    communityImage: {
      borderRadius: 23,
      height: 88,
      width: 88,
    },
    communityImagePlaceholder: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 23,
      height: 88,
      justifyContent: 'center',
      width: 88,
    },
    inviteFrom: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.2,
      marginBottom: 7,
    },
    nameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      maxWidth: '88%',
    },
    communityName: {
      color: contentColor,
      flexShrink: 1,
      fontSize: 22,
      fontWeight: '800',
      textAlign: 'center',
    },
    title: {
      color: contentColor,
      fontSize: 36,
      fontWeight: '900',
      letterSpacing: -1.1,
      lineHeight: 41,
      marginBottom: 12,
    },
    subtitle: {
      color: theme.colors.primaryContent,
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 22,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 16,
      justifyContent: 'center',
      minHeight: 56,
      marginTop: 6,
    },
    primaryButtonText: {
      color: theme.button.primary.text,
      fontSize: 16,
      fontWeight: '800',
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: theme.colors.base200,
      borderRadius: 16,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 56,
      marginTop: 12,
    },
    secondaryButtonText: {
      color: contentColor,
      fontSize: 16,
      fontWeight: '700',
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 48,
    },
    infoText: {
      color: theme.colors.primaryContent,
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 14,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 13,
      marginTop: 10,
    },
    closeButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.base100,
      borderRadius: 24,
      height: 48,
      justifyContent: 'center',
      position: 'absolute',
      right: 14,
      top: 14,
      width: 48,
      zIndex: 2,
    },
    privacyRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      justifyContent: 'center',
      marginTop: 16,
    },
    privacyText: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
}

function readableContentColor(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return '#ffffff';
  const red = Math.floor(value / 65536) % 256;
  const green = Math.floor(value / 256) % 256;
  const blue = value % 256;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140
    ? '#ffffff'
    : '#1a1a1a';
}
