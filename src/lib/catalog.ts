import type {ParsedEvent} from '@candypoets/nipworker';
import {extractTagValue} from '@candypoets/nipworker';
import {CLASSIFIED_LISTING_KIND, ROLE_MEMBERSHIP_KIND, definitionAddress} from './nip97';

export const BADGE_DEFINITION_TYPES = [
  'role',
  'membership',
  'event_access',
  'product',
  'pass',
] as const;

export const CATALOG_DEFINITION_TYPES = ['product', 'membership', 'pass', 'event_access'] as const;

export const CATALOG_AVAILABILITIES = ['available', 'unavailable', 'archived'] as const;
export const BADGE_DEFINITION_TYPE_TOPICS = {
  role: 'role',
  membership: 'membership',
  event_access: 'ticket',
  product: 'product',
  pass: 'pass',
} as const;
export const STORE_CATALOG_TOPICS = ['membership', 'product', 'pass'] as const;
export const PRODUCT_KINDS = ['food', 'drink', 'merchandise', 'generic'] as const;
export const MEMBERSHIP_BILLING = ['one_time', 'monthly', 'yearly'] as const;

export type BadgeDefinitionType = (typeof BADGE_DEFINITION_TYPES)[number];
export type CatalogDefinitionType = (typeof CATALOG_DEFINITION_TYPES)[number];
export type CatalogAvailability = (typeof CATALOG_AVAILABILITIES)[number];
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export type MembershipBilling = (typeof MEMBERSHIP_BILLING)[number];

type CatalogDefinitionInputBase = {
  d: string;
  name: string;
  description?: string;
  image?: string;
  price: string | number;
  currency: string;
  priceSats?: number;
  section?: string;
  position?: number;
  availability?: CatalogAvailability;
};

export type ProductDefinitionInput = CatalogDefinitionInputBase & {
  type: 'product';
  productKind?: ProductKind;
};

export type MembershipDefinitionInput = CatalogDefinitionInputBase & {
  type: 'membership';
  billing?: MembershipBilling;
  stripeAccountId?: string;
};

export type PassDefinitionInput = CatalogDefinitionInputBase & {
  type: 'pass';
  maxUses?: number;
};

export type CatalogDefinitionInput =
  | ProductDefinitionInput
  | MembershipDefinitionInput
  | PassDefinitionInput;

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function positiveDecimal(value: string | undefined) {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  return Number(value) > 0 ? value : undefined;
}

function currencyCode(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function positiveInteger(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function isBadgeDefinitionType(value: unknown): value is BadgeDefinitionType {
  return includesValue(BADGE_DEFINITION_TYPES, value);
}

export function isCatalogDefinitionType(value: unknown): value is CatalogDefinitionType {
  return includesValue(CATALOG_DEFINITION_TYPES, value);
}

export function buildBadgeDefinitionClassificationTags(
  type: BadgeDefinitionType,
  _sellable: boolean,
): string[][] {
  return [['t', BADGE_DEFINITION_TYPE_TOPICS[type]]];
}

export function catalogDefinitionKind(type: CatalogDefinitionType) {
  return type === 'membership' ? ROLE_MEMBERSHIP_KIND : CLASSIFIED_LISTING_KIND;
}

export function catalogDefinitionAddress(kind: number, pubkey: string, d: string) {
  return definitionAddress(kind, pubkey, d);
}

export function sellableCatalogSubscriptionId(relay: string) {
  return `store_nip97_catalog_v3_${relay}`;
}

export function catalogDFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Catalog events stay as FlatBuffer views. These accessors materialize only the
 * individual string requested by the caller; they never project an event into a DTO.
 */
export function catalogType(event: ParsedEvent): CatalogDefinitionType | undefined {
  if (event.kind() === ROLE_MEMBERSHIP_KIND) {
    return badgeDefinitionHasTypeTopic(event, 'membership') ? 'membership' : undefined;
  }
  if (event.kind() !== CLASSIFIED_LISTING_KIND) return undefined;
  if (badgeDefinitionHasTypeTopic(event, 'product')) return 'product';
  if (badgeDefinitionHasTypeTopic(event, 'pass')) return 'pass';
  if (badgeDefinitionHasTypeTopic(event, 'event_access')) return 'event_access';
  return undefined;
}

/** Role badge definition (type role or the role topic) — not a catalog type. */
export function catalogRole(event: ParsedEvent): boolean {
  return extractTagValue(event, 'type') === 'role' || badgeDefinitionHasTypeTopic(event, 'role');
}

export function badgeDefinitionHasTypeTopic(event: ParsedEvent, type: BadgeDefinitionType) {
  const topic = BADGE_DEFINITION_TYPE_TOPICS[type];
  return (
    extractTagValue(event, 't', {
      where: tag => tag[1] === topic,
    }) === topic
  );
}

export function catalogSellable(event: ParsedEvent) {
  return extractTagValue(event, 'price') !== undefined;
}

export function catalogD(event: ParsedEvent) {
  return extractTagValue(event, 'd')?.trim() || '';
}

export function catalogAddress(event: ParsedEvent) {
  const pubkey = event.pubkey();
  const d = catalogD(event);
  return pubkey && d ? catalogDefinitionAddress(event.kind(), pubkey, d) : '';
}

export function catalogName(event: ParsedEvent) {
  const tag = event.kind() === CLASSIFIED_LISTING_KIND ? 'title' : 'name';
  return extractTagValue(event, tag)?.trim() || catalogD(event);
}

export function catalogDescription(event: ParsedEvent) {
  const tag = event.kind() === CLASSIFIED_LISTING_KIND ? 'summary' : 'description';
  return extractTagValue(event, tag)?.trim() || '';
}

export function catalogImage(event: ParsedEvent) {
  return extractTagValue(event, 'image')?.trim() || '';
}

export function catalogPrice(event: ParsedEvent) {
  return positiveDecimal(extractTagValue(event, 'price')?.trim()) || '';
}

export function catalogCurrency(event: ParsedEvent) {
  return currencyCode(extractTagValue(event, 'price', 2)) || '';
}

export function catalogSection(event: ParsedEvent) {
  return extractTagValue(event, 'section')?.trim() || '';
}

export function catalogPosition(event: ParsedEvent) {
  return nonNegativeInteger(extractTagValue(event, 'position'), 0) ?? 0;
}

export function catalogAvailability(event: ParsedEvent): CatalogAvailability | undefined {
  if (event.kind() === ROLE_MEMBERSHIP_KIND) return 'available';
  const value = extractTagValue(event, 'status');
  if (value === 'active') return 'available';
  if (value === 'sold') return 'unavailable';
  return undefined;
}

export function catalogProductKind(event: ParsedEvent): ProductKind | undefined {
  if (catalogType(event) !== 'product') return undefined;
  const value = extractTagValue(event, 'product_kind');
  if (value === undefined) return 'generic';
  return includesValue(PRODUCT_KINDS, value) ? value : undefined;
}

export function catalogUsesQrFulfillment(event: ParsedEvent) {
  const type = catalogType(event);
  if (type === 'event_access' || type === 'pass' || type === 'membership') {
    return true;
  }
  const productKind = catalogProductKind(event);
  return type === 'product' && (productKind === 'food' || productKind === 'drink');
}

export function catalogBilling(event: ParsedEvent): MembershipBilling | undefined {
  if (catalogType(event) !== 'membership') return undefined;
  const value = extractTagValue(event, 'billing');
  if (value === undefined) return 'one_time';
  return includesValue(MEMBERSHIP_BILLING, value) ? value : undefined;
}

export function catalogStripeAccountId(event: ParsedEvent) {
  return extractTagValue(event, 'stripe_account')?.trim() || '';
}

export function catalogMaxUses(event: ParsedEvent) {
  const maxUses = positiveInteger(extractTagValue(event, 'max_uses'));
  if (maxUses) return maxUses;
  return event.kind() === CLASSIFIED_LISTING_KIND ? 1 : undefined;
}

export function catalogPriceSats(event: ParsedEvent) {
  return positiveInteger(extractTagValue(event, 'price_sats'));
}

export function catalogExpiration(event: ParsedEvent) {
  return positiveInteger(extractTagValue(event, 'expiration'));
}

export function catalogEventAddress(event: ParsedEvent) {
  return extractTagValue(event, 'a') || '';
}

export function catalogEditable(event: ParsedEvent) {
  const type = catalogType(event);
  return Boolean(type && type !== 'event_access');
}

export function isCatalogDefinition(event: ParsedEvent) {
  if (
    (event.kind() !== ROLE_MEMBERSHIP_KIND && event.kind() !== CLASSIFIED_LISTING_KIND) ||
    !event.pubkey() ||
    !event.id() ||
    !catalogD(event)
  ) {
    return false;
  }
  const type = catalogType(event);
  if (!type || !catalogPrice(event) || !catalogCurrency(event) || !catalogAvailability(event)) {
    return false;
  }
  if (catalogDefinitionKind(type) !== event.kind()) return false;
  const rawPosition = extractTagValue(event, 'position');
  if (rawPosition !== undefined && nonNegativeInteger(rawPosition, 0) === undefined) {
    return false;
  }
  const rawPriceSats = extractTagValue(event, 'price_sats');
  if (rawPriceSats !== undefined && positiveInteger(rawPriceSats) === undefined) {
    return false;
  }
  const rawMaxUses = extractTagValue(event, 'max_uses');
  if (rawMaxUses !== undefined && positiveInteger(rawMaxUses) === undefined) {
    return false;
  }
  if (
    type === 'product' &&
    (!catalogProductKind(event) || (rawMaxUses !== undefined && rawMaxUses !== '1'))
  ) {
    return false;
  }
  if (type === 'membership' && (!catalogBilling(event) || rawMaxUses !== undefined)) {
    return false;
  }
  return true;
}

export function isSellableCatalogDefinition(event: ParsedEvent) {
  return catalogSellable(event) && isCatalogDefinition(event);
}

export function isStoreCatalogDefinition(event: ParsedEvent) {
  const type = catalogType(event);
  return (
    isSellableCatalogDefinition(event) &&
    (type === 'product' || type === 'membership' || type === 'pass')
  );
}

export function isSellableEventAccessDefinition(event: ParsedEvent) {
  return (
    isSellableCatalogDefinition(event) &&
    catalogType(event) === 'event_access' &&
    Boolean(catalogEventAddress(event)) &&
    catalogMaxUses(event) === 1 &&
    Boolean(catalogExpiration(event))
  );
}

export function isNewerCatalogEvent(candidate: ParsedEvent, current: ParsedEvent) {
  return (
    candidate.createdAt() > current.createdAt() ||
    (candidate.createdAt() === current.createdAt() &&
      (candidate.id() || '').localeCompare(current.id() || '') < 0)
  );
}

/**
 * The returned array is a list of FlatBuffer view references. No event fields or
 * tag trees are copied.
 */
export function upsertCatalogEvent(events: ParsedEvent[], candidate: ParsedEvent) {
  if (!isCatalogDefinition(candidate)) return events;
  const address = catalogAddress(candidate);
  const existingIndex = events.findIndex(event => catalogAddress(event) === address);
  if (existingIndex === -1) return [...events, candidate];
  if (!isNewerCatalogEvent(candidate, events[existingIndex])) return events;
  return events.map((event, index) => (index === existingIndex ? candidate : event));
}

export function buildCatalogDefinitionTags(definition: CatalogDefinitionInput): string[][] {
  const d = requireText(definition.d, 'd');
  const name = requireText(definition.name, 'name');
  const price = positiveDecimal(String(definition.price).trim());
  const currency = currencyCode(definition.currency);
  const priceSats =
    definition.priceSats === undefined ? undefined : positiveInteger(String(definition.priceSats));
  const availability = definition.availability ?? 'available';
  const position = definition.position ?? 0;

  if (!price) throw new Error('price must be a positive decimal');
  if (!currency) throw new Error('currency must be a three-letter code');
  if (definition.priceSats !== undefined && !priceSats) {
    throw new Error('sats price must be a positive integer');
  }
  if (!includesValue(CATALOG_AVAILABILITIES, availability)) {
    throw new Error('availability is invalid');
  }
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new Error('position must be a non-negative integer');
  }

  const tags: string[][] = [
    ['d', d],
    ...buildBadgeDefinitionClassificationTags(definition.type, true),
    ['price', price, currency],
    ['position', String(position)],
  ];
  if (definition.type === 'membership') {
    tags.push(['name', name]);
    tags.push(['description', definition.description?.trim() || '']);
  } else {
    tags.push(['title', name]);
    tags.push(['summary', definition.description?.trim() || '']);
    tags.push(['status', availability === 'available' ? 'active' : 'sold']);
  }
  const image = definition.image?.trim();
  const section = definition.section?.trim();
  if (priceSats) tags.push(['price_sats', String(priceSats)]);
  if (image) tags.push(['image', image]);
  if (section) tags.push(['section', section]);

  if (definition.type === 'product') {
    const productKind = definition.productKind ?? 'generic';
    if (!includesValue(PRODUCT_KINDS, productKind)) {
      throw new Error('product kind is invalid');
    }
    tags.push(['product_kind', productKind]);
    tags.push(['max_uses', '1']);
  } else if (definition.type === 'membership') {
    const billing = definition.billing ?? 'one_time';
    if (!includesValue(MEMBERSHIP_BILLING, billing)) {
      throw new Error('billing is invalid');
    }
    tags.push(['billing', billing]);
    if (definition.stripeAccountId?.trim()) {
      tags.push(['stripe_account', definition.stripeAccountId.trim()]);
    }
  } else if (definition.maxUses !== undefined) {
    if (!Number.isSafeInteger(definition.maxUses) || definition.maxUses <= 0) {
      throw new Error('max uses must be a positive integer');
    }
    tags.push(['max_uses', String(definition.maxUses)]);
  }

  return tags;
}
