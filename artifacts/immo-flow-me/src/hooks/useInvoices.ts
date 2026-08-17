import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

function normalizeInvoice(invoice: any) {
  const normalized = normalizeFields(invoice);
  if (normalized.tenants) {
    normalized.tenants = normalizeFields(normalized.tenants);
    if (normalized.tenants.units) {
      normalized.tenants.units = normalizeFields(normalized.tenants.units);
    }
  }
  return normalized;
}

export { unwrapList } from '@/utils/unwrapList';

export interface Invoice {
  id: string;
  tenantId: string;
  year: number;
  month: number;
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  sonstigeKosten: number;
  gesamtbetrag: number;
  ustMiete: number;
  ustBetriebskosten: number;
  ustHeizung: number;
  status: 'offen' | 'bezahlt' | 'mahnung' | 'teilbezahlt';
  /** Bereits bezahlter Anteil (Status 'teilbezahlt'/'bezahlt'); null = nicht gesetzt. */
  paidAmount: number | string | null;
  bezahltAm: string | null;
  faelligAm: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tenants?: {
    firstName: string;
    lastName: string;
    unitId: string;
    units?: {
      topNummer: string;
      propertyId: string;
      properties?: { name: string };
    };
  };
}

export type InvoiceInsert = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'tenants'>;
export type InvoiceUpdate = Partial<InvoiceInsert>;

export function useInvoices(year?: number, month?: number) {
  return useQuery({
    queryKey: ['invoices', year, month],
    staleTime: 60000,
    gcTime: 300000,
    queryFn: async () => {
      let url = '/api/invoices';
      const params = new URLSearchParams();
      if (year) params.append('year', year.toString());
      if (month) params.append('month', month.toString());
      if (params.toString()) url += `?${params.toString()}`;
      
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const invoices = unwrapList(await response.json());
      
      const [tenantsRes, unitsRes, propsRes] = await Promise.all([
        fetch('/api/tenants', { credentials: 'include' }),
        fetch('/api/units', { credentials: 'include' }),
        fetch('/api/properties', { credentials: 'include' })
      ]);
      
      if (tenantsRes.ok && unitsRes.ok && propsRes.ok) {
        const tenants = unwrapList(await tenantsRes.json());
        const units = unwrapList(await unitsRes.json());
        const properties = unwrapList(await propsRes.json());
        
        return invoices.map((invoice: Invoice) => {
          const invoiceTenantId = invoice.tenantId ?? (invoice as any).tenant_id;
          const tenant = tenants.find((t: any) => t.id === invoiceTenantId);
          const tenantUnitId = tenant?.unitId ?? tenant?.unit_id;
          const unit = tenant ? units.find((u: any) => u.id === tenantUnitId) : null;
          const unitPropertyId = unit?.propertyId ?? unit?.property_id;
          const property = unit ? properties.find((p: any) => p.id === unitPropertyId) : null;
          
          return normalizeInvoice({
            ...invoice,
            tenants: tenant ? {
              firstName: tenant.firstName ?? tenant.first_name,
              lastName: tenant.lastName ?? tenant.last_name,
              unitId: tenantUnitId,
              units: unit ? {
                topNummer: unit.topNummer ?? unit.top_nummer,
                propertyId: unitPropertyId,
                properties: property ? { name: property.name } : undefined
              } : undefined
            } : undefined
          });
        });
      }
      
      return invoices.map(normalizeInvoice);
    },
  });
}

export function useInvoicesByTenant(tenantId: string) {
  return useQuery({
    queryKey: ['invoices', 'tenant', tenantId],
    queryFn: async () => {
      const response = await fetch(`/api/tenants/${tenantId}/invoices`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const invoices = unwrapList(await response.json());
      return invoices.map(normalizeInvoice);
    },
    enabled: !!tenantId,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invoice: InvoiceInsert) => {
      const response = await apiRequest('POST', '/api/invoices', invoice);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Vorschreibung erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der Vorschreibung');
      console.error('Create invoice error:', error);
    },
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: InvoiceUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/invoices/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Vorschreibung aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Vorschreibung');
      console.error('Update invoice error:', error);
    },
  });
}

export function useGenerateInvoices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ year, month }: { year?: number; month?: number }) => {
      const response = await fetch('/api/functions/generate-monthly-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ year, month }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Fehler bei der Vorschreibungsgenerierung');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useUpdateInvoiceStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      bezahltAm 
    }: { 
      id: string; 
      status: Invoice['status']; 
      bezahltAm?: string;
    }) => {
      const updateData: InvoiceUpdate = { status };
      if (bezahltAm) {
        updateData.bezahltAm = bezahltAm;
      }

      const response = await apiRequest('PATCH', `/api/invoices/${id}`, updateData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Vorschreibung gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Vorschreibung');
      console.error('Delete invoice error:', error);
    },
  });
}
