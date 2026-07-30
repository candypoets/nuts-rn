import React from 'react';
import { useRouter } from 'expo-router';

import { WalletModal } from '../modals';
import { getSharedNostrManager } from '../nostr/manager';

export default function WalletRoute() {
  const router = useRouter();

  return (
    <WalletModal
      manager={getSharedNostrManager()}
      onClose={() => router.back()}
    />
  );
}
