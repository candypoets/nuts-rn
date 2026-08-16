import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  MenuView,
  type MenuAction,
  type NativeActionEvent,
} from '@react-native-menu/menu';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {
  BadgeCheck,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Dumbbell,
  Globe,
  ImagePlus,
  MapPin,
  PartyPopper,
  Send,
  Ticket,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { asParsedEvent, fbArray } from '@candypoets/nipworker/utils';
import { MessageType, type WorkerMessage } from '@candypoets/nipworker';

import { type AppTheme, useAppTheme } from '../../theme';
import { subscribeUntilEose } from '../../nostr/subscribeUntilEose';
import {
  type EventCategory,
  type SelectedImage,
  readableContentColor,
} from './shared';

const CATEGORY_META: Record<
  EventCategory,
  { icon: LucideIcon; label: string; accent: string }
> = {
  training: { icon: Dumbbell, label: 'Training', accent: '#10b981' },
  match: { icon: Trophy, label: 'Match', accent: '#f59e0b' },
  meeting: { icon: Users, label: 'Meeting', accent: '#3b82f6' },
  social: {
    icon: PartyPopper,
    label: 'Community meetup',
    accent: '#ec4899',
  },
};

const EVENT_CATEGORIES = Object.keys(CATEGORY_META) as EventCategory[];
const DURATION_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '1h 30', minutes: 90 },
  { label: '2h', minutes: 120 },
];

const WIZARD_STEPS = [
  {
    label: 'Basics',
    title: 'Tell people what’s happening',
    subtitle: 'Start with the essentials. You can refine everything later.',
  },
  {
    label: 'Schedule',
    title: 'When and where?',
    subtitle: 'Set the timing, venue and attendance limit.',
  },
  {
    label: 'Access',
    title: 'Access & pricing',
    subtitle: 'Choose who attends free and set a public ticket price.',
  },
  {
    label: 'Review',
    title: 'Ready to publish?',
    subtitle: 'Check what guests will see before your event goes live.',
  },
] as const;

const EVENT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'CHF ',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function splitDateTime(value: string) {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

function joinDateTime(date: string, time: string) {
  return time ? `${date}T${time}` : date;
}

function parseDateTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isoDate(date: Date) {
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
  ].join('');
}

function startOfLocalDay(date: Date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function clockTime(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDay(date: Date) {
  return `${WEEKDAYS[date.getDay()]}, ${
    MONTHS[date.getMonth()]
  } ${date.getDate()}`;
}

function formatDayLong(date: Date) {
  return `${formatDay(date)}, ${date.getFullYear()}`;
}

function formatClock(date: Date) {
  const hours = date.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hour12}:${minutes} ${suffix}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

type FieldStyles = {
  fieldGroup: StyleProp<ViewStyle>;
  fieldLabel: StyleProp<TextStyle>;
  fieldInputWrap: StyleProp<ViewStyle>;
  fieldInput: StyleProp<TextStyle>;
  fieldIcon: StyleProp<ViewStyle>;
};

function LabeledField({
  accessibilityLabel,
  icon: Icon,
  inputStyle,
  label,
  multiline,
  placeholder,
  placeholderTextColor,
  style,
  styles,
  value,
  ...inputProps
}: {
  accessibilityLabel: string;
  icon?: LucideIcon;
  inputStyle?: StyleProp<TextStyle>;
  label: string;
  multiline?: boolean;
  placeholder: string;
  placeholderTextColor: string;
  style?: StyleProp<ViewStyle>;
  styles: FieldStyles;
  value: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  maxLength?: number;
}) {
  return (
    <View style={[styles.fieldGroup, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        {Icon ? (
          <Icon
            size={16}
            color={placeholderTextColor}
            strokeWidth={2}
            style={styles.fieldIcon}
          />
        ) : null}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
          multiline={multiline}
          style={[styles.fieldInput, inputStyle]}
          {...inputProps}
        />
      </View>
    </View>
  );
}

type PickerTarget = 'date' | 'start' | 'end';

type BadgeDefinition = {
  address: string;
  name: string;
};

function useCommunityBadges(relays: string[], enabled: boolean) {
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const relayKey = relays.join('|');

  useEffect(() => {
    const requestedRelays = relayKey ? relayKey.split('|') : [];
    if (!requestedRelays.length || !enabled) {
      setBadges([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const collected = new Map<string, BadgeDefinition>();
    const flush = () =>
      setBadges(
        [...collected.values()].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      );

    return subscribeUntilEose(
      `event_badges_${relayKey}`,
      [
        {
          kinds: [30009],
          limit: 100,
          relays: requestedRelays,
          cacheFirst: true,
        },
      ],
      (message: WorkerMessage) => {
        if (message.type() === MessageType.ConnectionStatus) {
          setLoading(false);
          return;
        }
        const event = asParsedEvent(message);
        if (!event || event.kind?.() !== 30009) return;
        const tags = fbArray(event, 'tags').map(tag =>
          fbArray(tag, 'items').map(item => String(item)),
        );
        const d = tags.find(tag => tag[0] === 'd')?.[1];
        const eventPubkey = event.pubkey?.();
        if (!d || !eventPubkey) return;
        const name = tags.find(tag => tag[0] === 'name')?.[1] || d;
        collected.set(`30009:${eventPubkey}:${d}`, {
          address: `30009:${eventPubkey}:${d}`,
          name,
        });
        flush();
      },
    );
  }, [relayKey, enabled]);

  return { badges, loading };
}

export type EventCommunityOption = {
  role: string;
  url: string;
};

export type NostrEventCreationProps = {
  access: 'everyone' | 'selected';
  badges: string[];
  canPublish: boolean;
  capacity: string;
  category: EventCategory;
  communities: EventCommunityOption[];
  communityRelays: string[];
  cover: SelectedImage | null;
  currency: string;
  endsAt: string;
  isPublishing: boolean;
  location: string;
  onBack: () => void;
  onChangeAccess: (value: 'everyone' | 'selected') => void;
  onChangeCapacity: (value: string) => void;
  onChangeCategory: (value: EventCategory) => void;
  onChangeCommunityRelays: (value: string[]) => void;
  onChangeCover: (value: SelectedImage | null) => void;
  onChangeCurrency: (value: string) => void;
  onChangeEndsAt: (value: string) => void;
  onChangeLocation: (value: string) => void;
  onChangePaid: (value: boolean) => void;
  onChangePrice: (value: string) => void;
  onChangeSats: (value: string) => void;
  onChangeStartsAt: (value: string) => void;
  onChangeSummary: (value: string) => void;
  onChangeTitle: (value: string) => void;
  onClose: () => void;
  onPublish: () => void;
  onToggleBadge: (address: string) => void;
  paid: boolean;
  price: string;
  publishLabel: string;
  sats: string;
  startsAt: string;
  summary: string;
  title: string;
};

function relayDisplayName(relay: string) {
  if (!relay) return 'Public event';
  return relay
    .replace(/^wss?:\/\//, '')
    .replace(/^relay\./, '')
    .replace(/\/$/, '');
}

export function NostrEventCreation({
  access,
  badges: selectedBadges,
  canPublish,
  capacity,
  category,
  communities,
  communityRelays,
  cover,
  currency,
  endsAt,
  isPublishing,
  location,
  onBack,
  onChangeAccess,
  onChangeCapacity,
  onChangeCategory,
  onChangeCommunityRelays,
  onChangeCover,
  onChangeCurrency,
  onChangeEndsAt,
  onChangeLocation,
  onChangePaid,
  onChangePrice,
  onChangeSats,
  onChangeStartsAt,
  onChangeSummary,
  onChangeTitle,
  onClose,
  onPublish,
  onToggleBadge,
  paid,
  price,
  publishLabel,
  sats,
  startsAt,
  summary,
  title,
}: NostrEventCreationProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const contentColor = readableContentColor(theme);
  const placeholderColor = theme.colors.primaryContent;
  const CategoryIcon = CATEGORY_META[category].icon;

  const [step, setStep] = useState(0);
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);
  const [minimumEventDate] = useState(() => startOfLocalDay(new Date()));
  const { badges: communityBadges, loading: badgesLoading } =
    useCommunityBadges(communityRelays, access === 'selected');
  const selectedCommunitySet = useMemo(
    () => new Set(communityRelays),
    [communityRelays],
  );
  const audienceLabel = !communityRelays.length
    ? 'Public event'
    : communityRelays.length === 1
    ? relayDisplayName(communityRelays[0])
    : `${communityRelays.length} communities`;
  const toggleCommunity = useCallback(
    (relay: string) => {
      onChangeCommunityRelays(
        selectedCommunitySet.has(relay)
          ? communityRelays.filter(item => item !== relay)
          : [...communityRelays, relay],
      );
    },
    [communityRelays, onChangeCommunityRelays, selectedCommunitySet],
  );
  const categoryActions = useMemo<MenuAction[]>(
    () =>
      EVENT_CATEGORIES.map(item => ({
        id: item,
        title: CATEGORY_META[item].label,
        state: (category === item ? 'on' : 'off') as 'on' | 'off',
      })),
    [category],
  );
  const onCategoryAction = useCallback(
    ({ nativeEvent }: NativeActionEvent) => {
      const selected = nativeEvent.event as EventCategory;
      if (EVENT_CATEGORIES.includes(selected)) onChangeCategory(selected);
    },
    [onChangeCategory],
  );

  const { date, time: startTime } = splitDateTime(startsAt);
  const { time: endTime } = splitDateTime(endsAt);
  const start = parseDateTime(date, startTime);
  const end = parseDateTime(date, endTime);
  const startInPast = Boolean(start && start.getTime() <= Date.now());
  const endNotAfterStart = Boolean(start && end && end <= start);
  const scheduleInvalid = startInPast || endNotAfterStart;
  const activeDuration =
    start && end && !endNotAfterStart
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : null;

  const changeDate = (value: string) => {
    onChangeStartsAt(joinDateTime(value, startTime));
    if (endTime) onChangeEndsAt(joinDateTime(value, endTime));
  };
  const changeStartTime = (value: string) => {
    onChangeStartsAt(joinDateTime(date, value));
  };
  const changeEndTime = (value: string) => {
    onChangeEndsAt(joinDateTime(date, value));
  };
  const applyDuration = (minutes: number) => {
    if (!start) return;
    const nextEnd = new Date(start.getTime() + minutes * 60000);
    if (nextEnd.getDate() !== start.getDate()) return;
    changeEndTime(clockTime(nextEnd));
  };

  const fallbackPickerDate = useMemo(() => {
    const base = start || new Date();
    if (activePicker === 'end') {
      return end || new Date(base.getTime() + 60 * 60000);
    }
    return base;
  }, [activePicker, end, start]);
  const pickerDate =
    activePicker === 'date' &&
    startOfLocalDay(fallbackPickerDate) < minimumEventDate
      ? minimumEventDate
      : fallbackPickerDate;

  const commitPicker = (target: PickerTarget, value: Date) => {
    if (target === 'date') {
      if (startOfLocalDay(value) < minimumEventDate) return;
      changeDate(isoDate(value));
    }
    if (target === 'start') changeStartTime(clockTime(value));
    if (target === 'end') changeEndTime(clockTime(value));
  };

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') {
      setActivePicker(null);
      if (event.type !== 'set' || !value || !activePicker) return;
      commitPicker(activePicker, value);
      return;
    }
    if (value && activePicker) commitPicker(activePicker, value);
  };

  const pickCover = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled) return;
    const [asset] = result.assets;
    if (!asset?.uri) return;
    onChangeCover({
      uri: asset.uri,
      width: Math.max(1, Math.round(asset.width || 640)),
      height: Math.max(1, Math.round(asset.height || 360)),
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      status: 'waiting',
    });
  }, [onChangeCover]);

  const scheduleSummary = startInPast
    ? 'Start time must be in the future.'
    : endNotAfterStart
    ? 'End time must be later than start time.'
    : start
    ? `${formatDay(start)} · ${formatClock(start)}${
        end ? `–${formatClock(end)}` : ''
      }`
    : '';

  const selectedBadgeSet = useMemo(
    () => new Set(selectedBadges),
    [selectedBadges],
  );
  const selectedBadgeNames = useMemo(() => {
    const names: string[] = [];
    for (const badge of communityBadges) {
      if (selectedBadgeSet.has(badge.address)) names.push(badge.name);
    }
    return names;
  }, [communityBadges, selectedBadgeSet]);
  const priceValue = Number(price);
  const admissionSummary = (() => {
    if (access === 'everyone') return 'Everyone enters free.';
    if (!selectedBadges.length) return 'Select at least one member group.';
    const freeList = selectedBadgeNames.length
      ? selectedBadgeNames.join(', ')
      : `${selectedBadges.length} member group${
          selectedBadges.length === 1 ? '' : 's'
        }`;
    if (paid && !(priceValue > 0)) return 'Enter a public ticket price.';
    if (paid) {
      return `${freeList} enter free; others pay ${
        CURRENCY_SYMBOL[currency] || ''
      }${price}.`;
    }
    return `${freeList} enter free.`;
  })();
  const admissionInvalid = access === 'selected' && !selectedBadges.length;
  const pricingInvalid = paid && !(priceValue > 0);
  const accessComplete =
    !communityRelays.length ||
    access === 'everyone' ||
    (selectedBadges.length > 0 && !pricingInvalid);
  const eventCanPublish = canPublish && !scheduleInvalid;

  const canContinue = (() => {
    if (step === 0) return Boolean(title.trim());
    if (step === 1) return Boolean(start && !scheduleInvalid);
    if (step === 2) return accessComplete;
    return eventCanPublish;
  })();
  const goBack = () => {
    setActivePicker(null);
    setStep(current => Math.max(0, current - 1));
  };
  const goNext = () => {
    setActivePicker(null);
    setStep(current => Math.min(WIZARD_STEPS.length - 1, current + 1));
  };

  const handleHardwareBack = useEffectEvent(() => {
    Keyboard.dismiss();
    if (step > 0) goBack();
    else onBack();
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleHardwareBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, []);

  const pickerField = (
    target: PickerTarget,
    label: string,
    icon: LucideIcon,
    display: string,
    placeholder: string,
    accessibilityLabel: string,
    fieldStyle?: StyleProp<ViewStyle>,
  ) => {
    const Icon = icon;
    const open = activePicker === target;
    return (
      <View style={[styles.fieldGroup, fieldStyle]}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={[styles.fieldInputWrap, open && styles.pickerFieldActive]}
          onPress={() => setActivePicker(open ? null : target)}
        >
          <Icon
            size={16}
            color={placeholderColor}
            strokeWidth={2}
            style={styles.fieldIcon}
          />
          <Text
            style={[
              styles.pickerFieldText,
              !display && styles.pickerFieldPlaceholder,
            ]}
          >
            {display || placeholder}
          </Text>
          <ChevronDown size={14} color={placeholderColor} strokeWidth={2.2} />
        </Pressable>
      </View>
    );
  };

  const banner = (invalid: boolean, text: string) => (
    <View
      style={[
        styles.scheduleBanner,
        invalid ? styles.bannerInvalid : styles.bannerValid,
      ]}
    >
      {invalid ? (
        <CircleAlert size={15} color={theme.colors.error} strokeWidth={2.2} />
      ) : (
        <CircleCheck size={15} color={theme.colors.success} strokeWidth={2.2} />
      )}
      <Text
        style={[
          styles.bannerText,
          invalid ? styles.bannerTextInvalid : styles.bannerTextValid,
        ]}
      >
        {text}
      </Text>
    </View>
  );

  return (
    <View style={styles.eventScreen}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to post types"
          accessibilityRole="button"
          hitSlop={8}
          style={styles.topBackButton}
          onPress={onBack}
        >
          <ChevronLeft size={25} color={contentColor} strokeWidth={2.5} />
        </Pressable>
        <Text style={styles.topBarTitle}>Create event</Text>
        <Pressable
          accessibilityLabel="Close event creator"
          accessibilityRole="button"
          hitSlop={8}
          style={styles.closeButton}
          onPress={onClose}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.stepper}>
        {WIZARD_STEPS.map((item, index) => {
          const complete = index < step;
          const active = index === step;
          return (
            <React.Fragment key={item.label}>
              <Pressable
                accessibilityLabel={`${item.label} step`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                disabled={index > step}
                style={styles.stepperItem}
                onPress={() => {
                  setActivePicker(null);
                  setStep(index);
                }}
              >
                <View
                  style={[
                    styles.stepCircle,
                    active && styles.stepCircleActive,
                    complete && styles.stepCircleComplete,
                  ]}
                >
                  {complete ? (
                    <Check size={15} color="#fff" strokeWidth={2.8} />
                  ) : (
                    <Text
                      style={[
                        styles.stepNumber,
                        active && styles.stepNumberActive,
                      ]}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[styles.stepLabel, active && styles.stepLabelActive]}
                >
                  {item.label}
                </Text>
              </Pressable>
              {index < WIZARD_STEPS.length - 1 ? (
                <View
                  style={[
                    styles.stepLine,
                    index < step && styles.stepLineComplete,
                  ]}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.wizardHeader}>
          <Text style={styles.stepTitle}>{WIZARD_STEPS[step].title}</Text>
          <Text style={styles.stepSubtitle}>{WIZARD_STEPS[step].subtitle}</Text>
        </View>

        <View style={styles.eventBox}>
          {step === 0 ? (
            <View style={styles.stepBody}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Cover photo</Text>
                <Pressable
                  accessibilityLabel={
                    cover ? 'Change cover image' : 'Add cover image'
                  }
                  accessibilityRole="button"
                  style={styles.coverHero}
                  onPress={pickCover}
                >
                  {cover ? (
                    <Image
                      source={{ uri: cover.uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      collapsable={false}
                      pointerEvents="none"
                      style={styles.coverBackdrop}
                    >
                      <View style={styles.coverSun} />
                      <View style={styles.coverHillBack} />
                      <View style={styles.coverHillFront} />
                    </View>
                  )}
                  <View style={styles.coverAction}>
                    <ImagePlus size={21} color="#fff" strokeWidth={2.1} />
                    <Text style={styles.coverActionText}>
                      {cover ? 'Change cover photo' : 'Add cover photo'}
                    </Text>
                  </View>
                  <Text style={styles.coverRecommendation}>
                    Recommended 1600 × 900
                  </Text>
                  {cover ? (
                    <Pressable
                      accessibilityLabel="Remove cover image"
                      accessibilityRole="button"
                      hitSlop={10}
                      style={styles.coverHeroRemove}
                      onPress={() => onChangeCover(null)}
                    >
                      <X size={16} color="#fff" strokeWidth={2.5} />
                    </Pressable>
                  ) : null}
                </Pressable>
              </View>
              <LabeledField
                accessibilityLabel="Event title"
                label="Event name"
                onChangeText={onChangeTitle}
                placeholder="Summer rooftop social"
                placeholderTextColor={placeholderColor}
                styles={styles}
                value={title}
              />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Category</Text>
                <MenuView
                  title="Event category"
                  actions={categoryActions}
                  onPressAction={onCategoryAction}
                >
                  <View
                    accessibilityLabel={`Category ${CATEGORY_META[category].label}`}
                    accessibilityRole="button"
                    style={styles.categoryField}
                  >
                    <CategoryIcon
                      size={19}
                      color={theme.colors.primary}
                      strokeWidth={2.2}
                    />
                    <Text style={styles.categoryFieldText}>
                      {CATEGORY_META[category].label}
                    </Text>
                    <ChevronRight
                      size={19}
                      color={theme.colors.primaryContent}
                      strokeWidth={2.2}
                    />
                  </View>
                </MenuView>
              </View>
              <LabeledField
                accessibilityLabel="Event summary"
                label="Description"
                multiline
                onChangeText={onChangeSummary}
                placeholder="What members should know before attending."
                placeholderTextColor={placeholderColor}
                inputStyle={styles.summaryInput}
                styles={styles}
                value={summary}
              />
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.stepBody}>
              {pickerField(
                'date',
                'Date',
                Calendar,
                start
                  ? formatDayLong(start)
                  : date
                  ? formatDayLong(
                      parseDateTime(date, '00:00') || new Date(date),
                    )
                  : '',
                'Pick a date',
                'Event date',
              )}
              <View style={styles.eventTwoColumn}>
                {pickerField(
                  'start',
                  'Starts',
                  Clock,
                  start ? formatClock(start) : '',
                  '18:00',
                  'Event start time',
                  styles.eventHalfField,
                )}
                {pickerField(
                  'end',
                  'Ends',
                  Clock,
                  end ? formatClock(end) : '',
                  '20:00',
                  'Event end time',
                  styles.eventHalfField,
                )}
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Duration</Text>
                <View style={styles.durationRow}>
                  {DURATION_PRESETS.map(preset => {
                    const active = activeDuration === preset.minutes;
                    return (
                      <Pressable
                        key={preset.minutes}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Duration ${preset.label}`}
                        disabled={!start}
                        style={[
                          styles.durationChip,
                          active && styles.durationChipActive,
                          !start && styles.durationChipDisabled,
                        ]}
                        onPress={() => applyDuration(preset.minutes)}
                      >
                        <Text
                          style={[
                            styles.durationText,
                            active && styles.durationTextActive,
                          ]}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {scheduleSummary
                ? banner(scheduleInvalid, scheduleSummary)
                : null}
              <View style={styles.eventTwoColumn}>
                <LabeledField
                  accessibilityLabel="Event location"
                  icon={MapPin}
                  label="Location"
                  onChangeText={onChangeLocation}
                  placeholder="Club field"
                  placeholderTextColor={placeholderColor}
                  style={styles.eventLocationField}
                  styles={styles}
                  value={location}
                />
                <LabeledField
                  accessibilityLabel="Event capacity"
                  icon={Users}
                  keyboardType="number-pad"
                  label="Capacity"
                  onChangeText={onChangeCapacity}
                  placeholder="24"
                  placeholderTextColor={placeholderColor}
                  style={styles.eventCapacityField}
                  styles={styles}
                  value={capacity}
                />
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stepBody}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Target audience</Text>
                <Text style={styles.fieldHint}>
                  Publish publicly or choose one or more communities.
                </Text>
                <View style={styles.audienceList}>
                  <Pressable
                    accessibilityLabel="Public"
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: communityRelays.length === 0,
                    }}
                    style={[
                      styles.audienceCard,
                      !communityRelays.length && styles.audienceCardActive,
                    ]}
                    onPress={() => onChangeCommunityRelays([])}
                  >
                    <View
                      style={[
                        styles.audienceIcon,
                        !communityRelays.length && styles.audienceIconActive,
                      ]}
                    >
                      <Globe
                        size={19}
                        color={
                          !communityRelays.length
                            ? theme.button.primary.text
                            : theme.colors.primary
                        }
                        strokeWidth={2.2}
                      />
                    </View>
                    <View style={styles.audienceCopy}>
                      <Text style={styles.audienceTitle}>Public</Text>
                      <Text style={styles.audienceDescription}>
                        Anyone can discover and attend this event.
                      </Text>
                    </View>
                    {!communityRelays.length ? (
                      <CircleCheck
                        size={19}
                        color={theme.colors.primary}
                        strokeWidth={2.4}
                      />
                    ) : null}
                  </Pressable>
                  {communities.map(community => {
                    const active = selectedCommunitySet.has(community.url);
                    return (
                      <Pressable
                        key={community.url}
                        accessibilityLabel={`Community ${relayDisplayName(
                          community.url,
                        )}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.audienceCard,
                          active && styles.audienceCardActive,
                        ]}
                        onPress={() => toggleCommunity(community.url)}
                      >
                        <View
                          style={[
                            styles.audienceIcon,
                            active && styles.audienceIconActive,
                          ]}
                        >
                          <Users
                            size={19}
                            color={
                              active
                                ? theme.button.primary.text
                                : theme.colors.primary
                            }
                            strokeWidth={2.2}
                          />
                        </View>
                        <View style={styles.audienceCopy}>
                          <Text style={styles.audienceTitle} numberOfLines={1}>
                            {relayDisplayName(community.url)}
                          </Text>
                          <Text style={styles.audienceDescription}>
                            {community.role}
                          </Text>
                        </View>
                        {active ? (
                          <CircleCheck
                            size={19}
                            color={theme.colors.primary}
                            strokeWidth={2.4}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.divider} />

              {communityRelays.length ? (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Who enters free?</Text>
                    <View style={styles.accessRow}>
                      {[
                        {
                          id: 'everyone' as const,
                          icon: Globe,
                          title: 'Everyone',
                          description: 'Open and free event.',
                        },
                        {
                          id: 'selected' as const,
                          icon: BadgeCheck,
                          title: 'Selected groups',
                          description: 'Closed unless entrance is purchased.',
                        },
                      ].map(option => {
                        const active = access === option.id;
                        const OptionIcon = option.icon;
                        return (
                          <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`${option.title}. ${option.description}`}
                            style={[
                              styles.accessCard,
                              active && styles.accessCardActive,
                            ]}
                            onPress={() => onChangeAccess(option.id)}
                          >
                            <View
                              style={[
                                styles.accessIconChip,
                                active && styles.accessIconChipActive,
                              ]}
                            >
                              <OptionIcon
                                size={16}
                                color={
                                  active
                                    ? theme.button.primary.text
                                    : theme.colors.primary
                                }
                                strokeWidth={2.2}
                              />
                            </View>
                            <Text
                              style={[
                                styles.accessTitle,
                                active && styles.accessTitleActive,
                              ]}
                            >
                              {option.title}
                            </Text>
                            <Text style={styles.accessDescription}>
                              {option.description}
                            </Text>
                            {active ? (
                              <View style={styles.accessCheck}>
                                <CircleCheck
                                  size={16}
                                  color={theme.colors.primary}
                                  strokeWidth={2.4}
                                />
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {access === 'selected' ? (
                    <>
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Free member groups
                        </Text>
                        {badgesLoading && !communityBadges.length ? (
                          <View style={styles.badgeStateRow}>
                            <ActivityIndicator
                              size="small"
                              color={theme.colors.primary}
                            />
                            <Text style={styles.badgeStateText}>
                              Loading member groups...
                            </Text>
                          </View>
                        ) : communityBadges.length ? (
                          <View style={styles.badgeGrid}>
                            {communityBadges.map(badge => {
                              const active = selectedBadgeSet.has(
                                badge.address,
                              );
                              return (
                                <Pressable
                                  key={badge.address}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: active }}
                                  accessibilityLabel={`Member group ${badge.name}`}
                                  style={[
                                    styles.badgeChip,
                                    active && styles.badgeChipActive,
                                  ]}
                                  onPress={() => onToggleBadge(badge.address)}
                                >
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.badgeChipText,
                                      active && styles.badgeChipTextActive,
                                    ]}
                                  >
                                    {badge.name}
                                  </Text>
                                  {active ? (
                                    <CircleCheck
                                      size={14}
                                      color={theme.button.primary.text}
                                      strokeWidth={2.4}
                                    />
                                  ) : null}
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : (
                          <View style={styles.badgeStateRow}>
                            <Text style={styles.badgeStateText}>
                              No eligible member groups are available yet.
                            </Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.divider} />

                      <View style={styles.paidRow}>
                        <View style={styles.paidCopy}>
                          <Text style={styles.paidTitle}>
                            Let others buy entrance
                          </Text>
                          <Text style={styles.paidDescription}>
                            People outside these groups can purchase a ticket.
                          </Text>
                        </View>
                        <Switch
                          accessibilityLabel="Let others buy entrance"
                          value={paid}
                          onValueChange={onChangePaid}
                          trackColor={{
                            false: theme.colors.base200,
                            true: theme.colors.primary,
                          }}
                        />
                      </View>

                      {paid ? (
                        <View style={styles.paidBox}>
                          <View style={styles.eventTwoColumn}>
                            <LabeledField
                              accessibilityLabel="Entrance price"
                              keyboardType="decimal-pad"
                              label="Price"
                              onChangeText={onChangePrice}
                              placeholder="15"
                              placeholderTextColor={placeholderColor}
                              style={styles.eventHalfField}
                              styles={styles}
                              value={price}
                            />
                            <View
                              style={[styles.fieldGroup, styles.eventHalfField]}
                            >
                              <Text style={styles.fieldLabel}>Currency</Text>
                              <View style={styles.currencyRow}>
                                {EVENT_CURRENCIES.map(item => {
                                  const active = currency === item;
                                  return (
                                    <Pressable
                                      key={item}
                                      accessibilityRole="button"
                                      accessibilityState={{ selected: active }}
                                      accessibilityLabel={`Currency ${item}`}
                                      style={[
                                        styles.currencyChip,
                                        active && styles.currencyChipActive,
                                      ]}
                                      onPress={() => onChangeCurrency(item)}
                                    >
                                      <Text
                                        style={[
                                          styles.currencyText,
                                          active && styles.currencyTextActive,
                                        ]}
                                      >
                                        {item}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            </View>
                          </View>
                          <LabeledField
                            accessibilityLabel="Optional Bitcoin price in sats"
                            keyboardType="number-pad"
                            label="Bitcoin price (optional)"
                            onChangeText={onChangeSats}
                            placeholder="sats"
                            placeholderTextColor={placeholderColor}
                            styles={styles}
                            value={sats}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  {banner(admissionInvalid || pricingInvalid, admissionSummary)}
                </>
              ) : (
                <View style={styles.badgeStateRow}>
                  <Text style={styles.badgeStateText}>
                    Public events are open to everyone. Select one or more
                    communities above to configure member access and tickets.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.stepBody}>
              <View style={styles.previewCard}>
                {cover ? (
                  <Image
                    source={{ uri: cover.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.previewBackdrop}>
                    <View style={styles.previewGlow} />
                  </View>
                )}
                <View style={styles.previewShade} />
                <View style={styles.previewCategory}>
                  <Text style={styles.previewCategoryText}>
                    {CATEGORY_META[category].label}
                  </Text>
                </View>
                <View style={styles.previewCopy}>
                  <Text style={styles.previewTitle} numberOfLines={2}>
                    {title.trim() || 'Untitled event'}
                  </Text>
                  <View style={styles.previewMetaRow}>
                    <Calendar size={16} color="#fff" strokeWidth={2.1} />
                    <Text style={styles.previewMetaText}>
                      {scheduleSummary || 'Schedule not set'}
                    </Text>
                  </View>
                  {location.trim() ? (
                    <View style={styles.previewMetaRow}>
                      <MapPin size={16} color="#fff" strokeWidth={2.1} />
                      <Text style={styles.previewMetaText} numberOfLines={1}>
                        {location.trim()}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.previewMetaRow}>
                    <Users size={16} color="#fff" strokeWidth={2.1} />
                    <Text style={styles.previewMetaText} numberOfLines={1}>
                      For {audienceLabel}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.reviewList}>
                <Pressable
                  accessibilityLabel="Edit event details"
                  accessibilityRole="button"
                  style={styles.reviewRow}
                  onPress={() => setStep(0)}
                >
                  <View style={[styles.reviewIcon, styles.reviewIconDetails]}>
                    <ImagePlus size={20} color="#d86cff" strokeWidth={2.1} />
                  </View>
                  <View style={styles.reviewCopy}>
                    <Text style={styles.reviewTitle}>Event details</Text>
                    <Text style={styles.reviewDescription} numberOfLines={2}>
                      {summary.trim()
                        ? 'Cover, title and description complete'
                        : 'Add a description to help guests prepare'}
                    </Text>
                  </View>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
                <View style={styles.reviewDivider} />
                <Pressable
                  accessibilityLabel="Edit event schedule"
                  accessibilityRole="button"
                  style={styles.reviewRow}
                  onPress={() => setStep(1)}
                >
                  <View style={[styles.reviewIcon, styles.reviewIconSchedule]}>
                    <CalendarClock
                      size={20}
                      color="#42d7b0"
                      strokeWidth={2.1}
                    />
                  </View>
                  <View style={styles.reviewCopy}>
                    <Text style={styles.reviewTitle}>Schedule</Text>
                    <Text style={styles.reviewDescription} numberOfLines={2}>
                      {scheduleSummary}
                      {capacity ? ` · Capacity: ${capacity}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
                <View style={styles.reviewDivider} />
                <Pressable
                  accessibilityLabel="Edit event access and pricing"
                  accessibilityRole="button"
                  style={styles.reviewRow}
                  onPress={() => setStep(2)}
                >
                  <View style={[styles.reviewIcon, styles.reviewIconAccess]}>
                    <Ticket
                      size={20}
                      color={theme.colors.primary}
                      strokeWidth={2.1}
                    />
                  </View>
                  <View style={styles.reviewCopy}>
                    <Text style={styles.reviewTitle}>Access & pricing</Text>
                    <Text style={styles.reviewDescription} numberOfLines={2}>
                      {communityRelays.length
                        ? `${audienceLabel}. ${admissionSummary}`
                        : 'Public event · Open access.'}
                    </Text>
                  </View>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              </View>

              <View
                style={[
                  styles.readinessCard,
                  !eventCanPublish && styles.readinessCardInvalid,
                ]}
              >
                <View
                  style={[
                    styles.readinessIcon,
                    !eventCanPublish && styles.readinessIconInvalid,
                  ]}
                >
                  {eventCanPublish ? (
                    <Check size={24} color="#fff" strokeWidth={2.5} />
                  ) : (
                    <CircleAlert
                      size={22}
                      color={theme.colors.error}
                      strokeWidth={2.4}
                    />
                  )}
                </View>
                <View style={styles.readinessCopy}>
                  <Text style={styles.readinessTitle}>
                    {eventCanPublish
                      ? 'Everything looks good'
                      : 'A detail needs attention'}
                  </Text>
                  <Text style={styles.readinessDescription}>
                    {eventCanPublish
                      ? 'Your event is ready to publish.'
                      : 'Return to the highlighted step before publishing.'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        {step > 0 ? (
          <Pressable
            accessibilityLabel="Back to previous step"
            accessibilityRole="button"
            style={styles.backButton}
            onPress={goBack}
          >
            <ChevronLeft
              size={16}
              color={theme.colors.primaryContent}
              strokeWidth={2.4}
            />
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="Cancel event creation"
            accessibilityRole="button"
            style={styles.backButton}
            onPress={onBack}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        )}
        {step < WIZARD_STEPS.length - 1 ? (
          <Pressable
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canContinue }}
            disabled={!canContinue}
            style={[
              styles.continueButton,
              !canContinue && styles.continueButtonDisabled,
            ]}
            onPress={goNext}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.continueButtonText,
                !canContinue && styles.continueButtonTextDisabled,
              ]}
            >
              Continue
            </Text>
            <ChevronRight
              size={16}
              color={
                canContinue
                  ? theme.button.primary.text
                  : theme.button.disabled.text
              }
              strokeWidth={2.4}
            />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel={
              isPublishing ? `${publishLabel}, please wait` : 'Publish event'
            }
            accessibilityRole="button"
            accessibilityState={{
              busy: isPublishing,
              disabled: !eventCanPublish,
            }}
            disabled={!eventCanPublish || isPublishing}
            style={[
              styles.continueButton,
              styles.publishButton,
              (!eventCanPublish || isPublishing) &&
                styles.continueButtonDisabled,
            ]}
            onPress={onPublish}
          >
            {isPublishing ? (
              <ActivityIndicator
                size="small"
                color={theme.button.primary.text}
              />
            ) : (
              <Send
                size={17}
                color={
                  eventCanPublish
                    ? theme.button.primary.text
                    : theme.button.disabled.text
                }
                strokeWidth={2.3}
              />
            )}
            <Text
              numberOfLines={1}
              style={[
                styles.continueButtonText,
                !eventCanPublish && styles.continueButtonTextDisabled,
              ]}
            >
              {publishLabel === 'Post' ? 'Publish event' : publishLabel}
            </Text>
          </Pressable>
        )}
      </View>

      {activePicker && Platform.OS === 'android' ? (
        <DateTimePicker
          testID="event-date-time-picker"
          mode={activePicker === 'date' ? 'date' : 'time'}
          display="default"
          minimumDate={activePicker === 'date' ? minimumEventDate : undefined}
          minuteInterval={5}
          value={pickerDate}
          onChange={onPickerChange}
        />
      ) : null}

      {activePicker && Platform.OS === 'ios' ? (
        <Modal
          animationType="fade"
          presentationStyle="overFullScreen"
          transparent
          visible
          onRequestClose={() => setActivePicker(null)}
        >
          <View style={styles.pickerModalOverlay}>
            <Pressable
              accessibilityLabel="Close date and time picker"
              accessibilityRole="button"
              style={styles.pickerModalBackdrop}
              onPress={() => setActivePicker(null)}
            />
            <View style={styles.pickerModalCard}>
              <View style={styles.pickerModalHeader}>
                <Text style={styles.pickerModalTitle}>
                  {activePicker === 'date'
                    ? 'Choose date'
                    : activePicker === 'start'
                    ? 'Choose start time'
                    : 'Choose end time'}
                </Text>
                <Pressable
                  accessibilityLabel="Done picking"
                  accessibilityRole="button"
                  style={styles.pickerDone}
                  onPress={() => setActivePicker(null)}
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                testID="event-date-time-picker"
                mode={activePicker === 'date' ? 'date' : 'time'}
                display={activePicker === 'date' ? 'inline' : 'spinner'}
                minimumDate={
                  activePicker === 'date' ? minimumEventDate : undefined
                }
                minuteInterval={5}
                style={
                  activePicker === 'date'
                    ? styles.datePickerControl
                    : styles.timePickerControl
                }
                themeVariant={
                  theme.id === 'snowwhite' ||
                  theme.id === 'touchgrass' ||
                  theme.id === 'sunset'
                    ? 'light'
                    : 'dark'
                }
                value={pickerDate}
                onChange={onPickerChange}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    eventScreen: {
      flex: 1,
      backgroundColor: theme.colors.base100,
    },
    topBar: {
      minHeight: 68,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    topBackButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.id === 'matteblack' ? '#484848' : theme.colors.base200,
      backgroundColor:
        theme.id === 'matteblack' ? '#1c1c1c' : theme.colors.base300,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topBarTitle: {
      color: contentColor,
      fontSize: 19,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    closeButton: {
      minWidth: 58,
      minHeight: 44,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    closeButtonText: {
      color: '#4b87ff',
      fontSize: 15,
      fontWeight: '600',
    },
    stepper: {
      minHeight: 74,
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    stepperItem: {
      width: 62,
      alignItems: 'center',
      gap: 7,
    },
    stepCircle: {
      width: 27,
      height: 27,
      borderRadius: 13.5,
      borderWidth: 1.5,
      borderColor: theme.colors.primaryContent,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.base100,
    },
    stepCircleActive: {
      borderColor: theme.colors.primary,
      borderWidth: 2,
    },
    stepCircleComplete: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    stepNumber: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '700',
    },
    stepNumberActive: {
      color: theme.colors.primary,
    },
    stepLabel: {
      color: theme.colors.primaryContent,
      fontSize: 11,
      fontWeight: '600',
    },
    stepLabelActive: {
      color: theme.colors.primary,
      fontWeight: '700',
    },
    stepLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      marginTop: 13,
      backgroundColor: theme.colors.base200,
    },
    stepLineComplete: {
      backgroundColor: theme.colors.primary,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 24,
      gap: 18,
    },
    eventBox: {
      alignSelf: 'stretch',
      width: '100%',
      gap: 20,
    },
    coverHero: {
      height: 184,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#2b2115',
    },
    coverBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      backgroundColor: '#2b2115',
    },
    coverSun: {
      position: 'absolute',
      width: 66,
      height: 66,
      borderRadius: 33,
      right: 54,
      top: 24,
      backgroundColor: '#f6b743',
      opacity: 0.9,
    },
    coverHillBack: {
      position: 'absolute',
      left: -24,
      right: -24,
      bottom: -42,
      height: 118,
      borderRadius: 80,
      backgroundColor: '#86541f',
      transform: [{ rotate: '-5deg' }],
    },
    coverHillFront: {
      position: 'absolute',
      left: 72,
      right: -60,
      bottom: -62,
      height: 128,
      borderRadius: 80,
      backgroundColor: '#3a2b1e',
      transform: [{ rotate: '6deg' }],
    },
    coverAction: {
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: '#17120dbf',
    },
    coverActionText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
    },
    coverRecommendation: {
      position: 'absolute',
      bottom: 12,
      color: '#f5f5f5cc',
      fontSize: 12,
      fontWeight: '500',
    },
    coverHeroRemove: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: '#000000a6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hostRow: {
      minHeight: 68,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    hostIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: `${theme.colors.primary}80`,
      backgroundColor: `${theme.colors.primary}18`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hostCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    hostName: {
      color: contentColor,
      fontSize: 15,
      fontWeight: '700',
    },
    hostHint: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '500',
    },
    categoryField: {
      minHeight: 58,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    categoryFieldText: {
      flex: 1,
      color: contentColor,
      fontSize: 16,
      fontWeight: '700',
    },
    coverRow: {
      minHeight: 64,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      gap: 10,
    },
    coverThumb: {
      width: 64,
      height: 48,
      borderRadius: 8,
      backgroundColor: theme.colors.base200,
    },
    coverThumbPlaceholder: {
      width: 64,
      height: 48,
      borderRadius: 8,
      backgroundColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    coverTitle: {
      color: contentColor,
      fontSize: 14,
      fontWeight: '700',
    },
    coverDescription: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '500',
    },
    coverRemove: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wizardHeader: {
      gap: 6,
    },
    wizardHeaderTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    stepEyebrow: {
      color: theme.colors.primary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    progressRow: {
      flexDirection: 'row',
      gap: 4,
    },
    progressPill: {
      width: 24,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: theme.colors.base200,
    },
    progressPillActive: {
      backgroundColor: theme.colors.primary,
    },
    stepTitle: {
      color: contentColor,
      fontSize: 27,
      fontWeight: '800',
      letterSpacing: -0.7,
      lineHeight: 32,
    },
    stepSubtitle: {
      color: theme.colors.primaryContent,
      fontSize: 16,
      fontWeight: '500',
      lineHeight: 22,
    },
    stepBody: {
      gap: 14,
    },
    footer: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingTop: 12,
      paddingHorizontal: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
    },
    backButton: {
      minHeight: 44,
      minWidth: 78,
      borderRadius: 22,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    backButtonText: {
      color: theme.colors.primaryContent,
      fontSize: 14,
      fontWeight: '700',
    },
    cancelButtonText: {
      color: '#4b87ff',
      fontSize: 15,
      fontWeight: '700',
    },
    continueButton: {
      flex: 1,
      minHeight: 50,
      minWidth: 0,
      maxWidth: 430,
      borderRadius: 25,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      backgroundColor: theme.button.primary.background,
      borderWidth: 1,
      borderColor: theme.button.primary.border,
    },
    continueButtonDisabled: {
      backgroundColor: theme.button.disabled.background,
      borderColor: theme.button.disabled.border,
    },
    continueButtonText: {
      color: theme.button.primary.text,
      fontSize: 16,
      fontWeight: '800',
    },
    continueButtonTextDisabled: {
      color: theme.button.disabled.text,
    },
    publishButton: {
      flex: 1,
    },
    fieldGroup: {
      gap: 6,
    },
    fieldLabel: {
      color: theme.colors.primaryContent,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    fieldHint: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      lineHeight: 18,
      marginTop: -2,
    },
    audienceList: {
      gap: 8,
      marginTop: 4,
    },
    audienceCard: {
      minHeight: 70,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
    },
    audienceCardActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.base200,
    },
    audienceIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    audienceIconActive: {
      borderColor: theme.button.primary.border,
      backgroundColor: theme.button.primary.background,
    },
    audienceCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    audienceTitle: {
      color: contentColor,
      fontSize: 15,
      fontWeight: '800',
    },
    audienceDescription: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
    },
    fieldInputWrap: {
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 8,
    },
    fieldIcon: {
      marginTop: 1,
    },
    fieldInput: {
      flex: 1,
      minHeight: 46,
      paddingVertical: 10,
      color: contentColor,
      fontSize: 15,
      fontWeight: '600',
    },
    pickerFieldText: {
      flex: 1,
      color: contentColor,
      fontSize: 15,
      fontWeight: '600',
    },
    pickerFieldPlaceholder: {
      color: theme.colors.primaryContent,
      fontWeight: '500',
    },
    pickerFieldActive: {
      borderColor: theme.colors.primary,
    },
    pickerModalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    pickerModalBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: '#00000099',
    },
    pickerModalCard: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      overflow: 'hidden',
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    pickerModalHeader: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingLeft: 8,
    },
    pickerModalTitle: {
      flex: 1,
      color: contentColor,
      fontSize: 17,
      fontWeight: '800',
    },
    pickerDone: {
      minHeight: 34,
      borderRadius: 17,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.button.primary.background,
    },
    pickerDoneText: {
      color: theme.button.primary.text,
      fontSize: 13,
      fontWeight: '800',
    },
    datePickerControl: {
      alignSelf: 'stretch',
      height: 340,
    },
    timePickerControl: {
      alignSelf: 'stretch',
      height: 216,
    },
    summaryInput: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
    eventTwoColumn: {
      flexDirection: 'row',
      gap: 10,
    },
    eventHalfField: {
      flex: 1,
    },
    eventLocationField: {
      flex: 3,
    },
    eventCapacityField: {
      flex: 2,
    },
    categorySegmented: {
      flexDirection: 'row',
      gap: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      padding: 4,
    },
    categorySegment: {
      flex: 1,
      minHeight: 40,
      borderRadius: 9,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    categorySegmentActive: {
      backgroundColor: theme.colors.primary,
    },
    categoryText: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '700',
    },
    categoryTextActive: {
      color: theme.button.primary.text,
    },
    durationRow: {
      flexDirection: 'row',
      gap: 8,
    },
    durationChip: {
      minWidth: 56,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    durationChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    durationChipDisabled: {
      opacity: 0.4,
    },
    durationText: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      fontWeight: '700',
    },
    durationTextActive: {
      color: theme.button.primary.text,
    },
    pressed: {
      opacity: 0.7,
    },
    scheduleBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerValid: {
      borderColor: `${theme.colors.success}40`,
      backgroundColor: `${theme.colors.success}1a`,
    },
    bannerInvalid: {
      borderColor: `${theme.colors.error}40`,
      backgroundColor: `${theme.colors.error}1a`,
    },
    bannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
    },
    bannerTextValid: {
      color: theme.colors.success,
    },
    bannerTextInvalid: {
      color: theme.colors.error,
    },
    accessRow: {
      flexDirection: 'row',
      gap: 10,
    },
    accessCard: {
      flex: 1,
      minHeight: 108,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      padding: 12,
      gap: 4,
    },
    accessCardActive: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}14`,
    },
    accessIconChip: {
      width: 30,
      height: 30,
      borderRadius: 9,
      backgroundColor: `${theme.colors.primary}1f`,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    accessIconChipActive: {
      backgroundColor: theme.colors.primary,
    },
    accessTitle: {
      color: contentColor,
      fontSize: 14,
      fontWeight: '800',
    },
    accessTitleActive: {
      color: theme.colors.primary,
    },
    accessDescription: {
      color: theme.colors.primaryContent,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '500',
    },
    accessCheck: {
      position: 'absolute',
      top: 10,
      right: 10,
    },
    badgeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    badgeChip: {
      minHeight: 36,
      maxWidth: '100%',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
    },
    badgeChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    badgeChipText: {
      flexShrink: 1,
      color: contentColor,
      fontSize: 13,
      fontWeight: '700',
    },
    badgeChipTextActive: {
      color: theme.button.primary.text,
    },
    badgeStateRow: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    badgeStateText: {
      flex: 1,
      color: theme.colors.primaryContent,
      fontSize: 13,
      fontWeight: '500',
      lineHeight: 18,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.base200,
    },
    paidRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    paidCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    paidTitle: {
      color: contentColor,
      fontSize: 14,
      fontWeight: '800',
    },
    paidDescription: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '500',
    },
    paidBox: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      padding: 12,
      gap: 12,
    },
    currencyRow: {
      flexDirection: 'row',
      gap: 6,
    },
    currencyChip: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      alignItems: 'center',
      justifyContent: 'center',
    },
    currencyChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    currencyText: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '800',
    },
    currencyTextActive: {
      color: theme.button.primary.text,
    },
    previewCard: {
      height: 245,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      overflow: 'hidden',
      backgroundColor: '#3a2518',
    },
    previewBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: '#5d391c',
    },
    previewGlow: {
      position: 'absolute',
      width: 300,
      height: 300,
      borderRadius: 150,
      right: -80,
      top: -130,
      backgroundColor: '#e99b3d',
      opacity: 0.65,
    },
    previewShade: {
      ...StyleSheet.absoluteFill,
      backgroundColor: '#0000004d',
    },
    previewCategory: {
      position: 'absolute',
      left: 16,
      top: 16,
      minHeight: 30,
      borderRadius: 10,
      justifyContent: 'center',
      paddingHorizontal: 12,
      backgroundColor: '#17120dbf',
    },
    previewCategoryText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '700',
    },
    previewCopy: {
      position: 'absolute',
      left: 18,
      right: 18,
      bottom: 16,
      gap: 7,
    },
    previewTitle: {
      color: '#fff',
      fontSize: 27,
      lineHeight: 32,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    previewMetaRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    previewMetaText: {
      flexShrink: 1,
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
    reviewList: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      overflow: 'hidden',
    },
    reviewRow: {
      minHeight: 92,
      paddingHorizontal: 14,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    reviewIcon: {
      width: 45,
      height: 45,
      borderRadius: 13,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reviewIconDetails: {
      borderColor: '#d86cff99',
      backgroundColor: '#d86cff20',
    },
    reviewIconSchedule: {
      borderColor: '#42d7b099',
      backgroundColor: '#42d7b020',
    },
    reviewIconAccess: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.base200,
    },
    reviewCopy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    reviewTitle: {
      color: contentColor,
      fontSize: 16,
      fontWeight: '800',
    },
    reviewDescription: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
    editText: {
      color: '#4b87ff',
      fontSize: 14,
      fontWeight: '700',
    },
    reviewDivider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 71,
      backgroundColor: theme.colors.base200,
    },
    readinessCard: {
      minHeight: 84,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: `${theme.colors.success}66`,
      backgroundColor: `${theme.colors.success}14`,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    readinessCardInvalid: {
      borderColor: `${theme.colors.error}66`,
      backgroundColor: `${theme.colors.error}14`,
    },
    readinessIcon: {
      width: 45,
      height: 45,
      borderRadius: 22.5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.success,
    },
    readinessIconInvalid: {
      backgroundColor: `${theme.colors.error}1f`,
    },
    readinessCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    readinessTitle: {
      color: contentColor,
      fontSize: 16,
      fontWeight: '800',
    },
    readinessDescription: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
  });
}
