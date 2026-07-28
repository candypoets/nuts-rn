import {Stack, useLocalSearchParams} from 'expo-router';

import {ScanModal} from '../src/modals/ScanModal';

export default function ScanRoute() {
  const params = useLocalSearchParams<{mode?: 'share' | 'scan'}>();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <ScanModal initialMode={params.mode} />
    </>
  );
}
