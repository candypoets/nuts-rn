import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import type { Kind0Parsed } from '@candypoets/nipworker';
import { useSubscription as subscribeToNostr } from '@candypoets/nipworker/hooks';
import { isKind0 } from '@candypoets/nipworker/utils';
import { DEFAULT_FEED_RELAYS } from '../../nostr/relays';

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

export function Avatar({
  pubkey,
  size = 'md',
  query = true,
  link = false,
  onProfileOpen,
}: AvatarProps) {
  const profileRef = useRef<Kind0Parsed | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!query || !pubkey) return;
    profileRef.current = null;
    setTick(tick => tick + 1);

    const unsubscribe = subscribeToNostr(
      `u_${pubkey}`,
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
          relays: DEFAULT_FEED_RELAYS,
        },
      ],
      message => {
        const profile = isKind0(message);
        if (!profile || profile.pubkey?.() !== pubkey) return;
        profileRef.current = profile;
        setTick(tick => tick + 1);
      },
      { closeOnEose: false },
    );

    return () => {
      profileRef.current = null;
      unsubscribe();
    };
  }, [pubkey, query]);

  const picture = profileRef.current?.picture?.() || null;

  const content = (
    <View className={`${sizeClass[size]} overflow-hidden rounded-full border border-slate-200 bg-slate-200`}>
      {picture ? (
        <Image
          source={{ uri: picture }}
          className="h-full w-full"
          resizeMode="cover"
        />
      ) : (
        <Image
          source={fallbackProfileImage}
          className="h-full w-full"
          resizeMode="cover"
        />
      )}
    </View>
  );

  if (!link) return content;

  return (
    <Pressable hitSlop={8} onPress={() => onProfileOpen?.(pubkey)}>
      {content}
    </Pressable>
  );
}
