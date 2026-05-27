import React from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {Heart, MessageCircle, Repeat2, Share2, Zap} from 'lucide-react-native';

type FooterProps = {
  note: ParsedEvent;
};

function Action({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label?: string;
}) {
  return (
    <Pressable className="flex-row items-center gap-1 rounded px-1 py-1">
      {icon}
      {label ? <Text className="text-xs text-slate-500">{label}</Text> : null}
    </Pressable>
  );
}

export function Footer({note}: FooterProps) {
  const tint = '#64748b';

  return (
    <View
      accessibilityLabel={`Actions for note ${note.id() || ''}`}
      className="mt-3 flex-row items-center justify-between pl-10"
    >
      <View className="flex-row items-center gap-4">
        <Action icon={<MessageCircle size={18} color={tint} strokeWidth={2} />} />
        <Action icon={<Repeat2 size={18} color={tint} strokeWidth={2} />} />
        <Action icon={<Heart size={18} color={tint} strokeWidth={2} />} />
        <Action icon={<Share2 size={18} color={tint} strokeWidth={2} />} />
      </View>
      <Action icon={<Zap size={18} color={tint} strokeWidth={2} />} />
    </View>
  );
}
