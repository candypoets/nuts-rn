import React from 'react';
import { useRouter } from 'expo-router';

import { LogoutModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';

export default function LogoutRoute() {
  const router = useRouter();

  return (
    <LogoutModal
      manager={getSharedNostrManager()}
      onDone={() => router.back()}
    />
  );
}
