import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth, type ScanResult } from '@/context/AuthContext';
import { handleDataUrl } from '@/utils/galleryUtils';
import { openGallery as _openGallery, openCamera as _openCamera } from '@/utils/scanActions';
import type { NativeDeps } from '@/utils/galleryUtils';

/** Scan screen — always dark (camera aesthetic regardless of system theme). */

const DARK = {
  bg:          '#070D1A',
  card:        '#0F1E36',
  primary:     '#3B82F6',
  accent:      '#00CC8F',
  text:        '#E8F0FF',
  muted:       '#7A9DC0',
  border:      '#1A3560',
  success:     '#22C55E',
  destructive: '#EF4444',
};

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, setCurrentScan, apiRequest } = useAuth();

  const [scanning,  setScanning]  = useState(false);
  const [scanLabel, setScanLabel] = useState('');

  // Web-only: hidden file inputs (gallery + camera)
  const fileInputRef       = useRef<any>(null);
  const cameraFileInputRef = useRef<any>(null);

  function handleWebFileChange(inputRef: React.MutableRefObject<any>) {
    return (e: any) => {
      const file: File | undefined = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => {
        Alert.alert('Fehler', 'Bild konnte nicht gelesen werden.');
      };
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Delegate prefix-stripping and processOcr to the testable utility.
        // processOcr already shows an Alert on failure; catch here guards against
        // any unexpected rejection that escapes that inner try/catch.
        handleDataUrl(
          dataUrl,
          file.type,
          processOcr,
          () => { if (inputRef.current) inputRef.current.value = ''; },
        ).catch(() => {
          Alert.alert('Fehler', 'Bild konnte nicht verarbeitet werden.');
        });
      };
      reader.readAsDataURL(file);
    };
  }

  function buildNativeDeps(): NativeDeps {
    return {
      processOcr,
      requestMediaLibraryPermissions: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      requestCameraPermissions:       () => ImagePicker.requestCameraPermissionsAsync(),
      launchImageLibrary: (opts) => ImagePicker.launchImageLibraryAsync(opts as ImagePicker.ImagePickerOptions),
      launchCamera:       (opts) => ImagePicker.launchCameraAsync(opts as ImagePicker.ImagePickerOptions),
      showAlert: (title, message, buttons) =>
        Alert.alert(title, message, buttons.map(b => ({
          ...b,
          onPress: b.text === 'Einstellungen öffnen' ? () => Linking.openSettings() : b.onPress,
        }))),
    };
  }

  const webDeps = {
    clickGalleryInput: () => fileInputRef.current?.click(),
    clickCameraInput:  () => cameraFileInputRef.current?.click(),
  };

  function openGallery() {
    _openGallery(Platform.OS, webDeps, buildNativeDeps());
  }

  function openCamera() {
    _openCamera(Platform.OS, webDeps, buildNativeDeps());
  }

  // Pulsing animation for the viewfinder
  const pulse = useRef(new Animated.Value(1)).current;

  function startPulse() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }

  function stopPulse() {
    pulse.stopAnimation();
    pulse.setValue(1);
  }

  async function processOcr(base64: string, imageUri: string, mimeType: string) {
    setScanning(true);
    setScanLabel('Rechnung wird analysiert…');
    startPulse();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const res = await apiRequest('/api/functions/ocr-invoice', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Serverfehler (${res.status})`);
      }

      const json = await res.json();
      const scanResult: ScanResult = {
        data:        json.data,
        needs_review: json.needs_review ?? false,
        imageUri,
        fileName:    `ocr_${Date.now().toString()}_${Math.random().toString(36).substring(2, 7)}`,
      };

      setCurrentScan(scanResult);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/review');
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'OCR fehlgeschlagen',
        err?.message ?? 'Die Rechnung konnte nicht analysiert werden. Bitte erneut versuchen.',
        [{ text: 'OK' }]
      );
    } finally {
      setScanning(false);
      setScanLabel('');
      stopPulse();
    }
  }

  const initials = user?.fullName
    ? user.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?';

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <View style={[styles.root, { backgroundColor: DARK.bg }]}>
      {/* Web-only hidden file inputs (gallery + camera) */}
      {Platform.OS === 'web' && (
        <>
          {/* @ts-ignore — input is a valid DOM element on web */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleWebFileChange(fileInputRef)}
          />
          {/* @ts-ignore */}
          <input
            ref={cameraFileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleWebFileChange(cameraFileInputRef)}
          />
        </>
      )}
      {/* ── Top bar ─────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: topPad + 12 }]}>
        <View style={styles.topLeft}>
          <Text style={styles.appTitle}>IMMO OCR</Text>
          <Text style={styles.appSub}>Rechnungsscanner</Text>
        </View>
        <View style={styles.topRight}>
          {/* Liegenschaften (MRG-Ampel) */}
          <Pressable
            onPress={() => router.push('/properties')}
            style={styles.iconBtn}
            hitSlop={12}
            testID="btn-properties"
          >
            <Feather name="home" size={20} color={DARK.muted} />
          </Pressable>
          {/* User avatar */}
          <View style={[styles.avatar, { backgroundColor: DARK.primary }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          {/* Logout */}
          <Pressable
            onPress={() => {
              Alert.alert('Abmelden', 'Möchten Sie sich abmelden?', [
                { text: 'Abbrechen', style: 'cancel' },
                { text: 'Abmelden', style: 'destructive', onPress: async () => { await logout(); router.replace('/login'); } },
              ]);
            }}
            style={styles.iconBtn}
            hitSlop={12}
          >
            <Feather name="log-out" size={20} color={DARK.muted} />
          </Pressable>
        </View>
      </View>

      {/* ── Viewfinder ──────────────────────────────────── */}
      <View style={styles.finderArea}>
        <Animated.View style={[styles.finder, { transform: [{ scale: pulse }] }]}>
          {/* Corner brackets */}
          <View style={[styles.corner, styles.cornerTL, { borderColor: DARK.primary }]} />
          <View style={[styles.corner, styles.cornerTR, { borderColor: DARK.primary }]} />
          <View style={[styles.corner, styles.cornerBL, { borderColor: DARK.primary }]} />
          <View style={[styles.corner, styles.cornerBR, { borderColor: DARK.primary }]} />

          {/* Center icon / status */}
          {scanning ? (
            <View style={styles.finderCenter}>
              <ActivityIndicator size="large" color={DARK.primary} />
              <Text style={[styles.scanLabel, { color: DARK.text }]}>{scanLabel}</Text>
            </View>
          ) : (
            <View style={styles.finderCenter}>
              <Ionicons name="receipt-outline" size={48} color={DARK.muted} />
              <Text style={[styles.instruction, { color: DARK.muted }]}>
                Rechnung fotografieren{'\n'}oder aus Galerie wählen
              </Text>
            </View>
          )}
        </Animated.View>
      </View>

      {/* ── Bottom actions ──────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: botPad + 24 }]}>
        {/* Gallery button */}
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed || scanning ? 0.6 : 1 }]}
          onPress={openGallery}
          disabled={scanning}
          testID="btn-gallery"
        >
          <Feather name="image" size={22} color={DARK.text} />
          <Text style={[styles.secondaryBtnText, { color: DARK.text }]}>Galerie</Text>
        </Pressable>

        {/* Main camera shutter */}
        <Pressable
          style={({ pressed }) => [
            styles.shutterOuter,
            { opacity: pressed || scanning ? 0.7 : 1 },
          ]}
          onPress={openCamera}
          disabled={scanning}
          testID="btn-camera"
        >
          <View style={[styles.shutterInner, { backgroundColor: DARK.primary }]}>
            {scanning
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Ionicons name="camera" size={28} color="#FFFFFF" />
            }
          </View>
        </Pressable>

        {/* Spacer to balance layout */}
        <View style={styles.secondaryBtn} />
      </View>
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_W    = 3;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topLeft: {},
  appTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  appSub: {
    color: '#7A9DC0',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  iconBtn: {
    padding: 4,
  },
  finderArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  finder: {
    width: '100%',
    aspectRatio: 0.75,
    maxHeight: 400,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width:  CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0, left: 0,
    borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0, right: 0,
    borderTopWidth: CORNER_W, borderRightWidth: CORNER_W,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0, left: 0,
    borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0, right: 0,
    borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W,
    borderBottomRightRadius: 4,
  },
  finderCenter: {
    alignItems: 'center',
    gap: 16,
  },
  instruction: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  scanLabel: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginTop: 8,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
    paddingTop: 16,
  },
  secondaryBtn: {
    width: 64,
    alignItems: 'center',
    gap: 6,
  },
  secondaryBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: '#FFFFFF30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
