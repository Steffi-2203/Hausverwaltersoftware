import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Plus, ShieldCheck, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { useInsurancePolicies, useCreateInsurancePolicy, useDeleteInsurancePolicy, useAllInsuranceClaims, useCreateInsuranceClaim, useUpdateInsuranceClaim, type InsurancePolicy, type InsuranceClaim } from '@/hooks/useInsurance';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';

const typeLabels: Record<string, string> = {
  gebaeudeversicherung: 'Gebäudeversicherung',
  haftpflicht: 'Haftpflicht',
  feuer: 'Feuerversicherung',
  leitungswasser: 'Leitungswasser',
  sturm: 'Sturmschaden',
  glas: 'Glasbruch',
  rechtsschutz: 'Rechtsschutz',
  sonstiges: 'Sonstiges',
};

const claimStatusLabels: Record<string, string> = { gemeldet: 'Gemeldet', in_bearbeitung: 'In Bearbeitung', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt', erledigt: 'Erledigt' };
const claimStatusStyles: Record<string, string> = { gemeldet: 'bg-blue-100 text-blue-800', in_bearbeitung: 'bg-amber-100 text-amber-800', genehmigt: 'bg-green-100 text-green-800', abgelehnt: 'bg-red-100 text-red-800', erledigt: 'bg-muted text-muted-foreground' };

function fmt(amount: number | null) { return amount != null ? `€ ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}` : '—'; }

export default function InsuranceManagement() {
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);

  // Policy form
  const [pPropId, setPPropId] = useState('');
  const [pType, setPType] = useState('gebaeudeversicherung');
  const [pProvider, setPProvider] = useState('');
  const [pPolicyNum, setPPolicyNum] = useState('');
  const [pCoverage, setPCoverage] = useState('');
  const [pPremium, setPPremium] = useState('');
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');
  const [pAutoRenew, setPAutoRenew] = useState(true);
  const [pContact, setPContact] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pEmail, setPEmail] = useState('');

  // Claim form
  const [cPolicyId, setCPolicyId] = useState('');
  const [cDate, setCDate] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cAmount, setCAmount] = useState('');

  const { data: properties = [] } = useProperties();
  const { data: organization } = useOrganization();
  const { data: policies = [], isLoading: loadingPolicies } = useInsurancePolicies();
  const { data: claims = [], isLoading: loadingClaims } = useAllInsuranceClaims();

  const createPolicy = useCreateInsurancePolicy();
  const deletePolicy = useDeleteInsurancePolicy();
  const createClaim = useCreateInsuranceClaim();
  const updateClaim = useUpdateInsuranceClaim();

  const handleCreatePolicy = async () => {
    await createPolicy.mutateAsync({
      organization_id: organization?.id || null,
      property_id: pPropId,
      insurance_type: pType,
      provider: pProvider,
      policy_number: pPolicyNum || null,
      coverage_amount: pCoverage ? parseFloat(pCoverage.replace(',', '.')) : null,
      annual_premium: pPremium ? parseFloat(pPremium.replace(',', '.')) : null,
      start_date: pStart,
      end_date: pEnd || null,
      auto_renew: pAutoRenew,
      contact_person: pContact || null,
      contact_phone: pPhone || null,
      contact_email: pEmail || null,
      document_url: null,
      notes: null,
    });
    setPolicyDialogOpen(false);
    setPProvider(''); setPPolicyNum(''); setPCoverage(''); setPPremium(''); setPStart(''); setPEnd('');
  };

  const handleCreateClaim = async () => {
    const policy = policies.find(p => p.id === cPolicyId);
    if (!policy) return;
    await createClaim.mutateAsync({
      organization_id: organization?.id || null,
      insurance_policy_id: cPolicyId,
      property_id: policy.property_id,
      unit_id: null,
      claim_date: cDate,
      description: cDesc,
      damage_amount: cAmount ? parseFloat(cAmount.replace(',', '.')) : null,
      reimbursed_amount: null,
      status: 'gemeldet',
      claim_number: null,
      document_url: null,
      notes: null,
    });
    setClaimDialogOpen(false);
    setCPolicyId(''); setCDate(''); setCDesc(''); setCAmount('');
  };

  const getPropertyName = (propId: string) => properties.find((p: any) => p.id === propId)?.name || '—';

  const expiringPolicies = policies.filter(p => {
    if (!p.end_date) return false;
    const d = new Date(p.end_date);
    const now = new Date();
    const in90 = new Date(); in90.setDate(in90.getDate() + 90);
    return d >= now && d <= in90;
  });

  return (
    <MainLayout title="Versicherungen" subtitle="Gebäudeversicherungen und Schadensmeldungen">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Versicherungsverwaltung</h1>
            <p className="text-muted-foreground">Polizzen, Ablaufdaten und Schadensmeldungen</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setClaimDialogOpen(true)} disabled={policies.length === 0}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Schaden melden
            </Button>
            <Button onClick={() => setPolicyDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Neue Versicherung
            </Button>
          </div>
        </div>

        {expiringPolicies.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">{expiringPolicies.length} Versicherung(en) laufen in den nächsten 90 Tagen ab</span>
              </div>
              {expiringPolicies.map(p => (
                <p key={p.id} className="text-sm text-muted-foreground ml-6">
                  {typeLabels[p.insurance_type] || p.insurance_type} – {p.provider} ({getPropertyName(p.property_id)}) – Ablauf: {new Date(p.end_date!).toLocaleDateString('de-AT')}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="policies">
          <TabsList>
            <TabsTrigger value="policies"><ShieldCheck className="h-4 w-4 mr-1" /> Polizzen ({policies.length})</TabsTrigger>
            <TabsTrigger value="claims"><AlertTriangle className="h-4 w-4 mr-1" /> Schadensmeldungen ({claims.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="space-y-4">
            {loadingPolicies ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : policies.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Noch keine Versicherungen angelegt.</p>
              </CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Typ</TableHead>
                    <TableHead>Anbieter</TableHead>
                    <TableHead>Polizze-Nr.</TableHead>
                    <TableHead>Liegenschaft</TableHead>
                    <TableHead className="text-right">Prämie/Jahr</TableHead>
                    <TableHead>Ablaufdatum</TableHead>
                    <TableHead>Auto-Verlängerung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{typeLabels[p.insurance_type] || p.insurance_type}</TableCell>
                      <TableCell>{p.provider}</TableCell>
                      <TableCell className="font-mono text-sm">{p.policy_number || '—'}</TableCell>
                      <TableCell>{getPropertyName(p.property_id)}</TableCell>
                      <TableCell className="text-right">{fmt(p.annual_premium)}</TableCell>
                      <TableCell>{p.end_date ? new Date(p.end_date).toLocaleDateString('de-AT') : 'Unbefristet'}</TableCell>
                      <TableCell>{p.auto_renew ? <Badge>Ja</Badge> : <Badge variant="secondary">Nein</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="claims" className="space-y-4">
            {loadingClaims ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : claims.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Keine Schadensmeldungen vorhanden.</p>
              </CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Schadensnr.</TableHead>
                    <TableHead className="text-right">Schadenshöhe</TableHead>
                    <TableHead className="text-right">Erstattet</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{new Date(c.claim_date).toLocaleDateString('de-AT')}</TableCell>
                      <TableCell className="max-w-xs truncate">{c.description}</TableCell>
                      <TableCell className="font-mono text-sm">{c.claim_number || '—'}</TableCell>
                      <TableCell className="text-right">{fmt(c.damage_amount)}</TableCell>
                      <TableCell className="text-right text-green-600">{fmt(c.reimbursed_amount)}</TableCell>
                      <TableCell><Badge className={claimStatusStyles[c.status]}>{claimStatusLabels[c.status]}</Badge></TableCell>
                      <TableCell>
                        {c.status === 'gemeldet' && (
                          <Button variant="outline" size="sm" onClick={() => updateClaim.mutate({ id: c.id, status: 'in_bearbeitung' } as any)}>
                            In Bearbeitung
                          </Button>
                        )}
                        {c.status === 'in_bearbeitung' && (
                          <Button variant="outline" size="sm" onClick={() => updateClaim.mutate({ id: c.id, status: 'erledigt' } as any)}>
                            Erledigt
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Policy Dialog */}
      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Neue Versicherung</DialogTitle><DialogDescription>Erfassen Sie eine Gebäudeversicherung.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Liegenschaft</Label>
              <Select value={pPropId} onValueChange={setPPropId}><SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger><SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>Versicherungstyp</Label>
              <Select value={pType} onValueChange={setPType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                {Object.entries(typeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>Anbieter</Label><Input value={pProvider} onChange={e => setPProvider(e.target.value)} placeholder="z.B. Allianz, Generali" /></div>
            <div className="space-y-2"><Label>Polizze-Nummer</Label><Input value={pPolicyNum} onChange={e => setPPolicyNum(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Deckungssumme (€)</Label><Input value={pCoverage} onChange={e => setPCoverage(e.target.value)} placeholder="0,00" /></div>
              <div className="space-y-2"><Label>Jahresprämie (€)</Label><Input value={pPremium} onChange={e => setPPremium(e.target.value)} placeholder="0,00" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Beginn</Label><Input type="date" value={pStart} onChange={e => setPStart(e.target.value)} /></div>
              <div className="space-y-2"><Label>Ende</Label><Input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={pAutoRenew} onCheckedChange={setPAutoRenew} />
              <Label>Automatische Verlängerung</Label>
            </div>
            <div className="space-y-2"><Label>Ansprechpartner</Label><Input value={pContact} onChange={e => setPContact(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Telefon</Label><Input value={pPhone} onChange={e => setPPhone(e.target.value)} /></div>
              <div className="space-y-2"><Label>E-Mail</Label><Input value={pEmail} onChange={e => setPEmail(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleCreatePolicy} disabled={!pPropId || !pProvider || !pStart || createPolicy.isPending}>
              {createPolicy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claim Dialog */}
      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schaden melden</DialogTitle><DialogDescription>Erfassen Sie einen Versicherungsschaden.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Versicherung</Label>
              <Select value={cPolicyId} onValueChange={setCPolicyId}><SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger><SelectContent>
                {policies.map(p => <SelectItem key={p.id} value={p.id}>{typeLabels[p.insurance_type] || p.insurance_type} – {p.provider} ({getPropertyName(p.property_id)})</SelectItem>)}
              </SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>Schadensdatum</Label><Input type="date" value={cDate} onChange={e => setCDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Beschreibung</Label><Textarea value={cDesc} onChange={e => setCDesc(e.target.value)} placeholder="Was ist passiert?" /></div>
            <div className="space-y-2"><Label>Geschätzte Schadenshöhe (€)</Label><Input value={cAmount} onChange={e => setCAmount(e.target.value)} placeholder="0,00" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleCreateClaim} disabled={!cPolicyId || !cDate || !cDesc || createClaim.isPending}>
              {createClaim.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Melden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
