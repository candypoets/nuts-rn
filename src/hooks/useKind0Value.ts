import {useEffect, useMemo, useState} from 'react';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {isKind0} from '@candypoets/nipworker/utils';
import {subscribeUntilEose} from '../nostr/subscribeUntilEose';

type UseKind0ValueOptions<T> = {
  enabled?: boolean;
  fallback: T;
  isEqual?: (left: T, right: T) => boolean;
  selector: (profile: Kind0Parsed) => T;
};

export function useKind0Value<T>(
  pubkey: string,
  {
    enabled = true,
    fallback,
    isEqual = Object.is,
    selector,
  }: UseKind0ValueOptions<T>,
) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    setValue(current => (isEqual(current, fallback) ? current : fallback));

    if (!enabled || !pubkey) return;

    const unsubscribe = subscribeUntilEose(
      `u_${pubkey}`,
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
          cacheFirst: true,
          relays: [],
        },
      ],
      message => {
        const profile = isKind0(message);
        if (!profile || profile.pubkey?.() !== pubkey) return;
        const nextValue = selector(profile);
        setValue(current => (isEqual(current, nextValue) ? current : nextValue));
      },
    );

    return () => unsubscribe();
  }, [enabled, fallback, isEqual, pubkey, selector]);

  return value;
}

export function useStableKind0Selector<T>(
  selector: (profile: Kind0Parsed) => T,
) {
  return useMemo(() => selector, [selector]);
}
