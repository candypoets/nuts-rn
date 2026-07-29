import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RedeemModal } from '../src/modals';

export default function RedeemRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ relay?: string; token?: string }>();

  return (
    <RedeemModal
      relay={params.relay || ''}
      token={params.token || ''}
      onDone={() => router.back()}
    />
  );
}
