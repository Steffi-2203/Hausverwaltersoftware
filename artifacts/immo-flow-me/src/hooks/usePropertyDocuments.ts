import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { normalizeFields } from '@/utils/fieldNormalizer';

export type PropertyDocument = {
  id: string;
  property_id: string;
  name: string;
  type: string;
  file_url: string;
  uploaded_at: string;
};

export const PROPERTY_DOCUMENT_TYPES = [
  { value: 'energieausweis', label: 'Energieausweis' },
  { value: 'wohnungsplaene', label: 'Wohnungspläne' },
  { value: 'gebaeudeplan', label: 'Gebäudeplan' },
  { value: 'grundbuchauszug', label: 'Grundbuchauszug' },
  { value: 'lageplan', label: 'Lageplan' },
  { value: 'versicherungspolizze', label: 'Versicherungspolizze' },
  { value: 'nutzungsvertrag', label: 'Nutzungsvertrag' },
  { value: 'hausverwaltung', label: 'Hausverwaltung' },
  { value: 'protokolle', label: 'Protokolle' },
  { value: 'benutzerdefiniert', label: 'Benutzerdefiniert' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

function normalizePropertyDocument(doc: any) {
  return normalizeFields(doc);
}

export function usePropertyDocuments(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-documents', propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const response = await fetch(`/api/properties/${propertyId}/documents`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch property documents');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizePropertyDocument) : [normalizePropertyDocument(data)] as PropertyDocument[];
    },
    enabled: !!propertyId,
  });
}

export function useUploadPropertyDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      propertyId,
      file,
      documentType,
      documentName,
    }: {
      propertyId: string;
      file: File;
      documentType: string;
      documentName: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', documentType);
      formData.append('name', documentName);

      const response = await fetch(`/api/properties/${propertyId}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to upload document');
      const data = await response.json();
      return normalizePropertyDocument(data);
    },
    onSuccess: (_, { propertyId }) => {
      queryClient.invalidateQueries({ queryKey: ['property-documents', propertyId] });
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

export function useDeletePropertyDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, propertyId }: { id: string; propertyId: string; fileUrl: string }) => {
      await apiRequest('DELETE', `/api/property-documents/${id}`);
    },
    onSuccess: (_, { propertyId }) => {
      queryClient.invalidateQueries({ queryKey: ['property-documents', propertyId] });
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
