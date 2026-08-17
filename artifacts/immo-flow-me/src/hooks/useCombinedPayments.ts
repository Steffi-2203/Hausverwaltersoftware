import { useMemo } from 'react';
import { usePayments } from './usePayments';
import { useTransactions } from './useTransactions';

/**
 * Interface for unified payment data
 * 
 * SINGLE SOURCE OF TRUTH ARCHITECTURE:
 * - `payments` table: Contains rent payments, supports invoice_id for allocation
 * - `transactions` table: Contains ALL bank transactions (income + expenses)
 * 
 * For rent income, we use ONLY payments table as the source.
 * Transactions with tenant_id are synced FROM payments, not the other way around.
 * This prevents double-counting and maintains clear data ownership.
 */
export interface CombinedPayment {
  id: string;
  tenantId: string;
  tenant_id: string; // Alias for backwards compatibility
  amount: number;
  date: string;
  source: 'payments';
  description?: string;
  reference?: string;
  invoiceId?: string | null;
  invoice_id?: string | null; // Alias for backwards compatibility
}

/**
 * Hook that returns rent payments from the payments table ONLY.
 * 
 * IMPORTANT: This is the Single Source of Truth for rent income.
 * The transactions table may contain synced copies, but payments is authoritative.
 * 
 * Why payments over transactions for rent:
 * 1. payments has invoice_id for proper allocation tracking
 * 2. payments has zahlungsart (payment type) metadata
 * 3. payments is specifically designed for tenant rent tracking
 * 4. Avoids duplicate counting issues
 */
export function useCombinedPayments() {
  const { data: payments, isLoading: paymentsLoading } = usePayments();

  const combinedPayments = useMemo(() => {
    const combined: CombinedPayment[] = [];
    
    // Use ONLY payments table as source of truth for rent income
    (payments || []).forEach((p: any) => {
      const tenantId = p.tenantId ?? p.tenant_id;
      const invoiceId = p.invoiceId ?? p.invoice_id;
      combined.push({
        id: p.id,
        tenantId: tenantId,
        tenant_id: tenantId, // Alias for backwards compatibility
        amount: Number(p.betrag),
        date: p.eingangsDatum || p.buchungsDatum,
        source: 'payments',
        reference: p.verwendungszweck || undefined,
        invoiceId: invoiceId,
        invoice_id: invoiceId, // Alias for backwards compatibility
      });
    });
    
    return combined;
  }, [payments]);

  return {
    data: combinedPayments,
    isLoading: paymentsLoading,
  };
}

/**
 * Get combined payments filtered by tenant and period
 */
export function useCombinedPaymentsByTenant(
  tenantId: string,
  year: number,
  month?: number
) {
  const { data: allPayments, isLoading } = useCombinedPayments();
  
  const filtered = useMemo(() => {
    return (allPayments || []).filter(p => {
      if ((p.tenantId ?? p.tenant_id) !== tenantId) return false;
      
      const date = new Date(p.date);
      const paymentYear = date.getFullYear();
      const paymentMonth = date.getMonth() + 1;
      
      if (month === undefined) {
        return paymentYear === year;
      }
      return paymentYear === year && paymentMonth === month;
    });
  }, [allPayments, tenantId, year, month]);
  
  return { data: filtered, isLoading };
}

/**
 * Get combined payments for a specific period
 */
export function useCombinedPaymentsForPeriod(
  year: number,
  month?: number,
  propertyUnitIds?: string[] | null,
  tenants?: { id: string; unitId?: string; unit_id?: string }[]
) {
  const { data: allPayments, isLoading } = useCombinedPayments();
  
  const filtered = useMemo(() => {
    return (allPayments || []).filter(p => {
      const date = new Date(p.date);
      const paymentYear = date.getFullYear();
      const paymentMonth = date.getMonth() + 1;
      
      // Period filter
      if (month === undefined) {
        if (paymentYear !== year) return false;
      } else {
        if (paymentYear !== year || paymentMonth !== month) return false;
      }
      
      // Property filter (via tenant's unit) - support both camelCase and snake_case
      if (propertyUnitIds && tenants) {
        const paymentTenantId = p.tenantId ?? p.tenant_id;
        const tenant = tenants.find(t => t.id === paymentTenantId);
        const tenantUnitId = tenant?.unitId ?? tenant?.unit_id;
        if (!tenant || !tenantUnitId || !propertyUnitIds.includes(tenantUnitId)) {
          return false;
        }
      }
      
      return true;
    });
  }, [allPayments, year, month, propertyUnitIds, tenants]);
  
  return { data: filtered, isLoading };
}

/**
 * Hook to get income from transactions (for Banking reports, NOT rent)
 * Use this for non-rent income that comes directly from bank imports.
 * 
 * This is separate from rent payments to maintain clear data boundaries.
 */
export function useTransactionIncome(propertyId?: string | null) {
  const { data: transactions, isLoading } = useTransactions();
  
  const income = useMemo(() => {
    return (transactions || []).filter(t => {
      // Only positive amounts (income)
      if (Number(t.amount) <= 0) return false;
      
      // Exclude transactions that have tenant_id (those are rent, handled by payments) - support both field names
      const tAny = t as any;
      const tenantId = tAny.tenantId ?? t.tenant_id;
      if (tenantId) return false;
      
      // Property filter if specified - support both field names
      const txPropertyId = t.propertyId ?? t.property_id;
      if (propertyId && txPropertyId !== propertyId) return false;
      
      return true;
    });
  }, [transactions, propertyId]);
  
  return { data: income, isLoading };
}
