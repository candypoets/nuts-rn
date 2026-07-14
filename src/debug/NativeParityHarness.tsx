import React, {useMemo, useState} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import NativeAvatar from '../specs/NativeAvatarNativeComponent';
import NativeLinkPreview from '../specs/NativeLinkPreviewNativeComponent';
import NativeMediaViewer from '../specs/NativeMediaViewerNativeComponent';
import NativeNoteFooter from '../specs/NativeNoteFooterNativeComponent';
import NativeNoteHeader from '../specs/NativeNoteHeaderNativeComponent';

const foreground = '#f8fafc';
const muted = 'rgba(248, 250, 252, 0.76)';
const surface = '#202624';
const border = '#39423f';
const accent = '#22c7a9';

export function NativeParityHarness() {
  const [linkHeight, setLinkHeight] = useState(110);
  const captureOffset = Number(process.env.EXPO_PUBLIC_NATIVE_PARITY_OFFSET ?? 0);
  const mediaUri = useMemo(
    () => Image.resolveAssetSource(require('../../assets/miss-profile.png')).uri,
    [],
  );
  const media = useMemo(() => Array.from({length: 7}, () => mediaUri), [mediaUri]);
  const logRoute = (event: {nativeEvent: {route: string}}) =>
    console.info('[native-parity-event] route', event.nativeEvent.route);
  const logAction = (event: {nativeEvent: {action: string}}) =>
    console.info('[native-parity-event] action', event.nativeEvent.action);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentOffset={{x: 0, y: Number.isFinite(captureOffset) ? captureOffset : 0}}>
        <Text style={styles.title}>Native view parity fixtures</Text>

        <Fixture label="Avatar">
          <View style={styles.row}>
            <NativeAvatar pubkey="a123" query={false} backgroundColor={surface} borderColor={border} style={styles.avatar40} />
            <NativeAvatar pubkey="b456" query={false} backgroundColor={surface} borderColor={accent} style={styles.avatar56} />
          </View>
        </Fixture>

        <Fixture label="Header — main">
          <NativeNoteHeader visible depth={0} main showRelays={false} relayCount={0} primaryTextColor={foreground} secondaryTextColor={muted} avatarBackgroundColor={surface} accentColor={accent} onNativeRoute={logRoute} style={styles.headerMain} />
        </Fixture>

        <Fixture label="Header — quote">
          <NativeNoteHeader visible depth={1} main={false} showRelays={false} relayCount={0} primaryTextColor={foreground} secondaryTextColor={muted} avatarBackgroundColor={surface} accentColor={accent} onNativeRoute={logRoute} style={styles.headerQuote} />
        </Fixture>

        <Fixture label="Footer — inline">
          <NativeNoteFooter visible main zoom={false} tintColor={muted} primaryColor="#158777" accentColor="#6d28d9" zoomBackgroundColor="rgba(15, 23, 42, 0.46)" onNativeAction={logAction} style={styles.footerInline} />
        </Fixture>

        <Fixture label="Footer — zoom">
          <NativeNoteFooter visible main zoom tintColor={muted} primaryColor="#158777" accentColor="#6d28d9" zoomBackgroundColor="rgba(15, 23, 42, 0.46)" onNativeAction={logAction} style={styles.footerZoom} />
        </Fixture>

        <Fixture label="Link Preview">
          <NativeLinkPreview
            url="https://example.com/native-parity"
            text="Example native link preview"
            baseContentColor={foreground}
            secondaryTextColor={muted}
            cardBackgroundColor={surface}
            borderColor={border}
            onNativeRoute={logRoute}
            onHeightChange={event => setLinkHeight(Math.ceil(event.nativeEvent.height))}
            style={[styles.link, {height: linkHeight}]}
          />
        </Fixture>

        <Fixture label="Media — single">
          <NativeMediaViewer urls={[mediaUri]} types={['image']} thumbnails={['']} dims={['470x470']} itemKeys={['single']} sessionId="parity-single" onNativeRoute={logRoute} onNativeAction={logAction} style={styles.mediaSingle} />
        </Fixture>

        <Fixture label="Media — seven items">
          <NativeMediaViewer urls={media} types={media.map(() => 'image')} thumbnails={media.map(() => '')} dims={media.map(() => '470x470')} itemKeys={media.map((_, index) => `grid-${index}`)} sessionId="parity-grid" onNativeRoute={logRoute} onNativeAction={logAction} style={styles.mediaGrid} />
        </Fixture>
      </ScrollView>
    </SafeAreaView>
  );
}

function Fixture({label, children}: React.PropsWithChildren<{label: string}>) {
  return (
    <View style={styles.fixture}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#111513'},
  content: {padding: 16, paddingBottom: 64, gap: 18},
  title: {color: foreground, fontSize: 20, fontWeight: '700'},
  fixture: {gap: 8},
  label: {color: muted, fontSize: 12, fontWeight: '600'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 16},
  avatar40: {width: 40, height: 40},
  avatar56: {width: 56, height: 56},
  headerMain: {height: 42, width: '100%'},
  headerQuote: {height: 18, width: '100%'},
  footerInline: {height: 24, width: '100%'},
  footerZoom: {height: 48, width: '100%'},
  link: {width: '100%'},
  mediaSingle: {width: '100%', height: 220, borderRadius: 8, overflow: 'hidden'},
  mediaGrid: {width: '100%', height: 192, borderRadius: 8, overflow: 'hidden'},
});
