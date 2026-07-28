import {Stack, useLocalSearchParams, useRouter} from 'expo-router';

import {SendEcashModal} from '../src/modals/SendEcashModal';

export default function SendEcashRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    pubkey: string;
    noteId?: string;
    targetKind?: string;
    targetAddress?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <SendEcashModal
        pubkey={params.pubkey}
        noteId={params.noteId}
        targetKind={
          params.targetKind != null ? Number(params.targetKind) : undefined
        }
        targetAddress={params.targetAddress}
        onClose={() => router.back()}
      />
    </>
  );
}
