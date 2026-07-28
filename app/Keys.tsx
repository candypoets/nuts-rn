import React from 'react';
import { useRouter } from 'expo-router';

import { KeysModal } from '../src/modals';

export default function KeysRoute() {
  const router = useRouter();

  return (
    <KeysModal onClose={() => router.back()} />
  );
}
