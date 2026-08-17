import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface InsurancePolicy {
  id: string;
  organization_id: string | null;
  property_id: string;
  insurance_type: string;
  provider: string;
  policy_number: string | null;
  coverage_amount: number | null;
  annual_premium: number | null;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsuranceClaim {
  id: string;
  organization_id: string | null;
  insurance_policy_id: string;
  property_id: string;
  unit_id: string | null;
  claim_date: string;
  description: string;
  damage_amount: number | null;
  reimbursed_amount: number | null;
  status: 'gemeldet' | 'in_bearbeitung' | 'genehmigt' | 'abgelehnt' | 'erledigt';
  claim_number: string | null;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useInsurancePolicies(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/insurance/policies', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/insurance/policies${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<InsurancePolicy[]>;
    },
  });
}

export function useCreateInsurancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (policy: Omit<InsurancePolicy, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await apiRequest('POST', '/api/insurance/policies', policy);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance/policies'] });
      toast.success('Versicherung angelegt');
    },
    onError: () => toast.error('Fehler beim Anlegen'),
  });
}

export function useUpdateInsurancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<InsurancePolicy>) => {
      const res = await apiRequest('PATCH', `/api/insurance/policies/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance/policies'] });
      toast.success('Versicherung aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });
}

export function useDeleteInsurancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/insurance/policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance/policies'] });
      toast.success('Versicherung gelöscht');
    },
    onError: () => toast.error('Fehler'),
  });
}

export function useInsuranceClaims(policyId?: string) {
  return useQuery({
    queryKey: ['/api/insurance/claims', policyId],
    queryFn: async () => {
      const params = policyId ? `?policyId=${policyId}` : '';
      const res = await fetch(`/api/insurance/claims${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<InsuranceClaim[]>;
    },
  });
}

export function useAllInsuranceClaims() {
  return useQuery({
    queryKey: ['/api/insurance/claims'],
    queryFn: async () => {
      const res = await fetch('/api/insurance/claims', { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<InsuranceClaim[]>;
    },
  });
}

export function useCreateInsuranceClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (claim: Omit<InsuranceClaim, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await apiRequest('POST', '/api/insurance/claims', claim);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance/claims'] });
      toast.success('Schadensmeldung erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateInsuranceClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<InsuranceClaim>) => {
      const res = await apiRequest('PATCH', `/api/insurance/claims/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance/claims'] });
      toast.success('Schadensmeldung aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });
}
