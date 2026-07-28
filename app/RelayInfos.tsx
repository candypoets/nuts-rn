import React, { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RelayInfosModal } from '../src/modals';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Object params arrive JSON-encoded when pushed through the router.
function parseRelays(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(item => typeof item === 'string');
  } catch {
    // not JSON — treat as a single relay url
  }
  return [value];
}

function parseStatuses(
  value: string | string[] | undefined,
): Record<string, string> | undefined {
  const raw = first(value);
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore malformed statuses
  }
  return undefined;
}

export default function RelayInfosRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    subId?: string | string[];
    relays?: string | string[];
    statuses?: string | string[];
    mode?: string | string[];
  }>();

  const relays = useMemo(() => parseRelays(params.relays), [params.relays]);
  const statuses = useMemo(() => parseStatuses(params.statuses), [params.statuses]);
  const rawMode = first(params.mode);
  const mode = rawMode === 'communities' ? 'communities' : rawMode === 'relays' ? 'relays' : undefined;

  return (
    <RelayInfosModal
      subId={first(params.subId)}
      relays={relays}
      statuses={statuses}
      mode={mode}
      onClose={() => router.back()}
    />
  );
}
