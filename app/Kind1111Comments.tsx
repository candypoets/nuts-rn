import React from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';

import {Kind1111CommentsModal} from '../src/modals/Kind1111CommentsModal';

export default function Kind1111CommentsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{nevent: string}>();

  return (
    <Kind1111CommentsModal
      nevent={params.nevent}
      onClose={() => router.back()}
    />
  );
}
