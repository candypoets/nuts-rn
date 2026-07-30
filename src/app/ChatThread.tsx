import {useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {Kind4Sub} from '../subs';

export default function ChatThreadScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {peerPubkey} = useLocalSearchParams<{peerPubkey: string}>();

  return (
    <Kind4Sub
      peerPubkey={peerPubkey}
      visible={isFocused}
      onClose={() => router.back()}
    />
  );
}
