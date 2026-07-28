import {Stack, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {NotificationsSub} from '../src/subs';

export default function NotificationsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();

  return (
    <>
      <Stack.Screen options={{animation: 'simple_push'}} />
      <NotificationsSub visible={isFocused} onClose={() => router.back()} />
    </>
  );
}
