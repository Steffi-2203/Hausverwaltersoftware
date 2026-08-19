import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Receipt, Plus, Loader2, Euro, CheckCircle2, Clock, MoreHorizontal, Mail, AlertTriangle, FileDown } from 'lucide-react';
import { useInvoices, useGenerateInvoices, useUpdateInvoiceStatus } from '@/hooks/useInvoices';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { useSendDunning, getDunningStatusLabel, getNextDunningAction } from '@/hooks/useDunning';
import { useUploadTenantDocument } from '@/hooks/useTenantDocuments';
import { useOrganization } from '@/hooks/useOrganization';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { generateVorschreibungPdf } from '@/utils/vorschreibungPdfExport';

const statusLabels: Record<string, string> = {
  offen: 'Offen',
  bezahlt: 'Bezahlt',
  teilbezahlt: 'Teilbezahlt',
  ueberfaellig: 'Überfällig',
};

const statusStyles: Record<string, string> = {
  offen: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  bezahlt: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  teilbezahlt: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ueberfaellig: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const months = [
  { value: '1', label: 'Jänner' },
  { value: '2', label: 'Februar' },
  { value: '3', label: 'März' },
  { value: '4', label: 'April' },
  { value: '5', label: 'Mai' },
  { value: '6', label: 'Juni' },
  { value: '7', label: 'Juli' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Dezember' },
];

export default function InvoiceList() {
  const { toast } = useToast();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(2025); // Default to 2025 for simulation data
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>(undefined);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingPdfs, setIsGeneratingPdfs] = useState(false);

  const { data: invoices, isLoading: invoicesLoading } = useInvoices(selectedYear, selectedMonth);
  const { data: tenants } = useTenants();
  const { data: units } = useUnits();
  const { data: properties } = useProperties();
  const { data: organization } = useOrganization();
  const generateInvoices = useGenerateInvoices();
  const updateStatus = useUpdateInvoiceStatus();
  const sendDunning = useSendDunning();
  const uploadDocument = useUploadTenantDocument();

  const getTenant = (tenantId: string) => tenants?.find(t => t.id === tenantId);
  const getUnit = (unitId: string) => units?.find(u => u.id === unitId);
  const getProperty = (propertyId: string) => properties?.find(p => p.id === propertyId);

  // Filter invoices by selected property
  const filteredInvoices = invoices?.filter(invoice => {
    if (selectedPropertyId === 'all') return true;
    const tenant = getTenant(invoice.tenant_id);
    const unit = tenant ? getUnit(tenant.unit_id) : null;
    return unit?.property_id === selectedPropertyId;
  });

  const handleGenerateInvoices = async () => {
    try {
      const result = await generateInvoices.mutateAsync({
        year: selectedYear,
        month: selectedMonth || now.getMonth() + 1,
      });
      
      toast({
        title: 'Vorschreibungen erstellt',
        description: result.message || `${result.created} Vorschreibungen wurden erstellt.`,
      });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Vorschreibungen konnten nicht erstellt werden.',
        variant: 'destructive',
      });
    }
  };

  const handleGenerateAllMonths = async () => {
    setIsGeneratingAll(true);
    let totalCreated = 0;
    let totalSkipped = 0;
    
    try {
      for (let month = 1; month <= 12; month++) {
        try {
          const result = await generateInvoices.mutateAsync({
            year: selectedYear,
            month,
          });
          totalCreated += result.created || 0;
          totalSkipped += result.skipped || 0;
        } catch (error) {
          console.error(`Error generating invoices for month ${month}:`, error);
        }
      }
      
      toast({
        title: 'Alle Vorschreibungen erstellt',
        description: `${totalCreated} Vorschreibungen erstellt, ${totalSkipped} übersprungen.`,
      });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Nicht alle Vorschreibungen konnten erstellt werden.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const handleMarkAsPaid = async (invoiceId: string) => {
    try {
      await updateStatus.mutateAsync({
        id: invoiceId,
        status: 'bezahlt',
        bezahltAm: new Date().toISOString().split('T')[0],
      });
      toast({
        title: 'Status aktualisiert',
        description: 'Vorschreibung wurde als bezahlt markiert.',
      });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Status konnte nicht aktualisiert werden.',
        variant: 'destructive',
      });
    }
  };

  const handleSendDunning = async (invoice: any, level: 1 | 2) => {
    const tenant = getTenant(invoice.tenant_id);
    const unit = tenant ? getUnit(tenant.unit_id) : null;
    const property = unit ? getProperty(unit.property_id) : null;

    if (!tenant?.email) {
      toast({
        title: 'Keine E-Mail',
        description: 'Für diesen Mieter ist keine E-Mail-Adresse hinterlegt.',
        variant: 'destructive',
      });
      return;
    }

    await sendDunning.mutateAsync({
      invoiceId: invoice.id,
      dunningLevel: level,
      tenantEmail: tenant.email,
      tenantName: `${tenant.first_name} ${tenant.last_name}`,
      propertyName: property?.name || '',
      unitNumber: unit?.top_nummer || '',
      amount: Number(invoice.gesamtbetrag),
      dueDate: invoice.faellig_am,
      invoiceMonth: invoice.month,
      invoiceYear: invoice.year,
    });
  };

  // Generate and upload PDFs for all filtered invoices
  const handleGenerateAndUploadPdfs = async () => {
    if (!filteredInvoices || filteredInvoices.length === 0) {
      toast({
        title: 'Keine Vorschreibungen',
        description: 'Es sind keine Vorschreibungen zum Generieren vorhanden.',
        variant: 'destructive',
      });
      return;
    }

    setIsGeneratingPdfs(true);
    let successCount = 0;
    let errorCount = 0;

    for (const invoice of filteredInvoices) {
      try {
        const tenant = getTenant(invoice.tenant_id);
        const unit = tenant ? getUnit(tenant.unit_id) : null;
        const property = unit ? getProperty(unit.property_id) : null;

        if (!tenant || !unit || !property) {
          errorCount++;
          continue;
        }

        const monthName = months[invoice.month - 1]?.label || '';

        // Generate PDF with Vortrag data
        const pdfBlob = generateVorschreibungPdf({
          tenantName: `${tenant.first_name} ${tenant.last_name}`,
          propertyName: property.name,
          propertyAddress: property.address,
          propertyCity: `${(property as any).postal_code || (property as any).postalCode} ${property.city}`,
          unitNumber: unit.top_nummer || '',
          month: invoice.month,
          year: invoice.year,
          grundmiete: Number(invoice.grundmiete),
          betriebskosten: Number(invoice.betriebskosten),
          heizungskosten: Number(invoice.heizungskosten),
          ustSatzMiete: Number(invoice.ust_satz_miete || 0),
          ustSatzBk: Number(invoice.ust_satz_bk || 0),
          ustSatzHeizung: Number(invoice.ust_satz_heizung || 0),
          ust: Number(invoice.ust || 0),
          gesamtbetrag: Number(invoice.gesamtbetrag),
          faelligAm: invoice.faellig_am,
          iban: organization?.iban || undefined,
          bic: organization?.bic || undefined,
          vortragMiete: Number(invoice.vortrag_miete || 0),
          vortragBk: Number(invoice.vortrag_bk || 0),
          vortragHk: Number(invoice.vortrag_hk || 0),
          vortragSonstige: Number(invoice.vortrag_sonstige || 0),
        });

        // Upload to tenant documents
        await uploadDocument.mutateAsync({
          tenantId: invoice.tenant_id,
          file: pdfBlob,
          name: `Vorschreibung ${monthName} ${invoice.year}`,
          type: 'vorschreibung',
        });

        successCount++;
      } catch (error) {
        console.error('Error generating PDF for invoice:', invoice.id, error);
        errorCount++;
      }
    }

    setIsGeneratingPdfs(false);

    toast({
      title: 'PDFs generiert',
      description: `${successCount} Vorschreibungen als PDF beim Mieter abgelegt.${errorCount > 0 ? ` ${errorCount} Fehler.` : ''}`,
    });
  };

  // Calculate statistics based on filtered invoices
  const stats = {
    total: filteredInvoices?.length || 0,
    open: filteredInvoices?.filter(i => i.status === 'offen').length || 0,
    paid: filteredInvoices?.filter(i => i.status === 'bezahlt').length || 0,
    overdue: filteredInvoices?.filter(i => i.status === 'ueberfaellig').length || 0,
    totalAmount: filteredInvoices?.reduce((sum, i) => sum + Number(i.gesamtbetrag), 0) || 0,
    openAmount: filteredInvoices?.filter(i => i.status !== 'bezahlt').reduce(
      (sum, i) => sum + Number(i.gesamtbetrag) - (i.status === 'teilbezahlt' ? Number(i.paidAmount || 0) : 0),
      0,
    ) || 0,
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <MainLayout
      title="Vorschreibungen"
      subtitle="Monatliche Mietvorschreibungen verwalten"
    >
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex gap-2">
          <Select
            value={selectedYear.toString()}
            onValueChange={(value) => setSelectedYear(parseInt(value))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Jahr" />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedMonth?.toString() || 'all'}
            onValueChange={(value) => setSelectedMonth(value === 'all' ? undefined : parseInt(value))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Monat" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Monate</SelectItem>
              {months.map((month) => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedPropertyId}
            onValueChange={setSelectedPropertyId}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Liegenschaften" />
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
        </div>

        <div className="flex-1" />

        <div className="flex gap-2 flex-wrap">
          <Button 
            variant="outline"
            onClick={handleGenerateAndUploadPdfs}
            disabled={isGeneratingPdfs || !filteredInvoices || filteredInvoices.length === 0}
          >
            {isGeneratingPdfs ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            PDFs generieren & ablegen
          </Button>

          <Button 
            variant="outline"
            onClick={handleGenerateAllMonths} 
            disabled={isGeneratingAll || generateInvoices.isPending}
          >
            {isGeneratingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Alle Monate {selectedYear}
          </Button>
          
          <Button onClick={handleGenerateInvoices} disabled={generateInvoices.isPending || isGeneratingAll}>
            {generateInvoices.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Vorschreibungen generieren
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesamt</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offen</p>
                <p className="text-2xl font-bold">{stats.open}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Bezahlt</p>
                <p className="text-2xl font-bold">{stats.paid}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Euro className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offener Betrag</p>
                <p className="text-2xl font-bold">€ {stats.openAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices Table */}
      <Card>
        <CardContent className="p-0">
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !filteredInvoices || filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Keine Vorschreibungen gefunden</p>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedPropertyId !== 'all' 
                  ? 'Keine Vorschreibungen für diese Liegenschaft vorhanden.'
                  : 'Klicken Sie auf "Vorschreibungen generieren" um neue zu erstellen.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead>Mieter</TableHead>
                  <TableHead>Top / Liegenschaft</TableHead>
                  <TableHead className="text-right">Grundmiete</TableHead>
                  <TableHead className="text-right">BK</TableHead>
                  <TableHead className="text-right">Heizung</TableHead>
                  <TableHead className="text-right">Vortrag</TableHead>
                  <TableHead className="text-right">Gesamt</TableHead>
                  <TableHead>Fällig am</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mahnung</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => {
                  const tenant = getTenant(invoice.tenant_id);
                  const unit = tenant ? getUnit(tenant.unit_id) : null;
                  const property = unit ? getProperty(unit.property_id) : null;
                  const mahnstufe = (invoice as any).mahnstufe || 0;
                  const nextAction = getNextDunningAction(mahnstufe);
                  const isOpenOrOverdue = invoice.status === 'offen' || invoice.status === 'ueberfaellig';
                  
                  // Calculate Vortrag - ensure numeric values
                  const vortragMiete = Number(invoice.vortrag_miete) || 0;
                  const vortragBk = Number(invoice.vortrag_bk) || 0;
                  const vortragHk = Number(invoice.vortrag_hk) || 0;
                  const vortragSonstige = Number(invoice.vortrag_sonstige) || 0;
                  const vortragGesamt = vortragMiete + vortragBk + vortragHk + vortragSonstige;

                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">
                        {months[invoice.month - 1]?.label} {invoice.year}
                      </TableCell>
                      <TableCell>
                        {tenant ? `${tenant.first_name} ${tenant.last_name}` : '-'}
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">{unit?.top_nummer || '-'}</span>
                          <span className="text-muted-foreground text-sm ml-2">
                            {property?.name || '-'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        € {Number(invoice.grundmiete).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        € {Number(invoice.betriebskosten).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        € {Number(invoice.heizungskosten).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        {vortragGesamt !== 0 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className={vortragGesamt > 0 ? 'text-destructive' : 'text-green-600'}>
                                  € {vortragGesamt.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs space-y-1">
                                  {vortragMiete !== 0 && <p>Miete: € {vortragMiete.toFixed(2)}</p>}
                                  {vortragBk !== 0 && <p>BK: € {vortragBk.toFixed(2)}</p>}
                                  {vortragHk !== 0 && <p>HK: € {vortragHk.toFixed(2)}</p>}
                                  {vortragSonstige !== 0 && <p>Sonstige: € {vortragSonstige.toFixed(2)}</p>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <div className="flex flex-col items-end gap-0.5">
                          <span>€ {Number(invoice.gesamtbetrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                          {invoice.status === 'teilbezahlt' && invoice.paidAmount != null && (
                            <span className="text-xs font-normal text-amber-600 dark:text-amber-400" data-testid={`text-invoice-offen-${invoice.id}`}>
                              Offen: € {(Number(invoice.gesamtbetrag) - Number(invoice.paidAmount)).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                          {invoice.status === 'bezahlt' && (
                            <span className="flex items-center gap-0.5 text-xs font-normal text-green-600 dark:text-green-400" data-testid={`text-invoice-bezahlt-${invoice.id}`}>
                              <CheckCircle2 className="h-3 w-3" />
                              Bezahlt
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {invoice.faellig_am ? format(new Date(invoice.faellig_am), 'dd.MM.yyyy', { locale: de }) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusStyles[invoice.status]}>
                          {statusLabels[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              {mahnstufe === 0 ? (
                                <span className="text-muted-foreground text-sm">-</span>
                              ) : mahnstufe === 1 ? (
                                <Badge variant="outline" className="text-yellow-600 border-yellow-300">
                                  <Mail className="h-3 w-3 mr-1" />
                                  Erinnerung
                                </Badge>
                              ) : (
                                <Badge variant="destructive">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Mahnung
                                </Badge>
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{getDunningStatusLabel(mahnstufe)}</p>
                              {(invoice as any).zahlungserinnerung_am && (
                                <p className="text-xs text-muted-foreground">
                                  Erinnerung: {format(new Date((invoice as any).zahlungserinnerung_am), 'dd.MM.yyyy')}
                                </p>
                              )}
                              {(invoice as any).mahnung_am && (
                                <p className="text-xs text-muted-foreground">
                                  Mahnung: {format(new Date((invoice as any).mahnung_am), 'dd.MM.yyyy')}
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {invoice.status !== 'bezahlt' && (
                              <DropdownMenuItem onClick={() => handleMarkAsPaid(invoice.id)}>
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Als bezahlt markieren
                              </DropdownMenuItem>
                            )}
                            {isOpenOrOverdue && nextAction && tenant?.email && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleSendDunning(invoice, nextAction.level)}
                                  disabled={sendDunning.isPending}
                                >
                                  <Mail className="h-4 w-4 mr-2" />
                                  {nextAction.label}
                                </DropdownMenuItem>
                              </>
                            )}
                            {isOpenOrOverdue && !tenant?.email && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem disabled>
                                  <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                                  <span className="text-muted-foreground">Keine E-Mail hinterlegt</span>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </MainLayout>
  );
}
