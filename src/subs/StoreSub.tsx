import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import {useNavigation} from 'expo-router/react-navigation';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';
import {
  BadgeCheck,
  ChevronLeft,
  CircleAlert,
  Coffee,
  LockKeyhole,
  Package,
  ShoppingBag,
  ShoppingCart,
  Store,
  Ticket,
  Users,
} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  CATALOG_SELLABLE_TAG,
  catalogAddress,
  catalogAvailability,
  catalogBilling,
  catalogCurrency,
  catalogDescription,
  catalogImage,
  catalogMaxUses,
  catalogName,
  catalogPosition,
  catalogPrice,
  catalogPriceSats,
  catalogProductKind,
  catalogSection,
  catalogType,
  isSellableCatalogDefinition,
  isStoreCatalogDefinition,
  sellableCatalogSubscriptionId,
  upsertCatalogEvent,
} from '../lib/catalog';
import {
  COMMUNITY_PROFILE_D,
  COMMUNITY_PROFILE_KIND,
  parseCommunityProfile,
} from '../lib/communityProfile';
import {storePresetFor, type CommunityType} from '../lib/communityTypes';
import {requestCheckoutUrl} from '../lib/storeCheckout';
import {fetchRelayInfosForRelays, normalizeRelayUrl} from '../nostr/nip11';
import type {AppNavigationProp} from '../navigation/types';
import {pushDistinct} from '../navigation/pushDistinct';
import {useAuthStore} from '../stores/authStore';
import {useRelayStore} from '../stores/relayStore';
import {useAppTheme} from '../theme';

type StoreSubProps = {
  name?: string;
  onClose: () => void;
  relay: string;
  visible: boolean;
};

const CATALOG_LOAD_TIMEOUT_MS = 2500;
const SATS_NUMBER_FORMATTER = new Intl.NumberFormat();

function relayHash(relay: string) {
  return relay.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
}

function relayLabel(url: string) {
  return normalizeRelayUrl(url)
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

function compareCatalogEvents(left: ParsedEvent, right: ParsedEvent) {
  return (
    catalogPosition(left) - catalogPosition(right) ||
    catalogName(left).localeCompare(catalogName(right))
  );
}

function chunkPairs(events: ParsedEvent[]) {
  const rows: ParsedEvent[][] = [];
  for (let index = 0; index < events.length; index += 2) {
    rows.push(events.slice(index, index + 2));
  }
  return rows;
}

function formatFiatPrice(event: ParsedEvent) {
  try {
    return Number(catalogPrice(event)).toLocaleString(undefined, {
      style: 'currency',
      currency: catalogCurrency(event),
    });
  } catch {
    return `${catalogPrice(event)} ${catalogCurrency(event)}`;
  }
}

function formatSatsPrice(event: ParsedEvent) {
  const sats = catalogPriceSats(event);
  return sats ? `${SATS_NUMBER_FORMATTER.format(sats)} sats` : '';
}

function typeLabel(event: ParsedEvent) {
  const type = catalogType(event);
  if (type === 'membership') return 'Membership';
  if (type === 'pass') return 'Pass';
  const productKind = catalogProductKind(event);
  if (productKind === 'food') return 'Food';
  if (productKind === 'drink') return 'Drink';
  if (productKind === 'merchandise') return 'Merchandise';
  return 'Product';
}

function detailLabel(event: ParsedEvent) {
  if (catalogType(event) === 'membership') {
    const billing = catalogBilling(event);
    if (billing === 'monthly') return 'Billed monthly';
    if (billing === 'yearly') return 'Billed yearly';
    return 'One-time membership';
  }
  const maxUses = catalogMaxUses(event);
  if (maxUses) return `${maxUses} ${maxUses === 1 ? 'use' : 'uses'}`;
  if (catalogType(event) === 'pass') return 'Unlimited uses';
  return '';
}

function purchaseLabel(event: ParsedEvent) {
  if (catalogType(event) === 'membership') {
    return catalogBilling(event) === 'one_time' ? 'Join' : 'Subscribe';
  }
  if (catalogType(event) === 'pass') return 'Get pass';
  return 'Buy';
}

function ItemIcon({event, size}: {event: ParsedEvent; size: number}) {
  const theme = useAppTheme();
  const type = catalogType(event);
  const productKind = catalogProductKind(event);
  const Icon =
    type === 'membership'
      ? Users
      : type === 'pass'
        ? Ticket
        : productKind === 'food' || productKind === 'drink'
          ? Coffee
          : Package;
  return <Icon size={size} color={theme.colors.primary} />;
}

function ItemImage({
  event,
  className,
  iconSize,
}: {
  className: string;
  event: ParsedEvent;
  iconSize: number;
}) {
  const image = catalogImage(event);
  if (image) {
    return (
      <Image
        source={{uri: image}}
        style={styles.flex}
        contentFit="cover"
        recyclingKey={image}
        transition={120}
      />
    );
  }
  return (
    <View className={`items-center justify-center ${className}`}>
      <ItemIcon event={event} size={iconSize} />
    </View>
  );
}

function TypePill({event}: {event: ParsedEvent}) {
  return (
    <View className="self-start rounded-full bg-base-200 px-2 py-0.5">
      <Text className="text-[10px] font-black uppercase tracking-wide text-primary-content">
        {typeLabel(event)}
      </Text>
    </View>
  );
}

function PriceBlock({event, alignRight}: {alignRight?: boolean; event: ParsedEvent}) {
  return (
    <View className={alignRight ? 'items-end' : undefined}>
      <Text className="font-black text-primary">{formatFiatPrice(event)}</Text>
      {catalogPriceSats(event) ? (
        <Text className="mt-0.5 text-xs font-bold text-primary-content">
          {formatSatsPrice(event)}
        </Text>
      ) : null}
    </View>
  );
}

const BuyButton = memo(function BuyButton({
  busy,
  checkoutInFlight,
  compact,
  event,
  signedIn,
  onBuy,
  onSignIn,
}: {
  busy: boolean;
  checkoutInFlight: boolean;
  compact?: boolean;
  event: ParsedEvent;
  signedIn: boolean;
  onBuy: (event: ParsedEvent) => void;
  onSignIn: () => void;
}) {
  const iconSize = compact ? 15 : 17;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${purchaseLabel(event)} ${catalogName(event)}`}
      className={`flex-row items-center justify-center gap-2 rounded-lg bg-primary ${
        compact ? 'h-9 px-3' : 'h-11 w-full px-4'
      } ${checkoutInFlight ? 'opacity-60' : ''}`}
      disabled={checkoutInFlight}
      onPress={() => (signedIn ? onBuy(event) : onSignIn())}
    >
      {busy ? (
        <>
          <ActivityIndicator size="small" color="#ffffff" />
          <Text className={`${compact ? 'text-xs' : 'text-sm'} font-black text-white`}>
            Opening checkout…
          </Text>
        </>
      ) : !signedIn ? (
        <>
          <LockKeyhole size={iconSize} color="#ffffff" />
          <Text className={`${compact ? 'text-xs' : 'text-sm'} font-black text-white`}>
            Sign in to buy
          </Text>
        </>
      ) : (
        <>
          <ShoppingCart size={iconSize} color="#ffffff" />
          <Text className={`${compact ? 'text-xs' : 'text-sm'} font-black text-white`}>
            {purchaseLabel(event)}
          </Text>
        </>
      )}
    </Pressable>
  );
});

type ItemActionProps = {
  checkoutAddress: string;
  signedIn: boolean;
  onBuy: (event: ParsedEvent) => void;
  onSignIn: () => void;
};

const CatalogCard = memo(function CatalogCard({
  actionProps,
  event,
}: {
  actionProps: ItemActionProps;
  event: ParsedEvent;
}) {
  const theme = useAppTheme();
  const address = catalogAddress(event);
  const detail = detailLabel(event);
  const section = catalogSection(event);
  return (
    <View className="flex-1 overflow-hidden rounded-xl border border-base-200 bg-base-100">
      <View className="h-32 bg-base-200">
        <ItemImage event={event} className="bg-base-200" iconSize={32} />
        <View className="absolute left-3 top-3">
          <TypePill event={event} />
        </View>
      </View>
      <View className="flex-1 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 text-lg font-black leading-6 text-base-content">
            {catalogName(event)}
          </Text>
          <PriceBlock event={event} alignRight />
        </View>
        {catalogDescription(event) ? (
          <Text
            className="mt-2 text-sm font-medium leading-5 text-primary-content"
            numberOfLines={2}
          >
            {catalogDescription(event)}
          </Text>
        ) : null}
        <View className="mt-4 flex-row flex-wrap items-center gap-2">
          {section ? (
            <View className="rounded-full bg-base-200 px-2.5 py-1">
              <Text className="text-xs font-bold text-base-content">{section}</Text>
            </View>
          ) : null}
          {detail ? (
            <View className="flex-row items-center gap-1.5 rounded-full bg-base-200 px-2.5 py-1">
              <BadgeCheck size={13} color={theme.colors.primary} />
              <Text className="text-xs font-bold text-primary">{detail}</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-4">
          <BuyButton
            busy={actionProps.checkoutAddress === address}
            checkoutInFlight={Boolean(actionProps.checkoutAddress)}
            event={event}
            signedIn={actionProps.signedIn}
            onBuy={actionProps.onBuy}
            onSignIn={actionProps.onSignIn}
          />
        </View>
      </View>
    </View>
  );
});

const CardGrid = memo(function CardGrid({
  actionProps,
  rows,
}: {
  actionProps: ItemActionProps;
  rows: ParsedEvent[][];
}) {
  return (
    <View className="gap-3">
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row gap-3">
          {row.map(event => (
            <CatalogCard
              key={catalogAddress(event)}
              actionProps={actionProps}
              event={event}
            />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
});

const MenuRow = memo(function MenuRow({
  actionProps,
  bordered,
  event,
}: {
  actionProps: ItemActionProps;
  bordered?: boolean;
  event: ParsedEvent;
}) {
  const address = catalogAddress(event);
  return (
    <View
      className={`flex-row gap-3 p-4 ${bordered ? 'border-t border-base-200' : ''}`}
    >
      <View className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-base-200">
        <ItemImage event={event} className="bg-base-200" iconSize={25} />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-black text-base-content" numberOfLines={1}>
              {catalogName(event)}
            </Text>
            <View className="mt-1 flex-row">
              <TypePill event={event} />
            </View>
          </View>
          <PriceBlock event={event} alignRight />
        </View>
        {catalogDescription(event) ? (
          <Text
            className="mt-2 text-sm font-medium leading-5 text-primary-content"
            numberOfLines={2}
          >
            {catalogDescription(event)}
          </Text>
        ) : null}
        <View className="mt-3 flex-row justify-end">
          <View className="w-40">
            <BuyButton
              compact
              busy={actionProps.checkoutAddress === address}
              checkoutInFlight={Boolean(actionProps.checkoutAddress)}
              event={event}
              signedIn={actionProps.signedIn}
              onBuy={actionProps.onBuy}
              onSignIn={actionProps.onSignIn}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

export function StoreSub({name: nameParam, onClose, relay, visible}: StoreSubProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AppNavigationProp>();
  const normalizedRelay = useMemo(() => normalizeRelayUrl(relay), [relay]);
  const relayInfos = useRelayStore(state => state.relayInfos);
  const relayInfo = relayInfos[normalizedRelay]?.info;
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const pubkey = useAuthStore(state => state.pubkey);
  const hasSigner = useAuthStore(state => state.hasSigner);
  const signedIn = Boolean(pubkey && hasSigner);

  const [communityType, setCommunityType] = useState<CommunityType | undefined>();
  const [catalogEvents, setCatalogEvents] = useState<ParsedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [checkoutAddress, setCheckoutAddress] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const profileCreatedAtRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkoutAttemptRef = useRef(0);
  const catalogEventsRef = useRef<ParsedEvent[]>([]);

  const preset = storePresetFor(communityType);
  const communityName = nameParam || relayInfo?.name || relayLabel(normalizedRelay);
  const title = preset.presentation === 'menu' ? 'Menu' : preset.title;

  const availableEvents = useMemo(
    () =>
      catalogEvents
        .filter(
          event =>
            isStoreCatalogDefinition(event) &&
            catalogAvailability(event) === 'available',
        )
        .slice()
        .sort(compareCatalogEvents),
    [catalogEvents],
  );

  const {menuEvents, otherEvents} = useMemo(() => {
    const menu: ParsedEvent[] = [];
    const other: ParsedEvent[] = [];
    for (const event of availableEvents) {
      const productKind = catalogProductKind(event);
      if (
        catalogType(event) === 'product' &&
        (productKind === 'food' || productKind === 'drink')
      ) {
        menu.push(event);
      } else {
        other.push(event);
      }
    }
    return {menuEvents: menu, otherEvents: other};
  }, [availableEvents]);
  const menuGroups = useMemo(() => {
    const grouped = new Map<string, ParsedEvent[]>();
    for (const event of menuEvents) {
      const section = catalogSection(event) || 'Other';
      const events = grouped.get(section);
      if (events) events.push(event);
      else grouped.set(section, [event]);
    }
    return Array.from(grouped, ([section, events]) => ({section, events})).sort(
      (left, right) =>
        catalogPosition(left.events[0]) - catalogPosition(right.events[0]) ||
        left.section.localeCompare(right.section),
    );
  }, [menuEvents]);
  const catalogRows = useMemo(() => chunkPairs(availableEvents), [availableEvents]);
  const otherRows = useMemo(() => chunkPairs(otherEvents), [otherEvents]);

  useEffect(() => {
    if (visible && normalizedRelay) {
      fetchRelayInfosForRelays([normalizedRelay]);
    }
  }, [normalizedRelay, visible]);

  // Community profile (kind 30078) selects the store preset; defaults to
  // 'other' when the relay has none.
  useEffect(() => {
    if (!visible || !normalizedRelay) return undefined;

    profileCreatedAtRef.current = 0;
    setCommunityType(undefined);
    const subId = `community_store_profile_${relayHash(normalizedRelay)}`;
    setSubRelays(subId, [normalizedRelay]);
    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds: [COMMUNITY_PROFILE_KIND],
          limit: 5,
          noCache: true,
          relays: [normalizedRelay],
          tags: {'#d': [COMMUNITY_PROFILE_D]},
        },
      ],
      message => {
        const parsed = asParsedEvent(message);
        if (!parsed) return;
        const profile = parseCommunityProfile(parsed);
        if (!profile || profile.createdAt <= profileCreatedAtRef.current) return;
        profileCreatedAtRef.current = profile.createdAt;
        setCommunityType(profile.type);
      },
      {bytesPerEvent: 4 * 1024, closeOnEose: true},
    );

    return () => unsubscribe();
  }, [normalizedRelay, setSubRelays, visible]);

  // Sellable catalog (kind 30009, #t sellable) from the community relay.
  useEffect(() => {
    if (!visible || !normalizedRelay) return undefined;

    const subId = sellableCatalogSubscriptionId(normalizedRelay);
    catalogEventsRef.current = [];
    setCatalogEvents([]);
    setLoadError('');
    setLoading(true);
    setSubRelays(subId, [normalizedRelay]);
    setRelayStatus(normalizedRelay, 'SUBSCRIBED');
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      setLoading(false);
    }, CATALOG_LOAD_TIMEOUT_MS);

    const unsubscribe = subscribeToNostr(
      subId,
      [
        {
          kinds: [30009],
          limit: 500,
          noCache: true,
          relays: [normalizedRelay],
          tags: {'#t': [CATALOG_SELLABLE_TAG]},
        },
      ],
      message => {
        const status = asConnectionStatus(message);
        if (status) {
          const relayUrl = status.relayUrl();
          const relayStatus = status.status()?.toString();
          if (relayUrl && relayStatus) {
            setRelayStatus(normalizeRelayUrl(relayUrl), relayStatus);
          }
          if (relayStatus === 'EOSE') {
            setLoading(false);
            if (loadTimeoutRef.current) {
              clearTimeout(loadTimeoutRef.current);
              loadTimeoutRef.current = null;
            }
          }
          const lowered = relayStatus?.toLowerCase();
          if (
            (lowered === 'failed' || lowered === 'closed' || lowered === 'close') &&
            !catalogEventsRef.current.length
          ) {
            setLoadError('The community store could not be loaded right now.');
            setLoading(false);
          }
          return;
        }

        const event = asParsedEvent(message);
        if (!event || event.kind() !== 30009) return;
        if (isSellableCatalogDefinition(event)) {
          const next = upsertCatalogEvent(catalogEventsRef.current, event);
          catalogEventsRef.current = next;
          setCatalogEvents(next);
        }
        if (isStoreCatalogDefinition(event)) setLoading(false);
      },
      {bytesPerEvent: 12 * 1024},
    );

    return () => {
      unsubscribe();
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [normalizedRelay, setRelayStatus, setSubRelays, visible]);

  useEffect(
    () => () => {
      checkoutAttemptRef.current += 1;
    },
    [],
  );

  const startCheckout = useCallback(
    async (event: ParsedEvent) => {
      const address = catalogAddress(event);
      if (
        !address ||
        !normalizedRelay ||
        !isStoreCatalogDefinition(event) ||
        catalogAvailability(event) !== 'available'
      ) {
        setCheckoutError('This item is not currently available for checkout.');
        return;
      }

      const attempt = ++checkoutAttemptRef.current;
      setCheckoutAddress(address);
      setCheckoutError('');
      try {
        const url = await requestCheckoutUrl({
          eventAddress: address,
          relay: normalizedRelay,
        });
        if (attempt !== checkoutAttemptRef.current) return;
        await Linking.openURL(url);
      } catch (error) {
        if (attempt !== checkoutAttemptRef.current) return;
        setCheckoutError(
          error instanceof Error ? error.message : 'Checkout unavailable',
        );
      } finally {
        if (attempt === checkoutAttemptRef.current) setCheckoutAddress('');
      }
    },
    [normalizedRelay],
  );

  const openSignIn = useCallback(() => {
    pushDistinct(navigation, 'Login', undefined);
  }, [navigation]);

  const actionProps = useMemo<ItemActionProps>(
    () => ({
      checkoutAddress,
      signedIn,
      onBuy: startCheckout,
      onSignIn: openSignIn,
    }),
    [checkoutAddress, openSignIn, signedIn, startCheckout],
  );

  return (
    <View className="flex-1 bg-base-100">
      <View
        className="border-b border-base-200 bg-base-100"
        style={{paddingTop: insets.top}}
      >
        <View className="flex-row items-center gap-3 px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${communityName}`}
            className="h-9 w-9 shrink-0 items-center justify-center rounded-full"
            onPress={onClose}
          >
            <ChevronLeft size={22} color={theme.colors.primaryContent} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-black text-base-content" numberOfLines={1}>
              {title}
            </Text>
            <Text className="text-xs font-semibold text-primary-content" numberOfLines={1}>
              {communityName}
            </Text>
          </View>
          <Store size={20} color={theme.colors.primary} />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-28 pt-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1">
            <Text className="text-xs font-black uppercase tracking-widest text-primary">
              Community {preset.presentation === 'menu' ? 'menu' : 'store'}
            </Text>
            <Text className="mt-1 text-2xl font-black text-base-content">{title}</Text>
            <Text className="mt-2 text-sm font-medium leading-6 text-primary-content">
              {preset.presentation === 'menu'
                ? 'Browse food, drinks, memberships and other current offers.'
                : 'Browse the products, memberships and passes currently available.'}
            </Text>
          </View>
          <View className="h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-base-200">
            <ShoppingBag size={21} color={theme.colors.primary} />
          </View>
        </View>

        {checkoutError ? (
          <View className="mt-4 flex-row items-start gap-2 rounded-xl border border-base-200 bg-base-200 p-3">
            <CircleAlert size={18} color={theme.colors.primary} />
            <Text className="flex-1 text-sm font-bold text-base-content">
              {checkoutError}
            </Text>
          </View>
        ) : null}

        {loading && !catalogEvents.length ? (
          <View className="mt-6 gap-3">
            {[1, 2, 3].map(placeholder => (
              <View key={placeholder} className="h-24 rounded-xl bg-base-200" />
            ))}
          </View>
        ) : loadError && !availableEvents.length ? (
          <View className="mt-6 rounded-xl border border-base-200 bg-base-200 p-5">
            <Text className="text-center text-sm font-bold text-base-content">
              {loadError}
            </Text>
          </View>
        ) : !availableEvents.length ? (
          <View className="mt-6 items-center rounded-xl border border-dashed border-base-200 bg-base-200 p-8">
            <ShoppingBag size={28} color={theme.colors.primary} />
            <Text className="mt-3 text-lg font-black text-base-content">
              {preset.presentation === 'menu'
                ? 'The menu is being prepared'
                : 'No offers yet'}
            </Text>
            <Text className="mt-1 text-center text-sm font-medium text-primary-content">
              This community has not published anything available here yet.
            </Text>
          </View>
        ) : preset.presentation === 'menu' ? (
          <View className="mt-6 gap-5">
            {menuGroups.map(({section, events}) => (
              <View
                key={section}
                className="overflow-hidden rounded-xl border border-base-200 bg-base-100"
              >
                <View className="border-b border-base-200 bg-base-200 px-4 py-3">
                  <Text className="text-lg font-black text-base-content">
                    {section}
                  </Text>
                </View>
                <View>
                  {events.map((event, index) => (
                    <MenuRow
                      key={catalogAddress(event)}
                      actionProps={actionProps}
                      bordered={index > 0}
                      event={event}
                    />
                  ))}
                </View>
              </View>
            ))}

            {otherEvents.length ? (
              <View>
                <Text className="text-lg font-black text-base-content">
                  Other offers
                </Text>
                <Text className="mt-1 text-sm font-medium text-primary-content">
                  Memberships, passes and products beyond the menu.
                </Text>
                <View className="mt-3">
                  <CardGrid actionProps={actionProps} rows={otherRows} />
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View className="mt-6">
            <CardGrid actionProps={actionProps} rows={catalogRows} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    height: '100%',
    width: '100%',
  },
});
