import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface SettlementItem {
  unitId: string;
  tenantId: string | null;
  tenantName: string;
  tenantEmail: string | null;
  isLeerstandBK: boolean;
  isLeerstandHK: boolean;
  bkAnteil: number;
  hkAnteil: number;
  bkVorschuss: number;
  hkVorschuss: number;
  bkSaldo: number;
  hkSaldo: number;
  gesamtSaldo: number;
}

export interface SaveSettlementData {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  year: number;
  totalBk: number;
  totalHk: number;
  bkMieter: number;
  hkMieter: number;
  bkEigentuemer: number;
  hkEigentuemer: number;
  items: SettlementItem[];
  sendEmails: boolean;
}

function normalizeSettlement(settlement: any) {
  const normalized = normalizeFields(settlement);
  if (normalized.items && Array.isArray(normalized.items)) {
    normalized.items = normalized.items.map((item: any) => normalizeFields(item));
  }
  return normalized;
}

export function useExistingSettlement(propertyId: string | undefined, year: number | undefined) {
  return useQuery({
    queryKey: ['settlement', propertyId, year],
    queryFn: async () => {
      if (!propertyId || !year) return null;
      
      const response = await fetch(`/api/settlements?propertyId=${propertyId}&year=${year}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch settlement');
      }
      const data = await response.json();
      return normalizeSettlement(data);
    },
    enabled: !!propertyId && !!year,
  });
}

export function useSaveSettlement() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: SaveSettlementData) => {
      const response = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      
      if (!response.ok) throw new Error('Failed to save settlement');
      const result = await response.json();
      return normalizeSettlement(result);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settlement'] });
      toast.success('Abrechnung gespeichert');
      
      // MRG-Warnungen anzeigen
      if (data.mrgDeadlineWarning) {
        toast.warning(data.mrgDeadlineWarning, { duration: 10000 });
      }
      if (data.mrgExpirationWarning) {
        toast.warning(data.mrgExpirationWarning, { duration: 10000 });
      }
    },
    onError: (error) => {
      console.error('Save settlement error:', error);
      toast.error('Fehler beim Speichern der Abrechnung');
    },
  });
}

export function useFinalizeSettlement() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ settlementId }: { settlementId: string }) => {
      const response = await fetch(`/api/settlements/${settlementId}/finalize`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to finalize settlement');
      const result = await response.json();
      return normalizeSettlement(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settlement'] });
      toast.success('Abrechnung finalisiert');
    },
    onError: (error) => {
      console.error('Finalize error:', error);
      toast.error('Fehler beim Finalisieren');
    },
  });
}
