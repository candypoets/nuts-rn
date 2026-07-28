import React from 'react';
import { Stack } from 'expo-router';

import { ThemeModal } from '../src/modals';

export default function ThemeRoute() {
  return (
    <>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <ThemeModal />
    </>
  );
}
