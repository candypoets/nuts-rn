import {useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {Kind1Sub} from '../subs';

export default function Kind1ThreadScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {nevent} = useLocalSearchParams<{nevent: string}>();

  return (
    <Kind1Sub
      keepSubscriptionsOnBlur
      nevent={nevent}
      visible={isFocused}
      onClose={() => router.back()}
    />
  );
}
