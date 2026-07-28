import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {CalendarEventModal} from '../src/modals/CalendarEventModal';

export default function CalendarEventScreen() {
  const router = useRouter();
  const {relay, address} = useLocalSearchParams<{
    relay: string;
    address: string;
  }>();

  return (
    <>
      <Stack.Screen options={{animation: 'simple_push'}} />
      <CalendarEventModal
        relay={relay}
        address={address}
        onClose={() => router.back()}
      />
    </>
  );
}
