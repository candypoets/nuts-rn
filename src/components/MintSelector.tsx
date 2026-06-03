import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {ChevronDown, ChevronRight} from 'lucide-react-native';

type MintSelectorProps = {
  label: string;
  mints: string[];
  activeMint: string | null;
  balanceByMint?: Record<string, number>;
  showBalance?: boolean;
  amount?: string;
  amountLabel?: string;
  onChangeAmount?: (amount: string) => void;
  chevron?: 'down' | 'right';
  emptyText?: string;
  onSelectMint: (mint: string) => void;
};

type MintInfo = {
  name: string;
  iconUrl?: string;
};

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function displayMintName(mintUrl: string | null) {
  if (!mintUrl) return 'No mint selected';
  try {
    return new URL(mintUrl).hostname.replace(/^www\./, '');
  } catch {
    return mintUrl.replace(/^https?:\/\//, '');
  }
}

async function fetchMintInfo(mintUrl: string): Promise<MintInfo> {
  try {
    const response = await fetch(`${normalizeMintUrl(mintUrl)}/v1/info`);
    if (!response.ok) throw new Error(response.statusText);
    const data = (await response.json()) as {name?: string; icon_url?: string};
    return {
      name: data.name?.trim() || displayMintName(mintUrl),
      iconUrl: data.icon_url,
    };
  } catch {
    return {name: displayMintName(mintUrl)};
  }
}

export function MintSelector({
  label,
  mints,
  activeMint,
  balanceByMint = {},
  showBalance = false,
  amount,
  amountLabel = 'sats',
  onChangeAmount,
  chevron = 'down',
  emptyText = 'No mint available',
  onSelectMint,
}: MintSelectorProps) {
  const normalizedMints = useMemo(
    () => Array.from(new Set(mints.map(normalizeMintUrl))).filter(Boolean),
    [mints],
  );
  const selected =
    activeMint && normalizedMints.includes(normalizeMintUrl(activeMint))
      ? normalizeMintUrl(activeMint)
      : normalizedMints[0] || null;

  useEffect(() => {
    if (!activeMint && selected) onSelectMint(selected);
  }, [activeMint, onSelectMint, selected]);

  if (!selected) {
    return (
      <View className="rounded-lg border border-slate-200 bg-white p-4">
        <Text className="text-xs font-bold uppercase text-slate-500">{label}</Text>
        <Text className="mt-2 text-sm font-semibold text-slate-900">{emptyText}</Text>
      </View>
    );
  }

  return (
    <View className="rounded-lg border border-slate-200 bg-white p-4">
      <Text className="text-xs font-bold uppercase text-slate-500">{label}</Text>
      {onChangeAmount ? (
        <View className="mt-3">
          <View className="flex-row items-center">
            <TextInput
              keyboardType="number-pad"
              className="min-h-20 flex-1 text-6xl font-light text-slate-900"
              value={amount}
              onChangeText={onChangeAmount}
              placeholder="0"
              placeholderTextColor="#cbd5e1"
            />
            <Text className="pb-3 text-base font-bold text-slate-500">{amountLabel}</Text>
            <View className="ml-2 pb-3">
              {chevron === 'right' ? (
                <ChevronRight size={18} color="#94a3b8" strokeWidth={2.2} />
              ) : (
                <ChevronDown size={18} color="#94a3b8" strokeWidth={2.2} />
              )}
            </View>
          </View>
          <Text className="text-xs font-semibold text-slate-500">
            {balanceByMint[selected] || 0} sats available
          </Text>
        </View>
      ) : (
        <View className="mt-3 flex-row items-center">
          <MintPill
            mintUrl={selected}
            balance={showBalance ? balanceByMint[selected] || 0 : undefined}
            selected
            onPress={() => onSelectMint(selected)}
          />
          <View className="ml-2">
            {chevron === 'right' ? (
              <ChevronRight size={18} color="#94a3b8" strokeWidth={2.2} />
            ) : (
              <ChevronDown size={18} color="#94a3b8" strokeWidth={2.2} />
            )}
          </View>
        </View>
      )}
      {normalizedMints.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-1 mt-3"
          contentContainerStyle={styles.mintStrip}
        >
          {normalizedMints.map(mint => (
            <MintPill
              key={mint}
              mintUrl={mint}
              balance={showBalance || onChangeAmount ? balanceByMint[mint] || 0 : undefined}
              selected={mint === selected}
              compact
              onPress={() => onSelectMint(mint)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function MintPill({
  mintUrl,
  balance,
  compact = false,
  selected,
  onPress,
}: {
  mintUrl: string;
  balance?: number;
  compact?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const [info, setInfo] = useState<MintInfo>(() => ({name: displayMintName(mintUrl)}));

  useEffect(() => {
    let alive = true;
    fetchMintInfo(mintUrl).then(next => {
      if (alive) setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, [mintUrl]);

  const handlePress = useCallback(() => onPress(), [onPress]);

  return (
    <Pressable
      className={`flex-row items-center rounded-full border ${
        selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50'
      } ${compact ? 'px-2 py-2' : 'min-w-0 flex-1 px-3 py-2'}`}
      onPress={handlePress}
    >
      <View className="h-8 w-8 overflow-hidden rounded-full bg-slate-200">
        {info.iconUrl ? (
          <Image source={{uri: info.iconUrl}} className="h-full w-full" resizeMode="cover" />
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Text className="text-xs font-extrabold text-slate-600">
              {info.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View className="ml-2 min-w-0">
        <Text
          className={`${compact ? 'max-w-[112px]' : 'max-w-[190px]'} text-sm font-bold text-slate-950`}
          numberOfLines={1}
        >
          {info.name}
        </Text>
        {typeof balance === 'number' ? (
          <Text className="text-xs font-semibold text-slate-500">{balance} sats</Text>
        ) : (
          <Text className="text-xs font-semibold text-slate-500" numberOfLines={1}>
            {displayMintName(mintUrl)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mintStrip: {
    gap: 8,
    paddingHorizontal: 4,
  },
});
