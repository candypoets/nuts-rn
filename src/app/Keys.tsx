import React from 'react';
import { useRouter } from 'expo-router';

import { KeysModal } from '../modals';

export default function KeysRoute() {
  const router = useRouter();

  return (
    <KeysModal onClose={() => router.back()} />
  );
}
