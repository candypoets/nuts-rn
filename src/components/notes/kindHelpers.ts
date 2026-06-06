import type {ParsedEvent} from '@candypoets/nipworker';

export function stringValue(value: string | Uint8Array | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Array.from(value, byte => String.fromCharCode(byte)).join('');
}

export function eventTags(note: ParsedEvent) {
  const tags: string[][] = [];
  if (typeof note.tagsLength !== 'function') return tags;

  for (let tagIndex = 0; tagIndex < note.tagsLength(); tagIndex += 1) {
    const tagVec = note.tags(tagIndex);
    if (!tagVec || typeof tagVec.itemsLength !== 'function') continue;

    const tag: string[] = [];
    for (let itemIndex = 0; itemIndex < tagVec.itemsLength(); itemIndex += 1) {
      tag.push(tagVec.items(itemIndex) || '');
    }
    tags.push(tag);
  }

  return tags;
}

export function tagValue(tags: string[][], name: string) {
  return tags.find(tag => tag[0] === name)?.[1] || '';
}

export function tagValues(tags: string[][], name: string) {
  return tags
    .filter(tag => tag[0] === name)
    .map(tag => tag[1])
    .filter(Boolean);
}

export function formatTimestamp(timestamp: bigint | number | null | undefined) {
  if (!timestamp) return '';
  const seconds = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp;
  if (!seconds) return '';
  try {
    return new Date(seconds * 1000).toLocaleDateString();
  } catch {
    return '';
  }
}
