import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface Contractor {
  id: string;
  organization_id: string | null;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  specializations: string[];
  rating: number | null;
  notes: string | null;
  is_active: boolean;
  iban: string | null;
  bic: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractorInsert = Omit<Contractor, 'id' | 'created_at' | 'updated_at'>;
export type ContractorUpdate = Partial<ContractorInsert>;

export const SPECIALIZATIONS = [
  { value: 'sanitaer', label: 'Sanitär / Installateur' },
  { value: 'elektro', label: 'Elektriker' },
  { value: 'heizung', label: 'Heizungstechniker' },
  { value: 'klima', label: 'Klimaanlagen' },
  { value: 'aufzug', label: 'Aufzugstechnik' },
  { value: 'maler', label: 'Maler / Anstreicher' },
  { value: 'tischler', label: 'Tischler / Schreiner' },
  { value: 'schlosser', label: 'Schlosser / Metallbau' },
  { value: 'dachdecker', label: 'Dachdecker' },
  { value: 'garten', label: 'Garten / Außenanlagen' },
  { value: 'reinigung', label: 'Gebäudereinigung' },
  { value: 'hausmeister', label: 'Hausmeister / Facility' },
  { value: 'brandschutz', label: 'Brandschutz' },
  { value: 'sicherheit', label: 'Sicherheitstechnik' },
  { value: 'sonstige', label: 'Sonstige' },
] as const;

function normalizeContractor(contractor: any) {
  return normalizeFields(contractor);
}

export function useContractors(onlyActive = true) {
  return useQuery({
    queryKey: ['contractors', { onlyActive }],
    queryFn: async () => {
      const url = onlyActive ? '/api/contractors?active=true' : '/api/contractors';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch contractors');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeContractor) : [normalizeContractor(data)] as Contractor[];
    },
  });
}

export function useContractor(id: string | undefined) {
  return useQuery({
    queryKey: ['contractors', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await fetch(`/api/contractors/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch contractor');
      const data = await response.json();
      return normalizeContractor(data) as Contractor;
    },
    enabled: !!id,
  });
}

export function useCreateContractor() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (contractor: ContractorInsert) => {
      const response = await apiRequest('POST', '/api/contractors', contractor);
      const data = await response.json();
      return normalizeContractor(data) as Contractor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractors'] });
      toast.success('Handwerker erfolgreich angelegt');
    },
    onError: (error) => {
      toast.error('Fehler beim Anlegen des Handwerkers');
      console.error('Create contractor error:', error);
    },
  });
}

export function useUpdateContractor() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: ContractorUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/contractors/${id}`, updates);
      const data = await response.json();
      return normalizeContractor(data) as Contractor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractors'] });
      toast.success('Handwerker erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Handwerkers');
      console.error('Update contractor error:', error);
    },
  });
}

export function useDeleteContractor() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/contractors/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractors'] });
      toast.success('Handwerker erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Handwerkers');
      console.error('Delete contractor error:', error);
    },
  });
}

export function getSpecializationLabel(value: string): string {
  const spec = SPECIALIZATIONS.find(s => s.value === value);
  return spec?.label || value;
}
