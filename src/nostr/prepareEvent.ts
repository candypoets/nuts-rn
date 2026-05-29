import { nip10, nip19, type EventTemplate } from 'nostr-tools';

function uniqueTagsByValue(tags: string[][]) {
  const seen = new Set<string>();
  const result: string[][] = [];

  for (const tag of tags) {
    const key = tag[1];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

export function contentTags(text: string) {
  const profileTags: string[][] = [];
  const eventTags: string[][] = [];
  const addrTags: string[][] = [];
  const hashtagTags: string[][] = [];
  const pattern =
    /(nostr:naddr[a-zA-Z0-9:]+)|(nostr:nevent[a-zA-Z0-9:]+)|(nostr:nprofile[a-zA-Z0-9:]+)|(#(\w+))/g;

  text.replace(pattern, (match, naddr, nevent, nprofile, hashtag, tagValue) => {
    try {
      if (naddr) {
        const decoded = nip19.decode(String(naddr).replace('nostr:', ''));
        if (decoded.type === 'naddr') {
          addrTags.push([
            'a',
            `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`,
            decoded.data.relays?.[0] || '',
          ]);
        }
      } else if (nevent) {
        const decoded = nip19.decode(String(nevent).replace('nostr:', ''));
        if (decoded.type === 'nevent') {
          eventTags.push([
            'q',
            decoded.data.id,
            decoded.data.relays?.[0] || '',
          ]);
        }
      } else if (nprofile) {
        const decoded = nip19.decode(String(nprofile).replace('nostr:', ''));
        if (decoded.type === 'nprofile') {
          profileTags.push([
            'p',
            decoded.data.pubkey,
            decoded.data.relays?.[0] || '',
          ]);
        }
      } else if (hashtag) {
        hashtagTags.push(['t', tagValue]);
      }
    } catch {
      return match;
    }

    return match;
  });

  return {
    addresses: addrTags,
    events: eventTags,
    hashtags: hashtagTags,
    profiles: profileTags,
  };
}

export function prepareEvent(
  partialEvent: EventTemplate & { id?: string },
): EventTemplate {
  const refs = nip10.parse(partialEvent);
  const ctags = contentTags(partialEvent.content);
  const existingQTags = (partialEvent.tags || []).filter(tag => tag[0] === 'q');
  const existingQIds = new Set(existingQTags.map(tag => tag[1]));
  let eTags: string[][] = [];
  const qTags = [...existingQTags];
  const pTags: string[][] = [];

  if (refs.root) {
    eTags.push(['e', refs.root.id, refs.root.relays?.[0] || '', 'root']);
  }
  if (refs.reply) {
    eTags.push(['e', refs.reply.id, refs.reply.relays?.[0] || '']);
  }
  for (const mention of refs.mentions) {
    eTags.push(['e', mention.id, mention.relays?.[0] || '']);
  }
  for (const qTag of ctags.events) {
    if (!existingQIds.has(qTag[1])) qTags.push(qTag);
  }
  if (partialEvent.id) {
    if (refs.root) {
      eTags.push(['e', partialEvent.id, '', 'reply']);
    } else {
      eTags = [['e', partialEvent.id, '', 'root'], ...eTags];
    }
  }
  for (const profile of refs.profiles) {
    pTags.push(['p', profile.pubkey, profile.relays?.[0] || '']);
  }
  pTags.push(...ctags.profiles);

  return {
    ...partialEvent,
    tags: [
      ...uniqueTagsByValue(eTags),
      ...uniqueTagsByValue(qTags),
      ...uniqueTagsByValue(pTags),
      ...ctags.addresses,
      ...ctags.hashtags,
      ['client', 'nutscash'],
    ],
  };
}
