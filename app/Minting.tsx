import {Stack, useRouter} from 'expo-router';

import {MintingModal} from '../src/modals/MintingModal';

export default function MintingRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <MintingModal onClose={() => router.back()} />
    </>
  );
}
