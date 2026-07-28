import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { WalletModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';

export default function WalletRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <WalletModal
        manager={getSharedNostrManager()}
        onClose={() => router.back()}
      />
    </>
  );
}
