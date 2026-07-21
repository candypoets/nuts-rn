import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { SearchX } from 'lucide-react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
} from 'react-native-enriched';
import { asKind0 } from '@candypoets/nipworker/utils';
import type { ParsedEvent } from '@candypoets/nipworker';

import { type AppTheme, useAppTheme } from '../../theme';
import {
  editorHtmlStyle,
  fallbackProfileImage,
  mentionEventName,
  mentionHandle,
  readableContentColor,
} from './shared';

export function NoteComposer({
  editorRef,
  isPoll,
  isReply,
  onLayout,
  onMentionQuery,
  onTextChange,
  placeholder,
}: {
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  isPoll: boolean;
  isReply: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onMentionQuery: (query: string | null) => void;
  onTextChange: (value: string) => void;
  placeholder: string;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isShortNote = !isPoll && !isReply;
  return (
    <View
      className={isShortNote ? 'relative h-[278px] overflow-hidden' : undefined}
      style={[
        !isShortNote && styles.editorShell,
        isPoll && styles.pollEditorShell,
        isReply && styles.replyEditorShell,
      ]}
      onLayout={onLayout}
    >
      <EnrichedTextInput
        ref={editorRef}
        autoFocus
        autoCapitalize="sentences"
        mentionIndicators={['@']}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.primaryContent}
        selectionColor={theme.colors.primary}
        cursorColor={theme.colors.primary}
        linkRegex={/(https?:\/\/|nostr:)[^\s]+/}
        scrollEnabled
        onChangeText={(event: NativeSyntheticEvent<{ value: string }>) =>
          onTextChange(event.nativeEvent.value)
        }
        onStartMention={indicator => {
          if (indicator === '@') onMentionQuery('');
        }}
        onChangeMention={event => {
          if (event.indicator === '@') onMentionQuery(event.text);
        }}
        onEndMention={indicator => {
          if (indicator === '@') onMentionQuery(null);
        }}
        onPasteImages={event => {
          console.log('[post] pasted images', event.nativeEvent);
        }}
        htmlStyle={editorHtmlStyle}
        style={
          isReply
            ? styles.replyEditor
            : isPoll
            ? styles.pollEditor
            : styles.editor
        }
      />
    </View>
  );
}

export function MentionSuggestions({
  candidates,
  loading,
  finished,
  onSelect,
}: {
  candidates: ParsedEvent[];
  loading: boolean;
  finished: boolean;
  onSelect: (candidate: ParsedEvent) => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.mentionBox}>
      {loading ? (
        <View style={styles.mentionStateRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.mentionStateText}>Searching profiles...</Text>
        </View>
      ) : null}
      {candidates.length ? (
        <ScrollView
          style={styles.mentionScroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {candidates.map((candidate, index) => {
            const pubkey = candidate.pubkey() || '';
            const kind0 = asKind0(candidate);
            const name = mentionEventName(candidate);
            const handle = mentionHandle(name);
            const picture = kind0?.picture?.();
            return (
              <Pressable
                key={pubkey}
                style={({ pressed }) => [
                  styles.mentionRow,
                  index === candidates.length - 1 && styles.mentionRowLast,
                  pressed && styles.mentionRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${name}`}
                onPress={() => onSelect(candidate)}
              >
                <View style={styles.mentionAvatar}>
                  <Image
                    source={picture ? { uri: picture } : fallbackProfileImage}
                    style={styles.mentionAvatarImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </View>
                <View style={styles.mentionTextBlock}>
                  <Text style={styles.mentionName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.mentionHandle} numberOfLines={1}>
                    @{handle}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : finished && !loading ? (
        <View style={styles.mentionStateRow}>
          <SearchX size={18} color={theme.colors.primaryContent} />
          <Text style={styles.mentionStateText}>
            No matching profiles found
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    editorShell: {
      height: 128,
      overflow: 'hidden',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
    },
    replyEditorShell: {
      height: 104,
      borderRadius: 10,
    },
    pollEditorShell: {
      height: 86,
    },
    editor: {
      height: 248,
      paddingHorizontal: 2,
      paddingTop: 10,
      paddingBottom: 12,
      fontSize: 18,
      lineHeight: 26,
      color: contentColor,
    },
    pollEditor: {
      height: 86,
      padding: 14,
      fontSize: 17,
      lineHeight: 24,
      color: contentColor,
    },
    replyEditor: {
      height: 104,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      lineHeight: 22,
      color: contentColor,
    },
    mentionBox: {
      maxHeight: 216,
      marginBottom: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.base200,
      backgroundColor: theme.colors.base300,
      overflow: 'hidden',
    },
    mentionScroll: {
      maxHeight: 216,
    },
    mentionRow: {
      minHeight: 56,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.base200,
    },
    mentionRowLast: {
      borderBottomWidth: 0,
    },
    mentionRowPressed: {
      backgroundColor: theme.colors.base100,
    },
    mentionStateRow: {
      minHeight: 52,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    mentionStateText: {
      color: theme.colors.primaryContent,
      fontSize: 13,
      fontWeight: '500',
    },
    mentionAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.base200,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.base200,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    mentionAvatarImage: {
      width: '100%',
      height: '100%',
    },
    mentionTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    mentionName: {
      color: contentColor,
      fontSize: 15,
      fontWeight: '600',
    },
    mentionHandle: {
      color: theme.colors.primaryContent,
      fontSize: 12,
      marginTop: 2,
    },
  });
}
