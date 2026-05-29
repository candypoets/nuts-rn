import type {ParsedEvent, RequestObject} from '@candypoets/nipworker';
import {asKind1, asKind6, asKind7, fbArray} from '@candypoets/nipworker/utils';

export type NotificationType = 'reply' | 'reaction' | 'repost' | 'mention';

export type NotificationGroup = {
  type: NotificationType;
  referencedPostId: string;
  timestamp: number;
  events: ParsedEvent[];
  context: ParsedEvent[];
  requests: RequestObject[];
};

export type ProcessedNotification = {
  id: () => {fnv1aHash: () => string};
  type: NotificationType;
  kind: () => 383838;
  createdAt: () => number;
  timestamp: number;
  parsed: NotificationGroup;
};

function readTagVec(tag: {
  items(index: number): string | Uint8Array | null;
  itemsLength(): number;
}) {
  const items: string[] = [];
  for (let index = 0; index < tag.itemsLength(); index += 1) {
    const value = tag.items(index);
    if (typeof value === 'string') items.push(value);
  }
  return items;
}

function eventTags(event: ParsedEvent) {
  const tags: string[][] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tag = event.tags(index);
    if (tag) tags.push(readTagVec(tag));
  }
  return tags;
}

function isMention(event: ParsedEvent, pubkey: string) {
  const kind1 = asKind1(event);
  const mentions = kind1 ? fbArray(kind1, 'mentions') : [];
  if (mentions.some(mention => mention.author() === pubkey)) return true;
  return eventTags(event).some(tag => tag[0] === 'p' && tag[1] === pubkey);
}

function firstTaggedEventId(event: ParsedEvent) {
  return eventTags(event).find(tag => tag[0] === 'e' && tag[1])?.[1];
}

function eventRequests(event: ParsedEvent) {
  const eventWithRequests = event as ParsedEvent & {requests?: unknown};
  if (!eventWithRequests.requests) return [];
  try {
    return fbArray(event, 'requests') as unknown as RequestObject[];
  } catch {
    return [];
  }
}

export function processNotifications(
  feed: ParsedEvent[],
  pubkey: string,
): ProcessedNotification[] {
  const notificationGroups: Record<string, NotificationGroup> = {};

  for (const event of feed) {
    let notificationType: NotificationType | undefined;
    let referencedPostId: string | undefined;
    const kind = event.kind();

    if (kind === 1) {
      const kind1 = asKind1(event);
      if (isMention(event, pubkey)) {
        notificationType = 'mention';
        referencedPostId = `mention-${event.id()}`;
      } else if (kind1?.reply()?.id()) {
        if (kind1.quotesLength()) {
          notificationType = 'mention';
          referencedPostId = `mention-${event.id()}`;
        } else {
          notificationType = 'reply';
          referencedPostId = kind1.reply()?.id() ?? undefined;
        }
      }
    } else if (kind === 7) {
      const kind7 = asKind7(event);
      notificationType = 'reaction';
      referencedPostId = kind7?.eventId() || firstTaggedEventId(event);
    } else if (kind === 6) {
      const kind6 = asKind6(event);
      notificationType = 'repost';
      referencedPostId = kind6?.repostedEvent()?.id() || firstTaggedEventId(event);
    }

    if (!notificationType || !referencedPostId) continue;

    const groupKey = `${notificationType}-${referencedPostId}`;
    if (!notificationGroups[groupKey]) {
      notificationGroups[groupKey] = {
        type: notificationType,
        referencedPostId,
        timestamp: event.createdAt(),
        events: [],
        context: [],
        requests: eventRequests(event),
      };
    }

    if (event.createdAt() > notificationGroups[groupKey].timestamp) {
      notificationGroups[groupKey].timestamp = event.createdAt();
    }
    notificationGroups[groupKey].events.push(event);
  }

  return Object.entries(notificationGroups)
    .sort(([, left], [, right]) => right.timestamp - left.timestamp)
    .map(([groupKey, group]) => ({
      id: () => ({fnv1aHash: () => `notification-${groupKey}`}),
      type: group.type,
      kind: () => 383838,
      createdAt: () => group.timestamp,
      timestamp: group.timestamp,
      parsed: group,
    }));
}
