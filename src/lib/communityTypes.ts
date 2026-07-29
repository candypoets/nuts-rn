export type CommunityType =
  | 'sports'
  | 'hospitality'
  | 'club'
  | 'village'
  | 'professional'
  | 'other';

export type StorePresentation = 'catalog' | 'menu';
export type StoreSuggestedDefinitionType = 'product' | 'membership' | 'pass';
export type StoreSuggestedProductKind =
  | 'food'
  | 'drink'
  | 'merchandise'
  | 'generic';

export type StorePreset = {
  /** Page title adapted to the community archetype. */
  title: string;
  /** Short explanation shown above the catalog. */
  intro: string;
  /** Vocabulary used for one catalog entry. */
  itemLabel: string;
  /** Vocabulary used for multiple catalog entries. */
  itemsLabel: string;
  /** Vocabulary used for catalog sections. */
  sectionLabel: string;
  /** Hospitality uses a section-first menu; every other archetype uses a catalog. */
  presentation: StorePresentation;
  /** Definition types shown first in the add-item flow. */
  suggestedDefinitionTypes: StoreSuggestedDefinitionType[];
  /** Product kinds shown first when adding a standard product. */
  suggestedProductKinds: StoreSuggestedProductKind[];
  /** Optional section names offered as shortcuts; custom values remain supported. */
  suggestedSections: string[];
};

export const COMMUNITY_TYPES: CommunityType[] = [
  'sports',
  'hospitality',
  'club',
  'village',
  'professional',
  'other',
];

export const DEFAULT_COMMUNITY_TYPE: CommunityType = 'other';

export const STORE_PRESETS: Record<CommunityType, StorePreset> = {
  sports: {
    title: 'Store',
    intro:
      'Manage memberships, entry passes and club merchandise in one catalog.',
    itemLabel: 'offer',
    itemsLabel: 'offers',
    sectionLabel: 'category',
    presentation: 'catalog',
    suggestedDefinitionTypes: ['membership', 'pass', 'product'],
    suggestedProductKinds: ['merchandise', 'generic'],
    suggestedSections: ['Memberships', 'Passes', 'Merchandise'],
  },
  hospitality: {
    title: 'Menu & store',
    intro:
      'Organize food, drinks and other offers into a menu your team can keep current.',
    itemLabel: 'menu item',
    itemsLabel: 'menu items',
    sectionLabel: 'menu section',
    presentation: 'menu',
    suggestedDefinitionTypes: ['product', 'membership', 'pass'],
    suggestedProductKinds: ['food', 'drink', 'merchandise', 'generic'],
    suggestedSections: ['Starters', 'Mains', 'Sides', 'Desserts', 'Drinks'],
  },
  club: {
    title: 'Store',
    intro: 'Manage membership tiers, admission passes and club merchandise.',
    itemLabel: 'offer',
    itemsLabel: 'offers',
    sectionLabel: 'category',
    presentation: 'catalog',
    suggestedDefinitionTypes: ['membership', 'pass', 'product'],
    suggestedProductKinds: ['merchandise', 'generic'],
    suggestedSections: ['Memberships', 'Admission', 'Merchandise'],
  },
  village: {
    title: 'Community store',
    intro:
      'Collect local goods, community passes and memberships in one catalog.',
    itemLabel: 'item',
    itemsLabel: 'items',
    sectionLabel: 'category',
    presentation: 'catalog',
    suggestedDefinitionTypes: ['product', 'membership', 'pass'],
    suggestedProductKinds: ['generic', 'food', 'drink', 'merchandise'],
    suggestedSections: ['Local goods', 'Food & drink', 'Workshops', 'Memberships'],
  },
  professional: {
    title: 'Store',
    intro:
      'Manage memberships, workshop passes and resources for your network.',
    itemLabel: 'offer',
    itemsLabel: 'offers',
    sectionLabel: 'category',
    presentation: 'catalog',
    suggestedDefinitionTypes: ['membership', 'pass', 'product'],
    suggestedProductKinds: ['generic', 'merchandise'],
    suggestedSections: ['Memberships', 'Workshops', 'Resources', 'Merchandise'],
  },
  other: {
    title: 'Store',
    intro: 'Manage products, memberships and reusable passes in one catalog.',
    itemLabel: 'item',
    itemsLabel: 'items',
    sectionLabel: 'category',
    presentation: 'catalog',
    suggestedDefinitionTypes: ['product', 'membership', 'pass'],
    suggestedProductKinds: ['generic', 'merchandise', 'food', 'drink'],
    suggestedSections: ['Products', 'Memberships', 'Passes'],
  },
};

export function isCommunityType(value: string | undefined): value is CommunityType {
  return Boolean(value && COMMUNITY_TYPES.includes(value as CommunityType));
}

export function storePresetFor(type: CommunityType | undefined): StorePreset {
  return (
    STORE_PRESETS[type || DEFAULT_COMMUNITY_TYPE] ||
    STORE_PRESETS[DEFAULT_COMMUNITY_TYPE]
  );
}
