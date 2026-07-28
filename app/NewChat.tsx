import {Stack, useRouter} from 'expo-router';

import {NewChatModal} from '../src/modals/NewChatModal';

export default function NewChatRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{presentation: 'modal'}} />
      <NewChatModal onClose={() => router.back()} />
    </>
  );
}
