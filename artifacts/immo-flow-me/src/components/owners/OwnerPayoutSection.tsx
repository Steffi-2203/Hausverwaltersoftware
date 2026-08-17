import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Euro, FileText, Download, Mail, Plus, Loader2, Banknote } from 'lucide-react';
import { useOwnerPayouts, useCreateOwnerPayout, useUpdateOwnerPayout, type OwnerPayout } from '@/hooks/useOwnerPayouts';
import { useOwners, Owner } from '@/hooks/useOwners';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';
import { downloadOwnerPayoutPdf } from '@/utils/ownerPayoutPdfExport';
import { downloadOwnerPayoutSepa } from '@/utils/ownerPayoutSepaExport';
import { toast } from 'sonner';
import { format } from 'date-fns';

const statusLabels: Record<string, string> = {
  entwurf: 'Entwurf',
  freigegeben: 'Freigegeben',
  ausgezahlt: 'Ausgezahlt',
};

const statusStyles: Record<string, string> = {
  entwurf: 'bg-muted text-muted-foreground',
  freigegeben: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ausgezahlt: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

function fmt(amount: number): string {
  return `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}`;
}

export function OwnerPayoutSection() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [periodFrom, setPeriodFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodTo, setPeriodTo] = useState(`${new Date().getFullYear()}-12-31`);
  const [totalIncome, setTotalIncome] = useState('');
  const [totalExpenses, setTotalExpenses] = useState('');
  const [managementFee, setManagementFee] = useState('');

  const { data: payouts = [], isLoading } = useOwnerPayouts();
  const { data: owners = [] } = useOwners();
  const { data: properties = [] } = useProperties();
  const { data: organization } = useOrganization();
  const createPayout = useCreateOwnerPayout();
  const updatePayout = useUpdateOwnerPayout();

  const handleCreate = async () => {
    const income = parseFloat(totalIncome.replace(',', '.')) || 0;
    const expenses = parseFloat(totalExpenses.replace(',', '.')) || 0;
    const fee = parseFloat(managementFee.replace(',', '.')) || 0;
    const net = income - expenses - fee;

    await createPayout.mutateAsync({
      organization_id: organization?.id || null,
      property_id: selectedPropertyId,
      owner_id: selectedOwnerId,
      period_from: periodFrom,
      period_to: periodTo,
      total_income: income,
      total_expenses: expenses,
      management_fee: fee,
      net_payout: net,
      status: 'entwurf',
      notes: null,
    });

    setCreateDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedPropertyId('');
    setSelectedOwnerId('');
    setTotalIncome('');
    setTotalExpenses('');
    setManagementFee('');
  };

  const handleDownloadPdf = (payout: OwnerPayout) => {
    const owner = owners.find((o: Owner) => o.id === payout.owner_id);
    const property = properties.find((p: any) => p.id === payout.property_id);
    if (!owner || !property) return;

    downloadOwnerPayoutPdf({
      ownerName: owner.name,
      ownerAddress: [owner.address, `${owner.postal_code || ''} ${owner.city || ''}`].filter(Boolean).join(', '),
      ownerIban: owner.iban || undefined,
      ownerBic: owner.bic || undefined,
      propertyName: property.name,
      propertyAddress: `${property.address}, ${property.postal_code} ${property.city}`,
      periodFrom: payout.period_from,
      periodTo: payout.period_to,
      totalIncome: payout.total_income,
      totalExpenses: payout.total_expenses,
      managementFee: payout.management_fee,
      netPayout: payout.net_payout,
      ownershipShare: owner.ownership_share,
      organizationName: organization?.name || 'Hausverwaltung',
    });
  };

  const handleSepaExport = (payout: OwnerPayout) => {
    const owner = owners.find((o: Owner) => o.id === payout.owner_id);
    if (!owner?.iban) {
      toast.error('Eigentümer hat keine IBAN hinterlegt');
      return;
    }

    downloadOwnerPayoutSepa([{
      organizationName: organization?.name || 'Hausverwaltung',
      organizationIban: organization?.iban || '',
      organizationBic: organization?.bic || '',
      ownerName: owner.name,
      ownerIban: owner.iban,
      ownerBic: owner.bic || undefined,
      amount: payout.net_payout,
      reference: `Eigentuemer-Abrechnung ${payout.period_from} - ${payout.period_to}`,
    }]);

    updatePayout.mutate({ id: payout.id, sepa_exported_at: new Date().toISOString() } as any);
    toast.success('SEPA-Datei heruntergeladen');
  };

  const handleApprove = (payout: OwnerPayout) => {
    updatePayout.mutate({ id: payout.id, status: 'freigegeben' } as any);
  };

  const handleMarkPaid = (payout: OwnerPayout) => {
    updatePayout.mutate({ id: payout.id, status: 'ausgezahlt' } as any);
  };

  const getOwnerName = (ownerId: string) => owners.find((o: Owner) => o.id === ownerId)?.name || '—';
  const getPropertyName = (propertyId: string) => properties.find((p: any) => p.id === propertyId)?.name || '—';

  const filteredOwners = selectedPropertyId
    ? owners.filter((o: Owner) => o.property_id === selectedPropertyId)
    : owners;

  const netPayout = (parseFloat(totalIncome.replace(',', '.')) || 0) -
    (parseFloat(totalExpenses.replace(',', '.')) || 0) -
    (parseFloat(managementFee.replace(',', '.')) || 0);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Eigentümer-Auszahlungen
            </CardTitle>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neue Abrechnung
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Euro className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Eigentümer-Abrechnungen vorhanden.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eigentümer</TableHead>
                  <TableHead>Liegenschaft</TableHead>
                  <TableHead>Zeitraum</TableHead>
                  <TableHead className="text-right">Einnahmen</TableHead>
                  <TableHead className="text-right">Ausgaben</TableHead>
                  <TableHead className="text-right">Netto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell className="font-medium">{getOwnerName(payout.owner_id)}</TableCell>
                    <TableCell>{getPropertyName(payout.property_id)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(payout.period_from).toLocaleDateString('de-AT')} – {new Date(payout.period_to).toLocaleDateString('de-AT')}
                    </TableCell>
                    <TableCell className="text-right text-success">{fmt(payout.total_income)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmt(payout.total_expenses)}</TableCell>
                    <TableCell className="text-right font-bold">{fmt(payout.net_payout)}</TableCell>
                    <TableCell>
                      <Badge className={statusStyles[payout.status]}>{statusLabels[payout.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadPdf(payout)} title="PDF">
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSepaExport(payout)} title="SEPA">
                          <Download className="h-4 w-4" />
                        </Button>
                        {payout.status === 'entwurf' && (
                          <Button variant="outline" size="sm" onClick={() => handleApprove(payout)}>
                            Freigeben
                          </Button>
                        )}
                        {payout.status === 'freigegeben' && (
                          <Button variant="outline" size="sm" onClick={() => handleMarkPaid(payout)}>
                            Ausgezahlt
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Eigentümer-Abrechnung</DialogTitle>
            <DialogDescription>Erstellen Sie eine Renditeabrechnung für einen Eigentümer.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Liegenschaft</Label>
              <Select value={selectedPropertyId} onValueChange={(v) => { setSelectedPropertyId(v); setSelectedOwnerId(''); }}>
                <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                <SelectContent>
                  {properties.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Eigentümer</Label>
              <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId} disabled={!selectedPropertyId}>
                <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                <SelectContent>
                  {filteredOwners.map((o: Owner) => (
                    <SelectItem key={o.id} value={o.id}>{o.name} ({o.ownership_share}%)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Zeitraum von</Label>
                <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Zeitraum bis</Label>
                <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Einnahmen (€)</Label>
                <Input placeholder="0,00" value={totalIncome} onChange={(e) => setTotalIncome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Ausgaben (€)</Label>
                <Input placeholder="0,00" value={totalExpenses} onChange={(e) => setTotalExpenses(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Verwaltung (€)</Label>
                <Input placeholder="0,00" value={managementFee} onChange={(e) => setManagementFee(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Netto-Auszahlung</p>
              <p className={`text-2xl font-bold ${netPayout >= 0 ? 'text-success' : 'text-destructive'}`}>
                {fmt(netPayout)}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Abbrechen</Button>
            <Button
              onClick={handleCreate}
              disabled={!selectedPropertyId || !selectedOwnerId || createPayout.isPending}
            >
              {createPayout.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
