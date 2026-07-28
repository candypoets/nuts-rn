import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {Kind4Sub} from '../src/subs';

export default function ChatThreadScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {peerPubkey} = useLocalSearchParams<{peerPubkey: string}>();

  return (
    <>
      <Stack.Screen options={{animation: 'simple_push'}} />
      <Kind4Sub
        peerPubkey={peerPubkey}
        visible={isFocused}
        onClose={() => router.back()}
      />
    </>
  );
}
