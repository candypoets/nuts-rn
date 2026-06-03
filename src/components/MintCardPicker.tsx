import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Image} from 'expo-image';

type MintCardPickerProps = {
  mintUrls: string[];
  activeMintUrl: string | null;
  balanceByMint: Record<string, number>;
  amount?: string;
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedImage = Animated.createAnimatedComponent(Image);
const mintInfoCache = new Map<string, MintInfo>();

export function MintCardPicker({
  mintUrls,
  activeMintUrl,
  balanceByMint,
  amount,
  onChangeAmount,
  stripOnly = false,
  onSelectMint,
}: MintCardPickerProps) {
  const activeMint =
    activeMintUrl && mintUrls.includes(activeMintUrl)
      ? activeMintUrl
      : mintUrls[0];
  const activeBalance = activeMint ? balanceByMint[activeMint] ?? 0 : 0;

  if (!activeMint) return null;

  if (stripOnly) {
    return (
      <View className="h-[92px]">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-3 h-[92px]"
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
        className="-mx-3 -mb-8 h-[82px] z-10"
        contentContainerStyle={styles.mintStripContent}
      >
        {mintUrls.map(mintUrl => (
          <MintSquare
            key={mintUrl}
            mintUrl={mintUrl}
            balance={onChangeAmount ? undefined : balanceByMint[mintUrl] ?? 0}
            selected={mintUrl === activeMint}
            onPress={() => onSelectMint(mintUrl)}
          />
        ))}
      </ScrollView>
      <Pressable
        className="rounded-2xl border border-slate-100 bg-white/55 px-5 pb-5 pt-10"
        onPress={() => onSelectMint(activeMint)}
      >
        {onChangeAmount ? (
          <>
            <Text className="text-sm font-semibold uppercase text-slate-500">
              amount
            </Text>
            <View className="mt-1 flex-row items-end">
              <TextInput
                keyboardType="number-pad"
                className="min-h-16 flex-1 font-mono text-5xl font-semibold text-slate-900"
                value={amount}
                onChangeText={onChangeAmount}
                placeholder="0"
                placeholderTextColor="#cbd5e1"
              />
              <Text className="pb-3 text-base font-bold text-slate-500">sats</Text>
            </View>
          </>
        ) : (
          <>
            <Text className="text-sm font-semibold uppercase text-slate-500">
              current balance
            </Text>
            <Text className="mt-1 font-mono text-3xl font-semibold text-slate-900">
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
  balance,
  selected,
  onPress,
}: {
  mintUrl: string;
  balance?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const [mint, setMint] = useState<MintInfo>(() => ({
    name: displayMintName(mintUrl),
    url: mintUrl,
  }));
  const sizeProgress = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    let alive = true;
    fetchMintData(mintUrl).then(nextMint => {
      if (alive) setMint(nextMint);
    });
    return () => {
      alive = false;
    };
  }, [mintUrl]);

  useEffect(() => {
    Animated.timing(sizeProgress, {
      toValue: selected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [selected, sizeProgress]);

  const colors = mintColors(mint.name || mintUrl);
  const initial = (mint.name || displayMintName(mintUrl)).trim().charAt(0).toUpperCase();
  const tileSize = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [58, 82],
  });
  const tileRadius = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 18],
  });
  const iconSize = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [34, 48],
  });
  const iconRadius = sizeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 16],
  });
  const initialClassName = selected ? 'text-3xl' : 'text-xl';

  return (
    <AnimatedPressable
      className={`items-center justify-center overflow-hidden ${
        selected ? 'border-2 border-white' : ''
      }`}
      style={[
        {
          backgroundColor: colors.soft,
          borderRadius: tileRadius,
          height: tileSize,
          width: tileSize,
        },
        selected ? styles.selectedMintSquare : styles.mintSquare,
      ]}
      onPress={onPress}
    >
      {mint.iconUrl ? (
        <AnimatedImage
          contentFit="cover"
          cachePolicy="memory-disk"
          source={{uri: mint.iconUrl}}
          style={{
            borderRadius: iconRadius,
            height: iconSize,
            width: iconSize,
          }}
        />
      ) : (
        <Animated.View
          className="items-center justify-center"
          style={{
            backgroundColor: colors.base,
            borderRadius: iconRadius,
            height: iconSize,
            width: iconSize,
          }}
        >
          <Text className={`${initialClassName} font-black text-white`}>
            {initial}
          </Text>
        </Animated.View>
      )}
      {typeof balance === 'number' ? (
        <Text className="absolute bottom-1.5 text-[10px] font-bold text-slate-700">
          {balance}
        </Text>
      ) : null}
    </AnimatedPressable>
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
    alignItems: 'flex-end',
    gap: 10,
    minHeight: 82,
    paddingHorizontal: 12,
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
