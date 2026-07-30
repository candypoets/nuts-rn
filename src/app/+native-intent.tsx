import {
  resolveInviteDeepLink,
  resolveNostrDeepLink,
} from '../navigation/linking';

/**
 * Invite links, `nostr:` identifiers and njump URLs are routed manually by
 * NostrDeepLinkHandler in _layout.tsx. Returning null tells expo-router to
 * leave the URL alone — its own handling would rewrite the link to a
 * lowercase path (no matching route → Unmatched Route) and double-encode the
 * query params.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (resolveInviteDeepLink(path) || resolveNostrDeepLink(path)) return null;
  return path;
}
