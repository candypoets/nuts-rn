import React, { memo, useCallback, useContext, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Kind0Parsed } from '@candypoets/nipworker';
import { useKind0Value } from '../../hooks/useKind0Value';
import { identityColor, initials } from '../../lib/identity';
import { pushDistinct } from '../../navigation/pushDistinct';
import type { RootStackParamList } from '../../navigation/types';
import { NativeAvatar } from '../native/NativeAvatar';

type AvatarSize =
  | 'xxs'
  | 'xs'
  | 'zap'
  | 's'
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | 'fill';

type AvatarProps = {
  pubkey: string;
  size?: AvatarSize;
  query?: boolean;
  link?: boolean;
  onProfileOpen?: (pubkey: string) => void;
};

const sizeClass: Record<AvatarSize, string> = {
  xxs: 'h-5 w-5',
  xs: 'h-4 w-4',
  zap: 'h-6 w-6',
  s: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-14 w-14',
  fill: 'h-full w-full',
};

function AvatarComponent({
  pubkey,
  size = 'md',
  query = true,
  link = false,
  onProfileOpen,
}: AvatarProps) {
  const navigation = useContext(NavigationContext) as
    | NativeStackNavigationProp<RootStackParamList>
    | undefined;
  const openProfile = useCallback(() => {
    if (onProfileOpen) {
      onProfileOpen(pubkey);
      return;
    }
    if (!navigation) return;
    pushDistinct(navigation, 'PublicProfile', { pubkey });
  }, [navigation, onProfileOpen, pubkey]);

  const selectName = useCallback(
    (profile: Kind0Parsed) =>
      profile.name?.()?.trim() || profile.displayName?.()?.trim() || '',
    [],
  );
  const profileName = useKind0Value(pubkey, {
    enabled: query,
    fallback: '',
    selector: selectName,
  });
  const avatarColor = useMemo(
    () => hslToRgba(identityColor(pubkey)),
    [pubkey],
  );

  const content = (
    <View
      className={`${sizeClass[size]} overflow-hidden rounded-full border border-base-200 bg-base-200`}
    >
      <NativeAvatar
        pubkey={pubkey}
        query={query}
        initials={profileName ? initials(profileName) : ''}
        avatarColor={avatarColor}
        style={styles.fill}
      />
    </View>
  );

  if (!link) return content;

  return (
    <Pressable hitSlop={8} onPress={openProfile}>
      {content}
    </Pressable>
  );
}

export const Avatar = memo(
  AvatarComponent,
  (previous, next) =>
    previous.pubkey === next.pubkey &&
    (previous.size ?? 'md') === (next.size ?? 'md') &&
    (previous.query ?? true) === (next.query ?? true) &&
    (previous.link ?? false) === (next.link ?? false) &&
    previous.onProfileOpen === next.onProfileOpen,
);

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
});

// Native color parsers accept rgba()/hex only, so convert the hsl() string
// returned by identityColor before passing it down.
function hslToRgba(color: string): string {
  const match = /^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/.exec(
    color.trim(),
  );
  if (!match) return color;
  const h = (Number(match[1]) % 360) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(
      255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    );
  };
  return `rgba(${channel(0)}, ${channel(8)}, ${channel(4)}, 1)`;
}
