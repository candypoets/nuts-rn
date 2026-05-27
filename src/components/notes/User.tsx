import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {isKind0} from '@candypoets/nipworker/utils';
import {DEFAULT_FEED_RELAYS} from '../../nostr/relays';
import {shortPubkey} from './time';

type UserProps = {
  pubkey: string;
  context?: unknown[];
  query?: boolean;
  className?: string;
};

function displayName(profile: Kind0Parsed | null, pubkey: string) {
  return (
    profile?.name?.()?.trim() ||
    profile?.displayName?.()?.trim() ||
    shortPubkey(pubkey)
  );
}

export function User({
  pubkey,
  query = true,
  className = 'text-sm font-semibold text-slate-900',
}: UserProps) {
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

  return <Text className={className}>{displayName(profileRef.current, pubkey)}</Text>;
}
