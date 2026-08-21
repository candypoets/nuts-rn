import type {ParsedEvent} from '@candypoets/nipworker';
import type {EventTemplate} from 'nostr-tools';

import {prepareEvent} from '../../nostr/prepareEvent';
import {eventTags} from './kindHelpers';

export function buildKind1QuickReplyEvent(
  note: ParsedEvent,
  content: string,
  relayHint = '',
): EventTemplate | null {
  const parentId = note.id();
  if (!parentId || !content.trim()) return null;

  const parentAuthor = note.pubkey() || '';
  const template: EventTemplate & {id?: string} = {
    id: parentId,
    kind: 1,
    content: content.trim(),
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...eventTags(note),
      ...(parentAuthor ? [['p', parentAuthor, relayHint]] : []),
    ],
  };

  return prepareEvent(template);
}
