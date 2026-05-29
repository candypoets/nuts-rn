import React, {memo, useCallback, useMemo} from 'react';
import { Image, Pressable, View } from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useKind0Value} from '../../hooks/useKind0Value';
import {pushDistinct} from '../../navigation/pushDistinct';
import type {RootStackParamList} from '../../navigation/types';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

type AvatarProps = {
  pubkey: string;
  size?: AvatarSize;
  query?: boolean;
  link?: boolean;
  onProfileOpen?: (pubkey: string) => void;
};

const sizeClass: Record<AvatarSize, string> = {
  xs: 'h-4 w-4',
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const fallbackProfileImage = require('../../../assets/miss-profile.png');

function AvatarComponent({
  pubkey,
  size = 'md',
  query = true,
  link = false,
  onProfileOpen,
}: AvatarProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const selectPicture = useCallback(
    (profile: import('@candypoets/nipworker').Kind0Parsed) =>
      profile.picture?.() || null,
    [],
  );
  const picture = useKind0Value(pubkey, {
    enabled: query,
    fallback: null,
    selector: selectPicture,
  });
  const imageSource = useMemo(
    () => (picture ? {uri: picture} : fallbackProfileImage),
    [picture],
  );
  const openProfile = useCallback(() => {
    if (onProfileOpen) {
      onProfileOpen(pubkey);
      return;
    }
    pushDistinct(navigation, 'PublicProfile', {pubkey});
  }, [navigation, onProfileOpen, pubkey]);

  const content = (
    <View className={`${sizeClass[size]} overflow-hidden rounded-full border border-slate-200 bg-slate-200`}>
      <Image
        source={imageSource}
        className="h-full w-full"
        resizeMode="cover"
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

export const Avatar = memo(AvatarComponent, (previous, next) => (
  previous.pubkey === next.pubkey &&
  (previous.size ?? 'md') === (next.size ?? 'md') &&
  (previous.query ?? true) === (next.query ?? true) &&
  (previous.link ?? false) === (next.link ?? false) &&
  previous.onProfileOpen === next.onProfileOpen
));
