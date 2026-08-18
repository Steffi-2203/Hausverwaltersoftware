import React, { useState } from 'react';
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
import { useLocalSearchParams } from 'expo-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  type MrgCheck,
  type MrgStatus,
  deriveStatus,
  STATUS_META,
} from '@/utils/mrgStatus';

// ── Types ────────────────────────────────────────────────────────────────────

interface TenantLite {
  id: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  grundmiete?: string | number | null;
}

interface UnitWithTenants {
  id: string;
  topNummer?: string;
  flaeche?: string | number | null;
  tenants?: TenantLite[];
}

function formatEur(v: number): string {
  return v.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { apiRequest } = useAuth();
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);

  const statusColor: Record<MrgStatus, string> = {
    ok: colors.success,
    grenzwertig: colors.warning,
    ueberschritten: colors.destructive,
    nicht_anwendbar: colors.mutedForeground,
  };

  const propertyQuery = useQuery<{
    name?: string;
    address?: string;
    city?: string;
    managementType?: string;
    management_type?: string;
  }>({
    queryKey: ['property', id],
    queryFn: async () => {
      const res = await apiRequest(`/api/properties/${id}`);
      if (!res.ok) throw new Error('Liegenschaft konnte nicht geladen werden');
      return res.json();
    },
    enabled: !!id,
  });

  const unitsQuery = useQuery<UnitWithTenants[]>({
    queryKey: ['property-units', id],
    queryFn: async () => {
      const res = await apiRequest(`/api/properties/${id}/units?includeTenants=true`);
      if (!res.ok) throw new Error('Einheiten konnten nicht geladen werden');
      return res.json();
    },
    enabled: !!id,
  });

  const units = unitsQuery.data ?? [];

  // MRG-Richtwert applies only to Mietverwaltung properties (same gate as web).
  const mgmtType =
    propertyQuery.data?.managementType ?? propertyQuery.data?.management_type;
  const isMietverwaltung = mgmtType === 'mietverwaltung';

  // One active tenant per unit (same rule as web)
  const rows = units.map((unit) => {
    const activeTenant = (unit.tenants ?? []).find((t) => t.status === 'aktiv') ?? null;
    return { unit, activeTenant };
  });

  const mrgQueries = useQueries({
    queries: rows.map(({ activeTenant }) => ({
      queryKey: ['mrg-check', activeTenant?.id],
      queryFn: async (): Promise<MrgCheck> => {
        const res = await apiRequest(`/api/tenants/${activeTenant!.id}/mrg-check`);
        if (!res.ok) throw new Error('MRG-Prüfung fehlgeschlagen');
        return res.json();
      },
      enabled: isMietverwaltung && !!activeTenant,
      staleTime: 60_000,
    })),
  });

  const mrgLoading =
    isMietverwaltung && mrgQueries.some((q, i) => rows[i].activeTenant && q.isLoading);

  const unitRows = rows.map(({ unit, activeTenant }, i) => {
    const check = isMietverwaltung && activeTenant ? mrgQueries[i].data : undefined;
    const failed = isMietverwaltung && !!activeTenant && mrgQueries[i].isError;
    const grundmiete = Number(activeTenant?.grundmiete) || 0;
    const status: MrgStatus | null =
      isMietverwaltung && activeTenant && !failed
        ? deriveStatus(check, grundmiete)
        : null;
    return { unit, activeTenant, check, status, failed, grundmiete };
  });

  const counters = {
    ok: unitRows.filter((r) => r.status === 'ok').length,
    grenzwertig: unitRows.filter((r) => r.status === 'grenzwertig').length,
    ueberschritten: unitRows.filter((r) => r.status === 'ueberschritten').length,
  };

  const bottomInset = Platform.OS === 'web' ? 34 : 0;

  if (propertyQuery.isLoading || unitsQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (unitsQuery.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.text }]}>
          Einheiten konnten nicht geladen werden.
        </Text>
        <Pressable
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => unitsQuery.refetch()}
          testID="btn-retry-units"
        >
          <Text style={styles.retryText}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }

  const property = propertyQuery.data;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={unitRows}
        keyExtractor={(r) => r.unit.id}
        scrollEnabled={unitRows.length > 0}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + bottomInset }}
        refreshControl={
          <RefreshControl
            refreshing={unitsQuery.isRefetching}
            onRefresh={() => {
              unitsQuery.refetch();
              mrgQueries.forEach((q) => q.refetch());
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 16 }}>
            {/* Property header */}
            <View>
              <Text style={[styles.propName, { color: colors.text }]}>{property?.name ?? ''}</Text>
              <Text style={[styles.propAddr, { color: colors.mutedForeground }]}>
                {[property?.address, property?.city].filter(Boolean).join(', ')}
              </Text>
            </View>

            {/* MRG summary card — nur für Mietverwaltung (wie im Web) */}
            {isMietverwaltung && (
            <View
              style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              testID="mrg-summary-card"
            >
              <View style={styles.summaryHeader}>
                <Feather name="shield" size={16} color={colors.primary} />
                <Text style={[styles.summaryTitle, { color: colors.text }]}>MRG-Richtwert-Prüfung</Text>
                {mrgLoading && <ActivityIndicator size="small" color={colors.primary} />}
              </View>
              <View style={styles.summaryRow}>
                {(['ok', 'grenzwertig', 'ueberschritten'] as const).map((s) => (
                  <View key={s} style={styles.summaryItem} testID={`mrg-counter-${s}`}>
                    <Text style={[styles.summaryCount, { color: statusColor[s] }]}>{counters[s]}</Text>
                    <View style={styles.summaryLabelRow}>
                      <Feather name={STATUS_META[s].icon} size={12} color={statusColor[s]} />
                      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
                        {STATUS_META[s].label}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              EINHEITEN ({unitRows.length})
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Feather name="grid" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Keine Einheiten vorhanden.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const { unit, activeTenant, check, status, failed, grundmiete } = item;
          const expanded = expandedUnit === unit.id;
          const dotColor = status ? statusColor[status] : colors.mutedForeground;
          return (
            <Pressable
              style={[styles.unitCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setExpandedUnit(expanded ? null : unit.id)}
              testID={`unit-${unit.id}`}
            >
              <View style={styles.unitRow}>
                <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.unitTitle, { color: colors.text }]}>
                    {unit.topNummer ?? 'Einheit'}
                  </Text>
                  <Text style={[styles.unitSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {activeTenant
                      ? `${activeTenant.firstName ?? ''} ${activeTenant.lastName ?? ''}`.trim() || 'Aktiver Mieter'
                      : 'Kein aktiver Mieter'}
                  </Text>
                </View>
                {status && (
                  <View style={[styles.badge, { backgroundColor: dotColor + '22' }]}>
                    <Text style={[styles.badgeText, { color: dotColor }]}>
                      {STATUS_META[status].label}
                    </Text>
                  </View>
                )}
                {failed && (
                  <View style={[styles.badge, { backgroundColor: colors.destructive + '22' }]}>
                    <Text style={[styles.badgeText, { color: colors.destructive }]}>Fehler</Text>
                  </View>
                )}
                <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
              </View>

              {expanded && (
                <View style={[styles.detail, { borderTopColor: colors.border }]}>
                  {!isMietverwaltung ? (
                    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                      Die MRG-Richtwert-Prüfung gilt nur für Mietverwaltungs-Liegenschaften.
                    </Text>
                  ) : !activeTenant ? (
                    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                      Ohne aktiven Mieter ist keine MRG-Prüfung möglich.
                    </Text>
                  ) : failed ? (
                    <Text style={[styles.detailText, { color: colors.destructive }]}>
                      MRG-Prüfung konnte nicht geladen werden.
                    </Text>
                  ) : !check ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={{ gap: 6 }}>
                      <DetailRow label="Grundmiete" value={formatEur(grundmiete)} colors={colors} />
                      <DetailRow
                        label="Zulässiger Hauptmietzins"
                        value={check.zulassigerHmz !== null ? formatEur(check.zulassigerHmz) : '—'}
                        colors={colors}
                      />
                      {check.zulassigerHmz !== null && (
                        <DetailRow
                          label="Differenz"
                          value={`${check.differenz > 0 ? '+' : ''}${formatEur(check.differenz)}`}
                          colors={colors}
                          valueColor={check.differenz > 0 ? colors.destructive : colors.success}
                        />
                      )}
                      <Text style={[styles.basis, { color: colors.mutedForeground }]}>
                        {check.berechnungsgrundlage}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function DetailRow({
  label,
  value,
  colors,
  valueColor,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  valueColor?: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: valueColor ?? colors.text }]}>{value}</Text>
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
  propName: { fontSize: 22, fontWeight: '700' as const },
  propAddr: { fontSize: 14, marginTop: 2 },
  summaryCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { fontSize: 15, fontWeight: '600' as const, flex: 1 },
  summaryRow: { flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryCount: { fontSize: 24, fontWeight: '700' as const },
  summaryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryLabel: { fontSize: 11 },
  sectionTitle: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.8 },
  unitCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  unitTitle: { fontSize: 15, fontWeight: '600' as const },
  unitSub: { fontSize: 12, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' as const },
  detail: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 13, fontWeight: '600' as const },
  detailText: { fontSize: 13 },
  basis: { fontSize: 11, marginTop: 4 },
});
