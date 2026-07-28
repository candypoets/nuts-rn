import React from 'react';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';

import {Kind1111CommentsModal} from '../src/modals/Kind1111CommentsModal';

export default function Kind1111CommentsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{nevent: string}>();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.66, 0.92],
          sheetExpandsWhenScrolledToEdge: false,
          sheetGrabberVisible: true,
          sheetInitialDetentIndex: 0,
        }}
      />
      <Kind1111CommentsModal
        nevent={params.nevent}
        onClose={() => router.back()}
      />
    </>
  );
}
