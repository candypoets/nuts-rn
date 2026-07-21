import type { Kind0Parsed, ParsedEvent } from '@candypoets/nipworker';
import { asKind0 } from '@candypoets/nipworker/utils';
import { decode, nprofileEncode } from 'nostr-tools/nip19';

import { shortNpub } from '../../lib/identity';
import type { LocalUploadAsset } from '../../nostr/upload';
import type { RelayRoleSetSnapshot } from '../../stores';
import type { AppTheme } from '../../theme';

export type PollType = 'singlechoice' | 'multiplechoice';
export type ComposerStep = 'kind' | 'compose';
export type ComposeMode = 'note' | 'media' | 'event' | 'poll';
export type EventCategory = 'training' | 'match' | 'meeting' | 'social';
export type ComposerPanel = 'gif';
export type CommunityRole = 'Admin' | 'Member' | 'Following';
export type ComposerKindTabId = ComposeMode;
export type SelectedImage = LocalUploadAsset & {
  remote?: boolean;
  uploadUrl?: string;
  uploadTags?: string[][];
  status: 'waiting' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
};
export type UploadedImage = SelectedImage & {
  uploadUrl: string;
  uploadTags: string[][];
  status: 'uploaded';
};
export type SelectedMention = {
  name: string;
  handle: string;
  pubkey: string;
  relays: string[];
};

export const now = () => Math.floor(Date.now() / 1000);
export const fallbackProfileImage = require('../../../assets/miss-profile.png');
export const TENOR_API_KEY = 'AIzaSyB692q5nvoGphnMusHRvm1D_98a-DSQJRA';
export const TENOR_LIMIT = 24;

export function mentionHandle(value: string) {
  return value.replace(/\s+/g, '');
}

export function mentionEventName(event: ParsedEvent) {
  const kind0 = asKind0(event);
  return (
    kind0?.name?.()?.trim() ||
    kind0?.displayName?.()?.trim() ||
    event.pubkey()?.slice(0, 12) ||
    'Unknown'
  );
}

export function kind0DisplayName(kind0: Kind0Parsed, pubkey: string) {
  return (
    kind0.displayName?.()?.trim() || kind0.name?.()?.trim() || shortNpub(pubkey)
  );
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textWithNostrMentions(
  value: string,
  mentions: SelectedMention[],
) {
  let next = value;
  for (const mention of mentions) {
    const handle = mentionHandle(mention.handle);
    const nprofile = nprofileEncode({
      pubkey: mention.pubkey,
      relays: mention.relays,
    });
    next = next.replace(
      new RegExp(`@${escapeRegExp(handle)}\\b`, 'g'),
      `nostr:${nprofile}`,
    );
  }
  return next;
}

export function decodeReplyTarget(reply?: string) {
  if (!reply) return null;

  try {
    const decoded = decode(reply);
    if (decoded.type === 'nevent') {
      return {
        id: decoded.data.id,
        author: decoded.data.author,
        kind: decoded.data.kind,
        relays: decoded.data.relays ?? [],
      };
    }
  } catch {
    // Plain hex ids are accepted for internal callers and tests.
  }

  return { id: reply, relays: [] as string[] };
}

export function imetaTagFromUpload(image: SelectedImage) {
  if (!image.uploadUrl) return null;
  const tag = ['imeta', `url ${image.uploadUrl}`];
  const uploadTags = image.uploadTags || [];
  const fields = new Map(uploadTags.map(item => [item[0], item[1]]));
  const dim =
    fields.get('dim') ||
    (image.width && image.height
      ? `${Math.round(image.width)}x${Math.round(image.height)}`
      : '');
  const mimeType = fields.get('m') || image.mimeType || '';
  const sha256Hex = fields.get('x') || '';
  const alt = fields.get('alt') || image.fileName || '';

  if (mimeType) tag.push(`m ${mimeType}`);
  if (dim) tag.push(`dim ${dim}`);
  if (sha256Hex) tag.push(`x ${sha256Hex}`);
  if (alt) tag.push(`alt ${alt}`);

  return tag;
}

export function isTag(tag: string[] | null): tag is string[] {
  return Array.isArray(tag);
}

export function hasContentPart(
  value: string | undefined | null,
): value is string {
  return Boolean(value?.trim());
}

export function waitForNextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

export function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

function relaySetRole(d: string): CommunityRole {
  if (d.includes('admin')) return 'Admin';
  if (d.includes('member')) return 'Member';
  return 'Following';
}

export function communityList(roleSets: RelayRoleSetSnapshot[]) {
  const seen = new Set<string>();
  const communities: Array<{ url: string; role: CommunityRole }> = [];

  roleSets.forEach(roleSet => {
    const role = relaySetRole(roleSet.d);
    roleSet.relays.forEach(relay => {
      const url = normalizeRelayUrl(relay);
      if (!url || seen.has(url)) return;
      seen.add(url);
      communities.push({ url, role });
    });
  });

  return communities;
}

export function defaultDateTimeLocal(hoursFromNow: number) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

export function timestampFromLocal(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : now();
}

export function slugFromTitle(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `event-${Date.now()}`;
}

export const editorHtmlStyle = {
  a: { color: '#158777', textDecorationLine: 'none' as const },
  mention: {
    color: '#0f766e',
    backgroundColor: '#ccfbf1',
    textDecorationLine: 'none' as const,
  },
  code: { color: '#334155', backgroundColor: '#e2e8f0' },
  blockquote: { borderColor: '#94a3b8', borderWidth: 3, gapWidth: 10 },
};

export function readableContentColor(theme: AppTheme) {
  return theme.id === 'snowwhite' || theme.id === 'touchgrass'
    ? '#1a1a1a'
    : '#f8fafc';
}
