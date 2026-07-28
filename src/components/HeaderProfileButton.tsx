import React from 'react';
import {Image, Pressable, View} from 'react-native';
import {useNavigation} from 'expo-router/react-navigation';
import {User} from 'lucide-react-native';
import type {AppNavigationProp} from '../navigation/types';
import {useNostrStore} from '../stores';
import {useAppTheme} from '../theme';

const fallbackProfileImage = require('../../assets/miss-profile.png');

type HeaderProfileButtonProps = {
  pubkey: string | null;
  className?: string;
};

export function HeaderProfileButton({
  pubkey,
  className = 'h-9 w-9 border-base-200 bg-base-100',
}: HeaderProfileButtonProps) {
  const navigation =
    useNavigation<AppNavigationProp>();
  const theme = useAppTheme();
  const profile = useNostrStore(state => state.profile);
  const picture =
    pubkey && profile?.pubkey === pubkey && profile.picture
      ? {uri: profile.picture}
      : fallbackProfileImage;

  return (
    <Pressable
      className={`items-center justify-center overflow-hidden rounded-full border ${className}`}
      hitSlop={12}
      onPress={() => navigation.navigate(pubkey ? 'Profile' : 'Login')}
    >
      {pubkey ? (
        <Image source={picture} className="h-full w-full" resizeMode="cover" />
      ) : (
        <View className="h-full w-full items-center justify-center">
          <User size={18} color={theme.colors.primaryContent} strokeWidth={2.2} />
        </View>
      )}
    </Pressable>
  );
}
