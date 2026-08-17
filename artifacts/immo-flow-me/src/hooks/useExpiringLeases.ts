import { useQuery } from '@tanstack/react-query';

export interface ExpiringLease {
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  befristungEnde: string;        // ISO date "YYYY-MM-DD"
  daysUntilExpiry: number;       // negative = already expired
  unitTopNummer: string;
  unitId: string;
  propertyName: string;
  propertyId: string;
}

export function useExpiringLeases(daysAhead: number = 90) {
  return useQuery<ExpiringLease[]>({
    queryKey: ['expiring-leases', daysAhead],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/expiring-leases?days=${daysAhead}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Auslaufende Mietverträge konnten nicht geladen werden');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 Minuten
  });
}
