import {
  Message,
  ParsedEvent as FbParsedEvent,
  WorkerMessage as FbWorkerMessage,
  type NostrEvent as RawNostrEvent,
} from '@candypoets/nipworker';
import { asPreGeneric, fbArray } from '@candypoets/nipworker/utils';
import { ByteBuffer } from 'flatbuffers';
import {
  buildHighlightEvent,
  cleanHighlightUrl,
  highlightSourceFromTags,
  noteFeedIncludesHighlights,
  parsedHighlightFromRaw,
} from '../src/nostr/highlights';

describe('NIP-84 highlights', () => {
  it('keeps highlights inside note feeds without creating a dedicated kind', () => {
    expect(noteFeedIncludesHighlights([1, 6, 1068])).toBe(true);
    expect(noteFeedIncludesHighlights([6])).toBe(true);
    expect(noteFeedIncludesHighlights([20, 22])).toBe(false);
  });

  it('adapts the raw worker event into the normal note view', () => {
    const highlightAuthor = 'cd'.repeat(32);
    const sourceAuthor = '12'.repeat(32);
    const tags = [
      ['e', 'ef'.repeat(32), 'wss://relay.example'],
      ['p', sourceAuthor, 'wss://relay.example', 'author'],
      ['context', 'Around the quote'],
    ];
    const raw = {
      content: () => 'A useful passage.',
      createdAt: () => 123,
      id: () => 'ab'.repeat(32),
      kind: () => 9802,
      pubkey: () => highlightAuthor,
      tags: (index: number) => ({
        items: (itemIndex: number) => tags[index]?.[itemIndex] ?? null,
        itemsLength: () => tags[index]?.length ?? 0,
      }),
      tagsLength: () => tags.length,
    } as unknown as RawNostrEvent;

    const parsed = parsedHighlightFromRaw(raw, ['wss://relay.example']);
    const content = parsed ? asPreGeneric(parsed)?.content() : null;

    expect(parsed?.kind()).toBe(9802);
    expect(parsed?.pubkey()).toBe(highlightAuthor);
    expect(parsed?.pubkey()).not.toBe(sourceAuthor);
    expect(content).toBe('A useful passage.');
    expect(parsed ? fbArray(parsed, 'relays') : []).toEqual([
      'wss://relay.example',
    ]);

    const backingBytes = (parsed as unknown as { bb?: { bytes_?: Uint8Array } })
      ?.bb?.bytes_;
    expect(backingBytes).toBeDefined();
    const worker = FbWorkerMessage.getRootAsWorkerMessage(
      new ByteBuffer(backingBytes as Uint8Array),
    );
    const nativeParsed = worker.content(new FbParsedEvent()) as FbParsedEvent;
    expect(worker.contentType()).toBe(Message.ParsedEvent);
    expect(nativeParsed.id()).toBe(parsed?.id());
    expect(nativeParsed.pubkey()).toBe(highlightAuthor);
  });

  it('removes common tracking parameters from source URLs', () => {
    expect(
      cleanHighlightUrl(
        'https://example.com/read?utm_source=feed&chapter=2&fbclid=abc#section',
      ),
    ).toBe('https://example.com/read?chapter=2');
  });

  it('builds an article-sourced kind 9802 event', () => {
    const event = buildHighlightEvent({
      content: '  A useful passage.  ',
      createdAt: 123,
      source: {
        address: `30023:${'ab'.repeat(32)}:story`,
        relay: 'wss://relay.example',
        author: 'cd'.repeat(32),
      },
      context: '  Surrounding paragraph  ',
    });

    expect(event).toEqual({
      kind: 9802,
      content: 'A useful passage.',
      created_at: 123,
      tags: [
        [`a`, `30023:${'ab'.repeat(32)}:story`, 'wss://relay.example'],
        ['p', 'cd'.repeat(32), 'wss://relay.example', 'author'],
        ['context', 'Surrounding paragraph'],
        ['client', 'nutsrn'],
      ],
    });
  });

  it('resolves address, event, and safe URL sources', () => {
    expect(
      highlightSourceFromTags([
        ['a', `30023:${'ab'.repeat(32)}:story`, 'wss://relay.example'],
      ]),
    ).toMatchObject({ type: 'address', label: 'Nostr article' });
    expect(
      highlightSourceFromTags([['e', 'cd'.repeat(32), 'wss://relay.example']]),
    ).toMatchObject({ type: 'event', label: 'Nostr event' });
    expect(
      highlightSourceFromTags([
        ['r', 'https://www.example.com/read', '', 'source'],
      ]),
    ).toEqual({
      type: 'url',
      url: 'https://www.example.com/read',
      label: 'example.com',
    });
    expect(
      highlightSourceFromTags([['r', ['java', 'script:alert(1)'].join('')]]),
    ).toBeUndefined();
  });
});
