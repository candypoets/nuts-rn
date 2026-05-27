import React, {useEffect, useRef, useState} from 'react';
import {Image, View} from 'react-native';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {isKind0} from '@candypoets/nipworker/utils';
import {DEFAULT_FEED_RELAYS} from '../../nostr/relays';

type AvatarSize = 'sm' | 'md' | 'lg';

type AvatarProps = {
  pubkey: string;
  size?: AvatarSize;
  query?: boolean;
};

const sizeClass: Record<AvatarSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const fallbackProfileImage = require('../../../assets/miss-profile.png');

export function Avatar({pubkey, size = 'md', query = true}: AvatarProps) {
  const profileRef = useRef<Kind0Parsed | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!query || !pubkey) return;
    profileRef.current = null;
    setTick(tick => tick + 1);

    const unsubscribe = subscribeToNostr(
      `u_${pubkey}`,
      [{kinds: [0], authors: [pubkey], limit: 1, relays: DEFAULT_FEED_RELAYS}],
      message => {
        const profile = isKind0(message);
        if (!profile || profile.pubkey?.() !== pubkey) return;
        profileRef.current = profile;
        setTick(tick => tick + 1);
      },
      {closeOnEose: false, bytesPerEvent: 8 * 1024},
    );

    return () => {
      profileRef.current = null;
      unsubscribe();
    };
  }, [pubkey, query]);

  const picture = profileRef.current?.picture?.() || null;

  return (
    <View
      className={`${sizeClass[size]} overflow-hidden rounded-full border border-slate-200 bg-slate-200`}
    >
      {picture ? (
        <Image source={{uri: picture}} className="h-full w-full" resizeMode="cover" />
      ) : (
        <Image
          source={fallbackProfileImage}
          className="h-full w-full"
          resizeMode="cover"
        />
      )}
    </View>
  );
}
