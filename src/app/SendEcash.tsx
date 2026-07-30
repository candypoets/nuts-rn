import {useLocalSearchParams, useRouter} from 'expo-router';

import {SendEcashModal} from '../modals/SendEcashModal';

export default function SendEcashRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    pubkey: string;
    noteId?: string;
    targetKind?: string;
    targetAddress?: string;
  }>();
  return (
    <SendEcashModal
      pubkey={params.pubkey}
      noteId={params.noteId}
      targetKind={
        params.targetKind != null ? Number(params.targetKind) : undefined
      }
      targetAddress={params.targetAddress}
      onClose={() => router.back()}
    />
  );
}
