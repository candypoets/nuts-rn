import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  ArrowRight,
  ChevronDown,
  CircleUserRound,
  QrCode,
  Zap,
} from 'lucide-react-native';
import {useAppTheme} from '../theme';

type ReceiveModalProps = {
  onClose: () => void;
  onMinting: () => void;
};

export function ReceiveModal({onClose, onMinting}: ReceiveModalProps) {
  const theme = useAppTheme();
  return (
    <View style={[styles.modalBody, {backgroundColor: theme.colors.base100}]}>
      <View className="h-14 flex-row items-center justify-between px-4 pt-3">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full border border-base-200 bg-base-300"
          hitSlop={12}
          onPress={onClose}
        >
          <ChevronDown size={22} color={theme.colors.primaryContent} strokeWidth={2.3} />
        </Pressable>
      </View>

      <View className="px-4 pt-5">
        <Text className="text-2xl font-bold text-base-content">Add Money</Text>
        <View className="mt-5 overflow-hidden rounded-lg border border-base-200 bg-base-300">
          <ReceiveOption
            enabled
            icon={<Zap size={24} color={theme.colors.primary} strokeWidth={2.4} />}
            title="Add money instantly"
            subtitle="Top up with Lightning"
            onPress={onMinting}
          />
          <ReceiveOption
            icon={<CircleUserRound size={24} color={theme.colors.primaryContent} strokeWidth={2.2} />}
            title="Request from friends"
            subtitle="Instant with zap"
          />
          <ReceiveOption
            last
            icon={<QrCode size={24} color={theme.colors.primaryContent} strokeWidth={2.2} />}
            title="Request via QR code"
            subtitle="For easy or offline transfer"
          />
        </View>
      </View>
    </View>
  );
}

function ReceiveOption({
  enabled = false,
  icon,
  last = false,
  title,
  subtitle,
  onPress,
}: {
  enabled?: boolean;
  icon: React.ReactNode;
  last?: boolean;
  title: string;
  subtitle: string;
  onPress?: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      className={`min-h-20 flex-row items-center px-4 ${
        last ? '' : 'border-b border-base-200'
      } ${enabled ? 'bg-base-300' : 'bg-base-100 opacity-45'}`}
      disabled={!enabled}
      onPress={onPress}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-base-100">
        {icon}
      </View>
      <View className="ml-3 min-w-0 flex-1">
        <Text className="text-base font-bold text-base-content">{title}</Text>
        <Text className="mt-0.5 text-xs font-semibold text-primary-content">
          {subtitle}
        </Text>
      </View>
      <ArrowRight
        size={22}
        color={theme.colors.primaryContent}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
});
