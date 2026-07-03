import React from 'react';
import {
  Calendar,
  FileText,
  Images,
  ListChecks,
  Newspaper,
  Repeat2,
  Video,
  type LucideIcon,
} from 'lucide-react-native';
import type {FeedKind} from '../stores';

const KIND_ICONS: Record<FeedKind, LucideIcon> = {
  1: FileText,
  6: Repeat2,
  20: Images,
  22: Video,
  1068: ListChecks,
  30023: Newspaper,
  31922: Calendar,
  31923: Calendar,
};

export function FeedKindIcon({
  kind,
  color,
  size,
  strokeWidth = 2.1,
}: {
  kind: FeedKind;
  color: string;
  size: number;
  strokeWidth?: number;
}) {
  const Icon = KIND_ICONS[kind] ?? FileText;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}
