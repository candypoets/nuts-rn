import {useRouter} from 'expo-router';

import {SendPlaceholderModal} from '../modals/SendModal';

export default function TapcashRoute() {
  const router = useRouter();
  return (
    <SendPlaceholderModal title="Tap cash" onClose={() => router.back()} />
  );
}
