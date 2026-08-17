import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

interface UpdateAdvancesParams {
  propertyId: string;
  totalBkKosten: number;
  totalHkKosten: number;
  units: Array<{
    id: string;
    qm: number;
    mea: number;
    currentTenantId: string | null;
  }>;
  totals: {
    qm: number;
    mea: number;
  };
}

export function useUpdateNewAdvances() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ propertyId, totalBkKosten, totalHkKosten, units, totals }: UpdateAdvancesParams) => {
      const response = await apiRequest('POST', '/api/advances/update', {
        propertyId,
        totalBkKosten,
        totalHkKosten,
        units,
        totals,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['units'] });
      toast.success(`Neue Vorschreibungen für ${data.updatedCount} Mieter aktualisiert`);
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Vorschreibungen');
      console.error('Update advances error:', error);
    },
  });
}
