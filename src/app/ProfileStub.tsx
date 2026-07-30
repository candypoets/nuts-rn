import React, { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProfileStubModal } from '../modals';
import { useAuthStore } from '../stores';

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
    <ProfileStubModal
      path={path}
      auth={auth}
      onClose={() => router.back()}
    />
  );
}
