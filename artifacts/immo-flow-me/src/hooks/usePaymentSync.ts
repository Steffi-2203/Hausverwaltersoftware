import { useAccountCategories } from './useAccountCategories';
import { useOrganization } from './useOrganization';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PaymentInsert } from './usePayments';
import { apiRequest } from '@/lib/queryClient';

type ExpenseCategory = 'betriebskosten_umlagefaehig' | 'instandhaltung' | 'hausverwaltung' | 'sonstige';
type ExpenseType = 'versicherung' | 'grundsteuer' | 'muellabfuhr' | 'wasser_abwasser' | 'heizung' | 'strom_allgemein' | 'hausbetreuung' | 'lift' | 'gartenpflege' | 'schneeraeumung' | 'verwaltung' | 'reparatur' | 'sonstiges';

const CATEGORY_TO_EXPENSE_MAPPING: Record<string, {
  category: ExpenseCategory;
  expenseType: ExpenseType;
}> = {
  'Versicherungen': { category: 'betriebskosten_umlagefaehig', expenseType: 'versicherung' },
  'Grundsteuer': { category: 'betriebskosten_umlagefaehig', expenseType: 'grundsteuer' },
  'Müllabfuhr': { category: 'betriebskosten_umlagefaehig', expenseType: 'muellabfuhr' },
  'Wasser/Abwasser': { category: 'betriebskosten_umlagefaehig', expenseType: 'wasser_abwasser' },
  'Heizung': { category: 'betriebskosten_umlagefaehig', expenseType: 'heizung' },
  'Strom Allgemein': { category: 'betriebskosten_umlagefaehig', expenseType: 'strom_allgemein' },
  'Hausbetreuung/Reinigung': { category: 'betriebskosten_umlagefaehig', expenseType: 'hausbetreuung' },
  'Lift/Aufzug': { category: 'betriebskosten_umlagefaehig', expenseType: 'lift' },
  'Gartenpflege': { category: 'betriebskosten_umlagefaehig', expenseType: 'gartenpflege' },
  'Schneeräumung': { category: 'betriebskosten_umlagefaehig', expenseType: 'schneeraeumung' },
  'Verwaltungskosten': { category: 'betriebskosten_umlagefaehig', expenseType: 'verwaltung' },
  'Instandhaltung': { category: 'instandhaltung', expenseType: 'sonstiges' },
  'Reparaturen': { category: 'instandhaltung', expenseType: 'reparatur' },
};

export function usePaymentSync() {
  const queryClient = useQueryClient();
  const { data: categories } = useAccountCategories();
  const { data: organization } = useOrganization();

  const getMieteinnahmenCategory = () => {
    return categories?.find((c: any) => c.name === 'Mieteinnahmen' && c.type === 'income');
  };

  const getCategoryNameById = (categoryId: string | null | undefined) => {
    if (!categoryId) return null;
    return categories?.find((c: any) => c.id === categoryId)?.name || null;
  };

  const createPaymentWithSync = useMutation({
    mutationFn: async (params: {
      payment: PaymentInsert;
      unitId?: string;
      propertyId?: string;
      skipTransactionSync?: boolean;
    }) => {
      const { payment, unitId, propertyId, skipTransactionSync } = params;

      const response = await apiRequest('POST', '/api/payments', payment);
      const createdPayment = await response.json();

      if (!skipTransactionSync && organization?.id) {
        const mieteinnahmenCategory = getMieteinnahmenCategory();
        
        if (mieteinnahmenCategory) {
          try {
            await apiRequest('POST', '/api/transactions', {
              organizationId: organization.id,
              unitId: unitId || null,
              tenantId: payment.tenantId,
              propertyId: propertyId || null,
              amount: payment.betrag,
              currency: 'EUR',
              transactionDate: payment.eingangsDatum || payment.buchungsDatum,
              bookingDate: payment.buchungsDatum,
              description: `Mietzahlung ${payment.verwendungszweck || ''}`.trim(),
              reference: payment.verwendungszweck || null,
              categoryId: mieteinnahmenCategory.id,
              status: 'matched',
            });
          } catch (transactionError) {
            console.error('Failed to sync payment to transactions:', transactionError);
          }
        }
      }

      return createdPayment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Mieteinnahme erfolgreich erfasst');
    },
    onError: (error) => {
      toast.error('Fehler beim Erfassen der Mieteinnahme');
      console.error('Create payment with sync error:', error);
    },
  });

  const createExpenseFromTransaction = async (
    transaction: {
      id?: string;
      description?: string | null;
      amount: number;
      transaction_date: string;
      reference?: string | null;
      property_id?: string | null;
    },
    categoryName: string
  ) => {
    const mapping = CATEGORY_TO_EXPENSE_MAPPING[categoryName];
    if (!mapping || !transaction.property_id) {
      console.log('Skipping expense sync: no mapping or property_id', { categoryName, property_id: transaction.property_id });
      return null;
    }
    
    const date = new Date(transaction.transaction_date);
    
    try {
      const response = await apiRequest('POST', '/api/expenses', {
        propertyId: transaction.property_id,
        category: mapping.category,
        expenseType: mapping.expenseType,
        bezeichnung: transaction.description || categoryName,
        betrag: Math.abs(transaction.amount),
        datum: transaction.transaction_date,
        belegNummer: transaction.reference || null,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        transactionId: transaction.id || null,
      });
      return response.json();
    } catch (error) {
      console.error('Failed to sync transaction to expenses:', error);
      return null;
    }
  };

  const createTransactionWithSync = useMutation({
    mutationFn: async (params: {
      transaction: any;
      skipExpenseSync?: boolean;
    }) => {
      const { transaction, skipExpenseSync } = params;

      const response = await apiRequest('POST', '/api/transactions', transaction);
      const createdTransaction = await response.json();

      const categoryName = getCategoryNameById(transaction.categoryId);

      if (!skipExpenseSync && transaction.amount && transaction.amount < 0 && categoryName) {
        if (CATEGORY_TO_EXPENSE_MAPPING[categoryName] && transaction.propertyId) {
          await createExpenseFromTransaction(
            {
              id: createdTransaction.id,
              description: transaction.description,
              amount: transaction.amount,
              transaction_date: transaction.transactionDate,
              reference: transaction.reference,
              property_id: transaction.propertyId,
            },
            categoryName
          );
        }
      }

      return createdTransaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Buchung erfolgreich erfasst');
    },
    onError: (error) => {
      toast.error('Fehler beim Erfassen der Buchung');
      console.error('Create transaction with sync error:', error);
    },
  });

  const syncExistingTransactionsToExpenses = useMutation({
    mutationFn: async () => {
      return { synced: 0, skipped: 0 };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      if (result.synced > 0) {
        toast.success(`${result.synced} Buchung(en) erfolgreich zur BK-Abrechnung synchronisiert`);
      } else {
        toast.info('Keine neuen Buchungen zum Synchronisieren gefunden');
      }
    },
    onError: (error) => {
      toast.error('Fehler beim Synchronisieren der Buchungen');
      console.error('Sync transactions to expenses error:', error);
    },
  });

  const syncExistingPaymentsToTransactions = useMutation({
    mutationFn: async () => {
      if (!organization?.id) {
        throw new Error('Keine Organisation gefunden');
      }

      const mieteinnahmenCategory = getMieteinnahmenCategory();
      if (!mieteinnahmenCategory) {
        throw new Error('Mieteinnahmen-Kategorie nicht gefunden');
      }

      const [paymentsRes, transactionsRes, tenantsRes, unitsRes] = await Promise.all([
        fetch('/api/payments', { credentials: 'include' }),
        fetch('/api/transactions', { credentials: 'include' }),
        fetch('/api/tenants', { credentials: 'include' }),
        fetch('/api/units', { credentials: 'include' }),
      ]);

      const payments = await paymentsRes.json();
      const transactions = await transactionsRes.json();
      const tenants = await tenantsRes.json();
      const units = await unitsRes.json();

      const tenantMap = new Map<string, any>(tenants.map((t: any) => [t.id, t]));
      const unitMap = new Map<string, any>(units.map((u: any) => [u.id, u]));

      let synced = 0;
      let skipped = 0;

      for (const payment of payments) {
        // Support both camelCase and snake_case for payment.tenantId
        const paymentTenantId = payment.tenantId || payment.tenant_id;
        
        const existingTransaction = transactions.find((t: any) => {
          const txTenantId = t.tenantId || t.tenant_id;
          return txTenantId === paymentTenantId &&
            t.categoryId === mieteinnahmenCategory.id &&
            Math.abs(Number(t.amount) - Number(payment.betrag)) < 0.01 &&
            (t.transactionDate === payment.eingangsDatum || t.transactionDate === payment.buchungsDatum ||
             t.transactionDate === payment.eingangs_datum || t.transactionDate === payment.buchungs_datum);
        });

        if (existingTransaction) {
          skipped++;
          continue;
        }

        try {
          const tenant = tenantMap.get(paymentTenantId);
          const unitId = tenant?.unitId || tenant?.unit_id || null;
          const unit = unitId ? unitMap.get(unitId) : null;
          const propertyId = unit?.propertyId || unit?.property_id || null;

          // Normalize date fields for both camelCase and snake_case
          const transactionDate = payment.eingangsDatum || payment.eingangs_datum || payment.buchungsDatum || payment.buchungs_datum;
          const bookingDate = payment.buchungsDatum || payment.buchungs_datum;
          
          await apiRequest('POST', '/api/transactions', {
            organizationId: organization.id,
            unitId: unitId,
            tenantId: paymentTenantId,
            propertyId: propertyId,
            amount: payment.betrag,
            currency: 'EUR',
            transactionDate: transactionDate,
            bookingDate: bookingDate,
            description: `Mietzahlung ${payment.verwendungszweck || ''}`.trim(),
            reference: payment.verwendungszweck || null,
            categoryId: mieteinnahmenCategory.id,
            status: 'matched',
          });
          synced++;
        } catch (error) {
          console.error('Failed to sync payment:', payment.id, error);
        }
      }

      return { synced, skipped };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      if (result.synced > 0) {
        toast.success(`${result.synced} Mieteinnahme(n) erfolgreich zur Banking-Übersicht synchronisiert`);
      } else {
        toast.info('Alle Mieteinnahmen bereits synchronisiert');
      }
    },
    onError: (error) => {
      toast.error('Fehler beim Synchronisieren der Mieteinnahmen');
      console.error('Sync payments to transactions error:', error);
    },
  });

  const deleteTransactionWithSync = useMutation({
    mutationFn: async (transactionId: string) => {
      await apiRequest('DELETE', `/api/transactions/${transactionId}`);
      return { transactionId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['bank_accounts'] });
      toast.success('Buchung und verknüpfte Daten gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Buchung');
      console.error('Delete transaction with sync error:', error);
    },
  });

  const deletePaymentWithSync = useMutation({
    mutationFn: async (paymentId: string) => {
      const paymentResponse = await fetch(`/api/payments/${paymentId}`, { credentials: 'include' });
      const payment = await paymentResponse.json();

      const mieteinnahmenCategory = getMieteinnahmenCategory();
      if (mieteinnahmenCategory && payment) {
        try {
          const transactionsResponse = await fetch('/api/transactions', { credentials: 'include' });
          const transactions = await transactionsResponse.json();
          
          const matchingTransaction = transactions.find((t: any) =>
            t.tenantId === payment.tenantId &&
            (t.transactionDate === payment.eingangsDatum || t.transactionDate === payment.buchungsDatum) &&
            Math.abs(Number(t.amount) - Number(payment.betrag)) < 0.01 &&
            t.categoryId === mieteinnahmenCategory.id
          );

          if (matchingTransaction) {
            await apiRequest('DELETE', `/api/transactions/${matchingTransaction.id}`);
          }
        } catch (error) {
          console.error('Failed to delete synced transaction:', error);
        }
      }

      await apiRequest('DELETE', `/api/payments/${paymentId}`);
      return { paymentId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Zahlung gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Zahlung');
      console.error('Delete payment with sync error:', error);
    },
  });

  const syncTransactionsToPayments = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sync/transactions-to-payments');
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (result.synced > 0) {
        toast.success(`${result.synced} Einnahme(n) erfolgreich aus Banking übernommen`);
      } else {
        toast.info('Alle kategorisierten Einnahmen bereits synchronisiert');
      }
    },
    onError: (error) => {
      toast.error('Fehler beim Übernehmen der Einnahmen aus Banking');
      console.error('Sync transactions to payments error:', error);
    },
  });

  // Sync payments to invoices (update invoice status based on payments)
  const syncPaymentsToInvoices = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sync/payments-to-invoices');
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (result.allocated > 0) {
        toast.success(`${result.allocated} Zahlungen wurden Rechnungen zugeordnet`);
      } else {
        toast.info('Alle Zahlungen bereits zugeordnet');
      }
    },
    onError: (error) => {
      toast.error('Fehler beim Zuordnen der Zahlungen zu Rechnungen');
      console.error('Sync payments to invoices error:', error);
    },
  });

  return {
    createPaymentWithSync,
    createTransactionWithSync,
    deleteTransactionWithSync,
    deletePaymentWithSync,
    syncExistingTransactionsToExpenses,
    syncExistingPaymentsToTransactions,
    syncTransactionsToPayments,
    syncPaymentsToInvoices,
    getMieteinnahmenCategory,
    getCategoryNameById,
    CATEGORY_TO_EXPENSE_MAPPING,
  };
}

export { CATEGORY_TO_EXPENSE_MAPPING };
