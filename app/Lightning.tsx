import {useLocalSearchParams, useRouter} from 'expo-router';

import {SendPlaceholderModal} from '../src/modals/SendModal';

export default function LightningRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{invoice?: string}>();
  return (
    <SendPlaceholderModal
      title="Lightning"
      invoice={params.invoice}
      onClose={() => router.back()}
    />
  );
}
