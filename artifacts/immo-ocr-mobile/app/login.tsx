import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import baseColors from '@/constants/colors';

const RADIUS = baseColors.radius;

export default function LoginScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { login } = useAuth();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const styles = makeStyles(colors, insets);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await login(email.trim().toLowerCase(), password);
      router.replace('/scan');
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err?.message ?? 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo area */}
        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
            <Image
              source={require('../assets/images/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.appName, { color: colors.foreground }]}>IMMO OCR Scanner</Text>
          <Text style={[styles.appSub, { color: colors.mutedForeground }]}>für IMMO FLOW ME</Text>
        </View>

        {/* Form card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Anmelden</Text>

          {error && (
            <View style={[styles.errorBox, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>E-Mail</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
            placeholder="name@beispiel.at"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            testID="input-email"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Passwort</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            testID="input-password"
          />

          <Pressable
            style={({ pressed }) => [
              styles.loginButton,
              { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 },
            ]}
            onPress={handleLogin}
            disabled={loading}
            testID="btn-login"
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.loginButtonText}>Anmelden</Text>
            }
          </Pressable>
        </View>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Gleiche Zugangsdaten wie im Web-Portal verwenden.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 24),
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24),
      justifyContent: 'center',
    },
    logoArea: {
      alignItems: 'center',
      marginBottom: 32,
    },
    logoBox: {
      width: 80,
      height: 80,
      borderRadius: RADIUS * 2.5,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      shadowColor: '#0066CC',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
    },
    logoImage: {
      width: 56,
      height: 56,
    },
    appName: {
      fontSize: 24,
      marginBottom: 4,
    },
    appSub: {
      fontSize: 14,
    },
    card: {
      borderRadius: RADIUS * 1.5,
      borderWidth: 1,
      padding: 24,
      marginBottom: 16,
    },
    cardTitle: {
      fontSize: 20,
      marginBottom: 20,
    },
    errorBox: {
      borderWidth: 1,
      borderRadius: RADIUS,
      padding: 12,
      marginBottom: 16,
    },
    errorText: {
      fontSize: 14,
    },
    label: {
      fontSize: 13,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderRadius: RADIUS,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      marginBottom: 16,
    },
    loginButton: {
      borderRadius: RADIUS,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    loginButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
    },
    hint: {
      textAlign: 'center',
      fontSize: 13,
    },
  });
