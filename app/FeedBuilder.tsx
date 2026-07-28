import React from 'react';
import { useRouter } from 'expo-router';

import { FeedBuilderModal } from '../src/modals';

export default function FeedBuilderRoute() {
  const router = useRouter();

  return (
    <FeedBuilderModal onClose={() => router.back()} />
  );
}
