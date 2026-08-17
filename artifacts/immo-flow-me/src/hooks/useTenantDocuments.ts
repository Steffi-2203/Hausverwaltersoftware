import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type TenantDocument = {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  file_url: string;
  uploaded_at: string;
};

export type TenantDocumentWithTenant = TenantDocument & {
  tenant_name: string;
  unit_id: string;
  property_id: string;
};

export const TENANT_DOCUMENT_TYPES = [
  { value: 'vorschreibung', label: 'Monatliche Vorschreibung' },
  { value: 'vorschuss_aenderung', label: 'Vorschuss-Änderungsschreiben' },
  { value: 'bk_abrechnung', label: 'Betriebskostenabrechnung' },
  { value: 'mietvertrag', label: 'Mietvertrag' },
  { value: 'mahnung', label: 'Mahnung' },
  { value: 'korrespondenz', label: 'Korrespondenz' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

function normalizeTenantDocument(doc: any) {
  return normalizeFields(doc);
}

export function useTenantDocuments(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant-documents', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const response = await fetch(`/api/tenants/${tenantId}/documents`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tenant documents');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTenantDocument) : [normalizeTenantDocument(data)] as TenantDocument[];
    },
    enabled: !!tenantId,
  });
}

export function useAllTenantDocuments() {
  return useQuery({
    queryKey: ['all-tenant-documents'],
    queryFn: async () => {
      const response = await fetch('/api/tenant-documents', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch all tenant documents');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeTenantDocument) : [normalizeTenantDocument(data)] as TenantDocumentWithTenant[];
    },
  });
}

export function useUploadTenantDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tenantId,
      file,
      name,
      type,
    }: {
      tenantId: string;
      file: File | Blob;
      name: string;
      type: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);
      formData.append('type', type);

      const response = await fetch(`/api/tenants/${tenantId}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to upload document');
      const data = await response.json();
      return normalizeTenantDocument(data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-documents', variables.tenantId] });
      toast.success('Dokument hochgeladen');
    },
    onError: (error) => {
      console.error('Upload error:', error);
      toast.error('Fehler beim Hochladen des Dokuments');
    },
  });
}

export function useDeleteTenantDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, tenantId }: { id: string; tenantId: string; fileUrl: string }) => {
      await apiRequest('DELETE', `/api/tenant-documents/${id}`);
      return { id, tenantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-documents', data.tenantId] });
      toast.success('Dokument gelöscht');
    },
    onError: (error) => {
      console.error('Delete error:', error);
      toast.error('Fehler beim Löschen des Dokuments');
    },
  });
}
