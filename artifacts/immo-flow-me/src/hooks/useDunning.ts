import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDemoData } from '@/contexts/DemoDataContext';
import { apiRequest } from '@/lib/queryClient';

interface DunningRequest {
  invoiceId: string;
  dunningLevel: 1 | 2;
  tenantEmail: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  amount: number;
  dueDate: string;
  invoiceMonth: number;
  invoiceYear: number;
}

export function useSendDunning() {
  const queryClient = useQueryClient();
  const { isDemoMode } = useDemoData();
  
  return useMutation({
    mutationFn: async (request: DunningRequest) => {
      if (isDemoMode) {
        toast.info('Mahnungsversand ist im Demo-Modus nicht verfügbar');
        return { message: 'Demo-Modus' };
      }
      const response = await apiRequest('POST', '/api/dunning/send', {
        invoice_id: request.invoiceId,
        dunning_level: request.dunningLevel,
        tenant_email: request.tenantEmail,
        tenant_name: request.tenantName,
        property_name: request.propertyName,
        unit_number: request.unitNumber,
        amount: request.amount,
        due_date: request.dueDate,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dunningOverview'] });
      toast.success(data.message || 'Mahnung versendet');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Fehler beim Versenden');
      console.error('Dunning error:', error);
    },
  });
}

export function getDunningStatusLabel(mahnstufe: number): string {
  switch (mahnstufe) {
    case 0: return 'Keine';
    case 1: return 'Zahlungserinnerung';
    case 2: return '1. Mahnung';
    case 3: return '2. Mahnung';
    default: return 'Unbekannt';
  }
}

export function getNextDunningAction(mahnstufe: number): { level: 1 | 2; label: string } | null {
  switch (mahnstufe) {
    case 0: return { level: 1, label: 'Zahlungserinnerung senden' };
    case 1: return { level: 2, label: 'Mahnung senden' };
    default: return null;
  }
}
