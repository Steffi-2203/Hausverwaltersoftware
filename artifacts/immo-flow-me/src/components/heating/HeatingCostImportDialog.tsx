import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Plus, Trash2, Flame } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import { useCreateHeatingCostReading, useBulkCreateHeatingCostReadings } from '@/hooks/useHeatingCostReadings';
import { useOrganization } from '@/hooks/useOrganization';
import Papa from 'papaparse';

interface HeatingCostImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}

interface ParsedRow {
  unitIdentifier: string;
  unitId: string | null;
  consumption: number;
  consumptionUnit: string;
  costShare: number;
  valid: boolean;
}

export function HeatingCostImportDialog({ open, onOpenChange, propertyId }: HeatingCostImportDialogProps) {
  const [activeTab, setActiveTab] = useState<'csv' | 'manual'>('csv');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [provider, setProvider] = useState('');
  const [consumptionUnit, setConsumptionUnit] = useState('kWh');

  // CSV state
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [csvError, setCsvError] = useState('');

  // Manual state
  const [manualEntries, setManualEntries] = useState<{ unitId: string; consumption: string; costShare: string }[]>([]);

  const { data: units = [] } = useUnits(propertyId);
  const { data: organization } = useOrganization();
  const createReading = useCreateHeatingCostReading();
  const bulkCreate = useBulkCreateHeatingCostReadings();

  const matchUnit = (identifier: string): string | null => {
    const normalized = identifier.trim().toLowerCase();
    const unit = units.find((u: any) =>
      (u.top_nummer || '').toLowerCase() === normalized ||
      (u.top_nummer || '').toLowerCase().replace(/\s/g, '') === normalized.replace(/\s/g, '')
    );
    return unit?.id || null;
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: ParsedRow[] = results.data.map((row: any) => {
          const unitIdentifier = row['Einheit'] || row['Top'] || row['unit'] || row['Unit'] || Object.values(row)[0] || '';
          const consumption = parseFloat(String(row['Verbrauch'] || row['consumption'] || row['Consumption'] || Object.values(row)[1] || '0').replace(',', '.'));
          const costShare = parseFloat(String(row['Kosten'] || row['Betrag'] || row['cost'] || row['Cost'] || Object.values(row)[2] || '0').replace(',', '.'));
          const unitId = matchUnit(String(unitIdentifier));

          return {
            unitIdentifier: String(unitIdentifier),
            unitId,
            consumption: isNaN(consumption) ? 0 : consumption,
            consumptionUnit,
            costShare: isNaN(costShare) ? 0 : costShare,
            valid: !!unitId && !isNaN(consumption),
          };
        });

        if (rows.length === 0) {
          setCsvError('CSV enthält keine Daten. Erwartete Spalten: Einheit, Verbrauch, Kosten');
          return;
        }

        setParsedRows(rows);
      },
      error: () => {
        setCsvError('CSV konnte nicht gelesen werden');
      },
    });
  };

  const handleCsvImport = async () => {
    const validRows = parsedRows.filter(r => r.valid && r.unitId);
    if (validRows.length === 0) return;

    const readings = validRows.map(r => ({
      organization_id: organization?.id || null,
      property_id: propertyId,
      unit_id: r.unitId!,
      period_from: periodFrom,
      period_to: periodTo,
      consumption: r.consumption,
      consumption_unit: r.consumptionUnit,
      cost_share: r.costShare,
      source: 'csv' as const,
      provider: provider || null,
      notes: null,
    }));

    await bulkCreate.mutateAsync(readings);
    handleClose();
  };

  const handleManualSave = async () => {
    const validEntries = manualEntries.filter(e => e.unitId && e.consumption);

    for (const entry of validEntries) {
      await createReading.mutateAsync({
        organization_id: organization?.id || null,
        property_id: propertyId,
        unit_id: entry.unitId,
        period_from: periodFrom,
        period_to: periodTo,
        consumption: parseFloat(entry.consumption.replace(',', '.')) || 0,
        consumption_unit: consumptionUnit,
        cost_share: parseFloat(entry.costShare.replace(',', '.')) || 0,
        source: 'manual',
        provider: provider || null,
        notes: null,
      });
    }

    handleClose();
  };

  const addManualEntry = () => {
    setManualEntries(prev => [...prev, { unitId: '', consumption: '', costShare: '' }]);
  };

  const removeManualEntry = (index: number) => {
    setManualEntries(prev => prev.filter((_, i) => i !== index));
  };

  const updateManualEntry = (index: number, field: string, value: string) => {
    setManualEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const handleClose = () => {
    setParsedRows([]);
    setCsvError('');
    setManualEntries([]);
    onOpenChange(false);
  };

  const validCsvCount = parsedRows.filter(r => r.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            Heizkostendaten importieren
          </DialogTitle>
          <DialogDescription>
            Importieren Sie externe Heizkostenabrechnungen (z.B. ISTA, Techem) per CSV oder manuelle Eingabe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* Common fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Abrechnungszeitraum von</Label>
              <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Abrechnungszeitraum bis</Label>
              <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Anbieter (optional)</Label>
              <Input placeholder="z.B. ISTA, Techem" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Verbrauchseinheit</Label>
              <Select value={consumptionUnit} onValueChange={setConsumptionUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kWh">kWh</SelectItem>
                  <SelectItem value="MWh">MWh</SelectItem>
                  <SelectItem value="m³">m³</SelectItem>
                  <SelectItem value="HKV">HKV (Heizkostenverteiler)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'csv' | 'manual')}>
            <TabsList>
              <TabsTrigger value="csv">CSV-Import</TabsTrigger>
              <TabsTrigger value="manual">Manuelle Eingabe</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-4">
              <div className="space-y-2">
                <Label>CSV-Datei</Label>
                <Input type="file" accept=".csv,.txt" onChange={handleCsvUpload} />
                <p className="text-xs text-muted-foreground">
                  Erwartete Spalten: Einheit (Top-Nr.), Verbrauch, Kosten
                </p>
              </div>

              {csvError && (
                <p className="text-sm text-destructive">{csvError}</p>
              )}

              {parsedRows.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Einheit (CSV)</TableHead>
                        <TableHead>Zuordnung</TableHead>
                        <TableHead className="text-right">Verbrauch</TableHead>
                        <TableHead className="text-right">Kosten (€)</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">{row.unitIdentifier}</TableCell>
                          <TableCell>
                            {row.unitId ? (
                              <span className="text-success">
                                {(units.find((u: any) => u.id === row.unitId) as any)?.top_nummer}
                              </span>
                            ) : (
                              <Select
                                value={row.unitId || ''}
                                onValueChange={(v) => {
                                  setParsedRows(prev => prev.map((r, idx) =>
                                    idx === i ? { ...r, unitId: v, valid: !!v } : r
                                  ));
                                }}
                              >
                                <SelectTrigger className="w-32 h-8">
                                  <SelectValue placeholder="Zuordnen..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {units.map((u: any) => (
                                    <SelectItem key={u.id} value={u.id}>{u.top_nummer}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{row.consumption} {consumptionUnit}</TableCell>
                          <TableCell className="text-right">€ {row.costShare.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={row.valid ? 'default' : 'destructive'}>
                              {row.valid ? '✓' : '✗'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-3 bg-muted text-sm">
                    {validCsvCount} von {parsedRows.length} Zeilen zugeordnet
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              {manualEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="mb-4">Noch keine Einträge. Fügen Sie Ablesungen hinzu.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {manualEntries.map((entry, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Einheit</Label>
                        <Select value={entry.unitId} onValueChange={(v) => updateManualEntry(i, 'unitId', v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Wählen..." /></SelectTrigger>
                          <SelectContent>
                            {units.map((u: any) => (
                              <SelectItem key={u.id} value={u.id}>{u.top_nummer}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Verbrauch ({consumptionUnit})</Label>
                        <Input className="h-9" placeholder="0" value={entry.consumption} onChange={(e) => updateManualEntry(i, 'consumption', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Kosten (€)</Label>
                        <Input className="h-9" placeholder="0,00" value={entry.costShare} onChange={(e) => updateManualEntry(i, 'costShare', e.target.value)} />
                      </div>
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeManualEntry(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" onClick={addManualEntry} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Eintrag hinzufügen
              </Button>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Abbrechen</Button>
          {activeTab === 'csv' ? (
            <Button
              onClick={handleCsvImport}
              disabled={validCsvCount === 0 || !periodFrom || !periodTo || bulkCreate.isPending}
            >
              {bulkCreate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {validCsvCount} Ablesungen importieren
            </Button>
          ) : (
            <Button
              onClick={handleManualSave}
              disabled={manualEntries.length === 0 || !periodFrom || !periodTo || createReading.isPending}
            >
              {createReading.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
