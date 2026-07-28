import React from 'react';
import { useRouter } from 'expo-router';

import { MintsModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';

export default function MintsRoute() {
  const router = useRouter();

  return (
    <MintsModal
      manager={getSharedNostrManager()}
      onClose={() => router.back()}
    />
  );
}
