import {useEffect, useMemo, useState} from 'react';
import type {Kind0Parsed} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {isKind0} from '@candypoets/nipworker/utils';

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

    const unsubscribe = subscribeToNostr(
      `u_${pubkey}`,
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
          cacheFirst: true,
          closeOnEOSE: true,
          relays: [],
        },
      ],
      message => {
        const profile = isKind0(message);
        if (!profile || profile.pubkey?.() !== pubkey) return;
        const nextValue = selector(profile);
        setValue(current => (isEqual(current, nextValue) ? current : nextValue));
      },
      {cacheFirst: true, closeOnEose: true},
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
