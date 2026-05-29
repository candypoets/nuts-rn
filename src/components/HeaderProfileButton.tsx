import React from 'react';
import {Image, Pressable, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {User} from 'lucide-react-native';
import type {RootStackParamList} from '../navigation/types';
import {useNostrStore} from '../stores';

const fallbackProfileImage = require('../../assets/miss-profile.png');

type HeaderProfileButtonProps = {
  pubkey: string | null;
  className?: string;
};

export function HeaderProfileButton({
  pubkey,
  className = 'h-9 w-9 border-slate-200 bg-slate-50',
}: HeaderProfileButtonProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
          <User size={18} color="#17212b" strokeWidth={2.2} />
        </View>
      )}
    </Pressable>
  );
}
