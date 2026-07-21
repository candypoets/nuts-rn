import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Image} from 'expo-image';
import {BlurView} from 'expo-blur';
import {Film, Search} from 'lucide-react-native';

import {type AppTheme, useAppTheme} from '../../theme';
import {TENOR_API_KEY, TENOR_LIMIT, readableContentColor} from './shared';

export type TenorGif = {
  id: string;
  content_description?: string;
  media_formats: {
    gif?: {url: string; dims?: [number, number]};
    mediumgif?: {url: string; dims?: [number, number]};
    tinygif?: {url: string; dims?: [number, number]};
  };
};

export function GifPicker({
  onSelect,
  onDone,
}: {
  onSelect: (gif: TenorGif) => void;
  onDone: () => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [featuredGifs, setFeaturedGifs] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const requestIdRef = useRef(0);

  const fetchTenorGifs = useCallback(
    async (endpoint: 'featured' | 'search', params: Record<string, string> = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const searchParams = new URLSearchParams({
          key: TENOR_API_KEY,
          limit: String(TENOR_LIMIT),
          media_filter: 'gif,tinygif,mediumgif',
          ...params,
        });
        const response = await fetch(
          `https://tenor.googleapis.com/v2/${endpoint}?${searchParams}`,
        );

        if (!response.ok) {
          throw new Error(`Tenor request failed with status ${response.status}`);
        }

        const data = (await response.json()) as {results?: TenorGif[]};
        if (requestId !== requestIdRef.current) return;
        const results = data.results || [];
        setGifs(results);
        if (endpoint === 'featured') setFeaturedGifs(results);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load GIFs');
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchTenorGifs('featured');
  }, [fetchTenorGifs]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 80);

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const timeout = setTimeout(() => {
      if (!trimmed) {
        setGifs(featuredGifs);
        return;
      }
      fetchTenorGifs('search', {q: trimmed});
    }, trimmed ? 450 : 0);

    return () => clearTimeout(timeout);
  }, [featuredGifs, fetchTenorGifs, query]);

  const renderGif = useCallback(
    ({item}: {item: TenorGif}) => {
      const thumb = item.media_formats.tinygif || item.media_formats.mediumgif || item.media_formats.gif;
      if (!thumb?.url) return null;

      return (
        <Pressable
          style={styles.gifTile}
          accessibilityRole="button"
          accessibilityLabel={item.content_description || 'Select GIF'}
          onPress={() => onSelect(item)}
        >
          <Image
            source={{uri: thumb.url}}
            style={styles.gifTileImage}
            contentFit="cover"
          />
        </Pressable>
      );
    },
    [onSelect, styles],
  );

  return (
    <View style={styles.panel}>
      <View style={styles.gifStickyHeader}>
        <BlurView intensity={42} tint="systemMaterial" style={styles.gifSearchBox}>
          <Search size={16} color={theme.colors.primaryContent} />
          <TextInput
            ref={searchInputRef}
            value={query}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search GIFs"
            placeholderTextColor={theme.colors.primaryContent}
            style={styles.gifSearchInput}
            returnKeyType="search"
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const trimmed = query.trim();
              if (trimmed) fetchTenorGifs('search', {q: trimmed});
            }}
          />
        </BlurView>
        <Pressable style={styles.gifDoneButton} onPress={onDone}>
          <Text style={styles.panelDoneText}>OK</Text>
        </Pressable>
      </View>
      {loading && gifs.length === 0 ? (
        <View style={styles.panelEmpty}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.panelEmpty}>
          <Film size={30} color={theme.colors.primaryContent} />
          <Text style={styles.panelEmptyTitle}>Could not load GIFs</Text>
          <Text style={styles.panelEmptyText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={gifs}
          keyExtractor={item => item.id}
          numColumns={2}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.gifGridContent}
          columnWrapperStyle={styles.gifGridRow}
          renderItem={renderGif}
          ListEmptyComponent={
            <View style={styles.panelEmpty}>
              <Text style={styles.panelEmptyTitle}>No GIFs found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const contentColor = readableContentColor(theme);
  return StyleSheet.create({
    panel: {
      flex: 1,
      backgroundColor: theme.colors.base100,
      paddingHorizontal: 12,
    },
    panelDoneText: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: '800',
    },
    panelEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
      paddingBottom: 28,
    },
    panelEmptyTitle: {
      marginTop: 10,
      color: contentColor,
      fontSize: 15,
      fontWeight: '800',
      textAlign: 'center',
    },
    panelEmptyText: {
      marginTop: 5,
      color: theme.colors.primaryContent,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    gifStickyHeader: {
      position: 'absolute',
      top: 12,
      left: 12,
      right: 12,
      zIndex: 3,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    gifSearchBox: {
      flex: 1,
      minHeight: 42,
      borderRadius: 21,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.34)',
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
    },
    gifSearchInput: {
      flex: 1,
      minWidth: 0,
      color: contentColor,
      fontSize: 15,
      paddingVertical: 8,
    },
    gifDoneButton: {
      minHeight: 42,
      minWidth: 50,
      borderRadius: 21,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    gifGridContent: {
      paddingTop: 64,
      paddingBottom: 12,
    },
    gifGridRow: {
      gap: 8,
      marginBottom: 8,
    },
    gifTile: {
      flex: 1,
      aspectRatio: 4 / 3,
      borderRadius: 8,
      backgroundColor: theme.colors.base200,
      overflow: 'hidden',
    },
    gifTileImage: {
      width: '100%',
      height: '100%',
    },
  });
}
