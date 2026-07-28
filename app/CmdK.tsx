import React from 'react';
import { useRouter } from 'expo-router';

import { CmdKModal } from '../src/modals';

export default function CmdKRoute() {
  const router = useRouter();

  return (
    <CmdKModal
      onClose={() => router.back()}
      onSelectProfile={pubkey =>
        router.push({ pathname: '/PublicProfile', params: { pubkey } })
      }
      onSelectHashtag={tag =>
        router.push({ pathname: '/Tags', params: { tags: [tag] } })
      }
    />
  );
}
