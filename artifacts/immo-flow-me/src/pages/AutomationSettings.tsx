import { useState, useEffect } from 'react';
import { Zap, Lock, Sparkles, Loader2, Play, Calendar, Mail, CreditCard, AlertTriangle, Plus, Pencil, Trash2, TestTube, Power, Eye, X, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient as qc } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';

interface AutoSettings {
  autoInvoicingEnabled: boolean;
  invoicingDayOfMonth: number;
  autoInvoicingEmail: boolean;
  autoSepaGeneration: boolean;
  autoDunningEnabled: boolean;
  dunningDays1: number;
  dunningDays2: number;
  dunningDays3: number;
  autoDunningEmail: boolean;
  dunningInterestRate: string;
  lastInvoicingRun: string | null;
  lastDunningRun: string | null;
}

interface LogEntry {
  id: string;
  type: string;
  status: string;
  details: string;
  itemsProcessed: number;
  createdAt: string;
}

interface AutomationRule {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  triggerType: string;
  conditions: any;
  actions: any;
  isActive: boolean;
  lastRun: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RuleActionPreview {
  type: string;
  description: string;
  target?: string;
  details?: Record<string, any>;
}

interface RuleExecutionResult {
  ruleId: string;
  isDryRun: boolean;
  matchedItems: number;
  actions: RuleActionPreview[];
  status: 'success' | 'error' | 'skipped';
  errorMessage?: string;
}

interface RuleLog {
  id: string;
  ruleId: string;
  organizationId: string;
  isDryRun: boolean;
  triggerData: any;
  matchedItems: number;
  actionsPreview: RuleActionPreview[] | null;
  actionsExecuted: RuleActionPreview[] | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface ConditionRow {
  field: string;
  operator: string;
  value: string;
}

const TRIGGER_TYPES = [
  { value: 'payment_received', label: 'Zahlung eingegangen' },
  { value: 'invoice_due', label: 'Rechnung fällig' },
  { value: 'lease_expiring', label: 'Mietvertrag läuft aus' },
  { value: 'maintenance_due', label: 'Wartung fällig' },
];

const TRIGGER_CONDITION_FIELDS: Record<string, { field: string; label: string }[]> = {
  payment_received: [
    { field: 'minAmount', label: 'Mindestbetrag (EUR)' },
  ],
  invoice_due: [
    { field: 'daysBeforeDue', label: 'Tage vor Fälligkeit' },
  ],
  lease_expiring: [
    { field: 'monthsBeforeExpiry', label: 'Monate vor Ablauf' },
  ],
  maintenance_due: [
    { field: 'category', label: 'Kategorie' },
  ],
};

const OPERATORS = [
  { value: '=', label: '=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: 'contains', label: 'enthält' },
];

function triggerLabel(type: string) {
  return TRIGGER_TYPES.find(t => t.value === type)?.label || type;
}

function Toggle({ checked, onChange, label, description, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; testId: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-medium text-sm">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function KiAutopilotSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState<AutoSettings>({
    autoInvoicingEnabled: false,
    invoicingDayOfMonth: 1,
    autoInvoicingEmail: true,
    autoSepaGeneration: false,
    autoDunningEnabled: false,
    dunningDays1: 14,
    dunningDays2: 28,
    dunningDays3: 42,
    autoDunningEmail: true,
    dunningInterestRate: '4.00',
    lastInvoicingRun: null,
    lastDunningRun: null,
  });

  const { data: serverSettings, isLoading } = useQuery<AutoSettings | null>({
    queryKey: ['/api/automation/settings'],
  });

  const { data: logs } = useQuery<LogEntry[]>({
    queryKey: ['/api/automation/log'],
  });

  useEffect(() => {
    if (serverSettings) setSettings(serverSettings);
  }, [serverSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => { await apiRequest('PUT', '/api/automation/settings', settings); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/settings'] });
      toast({ title: 'Gespeichert', description: 'Automatisierungseinstellungen wurden aktualisiert.' });
    },
    onError: () => { toast({ title: 'Fehler', description: 'Einstellungen konnten nicht gespeichert werden.', variant: 'destructive' }); },
  });

  const runInvoicing = useMutation({
    mutationFn: () => apiRequest('POST', '/api/automation/run-invoicing'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/log'] });
      toast({ title: 'Gestartet', description: 'Vorschreibungslauf wurde gestartet.' });
    },
  });

  const runDunning = useMutation({
    mutationFn: () => apiRequest('POST', '/api/automation/run-dunning'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/log'] });
      toast({ title: 'Gestartet', description: 'Mahnlauf wurde gestartet.' });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />Automatische Vorschreibung</CardTitle>
            <CardDescription>Monatliche Mietvorschreibungen automatisch erstellen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle checked={settings.autoInvoicingEnabled} onChange={v => setSettings(s => ({ ...s, autoInvoicingEnabled: v }))} label="Automatische monatliche Vorschreibung" testId="toggle-auto-invoicing" />
            {settings.autoInvoicingEnabled && (
              <div className="space-y-3 pl-4">
                <div><label className="text-sm font-medium">Tag des Monats</label><Input type="number" min={1} max={28} value={settings.invoicingDayOfMonth} onChange={e => setSettings(s => ({ ...s, invoicingDayOfMonth: parseInt(e.target.value) || 1 }))} data-testid="input-invoicing-day" /></div>
                <Toggle checked={settings.autoInvoicingEmail} onChange={v => setSettings(s => ({ ...s, autoInvoicingEmail: v }))} label="E-Mail-Benachrichtigung" description="Mieter per E-Mail informieren" testId="toggle-invoicing-email" />
                <Toggle checked={settings.autoSepaGeneration} onChange={v => setSettings(s => ({ ...s, autoSepaGeneration: v }))} label="SEPA-Lastschrift automatisch generieren" testId="toggle-sepa-auto" />
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => runInvoicing.mutate()} disabled={runInvoicing.isPending} data-testid="button-run-invoicing"><Play className="mr-2 h-4 w-4" />Manuell starten</Button>
            {settings.lastInvoicingRun && <p className="text-xs text-muted-foreground">Letzter Lauf: {new Date(settings.lastInvoicingRun).toLocaleString('de-AT')}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Automatischer Mahnlauf</CardTitle>
            <CardDescription>Zahlungserinnerungen und Mahnungen automatisch versenden</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle checked={settings.autoDunningEnabled} onChange={v => setSettings(s => ({ ...s, autoDunningEnabled: v }))} label="Automatischer Mahnlauf" testId="toggle-auto-dunning" />
            {settings.autoDunningEnabled && (
              <div className="space-y-3 pl-4">
                <div><label className="text-sm font-medium">Tage bis Mahnung 1</label><Input type="number" min={1} value={settings.dunningDays1} onChange={e => setSettings(s => ({ ...s, dunningDays1: parseInt(e.target.value) || 14 }))} data-testid="input-dunning-days-1" /></div>
                <div><label className="text-sm font-medium">Tage bis Mahnung 2</label><Input type="number" min={1} value={settings.dunningDays2} onChange={e => setSettings(s => ({ ...s, dunningDays2: parseInt(e.target.value) || 28 }))} data-testid="input-dunning-days-2" /></div>
                <div><label className="text-sm font-medium">Tage bis Mahnung 3</label><Input type="number" min={1} value={settings.dunningDays3} onChange={e => setSettings(s => ({ ...s, dunningDays3: parseInt(e.target.value) || 42 }))} data-testid="input-dunning-days-3" /></div>
                <Toggle checked={settings.autoDunningEmail} onChange={v => setSettings(s => ({ ...s, autoDunningEmail: v }))} label="Automatisch per E-Mail senden" testId="toggle-dunning-email" />
                <div><label className="text-sm font-medium">Verzugszinsen (% p.a.)</label><Input type="text" value={settings.dunningInterestRate} onChange={e => setSettings(s => ({ ...s, dunningInterestRate: e.target.value }))} data-testid="input-interest-rate" /></div>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => runDunning.mutate()} disabled={runDunning.isPending} data-testid="button-run-dunning"><Play className="mr-2 h-4 w-4" />Manuell starten</Button>
            {settings.lastDunningRun && <p className="text-xs text-muted-foreground">Letzter Lauf: {new Date(settings.lastDunningRun).toLocaleString('de-AT')}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Einstellungen speichern
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Aktivitätsprotokoll</CardTitle></CardHeader>
        <CardContent>
          {!logs?.length ? (
            <p className="text-sm text-muted-foreground">Noch keine Aktivitäten aufgezeichnet.</p>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="flex items-center justify-between gap-4 text-sm border-b pb-2 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={log.status === 'gestartet' ? 'default' : 'secondary'} className="text-xs">{log.type}</Badge>
                    <span className="text-muted-foreground">{log.details}</span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString('de-AT')}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RulesEngine() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('rules');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [dryRunResult, setDryRunResult] = useState<RuleExecutionResult | null>(null);
  const [dryRunRuleId, setDryRunRuleId] = useState<string | null>(null);
  const [selectedRuleForLogs, setSelectedRuleForLogs] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTriggerType, setFormTriggerType] = useState('payment_received');
  const [formConditions, setFormConditions] = useState<ConditionRow[]>([]);

  const { data: rules, isLoading: rulesLoading } = useQuery<AutomationRule[]>({
    queryKey: ['/api/automation/rules'],
  });

  const { data: ruleLogs } = useQuery<RuleLog[]>({
    queryKey: ['/api/automation/rules', selectedRuleForLogs, 'logs'],
    enabled: !!selectedRuleForLogs,
    queryFn: async () => {
      const res = await fetch(`/api/automation/rules/${selectedRuleForLogs}/logs`);
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const { data: allLogs } = useQuery<RuleLog[]>({
    queryKey: ['/api/automation/rules', 'all-logs'],
    enabled: activeTab === 'logs',
    queryFn: async () => {
      if (!rules?.length) return [];
      const allResults: RuleLog[] = [];
      for (const rule of rules) {
        const res = await fetch(`/api/automation/rules/${rule.id}/logs`);
        if (res.ok) {
          const data = await res.json();
          allResults.push(...data.map((l: RuleLog) => ({ ...l, _ruleName: rule.name })));
        }
      }
      return allResults.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/automation/rules', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      toast({ title: 'Erstellt', description: 'Regel wurde erfolgreich erstellt.' });
      resetForm();
      setCreateDialogOpen(false);
    },
    onError: () => { toast({ title: 'Fehler', description: 'Regel konnte nicht erstellt werden.', variant: 'destructive' }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PATCH', `/api/automation/rules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      toast({ title: 'Aktualisiert', description: 'Regel wurde aktualisiert.' });
      resetForm();
      setEditingRule(null);
    },
    onError: () => { toast({ title: 'Fehler', description: 'Regel konnte nicht aktualisiert werden.', variant: 'destructive' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest('DELETE', `/api/automation/rules/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      toast({ title: 'Gelöscht', description: 'Regel wurde gelöscht.' });
    },
    onError: () => { toast({ title: 'Fehler', description: 'Regel konnte nicht gelöscht werden.', variant: 'destructive' }); },
  });

  const dryRunMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/automation/rules/${id}/dry-run`);
      return res.json();
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
    },
    onError: () => { toast({ title: 'Fehler', description: 'Testlauf fehlgeschlagen.', variant: 'destructive' }); },
  });

  const executeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/automation/rules/${id}/execute`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      setDryRunResult(null);
      setDryRunRuleId(null);
      toast({ title: 'Ausgeführt', description: 'Regel wurde erfolgreich ausgeführt.' });
    },
    onError: () => { toast({ title: 'Fehler', description: 'Ausführung fehlgeschlagen.', variant: 'destructive' }); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest('PATCH', `/api/automation/rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      toast({ title: 'Status geändert' });
    },
  });

  function resetForm() {
    setFormName('');
    setFormDescription('');
    setFormTriggerType('payment_received');
    setFormConditions([]);
  }

  function openEditDialog(rule: AutomationRule) {
    setFormName(rule.name);
    setFormDescription(rule.description || '');
    setFormTriggerType(rule.triggerType);
    const conds = rule.conditions as Record<string, any> || {};
    setFormConditions(Object.entries(conds).map(([field, value]) => ({ field, operator: '=', value: String(value) })));
    setEditingRule(rule);
  }

  function handleSubmit() {
    const conditionsObj: Record<string, any> = {};
    formConditions.forEach(c => { if (c.field && c.value) conditionsObj[c.field] = c.value; });

    const data = {
      name: formName,
      description: formDescription || null,
      triggerType: formTriggerType,
      conditions: conditionsObj,
      actions: null,
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function addCondition() {
    setFormConditions([...formConditions, { field: '', operator: '=', value: '' }]);
  }

  function removeCondition(index: number) {
    setFormConditions(formConditions.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, field: string, value: string) {
    setFormConditions(formConditions.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  function handleDryRun(ruleId: string) {
    setDryRunRuleId(ruleId);
    dryRunMutation.mutate(ruleId);
  }

  const isFormDialogOpen = createDialogOpen || !!editingRule;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="rules" data-testid="tab-rules">Regeln</TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">Ausführungsprotokoll</TabsTrigger>
          </TabsList>
          {activeTab === 'rules' && (
            <Button onClick={() => { resetForm(); setCreateDialogOpen(true); }} data-testid="button-new-rule">
              <Plus className="mr-2 h-4 w-4" />
              Neue Regel
            </Button>
          )}
        </div>

        <TabsContent value="rules">
          {rulesLoading ? (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !rules?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <TestTube className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Noch keine Regeln erstellt.</p>
                <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setCreateDialogOpen(true); }} data-testid="button-new-rule-empty">
                  <Plus className="mr-2 h-4 w-4" />Erste Regel erstellen
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Letzte Ausführung</TableHead>
                    <TableHead>Ausführungen</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map(rule => (
                    <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium" data-testid={`text-rule-name-${rule.id}`}>{rule.name}</p>
                          {rule.description && <p className="text-xs text-muted-foreground">{rule.description}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" data-testid={`badge-trigger-${rule.id}`}>{triggerLabel(rule.triggerType)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rule.isActive ? 'default' : 'outline'} data-testid={`badge-status-${rule.id}`}>
                          {rule.isActive ? 'Aktiv' : 'Inaktiv'}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-lastrun-${rule.id}`}>
                        {rule.lastRun ? new Date(rule.lastRun).toLocaleString('de-AT') : '—'}
                      </TableCell>
                      <TableCell data-testid={`text-runcount-${rule.id}`}>{rule.runCount || 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <Button size="icon" variant="ghost" onClick={() => openEditDialog(rule)} data-testid={`button-edit-${rule.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDryRun(rule.id)} disabled={dryRunMutation.isPending} data-testid={`button-dryrun-${rule.id}`}>
                            <TestTube className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })} data-testid={`button-toggle-${rule.id}`}>
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => { setSelectedRuleForLogs(rule.id); setActiveTab('logs'); }} data-testid={`button-logs-${rule.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(rule.id)} data-testid={`button-delete-${rule.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle>
                  {selectedRuleForLogs
                    ? `Protokoll: ${rules?.find(r => r.id === selectedRuleForLogs)?.name || 'Regel'}`
                    : 'Alle Ausführungsprotokolle'}
                </CardTitle>
                {selectedRuleForLogs && (
                  <Button variant="outline" size="sm" onClick={() => setSelectedRuleForLogs(null)} data-testid="button-show-all-logs">
                    Alle anzeigen
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const displayLogs = selectedRuleForLogs ? ruleLogs : allLogs;
                if (!displayLogs?.length) {
                  return <p className="text-sm text-muted-foreground" data-testid="text-no-logs">Noch keine Ausführungen protokolliert.</p>;
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zeitpunkt</TableHead>
                        {!selectedRuleForLogs && <TableHead>Regel</TableHead>}
                        <TableHead>Typ</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Treffer</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayLogs.map(log => {
                        const actions = log.isDryRun ? log.actionsPreview : log.actionsExecuted;
                        return (
                          <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                            <TableCell className="text-sm" data-testid={`text-log-date-${log.id}`}>
                              {new Date(log.createdAt).toLocaleString('de-AT')}
                            </TableCell>
                            {!selectedRuleForLogs && (
                              <TableCell data-testid={`text-log-rule-${log.id}`}>
                                {(log as any)._ruleName || rules?.find(r => r.id === log.ruleId)?.name || '—'}
                              </TableCell>
                            )}
                            <TableCell>
                              <Badge variant={log.isDryRun ? 'outline' : 'default'} data-testid={`badge-log-type-${log.id}`}>
                                {log.isDryRun ? 'Testlauf' : 'Ausführung'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={log.status === 'success' ? 'default' : log.status === 'error' ? 'destructive' : 'secondary'}
                                data-testid={`badge-log-status-${log.id}`}
                              >
                                {log.status === 'success' ? 'Erfolgreich' : log.status === 'error' ? 'Fehler' : 'Übersprungen'}
                              </Badge>
                            </TableCell>
                            <TableCell data-testid={`text-log-matched-${log.id}`}>{log.matchedItems || 0}</TableCell>
                            <TableCell>
                              {actions && Array.isArray(actions) && actions.length > 0 ? (
                                <div className="space-y-1 max-w-sm">
                                  {actions.slice(0, 3).map((a: RuleActionPreview, idx: number) => (
                                    <p key={idx} className="text-xs text-muted-foreground truncate">{a.description}</p>
                                  ))}
                                  {actions.length > 3 && <p className="text-xs text-muted-foreground">+{actions.length - 3} weitere</p>}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isFormDialogOpen} onOpenChange={open => { if (!open) { setCreateDialogOpen(false); setEditingRule(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">{editingRule ? 'Regel bearbeiten' : 'Neue Regel erstellen'}</DialogTitle>
            <DialogDescription>Konfigurieren Sie Trigger, Bedingungen und Aktionen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input id="rule-name" value={formName} onChange={e => setFormName(e.target.value)} placeholder="z.B. Zahlungen automatisch zuordnen" data-testid="input-rule-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-desc">Beschreibung</Label>
              <Textarea id="rule-desc" value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Optionale Beschreibung..." data-testid="input-rule-description" />
            </div>
            <div className="space-y-2">
              <Label>Trigger-Typ</Label>
              <Select value={formTriggerType} onValueChange={v => { setFormTriggerType(v); setFormConditions([]); }}>
                <SelectTrigger data-testid="select-trigger-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <Label>Bedingungen</Label>
                <Button variant="outline" size="sm" onClick={addCondition} data-testid="button-add-condition"><Plus className="mr-1 h-3 w-3" />Bedingung</Button>
              </div>
              {formConditions.length === 0 && <p className="text-xs text-muted-foreground">Keine Bedingungen — Standardwerte werden verwendet.</p>}
              {formConditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={cond.field}
                    onChange={e => updateCondition(idx, 'field', e.target.value)}
                    placeholder="Feld"
                    className="flex-1"
                    data-testid={`input-condition-field-${idx}`}
                  />
                  <Select value={cond.operator} onValueChange={v => updateCondition(idx, 'operator', v)}>
                    <SelectTrigger className="w-20" data-testid={`select-condition-op-${idx}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={cond.value}
                    onChange={e => updateCondition(idx, 'value', e.target.value)}
                    placeholder="Wert"
                    className="flex-1"
                    data-testid={`input-condition-value-${idx}`}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeCondition(idx)} data-testid={`button-remove-condition-${idx}`}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {TRIGGER_CONDITION_FIELDS[formTriggerType] && (
                <div className="text-xs text-muted-foreground">
                  Verfügbare Felder: {TRIGGER_CONDITION_FIELDS[formTriggerType].map(f => f.label).join(', ')}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false); setEditingRule(null); }} data-testid="button-cancel-rule">Abbrechen</Button>
            <Button onClick={handleSubmit} disabled={!formName || createMutation.isPending || updateMutation.isPending} data-testid="button-save-rule">
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingRule ? 'Speichern' : 'Erstellen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dryRunResult} onOpenChange={open => { if (!open) { setDryRunResult(null); setDryRunRuleId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dryrun-title">Testlauf-Ergebnis</DialogTitle>
            <DialogDescription>Vorschau der Aktionen — es wurden keine Daten verändert.</DialogDescription>
          </DialogHeader>
          {dryRunResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <Badge variant={dryRunResult.status === 'success' ? 'default' : 'destructive'} data-testid="badge-dryrun-status">
                  {dryRunResult.status === 'success' ? 'Erfolgreich' : dryRunResult.status === 'error' ? 'Fehler' : 'Übersprungen'}
                </Badge>
                <span className="text-sm font-medium" data-testid="text-dryrun-matched">{dryRunResult.matchedItems} Einträge betroffen</span>
              </div>
              {dryRunResult.errorMessage && (
                <p className="text-sm text-destructive" data-testid="text-dryrun-error">{dryRunResult.errorMessage}</p>
              )}
              {dryRunResult.actions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Typ</TableHead>
                      <TableHead>Beschreibung</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dryRunResult.actions.map((action, idx) => (
                      <TableRow key={idx} data-testid={`row-dryrun-action-${idx}`}>
                        <TableCell>
                          <Badge variant="secondary" data-testid={`badge-action-type-${idx}`}>{action.type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-action-desc-${idx}`}>{action.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-actions">Keine Aktionen erforderlich.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDryRunResult(null); setDryRunRuleId(null); }} data-testid="button-close-dryrun">Schließen</Button>
            {dryRunResult && dryRunResult.actions.length > 0 && dryRunRuleId && (
              <Button onClick={() => executeMutation.mutate(dryRunRuleId)} disabled={executeMutation.isPending} data-testid="button-execute-now">
                {executeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Play className="mr-2 h-4 w-4" />
                Jetzt ausführen
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AutomationSettings() {
  const { isActive, isLoading: kiLoading } = useKiAutopilot();
  const [mainTab, setMainTab] = useState('rules-engine');

  if (kiLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>KI-Autopilot erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">Die Automatisierung ist Teil des KI-Autopilot Add-ons.</p>
            <Link to="/checkout?plan=ki-autopilot">
              <Button data-testid="button-upgrade-ki"><Sparkles className="mr-2 h-4 w-4" />KI-Autopilot aktivieren</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Zap className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-automation-title">Automatisierung</h1>
        <Badge variant="secondary">KI-Autopilot</Badge>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="rules-engine" data-testid="tab-rules-engine">
            <TestTube className="mr-2 h-4 w-4" />Regelwerk
          </TabsTrigger>
          <TabsTrigger value="ki-settings" data-testid="tab-ki-settings">
            <Sparkles className="mr-2 h-4 w-4" />KI-Autopilot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules-engine">
          <RulesEngine />
        </TabsContent>

        <TabsContent value="ki-settings">
          <KiAutopilotSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
