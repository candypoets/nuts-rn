import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import {Camera, QrCode, ScanLine} from 'lucide-react-native';
import {nip19} from 'nostr-tools';
import QRCode from 'react-native-qrcode-svg';

import {shortNpub} from '../lib/identity';
import type {RootStackParamList} from '../navigation/types';
import {useAuthStore} from '../stores';
import {type AppTheme, useAppTheme} from '../theme';

type ScanModalProps = {
  initialMode?: 'share' | 'scan';
};

type ScanResult =
  | {type: 'lightning'; invoice: string}
  | {type: 'profile'; pubkey: string}
  | {type: 'cashu'; token: string}
  | {type: 'unknown'; value: string};

function isLightningInvoice(value: string) {
  return /^(lightning:)?(lnbc|lntb|LNBC|LNTB)[0-9a-zA-Z]+$/.test(value);
}

function normalizeLightningInvoice(value: string) {
  return value.toLowerCase().startsWith('lightning:') ? value.slice(10) : value;
}

function isLnurl(value: string) {
  return value.toLowerCase().startsWith('lnurl') && value.length > 10;
}

function decodeNostrPubkey(value: string) {
  const nextValue = value.startsWith('nostr:') ? value.slice(6) : value;

  try {
    const decoded = nip19.decode(nextValue);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
    return null;
  } catch {
    return null;
  }
}

function parseScanValue(rawValue: string): ScanResult {
  const value = rawValue.trim();
  if (isLightningInvoice(value)) {
    return {type: 'lightning', invoice: normalizeLightningInvoice(value)};
  }
  if (isLnurl(value)) {
    return {type: 'lightning', invoice: value};
  }

  const pubkey = decodeNostrPubkey(value);
  if (pubkey) return {type: 'profile', pubkey};

  if (value.toLowerCase().startsWith('cashu:')) {
    return {type: 'cashu', token: value.slice(6)};
  }
  if (value.startsWith('//')) {
    return {type: 'cashu', token: value.slice(2)};
  }

  return {type: 'unknown', value};
}

export function ScanModal({initialMode}: ScanModalProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createScanStyles(theme), [theme]);
  const contentColor = theme.colors.base100 === '#111111' ? '#ffffff' : '#1a1a1a';
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const pubkey = useAuthStore(state => state.pubkey);
  const npub = useAuthStore(state => state.npub);
  const [permission] = useCameraPermissions();
  const [mode, setMode] = useState<'share' | 'scan'>(() =>
    initialMode ?? (pubkey ? 'share' : 'scan'),
  );
  const [copied, setCopied] = useState(false);
  const [unknownValue, setUnknownValue] = useState<string | null>(null);
  const [cashuToken, setCashuToken] = useState<string | null>(null);
  const lockedRef = useRef(false);

  const permissionReady = permission?.granted;
  const shareValue = useMemo(() => {
    if (!pubkey) return null;
    return `nostr:${npub ?? nip19.npubEncode(pubkey)}`;
  }, [npub, pubkey]);
  const publicKeyValue = useMemo(() => {
    if (!pubkey) return null;
    return npub ?? nip19.npubEncode(pubkey);
  }, [npub, pubkey]);

  const showScanner = mode === 'scan';

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (lockedRef.current) return;
      lockedRef.current = true;

      const parsed = parseScanValue(result.data);
      if (parsed.type === 'lightning') {
        navigation.replace('Lightning', {invoice: parsed.invoice});
        return;
      }
      if (parsed.type === 'profile') {
        navigation.replace('PublicProfile', {pubkey: parsed.pubkey});
        return;
      }
      if (parsed.type === 'cashu') {
        setCashuToken(parsed.token);
        return;
      }

      setUnknownValue(parsed.value);
    },
    [navigation],
  );

  const resetScan = useCallback(() => {
    lockedRef.current = false;
    setUnknownValue(null);
    setCashuToken(null);
  }, []);

  const switchMode = useCallback((nextMode: 'share' | 'scan') => {
    lockedRef.current = false;
    setUnknownValue(null);
    setCashuToken(null);
    setCopied(false);
    setMode(nextMode);
  }, []);

  const copyPublicKey = useCallback(async () => {
    if (!publicKeyValue) return;
    await Clipboard.setStringAsync(publicKeyValue);
    setCopied(true);
  }, [publicKeyValue]);

  const statusText = useMemo(() => {
    if (!permission) return 'Checking camera permission';
    if (!permission.granted)
      return 'Camera access is needed to scan payment QR codes';
    return 'Point the camera at a Lightning, LNURL, Cashu, or Nostr QR code';
  }, [permission]);

  return (
    <View style={styles.root}>
      <View style={styles.cameraFrame}>
        {showScanner && permissionReady ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{barcodeTypes: ['qr']}}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : showScanner ? (
          <View style={styles.permissionBody}>
            <View style={styles.permissionIcon}>
              <Camera size={30} color={theme.colors.primary} strokeWidth={2.2} />
            </View>
            <Text style={styles.permissionTitle}>Scan QR codes</Text>
            <Text style={styles.permissionText}>{statusText}</Text>
            <Pressable
              style={styles.permissionButton}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.permissionButtonText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.shareBody}>
            <Pressable
              style={styles.shareQrWrap}
              disabled={!publicKeyValue}
              onPress={copyPublicKey}
            >
              {shareValue ? (
                <QRCode value={shareValue} size={255} />
              ) : (
                <View style={styles.emptyQr}>
                  <QrCode size={52} color={theme.colors.primaryContent} strokeWidth={1.8} />
                </View>
              )}
            </Pressable>
            <Text style={styles.shareTitle}>My contact QR</Text>
            <Text style={styles.shareText}>
              {shareValue
                ? copied
                  ? 'Copied'
                  : `${publicKeyValue ?? (pubkey ? shortNpub(pubkey) : '')}`
                : 'Sign in to share your Nostr public key.'}
            </Text>
          </View>
        )}
        {showScanner ? <View style={styles.scrim} pointerEvents="none" /> : null}
        {showScanner && permissionReady ? (
          <View style={styles.scanBox} pointerEvents="none" />
        ) : null}
      </View>

      <View style={styles.modeSwitch}>
        <Pressable
          style={[
            styles.modeButton,
            mode === 'share' && styles.modeButtonActive,
          ]}
          onPress={() => switchMode('share')}
        >
          <QrCode
            size={18}
            color={mode === 'share' ? contentColor : '#ffffff'}
            strokeWidth={2.3}
          />
          <Text
            style={[
              styles.modeText,
              mode === 'share' && styles.modeTextActive,
            ]}
          >
            My QR
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.modeButton,
            mode === 'scan' && styles.modeButtonActive,
          ]}
          onPress={() => switchMode('scan')}
        >
          <ScanLine
            size={18}
            color={mode === 'scan' ? contentColor : '#ffffff'}
            strokeWidth={2.3}
          />
          <Text
            style={[
              styles.modeText,
              mode === 'scan' && styles.modeTextActive,
            ]}
          >
            Scan
          </Text>
        </Pressable>
      </View>

      {showScanner && permissionReady ? (
        <View style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>QR scanner</Text>
          <Text style={styles.panelText}>{statusText}</Text>
        </View>
      ) : null}

      {showScanner && (unknownValue || cashuToken) ? (
        <View style={styles.resultPanel}>
          <Text style={styles.resultTitle}>
            {cashuToken ? 'Cashu token detected' : 'Unsupported QR code'}
          </Text>
          <Text style={styles.resultText} numberOfLines={3}>
            {cashuToken
              ? 'Token redemption is not wired in this RN build yet.'
              : unknownValue}
          </Text>
          <Pressable style={styles.scanAgainButton} onPress={resetScan}>
            <Text style={styles.scanAgainText}>Scan again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function createScanStyles(theme: AppTheme) {
  const contentColor = theme.colors.base100 === '#111111' ? '#ffffff' : '#1a1a1a';
  return StyleSheet.create({
  root: {
    backgroundColor: '#020617',
    flex: 1,
  },
  cameraFrame: {
    flex: 1,
    overflow: 'hidden',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.22)',
  },
  scanBox: {
    alignSelf: 'center',
    borderColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 2,
    height: 250,
    position: 'absolute',
    top: '31%',
    width: 250,
  },
  modeSwitch: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    padding: 5,
    position: 'absolute',
    top: 58,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    height: 40,
    justifyContent: 'center',
    minWidth: 104,
    paddingHorizontal: 14,
  },
  modeButtonActive: {
    backgroundColor: theme.colors.base300,
  },
  modeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  modeTextActive: {
    color: contentColor,
  },
  shareBody: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: theme.colors.base300,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 22,
    position: 'absolute',
    top: '24%',
    width: 315,
  },
  shareQrWrap: {
    alignItems: 'center',
    backgroundColor: theme.colors.base300,
    borderColor: theme.colors.base200,
    borderRadius: 18,
    borderWidth: 1,
    height: 275,
    justifyContent: 'center',
    width: 275,
  },
  emptyQr: {
    alignItems: 'center',
    backgroundColor: theme.colors.base100,
    borderRadius: 14,
    height: 255,
    justifyContent: 'center',
    width: 255,
  },
  shareTitle: {
    color: contentColor,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 16,
  },
  shareText: {
    color: theme.colors.primaryContent,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: 255,
    textAlign: 'center',
  },
  bottomPanel: {
    backgroundColor: theme.colors.base300,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    bottom: 0,
    left: 0,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 18,
    position: 'absolute',
    right: 0,
  },
  panelTitle: {
    color: contentColor,
    fontSize: 18,
    fontWeight: '800',
  },
  panelText: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  permissionBody: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: theme.colors.base300,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 24,
    position: 'absolute',
    top: '31%',
    width: 250,
  },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: theme.colors.base200,
    borderRadius: 32,
    height: 58,
    justifyContent: 'center',
    marginBottom: 12,
    width: 58,
  },
  permissionTitle: {
    color: contentColor,
    fontSize: 20,
    fontWeight: '800',
  },
  permissionText: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 20,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  resultPanel: {
    backgroundColor: theme.colors.base300,
    borderRadius: 16,
    left: 18,
    padding: 16,
    position: 'absolute',
    right: 18,
    top: '42%',
  },
  resultTitle: {
    color: contentColor,
    fontSize: 18,
    fontWeight: '800',
  },
  resultText: {
    color: theme.colors.primaryContent,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  scanAgainButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 44,
  },
  scanAgainText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  });
}
