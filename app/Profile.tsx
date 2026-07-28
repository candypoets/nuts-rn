import React, { useMemo } from 'react';
import { useRouter } from 'expo-router';

import { ProfileModal } from '../src/modals';
import { getSharedNostrManager } from '../src/nostr/manager';
import { useAuthStore } from '../src/stores';

export default function ProfileRoute() {
  const router = useRouter();
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const nsec = useAuthStore(state => state.nsec);
  const auth = useMemo(() => ({ pubkey, hasSigner, nsec }), [hasSigner, nsec, pubkey]);

  return (
    <ProfileModal
      auth={auth}
      manager={getSharedNostrManager()}
      onClose={() => router.back()}
    />
  );
}
