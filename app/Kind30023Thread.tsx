import {useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {Kind30023Sub} from '../src/subs';

export default function Kind30023ThreadScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {naddr} = useLocalSearchParams<{naddr: string}>();

  return (
    <Kind30023Sub
      naddr={naddr}
      visible={isFocused}
      onClose={() => router.back()}
    />
  );
}
