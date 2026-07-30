import {useLocalSearchParams, useRouter} from 'expo-router';
import {CalendarEventModal} from '../modals/CalendarEventModal';

export default function CalendarEventScreen() {
  const router = useRouter();
  const {relay, address} = useLocalSearchParams<{
    relay: string;
    address: string;
  }>();

  return (
    <CalendarEventModal
      relay={relay}
      address={address}
      onClose={() => router.back()}
    />
  );
}
