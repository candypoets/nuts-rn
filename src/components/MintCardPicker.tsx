import React, {useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {Image} from 'expo-image';
import Animated, {useReducedMotion} from 'react-native-reanimated';

type MintCardPickerProps = {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  amount?: string;
  fee?: number | null;
  onChangeAmount?: (amount: string) => void;
  stripOnly?: boolean;
  onSelectMint: (mintUrl: string | null) => void;
};

type MintInfo = {
  name: string;
  url: string;
  iconUrl?: string;
};

type MintInfoResponse = {
  name?: string;
  icon_url?: string;
};

const mintInfoCache = new Map<string, MintInfo>();
const selectionTransitionEasing = 'ease-in-out' as const;

export function MintCardPicker({
  mintUrls,
  activeMintUrl,
  balanceByMint,
  amount,
  fee,
  onChangeAmount,
  stripOnly = false,
  onSelectMint,
}: MintCardPickerProps) {
  const activeMint =
    activeMintUrl && mintUrls.includes(activeMintUrl)
      ? activeMintUrl
      : mintUrls[0];
  const activeBalance = activeMint ? balanceByMint[activeMint] ?? 0 : 0;
  const maxAmount = Math.max(0, activeBalance - Number(fee || 0));

  if (!activeMint) return null;

  if (stripOnly) {
    return (
      <View className="h-[64px]">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-3 h-[64px]"
          contentContainerStyle={styles.mintStripContent}
        >
          {mintUrls.map(mintUrl => (
            <MintSquare
              key={mintUrl}
              mintUrl={mintUrl}
              selected={mintUrl === activeMint}
              onPress={() => onSelectMint(mintUrl)}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-3 -mb-7 h-[64px] z-10"
        contentContainerStyle={styles.mintStripContent}
      >
        {mintUrls.map(mintUrl => (
          <MintSquare
            key={mintUrl}
            mintUrl={mintUrl}
            selected={mintUrl === activeMint}
            onPress={() => onSelectMint(mintUrl)}
          />
        ))}
      </ScrollView>
      <Pressable
        className="rounded-2xl border border-base-200 bg-base-300/55 px-5 pb-5 pt-9"
        onPress={() => onSelectMint(activeMint)}
      >
        {onChangeAmount ? (
          <>
            <Text className="text-sm font-semibold uppercase text-primary-content">
              amount
            </Text>
            <View className="mt-1 flex-row items-end">
              <TextInput
                keyboardType="number-pad"
                className="min-h-16 flex-1 font-mono text-5xl font-semibold text-base-content"
                value={amount}
                onChangeText={onChangeAmount}
                placeholder="0"
                placeholderTextColor="#cbd5e1"
              />
              <Text className="pb-3 text-base font-bold text-primary-content">
                sats
              </Text>
            </View>
            <Text className="text-xs font-semibold text-primary-content">
              max {maxAmount} sats
            </Text>
          </>
        ) : (
          <>
            <Text className="text-sm font-semibold uppercase text-primary-content">
              current balance
            </Text>
            <Text className="mt-1 font-mono text-3xl font-semibold text-base-content">
              {activeBalance} <Text className="text-2xl font-bold">丰</Text>
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function MintSquare({
  mintUrl,
  selected,
  onPress,
}: {
  mintUrl: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [mint, setMint] = useState<MintInfo>(() => ({
    name: displayMintName(mintUrl),
    url: mintUrl,
  }));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let alive = true;
    fetchMintData(mintUrl).then(nextMint => {
      if (alive) setMint(nextMint);
    });
    return () => {
      alive = false;
    };
  }, [mintUrl]);

  const colors = mintColors(mint.name || mintUrl);
  const initial = (mint.name || displayMintName(mintUrl))
    .trim()
    .charAt(0)
    .toUpperCase();
  const selectionStyle = reducedMotion
    ? selected
      ? styles.mintSquareSelectedReducedMotion
      : styles.mintSquareUnselectedReducedMotion
    : selected
    ? styles.mintSquareSelectedMotion
    : styles.mintSquareUnselectedMotion;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      className="items-center justify-center"
      pressRetentionOffset={16}
      style={[styles.mintSquareSlot, selected && styles.selectedMintSquareSlot]}
      onPress={() => {
        if (!selected) Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
    >
      <Animated.View
        className="items-center justify-center overflow-hidden"
        style={[
          styles.mintSquareSurface,
          selectionStyle,
          {
            backgroundColor: colors.base,
          },
          selected ? styles.selectedMintSquare : styles.mintSquare,
        ]}
      >
        {mint.iconUrl ? (
          <Image
            contentFit="cover"
            cachePolicy="memory-disk"
            source={{uri: mint.iconUrl}}
            style={styles.mintSquareImage}
          />
        ) : (
          <Text className="text-2xl font-black text-white">{initial}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

async function fetchMintData(mintUrl: string): Promise<MintInfo> {
  const normalizedUrl = normalizeMintUrl(mintUrl);
  const cached = mintInfoCache.get(normalizedUrl);
  if (cached) return cached;

  try {
    const response = await fetch(`${normalizedUrl}/v1/info`);
    if (!response.ok) throw new Error('Mint info request failed');
    const info = (await response.json()) as MintInfoResponse;
    const mint = {
      name: info.name || displayMintName(normalizedUrl),
      url: normalizedUrl,
      iconUrl: info.icon_url,
    };
    mintInfoCache.set(normalizedUrl, mint);
    return mint;
  } catch {
    const fallback = {
      name: displayMintName(normalizedUrl),
      url: normalizedUrl,
    };
    mintInfoCache.set(normalizedUrl, fallback);
    return fallback;
  }
}

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function displayMintName(url: string) {
  return normalizeMintUrl(url)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
}

function mintColors(value: string) {
  const hash = value
    .replace(/cash/gi, '')
    .split('')
    .reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 2147483647, 0);
  const hue = Math.abs(hash % 320) + 20;
  return {
    base: `hsl(${hue}, 72%, 34%)`,
    soft: `hsl(${hue}, 42%, 90%)`,
  };
}

const styles = StyleSheet.create({
  mintStripContent: {
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
  },
  mintSquareSlot: {
    height: 54,
    width: 54,
  },
  selectedMintSquareSlot: {
    zIndex: 2,
  },
  mintSquareSurface: {
    borderRadius: 16,
    height: 54,
    width: 54,
  },
  mintSquareSelectedMotion: {
    opacity: 1,
    transform: [{scale: 1}],
    transitionDuration: '180ms',
    transitionProperty: ['transform', 'opacity'],
    transitionTimingFunction: selectionTransitionEasing,
  },
  mintSquareUnselectedMotion: {
    opacity: 0.78,
    transform: [{scale: 38 / 54}],
    transitionDuration: '180ms',
    transitionProperty: ['transform', 'opacity'],
    transitionTimingFunction: selectionTransitionEasing,
  },
  mintSquareSelectedReducedMotion: {
    opacity: 1,
    transform: [{scale: 1}],
    transitionDuration: '120ms',
    transitionProperty: 'opacity',
    transitionTimingFunction: selectionTransitionEasing,
  },
  mintSquareUnselectedReducedMotion: {
    opacity: 0.78,
    transform: [{scale: 1}],
    transitionDuration: '120ms',
    transitionProperty: 'opacity',
    transitionTimingFunction: selectionTransitionEasing,
  },
  mintSquareImage: {
    height: '100%',
    width: '100%',
  },
  mintSquare: {
    shadowColor: '#0f172a',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  selectedMintSquare: {
    shadowColor: '#0f172a',
    shadowOffset: {width: 0, height: 5},
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 2,
  },
});
