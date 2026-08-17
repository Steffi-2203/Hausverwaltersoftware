import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/context/AuthContext';
import { setBaseUrl } from '@workspace/api-client-react';

// Inject API base URL before any component mounts
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack>
      <Stack.Screen name="index"  options={{ headerShown: false }} />
      <Stack.Screen name="login"  options={{ headerShown: false }} />
      <Stack.Screen name="scan"   options={{ headerShown: false }} />
      <Stack.Screen
        name="properties/index"
        options={{
          title:          'Liegenschaften',
          headerBackTitle: 'Zurück',
          headerTintColor: '#0066CC',
        }}
      />
      <Stack.Screen
        name="properties/[id]"
        options={{
          title:          'Liegenschaft',
          headerBackTitle: 'Zurück',
          headerTintColor: '#0066CC',
        }}
      />
      <Stack.Screen
        name="review"
        options={{
          title:          'Rechnung prüfen',
          headerBackTitle: 'Zurück',
          headerTintColor: '#0066CC',
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
