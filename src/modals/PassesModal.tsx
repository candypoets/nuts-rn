/**
 * PassesModal — every entitlement the member holds, across all communities
 * they belong to. The venue fast path: profile → Passes → QR in two taps.
 * Each community section owns its own subscriptions (useMyAwards), so the
 * list grows independently per relay and a slow relay never blocks the rest.
 */
import React, {memo, useEffect, useMemo} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {BadgeCheck, ChevronLeft, ChevronRight, Package, Shield, Ticket} from 'lucide-react-native';
import {useNavigation} from 'expo-router/react-navigation';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {catalogD, catalogMaxUses, catalogName, catalogRole, catalogType, type CatalogDefinitionType} from '../lib/catalog';
import {badgeStatusLabel, latestStatusValue, remainingAwardUses} from '../lib/orders';
import {awardBadgeAddress, useAwardStatuses, useMyAwards} from '../hooks/useAwards';
import {fetchRelayInfosForRelays, normalizeRelayUrl} from '../nostr/nip11';
import {communityList} from '../modals/post/shared';
import {pushDistinct} from '../navigation/pushDistinct';
import type {AppNavigationProp} from '../navigation/types';
import {useAuthStore} from '../stores/authStore';
import {useNostrStore, useRelayStore} from '../stores';
import {useAppTheme} from '../theme';

type PassesModalProps = {
  onClose: () => void;
};

function relayLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function typeIcon(type: CatalogDefinitionType | undefined) {
  if (type === 'membership') return BadgeCheck;
  if (type === 'pass' || type === 'event_access') return Ticket;
  return Package;
}

const PassRow = memo(function PassRow({
  award,
  bordered,
  definition,
  onOpen,
  statuses,
}: {
  award: ParsedEvent;
  bordered?: boolean;
  definition?: ParsedEvent;
  onOpen: (awardId: string) => void;
  statuses: ParsedEvent[];
}) {
  const theme = useAppTheme();
  const type = definition ? catalogType(definition) : undefined;
  const isRole = definition ? catalogRole(definition) : false;
  const Icon = isRole ? Shield : typeIcon(type);
  const maxUses = definition ? catalogMaxUses(definition) : undefined;
  const remaining = definition ? remainingAwardUses(award, definition, statuses) : undefined;
  const detail =
    maxUses && maxUses > 1 && remaining !== undefined
      ? `${remaining} of ${maxUses} uses left`
      : type === 'membership'
        ? 'Active membership'
        : isRole
          ? 'Active role'
          : badgeStatusLabel(latestStatusValue(award, statuses) || 'none');
  const title = definition
    ? catalogName(definition) || (isRole ? catalogD(definition) : '') || 'Entitlement'
    : 'Entitlement';
  return (
    <Pressable
      accessibilityRole="button"
      className={`flex-row items-center gap-3 p-4 ${bordered ? 'border-t border-base-200' : ''}`}
      onPress={() => onOpen(award.id() || '')}
    >
      <View className="h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-base-200">
        <Icon size={20} color={theme.colors.primary} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-black text-base-content" numberOfLines={1}>
          {title}
        </Text>
        <Text className="mt-0.5 text-xs font-semibold text-primary-content" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <ChevronRight size={18} color={theme.colors.primaryContent} />
    </Pressable>
  );
});

const CommunitySection = memo(function CommunitySection({
  relay,
  visible,
}: {
  relay: string;
  visible: boolean;
}) {
  const navigation = useNavigation<AppNavigationProp>();
  const pubkey = useAuthStore(state => state.pubkey);
  const relayInfo = useRelayStore(state => state.relayInfos[relay]?.info);
  const {awards, definitions, loading} = useMyAwards(relay, pubkey, visible);
  const awardIds = useMemo(() => awards.map(award => award.id() || '').filter(Boolean), [awards]);
  const statuses = useAwardStatuses(relay, awardIds, visible && awardIds.length > 0);

  // A community with nothing of yours simply does not render a section.
  if (!loading && !awards.length) return null;
  return (
    <View className="mt-5">
      <Text className="text-xs font-black uppercase tracking-widest text-primary" numberOfLines={1}>
        {relayInfo?.name || relayLabel(relay)}
      </Text>
      <View className="mt-2 overflow-hidden rounded-xl border border-base-200 bg-base-100">
        {loading && !awards.length ? (
          <View className="h-16 bg-base-200" />
        ) : (
          awards.map((award, index) => (
            <PassRow
              key={award.id()}
              award={award}
              bordered={index > 0}
              definition={definitions.get(awardBadgeAddress(award))}
              statuses={statuses}
              onOpen={awardId =>
                pushDistinct(navigation, 'Award', {relay, award: awardId})
              }
            />
          ))
        )}
      </View>
    </View>
  );
});

export function PassesModal({onClose}: PassesModalProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const relayRoleSets = useNostrStore(state => state.relayRoleSets);
  const communities = useMemo(
    () =>
      communityList(relayRoleSets)
        .filter(community => community.role !== 'Following')
        .map(community => community.url),
    [relayRoleSets],
  );

  useEffect(() => {
    if (communities.length) fetchRelayInfosForRelays(communities);
  }, [communities]);

  return (
    <View className="flex-1 bg-base-100">
      <View className="border-b border-base-200 bg-base-100" style={{paddingTop: insets.top}}>
        <View className="flex-row items-center gap-3 px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-9 w-9 shrink-0 items-center justify-center rounded-full"
            onPress={onClose}
          >
            <ChevronLeft size={22} color={theme.colors.primaryContent} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-black text-base-content" numberOfLines={1}>
              Passes
            </Text>
            <Text className="text-xs font-semibold text-primary-content" numberOfLines={1}>
              Your memberships, passes and tickets
            </Text>
          </View>
          <Ticket size={20} color={theme.colors.primary} />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-16 pt-2"
        showsVerticalScrollIndicator={false}
      >
        {communities.length ? (
          communities.map(relay => (
            <CommunitySection key={relay} relay={normalizeRelayUrl(relay)} visible />
          ))
        ) : (
          <View className="mt-6 items-center rounded-xl border border-dashed border-base-200 bg-base-200 p-8">
            <Ticket size={28} color={theme.colors.primary} />
            <Text className="mt-3 text-lg font-black text-base-content">Nothing yet</Text>
            <Text className="mt-1 text-center text-sm font-medium text-primary-content">
              Join a community and what you hold — memberships, passes, tickets —
              will show up here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
