import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export const VS_COLUMN_TO_KEY_CODE: Record<string, string> = {
  personenAnzahl: 'PERSONEN',
  wasserVerbrauch: 'VERBRAUCH',
  heizungVerbrauch: 'VERBRAUCH',
  stromVerbrauch: 'VERBRAUCH',
  gasVerbrauch: 'VERBRAUCH',
  sondernutzung: 'SONDERNUTZUNG',
};

export interface UnitDistributionValue {
  id: string;
  unitId: string;
  keyId: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

interface DistributionKeyWithValue {
  id: string;
  keyCode: string;
  name: string;
  inputType: string;
  unit: string;
  isActive: boolean;
  value: number;
}

export function useUnitDistributionValues(unitId: string | undefined) {
  return useQuery<UnitDistributionValue[]>({
    queryKey: ['/api/units', unitId, 'distribution-values'],
    enabled: !!unitId,
  });
}

export function usePropertyDistributionValues(propertyId: string | undefined) {
  return useQuery<UnitDistributionValue[]>({
    queryKey: ['/api/properties', propertyId, 'distribution-values'],
    enabled: !!propertyId,
  });
}

export function useDistributionKeysWithValues(unitId: string | undefined) {
  const queryClient = useQueryClient();
  
  return useQuery<DistributionKeyWithValue[]>({
    queryKey: ['distribution-keys-with-values', unitId],
    queryFn: async () => {
      const keysResponse = await fetch('/api/distribution-keys', { credentials: 'include' });
      if (!keysResponse.ok) throw new Error('Failed to fetch distribution keys');
      const keys = await keysResponse.json();
      
      let values: UnitDistributionValue[] = [];
      if (unitId) {
        const valuesResponse = await fetch(`/api/units/${unitId}/distribution-values`, { credentials: 'include' });
        if (valuesResponse.ok) {
          values = await valuesResponse.json();
        }
      }
      
      return (keys || []).map((key: any) => {
        const valueRecord = values.find(v => v.keyId === key.id);
        return {
          id: key.id,
          keyCode: key.keyCode,
          name: key.name,
          inputType: key.inputType,
          unit: key.unit,
          isActive: key.isActive,
          value: valueRecord ? parseFloat(valueRecord.value) : 0,
        };
      });
    },
    enabled: true,
  });
}

export function useSaveUnitDistributionValue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ unitId, keyId, value }: { unitId: string; keyId: string; value: number }) => {
      return apiRequest('POST', `/api/units/${unitId}/distribution-values`, { keyId, value });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/units', variables.unitId, 'distribution-values'] });
      queryClient.invalidateQueries({ queryKey: ['distribution-keys-with-values', variables.unitId] });
    },
  });
}

export function useSaveUnitDistributionValues() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      unitId, 
      values 
    }: { 
      unitId: string; 
      values: { keyId: string; value: number }[] 
    }) => {
      const nonZeroValues = values.filter(v => v.value !== 0);
      const zeroValues = values.filter(v => v.value === 0);
      
      const savePromises = nonZeroValues.map(v => 
        apiRequest('POST', `/api/units/${unitId}/distribution-values`, { keyId: v.keyId, value: v.value })
      );
      const deletePromises = zeroValues.map(v => 
        apiRequest('DELETE', `/api/units/${unitId}/distribution-values/${v.keyId}`).catch(() => {})
      );
      
      await Promise.all([...savePromises, ...deletePromises]);
      return true;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/units', variables.unitId, 'distribution-values'] });
      queryClient.invalidateQueries({ queryKey: ['distribution-keys-with-values', variables.unitId] });
    },
  });
}

export function useDeleteUnitDistributionValue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ unitId, keyId }: { unitId: string; keyId: string }) => {
      return apiRequest('DELETE', `/api/units/${unitId}/distribution-values/${keyId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/units', variables.unitId, 'distribution-values'] });
      queryClient.invalidateQueries({ queryKey: ['distribution-keys-with-values', variables.unitId] });
    },
  });
}
