import {Stack, useRouter} from 'expo-router';

import {ReceiveModal} from '../src/modals/ReceiveModal';

export default function ReceiveRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <ReceiveModal
        onClose={() => router.back()}
        onMinting={() => router.push('/Minting')}
      />
    </>
  );
}
