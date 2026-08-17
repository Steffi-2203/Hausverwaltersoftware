import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';
import { useManagementContracts, useCreateManagementContract, useUpdateManagementContract, useDeleteManagementContract } from '@/hooks/useManagementContracts';
import { generateManagementContractPdf } from '@/utils/managementContractPdfExport';
import { useToast } from '@/hooks/use-toast';
import { format, addMonths, differenceInDays } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  FileText, Plus, Download, Trash2, Edit, AlertTriangle, CheckCircle, Clock, Loader2
} from 'lucide-react';

const CONTRACT_TYPES = [
  { value: 'hausverwaltung', label: 'Hausverwaltungsvertrag' },
  { value: 'weg_verwaltung', label: 'WEG-Verwaltungsvertrag' },
  { value: 'sonderverwaltung', label: 'Sonderverwaltung' },
  { value: 'mietverwaltung', label: 'Mietverwaltungsvertrag' },
];

const FEE_TYPES = [
  { value: 'pro_einheit', label: 'Pro Einheit/Monat' },
  { value: 'pauschal', label: 'Pauschal/Monat' },
  { value: 'prozentual', label: 'Prozentual' },
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);
}

export default function ManagementContractsPage() {
  const { toast } = useToast();
  const { data: properties } = useProperties();
  const { data: organization } = useOrganization();
  const { data: contracts, isLoading } = useManagementContracts();
  const createContract = useCreateManagementContract();
  const updateContract = useUpdateManagementContract();
  const deleteContract = useDeleteManagementContract();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    property_id: '',
    owner_name: '',
    contract_type: 'hausverwaltung',
    title: '',
    start_date: '',
    end_date: '',
    auto_renew: true,
    renewal_months: 12,
    notice_period_months: 3,
    notice_deadline: '',
    monthly_fee: 0,
    fee_type: 'pro_einheit',
    notes: '',
    status: 'aktiv',
  });

  const resetForm = () => {
    setForm({
      property_id: '', owner_name: '', contract_type: 'hausverwaltung',
      title: '', start_date: '', end_date: '', auto_renew: true,
      renewal_months: 12, notice_period_months: 3, notice_deadline: '',
      monthly_fee: 0, fee_type: 'pro_einheit', notes: '', status: 'aktiv',
    });
    setEditId(null);
  };

  const handleEdit = (contract: any) => {
    setForm({
      property_id: contract.property_id || '',
      owner_name: contract.owner_name || '',
      contract_type: contract.contract_type,
      title: contract.title,
      start_date: contract.start_date,
      end_date: contract.end_date || '',
      auto_renew: contract.auto_renew,
      renewal_months: contract.renewal_months || 12,
      notice_period_months: contract.notice_period_months || 3,
      notice_deadline: contract.notice_deadline || '',
      monthly_fee: contract.monthly_fee || 0,
      fee_type: contract.fee_type || 'pro_einheit',
      notes: contract.notes || '',
      status: contract.status,
    });
    setEditId(contract.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!organization?.id || !form.title || !form.start_date) {
      toast({ title: 'Fehler', description: 'Bitte Pflichtfelder ausfüllen.', variant: 'destructive' });
      return;
    }

    const payload = {
      ...form,
      organization_id: organization.id,
      property_id: form.property_id || undefined,
      end_date: form.end_date || undefined,
      notice_deadline: form.notice_deadline || undefined,
      notes: form.notes || undefined,
      owner_name: form.owner_name || undefined,
    };

    if (editId) {
      await updateContract.mutateAsync({ id: editId, ...payload });
    } else {
      await createContract.mutateAsync(payload as any);
    }
    setShowForm(false);
    resetForm();
  };

  const handleExportPdf = (contract: any) => {
    const property = properties?.find(p => p.id === contract.property_id);
    const doc = generateManagementContractPdf({
      title: contract.title,
      owner_name: contract.owner_name || 'Eigentümer',
      property_name: property?.name || 'Liegenschaft',
      property_address: property ? `${property.address}, ${property.postal_code} ${property.city}` : '',
      start_date: contract.start_date,
      end_date: contract.end_date,
      auto_renew: contract.auto_renew,
      renewal_months: contract.renewal_months || 12,
      notice_period_months: contract.notice_period_months || 3,
      monthly_fee: contract.monthly_fee || 0,
      fee_type: contract.fee_type || 'pro_einheit',
      manager_name: organization?.name || 'Hausverwaltung',
      notes: contract.notes,
    });
    doc.save(`HV-Vertrag_${contract.title.replace(/\s/g, '_')}.pdf`);
  };

  const getDeadlineStatus = (contract: any) => {
    if (!contract.end_date && !contract.notice_deadline) return null;
    const deadline = contract.notice_deadline || contract.end_date;
    const days = differenceInDays(new Date(deadline), new Date());
    if (days < 0) return { label: 'Abgelaufen', variant: 'destructive' as const, icon: AlertTriangle };
    if (days < 90) return { label: `${days} Tage`, variant: 'default' as const, icon: Clock };
    return { label: 'Aktiv', variant: 'secondary' as const, icon: CheckCircle };
  };

  return (
    <MainLayout title="HV-Verträge" subtitle="Hausverwaltungsverträge und Fristüberwachung">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Neuer Vertrag
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !contracts || contracts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Keine Verträge</p>
              <p className="text-muted-foreground text-sm">Erstellen Sie Ihren ersten Verwaltungsvertrag.</p>
              <Button className="mt-4" onClick={() => { resetForm(); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Vertrag erstellen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {contracts.map(contract => {
              const property = properties?.find(p => p.id === contract.property_id);
              const deadlineStatus = getDeadlineStatus(contract);
              const typeLabel = CONTRACT_TYPES.find(t => t.value === contract.contract_type)?.label || contract.contract_type;

              return (
                <Card key={contract.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{contract.title}</h3>
                          <Badge variant="outline">{typeLabel}</Badge>
                          {contract.status === 'aktiv' && <Badge className="bg-green-100 text-green-800">Aktiv</Badge>}
                          {contract.status === 'gekuendigt' && <Badge variant="destructive">Gekündigt</Badge>}
                        </div>
                        {property && <p className="text-sm text-muted-foreground">{property.name} – {property.address}</p>}
                        {contract.owner_name && <p className="text-sm text-muted-foreground">Eigentümer: {contract.owner_name}</p>}
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>Beginn: {format(new Date(contract.start_date), 'dd.MM.yyyy')}</span>
                          {contract.end_date && <span>Ende: {format(new Date(contract.end_date), 'dd.MM.yyyy')}</span>}
                          {contract.monthly_fee && <span>Honorar: {formatCurrency(Number(contract.monthly_fee))}</span>}
                          {contract.auto_renew && <span>Auto-Verlängerung: {contract.renewal_months} Mon.</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {deadlineStatus && (
                          <Badge variant={deadlineStatus.variant}>
                            <deadlineStatus.icon className="h-3 w-3 mr-1" />
                            {deadlineStatus.label}
                          </Badge>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleExportPdf(contract)}>
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEdit(contract)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteContract.mutate(contract.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Contract Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titel *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="z.B. HV-Vertrag Musterstraße 1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vertragstyp</Label>
                <Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Liegenschaft</Label>
                <Select value={form.property_id} onValueChange={v => setForm(f => ({ ...f, property_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Zuordnen..." /></SelectTrigger>
                  <SelectContent>
                    {properties?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Eigentümer</Label>
              <Input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="Name des Auftraggebers" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Beginn *</Label>
                <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Ende</Label>
                <Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.auto_renew} onCheckedChange={v => setForm(f => ({ ...f, auto_renew: v }))} />
              <Label>Automatische Verlängerung</Label>
            </div>
            {form.auto_renew && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Verlängerung (Monate)</Label>
                  <Input type="number" value={form.renewal_months} onChange={e => setForm(f => ({ ...f, renewal_months: parseInt(e.target.value) || 12 }))} />
                </div>
                <div className="space-y-2">
                  <Label>Kündigungsfrist (Monate)</Label>
                  <Input type="number" value={form.notice_period_months} onChange={e => setForm(f => ({ ...f, notice_period_months: parseInt(e.target.value) || 3 }))} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monatliches Honorar (€)</Label>
                <Input type="number" step="0.01" value={form.monthly_fee} onChange={e => setForm(f => ({ ...f, monthly_fee: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label>Honorartyp</Label>
                <Select value={form.fee_type} onValueChange={v => setForm(f => ({ ...f, fee_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notizen</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Besondere Vereinbarungen..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={!form.title || !form.start_date}>
              {editId ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
