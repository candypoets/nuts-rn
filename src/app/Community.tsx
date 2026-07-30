import {useEffect, useState} from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {CommunitySub} from '../subs';

export default function CommunityScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{
    relay: string;
    description?: string;
    icon?: string;
    name?: string;
    relationship?: 'follow' | 'belong';
  }>();
  const [subVisible, setSubVisible] = useState(false);

  // Defer mounting the heavy sub tree by one frame so it does not render
  // during the push animation (ported from App.tsx CommunityScreen).
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
    <CommunitySub
      description={params.description}
      icon={params.icon}
      name={params.name}
      relationship={params.relationship}
      relay={params.relay}
      visible={isFocused && subVisible}
      onClose={() => router.back()}
    />
  );
}
