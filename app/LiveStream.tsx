import React from 'react';
import {useLocalSearchParams} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';

import {LiveStreamSub} from '../src/subs/LiveStreamSub';

export default function LiveStreamRoute() {
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{nevent: string}>();

  return (
    <LiveStreamSub nevent={params.nevent} visible={isFocused} />
  );
}
