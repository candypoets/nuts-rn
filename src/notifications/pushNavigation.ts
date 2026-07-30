import { neventEncode } from 'nostr-tools/nip19';

export function pushNotificationRoute(data: Record<string, unknown>) {
  const eventId =
    typeof data.event_id === 'string' && /^[0-9a-f]{64}$/i.test(data.event_id)
      ? data.event_id
      : null;
  const targetEventId =
    typeof data.target_event_id === 'string' &&
    /^[0-9a-f]{64}$/i.test(data.target_event_id)
      ? data.target_event_id
      : null;
  const eventKind =
    typeof data.event_kind === 'number'
      ? data.event_kind
      : Number(data.event_kind);
  const sourceRelay =
    typeof data.source_relay === 'string' &&
    /^wss?:\/\//i.test(data.source_relay)
      ? data.source_relay
      : null;
  const threadId = targetEventId || (eventKind === 1 ? eventId : null);
  if (!threadId) return { pathname: '/Notifications' as const };
  return {
    pathname: '/Kind1Thread' as const,
    params: {
      nevent: neventEncode({
        id: threadId,
        relays: sourceRelay ? [sourceRelay] : undefined,
      }),
    },
  };
}
