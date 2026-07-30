import React from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';

import {ShareModal} from '../modals/ShareModal';

export default function ShareRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{nevent: string; naddr?: string}>();

  return (
    <ShareModal
      nevent={params.nevent}
      naddr={params.naddr}
      onClose={() => router.back()}
    />
  );
}
