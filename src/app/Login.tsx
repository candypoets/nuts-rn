import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { PrivateKeyLogin, SignupModal } from '../modals';
import { getSharedNostrManager } from '../nostr/manager';
import { useAuthStore } from '../stores';

type LoginMode = 'login' | 'signup';

export default function LoginRoute() {
  const router = useRouter();
  const manager = getSharedNostrManager();
  const pubkey = useAuthStore(state => state.pubkey);
  const auth = useMemo(() => ({ pubkey }), [pubkey]);
  const focused = useIsFocused();
  const [mode, setMode] = useState<LoginMode>('login');
  const onClose = useCallback(() => router.back(), [router]);
  const onSignup = useCallback(() => setMode('signup'), []);
  const onBackToLogin = useCallback(() => setMode('login'), []);

  return mode === 'signup' ? (
    <SignupModal
      focused={focused}
      manager={manager}
      onBackToLogin={onBackToLogin}
      onDone={onClose}
    />
  ) : (
    <PrivateKeyLogin
      manager={manager}
      auth={auth}
      onDone={onClose}
      onSignup={onSignup}
    />
  );
}
