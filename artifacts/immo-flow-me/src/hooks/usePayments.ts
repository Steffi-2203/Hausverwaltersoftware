import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { allocatePayment, formatAllocationForDisplay, type InvoiceAmounts } from '@/lib/paymentAllocation';

export interface Payment {
  id: string;
  tenantId: string;
  tenant_id: string;
  invoiceId: string | null;
  invoice_id: string | null;
  betrag: string;
  buchungsDatum: string;
  buchungs_datum: string;
  eingangsDatum?: string;
  eingangs_datum?: string;
  paymentType: 'sepa' | 'ueberweisung' | 'bar' | 'sonstiges';
  payment_type: string;
  verwendungszweck: string | null;
  transactionId: string | null;
  transaction_id: string | null;
  notizen: string | null;
  createdAt: string;
  created_at: string;
  tenants?: {
    firstName: string;
    first_name: string;
    lastName: string;
    last_name: string;
    unitId: string;
    unit_id: string;
    units?: {
      topNummer: string;
      top_nummer: string;
      propertyId: string;
      property_id: string;
      properties?: { name: string };
    };
  };
}

function normalizePayment(p: any): Payment {
  return {
    ...p,
    tenantId: p.tenantId ?? p.tenant_id ?? '',
    tenant_id: p.tenantId ?? p.tenant_id ?? '',
    invoiceId: p.invoiceId ?? p.invoice_id ?? null,
    invoice_id: p.invoiceId ?? p.invoice_id ?? null,
    buchungsDatum: p.buchungsDatum ?? p.buchungs_datum ?? '',
    buchungs_datum: p.buchungsDatum ?? p.buchungs_datum ?? '',
    eingangsDatum: p.eingangsDatum ?? p.eingangs_datum ?? undefined,
    eingangs_datum: p.eingangsDatum ?? p.eingangs_datum ?? undefined,
    paymentType: p.paymentType ?? p.payment_type ?? 'ueberweisung',
    payment_type: p.paymentType ?? p.payment_type ?? 'ueberweisung',
    transactionId: p.transactionId ?? p.transaction_id ?? null,
    transaction_id: p.transactionId ?? p.transaction_id ?? null,
    createdAt: p.createdAt ?? p.created_at ?? '',
    created_at: p.createdAt ?? p.created_at ?? '',
  };
}

export type PaymentInsert = Omit<Payment, 'id' | 'createdAt' | 'tenants'>;
export type PaymentUpdate = Partial<PaymentInsert>;

export interface PaymentWithAllocation extends Payment {
  allocation?: {
    betriebskosten_anteil: number;
    heizung_anteil: number;
    miete_anteil: number;
    ust_anteil: number;
    beschreibung: string;
  };
}

export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    staleTime: 60000,
    gcTime: 300000,
    queryFn: async () => {
      const response = await fetch('/api/payments', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch payments');
      const payments = await response.json();
      
      const [tenantsRes, unitsRes, propsRes] = await Promise.all([
        fetch('/api/tenants', { credentials: 'include' }),
        fetch('/api/units', { credentials: 'include' }),
        fetch('/api/properties', { credentials: 'include' })
      ]);
      
      if (tenantsRes.ok && unitsRes.ok && propsRes.ok) {
        const tenants = await tenantsRes.json();
        const units = await unitsRes.json();
        const properties = await propsRes.json();
        
        return payments.map((payment: any) => {
          const normalizedPayment = normalizePayment(payment);
          const paymentTenantId = normalizedPayment.tenantId ?? normalizedPayment.tenant_id;
          const tenant = tenants.find((t: any) => t.id === paymentTenantId);
          const tenantUnitId = tenant?.unitId ?? tenant?.unit_id;
          const unit = tenantUnitId ? units.find((u: any) => u.id === tenantUnitId) : null;
          const unitPropertyId = unit?.propertyId ?? unit?.property_id;
          const property = unitPropertyId ? properties.find((p: any) => p.id === unitPropertyId) : null;
          
          return {
            ...normalizedPayment,
            tenants: tenant ? {
              firstName: tenant.firstName ?? tenant.first_name,
              first_name: tenant.firstName ?? tenant.first_name,
              lastName: tenant.lastName ?? tenant.last_name,
              last_name: tenant.lastName ?? tenant.last_name,
              unitId: tenantUnitId,
              unit_id: tenantUnitId,
              units: unit ? {
                topNummer: unit.topNummer ?? unit.top_nummer,
                top_nummer: unit.topNummer ?? unit.top_nummer,
                propertyId: unitPropertyId,
                property_id: unitPropertyId,
                properties: property ? { name: property.name } : undefined
              } : undefined
            } : undefined
          };
        });
      }
      
      return payments.map(normalizePayment);
    },
  });
}

export function usePaymentsByTenant(tenantId?: string) {
  return useQuery({
    queryKey: ['payments', 'tenant', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const response = await fetch(`/api/tenants/${tenantId}/payments`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch payments');
      const payments = await response.json();
      return payments.map(normalizePayment);
    },
    enabled: !!tenantId,
  });
}

export function usePaymentsWithAllocation(invoiceId?: string) {
  return useQuery({
    queryKey: ['payments', 'allocation', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      
      const [invoiceRes, paymentsRes] = await Promise.all([
        fetch(`/api/invoices/${invoiceId}`, { credentials: 'include' }),
        fetch(`/api/invoices/${invoiceId}/payments`, { credentials: 'include' })
      ]);
      
      if (!invoiceRes.ok) throw new Error('Failed to fetch invoice');
      
      const invoice = await invoiceRes.json();
      const payments = paymentsRes.ok ? await paymentsRes.json() : [];
      
      let remainingInvoice: InvoiceAmounts = {
        grundmiete: invoice.grundmiete,
        betriebskosten: invoice.betriebskosten,
        heizungskosten: invoice.heizungskosten,
        gesamtbetrag: invoice.gesamtbetrag
      };
      
      const paymentsWithAllocation: PaymentWithAllocation[] = payments.map((payment: Payment) => {
        const result = allocatePayment(parseFloat(payment.betrag), remainingInvoice);
        
        remainingInvoice = {
          betriebskosten: Math.max(0, remainingInvoice.betriebskosten - result.allocation.betriebskosten_anteil / 1.10),
          heizungskosten: Math.max(0, remainingInvoice.heizungskosten - result.allocation.heizung_anteil / 1.20),
          grundmiete: Math.max(0, remainingInvoice.grundmiete - result.allocation.miete_anteil),
          gesamtbetrag: 0
        };
        remainingInvoice.gesamtbetrag = 
          remainingInvoice.betriebskosten + 
          remainingInvoice.heizungskosten + 
          remainingInvoice.grundmiete;
        
        return {
          ...payment,
          allocation: {
            betriebskosten_anteil: result.allocation.betriebskosten_anteil,
            heizung_anteil: result.allocation.heizung_anteil,
            miete_anteil: result.allocation.miete_anteil,
            ust_anteil: result.allocation.ust_anteil,
            beschreibung: result.beschreibung
          }
        };
      });
      
      return paymentsWithAllocation;
    },
    enabled: !!invoiceId,
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payment: PaymentInsert) => {
      const response = await apiRequest('POST', '/api/payments', payment);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Zahlung erfasst');
    },
    onError: (error) => {
      toast.error('Fehler beim Erfassen der Zahlung');
      console.error('Create payment error:', error);
    },
  });
}

export function useUpdatePayment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: PaymentUpdate & { id: string }) => {
      const response = await apiRequest('PATCH', `/api/payments/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Zahlung aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Zahlung');
      console.error('Update payment error:', error);
    },
  });
}

export function useDeletePayment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Zahlung gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Zahlung');
      console.error('Delete payment error:', error);
    },
  });
}
