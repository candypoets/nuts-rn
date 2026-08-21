import React, {useCallback, useState} from 'react';
import {Linking, Pressable, Text, View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {Copy, Zap} from 'lucide-react-native';

import {normalizeLightningInvoice} from '../lib/lightningInvoice';
import {useAppTheme} from '../theme';

type LightningInvoiceCardProps = {
  invoice: string;
};

type Feedback = {
  message: string;
  tone: 'muted' | 'error';
};

export function LightningInvoiceCard({invoice}: LightningInvoiceCardProps) {
  const theme = useAppTheme();
  const normalizedInvoice = normalizeLightningInvoice(invoice);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const copyInvoice = useCallback(
    async (successMessage = 'Invoice copied.') => {
      if (!normalizedInvoice) return;
      try {
        await Clipboard.setStringAsync(normalizedInvoice);
        setFeedback({message: successMessage, tone: 'muted'});
      } catch {
        setFeedback({
          message: 'Could not copy the invoice. Try selecting it below.',
          tone: 'error',
        });
      }
    },
    [normalizedInvoice],
  );

  const openWallet = useCallback(async () => {
    if (!normalizedInvoice) return;
    try {
      await Linking.openURL(`lightning:${normalizedInvoice}`);
      setFeedback(null);
    } catch {
      await copyInvoice('No Lightning wallet opened. Invoice copied instead.');
    }
  }, [copyInvoice, normalizedInvoice]);

  if (!normalizedInvoice) return null;

  return (
    <View className="overflow-hidden rounded-xl border border-base-200 bg-base-300">
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-4">
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-base-200">
          <Zap
            color={theme.colors.warning}
            fill={theme.colors.warning}
            size={20}
            strokeWidth={2.2}
          />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-bold text-base-content">
            Lightning invoice
          </Text>
          <Text className="mt-0.5 text-sm text-primary-content">
            Pay with an installed Lightning wallet
          </Text>
        </View>
      </View>

      <Text
        accessibilityLabel="Lightning invoice payment request"
        className="mx-4 rounded-lg bg-base-200 px-3 py-3 font-mono text-xs leading-5 text-base-content"
        numberOfLines={3}
        selectable
      >
        {normalizedInvoice}
      </Text>

      {feedback ? (
        <Text
          accessibilityLiveRegion="polite"
          className={`px-4 pt-3 text-xs font-medium ${
            feedback.tone === 'error' ? 'text-error' : 'text-primary-content'
          }`}
        >
          {feedback.message}
        </Text>
      ) : null}

      <View className="flex-row gap-2 p-4">
        <Pressable
          accessibilityLabel="Open Lightning wallet"
          accessibilityRole="button"
          className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-primary px-4"
          onPress={event => {
            event.stopPropagation();
            openWallet();
          }}
        >
          <Zap color="#ffffff" size={17} strokeWidth={2.4} />
          <Text className="font-bold text-white">Open wallet</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Copy Lightning invoice"
          accessibilityRole="button"
          className="min-h-11 flex-row items-center justify-center gap-2 rounded-lg bg-base-200 px-4"
          onPress={event => {
            event.stopPropagation();
            copyInvoice();
          }}
        >
          <Copy color={theme.colors.primaryContent} size={17} strokeWidth={2.2} />
          <Text className="font-semibold text-base-content">Copy</Text>
        </Pressable>
      </View>
    </View>
  );
}
