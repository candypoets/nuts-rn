import React from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';

import {PostModal} from '../src/modals/PostModal';

export default function PostRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{reply?: string; quote?: string}>();

  return (
    <PostModal
      reply={params.reply}
      quote={params.quote}
      onClose={() => router.back()}
    />
  );
}
