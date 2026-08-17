import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, Pencil, Trash2, Play, Clock, Mail, Calendar } from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import type { ReportSchedule } from '@shared/schema';

const REPORT_TYPE_LABELS: Record<string, string> = {
  saldenliste: 'Saldenliste',
  bilanz: 'Bilanz',
  guv: 'Gewinn- und Verlustrechnung',
  op_liste: 'Offene Posten',
  vacancy: 'Leerstandsbericht',
};

const SCHEDULE_PRESETS = [
  { label: 'Täglich', value: '0 8 * * *', description: 'Jeden Tag um 08:00' },
  { label: 'Wöchentlich', value: '0 8 * * 1', description: 'Jeden Montag um 08:00' },
  { label: 'Monatlich', value: '0 8 1 * *', description: 'Am 1. jeden Monats um 08:00' },
];

function describeCron(cron: string): string {
  const found = SCHEDULE_PRESETS.find(p => p.value === cron);
  if (found) return found.description;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    return `Am ${dayOfMonth}. jeden Monats um ${timeStr}`;
  }
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    return `Jeden ${days[parseInt(dayOfWeek)] || dayOfWeek} um ${timeStr}`;
  }
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    return `Täglich um ${timeStr}`;
  }
  return cron;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '–';
  return new Date(dateStr).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface ScheduleFormData {
  reportType: string;
  schedule: string;
  propertyId: string;
  recipients: string;
  isActive: boolean;
}

const defaultFormData: ScheduleFormData = {
  reportType: 'saldenliste',
  schedule: '0 8 1 * *',
  propertyId: '',
  recipients: '',
  isActive: true,
};

export default function ScheduledReports() {
  const { toast } = useToast();
  const { data: propertiesList } = useProperties();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ScheduleFormData>(defaultFormData);
  const [useCustomCron, setUseCustomCron] = useState(false);

  const { data: schedules, isLoading } = useQuery<ReportSchedule[]>({
    queryKey: ['/api/report-schedules'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/report-schedules', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      setDialogOpen(false);
      toast({ title: 'Zeitplan erstellt' });
    },
    onError: () => toast({ title: 'Fehler beim Erstellen', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PATCH', `/api/report-schedules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: 'Zeitplan aktualisiert' });
    },
    onError: () => toast({ title: 'Fehler beim Aktualisieren', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/report-schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      toast({ title: 'Zeitplan gelöscht' });
    },
    onError: () => toast({ title: 'Fehler beim Löschen', variant: 'destructive' }),
  });

  const runNowMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/report-schedules/${id}/run-now`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/report-schedules'] });
      toast({ title: 'Bericht wurde generiert und versendet' });
    },
    onError: () => toast({ title: 'Fehler beim Ausführen', variant: 'destructive' }),
  });

  function openCreateDialog() {
    setEditingId(null);
    setFormData(defaultFormData);
    setUseCustomCron(false);
    setDialogOpen(true);
  }

  function openEditDialog(schedule: ReportSchedule) {
    setEditingId(schedule.id);
    const isPreset = SCHEDULE_PRESETS.some(p => p.value === schedule.schedule);
    setUseCustomCron(!isPreset);
    setFormData({
      reportType: schedule.reportType,
      schedule: schedule.schedule,
      propertyId: schedule.propertyId || '',
      recipients: schedule.recipients.join(', '),
      isActive: schedule.isActive,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    const recipients = formData.recipients.split(',').map(e => e.trim()).filter(Boolean);
    if (recipients.length === 0) {
      toast({ title: 'Mindestens ein Empfänger erforderlich', variant: 'destructive' });
      return;
    }

    const payload = {
      reportType: formData.reportType,
      schedule: formData.schedule,
      propertyId: formData.propertyId || null,
      recipients,
      isActive: formData.isActive,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <MainLayout title="Geplante Berichte" subtitle="Automatische Berichterstellung und E-Mail-Versand">
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold" data-testid="text-page-title">Geplante Berichte</h2>
            <p className="text-sm text-muted-foreground">Konfigurieren Sie automatische Berichte per E-Mail</p>
          </div>
          <Button onClick={openCreateDialog} data-testid="button-new-schedule">
            <Plus className="mr-2 h-4 w-4" />
            Neuer Zeitplan
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Konfigurierte Zeitpläne
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8" data-testid="loading-schedules">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !schedules || schedules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-schedules">
                Noch keine Zeitpläne konfiguriert. Erstellen Sie einen neuen Zeitplan.
              </div>
            ) : (
              <Table data-testid="table-schedules">
                <TableHeader>
                  <TableRow>
                    <TableHead>Berichtstyp</TableHead>
                    <TableHead>Zeitplan</TableHead>
                    <TableHead>Empfänger</TableHead>
                    <TableHead>Letzte Ausführung</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => (
                    <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`}>
                      <TableCell data-testid={`text-report-type-${schedule.id}`}>
                        {REPORT_TYPE_LABELS[schedule.reportType] || schedule.reportType}
                      </TableCell>
                      <TableCell data-testid={`text-schedule-${schedule.id}`}>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{describeCron(schedule.schedule)}</span>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-recipients-${schedule.id}`}>
                        <div className="flex flex-wrap gap-1">
                          {schedule.recipients.map((email, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              <Mail className="mr-1 h-3 w-3" />
                              {email}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-last-run-${schedule.id}`}>
                        {formatDate(schedule.lastRun as any)}
                      </TableCell>
                      <TableCell data-testid={`text-status-${schedule.id}`}>
                        <Badge variant={schedule.isActive ? 'default' : 'secondary'}>
                          {schedule.isActive ? 'Aktiv' : 'Inaktiv'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditDialog(schedule)}
                            data-testid={`button-edit-${schedule.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => runNowMutation.mutate(schedule.id)}
                            disabled={runNowMutation.isPending}
                            data-testid={`button-run-now-${schedule.id}`}
                          >
                            {runNowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm('Zeitplan wirklich löschen?')) {
                                deleteMutation.mutate(schedule.id);
                              }
                            }}
                            data-testid={`button-delete-${schedule.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle data-testid="text-dialog-title">
                {editingId ? 'Zeitplan bearbeiten' : 'Neuer Zeitplan'}
              </DialogTitle>
              <DialogDescription>
                Konfigurieren Sie einen automatischen Berichtsversand per E-Mail.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="reportType">Berichtstyp</Label>
                <Select
                  value={formData.reportType}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, reportType: v }))}
                >
                  <SelectTrigger data-testid="select-report-type">
                    <SelectValue placeholder="Berichtstyp wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key} data-testid={`option-report-type-${key}`}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Liegenschaft (optional)</Label>
                <Select
                  value={formData.propertyId || '_none'}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, propertyId: v === '_none' ? '' : v }))}
                >
                  <SelectTrigger data-testid="select-property">
                    <SelectValue placeholder="Alle Liegenschaften" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Alle Liegenschaften</SelectItem>
                    {(propertiesList || []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id} data-testid={`option-property-${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Zeitplan</Label>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_PRESETS.map((preset) => (
                    <Button
                      key={preset.value}
                      variant={!useCustomCron && formData.schedule === preset.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setUseCustomCron(false);
                        setFormData(prev => ({ ...prev, schedule: preset.value }));
                      }}
                      data-testid={`button-preset-${preset.label.toLowerCase()}`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <Button
                    variant={useCustomCron ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setUseCustomCron(true)}
                    data-testid="button-preset-custom"
                  >
                    Benutzerdefiniert
                  </Button>
                </div>
                {useCustomCron && (
                  <div className="mt-2">
                    <Input
                      placeholder="z.B. 0 8 1 * * (Cron-Ausdruck)"
                      value={formData.schedule}
                      onChange={(e) => setFormData(prev => ({ ...prev, schedule: e.target.value }))}
                      data-testid="input-custom-cron"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Format: Minute Stunde Tag Monat Wochentag
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {describeCron(formData.schedule)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipients">Empfänger (kommagetrennt)</Label>
                <Input
                  id="recipients"
                  placeholder="email@beispiel.at, buchhaltung@beispiel.at"
                  value={formData.recipients}
                  onChange={(e) => setFormData(prev => ({ ...prev, recipients: e.target.value }))}
                  data-testid="input-recipients"
                />
              </div>

              {editingId && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.isActive}
                    onCheckedChange={(v) => setFormData(prev => ({ ...prev, isActive: v }))}
                    data-testid="switch-active"
                  />
                  <Label>Aktiv</Label>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Abbrechen
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-submit"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingId ? 'Speichern' : 'Erstellen'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
