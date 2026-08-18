/**
 * MrgPropertyBadge — kompakter Ampel-Indikator für die Liegenschaftsliste.
 *
 * Zeigt ein farbiges Icon wenn mindestens eine Einheit grenzwertig oder
 * überschritten ist. Für WEG-Liegenschaften (isMietverwaltung=false) wird
 * nichts gerendert und kein Request abgesetzt.
 *
 * Cache-Schlüssel sind identisch mit der Detailansicht (['property-units', id]
 * und ['mrg-check', tenantId]), sodass beim Wechsel in die Detailansicht
 * keine doppelten Netzwerkanfragen entstehen.
 */
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  type MrgCheck,
  type MrgStatus,
  deriveStatus,
  worstMrgStatus,
} from '@/utils/mrgStatus';

interface TenantMin {
  id: string;
  status?: string;
  grundmiete?: string | number | null;
}

interface UnitMin {
  id: string;
  tenants?: TenantMin[];
}

interface Props {
  propertyId: string;
  /** true für Mietverwaltungs-Liegenschaften — false unterdrückt alle Requests */
  isMietverwaltung: boolean;
}

export function MrgPropertyBadge({ propertyId, isMietverwaltung }: Props) {
  const { apiRequest } = useAuth();
  const colors = useColors();

  // ── Einheiten laden (gleicher Cache-Key wie Detailansicht) ────────────────
  const unitsQuery = useQuery<UnitMin[]>({
    queryKey: ['property-units', propertyId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/properties/${propertyId}/units?includeTenants=true`,
      );
      if (!res.ok) throw new Error('Einheiten konnten nicht geladen werden');
      return res.json();
    },
    enabled: isMietverwaltung,
    staleTime: 60_000,
  });

  // Aktive Mieter je Einheit (max. 1 pro Einheit, wie in der Detailansicht)
  const activeTenants: TenantMin[] = (unitsQuery.data ?? [])
    .map((u) => (u.tenants ?? []).find((t) => t.status === 'aktiv'))
    .filter((t): t is TenantMin => !!t);

  // ── MRG-Check je Mieter (gleiche Cache-Keys wie Detailansicht) ───────────
  const mrgQueries = useQueries({
    queries: activeTenants.map((t) => ({
      queryKey: ['mrg-check', t.id],
      queryFn: async (): Promise<MrgCheck> => {
        const res = await apiRequest(`/api/tenants/${t.id}/mrg-check`);
        if (!res.ok) throw new Error('MRG-Prüfung fehlgeschlagen');
        return res.json();
      },
      enabled: isMietverwaltung,
      staleTime: 60_000,
    })),
  });

  // WEG → gar nichts rendern
  if (!isMietverwaltung) return null;

  // Laden: kleiner Spinner neben dem Chevron
  const isLoading =
    unitsQuery.isLoading ||
    mrgQueries.some((q, i) => activeTenants[i] && q.isLoading);

  if (isLoading) {
    return (
      <ActivityIndicator
        size="small"
        color={colors.mutedForeground}
        style={{ marginRight: 6 }}
        testID={`mrg-badge-loading-${propertyId}`}
      />
    );
  }

  // Status je Mieter ableiten, schlechtesten ermitteln
  const statuses: MrgStatus[] = activeTenants.map((t, i) => {
    const check = mrgQueries[i]?.data;
    const grundmiete = Number(t.grundmiete) || 0;
    return deriveStatus(check, grundmiete);
  });

  const worst = worstMrgStatus(statuses);

  // ok und nicht_anwendbar → kein Badge (Liste bleibt aufgeräumt)
  if (worst === 'ok' || worst === 'nicht_anwendbar') return null;

  const badgeColor: Record<MrgStatus, string> = {
    ok:              colors.success,
    grenzwertig:     colors.warning,
    ueberschritten:  colors.destructive,
    nicht_anwendbar: colors.mutedForeground,
  };

  const badgeIcon: Record<MrgStatus, React.ComponentProps<typeof Feather>['name']> = {
    ok:              'check-circle',
    grenzwertig:     'alert-triangle',
    ueberschritten:  'x-circle',
    nicht_anwendbar: 'minus-circle',
  };

  return (
    <View style={{ marginRight: 6 }} testID={`mrg-badge-${worst}-${propertyId}`}>
      <Feather name={badgeIcon[worst]} size={18} color={badgeColor[worst]} />
    </View>
  );
}
