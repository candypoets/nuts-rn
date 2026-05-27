import { useEffect } from 'react';
import { useRelayStatus as subscribeToRelayStatus } from '@candypoets/nipworker/hooks';
import { useRelayStore } from '../stores';

function normalizeRelay(url: string) {
  return url.trim().replace(/\/$/, '');
}

export function useRelayTracking(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    return subscribeToRelayStatus((status, url) => {
      useRelayStore.getState().setRelayStatus(normalizeRelay(url), status);
    });
  }, [enabled]);
}
