import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

interface PropertyListItem {
  id: string;
  name: string;
  address?: string;
  city?: string;
  total_units?: number;
  rented_units?: number;
}

export default function PropertiesScreen() {
  const router = useRouter();
  const colors = useColors();
  const { apiRequest } = useAuth();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<PropertyListItem[]>({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await apiRequest('/api/properties?limit=100');
      if (!res.ok) throw new Error('Liegenschaften konnten nicht geladen werden');
      const json = await res.json();
      return (json.data ?? []) as PropertyListItem[];
    },
  });

  const bottomInset = Platform.OS === 'web' ? 34 : 0;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.text }]}>
          Liegenschaften konnten nicht geladen werden.
        </Text>
        <Pressable
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => refetch()}
          testID="btn-retry-properties"
        >
          <Text style={styles.retryText}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }

  const properties = data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={properties}
        keyExtractor={(p) => p.id}
        scrollEnabled={properties.length > 0}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + bottomInset }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Feather name="home" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Keine Liegenschaften vorhanden.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => router.push(`/properties/${item.id}`)}
            testID={`property-${item.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}>
              <Feather name="home" size={20} color={colors.primary} />
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {[item.address, item.city].filter(Boolean).join(', ') || '—'}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                {item.total_units ?? 0} Einheiten · {item.rented_units ?? 0} vermietet
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorText: { fontSize: 15, textAlign: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#FFFFFF', fontWeight: '600' as const },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600' as const },
  cardSub: { fontSize: 13 },
  cardMeta: { fontSize: 12 },
});
