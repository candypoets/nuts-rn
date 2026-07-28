import {useEffect, useState} from 'react';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {Kind0Sub} from '../src/subs';

export default function PublicProfileScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {pubkey} = useLocalSearchParams<{pubkey: string}>();
  const [subVisible, setSubVisible] = useState(false);

  // Defer mounting the heavy sub tree by one frame so it does not render
  // during the push animation (ported from App.tsx PublicProfileScreen).
  useEffect(() => {
    setSubVisible(false);
    if (!isFocused) return undefined;

    const frame = requestAnimationFrame(() => {
      setSubVisible(true);
    });

    return () => {
      cancelAnimationFrame(frame);
      setSubVisible(false);
    };
  }, [isFocused, pubkey]);

  return (
    <>
      <Stack.Screen options={{animation: 'simple_push'}} />
      <Kind0Sub
        pubkey={pubkey}
        visible={isFocused && subVisible}
        onClose={() => router.back()}
      />
    </>
  );
}
