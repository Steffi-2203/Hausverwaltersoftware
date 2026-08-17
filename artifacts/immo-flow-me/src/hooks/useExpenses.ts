import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';
import { normalizeFields } from '@/utils/fieldNormalizer';

function normalizeExpense(expense: any) {
  const normalized = normalizeFields(expense);
  if (normalized.properties) {
    normalized.properties = normalizeFields(normalized.properties);
  }
  return normalized;
}

export type ExpenseCategory = 'betriebskosten_umlagefaehig' | 'instandhaltung' | 'sonstige_kosten';
export type ExpenseType = 
  | 'versicherung'
  | 'grundsteuer'
  | 'muellabfuhr'
  | 'wasser_abwasser'
  | 'heizung'
  | 'strom_allgemein'
  | 'hausbetreuung'
  | 'lift'
  | 'gartenpflege'
  | 'schneeraeumung'
  | 'verwaltung'
  | 'ruecklage'
  | 'reparatur'
  | 'sanierung'
  | 'sonstiges'
  | 'makler'
  | 'notar'
  | 'grundbuch'
  | 'finanzierung';

export interface Expense {
  id: string;
  propertyId: string;
  category: ExpenseCategory;
  expenseType: ExpenseType;
  bezeichnung: string;
  betrag: number;
  datum: string;
  belegNummer: string | null;
  belegUrl: string | null;
  notizen: string | null;
  year: number;
  month: number;
  transactionId: string | null;
  distributionKeyId: string | null;
  createdAt: string;
  updatedAt: string;
  properties?: { name: string };
}

export interface ExpenseInsert {
  propertyId: string;
  category: ExpenseCategory;
  expenseType?: ExpenseType;
  bezeichnung: string;
  betrag: number;
  datum: string;
  belegNummer?: string;
  notizen?: string;
  year: number;
  month: number;
  distributionKeyId?: string;
}

export interface ExpenseUpdate extends Partial<ExpenseInsert> {
  id: string;
}

export function useExpenses(propertyId?: string, year?: number, month?: number) {
  return useQuery({
    queryKey: ['expenses', propertyId, year, month],
    staleTime: 60000,
    gcTime: 300000,
    queryFn: async () => {
      let url = propertyId ? `/api/properties/${propertyId}/expenses` : '/api/expenses';
      const params = new URLSearchParams();
      if (year) params.append('year', year.toString());
      if (month) params.append('month', month.toString());
      if (params.toString()) url += `?${params.toString()}`;
      
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch expenses');
      const expenses = await response.json();
      
      if (!propertyId) {
        const propsRes = await fetch('/api/properties', { credentials: 'include' });
        if (propsRes.ok) {
          const properties = await propsRes.json();
          return expenses.map((expense: Expense) => {
            const expensePropertyId = expense.propertyId ?? (expense as any).property_id;
            const property = properties.find((p: any) => p.id === expensePropertyId);
            return normalizeExpense({ ...expense, properties: property ? { name: property.name } : undefined });
          });
        }
      }
      
      return expenses.map(normalizeExpense);
    },
  });
}

export function useExpensesByCategory(propertyId?: string, year?: number) {
  return useQuery({
    queryKey: ['expenses', 'by-category', propertyId, year],
    queryFn: async () => {
      let url = propertyId ? `/api/properties/${propertyId}/expenses` : '/api/expenses';
      const params = new URLSearchParams();
      if (year) params.append('year', year.toString());
      if (params.toString()) url += `?${params.toString()}`;
      
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch expenses');
      
      const expenses: Expense[] = await response.json();
      
      const betriebskosten = expenses.filter(e => e.category === 'betriebskosten_umlagefaehig');
      const instandhaltung = expenses.filter(e => e.category === 'instandhaltung');
      
      return {
        betriebskosten,
        instandhaltung,
        totalBetriebskosten: betriebskosten.reduce((sum, e) => sum + Number(e.betrag), 0),
        totalInstandhaltung: instandhaltung.reduce((sum, e) => sum + Number(e.betrag), 0),
        total: expenses.reduce((sum, e) => sum + Number(e.betrag), 0),
      };
    },
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (expense: ExpenseInsert) => {
      const response = await apiRequest('POST', '/api/expenses', expense);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Kosten erfolgreich erfasst');
    },
    onError: (error) => {
      toast.error('Fehler beim Erfassen der Kosten');
      console.error('Create expense error:', error);
    },
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: ExpenseUpdate) => {
      const response = await apiRequest('PATCH', `/api/expenses/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Kosten aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Kosten');
      console.error('Update expense error:', error);
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Kosten gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Kosten');
      console.error('Delete expense error:', error);
    },
  });
}

// Labels for UI
export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  betriebskosten_umlagefaehig: 'Betriebskosten (umlagefähig)',
  instandhaltung: 'Instandhaltung',
  sonstige_kosten: 'Sonstige Kosten',
};

export const expenseTypeLabels: Record<ExpenseType, string> = {
  versicherung: 'Versicherung',
  grundsteuer: 'Grundsteuer',
  muellabfuhr: 'Müllabfuhr',
  wasser_abwasser: 'Wasser/Abwasser',
  heizung: 'Heizung',
  strom_allgemein: 'Strom Allgemein',
  hausbetreuung: 'Hausbetreuung',
  lift: 'Lift',
  gartenpflege: 'Gartenpflege',
  schneeraeumung: 'Schneeräumung',
  verwaltung: 'Verwaltung',
  ruecklage: 'Rücklage',
  reparatur: 'Reparatur',
  sanierung: 'Sanierung',
  sonstiges: 'Sonstiges',
  makler: 'Makler',
  notar: 'Notar',
  grundbuch: 'Grundbuchkosten',
  finanzierung: 'Finanzierung',
};

// Group expense types by category
export const expenseTypesByCategory: Record<ExpenseCategory, ExpenseType[]> = {
  betriebskosten_umlagefaehig: [
    'versicherung',
    'grundsteuer',
    'muellabfuhr',
    'wasser_abwasser',
    'heizung',
    'strom_allgemein',
    'hausbetreuung',
    'lift',
    'gartenpflege',
    'schneeraeumung',
    'verwaltung',
    'ruecklage',
    'sonstiges',
  ],
  instandhaltung: [
    'reparatur',
    'sanierung',
    'sonstiges',
  ],
  sonstige_kosten: [
    'makler',
    'notar',
    'grundbuch',
    'finanzierung',
    'sonstiges',
  ],
};
