import React from 'react';
import { useRouter } from 'expo-router';

import { RelayPreferencesModal } from '../src/modals';

export default function RelayPreferencesRoute() {
  const router = useRouter();

  return (
    <RelayPreferencesModal onClose={() => router.back()} />
  );
}
