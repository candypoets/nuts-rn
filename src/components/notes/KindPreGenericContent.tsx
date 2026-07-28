import React, {memo, useCallback, useMemo} from 'react';
import {Linking, Pressable, Text, View} from 'react-native';
import {Image} from 'expo-image';
import {useNavigation} from 'expo-router/react-navigation';
import type {ParsedEvent} from '@candypoets/nipworker';
import {asPreGeneric, fbArray} from '@candypoets/nipworker/utils';
import {Calendar, CheckCircle2, Play, Radio, Users, Video} from 'lucide-react-native';
import {neventEncode} from 'nostr-tools/nip19';
import type {AppNavigationProp} from '../../navigation/types';
import {eventTags, formatTimestamp, stringValue, tagValues} from './kindHelpers';

type KindPreGenericContentProps = {
  note: ParsedEvent;
};

function statusLabel(status: string) {
  if (status === 'live') return 'Live Now';
  if (status === 'ended') return 'Ended';
  return 'Upcoming';
}

function statusIcon(status: string) {
  if (status === 'live') return <Radio size={14} color="#ffffff" />;
  if (status === 'ended') return <CheckCircle2 size={14} color="rgba(255,255,255,0.74)" />;
  return <Calendar size={14} color="#facc15" />;
}

function KindPreGenericContentComponent({note}: KindPreGenericContentProps) {
  const navigation = useNavigation<AppNavigationProp>();
  const generic = useMemo(() => asPreGeneric(note), [note]);
  const title = stringValue(generic?.title()) || stringValue(generic?.content());
  const description = stringValue(generic?.description());
  const image = stringValue(generic?.image());
  const status = stringValue(generic?.status()) || (note.kind() === 34235 ? 'video' : 'planned');
  const streaming = stringValue(generic?.streaming());
  const recording = stringValue(generic?.recording());
  const streamUrl = status === 'live' ? streaming : recording || streaming;
  const topics = generic ? fbArray(generic, 'topics').map(topic => stringValue(topic)).filter(Boolean) : [];
  const participants = generic ? fbArray(generic, 'participants') : [];
  const hostCount = participants.filter(participant => participant.role?.() === 'Host').length;
  const speakerCount = participants.filter(participant => participant.role?.() === 'Speaker').length;
  const startsAt = generic?.starts() && generic.starts() !== BigInt(0)
    ? formatTimestamp(generic.starts())
    : '';
  const currentParticipants = generic?.currentParticipants?.() ?? BigInt(0);
  const label = note.kind() === 34235 ? 'Video' : statusLabel(status);
  const relays = useMemo(() => tagValues(eventTags(note), 'r'), [note]);
  const openLiveStream = useCallback(() => {
    const id = note.id();
    if (!id) return;
    navigation.navigate('LiveStream', {
      nevent: neventEncode({
        id,
        author: note.pubkey() || undefined,
        kind: note.kind(),
        relays,
      }),
    });
  }, [navigation, note, relays]);

  if (!generic || (!title && !streamUrl)) {
    return (
      <View className="mt-2 flex-row items-center gap-2 rounded-lg bg-base-200/70 p-3">
        {note.kind() === 34235 ? (
          <Video size={18} color="#158777" />
        ) : (
          <Radio size={18} color="#158777" />
        )}
        <Text className="text-sm text-base-content">
          {note.kind() === 34235 ? 'Video' : 'Live Event'} (kind {note.kind()})
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      className="mt-2 min-h-[220px] overflow-hidden rounded-lg border border-base-200 bg-slate-950"
      onPress={event => {
        event.stopPropagation();
        if (note.kind() === 30311) {
          openLiveStream();
        } else if (streamUrl) {
          Linking.openURL(streamUrl).catch(() => {});
        }
      }}
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
          backgroundColor: image ? 'rgba(0,0,0,0.62)' : 'rgba(15,23,42,0.96)',
        }}
      />
      {status === 'live' ? (
        <View className="absolute right-3 top-3 flex-row items-center gap-2 rounded-full bg-red-500/90 px-3 py-1">
          <View className="h-2 w-2 rounded-full bg-white" />
          <Text className="text-xs font-semibold text-white">LIVE</Text>
        </View>
      ) : null}

      <View className="min-h-[220px] justify-between p-4">
        <View>
          <View className="mb-3 flex-row flex-wrap items-center gap-2">
            <View
              className={[
                'flex-row items-center gap-1.5 rounded-full px-2.5 py-1',
                status === 'live'
                  ? 'bg-red-500/25'
                  : status === 'ended'
                    ? 'bg-white/10'
                    : 'bg-yellow-500/15',
              ].join(' ')}
            >
              {note.kind() === 34235 ? <Video size={14} color="#ffffff" /> : statusIcon(status)}
              <Text className="text-xs font-medium text-white">{label}</Text>
            </View>
            {topics[0] ? (
              <Text className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70">
                #{topics[0]}
              </Text>
            ) : null}
          </View>

          {title ? (
            <Text className="mb-2 text-lg font-bold leading-6 text-white" numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text className="mb-3 text-sm leading-5 text-white/80" numberOfLines={2}>
              {description}
            </Text>
          ) : null}

          {streamUrl ? (
            <View className="mb-3 aspect-video items-center justify-center rounded-lg bg-black/45">
              {image ? (
                <Image
                  source={{uri: image}}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  style={{position: 'absolute', inset: 0, opacity: 0.28}}
                />
              ) : null}
              <View className="h-14 w-14 items-center justify-center rounded-full bg-primary/90">
                <Play size={28} color="#ffffff" fill="#ffffff" />
              </View>
            </View>
          ) : null}
        </View>

        <View>
          {hostCount || speakerCount ? (
            <View className="mb-3 flex-row flex-wrap gap-2">
              {hostCount ? (
                <Text className="text-xs text-white/70">
                  {hostCount} host{hostCount === 1 ? '' : 's'}
                </Text>
              ) : null}
              {speakerCount ? (
                <Text className="text-xs text-white/70">
                  {speakerCount} speaker{speakerCount === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View className="flex-row items-center justify-between border-t border-white/20 pt-3">
            <View className="gap-1">
              {startsAt ? <Text className="text-xs text-white/60">{startsAt}</Text> : null}
              {currentParticipants > BigInt(0) ? (
                <View className="flex-row items-center gap-1">
                  <Users size={12} color="rgba(255,255,255,0.62)" />
                  <Text className="text-xs text-white/60">
                    {String(currentParticipants)} watching
                  </Text>
                </View>
              ) : null}
            </View>
            {streamUrl ? (
              <View className="flex-row items-center gap-1.5 rounded-full bg-primary px-4 py-2">
                <Play size={14} color="#ffffff" fill="#ffffff" />
                <Text className="text-sm font-medium text-white">
                  {status === 'ended' ? 'Replay' : note.kind() === 34235 ? 'Watch' : 'Watch'}
                </Text>
              </View>
            ) : status === 'planned' ? (
              <Text className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70">
                Starting soon
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const KindPreGenericContent = memo(KindPreGenericContentComponent);
