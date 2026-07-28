import {Stack, useRouter} from 'expo-router';

import {SendPlaceholderModal} from '../src/modals/SendModal';

export default function TapcashRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <SendPlaceholderModal title="Tap cash" onClose={() => router.back()} />
    </>
  );
}
