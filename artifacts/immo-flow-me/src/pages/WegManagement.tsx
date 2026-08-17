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
import {
  Plus, Users, PiggyBank, Vote, Loader2, Calendar, Building2, Gavel,
  FileText, Wrench, AlertTriangle, Trash2, MapPin, Clock, CheckCircle2,
  CircleDot, ChevronRight, Euro, Shield, ArrowUpCircle, ArrowDownCircle,
  Eye, Send, Download, Zap, ArrowRightLeft, Info, UserPlus, ReceiptText, Printer,
  Receipt, CheckSquare
} from 'lucide-react';
import {
  useWegUnitOwners, useCreateWegUnitOwner, useDeleteWegUnitOwner,
  useWegAssemblies, useCreateWegAssembly, useUpdateWegAssembly,
  useWegAgendaItems, useCreateWegAgendaItem, useDeleteWegAgendaItem,
  useWegVotes, useCreateWegVote,
  useWegOwnerVotes, useCreateWegOwnerVote,
  useReserveFund, useCreateReserveFundEntry,
  useWegBudgetPlans, useCreateWegBudgetPlan, useUpdateWegBudgetPlan,
  useWegBudgetLines, useCreateWegBudgetLine, useUpdateWegBudgetLine, useDeleteWegBudgetLine,
  useBudgetPlanPreview, useActivateBudgetPlan, useWegVorschreibungen, useSendWegVorschreibungen,
  useWegSpecialAssessments, useCreateWegSpecialAssessment, useCreateSpecialAssessmentInvoices,
  useWegMaintenance, useCreateWegMaintenance, useUpdateWegMaintenance, useDeleteWegMaintenance,
  useOwnerChanges, useCreateOwnerChange, useUpdateOwnerChange, useOwnerChangePreview, useExecuteOwnerChange,
  type BudgetDistribution,
  type WegOwnerChange,
} from '@/hooks/useWeg';
import { downloadWegVorschreibungPdf } from '@/utils/wegVorschreibungPdfExport';
import { downloadOwnerChangePdf } from '@/utils/wegOwnerChangePdfExport';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast as useToast_ } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Edit2 } from 'lucide-react';
import { GuidedEmptyState } from '@/components/GuidedEmptyState';

function fmt(amount: number) {
  return `\u20AC ${amount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtPct(value: number) {
  return `${value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

const assemblyTypeLabels: Record<string, string> = {
  ordentlich: 'Ordentlich',
  ausserordentlich: 'Au\u00DFerordentlich',
  umlaufbeschluss: 'Umlaufbeschluss',
};

const assemblyStatusLabels: Record<string, string> = {
  geplant: 'Geplant',
  eingeladen: 'Eingeladen',
  durchgefuehrt: 'Durchgef\u00FChrt',
  protokolliert: 'Protokolliert',
};

const budgetStatusLabels: Record<string, string> = {
  entwurf: 'Entwurf',
  beschlossen: 'Beschlossen',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
};

const maintenanceCategoryLabels: Record<string, string> = {
  ordentliche_verwaltung: 'Ordentliche Verwaltung',
  ausserordentliche_verwaltung: 'Au\u00DFerordentliche Verwaltung',
  notmassnahme: 'Notma\u00DFnahme',
};

const priorityLabels: Record<string, string> = {
  niedrig: 'Niedrig',
  normal: 'Normal',
  hoch: 'Hoch',
  dringend: 'Dringend',
};

const maintenanceStatusLabels: Record<string, string> = {
  geplant: 'Geplant',
  beauftragt: 'Beauftragt',
  in_ausfuehrung: 'In Ausf\u00FChrung',
  abgeschlossen: 'Abgeschlossen',
};

const financingLabels: Record<string, string> = {
  ruecklage: 'R\u00FCcklage',
  sonderumlage: 'Sonderumlage',
  laufend: 'Laufend',
};

const budgetCategories = [
  'Betriebskosten', 'Wasser', 'Kanal', 'M\u00FCll', 'Versicherung', 'Hausbetreuung',
  'Strom allgemein', 'Lift', 'Gartenpflege', 'Heizkosten', 'Verwaltungshonorar',
  'Instandhaltungsr\u00FCcklage', 'Sonstiges',
];

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    niedrig: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    hoch: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    dringend: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  };
  return <Badge className={colors[priority] || ''}>{priorityLabels[priority] || priority}</Badge>;
}

function StatusBadge({ status, labels, variant }: { status: string; labels: Record<string, string>; variant?: string }) {
  const colors: Record<string, string> = {
    geplant: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    eingeladen: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    durchgefuehrt: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    protokolliert: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    entwurf: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    beschlossen: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    abgeschlossen: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    beauftragt: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    in_ausfuehrung: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    aktiv: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    in_einzahlung: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  };
  return <Badge className={colors[status] || ''}>{labels[status] || status}</Badge>;
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-muted-foreground">\u2014</span>;
  const map: Record<string, { label: string; cls: string }> = {
    angenommen: { label: 'Angenommen', cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
    abgelehnt: { label: 'Abgelehnt', cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
    vertagt: { label: 'Vertagt', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  };
  const entry = map[result];
  if (!entry) return <Badge>{result}</Badge>;
  return <Badge className={entry.cls}>{entry.label}</Badge>;
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Icon className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>{text}</p>
      </CardContent>
    </Card>
  );
}

function LoadingSpinner() {
  return <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
}

// ── WEG-Jahresabrechnung Tab ──────────────────────────────────────────────────

const statusLabelsSettlement: Record<string, string> = {
  entwurf: 'Entwurf',
  berechnet: 'Berechnet',
  finalisiert: 'Finalisiert',
  versendet: 'Versendet',
};
const statusStylesSettlement: Record<string, string> = {
  entwurf: 'bg-yellow-100 text-yellow-800',
  berechnet: 'bg-purple-100 text-purple-800',
  finalisiert: 'bg-green-100 text-green-800',
  versendet: 'bg-blue-100 text-blue-800',
};

function JahresabrechnungTab({
  propertyId,
  orgId,
  properties,
}: {
  propertyId: string;
  orgId: string | null;
  properties: any[];
}) {
  const { toast } = useToastWeg();
  const now = new Date();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createYear, setCreateYear] = useState(now.getFullYear() - 1);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sendConfirmId, setSendConfirmId] = useState<string | null>(null);
  const [emailLogId, setEmailLogId] = useState<string | null>(null);

  const { data: settlements = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/weg/settlements', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/settlements${params}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!orgId,
  });

  const createMut = useMutation({
    mutationFn: async ({ propId, year }: { propId: string; year: number }) => {
      const res = await apiRequest('POST', '/api/weg/settlement/create', {
        property_id: propId,
        year,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fehler beim Erstellen der Abrechnung');
      }
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setCreateDialogOpen(false);
      setPreviewData(null);
      toast({ title: 'Abrechnung erstellt', description: `Jahresabrechnung ${createYear} wurde erfolgreich erstellt.` });
    },
    onError: (err: any) => {
      setCreateError(err.message);
    },
  });

  const { data: emailLog = [], isLoading: emailLogLoading } = useQuery({
    queryKey: ['/api/weg/settlement/email-log', emailLogId],
    queryFn: async () => {
      if (!emailLogId) return [];
      const res = await fetch(`/api/weg/settlement/${emailLogId}/email-log`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!emailLogId,
  });

  const sendMut = useMutation({
    mutationFn: async (settlementId: string) => {
      const res = await apiRequest('POST', `/api/weg/settlement/${settlementId}/send`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fehler beim Versenden der Abrechnung');
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      refetch();
      setSendConfirmId(null);
      const sent = data.emails_sent ?? 0;
      const failedCount = data.emails_failed ?? 0;
      const noEmail = data.no_email_count ?? 0;
      let desc = `${sent} E-Mail${sent !== 1 ? 's' : ''} erfolgreich versendet.`;
      if (failedCount > 0) desc += ` ${failedCount} fehlgeschlagen.`;
      if (noEmail > 0) desc += ` ${noEmail} Eigentümer ohne E-Mail-Adresse.`;
      toast({ title: 'Abrechnung versendet', description: desc });
    },
    onError: (err: any) => {
      setSendConfirmId(null);
      toast({ title: 'Versand fehlgeschlagen', description: err.message, variant: 'destructive' });
    },
  });

  const loadPreview = async () => {
    if (!propertyId) return;
    setPreviewLoading(true);
    setPreviewData(null);
    setPreviewError(null);
    try {
      const res = await fetch(
        `/api/weg/settlement/preview?propertyId=${propertyId}&year=${createYear}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPreviewError(err.error || 'Fehler bei der Abrechnungsvorschau');
      } else {
        setPreviewData(await res.json());
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const openPdf = (settlementId: string) => {
    window.open(`/api/weg/settlement/${settlementId}/pdf`, '_blank', 'noopener,noreferrer');
  };

  if (!propertyId) {
    return (
      <Card className="mt-4">
        <CardContent className="py-8 text-center text-muted-foreground">
          Bitte zuerst eine Liegenschaft auswählen.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">WEG-Jahresabrechnungen</h3>
          <p className="text-sm text-muted-foreground">
            Alle gespeicherten Jahresabrechnungen für diese Liegenschaft. PDF öffnet eine druckfertige Abrechnung.
          </p>
        </div>
        <Button
          onClick={() => { setPreviewData(null); setCreateDialogOpen(true); }}
          data-testid="button-create-settlement"
        >
          <Plus className="h-4 w-4 mr-2" /> Neue Abrechnung erstellen
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : settlements.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <ReceiptText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Noch keine Jahresabrechnung vorhanden</p>
              <p className="text-sm">Erstellen Sie die erste Abrechnung mit dem Button oben rechts.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jahr</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Versendet</TableHead>
                  <TableHead className="text-right">Gesamtkosten</TableHead>
                  <TableHead className="text-right">Vorauszahlungen</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Eigentümer</TableHead>
                  <TableHead className="text-right">Rücklage</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s: any) => (
                  <TableRow key={s.id} data-testid={`row-settlement-${s.id}`}>
                    <TableCell className="font-semibold text-lg">{s.year}</TableCell>
                    <TableCell>
                      <Badge className={statusStylesSettlement[s.status] || 'bg-gray-100 text-gray-700'}>
                        {statusLabelsSettlement[s.status] || s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {s.last_sent_at ? (
                        <span className="text-green-700 font-medium">
                          Versendet am {new Date(s.last_sent_at).toLocaleDateString('de-AT')}
                        </span>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-200">
                          Noch nicht versendet
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmt(parseFloat(s.total_expenses || '0'))}</TableCell>
                    <TableCell className="text-right">{fmt(parseFloat(s.total_prepayments || '0'))}</TableCell>
                    <TableCell className="text-right">
                      <span className={parseFloat(s.total_difference || '0') > 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                        {fmt(parseFloat(s.total_difference || '0'))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{s.owner_count ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmt(parseFloat(s.reserve_fund_balance || '0'))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString('de-AT') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openPdf(s.id)}
                          data-testid={`button-pdf-${s.id}`}
                          className="gap-1.5"
                          title="Öffnet die druckfertige Abrechnung in einem neuen Tab. Im Druckdialog 'Als PDF speichern' wählen."
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Drucken / Als PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSendConfirmId(s.id)}
                          data-testid={`button-send-${s.id}`}
                          className="gap-1.5"
                          disabled={sendMut.isPending}
                          title="Versendet die Abrechnung per E-Mail an alle Eigentümer mit hinterlegter E-Mail-Adresse"
                        >
                          {sendMut.isPending && sendConfirmId === s.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Send className="h-3.5 w-3.5" />
                          }
                          Per E-Mail versenden
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEmailLogId(s.id)}
                          data-testid={`button-email-log-${s.id}`}
                          className="gap-1.5 text-muted-foreground"
                          title="Zeigt wer wann die Abrechnung erhalten hat"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          Versandprotokoll
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Neue Abrechnung erstellen */}
      <Dialog open={createDialogOpen} onOpenChange={(v) => { setCreateDialogOpen(v); if (!v) { setPreviewData(null); setPreviewError(null); setCreateError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue WEG-Jahresabrechnung erstellen</DialogTitle>
            <DialogDescription>
              Berechnet die Jahresabrechnung aus Vorschreibungen, Rücklage und Sonderumlagen und speichert sie dauerhaft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="settlement-year">Abrechnungsjahr</Label>
              <Select
                value={String(createYear)}
                onValueChange={(v) => { setCreateYear(parseInt(v)); setPreviewData(null); setPreviewError(null); setCreateError(null); }}
              >
                <SelectTrigger id="settlement-year" data-testid="select-settlement-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => now.getFullYear() - i).map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Vorschau-Fehler (inline, z.B. keine Vorschreibungen) */}
            {previewError && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {/* Vorschau-Button / Vorschau-Ergebnis */}
            {!previewData && !previewError && (
              <Button variant="secondary" onClick={loadPreview} disabled={previewLoading} className="w-full">
                {previewLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                Abrechnung vorberechnen
              </Button>
            )}
            {!previewData && previewError && (
              <Button variant="outline" onClick={loadPreview} disabled={previewLoading} className="w-full">
                {previewLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                Erneut versuchen
              </Button>
            )}

            {previewData && (() => {
              // Alle eindeutigen Warnungen aus den Eigentümer-Ergebnissen sammeln
              const allWarnings: string[] = Array.from(new Set(
                (previewData.owner_results ?? previewData.ownerResults ?? [])
                  .flatMap((o: any) => o.warnings ?? [])
              ));
              // Typ 1: Kein Verteilungsschlüssel im Wirtschaftsplan konfiguriert → MEA-Fallback
              const missingKeyWarnings = allWarnings.filter(w =>
                w.includes('kein Verteilungsschlüssel konfiguriert')
              );
              // Typ 2: Nutzwert nicht gepflegt → Fallback auf MEA (anderer Handlungsbedarf)
              const missingNutzwertWarnings = allWarnings.filter(w =>
                w.includes('Nutzwert nicht gepflegt')
              );

              return (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                    <p className="font-medium text-base">Vorschau {createYear}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">Gesamtkosten</span>
                      <span className="text-right font-medium">{fmt(parseFloat(previewData.total_expenses || previewData.totalExpenses || '0'))}</span>
                      <span className="text-muted-foreground">Vorauszahlungen</span>
                      <span className="text-right font-medium">{fmt(parseFloat(previewData.total_prepayments || previewData.totalPrepayments || '0'))}</span>
                      <span className="text-muted-foreground">Saldo gesamt</span>
                      <span className={`text-right font-semibold ${parseFloat(previewData.total_difference || previewData.totalDifference || '0') > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {fmt(parseFloat(previewData.total_difference || previewData.totalDifference || '0'))}
                      </span>
                      <span className="text-muted-foreground">Eigentümer</span>
                      <span className="text-right">{previewData.owner_count ?? previewData.ownerCount ?? '—'}</span>
                      <span className="text-muted-foreground">Rücklage-Stand</span>
                      <span className="text-right">{fmt(parseFloat(previewData.reserve_fund_balance || previewData.reserveFundBalance || '0'))}</span>
                    </div>
                  </div>

                  {/* Typ 1: Fehlende Verteilungsschlüssel im Wirtschaftsplan */}
                  {missingKeyWarnings.length > 0 && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 text-sm"
                      data-testid="settlement-warnings-missing-key"
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="space-y-1 text-amber-800 dark:text-amber-200">
                        <p className="font-semibold">
                          Fehlender Verteilungsschlüssel im Wirtschaftsplan
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Für folgende Kostenkategorien ist im Wirtschaftsplan kein Schlüssel hinterlegt — es wurde automatisch der MEA-Anteil als gesetzlicher Standard verwendet. Bitte den Wirtschaftsplan ergänzen:
                        </p>
                        <ul className="list-disc list-inside space-y-0.5 text-xs mt-1">
                          {missingKeyWarnings.map((w, i) => (
                            <li key={i} data-testid={`settlement-warning-key-${i}`}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Typ 2: Nutzwert nicht gepflegt → Fallback auf MEA */}
                  {missingNutzwertWarnings.length > 0 && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-3 text-sm"
                      data-testid="settlement-warnings-missing-nutzwert"
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
                      <div className="space-y-1 text-yellow-800 dark:text-yellow-200">
                        <p className="font-semibold">Nutzwert nicht gepflegt</p>
                        <p className="text-xs text-yellow-700 dark:text-yellow-300">
                          Für folgende Kategorien ist „Nutzwert" als Schlüssel konfiguriert, aber einzelne Eigentümer haben keinen Nutzwert hinterlegt — es wurde auf MEA-Anteil zurückgefallen. Bitte den Nutzwert in den Einheitsdaten ergänzen:
                        </p>
                        <ul className="list-disc list-inside space-y-0.5 text-xs mt-1">
                          {missingNutzwertWarnings.map((w, i) => (
                            <li key={i} data-testid={`settlement-warning-nutzwert-${i}`}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Erstellen-Fehler (inline, z.B. keine Vorschreibungen beim direkten Speichern) */}
            {createError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="create-settlement-error">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Abbrechen</Button>
            <Button
              onClick={() => { setCreateError(null); createMut.mutate({ propId: propertyId, year: createYear }); }}
              disabled={createMut.isPending}
              data-testid="button-confirm-create-settlement"
            >
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Abrechnung speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bestätigung: Abrechnung per E-Mail versenden */}
      <AlertDialog open={!!sendConfirmId} onOpenChange={(v) => { if (!v) setSendConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrechnung per E-Mail versenden?</AlertDialogTitle>
            <AlertDialogDescription>
              Die WEG-Jahresabrechnung wird an alle Eigentümer mit hinterlegter E-Mail-Adresse versendet.
              Nach erfolgreichem Versand wird der Status auf „Versendet" gesetzt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendMut.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (sendConfirmId) sendMut.mutate(sendConfirmId); }}
              disabled={sendMut.isPending}
            >
              {sendMut.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Wird versendet…</>
                : <><Send className="h-4 w-4 mr-2" />Jetzt versenden</>
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Versandprotokoll-Dialog */}
      <Dialog open={!!emailLogId} onOpenChange={(v) => { if (!v) setEmailLogId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Versandprotokoll
            </DialogTitle>
            <DialogDescription>
              Aufzeichnung aller E-Mail-Versandversuche für diese Abrechnung (§ 34 WEG 2002).
            </DialogDescription>
          </DialogHeader>
          {emailLogLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : emailLog.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <Send className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Noch kein Versand protokolliert.</p>
              <p className="mt-1">Versenden Sie die Abrechnung, um hier einen Eintrag zu sehen.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {emailLog.filter((e: any) => e.status === 'sent').length} erfolgreich ·{' '}
                {emailLog.filter((e: any) => e.status === 'failed').length} fehlgeschlagen
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Eigentümer</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Versendet am</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emailLog.map((entry: any) => (
                    <TableRow key={entry.id} data-testid={`row-email-log-${entry.id}`}>
                      <TableCell className="text-sm">{entry.owner_name || '—'}</TableCell>
                      <TableCell className="text-sm font-mono text-xs">{entry.email}</TableCell>
                      <TableCell>
                        <Badge
                          className={entry.status === 'sent'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}
                          title={entry.error_message || undefined}
                        >
                          {entry.status === 'sent' ? 'Gesendet' : 'Fehlgeschlagen'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.sent_at
                          ? new Date(entry.sent_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailLogId(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// small local alias for useToast so the hook name doesn't clash
function useToastWeg() { return useToast_(); }

function OwnerStammdatenTab({ orgId }: { orgId: string | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('Österreich');
  const [iban, setIban] = useState('');
  const [bic, setBic] = useState('');
  const [bankName, setBankName] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [notes, setNotes] = useState('');

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ['/api/owners'],
    queryFn: async () => {
      const res = await fetch('/api/owners', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createOwnerMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/owners', data);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/owners'] }); },
  });

  const updateOwnerMut = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest('PATCH', `/api/owners/${id}`, data);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/owners'] }); },
  });

  const deleteOwnerMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/owners/${id}`);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/owners'] }); },
  });

  const resetForm = () => {
    setEditId(null); setFirstName(''); setLastName(''); setCompanyName('');
    setEmail(''); setPhone(''); setMobilePhone(''); setAddress('');
    setCity(''); setPostalCode(''); setCountry('Österreich');
    setIban(''); setBic(''); setBankName(''); setTaxNumber(''); setNotes('');
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (o: any) => {
    setEditId(o.id);
    setFirstName(o.firstName || ''); setLastName(o.lastName || '');
    setCompanyName(o.companyName || ''); setEmail(o.email || '');
    setPhone(o.phone || ''); setMobilePhone(o.mobilePhone || '');
    setAddress(o.address || ''); setCity(o.city || '');
    setPostalCode(o.postalCode || ''); setCountry(o.country || 'Österreich');
    setIban(o.iban || ''); setBic(o.bic || '');
    setBankName(o.bankName || ''); setTaxNumber(o.taxNumber || '');
    setNotes(o.notes || '');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload: any = {
      firstName, lastName, companyName: companyName || null,
      email: email || null, phone: phone || null, mobilePhone: mobilePhone || null,
      address: address || null, city: city || null, postalCode: postalCode || null,
      country: country || null, iban: iban || null, bic: bic || null,
      bankName: bankName || null, taxNumber: taxNumber || null, notes: notes || null,
    };
    if (editId) {
      await updateOwnerMut.mutateAsync({ id: editId, ...payload });
    } else {
      await createOwnerMut.mutateAsync(payload);
    }
    setDialogOpen(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteOwnerMut.mutateAsync(deleteId);
    setDeleteDialogOpen(false);
    setDeleteId(null);
  };

  const isSaving = createOwnerMut.isPending || updateOwnerMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} data-testid="button-add-stammdaten-owner">
          <Plus className="h-4 w-4 mr-2" /> Neuer Eigentümer
        </Button>
      </div>

      {isLoading ? <LoadingSpinner /> : owners.length === 0 ? (
        <EmptyState icon={Users} text="Noch keine Eigentümer-Stammdaten vorhanden." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Firma</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>IBAN</TableHead>
              <TableHead>Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {owners.map((o: any) => (
              <TableRow key={o.id} data-testid={`row-stammdaten-${o.id}`}>
                <TableCell className="font-medium">{o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim() || '—'}</TableCell>
                <TableCell>{o.companyName || '—'}</TableCell>
                <TableCell>{o.email || '—'}</TableCell>
                <TableCell>{o.phone || o.mobilePhone || '—'}</TableCell>
                <TableCell>{[o.address, o.postalCode, o.city].filter(Boolean).join(', ') || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{o.iban || '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(o)} data-testid={`button-edit-stammdaten-${o.id}`}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setDeleteId(o.id); setDeleteDialogOpen(true); }} data-testid={`button-delete-stammdaten-${o.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) { setDialogOpen(false); resetForm(); } else setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Eigentümer bearbeiten' : 'Neuer Eigentümer'}</DialogTitle>
            <DialogDescription>Stammdaten des Eigentümers erfassen bzw. bearbeiten.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vorname</Label>
                <Input value={firstName} onChange={e => setFirstName(e.target.value)} data-testid="input-stamm-firstName" />
              </div>
              <div className="space-y-2">
                <Label>Nachname</Label>
                <Input value={lastName} onChange={e => setLastName(e.target.value)} data-testid="input-stamm-lastName" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Firma</Label>
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} data-testid="input-stamm-companyName" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>E-Mail</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-stamm-email" />
              </div>
              <div className="space-y-2">
                <Label>Telefon</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} data-testid="input-stamm-phone" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mobiltelefon</Label>
              <Input value={mobilePhone} onChange={e => setMobilePhone(e.target.value)} data-testid="input-stamm-mobilePhone" />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} data-testid="input-stamm-address" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>PLZ</Label>
                <Input value={postalCode} onChange={e => setPostalCode(e.target.value)} data-testid="input-stamm-postalCode" />
              </div>
              <div className="space-y-2">
                <Label>Ort</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} data-testid="input-stamm-city" />
              </div>
              <div className="space-y-2">
                <Label>Land</Label>
                <Input value={country} onChange={e => setCountry(e.target.value)} data-testid="input-stamm-country" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>IBAN</Label>
                <Input value={iban} onChange={e => setIban(e.target.value)} data-testid="input-stamm-iban" />
              </div>
              <div className="space-y-2">
                <Label>BIC</Label>
                <Input value={bic} onChange={e => setBic(e.target.value)} data-testid="input-stamm-bic" />
              </div>
              <div className="space-y-2">
                <Label>Bank</Label>
                <Input value={bankName} onChange={e => setBankName(e.target.value)} data-testid="input-stamm-bankName" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Steuernummer</Label>
              <Input value={taxNumber} onChange={e => setTaxNumber(e.target.value)} data-testid="input-stamm-taxNumber" />
            </div>
            <div className="space-y-2">
              <Label>Notizen</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-stamm-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} data-testid="button-cancel-stammdaten">Abbrechen</Button>
            <Button onClick={handleSave} disabled={!firstName || !lastName || isSaving} data-testid="button-save-stammdaten">
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {editId ? 'Speichern' : 'Anlegen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eigentümer löschen</AlertDialogTitle>
            <AlertDialogDescription>Möchten Sie diesen Eigentümer wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-stammdaten">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} data-testid="button-confirm-delete-stammdaten">
              {deleteOwnerMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WegSetupWizard({ selectedPropertyId, setSelectedPropertyId, properties, orgId }: {
  selectedPropertyId: string;
  setSelectedPropertyId: (id: string) => void;
  properties: any[];
  orgId: string | null;
}) {
  const [wizardStep, setWizardStep] = useState(1);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newIban, setNewIban] = useState('');
  const [assignments, setAssignments] = useState<Record<string, { ownerId: string; meaShare: string; nutzwert: string }>>({});

  const { data: owners = [] } = useQuery({
    queryKey: ['/api/owners'],
    queryFn: async () => {
      const res = await fetch('/api/owners', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ['/api/units', selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/units?propertyId=${selectedPropertyId}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedPropertyId,
  });

  const { data: unitOwners = [] } = useQuery({
    queryKey: ['/api/weg/unit-owners', selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/weg/unit-owners?propertyId=${selectedPropertyId}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedPropertyId,
  });

  const createOwnerMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/owners', data);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/owners'] }); },
  });

  const createUnitOwnerMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/unit-owners', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/weg/unit-owners', selectedPropertyId] });
    },
  });

  const selectedProp = properties.find((p: any) => p.id === selectedPropertyId);

  const handleAddOwner = async () => {
    await createOwnerMut.mutateAsync({
      firstName: newFirstName, lastName: newLastName,
      email: newEmail || null, iban: newIban || null,
    });
    setNewFirstName(''); setNewLastName(''); setNewEmail(''); setNewIban('');
  };

  const handleAssignUnit = async (unitId: string) => {
    const a = assignments[unitId];
    if (!a?.ownerId || !a?.meaShare) return;
    await createUnitOwnerMut.mutateAsync({
      organization_id: orgId,
      property_id: selectedPropertyId,
      unit_id: unitId,
      owner_id: a.ownerId,
      mea_share: parseFloat(a.meaShare.replace(',', '.')) || 0,
      nutzwert: a.nutzwert ? parseFloat(a.nutzwert.replace(',', '.')) : null,
      valid_from: null, valid_to: null, notes: null,
    });
    setAssignments(prev => {
      const next = { ...prev };
      delete next[unitId];
      return next;
    });
  };

  const totalMea = unitOwners.reduce((sum: number, uo: any) => sum + (uo.mea_share || 0), 0);
  const meaOk = Math.abs(totalMea - 100) < 0.01;

  const getOwnerName = (id: string) => {
    const o = owners.find((o: any) => o.id === id);
    return o ? (o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim() || id) : id;
  };

  const stepLabels = ['Liegenschaft auswählen', 'Eigentümer anlegen', 'Einheiten zuordnen', 'Zusammenfassung'];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        {stepLabels.map((label, idx) => (
          <div key={idx} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <div className={`flex items-center gap-1 text-sm ${wizardStep === idx + 1 ? 'font-bold' : wizardStep > idx + 1 ? 'text-muted-foreground' : 'text-muted-foreground opacity-50'}`}>
              {wizardStep > idx + 1 ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> : <CircleDot className="h-4 w-4" />}
              <span>Schritt {idx + 1}: {label}</span>
            </div>
          </div>
        ))}
      </div>

      {wizardStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Liegenschaft auswählen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger data-testid="select-wizard-property"><SelectValue placeholder="Liegenschaft wählen..." /></SelectTrigger>
              <SelectContent>
                {properties.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProp && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Adresse:</span> {selectedProp.address}, {selectedProp.postalCode} {selectedProp.city}</div>
                <div><span className="text-muted-foreground">Einheiten:</span> {selectedProp.totalUnits || units.length}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {wizardStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Eigentümer anlegen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {owners.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>IBAN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owners.map((o: any) => (
                    <TableRow key={o.id} data-testid={`row-wizard-owner-${o.id}`}>
                      <TableCell className="font-medium">{o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim()}</TableCell>
                      <TableCell>{o.email || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{o.iban || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">Neuen Eigentümer hinzufügen</p>
              <div className="grid grid-cols-4 gap-3">
                <Input placeholder="Vorname" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} data-testid="input-wizard-firstName" />
                <Input placeholder="Nachname" value={newLastName} onChange={e => setNewLastName(e.target.value)} data-testid="input-wizard-lastName" />
                <Input placeholder="E-Mail" value={newEmail} onChange={e => setNewEmail(e.target.value)} data-testid="input-wizard-email" />
                <Input placeholder="IBAN" value={newIban} onChange={e => setNewIban(e.target.value)} data-testid="input-wizard-iban" />
              </div>
              <Button onClick={handleAddOwner} disabled={!newFirstName || !newLastName || createOwnerMut.isPending} size="sm" data-testid="button-wizard-add-owner">
                {createOwnerMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Plus className="h-3 w-3 mr-1" /> Hinzufügen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {wizardStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Einheiten zuordnen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Card>
                <CardContent className="py-2 px-4">
                  <p className="text-xs text-muted-foreground">MEA-Summe</p>
                  <p className={`text-lg font-bold ${meaOk ? 'text-green-600 dark:text-green-400' : totalMea > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`} data-testid="text-wizard-mea-total">
                    {fmtPct(totalMea)}
                    {meaOk && <CheckCircle2 className="inline h-4 w-4 ml-1" />}
                  </p>
                </CardContent>
              </Card>
              {!meaOk && totalMea > 0 && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3 mr-1" /> MEA-Summe muss 100% ergeben
                </Badge>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Einheit</TableHead>
                  <TableHead>Zugeordnet</TableHead>
                  <TableHead>Eigentümer</TableHead>
                  <TableHead>MEA-Anteil (%)</TableHead>
                  <TableHead>Nutzwert</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((u: any) => {
                  const assigned = unitOwners.find((uo: any) => uo.unit_id === u.id && !uo.valid_to);
                  const a = assignments[u.id] || { ownerId: '', meaShare: '', nutzwert: '' };
                  return (
                    <TableRow key={u.id} data-testid={`row-wizard-unit-${u.id}`}>
                      <TableCell className="font-medium">{u.name || u.unitNumber || u.topNummer || u.id}</TableCell>
                      <TableCell>
                        {assigned ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> {getOwnerName(assigned.owner_id)} ({fmtPct(assigned.mea_share)})
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {!assigned ? (
                        <>
                          <TableCell>
                            <Select value={a.ownerId} onValueChange={(v) => setAssignments(prev => ({ ...prev, [u.id]: { ...a, ownerId: v } }))}>
                              <SelectTrigger data-testid={`select-wizard-assign-owner-${u.id}`}><SelectValue placeholder="Wählen..." /></SelectTrigger>
                              <SelectContent>
                                {owners.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim()}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input value={a.meaShare} onChange={e => setAssignments(prev => ({ ...prev, [u.id]: { ...a, meaShare: e.target.value } }))} placeholder="z.B. 12,50" data-testid={`input-wizard-mea-${u.id}`} />
                          </TableCell>
                          <TableCell>
                            <Input value={a.nutzwert} onChange={e => setAssignments(prev => ({ ...prev, [u.id]: { ...a, nutzwert: e.target.value } }))} placeholder="optional" data-testid={`input-wizard-nutzwert-${u.id}`} />
                          </TableCell>
                          <TableCell>
                            <Button size="sm" onClick={() => handleAssignUnit(u.id)} disabled={!a.ownerId || !a.meaShare || createUnitOwnerMut.isPending} data-testid={`button-wizard-assign-${u.id}`}>
                              {createUnitOwnerMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Zuordnen
                            </Button>
                          </TableCell>
                        </>
                      ) : <><TableCell /><TableCell /><TableCell /><TableCell /></>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {wizardStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Zusammenfassung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="py-3 px-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Liegenschaft</p>
                  <p className="font-medium" data-testid="text-wizard-summary-property">{selectedProp?.name || '—'}</p>
                  <p className="text-sm text-muted-foreground">{selectedProp?.address}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3 px-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Einheiten</p>
                      <p className="text-lg font-bold" data-testid="text-wizard-summary-units">{units.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Eigentümer</p>
                      <p className="text-lg font-bold" data-testid="text-wizard-summary-owners">{owners.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">MEA-Summe</p>
                      <p className={`text-lg font-bold ${meaOk ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`} data-testid="text-wizard-summary-mea">
                        {fmtPct(totalMea)}
                        {meaOk ? <CheckCircle2 className="inline h-4 w-4 ml-1" /> : <AlertTriangle className="inline h-4 w-4 ml-1" />}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {unitOwners.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Einheit</TableHead>
                    <TableHead>Eigentümer</TableHead>
                    <TableHead className="text-right">MEA-Anteil</TableHead>
                    <TableHead className="text-right">Nutzwert</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unitOwners.filter((uo: any) => !uo.valid_to).map((uo: any) => {
                    const u = units.find((u: any) => u.id === uo.unit_id);
                    return (
                      <TableRow key={uo.id} data-testid={`row-wizard-summary-${uo.id}`}>
                        <TableCell className="font-medium">{u ? (u.name || u.unitNumber || u.topNummer) : uo.unit_id}</TableCell>
                        <TableCell>{getOwnerName(uo.owner_id)}</TableCell>
                        <TableCell className="text-right">{fmtPct(uo.mea_share)}</TableCell>
                        <TableCell className="text-right">{uo.nutzwert != null ? uo.nutzwert.toLocaleString('de-AT') : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="outline" onClick={() => setWizardStep(s => Math.max(1, s - 1))} disabled={wizardStep === 1} data-testid="button-wizard-back">
          Zurück
        </Button>
        <Button onClick={() => setWizardStep(s => Math.min(4, s + 1))} disabled={
          wizardStep === 4 || (wizardStep === 1 && !selectedPropertyId)
        } data-testid="button-wizard-next">
          Weiter
        </Button>
      </div>
    </div>
  );
}

export default function WegManagement() {
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const { data: properties = [] } = useProperties();
  const { data: organization } = useOrganization();
  const orgId = organization?.id || null;

  return (
    <MainLayout title="WEG-Verwaltung" subtitle="Wohnungseigentumsverwaltung gemäß WEG 2002">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">WEG-Verwaltung</h1>
            <p className="text-muted-foreground">Eigentümergemeinschaft, Versammlungen, Abstimmungen & Instandhaltung</p>
          </div>
          <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId} data-testid="select-property">
            <SelectTrigger className="w-[260px]" data-testid="select-property-trigger">
              <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Liegenschaft wählen..." />
            </SelectTrigger>
            <SelectContent>
              {properties.map((p: any) => (
                <SelectItem key={p.id} value={p.id} data-testid={`select-property-${p.id}`}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-dashed" data-testid="card-weg-quickstart">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4 shrink-0" />
                <span className="font-medium">Schnellstart:</span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>1. Liegenschaft oben auswählen</span>
                <span>2. Eigentümer & MEA zuordnen</span>
                <span>3. Wirtschaftsplan erstellen</span>
                <span>4. Vorschreibungen unter "WEG-Vorschreibungen" generieren</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="setup">
          <TabsList className="flex-wrap">
            <TabsTrigger value="setup" data-testid="tab-setup"><Zap className="h-4 w-4 mr-1" /> WEG-Einrichtung</TabsTrigger>
            <TabsTrigger value="owners" data-testid="tab-owners"><Users className="h-4 w-4 mr-1" /> Eigentümer & MEA</TabsTrigger>
            <TabsTrigger value="stammdaten" data-testid="tab-stammdaten"><UserPlus className="h-4 w-4 mr-1" /> Eigentümer-Stammdaten</TabsTrigger>
            <TabsTrigger value="assemblies" data-testid="tab-assemblies"><Calendar className="h-4 w-4 mr-1" /> Versammlungen</TabsTrigger>
            <TabsTrigger value="votes" data-testid="tab-votes"><Vote className="h-4 w-4 mr-1" /> Abstimmungen</TabsTrigger>
            <TabsTrigger value="budget" data-testid="tab-budget"><FileText className="h-4 w-4 mr-1" /> Wirtschaftsplan</TabsTrigger>
            <TabsTrigger value="reserve" data-testid="tab-reserve"><PiggyBank className="h-4 w-4 mr-1" /> Rücklage</TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance"><Wrench className="h-4 w-4 mr-1" /> Erhaltung</TabsTrigger>
            <TabsTrigger value="sonderumlage" data-testid="tab-sonderumlage"><Receipt className="h-4 w-4 mr-1" /> Sonderumlage</TabsTrigger>
            <TabsTrigger value="jahresabrechnung" data-testid="tab-jahresabrechnung"><ReceiptText className="h-4 w-4 mr-1" /> Jahresabrechnung</TabsTrigger>
          </TabsList>

          <TabsContent value="setup"><WegSetupWizard selectedPropertyId={selectedPropertyId} setSelectedPropertyId={setSelectedPropertyId} properties={properties} orgId={orgId} /></TabsContent>
          <TabsContent value="owners"><OwnersTab propertyId={selectedPropertyId} orgId={orgId} properties={properties} /></TabsContent>
          <TabsContent value="stammdaten"><OwnerStammdatenTab orgId={orgId} /></TabsContent>
          <TabsContent value="assemblies"><AssembliesTab propertyId={selectedPropertyId} orgId={orgId} properties={properties} /></TabsContent>
          <TabsContent value="votes"><VotesTab propertyId={selectedPropertyId} /></TabsContent>
          <TabsContent value="budget"><BudgetTab propertyId={selectedPropertyId} orgId={orgId} properties={properties} /></TabsContent>
          <TabsContent value="reserve"><ReserveTab propertyId={selectedPropertyId} orgId={orgId} properties={properties} /></TabsContent>
          <TabsContent value="maintenance"><MaintenanceTab propertyId={selectedPropertyId} orgId={orgId} /></TabsContent>
          <TabsContent value="sonderumlage">
            <SonderumlageTab propertyId={selectedPropertyId} />
          </TabsContent>
          <TabsContent value="jahresabrechnung">
            <JahresabrechnungTab propertyId={selectedPropertyId} orgId={orgId} properties={properties} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function OwnersTab({ propertyId, orgId, properties = [] }: { propertyId: string; orgId: string | null; properties?: any[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [meaShare, setMeaShare] = useState('');
  const [nutzwert, setNutzwert] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');

  const [inlineOwnerOpen, setInlineOwnerOpen] = useState(false);
  const [inlineFirstName, setInlineFirstName] = useState('');
  const [inlineLastName, setInlineLastName] = useState('');
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlineIban, setInlineIban] = useState('');

  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [changeStep, setChangeStep] = useState(1);
  const [changeUnitId, setChangeUnitId] = useState('');
  const [changePrevOwnerId, setChangePrevOwnerId] = useState('');
  const [changeNewOwnerId, setChangeNewOwnerId] = useState('');
  const [changeTransferDate, setChangeTransferDate] = useState('');
  const [changeGrundbuchDate, setChangeGrundbuchDate] = useState('');
  const [changeTzNumber, setChangeTzNumber] = useState('');
  const [changeKaufvertragDate, setChangeKaufvertragDate] = useState('');
  const [changeRechtsgrund, setChangeRechtsgrund] = useState('kauf');
  const [changeNotes, setChangeNotes] = useState('');
  const [createdChangeId, setCreatedChangeId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: unitOwners = [], isLoading } = useWegUnitOwners(propertyId || undefined);
  const { data: units = [] } = useQuery({
    queryKey: ['/api/units', propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/units?propertyId=${propertyId}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });
  const { data: owners = [] } = useQuery({
    queryKey: ['/api/owners'],
    queryFn: async () => {
      const res = await fetch('/api/owners', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: ownerChanges = [] } = useOwnerChanges(propertyId || undefined);

  const createOwner = useCreateWegUnitOwner();
  const deleteOwner = useDeleteWegUnitOwner();
  const createChange = useCreateOwnerChange();
  const updateChange = useUpdateOwnerChange();
  const executeChange = useExecuteOwnerChange();

  const inlineCreateOwner = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/owners', data);
      return res.json();
    },
    onSuccess: (newOwner: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/owners'] });
      if (newOwner?.id) setOwnerId(newOwner.id);
      setInlineOwnerOpen(false);
      setInlineFirstName(''); setInlineLastName(''); setInlineEmail(''); setInlineIban('');
    },
  });

  const handleInlineOwnerCreate = async () => {
    await inlineCreateOwner.mutateAsync({
      firstName: inlineFirstName,
      lastName: inlineLastName,
      email: inlineEmail || null,
      iban: inlineIban || null,
    });
  };

  const { data: preview, isLoading: previewLoading } = useOwnerChangePreview(
    changeStep >= 5 && createdChangeId ? createdChangeId : undefined
  );

  const totalMea = unitOwners.reduce((sum, uo) => sum + (uo.mea_share || 0), 0);
  const meaWarning = unitOwners.length > 0 && Math.abs(totalMea - 100) > 0.01;
  const activeOwners = unitOwners.filter(uo => !uo.valid_to);

  const handleCreate = async () => {
    await createOwner.mutateAsync({
      organization_id: orgId,
      property_id: propertyId,
      unit_id: unitId,
      owner_id: ownerId,
      mea_share: parseFloat(meaShare.replace(',', '.')) || 0,
      nutzwert: nutzwert ? parseFloat(nutzwert.replace(',', '.')) : null,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      notes: null,
    });
    setDialogOpen(false);
    setUnitId(''); setOwnerId(''); setMeaShare(''); setNutzwert(''); setValidFrom(''); setValidTo('');
  };

  const getUnitName = (id: string) => {
    const u = units.find((u: any) => u.id === id);
    return u ? (u.name || u.unitNumber || id) : id;
  };
  const getOwnerName = (id: string) => {
    const o = owners.find((o: any) => o.id === id);
    return o ? (o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim() || id) : id;
  };

  const resetChangeWizard = () => {
    setChangeStep(1); setChangeUnitId(''); setChangePrevOwnerId(''); setChangeNewOwnerId('');
    setChangeTransferDate(''); setChangeGrundbuchDate(''); setChangeTzNumber('');
    setChangeKaufvertragDate(''); setChangeRechtsgrund('kauf'); setChangeNotes('');
    setCreatedChangeId(null);
  };

  const openChangeWizard = (unitOwnerId?: string) => {
    resetChangeWizard();
    if (unitOwnerId) {
      const uo = unitOwners.find(u => u.id === unitOwnerId);
      if (uo) {
        setChangeUnitId(uo.unit_id);
        setChangePrevOwnerId(uo.owner_id);
      }
    }
    setChangeDialogOpen(true);
  };

  const handleCreateChange = async () => {
    const result = await createChange.mutateAsync({
      property_id: propertyId,
      unit_id: changeUnitId,
      previous_owner_id: changePrevOwnerId,
      new_owner_id: changeNewOwnerId,
      transfer_date: changeTransferDate,
      grundbuch_date: changeGrundbuchDate || null,
      tz_number: changeTzNumber || null,
      kaufvertrag_date: changeKaufvertragDate || null,
      rechtsgrund: changeRechtsgrund,
      notes: changeNotes || null,
    });
    setCreatedChangeId(result.id);
    setChangeStep(5);
  };

  const handleExecuteChange = async () => {
    if (!createdChangeId) return;
    await executeChange.mutateAsync(createdChangeId);
    setChangeDialogOpen(false);
    resetChangeWizard();
  };

  const rechtsgrundLabels: Record<string, string> = {
    kauf: 'Kauf', schenkung: 'Schenkung', erbschaft: 'Erbschaft',
    zwangsversteigerung: 'Zwangsversteigerung', einbringung: 'Einbringung',
  };
  const statusLabels: Record<string, string> = {
    entwurf: 'Entwurf', grundbuch_eingetragen: 'Grundbuch eingetragen', abgeschlossen: 'Abgeschlossen',
  };
  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Eigentuemer zuordnen"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um Eigentuemer den Einheiten zuzuordnen."
    steps={["WEG-Liegenschaft oben auswaehlen", "Eigentuemer den Einheiten zuordnen", "MEA-Anteile eintragen"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">Gesamt-MEA</p>
              <p className="text-lg font-bold" data-testid="text-total-mea">{fmtPct(totalMea)}</p>
            </CardContent>
          </Card>
          {meaWarning && (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="badge-mea-warning">
              <AlertTriangle className="h-3 w-3 mr-1" /> MEA-Summe weicht von 100 % ab
            </Badge>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => openChangeWizard()} disabled={activeOwners.length === 0} data-testid="button-owner-change">
            <ArrowRightLeft className="h-4 w-4 mr-2" /> Eigent\u00FCmerwechsel
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={!propertyId} data-testid="button-add-owner">
            <Plus className="h-4 w-4 mr-2" /> Eigent\u00FCmer zuordnen
          </Button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : unitOwners.length === 0 ? (
        <EmptyState icon={Users} text="Noch keine Eigent\u00FCmer-Zuordnungen vorhanden." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Top / Einheit</TableHead>
              <TableHead>Eigent\u00FCmer</TableHead>
              <TableHead className="text-right">MEA-Anteil</TableHead>
              <TableHead className="text-right">Nutzwert</TableHead>
              <TableHead>G\u00FCltig ab</TableHead>
              <TableHead>G\u00FCltig bis</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unitOwners.map(uo => (
              <TableRow key={uo.id} data-testid={`row-owner-${uo.id}`}>
                <TableCell className="font-medium">{getUnitName(uo.unit_id)}</TableCell>
                <TableCell>{getOwnerName(uo.owner_id)}</TableCell>
                <TableCell className="text-right">{fmtPct(uo.mea_share)}</TableCell>
                <TableCell className="text-right">{uo.nutzwert != null ? uo.nutzwert.toLocaleString('de-AT') : '\u2014'}</TableCell>
                <TableCell>{fmtDate(uo.valid_from)}</TableCell>
                <TableCell>{fmtDate(uo.valid_to)}</TableCell>
                <TableCell>
                  <div className="flex gap-1" style={{ visibility: 'visible' }}>
                    {!uo.valid_to && (
                      <Button variant="ghost" size="icon" onClick={() => openChangeWizard(uo.id)} title="Eigent\u00FCmerwechsel" data-testid={`button-change-owner-${uo.id}`}>
                        <ArrowRightLeft className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteOwner.mutate(uo.id)} data-testid={`button-delete-owner-${uo.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {ownerChanges.length > 0 && (
        <div className="space-y-2">
          <Button variant="ghost" onClick={() => setShowHistory(!showHistory)} data-testid="button-toggle-history">
            <Clock className="h-4 w-4 mr-2" /> Eigent\u00FCmerwechsel-Historie ({ownerChanges.length})
            <ChevronRight className={`h-4 w-4 ml-2 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
          </Button>
          {showHistory && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Einheit</TableHead>
                  <TableHead>Bisheriger Eigt.</TableHead>
                  <TableHead>Neuer Eigt.</TableHead>
                  <TableHead>\u00DCbergabe</TableHead>
                  <TableHead>Rechtsgrund</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Storniert / Neu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ownerChanges.map((oc: WegOwnerChange) => (
                  <TableRow key={oc.id} data-testid={`row-change-${oc.id}`}>
                    <TableCell className="font-medium">Top {oc.unit_top || '\u2014'}</TableCell>
                    <TableCell>{oc.previous_owner_name || '\u2014'}</TableCell>
                    <TableCell>{oc.new_owner_name || '\u2014'}</TableCell>
                    <TableCell>{fmtDate(oc.transfer_date)}</TableCell>
                    <TableCell>{rechtsgrundLabels[oc.rechtsgrund] || oc.rechtsgrund}</TableCell>
                    <TableCell>
                      <Badge variant={oc.status === 'abgeschlossen' ? 'default' : 'outline'}>
                        {statusLabels[oc.status] || oc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {oc.status === 'abgeschlossen' ? (
                        <span className="text-sm">{oc.cancelled_invoice_count} / {oc.new_invoice_count}</span>
                      ) : '\u2014'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eigent\u00FCmer zuordnen</DialogTitle>
            <DialogDescription>Weisen Sie einer Einheit einen Eigent\u00FCmer mit MEA-Anteil zu.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Einheit</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger data-testid="select-unit"><SelectValue placeholder="Einheit w\u00E4hlen..." /></SelectTrigger>
                <SelectContent>
                  {units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name || u.unitNumber || u.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Eigentümer</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger data-testid="select-owner"><SelectValue placeholder="Eigentümer wählen..." /></SelectTrigger>
                <SelectContent>
                  {owners.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim()}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setInlineOwnerOpen(true)} data-testid="button-inline-new-owner">
                <UserPlus className="h-3 w-3 mr-1" /> Neu anlegen
              </Button>
            </div>

            {inlineOwnerOpen && (
              <Card>
                <CardContent className="py-3 px-4 space-y-3">
                  <p className="text-sm font-medium">Neuen Eigentümer schnell anlegen</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Vorname" value={inlineFirstName} onChange={e => setInlineFirstName(e.target.value)} data-testid="input-inline-firstName" />
                    <Input placeholder="Nachname" value={inlineLastName} onChange={e => setInlineLastName(e.target.value)} data-testid="input-inline-lastName" />
                    <Input placeholder="E-Mail" value={inlineEmail} onChange={e => setInlineEmail(e.target.value)} data-testid="input-inline-email" />
                    <Input placeholder="IBAN" value={inlineIban} onChange={e => setInlineIban(e.target.value)} data-testid="input-inline-iban" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleInlineOwnerCreate} disabled={!inlineFirstName || !inlineLastName || inlineCreateOwner.isPending} data-testid="button-inline-save-owner">
                      {inlineCreateOwner.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Anlegen & auswählen
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setInlineOwnerOpen(false); setInlineFirstName(''); setInlineLastName(''); setInlineEmail(''); setInlineIban(''); }} data-testid="button-inline-cancel-owner">
                      Abbrechen
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>MEA-Anteil (%)</Label>
                <Input value={meaShare} onChange={e => setMeaShare(e.target.value)} placeholder="z.B. 12,50" data-testid="input-mea-share" />
              </div>
              <div className="space-y-2">
                <Label>Nutzwert</Label>
                <Input value={nutzwert} onChange={e => setNutzwert(e.target.value)} placeholder="z.B. 45" data-testid="input-nutzwert" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>G\u00FCltig ab</Label>
                <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} data-testid="input-valid-from" />
              </div>
              <div className="space-y-2">
                <Label>G\u00FCltig bis</Label>
                <Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} data-testid="input-valid-to" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-owner">Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!unitId || !ownerId || !meaShare || createOwner.isPending} data-testid="button-save-owner">
              {createOwner.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Zuordnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={changeDialogOpen} onOpenChange={(open) => { if (!open) { setChangeDialogOpen(false); resetChangeWizard(); } else setChangeDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Eigent\u00FCmerwechsel gem. \u00A7 38 WEG
            </DialogTitle>
            <DialogDescription>
              Schritt {changeStep} von {changeStep >= 5 ? 6 : 5} \u2013 {
                changeStep === 1 ? 'Einheit & bisherigen Eigent\u00FCmer w\u00E4hlen' :
                changeStep === 2 ? 'Neuen Eigent\u00FCmer w\u00E4hlen' :
                changeStep === 3 ? '\u00DCbergabedatum & Grundbuchdaten' :
                changeStep === 4 ? 'Rechtsgrund & Anmerkungen' :
                changeStep === 5 ? 'Vorschau & Pr\u00FCfung' :
                'Best\u00E4tigung & Durchf\u00FChrung'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {changeStep === 1 && (
              <>
                <div className="space-y-2">
                  <Label>Einheit (Top-Nummer)</Label>
                  <Select value={changeUnitId} onValueChange={(v) => {
                    setChangeUnitId(v);
                    const uo = activeOwners.find(o => o.unit_id === v);
                    if (uo) setChangePrevOwnerId(uo.owner_id);
                  }}>
                    <SelectTrigger data-testid="select-change-unit"><SelectValue placeholder="Einheit w\u00E4hlen..." /></SelectTrigger>
                    <SelectContent>
                      {units.filter((u: any) => activeOwners.some(uo => uo.unit_id === u.id)).map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>{u.name || u.unitNumber || u.topNummer || u.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {changePrevOwnerId && (
                  <Card>
                    <CardContent className="py-3 px-4">
                      <p className="text-xs text-muted-foreground">Bisheriger Eigent\u00FCmer</p>
                      <p className="font-medium" data-testid="text-prev-owner">{getOwnerName(changePrevOwnerId)}</p>
                      {(() => {
                        const uo = unitOwners.find(o => o.unit_id === changeUnitId && o.owner_id === changePrevOwnerId);
                        return uo ? <p className="text-sm text-muted-foreground">MEA: {fmtPct(uo.mea_share)} | Nutzwert: {uo.nutzwert ?? '\u2014'}</p> : null;
                      })()}
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {changeStep === 2 && (
              <div className="space-y-2">
                <Label>Neuer Eigent\u00FCmer</Label>
                <Select value={changeNewOwnerId} onValueChange={setChangeNewOwnerId}>
                  <SelectTrigger data-testid="select-change-new-owner"><SelectValue placeholder="Neuen Eigent\u00FCmer w\u00E4hlen..." /></SelectTrigger>
                  <SelectContent>
                    {owners.filter((o: any) => o.id !== changePrevOwnerId).map((o: any) => (
                      <SelectItem key={o.id} value={o.id}>{o.name || `${o.firstName || ''} ${o.lastName || ''}`.trim()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" /> Der neue Eigent\u00FCmer muss bereits im System angelegt sein.
                </p>
              </div>
            )}

            {changeStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>\u00DCbergabedatum (Stichtag)</Label>
                  <Input type="date" value={changeTransferDate} onChange={e => setChangeTransferDate(e.target.value)} data-testid="input-transfer-date" />
                  <p className="text-xs text-muted-foreground">Ab diesem Datum haftet der neue Eigent\u00FCmer.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Grundbuch-Eintragungsdatum</Label>
                    <Input type="date" value={changeGrundbuchDate} onChange={e => setChangeGrundbuchDate(e.target.value)} data-testid="input-grundbuch-date" />
                  </div>
                  <div className="space-y-2">
                    <Label>TZ-Nummer</Label>
                    <Input value={changeTzNumber} onChange={e => setChangeTzNumber(e.target.value)} placeholder="z.B. TZ 1234/2026" data-testid="input-tz-number" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Kaufvertragsdatum (optional)</Label>
                  <Input type="date" value={changeKaufvertragDate} onChange={e => setChangeKaufvertragDate(e.target.value)} data-testid="input-kaufvertrag-date" />
                </div>
              </div>
            )}

            {changeStep === 4 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Rechtsgrund</Label>
                  <Select value={changeRechtsgrund} onValueChange={setChangeRechtsgrund}>
                    <SelectTrigger data-testid="select-rechtsgrund"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kauf">Kauf</SelectItem>
                      <SelectItem value="schenkung">Schenkung</SelectItem>
                      <SelectItem value="erbschaft">Erbschaft</SelectItem>
                      <SelectItem value="zwangsversteigerung">Zwangsversteigerung</SelectItem>
                      <SelectItem value="einbringung">Einbringung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Anmerkungen</Label>
                  <Textarea value={changeNotes} onChange={e => setChangeNotes(e.target.value)} placeholder="Optionale Anmerkungen zum Eigent\u00FCmerwechsel..." data-testid="input-change-notes" />
                </div>
              </div>
            )}

            {changeStep === 5 && (
              previewLoading ? <LoadingSpinner /> : preview ? (
                <div className="space-y-4">
                  {preview.warnings.length > 0 && (
                    <div className="space-y-2">
                      {preview.warnings.map((w, i) => (
                        <div key={i} className="flex gap-2 items-start rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 p-3">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                          <p className="text-sm text-amber-800 dark:text-amber-200" data-testid={`text-warning-${i}`}>{w}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="py-3 px-4 space-y-1">
                        <p className="text-xs text-muted-foreground">Bisheriger Eigent\u00FCmer</p>
                        <p className="font-medium">{preview.previous_owner?.name}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="py-3 px-4 space-y-1">
                        <p className="text-xs text-muted-foreground">Neuer Eigent\u00FCmer</p>
                        <p className="font-medium">{preview.new_owner?.name}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><Euro className="h-4 w-4" /> Aliquotierung (\u00A7 34 WEG)</CardTitle>
                    </CardHeader>
                    <CardContent className="py-3 px-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <p className="text-muted-foreground">\u00DCbergabemonat:</p>
                        <p>{preview.transfer.transfer_day}. des Monats</p>
                        <p className="text-muted-foreground">Alter Eigent\u00FCmer (Monat):</p>
                        <p>{preview.aliquotierung.old_owner_days_in_month} Tage \u2192 {fmt(preview.aliquotierung.aliquot_old_month)}</p>
                        <p className="text-muted-foreground">Neuer Eigent\u00FCmer (Monat):</p>
                        <p>{preview.aliquotierung.new_owner_days_in_month} Tage \u2192 {fmt(preview.aliquotierung.aliquot_new_month)}</p>
                        <p className="text-muted-foreground">Monatliche Vorschreibung:</p>
                        <p className="font-medium">{fmt(preview.aliquotierung.monthly_amount)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Finanzielle Auswirkungen</CardTitle>
                    </CardHeader>
                    <CardContent className="py-3 px-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <p className="text-muted-foreground">Offene R\u00FCckst\u00E4nde:</p>
                        <p className={preview.financials.past_due_amount > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>{fmt(preview.financials.past_due_amount)} ({preview.financials.past_due_invoices} Vorschr.)</p>
                        <p className="text-muted-foreground">Zu stornierende Vorschr.:</p>
                        <p>{preview.financials.future_invoices_to_cancel}</p>
                        <p className="text-muted-foreground">R\u00FCcklagestand (Gesamt):</p>
                        <p>{fmt(preview.financials.reserve_total)}</p>
                        <p className="text-muted-foreground">R\u00FCcklagen-Anteil (Top):</p>
                        <p>{fmt(preview.financials.reserve_share)} ({fmtPct(preview.financials.mea_ratio * 100)} MEA)</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Neue Vorschreibungen</CardTitle>
                    </CardHeader>
                    <CardContent className="py-3 px-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {preview.new_invoices.has_aliquot_month && (
                          <>
                            <p className="text-muted-foreground">Aliquoter Monat:</p>
                            <p>{fmt(preview.new_invoices.first_month_aliquot || 0)}</p>
                          </>
                        )}
                        <p className="text-muted-foreground">Volle Monate:</p>
                        <p>{preview.new_invoices.count}{preview.new_invoices.has_aliquot_month ? ' (inkl. aliquot)' : ''} \u00D7 {fmt(preview.new_invoices.monthly_amount)}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : <p className="text-sm text-muted-foreground text-center">Vorschau wird geladen...</p>
            )}

            {changeStep === 6 && (
              <div className="space-y-4">
                <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-700 p-4">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Achtung: Diese Aktion kann nicht r\u00FCckg\u00E4ngig gemacht werden.
                  </p>
                  <ul className="mt-2 text-sm text-red-700 dark:text-red-300 space-y-1 list-disc pl-5">
                    <li>Der bisherige Eigent\u00FCmer wird auf die Einheit beendet (validTo)</li>
                    <li>Der neue Eigent\u00FCmer wird zugeordnet (\u00FCbernimmt MEA und Nutzwert)</li>
                    <li>Zuk\u00FCnftige Vorschreibungen des Voreigent\u00FCmers werden storniert</li>
                    <li>Neue Vorschreibungen f\u00FCr den neuen Eigent\u00FCmer werden erstellt</li>
                    <li>R\u00FCcklagen-Anteil wird \u00FCbertragen</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-wrap gap-2">
            {changeStep > 1 && changeStep < 6 && (
              <Button variant="outline" onClick={() => setChangeStep(s => s - 1)} data-testid="button-change-back">Zur\u00FCck</Button>
            )}
            {changeStep === 6 && (
              <Button variant="outline" onClick={() => setChangeStep(5)} data-testid="button-change-back-final">Zur\u00FCck zur Vorschau</Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => { setChangeDialogOpen(false); resetChangeWizard(); }} data-testid="button-change-cancel">Abbrechen</Button>
            {changeStep < 4 && (
              <Button onClick={() => setChangeStep(s => s + 1)} disabled={
                (changeStep === 1 && (!changeUnitId || !changePrevOwnerId)) ||
                (changeStep === 2 && !changeNewOwnerId) ||
                (changeStep === 3 && !changeTransferDate)
              } data-testid="button-change-next">Weiter</Button>
            )}
            {changeStep === 4 && (
              <Button onClick={handleCreateChange} disabled={createChange.isPending} data-testid="button-change-create">
                {createChange.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Vorschau anzeigen
              </Button>
            )}
            {changeStep === 5 && preview && (
              <Button variant="outline" onClick={() => {
                const prop = properties.find((p: any) => p.id === propertyId);
                downloadOwnerChangePdf({
                  preview,
                  propertyName: prop?.name || '',
                  propertyAddress: prop?.address || '',
                  propertyCity: prop?.city || '',
                  rechtsgrund: changeRechtsgrund,
                  grundbuchDate: changeGrundbuchDate,
                  tzNumber: changeTzNumber,
                  kaufvertragDate: changeKaufvertragDate,
                });
              }} data-testid="button-download-pdf">
                <Download className="h-4 w-4 mr-2" /> PDF
              </Button>
            )}
            {changeStep === 5 && (
              <Button onClick={() => setChangeStep(6)} data-testid="button-change-confirm">Eigent\u00FCmerwechsel durchf\u00FChren</Button>
            )}
            {changeStep === 6 && (
              <Button onClick={handleExecuteChange} disabled={executeChange.isPending} variant="default" data-testid="button-change-execute">
                {executeChange.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Jetzt durchf\u00FChren
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssembliesTab({ propertyId, orgId, properties }: { propertyId: string; orgId: string | null; properties: any[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topDialogOpen, setTopDialogOpen] = useState(false);
  const [topAssemblyId, setTopAssemblyId] = useState('');
  const [topTitle, setTopTitle] = useState('');
  const [topDesc, setTopDesc] = useState('');
  const [topCategory, setTopCategory] = useState('allgemein');

  const [aTitle, setATitle] = useState('');
  const [aType, setAType] = useState<string>('ordentlich');
  const [aDate, setADate] = useState('');
  const [aLocation, setALocation] = useState('');
  const [aCircularDeadline, setACircularDeadline] = useState('');

  const { data: assemblies = [], isLoading } = useWegAssemblies(propertyId || undefined);
  const { data: agendaItems = [] } = useWegAgendaItems(expandedId || undefined);

  const createAssembly = useCreateWegAssembly();
  const updateAssembly = useUpdateWegAssembly();
  const createAgendaItem = useCreateWegAgendaItem();
  const deleteAgendaItem = useDeleteWegAgendaItem();

  const handleCreateAssembly = async () => {
    await createAssembly.mutateAsync({
      organization_id: orgId,
      property_id: propertyId,
      title: aTitle,
      assembly_type: aType,
      assembly_date: aDate,
      location: aLocation || null,
      is_circular_resolution: aType === 'umlaufbeschluss',
      circular_deadline: aCircularDeadline || null,
      invitation_sent_at: null,
      invitation_deadline: null,
      protocol_url: null,
      protocol_number: null,
      status: 'geplant',
      total_mea_present: null,
      total_mea_property: null,
      quorum_reached: null,
      notes: null,
    });
    setDialogOpen(false);
    setATitle(''); setAType('ordentlich'); setADate(''); setALocation(''); setACircularDeadline('');
  };

  const handleCreateTop = async () => {
    const nextNum = agendaItems.length + 1;
    await createAgendaItem.mutateAsync({
      assembly_id: topAssemblyId,
      top_number: nextNum,
      title: topTitle,
      description: topDesc || null,
      category: topCategory,
    });
    setTopDialogOpen(false);
    setTopTitle(''); setTopDesc(''); setTopCategory('allgemein');
  };

  function checkInvitationCompliance(a: any): { warning: boolean; message: string } {
    if (!a.invitation_sent_at || !a.assembly_date) return { warning: false, message: '' };
    const sent = new Date(a.invitation_sent_at);
    const assembly = new Date(a.assembly_date);
    const diffDays = (assembly.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 14) {
      return { warning: true, message: `Einladung nur ${Math.floor(diffDays)} Tage vor Versammlung (min. 14 Tage gem. \u00A7 25 Abs 2 WEG)` };
    }
    return { warning: false, message: '' };
  }

  const nextStatus: Record<string, string> = {
    geplant: 'eingeladen',
    eingeladen: 'durchgefuehrt',
    durchgefuehrt: 'protokolliert',
  };
  const nextStatusLabel: Record<string, string> = {
    geplant: 'Als eingeladen markieren',
    eingeladen: 'Als durchgef\u00FChrt markieren',
    durchgefuehrt: 'Protokolliert',
  };

  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Eigentuemerversammlungen"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um Versammlungen zu planen und zu verwalten."
    steps={["WEG-Liegenschaft oben auswaehlen", "Versammlung anlegen", "Tagesordnungspunkte hinzufuegen"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)} disabled={!propertyId} data-testid="button-add-assembly">
          <Plus className="h-4 w-4 mr-2" /> Neue Versammlung
        </Button>
      </div>

      {isLoading ? <LoadingSpinner /> : assemblies.length === 0 ? (
        <EmptyState icon={Calendar} text="Noch keine Eigent\u00FCmerversammlungen." />
      ) : (
        <div className="space-y-4">
          {assemblies.map(a => {
            const compliance = checkInvitationCompliance(a);
            const isExpanded = expandedId === a.id;
            return (
              <Card key={a.id} data-testid={`card-assembly-${a.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {a.title}
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                        {assemblyTypeLabels[a.assembly_type] || a.assembly_type}
                      </Badge>
                      <StatusBadge status={a.status} labels={assemblyStatusLabels} />
                      {nextStatus[a.status] && (
                        <Button
                          variant="outline" size="sm"
                          onClick={() => updateAssembly.mutate({ id: a.id, status: nextStatus[a.status] } as any)}
                          data-testid={`button-advance-${a.id}`}
                        >
                          <ChevronRight className="h-3 w-3 mr-1" /> {nextStatusLabel[a.status]}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(a.assembly_date)}</span>
                    {a.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.location}</span>}
                    {a.total_mea_present != null && a.total_mea_property != null && (
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        Quorum: {fmtPct(a.total_mea_present)} / {fmtPct(a.total_mea_property)}
                        {a.quorum_reached != null && (
                          a.quorum_reached
                            ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                            : <AlertTriangle className="h-3 w-3 text-destructive" />
                        )}
                      </span>
                    )}
                  </div>
                  {compliance.warning && (
                    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid={`badge-invitation-warning-${a.id}`}>
                      <AlertTriangle className="h-3 w-3 mr-1" /> {compliance.message}
                    </Badge>
                  )}

                  <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={() => setExpandedId(isExpanded ? null : a.id)} data-testid={`button-toggle-tops-${a.id}`}>
                      <Gavel className="h-3 w-3 mr-1" /> Tagesordnung {isExpanded ? 'ausblenden' : 'anzeigen'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setTopAssemblyId(a.id); setExpandedId(a.id); setTopDialogOpen(true); }} data-testid={`button-add-top-${a.id}`}>
                      <Plus className="h-3 w-3 mr-1" /> TOP hinzuf\u00FCgen
                    </Button>
                  </div>

                  {isExpanded && (
                    agendaItems.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">TOP</TableHead>
                            <TableHead>Titel</TableHead>
                            <TableHead>Kategorie</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {agendaItems.map(item => (
                            <TableRow key={item.id} data-testid={`row-top-${item.id}`}>
                              <TableCell className="font-medium">{item.top_number}</TableCell>
                              <TableCell>
                                {item.title}
                                {item.description && <p className="text-xs text-muted-foreground mt-1">{item.description}</p>}
                              </TableCell>
                              <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => deleteAgendaItem.mutate(item.id)} data-testid={`button-delete-top-${item.id}`}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Keine Tagesordnungspunkte vorhanden.</p>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Eigent\u00FCmerversammlung</DialogTitle>
            <DialogDescription>Planen Sie eine neue Versammlung gem\u00E4\u00DF WEG 2002.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Titel</Label>
              <Input value={aTitle} onChange={e => setATitle(e.target.value)} placeholder="z.B. Ordentliche EV 2026" data-testid="input-assembly-title" />
            </div>
            <div className="space-y-2">
              <Label>Typ</Label>
              <Select value={aType} onValueChange={setAType}>
                <SelectTrigger data-testid="select-assembly-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ordentlich">Ordentliche Versammlung</SelectItem>
                  <SelectItem value="ausserordentlich">Au\u00DFerordentliche Versammlung</SelectItem>
                  <SelectItem value="umlaufbeschluss">Umlaufbeschluss</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Datum & Uhrzeit</Label>
              <Input type="datetime-local" value={aDate} onChange={e => setADate(e.target.value)} data-testid="input-assembly-date" />
            </div>
            <div className="space-y-2">
              <Label>Ort</Label>
              <Input value={aLocation} onChange={e => setALocation(e.target.value)} placeholder="z.B. Gemeinschaftsraum" data-testid="input-assembly-location" />
            </div>
            {aType === 'umlaufbeschluss' && (
              <div className="space-y-2">
                <Label>R\u00FCcksendefrist (Umlaufbeschluss)</Label>
                <Input type="date" value={aCircularDeadline} onChange={e => setACircularDeadline(e.target.value)} data-testid="input-circular-deadline" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-assembly">Abbrechen</Button>
            <Button onClick={handleCreateAssembly} disabled={!aTitle || !aDate || createAssembly.isPending} data-testid="button-save-assembly">
              {createAssembly.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={topDialogOpen} onOpenChange={setTopDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tagesordnungspunkt hinzuf\u00FCgen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Titel</Label>
              <Input value={topTitle} onChange={e => setTopTitle(e.target.value)} placeholder="z.B. Genehmigung Wirtschaftsplan" data-testid="input-top-title" />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Textarea value={topDesc} onChange={e => setTopDesc(e.target.value)} data-testid="input-top-description" />
            </div>
            <div className="space-y-2">
              <Label>Kategorie</Label>
              <Select value={topCategory} onValueChange={setTopCategory}>
                <SelectTrigger data-testid="select-top-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allgemein">Allgemein</SelectItem>
                  <SelectItem value="finanzen">Finanzen</SelectItem>
                  <SelectItem value="erhaltung">Erhaltung</SelectItem>
                  <SelectItem value="verwaltung">Verwaltung</SelectItem>
                  <SelectItem value="sonstiges">Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopDialogOpen(false)} data-testid="button-cancel-top">Abbrechen</Button>
            <Button onClick={handleCreateTop} disabled={!topTitle || createAgendaItem.isPending} data-testid="button-save-top">
              {createAgendaItem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Hinzuf\u00FCgen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VotesTab({ propertyId }: { propertyId: string }) {
  const [selectedAssemblyId, setSelectedAssemblyId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [vTopic, setVTopic] = useState('');
  const [vDesc, setVDesc] = useState('');
  const [vMajority, setVMajority] = useState<string>('einfach');
  const [vYes, setVYes] = useState('0');
  const [vNo, setVNo] = useState('0');
  const [vAbstain, setVAbstain] = useState('0');
  const [vMeaYes, setVMeaYes] = useState('0');
  const [vMeaNo, setVMeaNo] = useState('0');
  const [vMeaAbstain, setVMeaAbstain] = useState('0');

  const { data: assemblies = [] } = useWegAssemblies(propertyId || undefined);
  const { data: votes = [], isLoading } = useWegVotes(selectedAssemblyId || undefined);
  const createVote = useCreateWegVote();

  const majorityLabels: Record<string, string> = {
    einfach: 'Einfache Mehrheit (>50 %)',
    qualifiziert: 'Qualifizierte Mehrheit (>66,67 %)',
    einstimmig: 'Einstimmigkeit (100 %)',
  };

  // Umlauf: assembly_type === 'umlaufbeschluss' → § 24 Abs. 1 WEG 2002 Einstimmigkeit
  const selectedAssembly = assemblies.find((a: any) => a.id === selectedAssemblyId);
  const isUmlaufAssembly = selectedAssembly?.assembly_type === 'umlaufbeschluss';

  function computeResult(majority: string, meaYes: number, meaNo: number, meaAbstain: number): string | null {
    const totalMea = meaYes + meaNo + meaAbstain;
    if (totalMea === 0) return null;
    const pct = meaYes / totalMea;
    if (majority === 'einfach') return pct > 0.5 ? 'angenommen' : 'abgelehnt';
    if (majority === 'qualifiziert') return pct > 2 / 3 ? 'angenommen' : 'abgelehnt';
    if (majority === 'einstimmig') return meaNo === 0 && meaAbstain === 0 && meaYes > 0 ? 'angenommen' : 'abgelehnt';
    return null;
  }

  const handleCreate = async () => {
    const meaY = parseFloat(vMeaYes.replace(',', '.')) || 0;
    const meaN = parseFloat(vMeaNo.replace(',', '.')) || 0;
    const meaA = parseFloat(vMeaAbstain.replace(',', '.')) || 0;
    // Umlauf erzwingt immer 'einstimmig'
    const effectiveMajority = isUmlaufAssembly ? 'einstimmig' : vMajority;
    const result = computeResult(effectiveMajority, meaY, meaN, meaA);

    await createVote.mutateAsync({
      assembly_id: selectedAssemblyId,
      agenda_item_id: null,
      topic: vTopic,
      description: vDesc || null,
      required_majority: effectiveMajority,
      votes_yes: parseInt(vYes) || 0,
      votes_no: parseInt(vNo) || 0,
      votes_abstain: parseInt(vAbstain) || 0,
      mea_votes_yes: meaY,
      mea_votes_no: meaN,
      mea_votes_abstain: meaA,
      total_mea: meaY + meaN + meaA,
      result,
      result_basis: 'mea',
      is_circular_vote: isUmlaufAssembly,
      vote_type: isUmlaufAssembly ? 'umlauf' : 'versammlung',
    });
    setDialogOpen(false);
    setVTopic(''); setVDesc(''); setVMajority('einfach');
    setVYes('0'); setVNo('0'); setVAbstain('0');
    setVMeaYes('0'); setVMeaNo('0'); setVMeaAbstain('0');
  };

  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Abstimmungen verwalten"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um Abstimmungen zu Versammlungen einzusehen."
    steps={["WEG-Liegenschaft oben auswaehlen", "Versammlung auswaehlen", "Abstimmungsergebnisse einsehen"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Select value={selectedAssemblyId} onValueChange={setSelectedAssemblyId}>
          <SelectTrigger className="w-[300px]" data-testid="select-vote-assembly">
            <SelectValue placeholder="Versammlung w\u00E4hlen..." />
          </SelectTrigger>
          <SelectContent>
            {assemblies.map(a => (
              <SelectItem key={a.id} value={a.id}>{a.title} ({fmtDate(a.assembly_date)})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setDialogOpen(true)} disabled={!selectedAssemblyId} data-testid="button-add-vote">
          <Plus className="h-4 w-4 mr-2" /> Neue Abstimmung
        </Button>
      </div>

      {!selectedAssemblyId ? (
        <EmptyState icon={Vote} text="Bitte w\u00E4hlen Sie eine Versammlung f\u00FCr die Abstimmungen." />
      ) : isLoading ? <LoadingSpinner /> : votes.length === 0 ? (
        <EmptyState icon={Vote} text="Keine Abstimmungen f\u00FCr diese Versammlung." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thema</TableHead>
              <TableHead>Mehrheit</TableHead>
              <TableHead className="text-center">Ja (K\u00F6pfe)</TableHead>
              <TableHead className="text-center">Nein (K\u00F6pfe)</TableHead>
              <TableHead className="text-center">Enthaltung</TableHead>
              <TableHead className="text-center">MEA Ja</TableHead>
              <TableHead className="text-center">MEA Nein</TableHead>
              <TableHead className="text-center">MEA Enth.</TableHead>
              <TableHead>Ergebnis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {votes.map(v => (
              <TableRow key={v.id} data-testid={`row-vote-${v.id}`}>
                <TableCell>
                  <span className="font-medium">{v.topic}</span>
                  {v.description && <p className="text-xs text-muted-foreground mt-1">{v.description}</p>}
                </TableCell>
                <TableCell className="space-y-1">
                  {v.vote_type === 'umlauf' && (
                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 mr-1" data-testid={`badge-umlauf-${v.id}`}>
                      Umlauf §24 WEG
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">{majorityLabels[v.required_majority] || v.required_majority}</Badge>
                </TableCell>
                <TableCell className="text-center text-green-600 dark:text-green-400">{v.votes_yes}</TableCell>
                <TableCell className="text-center text-destructive">{v.votes_no}</TableCell>
                <TableCell className="text-center text-muted-foreground">{v.votes_abstain}</TableCell>
                <TableCell className="text-center text-green-600 dark:text-green-400">{fmtPct(v.mea_votes_yes)}</TableCell>
                <TableCell className="text-center text-destructive">{fmtPct(v.mea_votes_no)}</TableCell>
                <TableCell className="text-center text-muted-foreground">{fmtPct(v.mea_votes_abstain)}</TableCell>
                <TableCell><ResultBadge result={v.result} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Abstimmung</DialogTitle>
            <DialogDescription>Erfassen Sie eine Abstimmung mit K\u00F6pfe- und MEA-Ergebnis.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {isUmlaufAssembly && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-300" data-testid="umlauf-warning">
                <span className="font-semibold">Umlaufbeschluss (§ 24 Abs. 1 WEG 2002):</span> Einstimmigkeit aller Wohnungseigentümer erforderlich — kein Nein, keine Enthaltung.
              </div>
            )}
            <div className="space-y-2">
              <Label>Thema</Label>
              <Input value={vTopic} onChange={e => setVTopic(e.target.value)} data-testid="input-vote-topic" />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Textarea value={vDesc} onChange={e => setVDesc(e.target.value)} data-testid="input-vote-description" />
            </div>
            <div className="space-y-2">
              <Label>Erforderliche Mehrheit</Label>
              {isUmlaufAssembly ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/50" data-testid="umlauf-majority-fixed">
                  <span className="font-medium">Einstimmigkeit (100 %) — Umlaufbeschluss</span>
                </div>
              ) : (
                <Select value={vMajority} onValueChange={setVMajority}>
                  <SelectTrigger data-testid="select-vote-majority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="einfach">Einfache Mehrheit (&gt;50 %)</SelectItem>
                    <SelectItem value="qualifiziert">Qualifizierte Mehrheit (&gt;66,67 %)</SelectItem>
                    <SelectItem value="einstimmig">Einstimmigkeit (100 %)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Abstimmung nach K\u00F6pfen</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Ja</Label><Input type="number" value={vYes} onChange={e => setVYes(e.target.value)} data-testid="input-head-yes" /></div>
                <div className="space-y-1"><Label className="text-xs">Nein</Label><Input type="number" value={vNo} onChange={e => setVNo(e.target.value)} data-testid="input-head-no" /></div>
                <div className="space-y-1"><Label className="text-xs">Enthaltung</Label><Input type="number" value={vAbstain} onChange={e => setVAbstain(e.target.value)} data-testid="input-head-abstain" /></div>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Abstimmung nach MEA-Anteilen (%)</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Ja (MEA)</Label><Input value={vMeaYes} onChange={e => setVMeaYes(e.target.value)} data-testid="input-mea-yes" /></div>
                <div className="space-y-1"><Label className="text-xs">Nein (MEA)</Label><Input value={vMeaNo} onChange={e => setVMeaNo(e.target.value)} data-testid="input-mea-no" /></div>
                <div className="space-y-1"><Label className="text-xs">Enthaltung (MEA)</Label><Input value={vMeaAbstain} onChange={e => setVMeaAbstain(e.target.value)} data-testid="input-mea-abstain" /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-vote">Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!vTopic || createVote.isPending} data-testid="button-save-vote">
              {createVote.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BudgetTab({ propertyId, orgId, properties = [] }: { propertyId: string; orgId: string | null; properties?: any[] }) {
  const selectedProp = properties.find((p: any) => p.id === propertyId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null);
  const [vorschreibungenPlanId, setVorschreibungenPlanId] = useState<string | null>(null);
  const [activatePlanId, setActivatePlanId] = useState<string | null>(null);

  // Inline-Bearbeitung: welches Feld welcher Zeile wird gerade bearbeitet
  const [editingField, setEditingField] = useState<{ lineId: string; field: 'description' | 'amount'; value: string } | null>(null);

  const [bYear, setBYear] = useState(String(new Date().getFullYear()));
  const [bManagementFee, setBManagementFee] = useState('');
  const [bReserve, setBReserve] = useState('');
  const [bDueDay, setBDueDay] = useState('5');
  const [bNotes, setBNotes] = useState('');

  const [lCategory, setLCategory] = useState('Betriebskosten');
  const [lDesc, setLDesc] = useState('');
  const [lAmount, setLAmount] = useState('');
  const [lKey, setLKey] = useState('mea');
  const [lUstRate, setLUstRate] = useState('0');

  const { data: plans = [], isLoading } = useWegBudgetPlans(propertyId || undefined);
  const { data: lines = [] } = useWegBudgetLines(expandedPlanId || undefined);
  const { data: previewData, isLoading: previewLoading } = useBudgetPlanPreview(previewPlanId || undefined);
  const { data: vorschreibungen = [], isLoading: vorschreibungenLoading } = useWegVorschreibungen(vorschreibungenPlanId || undefined);

  const createPlan = useCreateWegBudgetPlan();
  const updatePlan = useUpdateWegBudgetPlan();
  const createLine = useCreateWegBudgetLine();
  const updateLine = useUpdateWegBudgetLine();
  const deleteLine = useDeleteWegBudgetLine();
  const activatePlan = useActivateBudgetPlan();
  const sendVorschreibungen = useSendWegVorschreibungen();

  const linesTotal = lines.reduce((s, l) => s + l.amount, 0);

  const handleCreatePlan = async () => {
    await createPlan.mutateAsync({
      organization_id: orgId,
      property_id: propertyId,
      year: parseInt(bYear),
      total_amount: 0,
      reserve_contribution: parseFloat(bReserve.replace(',', '.')) || 0,
      management_fee: parseFloat(bManagementFee.replace(',', '.')) || 0,
      due_day: parseInt(bDueDay) || 5,
      status: 'entwurf',
      approved_at: null,
      approved_by_vote_id: null,
      notes: bNotes || null,
    });
    setDialogOpen(false);
    setBYear(String(new Date().getFullYear()));
    setBManagementFee('');
    setBReserve('');
    setBDueDay('5');
    setBNotes('');
  };

  const handleCreateLine = async () => {
    if (!expandedPlanId) return;
    await createLine.mutateAsync({
      budget_plan_id: expandedPlanId,
      category: lCategory,
      description: lDesc || null,
      amount: parseFloat(lAmount.replace(',', '.')) || 0,
      allocation_key: lKey,
      ust_rate: parseInt(lUstRate) || 0,
    });
    setLineDialogOpen(false);
    setLCategory('Betriebskosten');
    setLDesc('');
    setLAmount('');
    setLKey('mea');
    setLUstRate('0');
  };

  const handleActivate = async () => {
    if (!activatePlanId) return;
    await activatePlan.mutateAsync(activatePlanId);
    setActivateDialogOpen(false);
    setActivatePlanId(null);
  };

  const allocationKeyLabels: Record<string, string> = {
    mea: 'MEA-Anteil',
    nutzwert: 'Nutzwert',
    nutzflaeche: 'Nutzfl\u00E4che',
    einheiten: 'pro Einheit',
    verbrauch: 'Verbrauch',
  };

  const statusSteps = ['entwurf', 'beschlossen', 'aktiv'];
  const statusStepLabels = ['Entwurf', 'Beschlossen', 'Aktiv'];
  const statusStepIcons = [CircleDot, Gavel, Zap];

  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Wirtschaftsplan erstellen"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um den jaehrlichen Wirtschaftsplan zu erstellen und zu verwalten."
    steps={["WEG-Liegenschaft oben auswaehlen", "Kostenplanung fuer das Wirtschaftsjahr erstellen", "Vorschreibungen auf Basis des Plans generieren"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-budget">
          <Plus className="h-4 w-4 mr-2" /> Neuer Wirtschaftsplan
        </Button>
      </div>

      {isLoading ? <LoadingSpinner /> : plans.length === 0 ? (
        <EmptyState icon={FileText} text="Noch keine Wirtschaftspl\u00E4ne vorhanden." />
      ) : (
        <div className="space-y-4">
          {plans.map(p => {
            const isExpanded = expandedPlanId === p.id;
            const currentStepIndex = statusSteps.indexOf(p.status);
            const showPreview = previewPlanId === p.id;
            const showVorschreibungen = vorschreibungenPlanId === p.id;

            return (
              <Card key={p.id} data-testid={`card-budget-${p.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Wirtschaftsplan {p.year}
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={p.status} labels={budgetStatusLabels} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 py-2">
                    {statusSteps.map((step, idx) => {
                      const StepIcon = statusStepIcons[idx];
                      const isCompleted = currentStepIndex > idx;
                      const isCurrent = currentStepIndex === idx;
                      return (
                        <div key={step} className="flex items-center gap-1">
                          {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <div className={`flex items-center gap-1 text-sm ${isCurrent ? 'font-bold' : isCompleted ? 'text-muted-foreground' : 'text-muted-foreground opacity-50'}`} data-testid={`step-${step}-${p.id}`}>
                            {isCompleted ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> : <StepIcon className="h-4 w-4" />}
                            <span>{statusStepLabels[idx]}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-6 text-sm flex-wrap">
                    <span>Gesamtbetrag: <strong data-testid={`text-total-${p.id}`}>{fmt(p.total_amount)}</strong></span>
                    <span>R\u00FCcklagenbeitrag: <strong data-testid={`text-reserve-${p.id}`}>{fmt(p.reserve_contribution)}</strong></span>
                    <span>Verwaltungshonorar: <strong data-testid={`text-fee-${p.id}`}>{fmt(p.management_fee)}</strong></span>
                    <span>F\u00E4lligkeit: <strong data-testid={`text-due-${p.id}`}>{p.due_day}. des Monats</strong></span>
                    {p.notes && <span className="text-muted-foreground">{p.notes}</span>}
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="ghost" size="sm" onClick={() => setExpandedPlanId(isExpanded ? null : p.id)} data-testid={`button-toggle-lines-${p.id}`}>
                        <Euro className="h-3 w-3 mr-1" /> Positionen {isExpanded ? 'ausblenden' : 'anzeigen'}
                      </Button>
                      {(p.status === 'beschlossen' || p.status === 'aktiv') && (
                        <Button variant="ghost" size="sm" onClick={() => setPreviewPlanId(showPreview ? null : p.id)} data-testid={`button-preview-${p.id}`}>
                          <Eye className="h-3 w-3 mr-1" /> Verteilung {showPreview ? 'ausblenden' : 'anzeigen'}
                        </Button>
                      )}
                      {p.status === 'aktiv' && (
                        <Button variant="ghost" size="sm" onClick={() => setVorschreibungenPlanId(showVorschreibungen ? null : p.id)} data-testid={`button-vorschreibungen-${p.id}`}>
                          <Send className="h-3 w-3 mr-1" /> Vorschreibungen {showVorschreibungen ? 'ausblenden' : 'anzeigen'}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.status === 'entwurf' && isExpanded && (
                        <Button variant="ghost" size="sm" onClick={() => setLineDialogOpen(true)} data-testid={`button-add-line-${p.id}`}>
                          <Plus className="h-3 w-3 mr-1" /> Position hinzuf\u00FCgen
                        </Button>
                      )}
                      {p.status === 'entwurf' && (
                        <Button variant="outline" size="sm" onClick={() => updatePlan.mutate({ id: p.id, status: 'beschlossen' } as any)} data-testid={`button-approve-budget-${p.id}`}>
                          <Gavel className="h-3 w-3 mr-1" /> Beschlie\u00DFen
                        </Button>
                      )}
                      {p.status === 'beschlossen' && (
                        <Button variant="default" size="sm" onClick={() => { setActivatePlanId(p.id); setActivateDialogOpen(true); }} data-testid={`button-activate-budget-${p.id}`}>
                          <Zap className="h-3 w-3 mr-1" /> Aktivieren & Vorschreibungen generieren
                        </Button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    lines.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Kategorie</TableHead>
                              <TableHead>Beschreibung</TableHead>
                              <TableHead className="text-right">Betrag</TableHead>
                              <TableHead>Verteilschl\u00FCssel</TableHead>
                              <TableHead className="text-right">USt %</TableHead>
                              {p.status === 'entwurf' && <TableHead></TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lines.map(l => (
                              <TableRow key={l.id} data-testid={`row-line-${l.id}`}>
                                <TableCell>
                                  {p.status === 'entwurf' ? (
                                    <Select
                                      value={l.category}
                                      onValueChange={v => updateLine.mutate({ id: l.id, category: v })}
                                    >
                                      <SelectTrigger className="h-7 w-40 text-xs" data-testid={`select-inline-category-${l.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {budgetCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                        {!budgetCategories.includes(l.category) && (
                                          <SelectItem value={l.category}>{l.category}</SelectItem>
                                        )}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Badge variant="outline">{l.category}</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {p.status === 'entwurf' && editingField?.lineId === l.id && editingField.field === 'description' ? (
                                    <Input
                                      autoFocus
                                      className="h-7 text-xs w-40"
                                      value={editingField.value}
                                      onChange={e => setEditingField(f => f ? { ...f, value: e.target.value } : f)}
                                      onBlur={() => { updateLine.mutate({ id: l.id, description: editingField.value || null }); setEditingField(null); }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { updateLine.mutate({ id: l.id, description: editingField.value || null }); setEditingField(null); }
                                        if (e.key === 'Escape') setEditingField(null);
                                      }}
                                      data-testid={`input-inline-desc-${l.id}`}
                                    />
                                  ) : (
                                    <span
                                      className={p.status === 'entwurf' ? 'cursor-pointer hover:underline decoration-dashed underline-offset-2 text-muted-foreground' : ''}
                                      title={p.status === 'entwurf' ? 'Klicken zum Bearbeiten' : undefined}
                                      onClick={p.status === 'entwurf' ? () => setEditingField({ lineId: l.id, field: 'description', value: l.description || '' }) : undefined}
                                      data-testid={`text-desc-${l.id}`}
                                    >
                                      {l.description || '—'}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {p.status === 'entwurf' && editingField?.lineId === l.id && editingField.field === 'amount' ? (
                                    <Input
                                      autoFocus
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="h-7 text-xs w-28 text-right"
                                      value={editingField.value}
                                      onChange={e => setEditingField(f => f ? { ...f, value: e.target.value } : f)}
                                      onBlur={() => { const v = parseFloat(editingField.value.replace(',', '.')); if (!isNaN(v)) updateLine.mutate({ id: l.id, amount: v }); setEditingField(null); }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { const v = parseFloat(editingField.value.replace(',', '.')); if (!isNaN(v)) updateLine.mutate({ id: l.id, amount: v }); setEditingField(null); }
                                        if (e.key === 'Escape') setEditingField(null);
                                      }}
                                      data-testid={`input-inline-amount-${l.id}`}
                                    />
                                  ) : (
                                    <span
                                      className={p.status === 'entwurf' ? 'cursor-pointer hover:underline decoration-dashed underline-offset-2' : ''}
                                      title={p.status === 'entwurf' ? 'Klicken zum Bearbeiten' : undefined}
                                      onClick={p.status === 'entwurf' ? () => setEditingField({ lineId: l.id, field: 'amount', value: String(l.amount) }) : undefined}
                                      data-testid={`text-amount-${l.id}`}
                                    >
                                      {fmt(l.amount)}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {p.status === 'entwurf' ? (
                                    <Select
                                      value={l.allocation_key || 'mea'}
                                      onValueChange={v => updateLine.mutate({ id: l.id, allocation_key: v })}
                                    >
                                      <SelectTrigger className="h-7 w-36 text-xs" data-testid={`select-alloc-key-${l.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="mea">MEA-Anteil</SelectItem>
                                        <SelectItem value="nutzwert">Nutzwert</SelectItem>
                                        <SelectItem value="nutzflaeche">Nutzfl\u00E4che</SelectItem>
                                        <SelectItem value="einheiten">pro Einheit</SelectItem>
                                        <SelectItem value="verbrauch">Verbrauch</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span>{allocationKeyLabels[l.allocation_key] || l.allocation_key}</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">{l.ust_rate} %</TableCell>
                                {p.status === 'entwurf' && (
                                  <TableCell>
                                    <Button variant="ghost" size="icon" onClick={() => deleteLine.mutate(l.id)} data-testid={`button-delete-line-${l.id}`}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TableCell>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="flex justify-between flex-wrap gap-2 text-sm px-4 py-2 border-t">
                          <span>Summe Positionen: <strong data-testid={`text-lines-total-${p.id}`}>{fmt(linesTotal)}</strong></span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Keine Positionen vorhanden.</p>
                    )
                  )}

                  {showPreview && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-1">
                        <Eye className="h-4 w-4" /> Verteilungsvorschau
                      </h4>
                      {previewLoading ? <LoadingSpinner /> : previewData && previewData.distributions.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Einheit (TOP)</TableHead>
                              <TableHead>Eigent\u00FCmer</TableHead>
                              <TableHead className="text-right">MEA-Anteil</TableHead>
                              <TableHead className="text-right">BK/Monat</TableHead>
                              <TableHead className="text-right">HK/Monat</TableHead>
                              <TableHead className="text-right">R\u00FCcklage/Monat</TableHead>
                              <TableHead className="text-right">Verwaltung/Monat</TableHead>
                              <TableHead className="text-right">Gesamt/Monat</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewData.distributions.map(d => (
                              <TableRow key={d.unit_owner_id} data-testid={`row-preview-${d.unit_owner_id}`}>
                                <TableCell className="font-medium">{d.unit_top}</TableCell>
                                <TableCell>{d.owner_name}</TableCell>
                                <TableCell className="text-right">{fmtPct(d.mea_share)}</TableCell>
                                <TableCell className="text-right">{fmt((d.bk_netto_jahr + d.bk_ust_jahr) / 12)}</TableCell>
                                <TableCell className="text-right">{fmt((d.hk_netto_jahr + d.hk_ust_jahr) / 12)}</TableCell>
                                <TableCell className="text-right">{fmt(d.ruecklage_jahr / 12)}</TableCell>
                                <TableCell className="text-right">{fmt((d.verwaltung_netto_jahr + d.verwaltung_ust_jahr) / 12)}</TableCell>
                                <TableCell className="text-right font-medium">{fmt(d.monats_total)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">Keine Verteilungsdaten verf\u00FCgbar.</p>
                      )}
                    </div>
                  )}

                  {showVorschreibungen && p.status === 'aktiv' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold flex items-center gap-1">
                          <Send className="h-4 w-4" /> Vorschreibungen
                        </h4>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-send-vorschreibungen-${p.id}`}
                          disabled={sendVorschreibungen.isPending}
                          onClick={() => sendVorschreibungen.mutate(p.id)}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          {sendVorschreibungen.isPending ? 'Wird versendet…' : 'Per E-Mail versenden'}
                        </Button>
                      </div>
                      {p.activated_at && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                          Aktiviert am {fmtDate(p.activated_at)}
                        </p>
                      )}
                      {vorschreibungenLoading ? <LoadingSpinner /> : vorschreibungen.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Monat</TableHead>
                              <TableHead>Einheit</TableHead>
                              <TableHead>Eigent\u00FCmer</TableHead>
                              <TableHead className="text-right">BK</TableHead>
                              <TableHead className="text-right">HK</TableHead>
                              <TableHead className="text-right">USt</TableHead>
                              <TableHead className="text-right">Gesamt</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>F\u00E4llig am</TableHead>
                              <TableHead>Versendet</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {vorschreibungen.map(v => {
                              const monthNames = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
                              return (
                                <TableRow key={v.id} data-testid={`row-vorschreibung-${v.id}`}>
                                  <TableCell>{monthNames[v.month - 1]} {v.year}</TableCell>
                                  <TableCell>Top {v.unit_top || '\u2014'}</TableCell>
                                  <TableCell>{v.owner_name || '\u2014'}</TableCell>
                                  <TableCell className="text-right">{fmt(v.betriebskosten)}</TableCell>
                                  <TableCell className="text-right">{fmt(v.heizungskosten)}</TableCell>
                                  <TableCell className="text-right">{fmt(v.ust)}</TableCell>
                                  <TableCell className="text-right font-medium">{fmt(v.gesamtbetrag)}</TableCell>
                                  <TableCell><Badge variant="outline">{v.status}</Badge></TableCell>
                                  <TableCell>{fmtDate(v.faellig_am)}</TableCell>
                                  <TableCell className="text-sm whitespace-nowrap">
                                    {v.last_sent_at ? (
                                      <span className="text-green-700 font-medium">
                                        Versendet am {new Date(v.last_sent_at).toLocaleDateString('de-AT')}
                                      </span>
                                    ) : (
                                      <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-200">
                                        Noch nicht versendet
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Button variant="ghost" size="icon" data-testid={`button-download-vorschreibung-${v.id}`} onClick={() => {
                                      const bk = Number(v.betriebskosten) || 0;
                                      const hk = Number(v.heizungskosten) || 0;
                                      downloadWegVorschreibungPdf({
                                        ownerName: v.owner_name || 'Eigentümer',
                                        propertyName: selectedProp?.name || '',
                                        propertyAddress: selectedProp?.address || '',
                                        propertyCity: `${selectedProp?.postalCode || ''} ${selectedProp?.city || ''}`,
                                        unitTop: v.unit_top || '',
                                        unitType: v.unit_type || 'wohnung',
                                        month: v.month,
                                        year: v.year,
                                        bkNetto: bk,
                                        bkUstRate: v.ust_satz_bk || 10,
                                        hkNetto: hk,
                                        hkUstRate: v.ust_satz_heizung || 20,
                                        ruecklage: 0,
                                        verwaltungNetto: 0,
                                        verwaltungUstRate: 20,
                                        sonstigesNetto: 0,
                                        gesamtBrutto: Number(v.gesamtbetrag) || 0,
                                        faelligAm: v.faellig_am || '',
                                      });
                                    }}>
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">Keine Vorschreibungen vorhanden.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Wirtschaftsplan</DialogTitle>
            <DialogDescription>Erstellen Sie einen Wirtschaftsplan gem\u00E4\u00DF \u00A7 31 WEG.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Jahr</Label>
              <Input type="number" value={bYear} onChange={e => setBYear(e.target.value)} data-testid="input-budget-year" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Verwaltungshonorar (\u20AC)</Label>
                <Input value={bManagementFee} onChange={e => setBManagementFee(e.target.value)} placeholder="0,00" data-testid="input-budget-management-fee" />
              </div>
              <div className="space-y-2">
                <Label>R\u00FCcklagenbeitrag (\u20AC)</Label>
                <Input value={bReserve} onChange={e => setBReserve(e.target.value)} placeholder="0,00" data-testid="input-budget-reserve" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>F\u00E4lligkeitstag</Label>
              <Input type="number" min="1" max="28" value={bDueDay} onChange={e => setBDueDay(e.target.value)} data-testid="input-budget-due-day" />
            </div>
            <div className="space-y-2">
              <Label>Anmerkungen</Label>
              <Textarea value={bNotes} onChange={e => setBNotes(e.target.value)} data-testid="input-budget-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-budget">Abbrechen</Button>
            <Button onClick={handleCreatePlan} disabled={!bYear || createPlan.isPending} data-testid="button-save-budget">
              {createPlan.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Budgetposition hinzuf\u00FCgen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Kategorie</Label>
              <Select value={lCategory} onValueChange={setLCategory}>
                <SelectTrigger data-testid="select-line-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {budgetCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Input value={lDesc} onChange={e => setLDesc(e.target.value)} data-testid="input-line-description" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Betrag (\u20AC)</Label>
                <Input value={lAmount} onChange={e => setLAmount(e.target.value)} placeholder="0,00" data-testid="input-line-amount" />
              </div>
              <div className="space-y-2">
                <Label>Verteilschl\u00FCssel</Label>
                <Select value={lKey} onValueChange={setLKey}>
                  <SelectTrigger data-testid="select-line-key"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mea">MEA-Anteil</SelectItem>
                    <SelectItem value="nutzwert">Nutzwert</SelectItem>
                    <SelectItem value="nutzflaeche">Nutzfl\u00E4che</SelectItem>
                    <SelectItem value="einheiten">pro Einheit</SelectItem>
                    <SelectItem value="verbrauch">Verbrauch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>USt-Satz</Label>
                <Select value={lUstRate} onValueChange={setLUstRate}>
                  <SelectTrigger data-testid="select-line-ust"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0 %</SelectItem>
                    <SelectItem value="10">10 %</SelectItem>
                    <SelectItem value="20">20 %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineDialogOpen(false)} data-testid="button-cancel-line">Abbrechen</Button>
            <Button onClick={handleCreateLine} disabled={!lAmount || createLine.isPending} data-testid="button-save-line">
              {createLine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Hinzuf\u00FCgen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wirtschaftsplan aktivieren</DialogTitle>
            <DialogDescription>M\u00F6chten Sie den Wirtschaftsplan aktivieren und Vorschreibungen generieren?</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-md border">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Achtung</p>
                <p className="text-muted-foreground">Es werden 12 monatliche Vorschreibungen f\u00FCr alle Eigent\u00FCmer generiert. Dieser Vorgang kann nicht r\u00FCckg\u00E4ngig gemacht werden.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActivateDialogOpen(false); setActivatePlanId(null); }} data-testid="button-cancel-activate">Abbrechen</Button>
            <Button onClick={handleActivate} disabled={activatePlan.isPending} data-testid="button-confirm-activate">
              {activatePlan.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Zap className="h-4 w-4 mr-2" /> Aktivieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReserveTab({ propertyId, orgId, properties }: { propertyId: string; orgId: string | null; properties: any[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rType, setRType] = useState('einzahlung');
  const [rYear, setRYear] = useState(String(new Date().getFullYear()));
  const [rMonth, setRMonth] = useState(String(new Date().getMonth() + 1));
  const [rAmount, setRAmount] = useState('');
  const [rDesc, setRDesc] = useState('');

  const { data: reserveEntries = [], isLoading } = useReserveFund(propertyId || undefined);
  const createReserve = useCreateReserveFundEntry();

  const reserveBalance = reserveEntries.reduce((sum, e) => sum + (e.entry_type === 'einzahlung' ? e.amount : -e.amount), 0);

  const handleCreate = async () => {
    await createReserve.mutateAsync({
      organization_id: orgId,
      property_id: propertyId,
      year: parseInt(rYear),
      month: parseInt(rMonth),
      amount: parseFloat(rAmount.replace(',', '.')) || 0,
      description: rDesc || null,
      entry_type: rType as 'einzahlung' | 'entnahme',
    });
    setDialogOpen(false);
    setRAmount(''); setRDesc('');
  };

  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Ruecklage verwalten"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um die Ruecklage (§31 WEG) einzusehen und zu verwalten."
    steps={["WEG-Liegenschaft oben auswaehlen", "Ruecklagebuchungen pruefen", "Mindest-Ruecklage (0,90 EUR/m2) kontrollieren"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <Card>
          <CardContent className="py-4 px-6">
            <p className="text-sm text-muted-foreground">Aktuelle Instandhaltungsr\u00FCcklage (\u00A7 31 WEG)</p>
            <p className={`text-3xl font-bold ${reserveBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`} data-testid="text-reserve-balance">
              {fmt(reserveBalance)}
            </p>
          </CardContent>
        </Card>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-reserve">
          <Plus className="h-4 w-4 mr-2" /> Buchung erfassen
        </Button>
      </div>

      {isLoading ? <LoadingSpinner /> : reserveEntries.length === 0 ? (
        <EmptyState icon={PiggyBank} text="Noch keine R\u00FCcklagebuchungen vorhanden." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zeitraum</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reserveEntries.map(e => (
              <TableRow key={e.id} data-testid={`row-reserve-${e.id}`}>
                <TableCell>{String(e.month).padStart(2, '0')}/{e.year}</TableCell>
                <TableCell>{e.description || '\u2014'}</TableCell>
                <TableCell>
                  <Badge className={e.entry_type === 'einzahlung'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  }>
                    {e.entry_type === 'einzahlung' ? <ArrowUpCircle className="h-3 w-3 mr-1" /> : <ArrowDownCircle className="h-3 w-3 mr-1" />}
                    {e.entry_type === 'einzahlung' ? 'Einzahlung' : 'Entnahme'}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right font-medium ${e.entry_type === 'einzahlung' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                  {e.entry_type === 'einzahlung' ? '+' : '-'}{fmt(e.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>R\u00FCcklage-Buchung</DialogTitle>
            <DialogDescription>Erfassen Sie eine Ein- oder Auszahlung der Instandhaltungsr\u00FCcklage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Typ</Label>
              <Select value={rType} onValueChange={setRType}>
                <SelectTrigger data-testid="select-reserve-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="einzahlung">Einzahlung</SelectItem>
                  <SelectItem value="entnahme">Entnahme</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Jahr</Label>
                <Input type="number" value={rYear} onChange={e => setRYear(e.target.value)} data-testid="input-reserve-year" />
              </div>
              <div className="space-y-2">
                <Label>Monat</Label>
                <Input type="number" min="1" max="12" value={rMonth} onChange={e => setRMonth(e.target.value)} data-testid="input-reserve-month" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Betrag (\u20AC)</Label>
              <Input value={rAmount} onChange={e => setRAmount(e.target.value)} placeholder="0,00" data-testid="input-reserve-amount" />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Input value={rDesc} onChange={e => setRDesc(e.target.value)} data-testid="input-reserve-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-reserve">Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!rAmount || createReserve.isPending} data-testid="button-save-reserve">
              {createReserve.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MaintenanceTab({ propertyId, orgId }: { propertyId: string; orgId: string | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mTitle, setMTitle] = useState('');
  const [mDesc, setMDesc] = useState('');
  const [mCategory, setMCategory] = useState<string>('ordentliche_verwaltung');
  const [mPriority, setMPriority] = useState<string>('normal');
  const [mEstCost, setMEstCost] = useState('');
  const [mFinancing, setMFinancing] = useState<string>('ruecklage');
  const [mContractorName, setMContractorName] = useState('');
  const [mContractorContact, setMContractorContact] = useState('');

  const { data: items = [], isLoading } = useWegMaintenance(propertyId || undefined);
  const createMaintenance = useCreateWegMaintenance();
  const updateMaintenance = useUpdateWegMaintenance();
  const deleteMaintenance = useDeleteWegMaintenance();

  const statusFlow: Record<string, string> = {
    geplant: 'beauftragt',
    beauftragt: 'in_ausfuehrung',
    in_ausfuehrung: 'abgeschlossen',
  };
  const statusFlowLabel: Record<string, string> = {
    geplant: 'Beauftragen',
    beauftragt: 'In Ausf\u00FChrung',
    in_ausfuehrung: 'Abschlie\u00DFen',
  };

  const handleCreate = async () => {
    await createMaintenance.mutateAsync({
      organization_id: orgId,
      property_id: propertyId,
      title: mTitle,
      description: mDesc || null,
      category: mCategory,
      priority: mPriority,
      estimated_cost: mEstCost ? parseFloat(mEstCost.replace(',', '.')) : null,
      actual_cost: null,
      financing_source: mFinancing,
      special_assessment_id: null,
      approved_by_vote_id: null,
      status: 'geplant',
      start_date: null,
      completion_date: null,
      contractor_name: mContractorName || null,
      contractor_contact: mContractorContact || null,
      notes: null,
    });
    setDialogOpen(false);
    setMTitle(''); setMDesc(''); setMCategory('ordentliche_verwaltung'); setMPriority('normal');
    setMEstCost(''); setMFinancing('ruecklage'); setMContractorName(''); setMContractorContact('');
  };

  if (!propertyId) return <GuidedEmptyState
    icon={Building2}
    title="Erhaltungsmassnahmen"
    description="Waehlen Sie oben eine WEG-Liegenschaft aus, um Erhaltungs- und Instandhaltungsmassnahmen zu dokumentieren."
    steps={["WEG-Liegenschaft oben auswaehlen", "Massnahmen erfassen", "Kosten und Fortschritt dokumentieren"]}
    actionLabel="Liegenschaften anzeigen"
    actionHref="/liegenschaften"
  />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-maintenance">
          <Plus className="h-4 w-4 mr-2" /> Neue Ma\u00DFnahme
        </Button>
      </div>

      {isLoading ? <LoadingSpinner /> : items.length === 0 ? (
        <EmptyState icon={Wrench} text="Noch keine Erhaltungsma\u00DFnahmen vorhanden." />
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <Card key={item.id} data-testid={`card-maintenance-${item.id}`}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="space-y-1">
                    <h4 className="font-medium flex items-center gap-2">
                      <Wrench className="h-4 w-4" /> {item.title}
                    </h4>
                    {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <Badge className={
                        item.category === 'notmassnahme'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : item.category === 'ausserordentliche_verwaltung'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      }>
                        {maintenanceCategoryLabels[item.category]}
                      </Badge>
                      <PriorityBadge priority={item.priority} />
                      <StatusBadge status={item.status} labels={maintenanceStatusLabels} />
                      <Badge variant="outline">{financingLabels[item.financing_source]}</Badge>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-2 flex-wrap">
                      {item.estimated_cost != null && <span>Gesch\u00E4tzt: {fmt(item.estimated_cost)}</span>}
                      {item.actual_cost != null && <span>Tats\u00E4chlich: {fmt(item.actual_cost)}</span>}
                      {item.contractor_name && <span>Auftragnehmer: {item.contractor_name}</span>}
                      {item.start_date && <span>Beginn: {fmtDate(item.start_date)}</span>}
                      {item.completion_date && <span>Abschluss: {fmtDate(item.completion_date)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusFlow[item.status] && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => updateMaintenance.mutate({ id: item.id, status: statusFlow[item.status] } as any)}
                        data-testid={`button-advance-maintenance-${item.id}`}
                      >
                        <ChevronRight className="h-3 w-3 mr-1" /> {statusFlowLabel[item.status]}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteMaintenance.mutate(item.id)} data-testid={`button-delete-maintenance-${item.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Erhaltungsma\u00DFnahme</DialogTitle>
            <DialogDescription>Erfassen Sie eine Ma\u00DFnahme gem\u00E4\u00DF \u00A7 28-29 WEG.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Titel</Label>
              <Input value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="z.B. Fassadensanierung" data-testid="input-maintenance-title" />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Textarea value={mDesc} onChange={e => setMDesc(e.target.value)} data-testid="input-maintenance-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select value={mCategory} onValueChange={setMCategory}>
                  <SelectTrigger data-testid="select-maintenance-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ordentliche_verwaltung">Ordentliche Verwaltung</SelectItem>
                    <SelectItem value="ausserordentliche_verwaltung">Au\u00DFerordentliche Verwaltung</SelectItem>
                    <SelectItem value="notmassnahme">Notma\u00DFnahme</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priorit\u00E4t</Label>
                <Select value={mPriority} onValueChange={setMPriority}>
                  <SelectTrigger data-testid="select-maintenance-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="niedrig">Niedrig</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="hoch">Hoch</SelectItem>
                    <SelectItem value="dringend">Dringend</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gesch\u00E4tzte Kosten (\u20AC)</Label>
                <Input value={mEstCost} onChange={e => setMEstCost(e.target.value)} placeholder="0,00" data-testid="input-maintenance-cost" />
              </div>
              <div className="space-y-2">
                <Label>Finanzierung</Label>
                <Select value={mFinancing} onValueChange={setMFinancing}>
                  <SelectTrigger data-testid="select-maintenance-financing"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ruecklage">R\u00FCcklage</SelectItem>
                    <SelectItem value="sonderumlage">Sonderumlage</SelectItem>
                    <SelectItem value="laufend">Laufend</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Auftragnehmer</Label>
                <Input value={mContractorName} onChange={e => setMContractorName(e.target.value)} placeholder="Firma" data-testid="input-contractor-name" />
              </div>
              <div className="space-y-2">
                <Label>Kontakt</Label>
                <Input value={mContractorContact} onChange={e => setMContractorContact(e.target.value)} placeholder="Tel/Email" data-testid="input-contractor-contact" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-maintenance">Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!mTitle || createMaintenance.isPending} data-testid="button-save-maintenance">
              {createMaintenance.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====== SONDERUMLAGE TAB ======

function SonderumlageTab({ propertyId }: { propertyId: string }) {
  const { data: assessments = [], isLoading } = useWegSpecialAssessments(propertyId);
  const createAssessment = useCreateWegSpecialAssessment();
  const createInvoices = useCreateSpecialAssessmentInvoices();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    totalAmount: '',
    allocationKey: 'mea',
    dueDate: '',
    creditsReserveFund: false,
  });

  function handleCreate() {
    if (!form.title || !form.totalAmount || !propertyId) return;
    createAssessment.mutate(
      {
        propertyId,
        title: form.title,
        description: form.description || undefined,
        totalAmount: form.totalAmount,
        allocationKey: form.allocationKey,
        dueDate: form.dueDate || undefined,
        creditsReserveFund: form.creditsReserveFund,
        status: 'beschlossen',
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setForm({ title: '', description: '', totalAmount: '', allocationKey: 'mea', dueDate: '', creditsReserveFund: false });
        },
      }
    );
  }

  const statusBadge = (status: string) => {
    if (status === 'beschlossen') return <Badge variant="outline" className="text-green-700 border-green-400">Beschlossen</Badge>;
    if (status === 'abgerechnet') return <Badge variant="outline" className="text-blue-700 border-blue-400">Abgerechnet</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  if (!propertyId) {
    return (
      <GuidedEmptyState
        icon={Receipt}
        title="Liegenschaft auswählen"
        description="Bitte wählen Sie zuerst eine Liegenschaft aus um Sonderumlagen zu verwalten."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="sonderumlage-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Sonderumlagen</h3>
          <p className="text-sm text-muted-foreground">
            Außerordentliche Kostenbeiträge der Eigentümer (§ 32 WEG 2002).
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-new-sonderumlage">
          <Plus className="h-4 w-4 mr-2" /> Neue Sonderumlage
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : assessments.length === 0 ? (
        <GuidedEmptyState
          icon={Receipt}
          title="Noch keine Sonderumlage"
          description="Legen Sie eine außerordentliche Sonderumlage an (z. B. Dachsanierung, Aufzugstausch)."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titel</TableHead>
                <TableHead className="text-right">Betrag gesamt</TableHead>
                <TableHead>Verteilung</TableHead>
                <TableHead>Rücklage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fälligkeit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.map((a: any) => (
                <TableRow key={a.id} data-testid={`sonderumlage-row-${a.id}`}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell className="text-right">{fmt(parseFloat(a.total_amount ?? a.totalAmount ?? '0'))}</TableCell>
                  <TableCell className="uppercase text-xs text-muted-foreground">{a.allocation_key ?? a.allocationKey ?? 'mea'}</TableCell>
                  <TableCell>
                    {(a.credits_reserve_fund ?? a.creditsReserveFund) ? (
                      <span className="flex items-center gap-1 text-xs text-green-700">
                        <CheckSquare className="h-3.5 w-3.5" /> Ja
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Nein</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.due_date ?? a.dueDate ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={a.status === 'abgerechnet' || createInvoices.isPending}
                      onClick={() => createInvoices.mutate(a.id)}
                      data-testid={`button-create-invoices-${a.id}`}
                    >
                      {createInvoices.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                      Vorschreibungen erstellen
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Sonderumlage</DialogTitle>
            <DialogDescription>
              Außerordentlicher Kostenbeitrag gem. § 32 WEG 2002. Nach dem Anlegen können Vorschreibungen für alle Eigentümer erstellt werden.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Titel *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="z. B. Dachsanierung 2026" data-testid="input-sonderumlage-title" />
            </div>
            <div>
              <Label>Beschreibung</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Gesamtbetrag (€) *</Label>
                <Input type="number" step="0.01" min="0" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} placeholder="0.00" data-testid="input-sonderumlage-amount" />
              </div>
              <div>
                <Label>Fälligkeit</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Verteilungsschlüssel</Label>
              {/* Derzeit wird ausschließlich MEA-Verteilung berechnet (§ 32 WEG 2002 Regelfall) */}
              <Select value={form.allocationKey} onValueChange={v => setForm(f => ({ ...f, allocationKey: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mea">MEA-Anteil (Standard, § 32 WEG 2002)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
              <input
                type="checkbox"
                id="creditsReserveFund"
                checked={form.creditsReserveFund}
                onChange={e => setForm(f => ({ ...f, creditsReserveFund: e.target.checked }))}
                className="h-4 w-4"
                data-testid="checkbox-credits-reserve-fund"
              />
              <label htmlFor="creditsReserveFund" className="text-sm cursor-pointer">
                <strong>Rücklage:</strong> Diese Sonderumlage schreibt in die Instandhaltungsrücklage (§ 31 WEG 2002)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!form.title || !form.totalAmount || createAssessment.isPending} data-testid="button-save-sonderumlage">
              {createAssessment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Sonderumlage anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
