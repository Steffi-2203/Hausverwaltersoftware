import { useState, useMemo, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { 
  CreditCard, 
  Search, 
  Loader2, 
  Euro, 
  CheckCircle2, 
  AlertTriangle,
  Clock,
  Users,
  Info,
  ArrowRightLeft,
  ChevronRight,
  Calendar,
  CalendarDays,
  ReceiptText,
  Check
} from 'lucide-react';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { usePayments } from '@/hooks/usePayments';
import { useTransactions, useUpdateTransaction } from '@/hooks/useTransactions';
import { useAccountCategories } from '@/hooks/useAccountCategories';
import { useAssignPaymentWithSplit } from '@/hooks/usePaymentSplit';
import { useCombinedPayments } from '@/hooks/useCombinedPayments';
import { useMrgAllocation } from '@/hooks/useMrgAllocation';
import { useMrgAllocationYearly } from '@/hooks/useMrgAllocationYearly';
import { useUnpaidTenantFees, useMarkFeePaid, FEE_TYPE_LABELS } from '@/hooks/useTenantFees';
import { format, differenceInDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { TenantPaymentDetailDialog } from '@/components/payments/TenantPaymentDetailDialog';
import { DataConsistencyAlert } from '@/components/banking/DataConsistencyAlert';

export default function PaymentList() {
  const now = new Date();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number>(2025); // Default to 2025 for simulation data
  const [selectedMonth, setSelectedMonth] = useState<number>(1); // Default to January 2025
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [splitPreview, setSplitPreview] = useState<{ bk: number; hk: number; miete: number } | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedDetailTenant, setSelectedDetailTenant] = useState<any>(null);
  const [selectedDetailUnit, setSelectedDetailUnit] = useState<any>(null);
  
  const { data: tenants } = useTenants();
  const { data: units } = useUnits();
  const { data: properties } = useProperties();
  const { data: payments } = usePayments();
  const { data: transactions, isLoading: transactionsLoading } = useTransactions();
  const { data: categories } = useAccountCategories();
  const { data: combinedPayments } = useCombinedPayments();
  const updateTransaction = useUpdateTransaction();
  const assignPaymentWithSplit = useAssignPaymentWithSplit();
  
  // Tenant fees
  const { data: unpaidFees, isLoading: feesLoading } = useUnpaidTenantFees();
  const markFeePaid = useMarkFeePaid();

  // Get income categories
  const mieteinnahmenCategory = useMemo(() => {
    return categories?.find(c => c.name === 'Mieteinnahmen' && c.type === 'income');
  }, [categories]);

  const bkCategory = useMemo(() => {
    return categories?.find(c => c.name === 'Betriebskostenvorauszahlungen' && c.type === 'income');
  }, [categories]);

  const hkCategory = useMemo(() => {
    return categories?.find(c => c.name === 'Heizungskostenvorauszahlungen' && c.type === 'income');
  }, [categories]);

  // Filter transactions to only show rental income (Mieteinnahmen, BK, HK)
  const incomeCategories = useMemo(() => {
    return [mieteinnahmenCategory?.id, bkCategory?.id, hkCategory?.id].filter(Boolean);
  }, [mieteinnahmenCategory, bkCategory, hkCategory]);

  // Get unit IDs for selected property
  const propertyUnitIds = useMemo(() => {
    if (!units || selectedPropertyId === 'all') return null;
    return units.filter(u => u.propertyId === selectedPropertyId).map(u => u.id);
  }, [units, selectedPropertyId]);

  const rentalIncomeTransactions = useMemo(() => {
    if (!transactions || incomeCategories.length === 0) return [];
    let filtered = transactions
      .filter(t => incomeCategories.includes(t.category_id) && Number(t.amount) > 0);
    
    // Filter by property if selected
    if (propertyUnitIds) {
      filtered = filtered.filter(t => {
        // Check via unit_id on transaction
        if (t.unit_id && propertyUnitIds.includes(t.unit_id)) return true;
        // Check via tenant's unit
        if (t.tenant_id) {
          const tenant = tenants?.find(ten => ten.id === t.tenant_id);
          if (tenant && propertyUnitIds.includes(tenant.unitId)) return true;
        }
        return false;
      });
    }
    
    return filtered.sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [transactions, incomeCategories, propertyUnitIds, tenants]);

  // Filter payments by property and current month (same as Reports logic)
  const filteredPayments = useMemo(() => {
    let filtered = (payments || []).filter(p => {
      const date = new Date(p.eingangsDatum);
      const paymentMonth = date.getMonth() + 1;
      const paymentYear = date.getFullYear();
      
      // In 'year' viewMode, show all payments for the selected year
      // In 'month' viewMode, filter by both month and year
      if (viewMode === 'year') {
        return paymentYear === selectedYear;
      }
      return paymentMonth === selectedMonth && paymentYear === selectedYear;
    });
    
    // Filter by property if selected
    if (propertyUnitIds) {
      filtered = filtered.filter(p => {
        const tenant = tenants?.find(t => t.id === p.tenantId);
        return tenant && propertyUnitIds.includes(tenant.unitId);
      });
    }
    
    // Filter by search query
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      filtered = filtered.filter(p => {
        const tenant = tenants?.find(t => t.id === p.tenantId);
        const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.toLowerCase() : '';
        return (
          p.referenz?.toLowerCase().includes(searchLower) ||
          tenantName.includes(searchLower)
        );
      });
    }
    
    return filtered.sort((a, b) => new Date(b.eingangsDatum).getTime() - new Date(a.eingangsDatum).getTime());
  }, [payments, propertyUnitIds, tenants, searchQuery, selectedYear, selectedMonth, viewMode]);

  // Use central MRG allocation hook for consistent logic with Reports (monthly)
  const { allocations: mrgAllocationsMonthly, totals: mrgTotalsMonthly, isLoading: mrgLoadingMonthly } = useMrgAllocation(
    selectedPropertyId,
    selectedYear,
    selectedMonth
  );

  // Use yearly MRG allocation hook for cumulative yearly view
  const { allocations: mrgAllocationsYearly, totals: mrgTotalsYearly, isLoading: mrgLoadingYearly } = useMrgAllocationYearly(
    selectedPropertyId,
    selectedYear,
    selectedMonth // monthCount - shows Jan to selected month
  );

  // Select data based on view mode
  const mrgAllocations = viewMode === 'year' ? mrgAllocationsYearly : mrgAllocationsMonthly;
  const mrgTotals = viewMode === 'year' ? mrgTotalsYearly : mrgTotalsMonthly;
  const mrgLoading = viewMode === 'year' ? mrgLoadingYearly : mrgLoadingMonthly;

  // Stats from central MRG allocation
  const stats = {
    totalSoll: mrgTotals.totalSoll,
    totalIst: mrgTotals.totalIst,
    totalUnterzahlung: mrgTotals.totalUnterzahlung,
    totalUeberzahlung: mrgTotals.totalUeberzahlung,
    paymentCount: mrgTotals.paymentCount,
  };

  // Open items per tenant from central MRG allocation
  const openItemsPerTenant = mrgAllocations;

  // Filter unpaid fees by property
  const filteredUnpaidFees = useMemo(() => {
    if (!unpaidFees || !tenants || !units) return [];
    if (selectedPropertyId === 'all') return unpaidFees;
    
    return unpaidFees.filter(fee => {
      const tenant = tenants.find(t => t.id === fee.tenant_id);
      if (!tenant) return false;
      const unit = units.find(u => u.id === tenant.unitId);
      return unit?.propertyId === selectedPropertyId;
    });
  }, [unpaidFees, tenants, units, selectedPropertyId]);

  // Calculate total unpaid fees
  const totalUnpaidFees = useMemo(() => {
    return filteredUnpaidFees.reduce((sum, fee) => sum + Number(fee.amount), 0);
  }, [filteredUnpaidFees]);

  const openItemsStats = {
    totalTenants: openItemsPerTenant.filter(item => item.saldo !== 0).length,
    totalOpenAmount: mrgTotals.totalUnterzahlung,
    overdueCount: openItemsPerTenant.filter(item => item.oldestOverdueDays > 0 && item.saldo < 0).length,
    totalUeberzahlung: mrgTotals.totalUeberzahlung,
    unpaidFeesCount: filteredUnpaidFees.length,
    totalUnpaidFees: totalUnpaidFees,
  };

  // Helper to get tenant and unit info for a transaction
  // If tenant_id is set, use that. Otherwise, try to find active tenant for the unit_id
  const getTransactionDetails = (transaction: any) => {
    let tenant = null;
    let unit = null;

    // First try direct tenant_id
    if (transaction.tenant_id) {
      tenant = tenants?.find(t => t.id === transaction.tenant_id);
    }
    
    // Get unit info
    if (transaction.unit_id) {
      unit = units?.find(u => u.id === transaction.unit_id);
      
      // If no tenant found via tenant_id, try to find active tenant for this unit
      if (!tenant && unit) {
        tenant = tenants?.find(t => t.unitId === transaction.unit_id && t.status === 'aktiv');
      }
    }
    
    return { tenant, unit };
  };

  // Handle reassignment of unmatched transactions
  const handleReassign = (transaction: any) => {
    setSelectedTransaction(transaction);
    setSelectedTenantId('');
    setSplitPreview(null);
    setReassignDialogOpen(true);
  };

  // Update split preview when tenant is selected
  const handleTenantSelect = useCallback((tenantId: string) => {
    setSelectedTenantId(tenantId);
    
    if (!selectedTransaction || !tenantId) {
      setSplitPreview(null);
      return;
    }
    
    const tenant = tenants?.find(t => t.id === tenantId);
    if (!tenant) {
      setSplitPreview(null);
      return;
    }
    
    const paymentAmount = Number(selectedTransaction.amount);
    const bkSoll = Number(tenant.betriebskostenVorschuss || 0);
    const hkSoll = Number(tenant.heizungskostenVorschuss || 0);
    const mieteSoll = Number(tenant.grundmiete || 0);
    
    // Calculate preview
    let remaining = paymentAmount;
    const bk = Math.min(remaining, bkSoll);
    remaining -= bk;
    const hk = Math.min(remaining, hkSoll);
    remaining -= hk;
    const miete = remaining;
    
    setSplitPreview({ bk, hk, miete });
  }, [selectedTransaction, tenants]);

  const confirmReassign = async () => {
    if (!selectedTransaction || !selectedTenantId) return;
    
    const tenant = tenants?.find(t => t.id === selectedTenantId);
    if (!tenant) return;

    // Check if we have the required categories for splitting
    if (mieteinnahmenCategory && bkCategory) {
      try {
        await assignPaymentWithSplit.mutateAsync({
          transactionId: selectedTransaction.id,
          tenantId: selectedTenantId,
          unitId: tenant.unitId,
          paymentAmount: Number(selectedTransaction.amount),
          tenant: {
            betriebskosten_vorschuss: Number(tenant.betriebskostenVorschuss || 0),
            heizungskosten_vorschuss: Number(tenant.heizungskostenVorschuss || 0),
            grundmiete: Number(tenant.grundmiete || 0),
          },
          categories: {
            bkCategoryId: bkCategory.id,
            hkCategoryId: hkCategory?.id || mieteinnahmenCategory.id,
            mieteCategoryId: mieteinnahmenCategory.id,
          },
        });

        setReassignDialogOpen(false);
        setSelectedTransaction(null);
        setSelectedTenantId('');
        setSplitPreview(null);
      } catch (error) {
        console.error('Reassign transaction error:', error);
        const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
        toast.error(`Fehler beim Zuordnen: ${message}`);
      }
    } else {
      // Fallback: simple assignment without splitting
      try {
        await updateTransaction.mutateAsync({
          id: selectedTransaction.id,
          tenant_id: selectedTenantId,
          unit_id: tenant.unitId,
        });

        toast.success(`Transaktion wurde ${tenant.firstName} ${tenant.lastName} zugeordnet`);
        setReassignDialogOpen(false);
        setSelectedTransaction(null);
        setSelectedTenantId('');
        setSplitPreview(null);
      } catch (error) {
        console.error('Reassign transaction error:', error);
        const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
        toast.error(`Fehler beim Zuordnen: ${message}`);
      }
    }
  };

  // Group tenants by property for better overview (include all tenants for payment assignment)
  const tenantsByProperty = useMemo(() => {
    if (!tenants || !units || !properties) return [];
    
    // Include all tenants (aktiv and beendet) for payment assignment
    const grouped: { property: any; activeTenants: any[]; formerTenants: any[] }[] = [];
    
    properties.forEach(property => {
      const propertyUnits = units.filter(u => u.propertyId === property.id);
      const allPropertyTenants = tenants.filter(t => 
        propertyUnits.some(u => u.id === t.unitId)
      ).map(t => ({
        ...t,
        unit: propertyUnits.find(u => u.id === t.unitId)
      }));
      
      const activeTenants = allPropertyTenants.filter(t => t.status === 'aktiv');
      const formerTenants = allPropertyTenants.filter(t => t.status === 'beendet');
      
      if (allPropertyTenants.length > 0) {
        grouped.push({ property, activeTenants, formerTenants });
      }
    });
    
    return grouped;
  }, [tenants, units, properties]);

  return (
    <MainLayout
      title="Mieteinnahmen"
      subtitle="Übersicht der Mieteinnahmen aus der Buchhaltung"
    >
      {/* Data Consistency Alert */}
      <DataConsistencyAlert variant="compact" />

      {/* Info Alert */}
      <Alert className="mb-6 mt-4">
        <Info className="h-4 w-4" />
        <AlertDescription>
          Diese Übersicht zeigt alle Mieteinnahmen aus der Buchhaltung. 
          Neue Zahlungen werden über <strong>Banking → Transaktionen</strong> erfasst und automatisch hier angezeigt.
        </AlertDescription>
      </Alert>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Referenz oder Mieter suchen..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Liegenschaft wählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Liegenschaften</SelectItem>
            {properties?.map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Monat" />
          </SelectTrigger>
          <SelectContent>
            {[
              { value: 1, label: 'Jänner' },
              { value: 2, label: 'Februar' },
              { value: 3, label: 'März' },
              { value: 4, label: 'April' },
              { value: 5, label: 'Mai' },
              { value: 6, label: 'Juni' },
              { value: 7, label: 'Juli' },
              { value: 8, label: 'August' },
              { value: 9, label: 'September' },
              { value: 10, label: 'Oktober' },
              { value: 11, label: 'November' },
              { value: 12, label: 'Dezember' },
            ].map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="w-full sm:w-[100px]">
            <SelectValue placeholder="Jahr" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        {/* View Mode Toggle */}
        <ToggleGroup 
          type="single" 
          value={viewMode} 
          onValueChange={(value) => value && setViewMode(value as 'month' | 'year')}
          className="border rounded-md"
        >
          <ToggleGroupItem value="month" aria-label="Monatsansicht" className="px-3">
            <Calendar className="h-4 w-4 mr-2" />
            Monat
          </ToggleGroupItem>
          <ToggleGroupItem value="year" aria-label="Jahresansicht" className="px-3">
            <CalendarDays className="h-4 w-4 mr-2" />
            Jahr (kumuliert)
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Kumulierte Mieter-Saldo-Übersicht */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">
              {viewMode === 'year' 
                ? `Kumulierte Jahres-Saldo-Übersicht (Jan - ${format(new Date(selectedYear, selectedMonth - 1), 'MMMM', { locale: de })} ${selectedYear})`
                : `Kumulierte Saldo-Übersicht (${format(new Date(selectedYear, selectedMonth - 1), 'MMMM yyyy', { locale: de })})`
              }
            </h3>
            {viewMode === 'year' && (
              <Badge variant="secondary" className="ml-2">
                {selectedMonth} Monate
              </Badge>
            )}
          </div>
          
          {mrgLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Top</TableHead>
                    <TableHead>Mieter</TableHead>
                    <TableHead className="text-right">SOLL</TableHead>
                    <TableHead className="text-right">IST</TableHead>
                    <TableHead className="text-right">Differenz</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Gruppiere nach Property und sortiere nach Top-Nummer
                    const groupedByProperty = (properties || [])
                      .filter(p => selectedPropertyId === 'all' || p.id === selectedPropertyId)
                      .map(property => {
                        const propertyUnits = (units || []).filter(u => u.propertyId === property.id);
                        const propertyAllocations = mrgAllocations
                          .filter(alloc => propertyUnits.some(u => u.id === alloc.unit?.id))
                          .sort((a, b) => {
                            const topA = a.unit?.top_nummer || '';
                            const topB = b.unit?.top_nummer || '';
                            return topA.localeCompare(topB, 'de', { numeric: true });
                          });
                        return { property, allocations: propertyAllocations };
                      })
                      .filter(g => g.allocations.length > 0);

                    if (groupedByProperty.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            Keine Mieter gefunden
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return groupedByProperty.flatMap(({ property, allocations }) => [
                      // Property Header
                      <TableRow key={`header-${property.id}`} className="bg-muted/50">
                        <TableCell colSpan={6} className="font-semibold text-primary">
                          🏠 {property.name}
                        </TableCell>
                      </TableRow>,
                      // Tenant rows
                      ...allocations.map(item => {
                        const sollTotal = item.sollBk + item.sollHk + item.sollMiete;
                        const istTotal = item.istBk + item.istHk + item.istMiete;
                        const differenz = istTotal - sollTotal;
                        
                        return (
                          <TableRow 
                            key={item.tenant.id}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${differenz < -0.01 ? 'bg-red-50/30 dark:bg-red-950/10' : differenz > 0.01 ? 'bg-green-50/30 dark:bg-green-950/10' : ''}`}
                            onClick={() => {
                              setSelectedDetailTenant(item.tenant);
                              setSelectedDetailUnit(item.unit);
                              setDetailDialogOpen(true);
                            }}
                          >
                            <TableCell className="font-medium">{item.unit?.top_nummer || '-'}</TableCell>
                            <TableCell>{item.tenant.first_name} {item.tenant.last_name}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              € {sollTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              € {istTotal.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className={`text-right font-bold ${differenz < -0.01 ? 'text-red-600' : differenz > 0.01 ? 'text-green-600' : ''}`}>
                              {differenz > 0 ? '+' : ''}€ {differenz.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      }),
                    ]);
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* Summary row */}
          {!mrgLoading && (
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Gesamt SOLL: </span>
                <span className="font-semibold">€ {stats.totalSoll.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Gesamt IST: </span>
                <span className="font-semibold">€ {stats.totalIst.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Unterzahlungen: </span>
                <span className="font-semibold text-red-600">€ {stats.totalUnterzahlung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Überzahlungen: </span>
                <span className="font-semibold text-green-600">€ {stats.totalUeberzahlung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs for Payments and Open Items */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payments" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Zahlungseingänge
          </TabsTrigger>
          <TabsTrigger value="openitems" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Offene Posten
            {openItemsStats.totalTenants > 0 && (
              <Badge variant="destructive" className="ml-1">{openItemsStats.totalTenants}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          {/* Payments Table - using payments table like Reports page */}
          <Card>
            <CardContent className="p-0">
              {!payments ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPayments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Keine Zahlungen in diesem Monat gefunden</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Zahlungen werden automatisch aus Transaktionen synchronisiert.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Eingangsdatum</TableHead>
                      <TableHead>Mieter</TableHead>
                      <TableHead>Top</TableHead>
                      <TableHead>Referenz</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                      <TableHead>Zahlungsart</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => {
                      const tenant = tenants?.find(t => t.id === payment.tenantId);
                      const unit = tenant ? units?.find(u => u.id === tenant.unitId) : null;

                      return (
                        <TableRow key={payment.id}>
                          <TableCell>
                            {format(new Date(payment.eingangsDatum), 'dd.MM.yyyy', { locale: de })}
                          </TableCell>
                          <TableCell className="font-medium">
                            {tenant ? `${tenant.firstName} ${tenant.lastName}` : '-'}
                          </TableCell>
                          <TableCell>
                            {unit ? unit.topNummer : '-'}
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {payment.referenz || '-'}
                          </TableCell>
                          <TableCell className="text-right font-bold text-green-600">
                            € {Number(payment.betrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {payment.zahlungsart === 'sepa' ? 'SEPA' : 
                               payment.zahlungsart === 'ueberweisung' ? 'Überweisung' : 
                               payment.zahlungsart === 'bar' ? 'Bar' : 'Sonstige'}
                            </Badge>
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

        {/* Open Items Tab */}
        <TabsContent value="openitems">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                    <Users className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Mieter mit Saldo</p>
                    <p className="text-2xl font-bold">{openItemsStats.totalTenants}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                    <Euro className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gesamt Unterzahlung</p>
                    <p className="text-2xl font-bold text-red-600">€ {openItemsStats.totalOpenAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <Euro className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gesamt Überzahlung</p>
                    <p className="text-2xl font-bold text-green-600">€ {openItemsStats.totalUeberzahlung.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                    <Clock className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Überfällig</p>
                    <p className="text-2xl font-bold text-orange-600">{openItemsStats.overdueCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <ReceiptText className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Offene Gebühren</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {openItemsStats.unpaidFeesCount > 0 
                        ? `€ ${openItemsStats.totalUnpaidFees.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`
                        : '€ 0,00'
                      }
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Unpaid Fees Section */}
          {filteredUnpaidFees.length > 0 && (
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <ReceiptText className="h-5 w-5 text-purple-600" />
                  <h3 className="font-semibold">Offene Gebühren (Rücklastschriften, Mahnungen)</h3>
                  <Badge variant="secondary" className="ml-2">{filteredUnpaidFees.length}</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Mieter</TableHead>
                      <TableHead>Top</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                      <TableHead className="text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnpaidFees.map((fee) => {
                      const tenant = tenants?.find(t => t.id === fee.tenant_id);
                      const unit = tenant ? units?.find(u => u.id === tenant.unitId) : null;
                      
                      return (
                        <TableRow key={fee.id} className="bg-purple-50/30 dark:bg-purple-950/10">
                          <TableCell>
                            {format(new Date(fee.created_at), 'dd.MM.yyyy', { locale: de })}
                          </TableCell>
                          <TableCell className="font-medium">
                            {tenant ? `${tenant.firstName} ${tenant.lastName}` : '-'}
                          </TableCell>
                          <TableCell>{unit?.topNummer || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                              {FEE_TYPE_LABELS[fee.fee_type] || fee.fee_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {fee.description || fee.notes || '-'}
                          </TableCell>
                          <TableCell className="text-right font-bold text-purple-600">
                            € {Number(fee.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => markFeePaid.mutate({ feeId: fee.id })}
                              disabled={markFeePaid.isPending}
                            >
                              {markFeePaid.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-4 w-4 mr-1" />
                                  Bezahlt
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Open Items Table */}
          <Card>
            <CardContent className="p-0">
              {openItemsPerTenant.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                  <p className="text-muted-foreground">Keine offenen Posten</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Alle Mieter sind auf dem aktuellen Stand.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mieter</TableHead>
                      <TableHead>Top</TableHead>
                      <TableHead className="text-right">BK Soll</TableHead>
                      <TableHead className="text-right">BK Ist</TableHead>
                      <TableHead className="text-right">HK Soll</TableHead>
                      <TableHead className="text-right">HK Ist</TableHead>
                      <TableHead className="text-right">Miete Soll</TableHead>
                      <TableHead className="text-right">Miete Ist</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openItemsPerTenant.map((item) => {
                      const hasUnterzahlung = item.saldo < -0.01;
                      const hasUeberzahlung = item.saldo > 0.01;
                      const isVollstaendig = Math.abs(item.saldo) < 0.01;
                      
                      return (
                        <TableRow key={item.tenant.id} className={hasUnterzahlung ? 'bg-red-50/50 dark:bg-red-950/20' : hasUeberzahlung ? 'bg-green-50/50 dark:bg-green-950/20' : ''}>
                          <TableCell className="font-medium">
                            {item.tenant.first_name} {item.tenant.last_name}
                          </TableCell>
                          <TableCell>{item.unit?.top_nummer || '-'}</TableCell>
                          {/* BK */}
                          <TableCell className="text-right text-muted-foreground">
                            € {item.sollBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right ${item.diffBk > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            € {item.istBk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          {/* HK */}
                          <TableCell className="text-right text-muted-foreground">
                            € {item.sollHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right ${item.diffHk > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            € {item.istHk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          {/* Miete */}
                          <TableCell className="text-right text-muted-foreground">
                            € {item.sollMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right ${item.diffMiete > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            € {item.istMiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          {/* Saldo */}
                          <TableCell className={`text-right font-bold ${hasUnterzahlung ? 'text-red-600' : hasUeberzahlung ? 'text-green-600' : ''}`}>
                            {hasUeberzahlung && '+'}€ {item.saldo.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            {isVollstaendig ? (
                              <Badge className="bg-green-100 text-green-800">Bezahlt</Badge>
                            ) : hasUeberzahlung ? (
                              <Badge className="bg-blue-100 text-blue-800">Überzahlung</Badge>
                            ) : item.mahnstatus === 'aktuell' ? (
                              <Badge variant="secondary">Offen</Badge>
                            ) : item.mahnstatus === 'Zahlungserinnerung' ? (
                              <Badge className="bg-yellow-100 text-yellow-800">Zahlungserinnerung</Badge>
                            ) : item.mahnstatus === '1. Mahnung' ? (
                              <Badge className="bg-orange-100 text-orange-800">1. Mahnung</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800">2. Mahnung</Badge>
                            )}
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
      </Tabs>

      {/* Reassignment Dialog */}
      <Dialog open={reassignDialogOpen} onOpenChange={(open) => {
        setReassignDialogOpen(open);
        if (!open) {
          setSplitPreview(null);
          setSelectedTenantId('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Zahlung zuordnen</DialogTitle>
            <DialogDescription>
              Ordnen Sie diese Zahlung einem Mieter zu. Die Zahlung wird automatisch auf BK, Heizung und Miete aufgeteilt (MRG-konform).
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Zahlung vom {format(new Date(selectedTransaction.transaction_date), 'dd.MM.yyyy', { locale: de })}</p>
                <p className="font-semibold text-lg text-green-600">
                  € {Number(selectedTransaction.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                {selectedTransaction.description && (
                  <p className="text-sm mt-1">{selectedTransaction.description}</p>
                )}
                {selectedTransaction.counterpart_name && (
                  <p className="text-sm text-muted-foreground">Von: {selectedTransaction.counterpart_name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Mieter auswählen</Label>
                <Select value={selectedTenantId} onValueChange={handleTenantSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Mieter wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tenantsByProperty.map(({ property, activeTenants, formerTenants }) => (
                      <SelectGroup key={property.id}>
                        <SelectLabel className="text-muted-foreground">
                          🏠 {property.name} - Aktive Mieter
                        </SelectLabel>
                        {activeTenants.map(tenant => (
                          <SelectItem key={tenant.id} value={tenant.id}>
                            {tenant.firstName} {tenant.lastName} (Top {tenant.unit?.topNummer})
                          </SelectItem>
                        ))}
                        {formerTenants.length > 0 && (
                          <>
                            <SelectLabel className="text-muted-foreground mt-2">
                              📋 {property.name} - Altmieter
                            </SelectLabel>
                            {formerTenants.map(tenant => (
                              <SelectItem key={tenant.id} value={tenant.id}>
                                {tenant.firstName} {tenant.lastName} (Top {tenant.unit?.topNummer})
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Split Preview */}
              {splitPreview && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                    Automatische Aufteilung (MRG-konform):
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="text-center p-2 bg-white dark:bg-background rounded">
                      <p className="text-muted-foreground text-xs">Betriebskosten</p>
                      <p className="font-semibold">€ {splitPreview.bk.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 bg-white dark:bg-background rounded">
                      <p className="text-muted-foreground text-xs">Heizung</p>
                      <p className="font-semibold">€ {splitPreview.hk.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 bg-white dark:bg-background rounded">
                      <p className="text-muted-foreground text-xs">Miete</p>
                      <p className="font-semibold">€ {splitPreview.miete.toFixed(2)}</p>
                    </div>
                  </div>
                  {(() => {
                    const tenant = tenants?.find(t => t.id === selectedTenantId);
                    if (!tenant) return null;
                    const totalSoll = Number(tenant.betriebskostenVorschuss || 0) + 
                                     Number(tenant.heizungskostenVorschuss || 0) + 
                                     Number(tenant.grundmiete || 0);
                    const unterzahlung = totalSoll - Number(selectedTransaction.amount);
                    if (unterzahlung > 0.01) {
                      return (
                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                          ⚠️ Unterzahlung: € {unterzahlung.toFixed(2)} (Soll: € {totalSoll.toFixed(2)})
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReassignDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button 
                  onClick={confirmReassign}
                  disabled={!selectedTenantId || assignPaymentWithSplit.isPending || updateTransaction.isPending}
                >
                  {(assignPaymentWithSplit.isPending || updateTransaction.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Zuordnen & Aufteilen
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tenant Payment Detail Dialog */}
      <TenantPaymentDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        tenant={selectedDetailTenant}
        unit={selectedDetailUnit}
        year={selectedYear}
        month={selectedMonth}
      />
    </MainLayout>
  );
}
