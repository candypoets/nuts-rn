import { nip19 } from 'nostr-tools';

type RouteParams = Record<string, string | string[]>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Builds a stable stack identity from the params that identify a route.
 * Returning the same identity makes Expo Router reuse that screen instead of
 * leaving duplicate copies in the stack.
 */
export function singularByParams(...keys: string[]) {
  return (name: string, params: RouteParams) => {
    const values = keys.map(key => params[key]);
    if (values.some(value => value === undefined)) return undefined;

    return JSON.stringify([name, ...values]);
  };
}

/**
 * NIP-19 relay and author hints are not part of an event's identity. Decode
 * note routes so differently hinted identifiers for the same entity collapse
 * to one stack entry.
 */
export function singularNostrRoute(name: string, params: RouteParams) {
  const identifier = firstParam(params.nevent) ?? firstParam(params.naddr);
  if (!identifier) return undefined;

  try {
    const decoded = nip19.decode(identifier);
    switch (decoded.type) {
      case 'note':
        return `${name}:event:${decoded.data}`;
      case 'nevent':
        return `${name}:event:${decoded.data.id}`;
      case 'naddr':
        return `${name}:address:${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
      default:
        break;
    }
  } catch {
    // Keep malformed identifiers distinct and let the destination screen
    // handle its existing invalid-route behavior.
  }

  return `${name}:${identifier}`;
}
