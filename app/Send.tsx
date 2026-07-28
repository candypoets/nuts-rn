import {useRouter} from 'expo-router';

import {SendModal} from '../src/modals/SendModal';

export default function SendRoute() {
  const router = useRouter();
  return (
    <SendModal onClose={() => router.back()} />
  );
}
