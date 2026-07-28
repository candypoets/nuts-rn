import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { RelayPreferencesModal } from '../src/modals';

export default function RelayPreferencesRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <RelayPreferencesModal onClose={() => router.back()} />
    </>
  );
}
