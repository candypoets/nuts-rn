import {nip19} from 'nostr-tools';

export function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 8)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 12)}...`;
  }
}

export function shortPubkey(pubkey: string | null | undefined) {
  if (!pubkey) return 'unknown';
  return `${pubkey.slice(0, 12)}...`;
}

export function identityHue(pubkey: string): number {
  const value = parseInt(pubkey.slice(0, 6), 16);
  if (Number.isNaN(value)) return 0;
  return value % 360;
}

export function identityColor(pubkey: string): string {
  return `hsl(${identityHue(pubkey)}, 55%, 45%)`;
}

export function initials(name: string) {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
