import React from 'react';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';

import {ShareModal} from '../src/modals/ShareModal';

export default function ShareRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{nevent: string; naddr?: string}>();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6],
          sheetCornerRadius: 18,
          sheetGrabberVisible: false,
        }}
      />
      <ShareModal
        nevent={params.nevent}
        naddr={params.naddr}
        onClose={() => router.back()}
      />
    </>
  );
}
