import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { MintsModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';

export default function MintsRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{ presentation: 'modal', headerShown: true, title: 'Mints' }}
      />
      <MintsModal
        manager={getSharedNostrManager()}
        onClose={() => router.back()}
      />
    </>
  );
}
