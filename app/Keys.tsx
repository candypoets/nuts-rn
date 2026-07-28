import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { KeysModal } from '../src/modals';

export default function KeysRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <KeysModal onClose={() => router.back()} />
    </>
  );
}
