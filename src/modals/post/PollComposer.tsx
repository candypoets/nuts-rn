import React, {useCallback, useMemo} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {Plus, X} from 'lucide-react-native';

import {type AppTheme, useAppTheme} from '../../theme';
import {type PollType, now, readableContentColor} from './shared';

const MAX_OPTIONS = 10;

export function PollComposer({
  endsAt,
  options,
  pollType,
  setEndsAt,
  setPollType,
  addOption,
  removeOption,
  updateOption,
}: {
  endsAt: number | null;
  options: string[];
  pollType: PollType;
  setEndsAt: (value: number | null) => void;
  setPollType: (value: PollType) => void;
  addOption: () => void;
  removeOption: (index: number) => void;
  updateOption: (index: number, value: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const setDuration = useCallback(
    (days: number) => setEndsAt(now() + days * 24 * 60 * 60),
    [setEndsAt],
  );

  return (
    <View style={styles.pollBox}>
      <View style={styles.segmented}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{selected: pollType === 'singlechoice'}}
          accessibilityLabel="Single choice poll"
          style={[
            styles.segment,
            pollType === 'singlechoice' && styles.segmentActive,
          ]}
          onPress={() => setPollType('singlechoice')}
        >
          <Text
            style={[
              styles.segmentText,
              pollType === 'singlechoice' && styles.segmentTextActive,
            ]}
          >
            Single
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{selected: pollType === 'multiplechoice'}}
          accessibilityLabel="Multiple choice poll"
          style={[
            styles.segment,
            pollType === 'multiplechoice' && styles.segmentActive,
          ]}
          onPress={() => setPollType('multiplechoice')}
        >
          <Text
            style={[
              styles.segmentText,
              pollType === 'multiplechoice' && styles.segmentTextActive,
            ]}
          >
            Multiple
          </Text>
        </Pressable>
      </View>

      {options.map((option, index) => (
        <View key={index} style={styles.pollOptionRow}>
          <View style={styles.pollIndexBadge}>
            <Text style={styles.pollIndexText}>{index + 1}</Text>
          </View>
          <TextInput
            style={styles.pollInput}
            placeholder={`Option ${index + 1}`}
            placeholderTextColor={theme.colors.primaryContent}
            value={option}
            onChangeText={value => updateOption(index, value)}
          />
          {options.length > 2 ? (
            <Pressable
              style={({pressed}) => [
                styles.pollRemove,
                pressed && styles.pressed,
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${index + 1}`}
              onPress={() => removeOption(index)}
            >
              <X size={17} color={theme.colors.primaryContent} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.pollFooter}>
        {options.length < MAX_OPTIONS ? (
          <Pressable
            style={({pressed}) => [styles.addOption, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Add poll option"
            onPress={addOption}
          >
            <Plus size={16} color={theme.colors.primaryContent} strokeWidth={2.3} />
            <Text style={styles.addOptionText}>Add option</Text>
          </Pressable>
        ) : (
          <Text style={styles.maxOptionsText}>{MAX_OPTIONS} options max</Text>
        )}
        <View style={styles.durationGroup}>
          <Text style={styles.durationLabel}>Ends in</Text>
          <View style={styles.durationButtons}>
            {[1, 3, 7].map(days => {
              const active =
                endsAt !== null &&
                Math.ceil((endsAt - now()) / (24 * 60 * 60)) === days;
              return (
                <Pressable
                  key={days}
                  style={({pressed}) => [
                    styles.durationButton,
                    active && styles.durationButtonActive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  accessibilityLabel={`${days} day${days > 1 ? 's' : ''}`}
                  onPress={() => setDuration(days)}
                >
                  <Text
                    style={[
                      styles.durationText,
                      active && styles.durationTextActive,
                    ]}
                  >
                    {days}d
                  </Text>
                </Pressable>
              );
            })}
            {endsAt ? (
              <Pressable
                style={({pressed}) => [
                  styles.durationClear,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Clear duration"
                onPress={() => setEndsAt(null)}
              >
                <X size={14} color={theme.colors.primaryContent} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    pollBox: {
      alignSelf: 'stretch',
      width: '100%',
      gap: 10,
    },
    segmented: {
      height: 40,
      borderRadius: 10,
      backgroundColor: theme.colors.base200,
      padding: 3,
      flexDirection: 'row',
    },
    segment: {
      flex: 1,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: theme.colors.primary,
    },
    segmentText: {
      color: theme.colors.primaryContent,
      fontWeight: '700',
      fontSize: 13,
    },
    segmentTextActive: {
      color: theme.button.primary.text,
    },
    pollOptionRow: {
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 10,
      gap: 10,
    },
    pollIndexBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pollIndexText: {
      color: theme.colors.primaryContent,
      fontWeight: '700',
      fontSize: 11,
    },
    pollInput: {
      flex: 1,
      minHeight: 46,
      color: contentColor,
      fontSize: 15,
    },
    pollRemove: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pollFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    addOption: {
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base100,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 6,
    },
    addOptionText: {
      color: theme.colors.primaryContent,
      fontWeight: '700',
      fontSize: 13,
    },
    maxOptionsText: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '600',
    },
    durationGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    durationLabel: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      fontWeight: '600',
    },
    durationButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    durationButton: {
      minWidth: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationButtonActive: {
      backgroundColor: theme.colors.primary,
    },
    durationClear: {
      width: 40,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationText: {
      color: theme.colors.primaryContent,
      fontWeight: '700',
      fontSize: 12,
    },
    durationTextActive: {
      color: theme.button.primary.text,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
