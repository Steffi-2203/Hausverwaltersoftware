import { useQuery } from '@tanstack/react-query';

export interface DunningInvoice {
  id: string;
  month: number;
  year: number;
  gesamtbetrag: number;
  faellig_am: string;
  mahnstufe: number;
  zahlungserinnerung_am: string | null;
  mahnung_am: string | null;
}

export interface DunningCase {
  tenantId: string;
  tenantName: string;
  email: string | null;
  phone: string | null;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  invoices: DunningInvoice[];
  totalAmount: number;
  highestMahnstufe: number;
  oldestOverdue: string;
}

export interface DunningStats {
  totalCases: number;
  totalOpen: number;
  totalReminded: number;
  totalDunned: number;
  totalAmount: number;
}

export function useDunningOverview() {
  return useQuery({
    queryKey: ['dunningOverview'],
    queryFn: async () => {
      const response = await fetch('/api/dunning-overview', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch dunning overview');
      return response.json() as Promise<{ cases: DunningCase[]; stats: DunningStats }>;
    },
  });
}

export function getDaysOverdue(dueDate: string): number {
  const due = new Date(dueDate);
  const today = new Date();
  const diffTime = today.getTime() - due.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}
