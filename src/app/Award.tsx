import {useLocalSearchParams, useRouter} from 'expo-router';
import {AwardModal} from '../modals/AwardModal';

export default function AwardScreen() {
  const router = useRouter();
  const {relay, award} = useLocalSearchParams<{
    relay: string;
    award: string;
  }>();

  return <AwardModal relay={relay} awardId={award} onClose={() => router.back()} />;
}
