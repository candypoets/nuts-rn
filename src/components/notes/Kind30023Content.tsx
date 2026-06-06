import React, {memo, useMemo} from 'react';
import {Text, View} from 'react-native';
import {Image} from 'expo-image';
import type {ParsedEvent} from '@candypoets/nipworker';
import {Kind30023Parsed} from '@candypoets/nipworker';
import {ExternalLink, FileText} from 'lucide-react-native';
import {eventTags, formatTimestamp, stringValue, tagValue, tagValues} from './kindHelpers';

type Kind30023ContentProps = {
  note: ParsedEvent;
};

function getKind30023(note: ParsedEvent) {
  try {
    return note.parsed(new Kind30023Parsed()) as Kind30023Parsed | null;
  } catch {
    return null;
  }
}

function Kind30023ContentComponent({note}: Kind30023ContentProps) {
  const parsed = useMemo(() => getKind30023(note), [note]);
  const tags = useMemo(() => eventTags(note), [note]);
  const title = stringValue(parsed?.title()) || tagValue(tags, 'title');
  const summary = stringValue(parsed?.summary()) || tagValue(tags, 'summary');
  const image = stringValue(parsed?.image()) || tagValue(tags, 'image');
  const canonical =
    stringValue(parsed?.canonical()) ||
    tagValue(tags, 'canonical_url') ||
    tagValue(tags, 'url');
  const slug = stringValue(parsed?.slug()) || tagValue(tags, 'd');
  const publishedAt =
    parsed?.publishedAt() && parsed.publishedAt() !== BigInt(0)
      ? formatTimestamp(parsed.publishedAt())
      : formatTimestamp(Number(tagValue(tags, 'published_at') || 0));
  const topics = useMemo(() => {
    if (parsed) {
      return Array.from({length: parsed.topicsLength()}, (_, index) =>
        stringValue(parsed.topics(index)),
      ).filter(Boolean);
    }
    return tagValues(tags, 't');
  }, [parsed, tags]);

  if (!title && !summary && !image && !slug) {
    return (
      <View
        className="mt-2 flex-row items-center gap-2 rounded-lg bg-base-200/70 p-3"
        pointerEvents="none"
      >
        <FileText size={18} color="#158777" />
        <Text className="text-sm text-base-content">
          Article (kind 30023) - parsed data not available
        </Text>
      </View>
    );
  }

  return (
    <View
      className="mt-2 min-h-[280px] overflow-hidden rounded-lg border border-base-200 bg-base-200"
      pointerEvents="none"
    >
      {image ? (
        <Image
          source={{uri: image}}
          contentFit="cover"
          cachePolicy="memory-disk"
          style={{position: 'absolute', inset: 0}}
        />
      ) : null}
      <View
        className="absolute inset-0"
        style={{
          backgroundColor: image ? 'rgba(0,0,0,0.58)' : 'rgba(21,135,119,0.30)',
        }}
      />
      <View className="min-h-[280px] justify-between p-4">
        <View>
          <View className="mb-3 flex-row items-center gap-1">
            <FileText size={14} color="rgba(255,255,255,0.76)" />
            <Text className="text-xs text-white/75">Article</Text>
          </View>
          {title ? (
            <Text className="mb-3 text-xl font-bold leading-6 text-white" numberOfLines={3}>
              {title}
            </Text>
          ) : null}
          {summary ? (
            <Text className="text-sm leading-5 text-white/90" numberOfLines={4}>
              {summary}
            </Text>
          ) : null}
        </View>

        <View>
          <View className="border-t border-white/20 pt-3">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-xs text-white/70">{publishedAt}</Text>
              {canonical ? (
                <View className="flex-row items-center gap-1">
                  <ExternalLink size={13} color="rgba(255,255,255,0.82)" />
                  <Text className="text-xs text-white/85">Read</Text>
                </View>
              ) : null}
            </View>
          </View>
          {topics.length ? (
            <View className="mt-3 flex-row flex-wrap gap-1">
              {topics.slice(0, 5).map((topic, index) => (
                <Text
                  key={`${topic}-${index}`}
                  className="rounded-full bg-white/20 px-2 py-0.5 text-xs text-white"
                >
                  #{topic}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export const Kind30023Content = memo(Kind30023ContentComponent);
