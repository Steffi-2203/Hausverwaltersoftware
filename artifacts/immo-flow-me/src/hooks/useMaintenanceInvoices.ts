import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface MaintenanceInvoice {
  id: string;
  organization_id: string | null;
  maintenance_task_id: string | null;
  invoice_number: string | null;
  invoice_date: string;
  amount: number;
  contractor_name: string;
  status: 'pending' | 'pre_approved' | 'approved' | 'rejected' | 'paid';
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  document_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  pre_approved_by: string | null;
  pre_approved_at: string | null;
  final_approved_by: string | null;
  final_approved_at: string | null;
  maintenance_tasks?: {
    title: string;
    properties?: { name: string } | null;
  } | null;
}

function normalizeMaintenanceInvoice(invoice: any) {
  const normalized = normalizeFields(invoice);
  if (normalized.maintenance_tasks) {
    normalized.maintenance_tasks = normalizeFields(normalized.maintenance_tasks);
    if (normalized.maintenance_tasks.properties) {
      normalized.maintenance_tasks.properties = normalizeFields(normalized.maintenance_tasks.properties);
    }
  }
  return normalized;
}

export function useMaintenanceInvoices(status?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['maintenance-invoices', user?.id, status],
    queryFn: async () => {
      const url = status && status !== 'all' 
        ? `/api/maintenance-invoices?status=${status}` 
        : '/api/maintenance-invoices';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch maintenance invoices');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeMaintenanceInvoice) : [normalizeMaintenanceInvoice(data)] as MaintenanceInvoice[];
    },
    enabled: !!user?.id,
  });
}

export function usePendingInvoices() {
  return useMaintenanceInvoices('pending');
}

export function usePreApprovedInvoices() {
  return useMaintenanceInvoices('pre_approved');
}

export function usePreApproveInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await apiRequest('POST', `/api/maintenance-invoices/${invoiceId}/pre-approve`, {});
      const data = await response.json();
      return normalizeMaintenanceInvoice(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-invoices'] });
      toast({
        title: 'Vorfreigabe erteilt',
        description: 'Die Rechnung wartet jetzt auf die finale Freigabe (Vier-Augen-Prinzip).',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Vorfreigabe konnte nicht erteilt werden.',
        variant: 'destructive',
      });
      console.error('Error pre-approving invoice:', error);
    },
  });
}

export function useApproveInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await apiRequest('POST', `/api/maintenance-invoices/${invoiceId}/approve`, {});
      const data = await response.json();
      return normalizeMaintenanceInvoice(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast({
        title: 'Rechnung final freigegeben',
        description: 'Die Rechnung wurde zur Zahlung freigegeben und verbucht (Vier-Augen-Prinzip erfüllt).',
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Die Rechnung konnte nicht freigegeben werden.';
      toast({
        title: 'Fehler',
        description: message,
        variant: 'destructive',
      });
      console.error('Error approving invoice:', error);
    },
  });
}

export function useRejectInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ invoiceId, reason }: { invoiceId: string; reason: string }) => {
      const response = await apiRequest('POST', `/api/maintenance-invoices/${invoiceId}/reject`, { reason });
      const data = await response.json();
      return normalizeMaintenanceInvoice(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-invoices'] });
      toast({
        title: 'Rechnung abgelehnt',
        description: 'Die Rechnung wurde abgelehnt.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Rechnung konnte nicht abgelehnt werden.',
        variant: 'destructive',
      });
      console.error('Error rejecting invoice:', error);
    },
  });
}

export function useCreateMaintenanceInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoice: {
      maintenance_task_id: string;
      invoice_number?: string;
      invoice_date: string;
      amount: number;
      contractor_name: string;
      document_url?: string;
      notes?: string;
    }) => {
      const response = await apiRequest('POST', '/api/maintenance-invoices', invoice);
      const data = await response.json();
      return normalizeMaintenanceInvoice(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-invoices'] });
      toast({
        title: 'Rechnung erstellt',
        description: 'Die Rechnung wurde erfolgreich erstellt.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Fehler',
        description: 'Die Rechnung konnte nicht erstellt werden.',
        variant: 'destructive',
      });
      console.error('Error creating invoice:', error);
    },
  });
}
