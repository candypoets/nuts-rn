import React from 'react';
import {Image, Pressable, Text} from 'react-native';
import {useNavigation} from 'expo-router/react-navigation';
import type {AppNavigationProp} from '../navigation/types';
import {useNostrStore} from '../stores';

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
  const profile = useNostrStore(state => state.profile);
  const picture =
    pubkey && profile?.pubkey === pubkey && profile.picture
      ? {uri: profile.picture}
      : fallbackProfileImage;

  if (!pubkey) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        className="h-9 items-center justify-center rounded-full border border-primary bg-transparent px-4"
        hitSlop={12}
        onPress={event => {
          event.stopPropagation();
          navigation.navigate('Login');
        }}
      >
        <Text className="text-sm font-semibold text-primary">Sign in</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      className={`items-center justify-center overflow-hidden rounded-full border ${className}`}
      hitSlop={12}
      onPress={event => {
        event.stopPropagation();
        navigation.navigate('Profile');
      }}
    >
      <Image source={picture} className="h-full w-full" resizeMode="cover" />
    </Pressable>
  );
}
