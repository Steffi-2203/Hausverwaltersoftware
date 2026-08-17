import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization, useUpdateOrganization } from '@/hooks/useOrganization';
import { useCreateSepaCollection } from '@/hooks/useSepaCollections';
import { generateSepaXml, downloadSepaXml, validateCreditor, SepaCreditor, SepaDebtor, generateMessageId } from '@/utils/sepaExport';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';

interface SepaExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SepaExportDialog({ open, onOpenChange }: SepaExportDialogProps) {
  const { data: tenants } = useTenants();
  const { data: units } = useUnits();
  const { data: properties } = useProperties();
  const { data: organization } = useOrganization();
  const updateOrganization = useUpdateOrganization();
  const createSepaCollection = useCreateSepaCollection();

  // Creditor form state (from organization)
  const [creditorName, setCreditorName] = useState(organization?.name || '');
  const [creditorIban, setCreditorIban] = useState((organization as any)?.iban || '');
  const [creditorBic, setCreditorBic] = useState((organization as any)?.bic || '');
  const [creditorId, setCreditorId] = useState((organization as any)?.sepa_creditor_id || '');
  
  // Export settings
  const [collectionDate, setCollectionDate] = useState(
    format(addDays(new Date(), 5), 'yyyy-MM-dd')
  );
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(new Set());
  const [batchBooking, setBatchBooking] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Get tenants with valid SEPA mandates
  const sepaTenants = useMemo(() => {
    if (!tenants) return [];
    
    return tenants.filter(t => 
      t.sepa_mandat && 
      t.iban && 
      t.mandat_reference &&
      t.status === 'aktiv'
    ).map(t => {
      const unit = units?.find(u => u.id === t.unit_id);
      const property = unit ? properties?.find(p => p.id === unit.property_id) : null;
      const totalAmount = Number(t.grundmiete || 0) + 
                         Number(t.betriebskosten_vorschuss || 0) + 
                         Number(t.heizungskosten_vorschuss || 0);
      
      return {
        ...t,
        unit,
        property,
        totalAmount,
      };
    });
  }, [tenants, units, properties]);

  // Initialize selection with all SEPA tenants
  useState(() => {
    if (sepaTenants.length > 0 && selectedTenantIds.size === 0) {
      setSelectedTenantIds(new Set(sepaTenants.map(t => t.id)));
    }
  });

  const toggleTenant = (tenantId: string) => {
    const newSet = new Set(selectedTenantIds);
    if (newSet.has(tenantId)) {
      newSet.delete(tenantId);
    } else {
      newSet.add(tenantId);
    }
    setSelectedTenantIds(newSet);
  };

  const toggleAll = () => {
    if (selectedTenantIds.size === sepaTenants.length) {
      setSelectedTenantIds(new Set());
    } else {
      setSelectedTenantIds(new Set(sepaTenants.map(t => t.id)));
    }
  };

  const selectedTenants = sepaTenants.filter(t => selectedTenantIds.has(t.id));
  const totalAmount = selectedTenants.reduce((sum, t) => sum + t.totalAmount, 0);

  // Validate creditor data
  const creditor: Partial<SepaCreditor> = {
    name: creditorName,
    iban: creditorIban,
    bic: creditorBic,
    creditorId: creditorId,
  };
  const creditorErrors = validateCreditor(creditor);
  const isCreditorValid = creditorErrors.length === 0;

  const handleSaveCreditorData = async () => {
    if (!organization) return;
    
    try {
      await updateOrganization.mutateAsync({
        id: organization.id,
        name: creditorName,
        iban: creditorIban,
        bic: creditorBic,
        sepa_creditor_id: creditorId,
      } as any);
      toast.success('Organisationsdaten gespeichert');
    } catch (error) {
      toast.error('Fehler beim Speichern');
    }
  };

  const handleExport = async () => {
    if (!isCreditorValid) {
      toast.error('Bitte alle Gläubigerdaten ausfüllen');
      return;
    }

    if (selectedTenants.length === 0) {
      toast.error('Bitte mindestens einen Mieter auswählen');
      return;
    }

    setIsExporting(true);
    const month = format(new Date(collectionDate), 'MMMM yyyy');
    const messageId = generateMessageId();
    const filename = `SEPA-Lastschrift-${format(new Date(collectionDate), 'yyyy-MM-dd')}.xml`;

    const debtors: SepaDebtor[] = selectedTenants.map(t => ({
      id: t.id,
      name: `${t.first_name} ${t.last_name}`,
      iban: t.iban!,
      bic: t.bic || 'NOTPROVIDED', // Some banks don't require BIC anymore
      mandateId: t.mandat_reference!,
      mandateDate: t.mietbeginn, // Use rental start as mandate date
      amount: t.totalAmount,
      remittanceInfo: `Miete ${month} - ${t.unit?.top_nummer || ''} ${t.property?.name || ''}`,
    }));

    try {
      const xml = generateSepaXml({
        creditor: creditor as SepaCreditor,
        debtors,
        collectionDate,
        batchBooking,
      });

      // Save collection to database
      await createSepaCollection.mutateAsync({
        organization_id: organization?.id || null,
        collection_date: collectionDate,
        message_id: messageId,
        total_amount: totalAmount,
        item_count: selectedTenants.length,
        xml_filename: filename,
        creditor_name: creditorName,
        creditor_iban: creditorIban,
        items: selectedTenants.map(t => ({
          tenant_id: t.id,
          unit_id: t.unit?.id || null,
          amount: t.totalAmount,
          mandate_reference: t.mandat_reference,
          tenant_name: `${t.first_name} ${t.last_name}`,
          tenant_iban: t.iban,
        })),
      });

      downloadSepaXml(xml, filename);
      toast.success(`SEPA-Datei mit ${debtors.length} Lastschriften erstellt`, {
        description: 'Laden Sie die XML-Datei in Ihr Online-Banking hoch.',
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Export fehlgeschlagen: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            SEPA-Lastschrift exportieren
          </DialogTitle>
          <DialogDescription>
            Erstellen Sie eine SEPA-XML-Datei (pain.008.003.02) für den Lastschrifteinzug bei Ihrer Bank.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Creditor Information */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Gläubiger (Ihr Unternehmen)</h3>
              
              {creditorErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside">
                      {creditorErrors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="creditor-name">Firmenname *</Label>
                  <Input
                    id="creditor-name"
                    value={creditorName}
                    onChange={(e) => setCreditorName(e.target.value)}
                    placeholder="Hausverwaltung GmbH"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creditor-id">Gläubiger-ID (CI) *</Label>
                  <Input
                    id="creditor-id"
                    value={creditorId}
                    onChange={(e) => setCreditorId(e.target.value)}
                    placeholder="AT12ZZZ00000000001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creditor-iban">IBAN *</Label>
                  <Input
                    id="creditor-iban"
                    value={creditorIban}
                    onChange={(e) => setCreditorIban(e.target.value)}
                    placeholder="AT12 3456 7890 1234 5678"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creditor-bic">BIC *</Label>
                  <Input
                    id="creditor-bic"
                    value={creditorBic}
                    onChange={(e) => setCreditorBic(e.target.value)}
                    placeholder="BKAUATWW"
                  />
                </div>
              </div>

              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSaveCreditorData}
                disabled={updateOrganization.isPending}
              >
                Daten speichern
              </Button>
            </div>

            {/* Export Settings */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Einzugsdatum</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="collection-date">Fälligkeitsdatum</Label>
                  <Input
                    id="collection-date"
                    type="date"
                    value={collectionDate}
                    onChange={(e) => setCollectionDate(e.target.value)}
                    min={format(addDays(new Date(), 2), 'yyyy-MM-dd')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Mindestens 2 Bankarbeitstage in der Zukunft
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Buchungsart</Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="batch-booking"
                      checked={batchBooking}
                      onCheckedChange={(checked) => setBatchBooking(checked === true)}
                    />
                    <label htmlFor="batch-booking" className="text-sm">
                      Sammelbuchung (eine Buchung für alle Lastschriften)
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Tenant Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Mieter mit SEPA-Mandat</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedTenantIds.size} von {sepaTenants.length} ausgewählt
                  </span>
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selectedTenantIds.size === sepaTenants.length ? 'Keine auswählen' : 'Alle auswählen'}
                  </Button>
                </div>
              </div>

              {sepaTenants.length === 0 ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Keine Mieter mit aktivem SEPA-Mandat gefunden. 
                    Stellen Sie sicher, dass bei den Mietern IBAN, Mandatsreferenz und "SEPA-Mandat" aktiviert sind.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Mieter</TableHead>
                        <TableHead>Top</TableHead>
                        <TableHead>Liegenschaft</TableHead>
                        <TableHead>IBAN</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sepaTenants.map((tenant) => (
                        <TableRow 
                          key={tenant.id}
                          className={selectedTenantIds.has(tenant.id) ? 'bg-primary/5' : ''}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedTenantIds.has(tenant.id)}
                              onCheckedChange={() => toggleTenant(tenant.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {tenant.first_name} {tenant.last_name}
                          </TableCell>
                          <TableCell>{tenant.unit?.top_nummer || '-'}</TableCell>
                          <TableCell>{tenant.property?.name || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {tenant.iban?.replace(/(.{4})/g, '$1 ').trim()}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            € {tenant.totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Summary */}
            {selectedTenants.length > 0 && (
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Gesamtsumme Lastschriften</p>
                    <p className="text-2xl font-bold">
                      € {totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Anzahl Lastschriften</p>
                    <p className="text-2xl font-bold">{selectedTenants.length}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button 
            onClick={handleExport}
            disabled={!isCreditorValid || selectedTenants.length === 0 || isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            SEPA-XML exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
