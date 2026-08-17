import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type UnitDocument = {
  id: string;
  unit_id: string;
  name: string;
  type: string;
  file_url: string;
  uploaded_at: string;
};

export const UNIT_DOCUMENT_TYPES = [
  { value: 'mietvertrag', label: 'Mietvertrag' },
  { value: 'wohnungsplan', label: 'Wohnungsplan' },
  { value: 'uebergabeprotokoll', label: 'Übergabeprotokoll' },
  { value: 'ruecknahmeprotokoll', label: 'Rücknahmeprotokoll' },
  { value: 'mietanbot', label: 'Mietanbot' },
  { value: 'kaution', label: 'Kautionsbeleg' },
  { value: 'bonitaet', label: 'Bonitätsauskunft' },
  { value: 'ausweis', label: 'Ausweiskopie' },
  { value: 'emailverkehr', label: 'Emailverkehr' },
  { value: 'fotos', label: 'Fotos' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

function normalizeUnitDocument(doc: any) {
  return normalizeFields(doc);
}

export function useUnitDocuments(unitId: string | undefined) {
  return useQuery({
    queryKey: ['unit-documents', unitId],
    queryFn: async () => {
      if (!unitId) return [];
      const response = await fetch(`/api/units/${unitId}/documents`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch unit documents');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeUnitDocument) : [normalizeUnitDocument(data)] as UnitDocument[];
    },
    enabled: !!unitId,
  });
}

export function useUploadUnitDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      unitId,
      file,
      documentType,
      documentName,
    }: {
      unitId: string;
      file: File;
      documentType: string;
      documentName: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', documentType);
      formData.append('name', documentName);

      const response = await fetch(`/api/units/${unitId}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to upload document');
      const data = await response.json();
      return normalizeUnitDocument(data);
    },
    onSuccess: (_, { unitId }) => {
      queryClient.invalidateQueries({ queryKey: ['unit-documents', unitId] });
      toast({
        title: 'Dokument hochgeladen',
        description: 'Das Dokument wurde erfolgreich gespeichert.',
      });
    },
    onError: (error) => {
      console.error('Upload error:', error);
      toast({
        title: 'Fehler beim Hochladen',
        description: 'Das Dokument konnte nicht hochgeladen werden.',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteUnitDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, unitId }: { id: string; unitId: string; fileUrl: string }) => {
      await apiRequest('DELETE', `/api/unit-documents/${id}`);
    },
    onSuccess: (_, { unitId }) => {
      queryClient.invalidateQueries({ queryKey: ['unit-documents', unitId] });
      toast({
        title: 'Dokument gelöscht',
        description: 'Das Dokument wurde erfolgreich gelöscht.',
      });
    },
    onError: () => {
      toast({
        title: 'Fehler',
        description: 'Das Dokument konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
    },
  });
}
