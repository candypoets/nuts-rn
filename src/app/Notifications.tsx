import {useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {NotificationsSub} from '../subs';

export default function NotificationsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();

  return (
    <NotificationsSub visible={isFocused} onClose={() => router.back()} />
  );
}
