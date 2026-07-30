import React from 'react';
import { useRouter } from 'expo-router';

import { LogoutModal } from '../modals';
import { getSharedNostrManager } from '../nostr/manager';

export default function LogoutRoute() {
  const router = useRouter();

  return (
    <LogoutModal
      manager={getSharedNostrManager()}
      onDone={() => router.back()}
    />
  );
}
