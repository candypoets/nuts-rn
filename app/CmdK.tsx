import React from 'react';
import { Stack, useRouter } from 'expo-router';

import { CmdKModal } from '../src/modals';

export default function CmdKRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ presentation: 'fullScreenModal' }} />
      <CmdKModal
        onClose={() => router.back()}
        onSelectProfile={pubkey =>
          router.push({ pathname: '/PublicProfile', params: { pubkey } })
        }
        onSelectHashtag={tag =>
          router.push({ pathname: '/Tags', params: { tags: [tag] } })
        }
      />
    </>
  );
}
