import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export interface ClauseSection {
  id: string;
  title: string;
  content: string;
  required: boolean;
}

export interface LeaseTemplate {
  id: string;
  name: string;
  description: string;
  clauses: ClauseSection[];
}

export interface GenerateContractInput {
  templateId: string;
  tenantId?: string;
  unitId?: string;
  propertyId?: string;
  leaseStart: string;
  leaseEnd: string | null;
  monthlyRent: number;
  operatingCosts: number;
  deposit: number;
  selectedClauses: string[];
  customNotes: string;
}

export interface GeneratedContract {
  templateId: string;
  templateName: string;
  mieterName: string;
  vermieterName: string;
  adresse: string;
  topNummer: string;
  flaeche: string;
  miete: string;
  betriebskosten: string;
  kaution: string;
  mietbeginn: string;
  mietende: string;
  clauses: ClauseSection[];
  customNotes: string;
  generatedAt: string;
}

export function useLeaseTemplates() {
  return useQuery<LeaseTemplate[]>({
    queryKey: ['lease-templates'],
    queryFn: async () => {
      const response = await fetch('/api/lease-templates', { credentials: 'include' });
      if (!response.ok) throw new Error('Fehler beim Laden der Vorlagen');
      return response.json();
    },
  });
}

export function useGenerateContract() {
  return useMutation<GeneratedContract, Error, GenerateContractInput>({
    mutationFn: async (input) => {
      const response = await apiRequest('POST', '/api/lease-contracts/generate', input);
      return response.json();
    },
  });
}

export function useGenerateContractPdf() {
  return useMutation<Blob, Error, GenerateContractInput>({
    mutationFn: async (input) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      if (csrfMatch) headers['x-csrf-token'] = decodeURIComponent(csrfMatch[1]);

      const response = await fetch('/api/lease-contracts/generate-pdf', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Fehler bei der PDF-Erstellung');
      return response.blob();
    },
  });
}
