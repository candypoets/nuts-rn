import React, { useMemo } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { ProfileStubModal } from '../src/modals';
import { useAuthStore } from '../src/stores';

type ProfileStubPath = 'relays' | 'wallet' | 'nprofile';

function toPath(value: string | string[] | undefined): ProfileStubPath {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'relays' || raw === 'wallet' || raw === 'nprofile') return raw;
  return 'relays';
}

export default function ProfileStubRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const path = toPath(params.path);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const auth = useMemo(() => ({ pubkey, hasSigner }), [hasSigner, pubkey]);

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <ProfileStubModal
        path={path}
        auth={auth}
        onClose={() => router.back()}
      />
    </>
  );
}
