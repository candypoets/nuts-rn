import React from 'react';
import { useRouter } from 'expo-router';

import { MintsModal } from '../modals';
import { getSharedNostrManager } from '../nostr/manager';

export default function MintsRoute() {
  const router = useRouter();

  return (
    <MintsModal
      manager={getSharedNostrManager()}
      onClose={() => router.back()}
    />
  );
}
