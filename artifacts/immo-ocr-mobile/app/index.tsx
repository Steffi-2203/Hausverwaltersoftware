import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

/**
 * Entry point — redirects to /login or /scan based on auth state.
 */
export default function IndexScreen() {
  const { token, isLoading } = useAuth();
  const router  = useRouter();
  const colors  = useColors();

  useEffect(() => {
    if (isLoading) return;
    if (token) {
      router.replace('/scan');
    } else {
      router.replace('/login');
    }
  }, [token, isLoading]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
