import {useRouter} from 'expo-router';

import {NewChatModal} from '../src/modals/NewChatModal';

export default function NewChatRoute() {
  const router = useRouter();
  return (
    <NewChatModal onClose={() => router.back()} />
  );
}
