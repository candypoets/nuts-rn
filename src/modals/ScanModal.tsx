import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from 'expo-camera';
import {ArrowLeft, Camera, X} from 'lucide-react-native';
import {nip19} from 'nostr-tools';

import type {RootStackParamList} from '../navigation/types';

type ScanModalProps = {
  onClose: () => void;
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
  if (!nextValue.startsWith('npub')) return null;

  try {
    const decoded = nip19.decode(nextValue);
    return decoded.type === 'npub' ? decoded.data : null;
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

export function ScanModal({onClose}: ScanModalProps) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [permission] = useCameraPermissions();
  const [unknownValue, setUnknownValue] = useState<string | null>(null);
  const [cashuToken, setCashuToken] = useState<string | null>(null);
  const lockedRef = useRef(false);

  const permissionReady = permission?.granted;

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

  const statusText = useMemo(() => {
    if (!permission) return 'Checking camera permission';
    if (!permission.granted) return 'Camera access is needed to scan payment QR codes';
    return 'Point the camera at a Lightning, LNURL, Cashu, or Nostr QR code';
  }, [permission]);

  return (
    <View style={styles.root}>
      <View style={styles.cameraFrame}>
        {permissionReady ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{barcodeTypes: ['qr']}}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : (
          <View style={styles.permissionBody}>
            <View style={styles.permissionIcon}>
              <Camera size={30} color="#1f7a5a" strokeWidth={2.2} />
            </View>
            <Text style={styles.permissionTitle}>Scan QR codes</Text>
            <Text style={styles.permissionText}>{statusText}</Text>
            <Pressable style={styles.permissionButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.permissionButtonText}>Allow camera</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.scrim} pointerEvents="none" />
        {permissionReady ? (
          <View style={styles.scanBox} pointerEvents="none" />
        ) : null}
      </View>

      <View style={styles.topBar}>
        <Pressable style={styles.iconButton} hitSlop={12} onPress={onClose}>
          <ArrowLeft size={22} color="#ffffff" strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.title}>Scan</Text>
        <Pressable style={styles.iconButton} hitSlop={12} onPress={onClose}>
          <X size={22} color="#ffffff" strokeWidth={2.3} />
        </Pressable>
      </View>

      {permissionReady ? (
        <View style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>QR scanner</Text>
          <Text style={styles.panelText}>{statusText}</Text>
        </View>
      ) : null}

      {unknownValue || cashuToken ? (
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

const styles = StyleSheet.create({
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
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 58,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  bottomPanel: {
    backgroundColor: '#ffffff',
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
    color: '#17212b',
    fontSize: 18,
    fontWeight: '800',
  },
  panelText: {
    color: '#52616f',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  permissionBody: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.94)',
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
    backgroundColor: '#ecfdf5',
    borderRadius: 32,
    height: 58,
    justifyContent: 'center',
    marginBottom: 12,
    width: 58,
  },
  permissionTitle: {
    color: '#17212b',
    fontSize: 20,
    fontWeight: '800',
  },
  permissionText: {
    color: '#52616f',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionButton: {
    alignItems: 'center',
    backgroundColor: '#1f7a5a',
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
    backgroundColor: '#ffffff',
    borderRadius: 16,
    left: 18,
    padding: 16,
    position: 'absolute',
    right: 18,
    top: '42%',
  },
  resultTitle: {
    color: '#17212b',
    fontSize: 18,
    fontWeight: '800',
  },
  resultText: {
    color: '#52616f',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  scanAgainButton: {
    alignItems: 'center',
    backgroundColor: '#17212b',
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
