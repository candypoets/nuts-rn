import {useRouter} from 'expo-router';

import {ReceiveModal} from '../modals/ReceiveModal';

export default function ReceiveRoute() {
  const router = useRouter();
  return (
    <ReceiveModal
      onClose={() => router.back()}
      onMinting={() => router.push('/Minting')}
    />
  );
}
