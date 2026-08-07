/**
 * AwardModal — member entitlement detail ("Award" route).
 *
 * THESIS: the QR IS the screen. A venue-ready presentation card, not a
 * receipt page with a QR buried at the bottom — the default "detail list +
 * small code" arrangement is refused. OWN-WORLD: the app's NativeWind theme
 * (base-100 surface, primary accents, black weights) with ONE deliberate
 * theme break — a white presentation card behind the QR, because scanners
 * need contrast; it reads like a physical badge. STORY: the member sees what
 * they hold (name, community, remaining uses), proves it (QR, re-signed every
 * 60 s inside its 90 s lifetime), and tracks it (latest status per context).
 * FIRST VIEWPORT: presentation card centered at ~70% width, item name above,
 * uses/status below; tap the card for fullscreen present mode (system Back
 * exits). FORM: whole screen inside the established visual world; shaped
 * directly per docs/entitlements.md (spec-pinned, no tournament).
 */
import React, {memo, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, Pressable, ScrollView, Text, View, useWindowDimensions} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {ParsedEvent} from '@candypoets/nipworker';
import {extractTagValue} from '@candypoets/nipworker';
import {
  BadgeCheck,
  ChevronLeft,
  CircleAlert,
  Expand,
  Package,
  QrCode,
  Shield,
  Ticket,
  X,
} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  catalogD,
  catalogEventAddress,
  catalogMaxUses,
  catalogName,
  catalogRole,
  catalogType,
  type CatalogDefinitionType,
} from '../lib/catalog';
import {
  badgeStatusLabel,
  canPresentEntitlement,
  isAwardExpired,
  isBadgeStatus,
  latestStatusEvents,
  remainingAwardUses,
  presentationContextFor,
} from '../lib/orders';
import {
  PRESENTATION_REFRESH_MS,
  encodeEntitlementPresentation,
  presentationNonce,
} from '../nostr/presentation';
import {awardBadgeAddress, useAwardStatuses, useMyAwards} from '../hooks/useAwards';
import {fetchRelayInfosForRelays, normalizeRelayUrl} from '../nostr/nip11';
import {useAuthStore} from '../stores/authStore';
import {useRelayStore} from '../stores/relayStore';
import {useAppTheme} from '../theme';

type AwardModalProps = {
  awardId: string;
  onClose: () => void;
  relay: string;
};

function relayLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function typeMeta(type: CatalogDefinitionType | undefined) {
  switch (type) {
    case 'pass':
      return {Icon: Ticket, label: 'Pass'};
    case 'membership':
      return {Icon: BadgeCheck, label: 'Membership'};
    case 'event_access':
      return {Icon: Ticket, label: 'Ticket'};
    case 'product':
    default:
      return {Icon: Package, label: 'Product'};
  }
}

function formatTime(createdAt: number) {
  if (!createdAt) return '';
  const date = new Date(createdAt * 1000);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const StatusRow = memo(function StatusRow({event}: {event: ParsedEvent}) {
  const status = extractTagValue(event, 'status');
  if (!isBadgeStatus(status)) return null;
  const isFulfilled = status === 'fulfilled';
  const isCancelled = status === 'cancelled';
  return (
    <View className="flex-row items-center gap-3 border-t border-base-200 px-4 py-3">
      <View
        className={`h-2 w-2 rounded-full ${
          isFulfilled ? 'bg-primary' : isCancelled ? 'bg-base-300' : 'bg-primary opacity-40'
        }`}
      />
      <Text className="flex-1 text-sm font-bold text-base-content">
        {badgeStatusLabel(status)}
      </Text>
      <Text className="text-xs font-medium text-primary-content">
        {formatTime(event.createdAt())}
      </Text>
    </View>
  );
});

export function AwardModal({awardId, onClose, relay}: AwardModalProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const {width: windowWidth} = useWindowDimensions();
  const normalizedRelay = useMemo(() => normalizeRelayUrl(relay), [relay]);
  const pubkey = useAuthStore(state => state.pubkey);
  const relayInfo = useRelayStore(state => state.relayInfos[normalizedRelay]?.info);

  const {awards, definitions, loading} = useMyAwards(normalizedRelay, pubkey, true);
  const award = useMemo(
    () => awards.find(candidate => candidate.id() === awardId),
    [awards, awardId],
  );
  const badgeAddress = award ? awardBadgeAddress(award) : '';
  const definition = badgeAddress ? definitions.get(badgeAddress) : undefined;
  const statuses = useAwardStatuses(normalizedRelay, award ? [awardId] : [], Boolean(award));

  const [qrPayload, setQrPayload] = useState('');
  const [qrError, setQrError] = useState('');
  const [presenting, setPresenting] = useState(false);
  const signGenerationRef = useRef(0);

  useEffect(() => {
    if (normalizedRelay) fetchRelayInfosForRelays([normalizedRelay]);
  }, [normalizedRelay]);

  const type = definition ? catalogType(definition) : undefined;
  const isRole = definition ? catalogRole(definition) : false;
  const {Icon: TypeIcon, label: typeLabel} = isRole
    ? {Icon: Shield, label: 'Role'}
    : typeMeta(type);
  const itemName = definition
    ? catalogName(definition) || (isRole ? catalogD(definition) : '') || typeLabel
    : typeLabel;
  const communityName = relayInfo?.name || relayLabel(normalizedRelay);
  const maxUses = definition ? catalogMaxUses(definition) : undefined;
  const remaining =
    award && definition ? remainingAwardUses(award, definition, statuses) : undefined;
  const expired = award ? isAwardExpired(award) : false;
  const presentable =
    Boolean(award && definition) && !expired && canPresentEntitlement(award!, definition!, statuses);
  const latestStatuses = useMemo(
    () => (award ? latestStatusEvents(award, statuses) : []),
    [award, statuses],
  );

  // Sign (and keep re-signing) the presentation QR while it is presentable.
  useEffect(() => {
    if (!presentable || !award || !definition) {
      setQrPayload('');
      return undefined;
    }
    let cancelled = false;
    const refresh = async () => {
      const generation = ++signGenerationRef.current;
      try {
        const payload = await encodeEntitlementPresentation({
          awardId,
          badgeAddress,
          community: normalizedRelay,
          ...presentationContextFor(award, definition, presentationNonce),
        });
        if (!cancelled && signGenerationRef.current === generation) {
          setQrPayload(payload);
          setQrError('');
          // QA hook: lets .qa/qa-verify-event.mjs verify the signed 27236 from
          // logcat (payload format is checked derivation-side, never pixels).
          if (__DEV__) console.log('[award-qr]', payload);
        }
      } catch (error) {
        if (!cancelled && signGenerationRef.current === generation) {
          setQrError(error instanceof Error ? error.message : 'Could not create the QR.');
        }
      }
    };
    refresh();
    const interval = setInterval(refresh, PRESENTATION_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [award, awardId, badgeAddress, definition, normalizedRelay, presentable]);

  // Android system Back exits present mode instead of closing the screen.
  useEffect(() => {
    if (!presenting) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPresenting(false);
      return true;
    });
    return () => subscription.remove();
  }, [presenting]);

  const qrCardSize = Math.min(windowWidth * 0.72, 340);
  const qrSize = Math.round(qrCardSize - 56);
  const presentQrSize = Math.min(windowWidth - 56, 440);

  const usesLine = (() => {
    if (!definition) return '';
    if (maxUses && maxUses > 1 && remaining !== undefined) {
      return `${remaining} of ${maxUses} uses left`;
    }
    if (type === 'membership') return 'Active membership';
    if (isRole) return 'Active role';
    const latest = latestStatuses[0];
    const status = latest ? extractTagValue(latest, 'status') : undefined;
    return badgeStatusLabel(isBadgeStatus(status) ? status : 'none');
  })();

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
              {itemName}
            </Text>
            <Text className="text-xs font-semibold text-primary-content" numberOfLines={1}>
              {typeLabel} · {communityName}
            </Text>
          </View>
          <TypeIcon size={20} color={theme.colors.primary} />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="items-center px-4 pb-16 pt-6"
        showsVerticalScrollIndicator={false}
      >
        {loading && !award ? (
          <View className="mt-4 w-full gap-3">
            <View className="h-72 rounded-2xl bg-base-200" />
            <View className="h-12 rounded-xl bg-base-200" />
          </View>
        ) : !award ? (
          <View className="mt-4 w-full items-center rounded-xl border border-dashed border-base-200 bg-base-200 p-8">
            <CircleAlert size={28} color={theme.colors.primary} />
            <Text className="mt-3 text-lg font-black text-base-content">Not found</Text>
            <Text className="mt-1 text-center text-sm font-medium text-primary-content">
              This entitlement is not on the community relay (any more).
            </Text>
          </View>
        ) : (
          <>
            {/* Presentation card: always white — scanners need the contrast. */}
            <Pressable
              accessibilityRole={qrPayload ? 'button' : undefined}
              accessibilityLabel="Present fullscreen"
              disabled={!qrPayload}
              onPress={() => setPresenting(true)}
              className="items-center rounded-2xl bg-white p-6"
              style={{width: qrCardSize}}
            >
              {qrPayload ? (
                <QRCode value={qrPayload} size={qrSize} quietZone={8} ecl="M" />
              ) : (
                <View
                  className="items-center justify-center"
                  style={{height: qrSize, width: qrSize}}
                >
                  {presentable && !qrError ? (
                    <Text className="text-sm font-semibold text-neutral-500">
                      Preparing your code…
                    </Text>
                  ) : (
                    <View className="items-center gap-2 px-4">
                      <QrCode size={30} color="#737373" />
                      <Text className="text-center text-sm font-semibold text-neutral-500">
                        {qrError ||
                          (expired
                            ? 'Expired — no code to show.'
                            : 'Nothing left to redeem on this one.')}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              {qrPayload ? (
                <View className="mt-4 flex-row items-center gap-1.5">
                  <Expand size={13} color="#525252" />
                  <Text className="text-xs font-semibold text-neutral-600">
                    Tap to present · refreshes automatically
                  </Text>
                </View>
              ) : null}
            </Pressable>

            <Text className="mt-5 text-xl font-black text-base-content">{usesLine}</Text>

            {type === 'event_access' && definition && catalogEventAddress(definition) ? (
              <Text className="mt-1 text-sm font-medium text-primary-content">
                Show at the entrance
              </Text>
            ) : null}

            {!isRole ? (
              <View className="mt-6 w-full overflow-hidden rounded-xl border border-base-200 bg-base-100">
                <View className="border-b border-base-200 bg-base-200 px-4 py-3">
                  <Text className="text-sm font-black text-base-content">Activity</Text>
                </View>
                {latestStatuses.length ? (
                  latestStatuses.map(event => <StatusRow key={event.id()} event={event} />)
                ) : (
                  <Text className="px-4 py-5 text-center text-sm font-medium text-primary-content">
                    {type === 'product'
                      ? 'No updates yet — staff will see your order once it is placed.'
                      : 'No check-ins yet — show the QR to staff to redeem.'}
                  </Text>
                )}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {presenting && qrPayload ? (
        <View
          className="absolute inset-0 items-center justify-center bg-white"
          style={{paddingTop: insets.top, paddingBottom: insets.bottom}}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit present mode"
            className="absolute right-4 items-center justify-center rounded-full bg-neutral-100 p-2"
            style={{top: insets.top + 12}}
            onPress={() => setPresenting(false)}
          >
            <X size={22} color="#262626" />
          </Pressable>
          <Text className="mb-5 px-8 text-center text-lg font-black text-neutral-900">
            {itemName}
          </Text>
          <QRCode value={qrPayload} size={presentQrSize} quietZone={8} ecl="M" />
          <Text className="mt-5 text-sm font-semibold text-neutral-600">
            {usesLine} · {communityName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
