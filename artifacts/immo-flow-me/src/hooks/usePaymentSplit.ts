import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface PaymentSplitResult {
  bkAmount: number;
  hkAmount: number;
  mietAmount: number;
  unterzahlung: number;
  splits: Array<{
    category_id: string;
    amount: number;
    description: string;
  }>;
}

export function calculatePaymentSplit(
  paymentAmount: number,
  bkSoll: number,
  hkSoll: number,
  mieteSoll: number,
  categories: { bkCategoryId: string; hkCategoryId: string; mieteCategoryId: string }
): PaymentSplitResult {
  let remaining = paymentAmount;
  
  const bkAmount = Math.min(remaining, bkSoll);
  remaining -= bkAmount;
  
  const hkAmount = Math.min(remaining, hkSoll);
  remaining -= hkAmount;
  
  const mietAmount = remaining;
  
  const totalSoll = bkSoll + hkSoll + mieteSoll;
  const unterzahlung = Math.max(0, totalSoll - paymentAmount);
  
  const splits: PaymentSplitResult['splits'] = [];
  
  if (bkAmount > 0) {
    splits.push({
      category_id: categories.bkCategoryId,
      amount: bkAmount,
      description: 'Betriebskostenvorauszahlung',
    });
  }
  
  if (hkAmount > 0) {
    splits.push({
      category_id: categories.hkCategoryId,
      amount: hkAmount,
      description: 'Heizungskostenvorauszahlung',
    });
  }
  
  if (mietAmount > 0) {
    splits.push({
      category_id: categories.mieteCategoryId,
      amount: mietAmount,
      description: 'Grundmiete',
    });
  }
  
  return {
    bkAmount,
    hkAmount,
    mietAmount,
    unterzahlung,
    splits,
  };
}

export function useAssignPaymentWithSplit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      transactionId,
      tenantId,
      unitId,
      paymentAmount,
      tenant,
      categories,
    }: {
      transactionId: string;
      tenantId: string;
      unitId: string;
      paymentAmount: number;
      tenant: {
        betriebskosten_vorschuss: number;
        heizungskosten_vorschuss: number;
        grundmiete: number;
      };
      categories: {
        bkCategoryId: string;
        hkCategoryId: string;
        mieteCategoryId: string;
      };
    }) => {
      const splitResult = calculatePaymentSplit(
        paymentAmount,
        tenant.betriebskosten_vorschuss,
        tenant.heizungskosten_vorschuss,
        tenant.grundmiete,
        categories
      );
      
      const response = await apiRequest('POST', `/api/transactions/${transactionId}/split`, {
        tenantId,
        unitId,
        splits: splitResult.splits,
        categoryId: categories.mieteCategoryId,
      });
      
      if (!response.ok) throw new Error('Failed to split payment');
      
      return splitResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transaction_splits'] });
      
      const parts: string[] = [];
      if (result.bkAmount > 0) parts.push(`BK: €${result.bkAmount.toFixed(2)}`);
      if (result.hkAmount > 0) parts.push(`HK: €${result.hkAmount.toFixed(2)}`);
      if (result.mietAmount > 0) parts.push(`Miete: €${result.mietAmount.toFixed(2)}`);
      
      toast.success('Zahlung aufgeteilt', {
        description: parts.join(' | '),
      });
      
      if (result.unterzahlung > 0) {
        toast.warning(`Unterzahlung: €${result.unterzahlung.toFixed(2)}`);
      }
    },
    onError: (error) => {
      console.error('Payment split error:', error);
      toast.error('Fehler beim Aufteilen der Zahlung');
    },
  });
}

export function usePaymentCategories() {
  return async () => {
    const response = await fetch('/api/account-categories?type=income', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch categories');
    
    const categories = await response.json();
    
    if (!categories || categories.length < 2) {
      throw new Error('Erforderliche Kategorien nicht gefunden');
    }
    
    const bk = categories.find((c: { name: string }) => c.name === 'Betriebskostenvorauszahlungen');
    const hk = categories.find((c: { name: string }) => c.name === 'Heizungskostenvorauszahlungen');
    const miete = categories.find((c: { name: string }) => c.name === 'Mieteinnahmen');
    
    return {
      bkCategoryId: bk?.id || '',
      hkCategoryId: hk?.id || miete?.id || '',
      mieteCategoryId: miete?.id || '',
    };
  };
}
