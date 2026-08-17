import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { 
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle, Loader2, Search, 
  Building, User, Euro, Brain, Sparkles, Trash2, Plus, Wallet, TrendingUp, TrendingDown,
  PiggyBank, Calculator, FileText, Edit2, BarChart3, Pencil, CreditCard
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subYears } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { parseCSV, autoMatchTransaction, ParsedTransaction } from '@/utils/bankImportUtils';
import { useTransactions, useCreateTransactions, useUpdateTransaction, useTransactionSummary } from '@/hooks/useTransactions';
import { usePaymentSync } from '@/hooks/usePaymentSync';
import { useLearnedMatches, useCreateLearnedMatch, useDeleteLearnedMatch } from '@/hooks/useLearnedMatches';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';
import { useBankAccounts, useCreateBankAccount, useUpdateBankAccount, useDeleteBankAccount, useBankBalance } from '@/hooks/useBankAccounts';
import { useAccountCategories, useCreateAccountCategory, useDeleteAccountCategory } from '@/hooks/useAccountCategories';
import { useLinkedExpensesMap } from '@/hooks/useLinkedExpenses';
import { ExpenseLinkBadge } from '@/components/banking/ExpenseLinkBadge';
import { DataConsistencyAlert } from '@/components/banking/DataConsistencyAlert';
import { BankStatementOCR } from '@/components/banking/BankStatementOCR';
import { SepaExportDialog } from '@/components/banking/SepaExportDialog';
import { SepaCollectionHistory } from '@/components/banking/SepaCollectionHistory';
import { categorizeTransaction, CategoryInfo } from '@/lib/transactionCategorizer';
import { BudgetPositionSelect } from '@/components/budgets/BudgetPositionSelect';

interface ImportTransaction extends ParsedTransaction {
  id: string;
  matchedUnitId: string | null;
  matchedTenantId: string | null;
  confidence: number;
  matchReason: string;
  matchType?: 'exact' | 'fuzzy' | 'learned' | 'none';
  learnablePatterns?: string[];
  selected: boolean;
  wasManuallyAssigned?: boolean;
  categoryId?: string | null;
  categorySuggestions?: Array<{ categoryId: string; confidence: number }>;
}

interface NewBankAccount {
  name: string;
  iban: string;
  bankName: string;
  openingBalance: string;
  openingDate: string;
  propertyId: string;
}

export default function Banking() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'manual';
  const initialStatus = searchParams.get('status') || 'all';
  
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importTransactions, setImportTransactions] = useState<ImportTransaction[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newAccount, setNewAccount] = useState<NewBankAccount>({ name: '', iban: '', bankName: '', openingBalance: '', openingDate: '', propertyId: '' });
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState<'income' | 'expense'>('expense');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [actualBalance, setActualBalance] = useState('');
  const [reportPeriod, setReportPeriod] = useState('current-month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [editingTransaction, setEditingTransaction] = useState<typeof transactions[0] | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showSepaExport, setShowSepaExport] = useState(false);
  // Manual entry form state
  const [manualEntry, setManualEntry] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    type: 'expense' as 'income' | 'expense',
    description: '',
    categoryId: '',
    unitId: '',
    propertyId: '', // For expense sync to BK-Abrechnung
    bankAccountId: '',
    reference: '',
    counterpartyName: '',
    counterpartyIban: '',
    notes: '',
    budgetPosition: null as number | null, // For budget tracking
  });
  
  const { data: transactions = [], isLoading: transactionsLoading } = useTransactions();
  const { data: units = [] } = useUnits();
  const { data: tenants = [] } = useTenants();
  const { data: properties = [] } = useProperties();
  const { data: organization } = useOrganization();
  const { data: learnedMatches = [] } = useLearnedMatches();
  const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useBankAccounts();
  const { data: categories = [], isLoading: categoriesLoading } = useAccountCategories();
  const linkedExpensesMap = useLinkedExpensesMap();
  
  const { createTransactionWithSync, deleteTransactionWithSync, createPaymentWithSync } = usePaymentSync();
  const createTransactions = useCreateTransactions();
  const updateTransaction = useUpdateTransaction();
  const createLearnedMatch = useCreateLearnedMatch();
  const deleteLearnedMatch = useDeleteLearnedMatch();
  const createBankAccount = useCreateBankAccount();
  const updateBankAccount = useUpdateBankAccount();
  const deleteBankAccount = useDeleteBankAccount();
  const createCategory = useCreateAccountCategory();
  const deleteCategory = useDeleteAccountCategory();
  
  // Auto-categorization for manual entry
  useEffect(() => {
    if (manualEntry.description.length > 3 && categories.length > 0) {
      const categoryInfos: CategoryInfo[] = categories.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type
      }));
      
      const categorization = categorizeTransaction(
        manualEntry.description,
        manualEntry.reference,
        manualEntry.counterpartyName,
        manualEntry.type === 'expense' ? -1 : 1,
        categoryInfos
      );
      
      if (categorization.categoryId && !manualEntry.categoryId) {
        setManualEntry(prev => ({ ...prev, categoryId: categorization.categoryId! }));
      }
    }
  }, [manualEntry.description, manualEntry.reference, manualEntry.counterpartyName, manualEntry.type, categories]);

  // Handle manual entry submission
  const handleManualEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!manualEntry.amount || !manualEntry.description || !manualEntry.bankAccountId) {
      toast.error('Bitte alle Pflichtfelder ausfüllen (Bankkonto, Beschreibung, Betrag)');
      return;
    }
    
    const amount = manualEntry.type === 'expense' 
      ? -Math.abs(parseFloat(manualEntry.amount.replace(',', '.')))
      : Math.abs(parseFloat(manualEntry.amount.replace(',', '.')));
    
    try {
      await createTransactionWithSync.mutateAsync({
        transaction: {
          organization_id: organization?.id || null,
          bank_account_id: manualEntry.bankAccountId,
          unit_id: manualEntry.unitId || null,
          property_id: manualEntry.propertyId || null,
          transaction_date: manualEntry.date,
          amount: amount,
          currency: 'EUR',
          description: manualEntry.description,
          reference: manualEntry.reference || null,
          counterpart_name: manualEntry.counterpartyName || null,
          counterpart_iban: manualEntry.counterpartyIban || null,
          category_id: manualEntry.categoryId || null,
          status: manualEntry.unitId ? 'matched' : 'unmatched',
          notes: manualEntry.notes || null,
          budget_position: manualEntry.budgetPosition,
        },
      });
      
      toast.success('Buchung erfolgreich erfasst!');
      
      // Reset form but keep bank account
      setManualEntry({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        type: 'expense',
        description: '',
        categoryId: '',
        unitId: '',
        propertyId: '',
        bankAccountId: manualEntry.bankAccountId,
        reference: '',
        counterpartyName: '',
        counterpartyIban: '',
        notes: '',
        budgetPosition: null,
      });
    } catch (error) {
      console.error('Error creating transaction:', error);
      toast.error('Fehler beim Speichern der Buchung');
    }
  };

  const resetManualEntry = () => {
    setManualEntry({
      date: new Date().toISOString().split('T')[0],
      amount: '',
      type: 'expense',
      description: '',
      categoryId: '',
      unitId: '',
      propertyId: '',
      bankAccountId: manualEntry.bankAccountId,
      reference: '',
      counterpartyName: '',
      counterpartyIban: '',
      notes: '',
      budgetPosition: null,
    });
  };

  // Calculate date range for reports
  const dateRange = useMemo(() => {
    const now = new Date();
    switch (reportPeriod) {
      case 'current-month':
        return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') };
      case 'last-month':
        const lastMonth = subMonths(now, 1);
        return { start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'), end: format(endOfMonth(lastMonth), 'yyyy-MM-dd') };
      case 'current-year':
        return { start: format(startOfYear(now), 'yyyy-MM-dd'), end: format(endOfYear(now), 'yyyy-MM-dd') };
      case 'last-year':
        const lastYear = subYears(now, 1);
        return { start: format(startOfYear(lastYear), 'yyyy-MM-dd'), end: format(endOfYear(lastYear), 'yyyy-MM-dd') };
      case 'custom':
        return { start: customStartDate, end: customEndDate };
      default:
        return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') };
    }
  }, [reportPeriod, customStartDate, customEndDate]);

  const { data: transactionSummary } = useTransactionSummary(dateRange.start, dateRange.end);
  const { data: selectedAccountBalance } = useBankBalance(selectedBankAccountId || undefined);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setParseErrors([]);
    
    try {
      const content = await file.text();
      const { transactions: parsed, errors } = parseCSV(content);
      
      if (errors.length > 0) {
        setParseErrors(errors);
      }
      
      if (parsed.length === 0) {
        toast.error('Keine Transaktionen in der Datei gefunden');
        setIsProcessing(false);
        return;
      }
      
      // Convert learned matches to the format expected by autoMatchTransaction
      const learnedPatterns = learnedMatches.map(m => ({
        id: m.id,
        pattern: m.pattern,
        unit_id: m.unit_id,
        tenant_id: m.tenant_id,
        match_count: m.match_count,
      }));
      
      // Convert categories to CategoryInfo format
      const categoryInfos: CategoryInfo[] = categories.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type
      }));
      
      // Auto-match transactions with fuzzy matching, learned patterns, and auto-categorization
      const matchedTransactions: ImportTransaction[] = parsed.map((t, index) => {
        const match = autoMatchTransaction(t, units, tenants, learnedPatterns);
        
        // Auto-categorize
        const categorization = categorizeTransaction(
          t.description,
          t.reference || '',
          t.counterpartName || '',
          t.amount,
          categoryInfos
        );
        
        return {
          ...t,
          id: `import-${index}`,
          matchedUnitId: match.unitId,
          matchedTenantId: match.tenantId,
          confidence: match.confidence,
          matchReason: match.matchReason,
          matchType: match.matchType,
          learnablePatterns: match.learnablePatterns,
          selected: true,
          wasManuallyAssigned: false,
          categoryId: categorization.categoryId,
          categorySuggestions: categorization.suggestions,
        };
      });
      
      setImportTransactions(matchedTransactions);
      setShowImportDialog(true);
    } catch (error) {
      console.error('Error processing file:', error);
      toast.error('Fehler beim Verarbeiten der Datei');
    }
    
    setIsProcessing(false);
  }, [units, tenants, learnedMatches, categories]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const csvFile = files.find(f => f.name.endsWith('.csv'));
    
    if (csvFile) {
      processFile(csvFile);
    } else {
      toast.error('Bitte eine CSV-Datei hochladen');
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleMatchChange = useCallback((transactionId: string, unitId: string | null) => {
    setImportTransactions(prev => prev.map(t => {
      if (t.id === transactionId) {
        const tenant = unitId ? tenants.find(ten => ten.unit_id === unitId) : null;
        return {
          ...t,
          matchedUnitId: unitId,
          matchedTenantId: tenant?.id || null,
          confidence: unitId ? 1 : 0,
          matchReason: unitId ? 'Manuell zugeordnet' : '',
          matchType: unitId ? 'exact' as const : 'none' as const,
          wasManuallyAssigned: !!unitId,
        };
      }
      return t;
    }));
  }, [tenants]);

  const handleCategoryChange = useCallback((transactionId: string, categoryId: string | null) => {
    setImportTransactions(prev => prev.map(t => 
      t.id === transactionId ? { ...t, categoryId } : t
    ));
  }, []);

  const handleToggleSelect = useCallback((transactionId: string) => {
    setImportTransactions(prev => prev.map(t => 
      t.id === transactionId ? { ...t, selected: !t.selected } : t
    ));
  }, []);

  const handleSelectAll = useCallback((selected: boolean) => {
    setImportTransactions(prev => prev.map(t => ({ ...t, selected })));
  }, []);

  const handleImport = useCallback(async () => {
    const selectedTransactions = importTransactions.filter(t => t.selected);
    
    if (selectedTransactions.length === 0) {
      toast.error('Bitte mindestens eine Transaktion auswählen');
      return;
    }
    
    // Learn patterns from manually assigned transactions
    const manuallyAssigned = selectedTransactions.filter(
      t => t.wasManuallyAssigned && t.matchedUnitId && t.learnablePatterns && t.learnablePatterns.length > 0
    );
    
    for (const transaction of manuallyAssigned) {
      for (const pattern of transaction.learnablePatterns || []) {
        try {
          await createLearnedMatch.mutateAsync({
            organization_id: organization?.id || null,
            pattern,
            unit_id: transaction.matchedUnitId,
            tenant_id: transaction.matchedTenantId,
          });
        } catch (error) {
          console.error('Error saving learned pattern:', error);
        }
      }
    }
    
    if (manuallyAssigned.length > 0) {
      toast.success(`${manuallyAssigned.length} neue Zuordnungen gelernt`, {
        description: 'Diese werden bei zukünftigen Imports automatisch erkannt',
      });
    }
    
    const toInsert = selectedTransactions.map(t => {
      const status: 'matched' | 'unmatched' | 'ignored' = t.matchedUnitId ? 'matched' : 'unmatched';
      return {
        organization_id: organization?.id || null,
        unit_id: t.matchedUnitId,
        tenant_id: t.matchedTenantId,
        amount: t.amount,
        currency: 'EUR',
        transaction_date: t.date,
        booking_date: t.bookingDate || null,
        description: t.description,
        reference: t.reference || null,
        counterpart_name: t.counterpartName || null,
        counterpart_iban: t.counterpartIban || null,
        status,
        match_confidence: t.confidence,
        category_id: t.categoryId || null,
        bank_account_id: selectedBankAccountId,
      };
    });
    
    await createTransactions.mutateAsync(toInsert as any);
    setShowImportDialog(false);
    setImportTransactions([]);
  }, [importTransactions, organization, createTransactions, createLearnedMatch, selectedBankAccountId]);

  const handleCreateAccount = useCallback(async () => {
    if (!newAccount.name.trim()) {
      toast.error('Bitte Kontoname eingeben');
      return;
    }
    
    try {
      await createBankAccount.mutateAsync({
        organization_id: organization?.id || null,
        account_name: newAccount.name.trim(),
        iban: newAccount.iban.trim() || null,
        bank_name: newAccount.bankName.trim() || null,
        opening_balance: newAccount.openingBalance ? parseFloat(newAccount.openingBalance.replace(',', '.')) : 0,
        opening_balance_date: newAccount.openingDate || null,
        propertyId: newAccount.propertyId || null,
      } as any);
      setShowAddAccount(false);
      setNewAccount({ name: '', iban: '', bankName: '', openingBalance: '', openingDate: '', propertyId: '' });
    } catch (error) {
      console.error('Error creating account:', error);
    }
  }, [newAccount, organization, createBankAccount]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCategoryName.trim()) {
      toast.error('Bitte Kategorienamen eingeben');
      return;
    }
    
    try {
      await createCategory.mutateAsync({
        organizationId: organization?.id || null,
        name: newCategoryName.trim(),
        type: newCategoryType,
        isSystem: false,
        parentId: null,
        defaultDistributionKeyId: null,
      } as any);
      setShowAddCategory(false);
      setNewCategoryName('');
      setNewCategoryType('expense');
    } catch (error) {
      console.error('Error creating category:', error);
    }
  }, [newCategoryName, newCategoryType, organization, createCategory]);

  const getUnitInfo = useCallback((unitId: string | null) => {
    if (!unitId) return null;
    const unit = units.find(u => u.id === unitId);
    if (!unit) return null;
    const property = properties.find(p => p.id === unit.property_id);
    return { unit, property };
  }, [units, properties]);

  const getTenantName = useCallback((tenantId: string | null) => {
    if (!tenantId) return null;
    const tenant = tenants.find(t => t.id === tenantId);
    return tenant ? `${tenant.first_name} ${tenant.last_name}` : null;
  }, [tenants]);

  // Filter existing transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const matchesSearch = searchQuery === '' || 
        t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.counterpart_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.reference?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || (t as any).status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [transactions, searchQuery, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = transactions.length;
    const matched = transactions.filter(t => (t as any).status === 'matched').length;
    const unmatched = transactions.filter(t => (t as any).status === 'unmatched').length;
    const totalAmount = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const matchedAmount = transactions.filter(t => (t as any).status === 'matched').reduce((sum, t) => sum + Number(t.amount), 0);
    
    return { total, matched, unmatched, totalAmount, matchedAmount };
  }, [transactions]);

  // Calculate balance check
  const balanceCheck = useMemo(() => {
    if (!selectedBankAccountId) return null;
    const account = bankAccounts.find(a => a.id === selectedBankAccountId);
    if (!account) return null;
    
    const calculatedBalance = selectedAccountBalance ?? 0;
    const actualBalanceNum = actualBalance ? parseFloat(actualBalance.replace(',', '.')) : null;
    const difference = actualBalanceNum !== null ? actualBalanceNum - calculatedBalance : null;
    
    return {
      openingBalance: Number(account.opening_balance) || 0,
      openingDate: account.opening_balance_date,
      calculatedBalance,
      actualBalance: actualBalanceNum,
      difference,
      isMatch: difference !== null && Math.abs(difference) < 0.01,
    };
  }, [selectedBankAccountId, bankAccounts, selectedAccountBalance, actualBalance]);

  // Calculate totals for selected account
  const accountTotals = useMemo(() => {
    if (!selectedBankAccountId) return { income: 0, expenses: 0 };
    const accountTransactions = transactions.filter(t => t.bank_account_id === selectedBankAccountId);
    const income = accountTransactions.filter(t => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount), 0);
    const expenses = accountTransactions.filter(t => Number(t.amount) < 0).reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, expenses };
  }, [selectedBankAccountId, transactions]);

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);

  return (
    <MainLayout 
      title="Banking" 
      subtitle="Kontoauszüge importieren, kategorisieren und auswerten"
    >
      <div className="space-y-6">
        {/* Data Consistency Alert */}
        <DataConsistencyAlert variant="compact" />
        
        {/* OCR Shortcut */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Belege & Rechnungen scannen (OCR)</h3>
                  <p className="text-sm text-muted-foreground">Kosten automatisch per KI aus Rechnungen erfassen</p>
                </div>
              </div>
              <Button onClick={() => window.location.href = '/kosten'} className="shrink-0">
                <Upload className="h-4 w-4 mr-2" />
                Zur OCR Drop Zone
              </Button>
            </div>
          </CardContent>
        </Card>
        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Transaktionen</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Zugeordnet</p>
                  <p className="text-2xl font-bold text-green-600">{stats.matched}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Offen</p>
                  <p className="text-2xl font-bold text-orange-600">{stats.unmatched}</p>
                </div>
                <AlertCircle className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Gesamtbetrag</p>
                  <p className="text-2xl font-bold">{formatCurrency(stats.totalAmount)}</p>
                </div>
                <Euro className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue={initialTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="manual">
              <Pencil className="h-4 w-4 mr-1" />
              Manuelle Erfassung
            </TabsTrigger>
            <TabsTrigger value="ocr-statement">
              <Sparkles className="h-4 w-4 mr-1" />
              Kontoauszug-Scan
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="h-4 w-4 mr-1" />
              CSV Import
            </TabsTrigger>
            <TabsTrigger value="transactions">Transaktionen ({stats.total})</TabsTrigger>
            <TabsTrigger value="accounts">
              <Wallet className="h-4 w-4 mr-1" />
              Konten ({bankAccounts.length})
            </TabsTrigger>
            <TabsTrigger value="categories">
              <PiggyBank className="h-4 w-4 mr-1" />
              Kategorien ({categories.length})
            </TabsTrigger>
            <TabsTrigger value="reports">
              <BarChart3 className="h-4 w-4 mr-1" />
              Berichte
            </TabsTrigger>
            <TabsTrigger value="learned">
              <Brain className="h-4 w-4 mr-1" />
              Gelernte Muster ({learnedMatches.length})
            </TabsTrigger>
            <TabsTrigger value="sepa">
              <CreditCard className="h-4 w-4 mr-1" />
              SEPA-Verlauf
            </TabsTrigger>
          </TabsList>

          {/* OCR Bank Statement Tab */}
          <TabsContent value="ocr-statement" className="space-y-4">
            {/* Bank account selection with property display */}
            {bankAccounts.length > 0 && (
              <Card>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      <Label>Bankkonto:</Label>
                    </div>
                    <Select value={selectedBankAccountId || 'none'} onValueChange={(val) => setSelectedBankAccountId(val === 'none' ? null : val)}>
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder="Bankkonto auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Konto</SelectItem>
                        {bankAccounts.map(account => {
                          const linkedProperty = properties.find(p => p.id === account.property_id);
                          return (
                            <SelectItem key={account.id} value={account.id}>
                              <div className="flex items-center gap-2">
                                <span>{account.account_name}</span>
                                {account.iban && <span className="text-muted-foreground">({account.iban.slice(-4)})</span>}
                                {linkedProperty && (
                                  <Badge variant="secondary" className="text-xs">
                                    <Building className="h-3 w-3 mr-1" />
                                    {linkedProperty.name}
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {/* Show assigned property info when account is selected */}
                    {selectedBankAccountId && (() => {
                      const selectedAccount = bankAccounts.find(a => a.id === selectedBankAccountId);
                      const linkedProperty = selectedAccount?.property_id 
                        ? properties.find(p => p.id === selectedAccount.property_id)
                        : null;
                      return linkedProperty ? (
                        <Badge className="bg-primary/10 text-primary border-primary/20">
                          <Building className="h-3 w-3 mr-1" />
                          Automatische Zuordnung: {linkedProperty.name}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Keine Liegenschaft zugeordnet - manuelle Zuordnung nötig
                        </span>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}
            
            <BankStatementOCR
              units={units}
              tenants={tenants}
              properties={properties}
              learnedMatches={learnedMatches}
              categories={categories}
              bankAccountId={selectedBankAccountId}
              organizationId={organization?.id || null}
              bankAccountPropertyId={bankAccounts.find(a => a.id === selectedBankAccountId)?.property_id || null}
              onImport={async (lines) => {
                // Single Source of Truth: Mieteinnahmen via payments → transactions
                for (const line of lines) {
                  // Mieteinnahme: positiver Betrag MIT Mieter-Zuordnung → payments (führend)
                  if (line.betrag > 0 && line.matchedTenantId) {
                    await createPaymentWithSync.mutateAsync({
                      payment: {
                        tenant_id: line.matchedTenantId,
                        betrag: String(line.betrag),
                        eingangs_datum: line.datum,
                        buchungs_datum: line.datum,
                        referenz: line.verwendungszweck?.substring(0, 255) || null,
                        zahlungsart: 'ueberweisung',
                      } as any,
                      unitId: line.matchedUnitId || undefined,
                      propertyId: line.matchedPropertyId || undefined,
                    });
                  } else {
                    // Andere Buchungen (Ausgaben, sonstige Einnahmen) → transactions
                    await createTransactionWithSync.mutateAsync({
                      transaction: {
                        organization_id: organization?.id || null,
                        unit_id: line.matchedUnitId,
                        tenant_id: line.matchedTenantId,
                        property_id: line.matchedPropertyId,
                        amount: line.betrag,
                        currency: 'EUR',
                        transaction_date: line.datum,
                        description: line.verwendungszweck,
                        counterpart_name: line.auftraggeber_empfaenger || null,
                        counterpart_iban: line.iban || null,
                        status: line.matchedUnitId ? 'matched' : 'unmatched',
                        match_confidence: line.confidence,
                        category_id: line.categoryId,
                        bank_account_id: selectedBankAccountId,
                      },
                    });
                  }
                }
                toast.success(`${lines.length} Buchungen importiert`);
              }}
            />
          </TabsContent>

          {/* Manual Entry Tab */}
          <TabsContent value="manual" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Pencil className="h-5 w-5" />
                  Neue Buchung erfassen
                </CardTitle>
                <CardDescription>
                  Erfassen Sie Einnahmen und Ausgaben manuell. Die Kategorie wird automatisch vorgeschlagen.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualEntrySubmit} className="space-y-6">
                  {/* Bank Account Selection - Required */}
                  <div className="space-y-2">
                    <Label htmlFor="bankAccount">
                      Bankkonto <span className="text-destructive">*</span>
                    </Label>
                    <div className="flex gap-2">
                      <Select 
                        value={manualEntry.bankAccountId || 'none'} 
                        onValueChange={(val) => setManualEntry({...manualEntry, bankAccountId: val === 'none' ? '' : val})}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Bankkonto auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Konto wählen --</SelectItem>
                          {bankAccounts.map(account => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.account_name} {account.iban && `(${account.iban})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowAddAccount(true)}
                        title="Neues Bankkonto anlegen"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {bankAccounts.length === 0 && (
                      <p className="text-sm text-orange-600">
                        Bitte zuerst ein Bankkonto anlegen (+ Button)
                      </p>
                    )}
                  </div>

                  {/* Type: Income or Expense */}
                  <div className="space-y-2">
                    <Label>Buchungsart <span className="text-destructive">*</span></Label>
                    <RadioGroup 
                      value={manualEntry.type} 
                      onValueChange={(val) => setManualEntry({...manualEntry, type: val as 'income' | 'expense', categoryId: ''})}
                      className="flex gap-6"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="income" id="income" />
                        <Label htmlFor="income" className="text-green-600 font-medium cursor-pointer flex items-center gap-1">
                          <TrendingUp className="h-4 w-4" />
                          Einnahme (+)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="expense" id="expense" />
                        <Label htmlFor="expense" className="text-red-600 font-medium cursor-pointer flex items-center gap-1">
                          <TrendingDown className="h-4 w-4" />
                          Ausgabe (-)
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Date and Amount */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="date">Datum <span className="text-destructive">*</span></Label>
                      <Input
                        id="date"
                        type="date"
                        required
                        value={manualEntry.date}
                        onChange={(e) => setManualEntry({...manualEntry, date: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Betrag (€) <span className="text-destructive">*</span></Label>
                      <Input
                        id="amount"
                        type="text"
                        inputMode="decimal"
                        required
                        placeholder="0,00"
                        value={manualEntry.amount}
                        onChange={(e) => setManualEntry({...manualEntry, amount: e.target.value})}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="description">
                      Beschreibung/Buchungstext <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="description"
                      type="text"
                      required
                      placeholder="z.B. Versicherung Gebäude, Lift-Wartung, Miete Top 3..."
                      value={manualEntry.description}
                      onChange={(e) => setManualEntry({...manualEntry, description: e.target.value})}
                    />
                  </div>

                  {/* Category */}
                  <div className="space-y-2">
                    <Label htmlFor="category">
                      Kategorie <span className="text-xs text-muted-foreground">(wird automatisch vorgeschlagen)</span>
                    </Label>
                    <Select 
                      value={manualEntry.categoryId || 'none'} 
                      onValueChange={(val) => setManualEntry({...manualEntry, categoryId: val === 'none' ? '' : val})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Kategorie auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- Keine Kategorie --</SelectItem>
                        {categories
                          .filter(c => c.type === manualEntry.type)
                          .map(category => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Unit Assignment (for income) - grouped by property */}
                  {manualEntry.type === 'income' && (
                    <div className="space-y-2">
                      <Label htmlFor="unit">Zuordnung zu Einheit (optional)</Label>
                      <Select 
                        value={manualEntry.unitId || 'none'} 
                        onValueChange={(val) => setManualEntry({...manualEntry, unitId: val === 'none' ? '' : val})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Einheit zuordnen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Keine Zuordnung --</SelectItem>
                          {properties.map(property => {
                            const propertyUnits = units.filter(u => u.property_id === property.id);
                            if (propertyUnits.length === 0) return null;
                            return (
                              <div key={property.id}>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
                                  🏠 {property.name} – {property.address}
                                </div>
                                {propertyUnits.map(unit => {
                                  const tenant = tenants.find(t => t.unit_id === unit.id && (t as any).status === 'aktiv');
                                  return (
                                    <SelectItem key={unit.id} value={unit.id}>
                                      {unit.top_nummer} {tenant && `(${tenant.first_name} ${tenant.last_name})`}
                                    </SelectItem>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {manualEntry.unitId && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Building className="h-4 w-4" />
                          Liegenschaft: {properties.find(p => units.find(u => u.id === manualEntry.unitId)?.property_id === p.id)?.name || 'Unbekannt'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Property Assignment (for expenses - needed for BK-Abrechnung sync) */}
                  {manualEntry.type === 'expense' && (
                    <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
                      <Label htmlFor="property" className="flex items-center gap-2 text-base font-medium">
                        <Building className="h-4 w-4" />
                        Zuordnung zu Immobilie
                        <span className="text-xs font-normal text-muted-foreground">(für BK-Abrechnung)</span>
                      </Label>
                      <Select 
                        value={manualEntry.propertyId || 'none'} 
                        onValueChange={(val) => setManualEntry({...manualEntry, propertyId: val === 'none' ? '' : val})}
                      >
                        <SelectTrigger className={manualEntry.propertyId ? 'border-primary' : ''}>
                          <SelectValue placeholder="Immobilie auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Keine Zuordnung (privat) --</SelectItem>
                          {properties.map(property => (
                            <SelectItem key={property.id} value={property.id}>
                              🏠 {property.name} – {property.address}, {property.postal_code} {property.city}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {manualEntry.propertyId && (
                        <div className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" />
                          Ausgabe wird in BK-Abrechnung von "{properties.find(p => p.id === manualEntry.propertyId)?.name}" übernommen
                        </div>
                      )}
                      {!manualEntry.propertyId && (
                        <p className="text-xs text-muted-foreground">
                          ⚠️ Ohne Zuordnung wird die Ausgabe NICHT in der BK-Abrechnung berücksichtigt.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Budget Position Select - only for expenses with property */}
                  {manualEntry.type === 'expense' && manualEntry.propertyId && (
                    <BudgetPositionSelect
                      propertyId={manualEntry.propertyId}
                      year={new Date().getFullYear()}
                      value={manualEntry.budgetPosition}
                      onChange={(pos) => setManualEntry({...manualEntry, budgetPosition: pos})}
                    />
                  )}

                  <details className="border rounded-lg p-4 bg-muted/30">
                    <summary className="cursor-pointer font-medium text-sm">
                      Erweiterte Angaben (optional)
                    </summary>
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="reference">Referenz/Rechnungsnummer</Label>
                        <Input
                          id="reference"
                          type="text"
                          placeholder="z.B. RE-2024-001"
                          value={manualEntry.reference}
                          onChange={(e) => setManualEntry({...manualEntry, reference: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="counterpartyName">Empfänger/Zahler Name</Label>
                        <Input
                          id="counterpartyName"
                          type="text"
                          placeholder="z.B. Wiener Städtische Versicherung"
                          value={manualEntry.counterpartyName}
                          onChange={(e) => setManualEntry({...manualEntry, counterpartyName: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="counterpartyIban">Empfänger/Zahler IBAN</Label>
                        <Input
                          id="counterpartyIban"
                          type="text"
                          placeholder="AT..."
                          value={manualEntry.counterpartyIban}
                          onChange={(e) => setManualEntry({...manualEntry, counterpartyIban: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="notes">Notizen</Label>
                        <Textarea
                          id="notes"
                          placeholder="Zusätzliche Notizen..."
                          value={manualEntry.notes}
                          onChange={(e) => setManualEntry({...manualEntry, notes: e.target.value})}
                        />
                      </div>
                    </div>
                  </details>

                  {/* Submit Buttons */}
                  <div className="flex gap-3 pt-4">
                    <Button
                      type="submit"
                      disabled={createTransactionWithSync.isPending || !manualEntry.bankAccountId}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {createTransactionWithSync.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Buchung erfassen
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetManualEntry}
                    >
                      Zurücksetzen
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Tip Box */}
            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-900/10 dark:border-blue-800">
              <CardContent className="pt-6">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  💡 <strong>Tipp:</strong> Bei der Eingabe der Beschreibung wird automatisch eine passende Kategorie vorgeschlagen. 
                  Sie können diese aber jederzeit manuell ändern.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Import Tab */}
          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Kontoauszug hochladen</CardTitle>
                <CardDescription>
                  Laden Sie eine CSV-Datei von Ihrer Bank hoch. Unterstützte Formate: CSV (österreichische Banken)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Bank account selection for import */}
                {bankAccounts.length > 0 && (
                  <div className="flex items-center gap-4">
                    <Label>Ziel-Bankkonto:</Label>
                    <Select value={selectedBankAccountId || 'none'} onValueChange={(val) => setSelectedBankAccountId(val === 'none' ? null : val)}>
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder="Bankkonto auswählen (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Konto</SelectItem>
                        {bankAccounts.map(account => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_name} {account.iban && `(${account.iban.slice(-4)})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`
                    border-2 border-dashed rounded-lg p-12 text-center transition-colors
                    ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
                  `}
                >
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-4">
                      <Loader2 className="h-12 w-12 animate-spin text-primary" />
                      <p className="text-muted-foreground">Datei wird verarbeitet...</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-lg font-medium mb-2">
                        CSV-Datei hierher ziehen
                      </p>
                      <p className="text-sm text-muted-foreground mb-4">
                        oder klicken Sie auf den Button
                      </p>
                      <div>
                        <input
                          type="file"
                          accept=".csv"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="csv-file-input"
                        />
                        <Button 
                          variant="outline" 
                          onClick={() => document.getElementById('csv-file-input')?.click()}
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Datei auswählen
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Anleitung</CardTitle>
              </CardHeader>
              <CardContent className="prose prose-sm max-w-none">
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>Laden Sie den Kontoauszug als CSV-Datei von Ihrem Online-Banking herunter</li>
                  <li>Wählen Sie optional das Ziel-Bankkonto aus</li>
                  <li>Ziehen Sie die Datei in den Upload-Bereich oder wählen Sie sie aus</li>
                  <li>Transaktionen werden automatisch Einheiten und Kategorien zugeordnet</li>
                  <li>Überprüfen und korrigieren Sie die Zuordnungen bei Bedarf</li>
                  <li>Bestätigen Sie den Import</li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Suche nach Beschreibung, Name, Referenz..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Status</SelectItem>
                      <SelectItem value="matched">Zugeordnet</SelectItem>
                      <SelectItem value="unmatched">Nicht zugeordnet</SelectItem>
                      <SelectItem value="ignored">Ignoriert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                {transactionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Keine Transaktionen gefunden</p>
                    <p className="text-sm mt-2">Importieren Sie einen Kontoauszug um loszulegen</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Datum</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead>Kategorie</TableHead>
                        <TableHead>Zuordnung</TableHead>
                        <TableHead>Beleg</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                        <TableHead className="text-center w-16">Aktion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransactions.map((transaction) => {
                        const unitInfo = getUnitInfo(transaction.unit_id);
                        const tenantName = getTenantName(transaction.tenant_id);
                        const category = categories.find(c => c.id === transaction.category_id);
                        const linkedExpense = linkedExpensesMap.get(transaction.id);
                        
                        return (
                          <TableRow key={transaction.id}>
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(transaction.transaction_date), 'dd.MM.yyyy', { locale: de })}
                            </TableCell>
                            <TableCell>
                              <div className="max-w-xs">
                                <p className="truncate font-medium">
                                  {transaction.counterpart_name || 'Unbekannt'}
                                </p>
                                <p className="text-sm text-muted-foreground truncate">
                                  {transaction.description}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {category ? (
                                <Badge variant={category.type === 'income' ? 'default' : 'secondary'}>
                                  {category.name}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {unitInfo ? (
                                <div className="flex items-center gap-2">
                                  <Building className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm font-medium">{unitInfo.unit.top_nummer}</p>
                                    {tenantName && (
                                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        {tenantName}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <ExpenseLinkBadge
                                transactionId={transaction.id}
                                linkedExpense={linkedExpense}
                                transaction={{
                                  id: transaction.id,
                                  amount: Number(transaction.amount),
                                  transaction_date: transaction.transaction_date,
                                  counterpart_name: transaction.counterpart_name,
                                  description: transaction.description,
                                  property_id: transaction.property_id,
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                (transaction as any).status === 'matched' ? 'default' :
                                (transaction as any).status === 'unmatched' ? 'secondary' : 'outline'
                              }>
                                {(transaction as any).status === 'matched' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                                {(transaction as any).status === 'unmatched' && <AlertCircle className="h-3 w-3 mr-1" />}
                                {(transaction as any).status === 'matched' ? 'Zugeordnet' :
                                 (transaction as any).status === 'unmatched' ? 'Offen' : 'Ignoriert'}
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-right font-medium ${Number(transaction.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(Number(transaction.amount))}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingTransaction(transaction);
                                    setShowEditDialog(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Buchung löschen?</AlertDialogTitle>
                                      <AlertDialogDescription asChild>
                                        <div>
                                          <p>Diese Buchung wird unwiderruflich gelöscht.</p>
                                          {transaction.property_id && Number(transaction.amount) < 0 && (
                                            <p className="mt-2 text-orange-600 dark:text-orange-400">
                                              ⚠️ Die verknüpfte Ausgabe in der BK-Abrechnung wird ebenfalls gelöscht.
                                            </p>
                                          )}
                                          {transaction.tenant_id && Number(transaction.amount) > 0 && (
                                            <p className="mt-2 text-orange-600 dark:text-orange-400">
                                              ⚠️ Die verknüpfte Mieteinnahme wird ebenfalls gelöscht.
                                            </p>
                                          )}
                                        </div>
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteTransactionWithSync.mutate(transaction.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        {deleteTransactionWithSync.isPending ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          'Löschen'
                                        )}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bank Accounts Tab */}
          <TabsContent value="accounts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Bank-Konten
                </CardTitle>
                <CardDescription>
                  Verwalten Sie Ihre Bankkonten mit Anfangsbestand für die Kontostands-Berechnung
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {bankAccountsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <>
                    {bankAccounts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Noch keine Bankkonten angelegt</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {bankAccounts.map(account => (
                          <div key={account.id} className="p-4 border rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-semibold">{account.account_name}</h3>
                                {account.iban && (
                                  <p className="text-sm text-muted-foreground">IBAN: {account.iban}</p>
                                )}
                                {account.bank_name && (
                                  <p className="text-sm text-muted-foreground">{account.bank_name}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteBankAccount.mutate(account.id)}
                                  disabled={deleteBankAccount.isPending}
                                >
                                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                </Button>
                              </div>
                            </div>
                            {account.opening_balance_date && (
                              <div className="mt-3 pt-3 border-t text-sm">
                                <span className="text-muted-foreground">
                                  Anfangsbestand ({format(new Date(account.opening_balance_date), 'dd.MM.yyyy')}):
                                </span>{' '}
                                <span className="font-medium">{formatCurrency(Number(account.opening_balance) || 0)}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {showAddAccount ? (
                      <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                        <h3 className="font-semibold">Neues Bank-Konto</h3>
                        <Input
                          placeholder="Kontoname (z.B. Haupt-Girokonto)"
                          value={newAccount.name}
                          onChange={(e) => setNewAccount({...newAccount, name: e.target.value})}
                        />
                        <Input
                          placeholder="IBAN (optional)"
                          value={newAccount.iban}
                          onChange={(e) => setNewAccount({...newAccount, iban: e.target.value})}
                        />
                        <Input
                          placeholder="Bank (z.B. Erste Bank)"
                          value={newAccount.bankName}
                          onChange={(e) => setNewAccount({...newAccount, bankName: e.target.value})}
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm text-muted-foreground">Anfangsbestand</Label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={newAccount.openingBalance}
                              onChange={(e) => setNewAccount({...newAccount, openingBalance: e.target.value})}
                            />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground">Datum Anfangsbestand</Label>
                            <Input
                              type="date"
                              value={newAccount.openingDate}
                              onChange={(e) => setNewAccount({...newAccount, openingDate: e.target.value})}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={handleCreateAccount} disabled={createBankAccount.isPending}>
                            {createBankAccount.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Konto erstellen
                          </Button>
                          <Button variant="outline" onClick={() => setShowAddAccount(false)}>
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" className="w-full" onClick={() => setShowAddAccount(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Neues Bank-Konto hinzufügen
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Balance Check */}
            {bankAccounts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    Plausibilitäts-Check
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Label>Konto auswählen:</Label>
                    <Select value={selectedBankAccountId || 'none'} onValueChange={(val) => setSelectedBankAccountId(val === 'none' ? null : val)}>
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder="Bankkonto auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Konto</SelectItem>
                        {bankAccounts.map(account => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {balanceCheck && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Anfangsbestand</p>
                          <p className="text-lg font-semibold">{formatCurrency(balanceCheck.openingBalance)}</p>
                          {balanceCheck.openingDate && (
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(balanceCheck.openingDate), 'dd.MM.yyyy')}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-muted-foreground">+ Einnahmen</p>
                          <p className="text-lg font-semibold text-green-600">
                            + {formatCurrency(accountTotals.income)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">- Ausgaben</p>
                          <p className="text-lg font-semibold text-red-600">
                            {formatCurrency(accountTotals.expenses)}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t">
                        <div className="flex justify-between items-center">
                          <p className="font-semibold">Berechneter Kontostand:</p>
                          <p className="text-2xl font-bold">{formatCurrency(balanceCheck.calculatedBalance)}</p>
                        </div>

                        <div className="mt-3 flex items-center gap-3">
                          <Label className="text-sm">Tatsächlicher Kontostand (lt. Bank):</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            className="w-32"
                            value={actualBalance}
                            onChange={(e) => setActualBalance(e.target.value)}
                          />
                          <span>€</span>
                        </div>

                        {balanceCheck.actualBalance !== null && (
                          <div className={`mt-3 p-3 rounded ${
                            balanceCheck.isMatch 
                              ? 'bg-green-100 border border-green-300 dark:bg-green-900/30 dark:border-green-700'
                              : 'bg-red-100 border border-red-300 dark:bg-red-900/30 dark:border-red-700'
                          }`}>
                            <p className="font-semibold">
                              {balanceCheck.isMatch 
                                ? '✓ Kontostand stimmt überein!'
                                : '✗ Differenz gefunden!'}
                            </p>
                            {!balanceCheck.isMatch && balanceCheck.difference !== null && (
                              <p className="text-sm mt-1">
                                Differenz: {formatCurrency(balanceCheck.difference)}
                                <br />
                                <span className="text-xs text-muted-foreground">
                                  Bitte prüfen Sie ob alle Transaktionen erfasst sind oder ob der Anfangsbestand korrekt ist.
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PiggyBank className="h-5 w-5" />
                  Kontenplan / Kategorien
                </CardTitle>
                <CardDescription>
                  System-Kategorien und benutzerdefinierte Kategorien für die Buchhaltung
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {categoriesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Income Categories */}
                    <div>
                      <h3 className="font-semibold text-green-700 mb-2 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Einnahmen
                      </h3>
                      <div className="space-y-1">
                        {categories.filter(c => c.type === 'income').map(category => (
                          <div key={category.id} className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-900/20 rounded">
                            <span className="text-sm">{category.name}</span>
                            {category.is_system ? (
                              <Badge variant="outline" className="text-xs">System</Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteCategory.mutate(category.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Expense Categories */}
                    <div>
                      <h3 className="font-semibold text-red-700 mb-2 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4" />
                        Ausgaben
                      </h3>
                      <div className="space-y-1">
                        {categories.filter(c => c.type === 'expense').map(category => (
                          <div key={category.id} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded">
                            <span className="text-sm">{category.name}</span>
                            {category.is_system ? (
                              <Badge variant="outline" className="text-xs">System</Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteCategory.mutate(category.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Add custom category */}
                    {showAddCategory ? (
                      <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                        <h3 className="font-semibold">Neue Kategorie</h3>
                        <Input
                          placeholder="Kategorie-Name (z.B. Internet & Telefon)"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                        />
                        <Select value={newCategoryType} onValueChange={(v) => setNewCategoryType(v as 'income' | 'expense')}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="expense">Ausgabe</SelectItem>
                            <SelectItem value="income">Einnahme</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          <Button onClick={handleCreateCategory} disabled={createCategory.isPending}>
                            {createCategory.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Erstellen
                          </Button>
                          <Button variant="outline" onClick={() => setShowAddCategory(false)}>
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" className="w-full" onClick={() => setShowAddCategory(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Eigene Kategorie erstellen
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Einnahmen/Ausgaben Übersicht
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Period selector */}
                <div className="flex flex-wrap gap-3 items-center">
                  <Select value={reportPeriod} onValueChange={setReportPeriod}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current-month">Aktueller Monat</SelectItem>
                      <SelectItem value="last-month">Letzter Monat</SelectItem>
                      <SelectItem value="current-year">Aktuelles Jahr</SelectItem>
                      <SelectItem value="last-year">Letztes Jahr</SelectItem>
                      <SelectItem value="custom">Benutzerdefiniert</SelectItem>
                    </SelectContent>
                  </Select>

                  {reportPeriod === 'custom' && (
                    <>
                      <Input
                        type="date"
                        className="w-[150px]"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                      />
                      <span>bis</span>
                      <Input
                        type="date"
                        className="w-[150px]"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                      />
                    </>
                  )}
                </div>

                {transactionSummary && (
                  <div className="space-y-4">
                    {/* Income breakdown */}
                    <div>
                      <h3 className="font-semibold text-green-700 mb-2 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Einnahmen
                      </h3>
                      <div className="space-y-1">
                        {transactionSummary.incomeByCategory.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
                            <span className="text-sm">{item.categoryName}</span>
                            <span className="font-medium text-green-700">
                              + {formatCurrency(item.total)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center p-2 bg-green-100 dark:bg-green-800/30 rounded font-semibold">
                          <span>Gesamt Einnahmen</span>
                          <span className="text-green-700">+ {formatCurrency(transactionSummary.totalIncome)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expense breakdown */}
                    <div>
                      <h3 className="font-semibold text-red-700 mb-2 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4" />
                        Ausgaben
                      </h3>
                      <div className="space-y-1">
                        {transactionSummary.expensesByCategory.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                            <span className="text-sm">{item.categoryName}</span>
                            <span className="font-medium text-red-700">
                              {formatCurrency(item.total)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center p-2 bg-red-100 dark:bg-red-800/30 rounded font-semibold">
                          <span>Gesamt Ausgaben</span>
                          <span className="text-red-700">{formatCurrency(transactionSummary.totalExpenses)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className={`flex justify-between items-center p-3 rounded font-bold text-lg ${
                      transactionSummary.balance >= 0 
                        ? 'bg-green-100 dark:bg-green-800/30' 
                        : 'bg-red-100 dark:bg-red-800/30'
                    }`}>
                      <span>Saldo</span>
                      <span className={transactionSummary.balance >= 0 ? 'text-green-700' : 'text-red-700'}>
                        {formatCurrency(transactionSummary.balance)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Learned Patterns Tab */}
          <TabsContent value="learned" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Gelernte Zuordnungsmuster
                </CardTitle>
                <CardDescription>
                  Diese Muster wurden aus manuellen Zuordnungen gelernt und werden bei zukünftigen Imports automatisch angewendet.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {learnedMatches.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Noch keine Muster gelernt</p>
                    <p className="text-sm mt-2">
                      Wenn Sie beim Import Transaktionen manuell zuordnen, werden die Muster automatisch gespeichert.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Muster</TableHead>
                        <TableHead>Zugeordnete Einheit</TableHead>
                        <TableHead>Mieter</TableHead>
                        <TableHead className="text-center">Anwendungen</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {learnedMatches.map((match) => {
                        const unit = units.find(u => u.id === match.unit_id);
                        const property = unit ? properties.find(p => p.id === unit.property_id) : null;
                        const tenant = match.tenant_id ? tenants.find(t => t.id === match.tenant_id) : null;
                        
                        return (
                          <TableRow key={match.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-yellow-500" />
                                <code className="text-sm bg-muted px-2 py-1 rounded">
                                  {match.pattern}
                                </code>
                              </div>
                            </TableCell>
                            <TableCell>
                              {unit ? (
                                <div className="flex items-center gap-2">
                                  <Building className="h-4 w-4 text-muted-foreground" />
                                  <span>{unit.top_nummer}</span>
                                  {property && (
                                    <span className="text-muted-foreground text-sm">
                                      ({property.name})
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {tenant ? (
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <span>{tenant.first_name} {tenant.last_name}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">
                                {match.match_count || 0}x
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteLearnedMatch.mutate(match.id)}
                                disabled={deleteLearnedMatch.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SEPA-Verlauf Tab */}
          <TabsContent value="sepa" className="space-y-4">
            <SepaCollectionHistory />
          </TabsContent>
        </Tabs>
      </div>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import-Vorschau</DialogTitle>
            <DialogDescription>
              {importTransactions.length} Transaktionen erkannt. Überprüfen Sie die Zuordnungen und Kategorien.
            </DialogDescription>
          </DialogHeader>

          {parseErrors.length > 0 && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-4 mb-4">
              <p className="font-medium mb-2">Warnungen beim Parsen:</p>
              <ul className="text-sm list-disc list-inside">
                {parseErrors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="selectAll"
                checked={importTransactions.every(t => t.selected)}
                onChange={(e) => handleSelectAll(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="selectAll" className="text-sm">Alle auswählen</label>
            </div>
            <div className="text-sm text-muted-foreground">
              {importTransactions.filter(t => t.selected).length} von {importTransactions.length} ausgewählt
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Einheit</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importTransactions.map((transaction) => (
                <TableRow key={transaction.id} className={!transaction.selected ? 'opacity-50' : ''}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={transaction.selected}
                      onChange={() => handleToggleSelect(transaction.id)}
                      className="rounded"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(transaction.date), 'dd.MM.yyyy', { locale: de })}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xs">
                      <p className="truncate font-medium">{transaction.counterpartName || 'Unbekannt'}</p>
                      <p className="text-sm text-muted-foreground truncate">{transaction.description}</p>
                      {transaction.matchReason && (
                        <p className={`text-xs mt-1 flex items-center gap-1 ${
                          transaction.matchType === 'learned' ? 'text-yellow-600' :
                          transaction.matchType === 'fuzzy' ? 'text-blue-600' :
                          'text-green-600'
                        }`}>
                          {transaction.matchType === 'learned' ? (
                            <Brain className="h-3 w-3" />
                          ) : transaction.matchType === 'fuzzy' ? (
                            <Sparkles className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {transaction.matchReason}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={transaction.categoryId || 'none'}
                      onValueChange={(value) => handleCategoryChange(transaction.id, value === 'none' ? null : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Kategorie" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Kategorie</SelectItem>
                        {categories
                          .filter(c => transaction.amount > 0 ? c.type === 'income' : c.type === 'expense')
                          .map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {transaction.categorySuggestions && transaction.categorySuggestions.length > 0 && !transaction.categoryId && (
                      <div className="mt-1 text-xs">
                        <span className="text-muted-foreground">Vorschläge: </span>
                        {transaction.categorySuggestions.slice(0, 2).map((sug, i) => {
                          const sugCat = categories.find(c => c.id === sug.categoryId);
                          return sugCat ? (
                            <button
                              key={i}
                              onClick={() => handleCategoryChange(transaction.id, sug.categoryId)}
                              className="text-blue-600 hover:underline mr-2"
                            >
                              {sugCat.name} ({Math.round(sug.confidence * 100)}%)
                            </button>
                          ) : null;
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={transaction.matchedUnitId || 'none'}
                      onValueChange={(value) => handleMatchChange(transaction.id, value === 'none' ? null : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Einheit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Zuordnung</SelectItem>
                        {units.map((unit) => {
                          const property = properties.find(p => p.id === unit.property_id);
                          const tenant = tenants.find(t => t.unit_id === unit.id);
                          return (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.top_nummer} - {property?.name || 'Unbekannt'}
                              {tenant && ` (${tenant.last_name})`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(transaction.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Abbrechen
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={createTransactions.isPending || importTransactions.filter(t => t.selected).length === 0}
            >
              {createTransactions.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {importTransactions.filter(t => t.selected).length} Transaktionen importieren
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Transaction Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => { setShowEditDialog(open); if (!open) setEditingTransaction(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Buchung bearbeiten
            </DialogTitle>
            <DialogDescription>
              Ändern Sie die Details dieser Buchung
            </DialogDescription>
          </DialogHeader>
          
          {editingTransaction && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const unitIdValue = formData.get('unitId') as string;
              const unitId = unitIdValue && unitIdValue !== 'none' ? unitIdValue : null;
              
              // Find tenant for the selected unit
              const tenant = unitId ? tenants.find(t => t.unit_id === unitId && (t as any).status === 'aktiv') : null;
              
              try {
                await updateTransaction.mutateAsync({
                  id: editingTransaction.id,
                  description: formData.get('description') as string,
                  amount: parseFloat((formData.get('amount') as string).replace(',', '.')),
                  transaction_date: formData.get('date') as string,
                  category_id: formData.get('categoryId') as string || null,
                  unit_id: unitId,
                  tenant_id: tenant?.id || null,
                  property_id: formData.get('propertyId') as string || null,
                  counterpart_name: formData.get('counterpartName') as string || null,
                  reference: formData.get('reference') as string || null,
                  notes: formData.get('notes') as string || null,
                  status: unitId ? 'matched' : 'unmatched',
                } as any);
                toast.success('Buchung erfolgreich aktualisiert');
                setShowEditDialog(false);
                setEditingTransaction(null);
              } catch (error) {
                console.error('Error updating transaction:', error);
                toast.error('Fehler beim Aktualisieren');
              }
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-date">Datum</Label>
                  <Input
                    id="edit-date"
                    name="date"
                    type="date"
                    defaultValue={editingTransaction.transaction_date}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-amount">Betrag (€)</Label>
                  <Input
                    id="edit-amount"
                    name="amount"
                    type="text"
                    defaultValue={editingTransaction.amount.toString().replace('.', ',')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Negativ = Ausgabe, Positiv = Einnahme
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Beschreibung</Label>
                <Input
                  id="edit-description"
                  name="description"
                  type="text"
                  defaultValue={editingTransaction.description || ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-counterpartName">Empfänger/Zahler</Label>
                <Input
                  id="edit-counterpartName"
                  name="counterpartName"
                  type="text"
                  defaultValue={editingTransaction.counterpart_name || ''}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-category">Kategorie</Label>
                  <Select name="categoryId" defaultValue={editingTransaction.category_id || 'none'}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kategorie wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Keine --</SelectItem>
                      {categories.map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name} ({cat.type === 'income' ? 'Einnahme' : 'Ausgabe'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-unit">Einheit zuordnen</Label>
                  <Select name="unitId" defaultValue={editingTransaction.unit_id || 'none'}>
                    <SelectTrigger>
                      <SelectValue placeholder="Einheit wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Keine --</SelectItem>
                      {units.map(unit => {
                        const property = properties.find(p => p.id === unit.property_id);
                        const tenant = tenants.find(t => t.unit_id === unit.id && (t as any).status === 'aktiv');
                        return (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.top_nummer} - {property?.name || 'Unbekannt'}
                            {tenant && ` (${tenant.first_name} ${tenant.last_name})`}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-property">Immobilie (für BK-Abrechnung)</Label>
                <Select name="propertyId" defaultValue={editingTransaction.property_id || 'none'}>
                  <SelectTrigger>
                    <SelectValue placeholder="Immobilie wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Keine --</SelectItem>
                    {properties.map(property => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-reference">Referenz</Label>
                  <Input
                    id="edit-reference"
                    name="reference"
                    type="text"
                    defaultValue={editingTransaction.reference || ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-notes">Notizen</Label>
                  <Input
                    id="edit-notes"
                    name="notes"
                    type="text"
                    defaultValue={editingTransaction.notes || ''}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={updateTransaction.isPending}>
                  {updateTransaction.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Speichern
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Bank Account Dialog (accessible from manual entry) */}
      <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Neues Bankkonto anlegen
            </DialogTitle>
            <DialogDescription>
              Erstellen Sie ein neues Bankkonto für Ihre Buchungen
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-account-name">Kontoname <span className="text-destructive">*</span></Label>
              <Input
                id="new-account-name"
                placeholder="z.B. Haupt-Girokonto"
                value={newAccount.name}
                onChange={(e) => setNewAccount({...newAccount, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-account-iban">IBAN (optional)</Label>
              <Input
                id="new-account-iban"
                placeholder="AT..."
                value={newAccount.iban}
                onChange={(e) => setNewAccount({...newAccount, iban: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-account-bank">Bank (optional)</Label>
              <Input
                id="new-account-bank"
                placeholder="z.B. Erste Bank"
                value={newAccount.bankName}
                onChange={(e) => setNewAccount({...newAccount, bankName: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-account-property">Zugeordnete Liegenschaft (optional)</Label>
              <Select 
                value={newAccount.propertyId || 'none'} 
                onValueChange={(val) => setNewAccount({...newAccount, propertyId: val === 'none' ? '' : val})}
              >
                <SelectTrigger id="new-account-property">
                  <SelectValue placeholder="Keine Liegenschaft" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Keine Liegenschaft --</SelectItem>
                  {properties.map(property => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Wenn zugeordnet, werden alle Buchungen dieses Kontos automatisch dieser Liegenschaft zugewiesen
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-account-balance">Anfangsbestand</Label>
                <Input
                  id="new-account-balance"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={newAccount.openingBalance}
                  onChange={(e) => setNewAccount({...newAccount, openingBalance: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-account-date">Datum Anfangsbestand</Label>
                <Input
                  id="new-account-date"
                  type="date"
                  value={newAccount.openingDate}
                  onChange={(e) => setNewAccount({...newAccount, openingDate: e.target.value})}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowAddAccount(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleCreateAccount} disabled={createBankAccount.isPending || !newAccount.name.trim()}>
                {createBankAccount.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Konto erstellen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* SEPA Export Dialog */}
      <SepaExportDialog open={showSepaExport} onOpenChange={setShowSepaExport} />

      {/* SEPA Collection History - shown in main content when needed */}
    </MainLayout>
  );
}
