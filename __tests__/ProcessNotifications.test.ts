import {ParsedData, type ParsedEvent} from '@candypoets/nipworker';

import {processNotifications} from '../src/notifications/processNotifications';

function kind1Event(input: {
  id: string;
  pubkey: string;
  tags: string[][];
  replyId?: string;
}): ParsedEvent {
  return {
    id: () => input.id,
    kind: () => 1,
    pubkey: () => input.pubkey,
    createdAt: () => 1,
    tagsLength: () => input.tags.length,
    tags: (tagIndex: number) => {
      const tag = input.tags[tagIndex];
      return tag
        ? {
            itemsLength: () => tag.length,
            items: (itemIndex: number) => tag[itemIndex],
          }
        : null;
    },
    parsedType: () => ParsedData.Kind1Parsed,
    parsed: () => ({
      profileMentionsLength: () => 0,
      profileMentions: () => null,
      eventRefsLength: () => 0,
      eventRefs: () => null,
      reply: () => (input.replyId ? {id: () => input.replyId} : null),
    }),
  } as unknown as ParsedEvent;
}

describe('processNotifications', () => {
  const recipient = 'a'.repeat(64);
  const author = 'b'.repeat(64);

  it('includes a p-tagged quote without a content mention', () => {
    const quote = kind1Event({
      id: 'quote-event',
      pubkey: author,
      tags: [
        ['p', recipient],
        ['q', 'quoted-event', 'wss://origin.example'],
      ],
    });

    const [notification] = processNotifications([quote], recipient);

    expect(notification.type).toBe('mention');
    expect(notification.parsed.referencedPostId).toBe('mention-quote-event');
    expect(notification.parsed.events).toEqual([quote]);
  });

  it('keeps a p-tagged NIP-10 reply classified as a reply', () => {
    const reply = kind1Event({
      id: 'reply-event',
      pubkey: author,
      tags: [['p', recipient]],
      replyId: 'parent-event',
    });

    const [notification] = processNotifications([reply], recipient);

    expect(notification.type).toBe('reply');
    expect(notification.parsed.referencedPostId).toBe('parent-event');
  });

  it('ignores a p tag for a different recipient', () => {
    const quote = kind1Event({
      id: 'other-quote',
      pubkey: author,
      tags: [
        ['p', 'c'.repeat(64)],
        ['q', 'quoted-event'],
      ],
    });

    expect(processNotifications([quote], recipient)).toEqual([]);
  });
});
