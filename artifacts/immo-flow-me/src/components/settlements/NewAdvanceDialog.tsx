import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, FileText, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { generateVorschussAenderungPdf } from '@/utils/vorschussAenderungPdfExport';
import { useUploadTenantDocument } from '@/hooks/useTenantDocuments';
import { apiRequest } from '@/lib/queryClient';

interface TenantAdvanceChange {
  tenantId: string;
  tenantName: string;
  unitNumber: string;
  oldBk: number;
  newBk: number;
  oldHk: number;
  newHk: number;
  grundmiete: number;
}

interface NewAdvanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  settlementYear: number;
  tenantChanges: TenantAdvanceChange[];
  onConfirm: (effectiveMonth: number, effectiveYear: number) => Promise<void>;
  isPending: boolean;
}

const monthNames = [
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

export function NewAdvanceDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  propertyAddress,
  settlementYear,
  tenantChanges,
  onConfirm,
  isPending,
}: NewAdvanceDialogProps) {
  const currentDate = new Date();
  const defaultYear = settlementYear + 1;
  const defaultMonth = currentDate.getMonth() + 2; // Next month

  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth > 12 ? 1 : defaultMonth);
  const [selectedYear, setSelectedYear] = useState<number>(defaultMonth > 12 ? defaultYear + 1 : defaultYear);
  const [createDocuments, setCreateDocuments] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const uploadDocument = useUploadTenantDocument();

  const years = [defaultYear, defaultYear + 1, defaultYear + 2];

  const formatCurrency = (amount: number) => 
    `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`;

  const handleConfirm = async () => {
    setIsProcessing(true);
    
    try {
      // First, save the effective date to all tenants
      for (const tenant of tenantChanges) {
        const effectiveDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
        await apiRequest('PATCH', `/api/tenants/${tenant.tenantId}`, { 
          vorschuss_gueltig_ab: effectiveDate 
        });
      }

      // Generate and save PDFs if requested
      if (createDocuments) {
        for (const tenant of tenantChanges) {
          const pdfBlob = generateVorschussAenderungPdf({
            tenantName: tenant.tenantName,
            propertyName,
            propertyAddress,
            unitNumber: tenant.unitNumber,
            oldBk: tenant.oldBk,
            newBk: tenant.newBk,
            oldHk: tenant.oldHk,
            newHk: tenant.newHk,
            grundmiete: tenant.grundmiete,
            effectiveMonth: selectedMonth,
            effectiveYear: selectedYear,
            settlementYear,
          });

          const monthLabel = monthNames.find(m => m.value === String(selectedMonth))?.label || '';
          const docName = `Vorschuss-Änderung ${monthLabel} ${selectedYear}`;

          await uploadDocument.mutateAsync({
            tenantId: tenant.tenantId,
            file: pdfBlob,
            name: docName,
            type: 'vorschuss_aenderung',
          });
        }
        toast.success(`${tenantChanges.length} Änderungsschreiben erstellt und beim Mieter hinterlegt`);
      }

      // Call the parent confirm handler to update advances
      await onConfirm(selectedMonth, selectedYear);
      
      onOpenChange(false);
    } catch (error) {
      console.error('Error processing advance changes:', error);
      toast.error('Fehler beim Verarbeiten der Vorschuss-Änderungen');
    } finally {
      setIsProcessing(false);
    }
  };

  const isLoading = isPending || isProcessing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Vorschreibung festlegen</DialogTitle>
          <DialogDescription>
            Wählen Sie, ab welchem Zeitpunkt die neuen Vorschüsse für {propertyName} gelten sollen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Date Selection */}
          <div className="flex gap-4">
            <div className="space-y-2">
              <Label>Gültig ab Monat</Label>
              <Select
                value={selectedMonth.toString()}
                onValueChange={(v) => setSelectedMonth(parseInt(v))}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthNames.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Jahr</Label>
              <Select
                value={selectedYear.toString()}
                onValueChange={(v) => setSelectedYear(parseInt(v))}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview Table */}
          <div className="space-y-2">
            <Label>Vorschau der neuen monatlichen Vorschreibungen:</Label>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mieter / Top</TableHead>
                    <TableHead className="text-right">BK bisher</TableHead>
                    <TableHead className="text-right">BK neu</TableHead>
                    <TableHead className="text-right">HK bisher</TableHead>
                    <TableHead className="text-right">HK neu</TableHead>
                    <TableHead className="text-right">Differenz</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantChanges.map((tenant) => {
                    const totalDiff = (tenant.newBk - tenant.oldBk) + (tenant.newHk - tenant.oldHk);
                    return (
                      <TableRow key={tenant.tenantId}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{tenant.tenantName}</span>
                            <span className="text-muted-foreground text-sm ml-2">
                              Top {tenant.unitNumber}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(tenant.oldBk)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(tenant.newBk)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(tenant.oldHk)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(tenant.newHk)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`flex items-center justify-end gap-1 ${
                            totalDiff > 0 ? 'text-destructive' : totalDiff < 0 ? 'text-success' : ''
                          }`}>
                            {totalDiff > 0 && <TrendingUp className="h-3 w-3" />}
                            {totalDiff < 0 && <TrendingDown className="h-3 w-3" />}
                            {totalDiff >= 0 ? '+' : ''}{formatCurrency(totalDiff)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Document Creation Checkbox */}
          <div className="flex items-center space-x-2 p-4 bg-muted rounded-lg">
            <Checkbox
              id="createDocuments"
              checked={createDocuments}
              onCheckedChange={(checked) => setCreateDocuments(checked === true)}
            />
            <Label htmlFor="createDocuments" className="flex items-center gap-2 cursor-pointer">
              <FileText className="h-4 w-4" />
              Änderungsschreiben für Mieter erstellen und hinterlegen
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Abbrechen
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Vorschüsse aktualisieren
            {createDocuments && ' + Schreiben erstellen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
