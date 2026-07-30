import {useRouter} from 'expo-router';

import {MintingModal} from '../modals/MintingModal';

export default function MintingRoute() {
  const router = useRouter();
  return (
    <MintingModal onClose={() => router.back()} />
  );
}
