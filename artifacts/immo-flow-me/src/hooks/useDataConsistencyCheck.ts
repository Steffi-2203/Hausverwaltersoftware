import { useMemo } from 'react';
import { usePayments } from './usePayments';
import { useTransactions } from './useTransactions';
import { useAccountCategories } from './useAccountCategories';
import { useTenants } from './useTenants';

/**
 * ============================================================================
 * DATA CONSISTENCY CHECK
 * ============================================================================
 * 
 * Prüft die Konsistenz zwischen payments (SSOT für Mieteinnahmen) und 
 * transactions (Banking-Übersicht).
 * 
 * Erkannte Probleme:
 * 1. missing_transaction: Payment ohne korrespondierende Transaction
 * 2. missing_payment: Transaction (mit tenant_id + Mieteinnahmen-Kategorie) ohne Payment
 * 3. amount_mismatch: Payment und Transaction existieren, aber mit unterschiedlichen Beträgen
 * ============================================================================
 */

export interface ConsistencyIssue {
  type: 'missing_transaction' | 'missing_payment' | 'amount_mismatch';
  severity: 'warning' | 'error';
  paymentId?: string;
  transactionId?: string;
  tenantId?: string;
  tenantName?: string;
  amount?: number;
  date?: string;
  details: string;
}

export interface ConsistencyCheckResult {
  isLoading: boolean;
  hasIssues: boolean;
  issues: ConsistencyIssue[];
  paymentsWithoutTransactions: number;
  transactionsWithoutPayments: number;
  summary: {
    totalPayments: number;
    syncedPayments: number;
    unsyncedPayments: number;
    orphanedTransactions: number;
  };
}

export function useDataConsistencyCheck(): ConsistencyCheckResult {
  const { data: payments, isLoading: paymentsLoading } = usePayments();
  const { data: transactions, isLoading: transactionsLoading } = useTransactions();
  const { data: categories, isLoading: categoriesLoading } = useAccountCategories();
  const { data: tenants, isLoading: tenantsLoading } = useTenants();

  const isLoading = paymentsLoading || transactionsLoading || categoriesLoading || tenantsLoading;

  const mieteinnahmenCategory = useMemo(() => {
    return categories?.find(c => c.name === 'Mieteinnahmen' && c.type === 'income');
  }, [categories]);

  const result = useMemo(() => {
    if (isLoading || !payments || !transactions || !mieteinnahmenCategory) {
      return {
        issues: [] as ConsistencyIssue[],
        paymentsWithoutTransactions: 0,
        transactionsWithoutPayments: 0,
        summary: {
          totalPayments: 0,
          syncedPayments: 0,
          unsyncedPayments: 0,
          orphanedTransactions: 0,
        },
      };
    }

    const issues: ConsistencyIssue[] = [];
    let syncedPayments = 0;
    let unsyncedPayments = 0;
    let orphanedTransactions = 0;

    // Helper: Get tenant name
    const getTenantName = (tenantId: string) => {
      const tenant = tenants?.find(t => t.id === tenantId);
      return tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unbekannt';
    };

    // Get rent income transactions (with Mieteinnahmen category)
    const rentIncomeTransactions = transactions.filter(t =>
      t.category_id === mieteinnahmenCategory.id && 
      Number(t.amount) > 0
    );

    // Helper: Check if dates match (considering both eingangs_datum and buchungs_datum)
    const datesMatch = (paymentDate1: string | undefined, paymentDate2: string | undefined, transactionDate: string | undefined) => {
      if (!transactionDate) return false;
      return paymentDate1 === transactionDate || paymentDate2 === transactionDate;
    };

    // Prüfung 1: Payments ohne Transactions
    payments.forEach(payment => {
      // Find matching transaction by: direct link (validated) OR tenant + date + amount match
      const matchingTransaction = rentIncomeTransactions.find(t => {
        const transactionIdMatch = t.id === payment.transactionId || t.id === payment.transaction_id;
        const tenantMatch = t.tenant_id === payment.tenant_id;
        const amountMatch = Math.abs(Number(t.amount) - Number(payment.betrag)) < 0.01;
        const dateMatch = datesMatch(payment.eingangs_datum, payment.buchungs_datum, t.transaction_date);
        
        // Direct link must also validate tenant and amount to catch mismatches
        if (transactionIdMatch) {
          return tenantMatch && amountMatch;
        }
        // Otherwise require full match: tenant + date + amount
        return tenantMatch && dateMatch && amountMatch;
      });

      if (matchingTransaction) {
        syncedPayments++;
      } else {
        unsyncedPayments++;
        issues.push({
          type: 'missing_transaction',
          severity: 'warning',
          paymentId: payment.id,
          tenantId: payment.tenant_id,
          tenantName: getTenantName(payment.tenant_id),
          amount: Number(payment.betrag),
          date: payment.eingangs_datum || payment.buchungs_datum,
          details: `Zahlung nicht in Banking-Übersicht: ${getTenantName(payment.tenant_id)} - €${Number(payment.betrag).toFixed(2)} (${payment.eingangs_datum || payment.buchungs_datum})`,
        });
      }
    });

    // Prüfung 2: Transactions mit tenant_id ohne Payment
    rentIncomeTransactions.forEach(transaction => {
      if (!transaction.tenant_id) return;

      const matchingPayment = payments.find(p => {
        const transactionIdMatch = p.transactionId === transaction.id || p.transaction_id === transaction.id;
        const tenantMatch = p.tenant_id === transaction.tenant_id;
        const amountMatch = Math.abs(Number(p.betrag) - Number(transaction.amount)) < 0.01;
        const dateMatch = datesMatch(p.eingangs_datum, p.buchungs_datum, transaction.transaction_date);
        
        // Direct link must also validate tenant and amount to catch mismatches
        if (transactionIdMatch) {
          return tenantMatch && amountMatch;
        }
        // Otherwise require full match: tenant + date + amount
        return tenantMatch && dateMatch && amountMatch;
      });

      if (!matchingPayment) {
        orphanedTransactions++;
        issues.push({
          type: 'missing_payment',
          severity: 'error',
          transactionId: transaction.id,
          tenantId: transaction.tenant_id,
          tenantName: getTenantName(transaction.tenant_id),
          amount: Number(transaction.amount),
          date: transaction.transaction_date,
          details: `Transaction ohne Payment-Eintrag: ${getTenantName(transaction.tenant_id)} - €${Number(transaction.amount).toFixed(2)} (${transaction.transaction_date})`,
        });
      }
    });

    return {
      issues,
      paymentsWithoutTransactions: unsyncedPayments,
      transactionsWithoutPayments: orphanedTransactions,
      summary: {
        totalPayments: payments.length,
        syncedPayments,
        unsyncedPayments,
        orphanedTransactions,
      },
    };
  }, [payments, transactions, mieteinnahmenCategory, tenants, isLoading]);

  return {
    isLoading,
    hasIssues: result.issues.length > 0,
    ...result,
  };
}
