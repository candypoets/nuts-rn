import {useRouter} from 'expo-router';
import {PassesModal} from '../modals/PassesModal';

export default function PassesScreen() {
  const router = useRouter();
  return <PassesModal onClose={() => router.back()} />;
}
