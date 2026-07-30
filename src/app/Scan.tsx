import {useLocalSearchParams} from 'expo-router';

import {ScanModal} from '../modals/ScanModal';

export default function ScanRoute() {
  const params = useLocalSearchParams<{mode?: 'share' | 'scan'}>();
  return (
    <ScanModal initialMode={params.mode} />
  );
}
