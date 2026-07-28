import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { FeedBuilderModal } from '../src/modals';

export default function FeedBuilderRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <FeedBuilderModal onClose={() => router.back()} />
    </>
  );
}
