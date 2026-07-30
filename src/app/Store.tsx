import {useEffect, useState} from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {StoreSub} from '../subs/StoreSub';

export default function StoreScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{
    relay: string;
    name?: string;
  }>();
  const [subVisible, setSubVisible] = useState(false);

  // Defer mounting the heavy sub tree by one frame so it does not render
  // during the push animation (same pattern as app/Community.tsx).
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
  }, [isFocused, params.relay]);

  return (
    <StoreSub
      name={params.name}
      relay={params.relay}
      visible={isFocused && subVisible}
      onClose={() => router.back()}
    />
  );
}
