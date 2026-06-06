import React, {memo, useCallback, useContext} from 'react';
import {Text} from 'react-native';
import {NavigationContext} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {useKind0Value} from '../../hooks/useKind0Value';
import {pushDistinct} from '../../navigation/pushDistinct';
import type {RootStackParamList} from '../../navigation/types';
import {shortPubkey} from './time';

type UserProps = {
  pubkey: string;
  context?: unknown[];
  query?: boolean;
  link?: boolean;
  className?: string;
  onProfileOpen?: (pubkey: string) => void;
};

function displayName(profile: Kind0Parsed | null, pubkey: string) {
  return (
    profile?.name?.()?.trim() ||
    profile?.displayName?.()?.trim() ||
    shortPubkey(pubkey)
  );
}

function UserComponent({
  pubkey,
  query = true,
  link = false,
  className = 'text-sm font-semibold text-base-content',
  onProfileOpen,
}: UserProps) {
  const navigation = useContext(NavigationContext) as
    | NativeStackNavigationProp<RootStackParamList>
    | undefined;
  const fallbackName = shortPubkey(pubkey);
  const selectName = useCallback(
    (profile: Kind0Parsed) => displayName(profile, pubkey),
    [pubkey],
  );
  const name = useKind0Value(pubkey, {
    enabled: query,
    fallback: fallbackName,
    selector: selectName,
  });
  const openProfile = useCallback(() => {
    if (onProfileOpen) {
      onProfileOpen(pubkey);
      return;
    }
    if (!navigation) return;
    pushDistinct(navigation, 'PublicProfile', {pubkey});
  }, [navigation, onProfileOpen, pubkey]);

  return (
    <Text
      className={className}
      onPress={
        link
          ? event => {
              event.stopPropagation();
              openProfile();
            }
          : undefined
      }>
      {name}
    </Text>
  );
}

export const User = memo(UserComponent, (previous, next) => (
  previous.pubkey === next.pubkey &&
  (previous.query ?? true) === (next.query ?? true) &&
  (previous.link ?? false) === (next.link ?? false) &&
  (previous.className ?? 'text-sm font-semibold text-base-content') ===
    (next.className ?? 'text-sm font-semibold text-base-content') &&
  previous.onProfileOpen === next.onProfileOpen
));
