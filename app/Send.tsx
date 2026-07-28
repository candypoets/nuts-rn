import {Stack, useRouter} from 'expo-router';

import {SendModal} from '../src/modals/SendModal';

export default function SendRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <SendModal onClose={() => router.back()} />
    </>
  );
}
