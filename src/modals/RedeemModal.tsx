import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { BadgeCheck, Ticket } from 'lucide-react-native';

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

type RedeemModalProps = {
  relay: string;
  token: string;
  onDone: () => void;
};

type RedeemState = 'idle' | 'redeeming' | 'done' | 'error';

const STAGE_LABELS: Record<RedeemStage, string> = {
  request: 'Claiming your invite…',
  indexes: 'Saving your membership…',
  profile: 'Copying your profile…',
};

export function RedeemModal({ relay, token, onDone }: RedeemModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createRedeemStyles(theme), [theme]);
  const router = useRouter();

  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);

  const relayBaseUrl = useMemo(() => normalizeRelayBaseUrl(relay || ''), [relay]);
  const communityRelayUrl = useMemo(
    () => relayUrlFromBaseUrl(relayBaseUrl),
    [relayBaseUrl],
  );
  const linkValid = Boolean(relayBaseUrl && token);

  const [communityName, setCommunityName] = useState('');
  const [communityImage, setCommunityImage] = useState('');
  const [state, setState] = useState<RedeemState>('idle');
  const [stage, setStage] = useState<RedeemStage>('request');
  const [error, setError] = useState('');
  const [checkingMembership, setCheckingMembership] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);
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
    if (!pubkey || !communityRelayUrl || !linkValid) return;
    let cancelled = false;
    setCheckingMembership(true);
    checkExistingMembership(pubkey, communityRelayUrl)
      .then(member => {
        if (cancelled) return;
        setAlreadyMember(member);
        setCheckingMembership(false);
      })
      .catch(() => {
        if (!cancelled) setCheckingMembership(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey, communityRelayUrl, linkValid]);

  const displayName = communityName || communityNameFromRelay(relayBaseUrl);

  const claim = useCallback(async () => {
    if (!pubkey || !linkValid || state === 'redeeming') return;
    setState('redeeming');
    setError('');
    try {
      await redeemInvite({
        token,
        relayBaseUrl,
        pubkey,
        onStage: nextStage => {
          if (mountedRef.current) setStage(nextStage);
        },
      });
      if (!mountedRef.current) return;
      setAlreadyMember(true);
      setState('done');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not redeem invite.');
      setState('error');
    }
  }, [pubkey, linkValid, state, token, relayBaseUrl]);

  const openCommunity = useCallback(() => {
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

  const loggedIn = Boolean(pubkey && hasSigner);
  const canClaim =
    linkValid && loggedIn && !alreadyMember && !checkingMembership;

  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />

      <View style={styles.header}>
        {communityImage ? (
          <Image source={{ uri: communityImage }} style={styles.communityImage} />
        ) : (
          <View style={styles.communityImagePlaceholder}>
            <Ticket size={26} color="#ffffff" strokeWidth={2.2} />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.inviteFrom}>Invite from</Text>
          <View style={styles.nameRow}>
            <Text style={styles.communityName} numberOfLines={1}>
              {displayName}
            </Text>
            <BadgeCheck size={16} color={theme.colors.primary} />
          </View>
        </View>
      </View>

      <Text style={styles.title}>You're invited to {displayName}.</Text>
      <Text style={styles.subtitle}>
        This invite lets you join the community and start connecting with other
        members on Nuts.
      </Text>

      {!linkValid ? (
        <Text style={styles.errorText}>
          This invite link is missing required information.
        </Text>
      ) : null}

      {linkValid && !loggedIn ? (
        <>
          <Text style={styles.infoText}>
            Log in or create an account to claim this invite.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.push('/Login')}
          >
            <Text style={styles.primaryButtonText}>Log in to claim</Text>
          </Pressable>
        </>
      ) : null}

      {linkValid && loggedIn && checkingMembership ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.infoText}>Checking your membership…</Text>
        </View>
      ) : null}

      {linkValid && loggedIn && !checkingMembership && alreadyMember && state !== 'done' ? (
        <>
          <Text style={styles.infoText}>
            You're already a member of {displayName}.
          </Text>
          <Pressable style={styles.primaryButton} onPress={openCommunity}>
            <Text style={styles.primaryButtonText}>Open community</Text>
          </Pressable>
        </>
      ) : null}

      {linkValid && loggedIn && !alreadyMember && !checkingMembership && state !== 'done' ? (
        <>
          {state === 'redeeming' ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={styles.infoText}>{STAGE_LABELS[stage]}</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.primaryButton, !canClaim && styles.buttonDisabled]}
              disabled={!canClaim}
              onPress={claim}
            >
              <Text style={styles.primaryButtonText}>
                {state === 'error' ? 'Try again' : 'Claim invite'}
              </Text>
            </Pressable>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </>
      ) : null}

      {state === 'done' ? (
        <>
          <Text style={styles.successText}>
            Invite redeemed — welcome to {displayName}!
          </Text>
          <Pressable style={styles.primaryButton} onPress={openCommunity}>
            <Text style={styles.primaryButtonText}>Open community</Text>
          </Pressable>
        </>
      ) : null}

      <Pressable style={styles.closeButton} onPress={onDone}>
        <Text style={styles.closeButtonText}>Close</Text>
      </Pressable>
    </View>
  );
}

function createRedeemStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme.colors.base100);
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.colors.base100,
      flex: 1,
      paddingBottom: 20,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: theme.colors.primaryContent,
      borderRadius: 2,
      height: 4,
      marginBottom: 18,
      width: 42,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 24,
    },
    communityImage: {
      borderRadius: 14,
      height: 52,
      width: 52,
    },
    communityImagePlaceholder: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 14,
      height: 52,
      justifyContent: 'center',
      width: 52,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    inviteFrom: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      fontWeight: '600',
    },
    nameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    communityName: {
      color: contentColor,
      flexShrink: 1,
      fontSize: 17,
      fontWeight: '800',
    },
    title: {
      color: contentColor,
      fontSize: 26,
      fontWeight: '800',
      lineHeight: 32,
      marginBottom: 10,
    },
    subtitle: {
      color: theme.colors.primaryContent,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 24,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 48,
      marginTop: 4,
    },
    buttonDisabled: {
      backgroundColor: theme.colors.base200,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '800',
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
      fontSize: 14,
      marginBottom: 12,
    },
    successText: {
      color: theme.colors.success,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 12,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 13,
      marginTop: 10,
    },
    closeButton: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 'auto',
      minHeight: 44,
    },
    closeButtonText: {
      color: theme.colors.primaryContent,
      fontSize: 14,
      fontWeight: '700',
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
