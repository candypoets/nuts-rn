import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Linking, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ParsedEvent} from '@candypoets/nipworker';
import {asKind6} from '@candypoets/nipworker/utils';
import {naddrEncode, neventEncode} from 'nostr-tools/nip19';
import NativeNoteComponent from '../../specs/NativeNoteNativeComponent';
import type {RootStackParamList} from '../../navigation/types';
import {useRelayStore} from '../../stores';
import {
  getBaseContentColor,
  getMutedContentColor,
  useAppTheme,
} from '../../theme';
import {useUIStore} from '../../stores/uiStore';
import {eventTags, tagValue} from '../notes/kindHelpers';

type Props = {
  note?: ParsedEvent;
  noteId?: string;
  context?: ParsedEvent[];
  relays?: string[];
  visible?: boolean;
  footer?: boolean;
  main?: boolean;
  showQuote?: boolean;
  showMedia?: boolean;
  forceFullContent?: boolean;
  showRoot?: boolean;
  threadCard?: boolean;
  disableOpen?: boolean;
  depth?: number;
  leading?: boolean;
  tailing?: boolean;
};

function flatBufferBytes(view: unknown): number[] | undefined {
  const bytes = (view as {bb?: {bytes_?: Uint8Array}} | null)?.bb?.bytes_;
  if (!bytes) {
    return undefined;
  }

  return Array.from(bytes);
}

export function NativeNote({
  note,
  noteId,
  context,
  relays,
  visible = true,
  footer = true,
  main = false,
  showQuote = true,
  showMedia = true,
  forceFullContent = main,
  showRoot = true,
  threadCard = false,
  disableOpen = false,
  depth = 0,
  leading = false,
  tailing = false,
}: Props) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const setRelayStatus = useRelayStore(state => state.setRelayStatus);
  const setSubRelays = useRelayStore(state => state.setSubRelays);
  const eventId = note?.id?.() || noteId || '';
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const noteBytes = useMemo(() => flatBufferBytes(note), [note]);
  const contextBytes = useMemo(
    () => (context?.length === 1 ? flatBufferBytes(context[0]) : undefined),
    [context],
  );
  const handleHeightChange = useCallback((event: {nativeEvent: {height: number}}) => {
    const nextHeight = Math.ceil(event.nativeEvent.height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    setMeasuredHeight(current =>
      current !== null && Math.abs(current - nextHeight) < 1 ? current : nextHeight,
    );
  }, []);
  const handleNativeRoute = useCallback(
    (event: {nativeEvent: {route: string}}) => {
      const route = event.nativeEvent.route;

      if (route.startsWith('relays:')) {
        const [, encodedSubId = '', encodedRelays = '', encodedStatuses = ''] =
          route.split(':');
        const subId = decodeURIComponent(encodedSubId);
        const routeRelays = decodeURIComponent(encodedRelays)
          .split(',')
          .map(relay => relay.trim())
          .filter(Boolean);
        const statuses = Object.fromEntries(
          decodeURIComponent(encodedStatuses)
            .split(',')
            .map(entry => entry.split('='))
            .filter(
              (entry): entry is [string, string] =>
                entry.length === 2 && !!entry[0],
            ),
        );
        if (!routeRelays.length) return;
        if (subId) setSubRelays(subId, routeRelays);
        Object.entries(statuses).forEach(([relay, status]) => {
          setRelayStatus(relay, status);
        });
        navigation.navigate('RelayInfos', {
          subId,
          relays: routeRelays,
          statuses,
        });
        return;
      }

      if (route.startsWith('url:')) {
        const url = route.slice('url:'.length);
        if (url) Linking.openURL(url).catch(() => {});
        return;
      }

      if (route.startsWith('profile:')) {
        const pubkey = route.slice('profile:'.length);
        if (!pubkey) return;
        navigation.navigate('PublicProfile', {pubkey});
        return;
      }

      if (route.startsWith('media:')) {
        const [, rawIndex = '0', ...urlParts] = route.split(':');
        const url = urlParts.join(':');
        const index = Number.parseInt(rawIndex, 10);
        if (!url || !note) return;
        setImageZoom({
          links: [{src: url, type: 'image'}],
          note,
          zoomed: Number.isFinite(index) ? 0 : undefined,
        });
        return;
      }

      if (route.startsWith('note:')) {
        const routeId = route.slice('note:'.length);
        const kind6 = note ? asKind6(note) : null;
        const displayNote = kind6?.repostedEvent?.() ?? note;
        const sourceDisplayId = displayNote?.id() || '';
        const displayId = routeId || sourceDisplayId;
        if (!displayId) return;
        const isSourceRoute = displayId === sourceDisplayId;
        const kind = displayNote?.kind() || 1;
        const noteRelays = relays ?? [];
        if (isSourceRoute && displayNote && kind === 30023) {
          const identifier = tagValue(eventTags(displayNote), 'd');
          const pubkey = displayNote.pubkey() || '';
          if (!identifier || !pubkey) return;
          navigation.navigate('Kind30023Thread', {
            naddr: naddrEncode({
              kind,
              pubkey,
              identifier,
              relays: noteRelays,
            }),
          });
          return;
        }
        navigation.navigate('Kind1Thread', {
          nevent: neventEncode({
            id: displayId,
            author:
              isSourceRoute && displayNote
                ? displayNote.pubkey() || undefined
                : undefined,
            kind: isSourceRoute ? kind : undefined,
            relays: noteRelays,
          }),
        });
      }
    },
    [
      navigation,
      note,
      relays,
      setImageZoom,
      setRelayStatus,
      setSubRelays,
    ],
  );

  useEffect(() => {
    setMeasuredHeight(null);
  }, [
    eventId,
    footer,
    main,
    showQuote,
    showMedia,
    forceFullContent,
    depth,
  ]);

  return (
    <NativeNoteComponent
      noteId={eventId || noteId}
      noteBytes={noteBytes}
      contextBytes={contextBytes}
      relays={relays}
      visible={visible}
      footer={footer}
      main={main}
      showQuote={showQuote}
      showMedia={showMedia}
      forceFullContent={forceFullContent}
      showRoot={showRoot}
      threadCard={threadCard}
      disableOpen={disableOpen}
      depth={depth}
      leading={leading}
      tailing={tailing}
      primaryTextColor={getBaseContentColor(theme)}
      secondaryTextColor={getMutedContentColor(theme)}
      baseContentColor={getBaseContentColor(theme)}
      cardBackgroundColor={theme.colors.base300}
      borderColor={theme.colors.base200}
      accentColor={theme.colors.primary}
      onHeightChange={handleHeightChange}
      onNativeRoute={handleNativeRoute}
      style={[styles.root, {height: measuredHeight ?? 120}]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
