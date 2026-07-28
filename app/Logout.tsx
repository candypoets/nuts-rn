import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { LogoutModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';

export default function LogoutRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'formSheet' }} />
      <LogoutModal
        manager={getSharedNostrManager()}
        onDone={() => router.back()}
      />
    </>
  );
}
