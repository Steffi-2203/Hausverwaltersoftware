import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar as CalendarIcon, Plus, AlertCircle, CheckCircle, Clock, Loader2, Bell, Filter } from 'lucide-react';
import { useDeadlines, useCreateDeadline, useUpdateDeadline, getCategoryLabel, type Deadline } from '@/hooks/useDeadlines';
import { useProperties } from '@/hooks/useProperties';
import { useOrganization } from '@/hooks/useOrganization';
import { differenceInDays, format } from 'date-fns';
import { de } from 'date-fns/locale';

const categoryColors: Record<string, string> = {
  vertrag: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  versicherung: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  wartung: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  abrechnung: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  steuer: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  sonstiges: 'bg-muted text-muted-foreground',
};

const statusIcons: Record<string, React.ReactNode> = {
  offen: <Clock className="h-4 w-4 text-amber-500" />,
  erledigt: <CheckCircle className="h-4 w-4 text-green-500" />,
  uebersprungen: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
};

export default function DeadlineCalendar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('offen');

  // Form
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fDate, setFDate] = useState('');
  const [fCategory, setFCategory] = useState('sonstiges');
  const [fPropId, setFPropId] = useState('');
  const [fReminderDays, setFReminderDays] = useState('14');
  const [fRecurring, setFRecurring] = useState(false);
  const [fRecurrenceMonths, setFRecurrenceMonths] = useState('12');

  const { data: properties = [] } = useProperties();
  const { data: organization } = useOrganization();
  const { data: deadlines = [], isLoading } = useDeadlines({
    status: filterStatus === 'all' ? undefined : filterStatus,
    category: filterCategory === 'all' ? undefined : filterCategory,
  });

  const createDeadline = useCreateDeadline();
  const updateDeadline = useUpdateDeadline();

  const handleCreate = async () => {
    await createDeadline.mutateAsync({
      organization_id: organization?.id || null,
      property_id: fPropId || null,
      title: fTitle,
      description: fDesc || null,
      deadline_date: fDate,
      reminder_days: parseInt(fReminderDays) || 14,
      category: fCategory as Deadline['category'],
      source_type: null,
      source_id: null,
      is_recurring: fRecurring,
      recurrence_months: fRecurring ? parseInt(fRecurrenceMonths) || 12 : null,
      status: 'offen',
    });
    setDialogOpen(false);
    setFTitle(''); setFDesc(''); setFDate(''); setFCategory('sonstiges'); setFPropId('');
  };

  const today = new Date();
  const urgentDeadlines = deadlines.filter(d => {
    const daysLeft = differenceInDays(new Date(d.deadline_date), today);
    return d.status === 'offen' && daysLeft <= d.reminder_days && daysLeft >= 0;
  });

  const overdueDeadlines = deadlines.filter(d => {
    return d.status === 'offen' && new Date(d.deadline_date) < today;
  });

  const getPropertyName = (propId: string | null) => propId ? properties.find((p: any) => p.id === propId)?.name || '—' : 'Allgemein';

  return (
    <MainLayout title="Fristen & Termine" subtitle="Zentrale Fristenverwaltung mit Erinnerungen">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Fristen & Termine</h1>
            <p className="text-muted-foreground">Verträge, Versicherungen, Wartungen und Abrechnungsfristen</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Neue Frist
          </Button>
        </div>

        {/* Warnings */}
        {(overdueDeadlines.length > 0 || urgentDeadlines.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overdueDeadlines.length > 0 && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium text-sm">{overdueDeadlines.length} überfällige Frist(en)</span>
                  </div>
                  {overdueDeadlines.slice(0, 3).map(d => (
                    <p key={d.id} className="text-sm text-muted-foreground ml-6">{d.title} – fällig am {format(new Date(d.deadline_date), 'dd.MM.yyyy')}</p>
                  ))}
                </CardContent>
              </Card>
            )}
            {urgentDeadlines.length > 0 && (
              <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                    <Bell className="h-4 w-4" />
                    <span className="font-medium text-sm">{urgentDeadlines.length} Frist(en) bald fällig</span>
                  </div>
                  {urgentDeadlines.slice(0, 3).map(d => {
                    const daysLeft = differenceInDays(new Date(d.deadline_date), today);
                    return <p key={d.id} className="text-sm text-muted-foreground ml-6">{d.title} – noch {daysLeft} Tag(e)</p>;
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="offen">Offen</SelectItem>
              <SelectItem value="erledigt">Erledigt</SelectItem>
              <SelectItem value="uebersprungen">Übersprungen</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Kategorien</SelectItem>
              <SelectItem value="vertrag">Vertrag</SelectItem>
              <SelectItem value="versicherung">Versicherung</SelectItem>
              <SelectItem value="wartung">Wartung</SelectItem>
              <SelectItem value="abrechnung">Abrechnung</SelectItem>
              <SelectItem value="steuer">Steuer</SelectItem>
              <SelectItem value="sonstiges">Sonstiges</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : deadlines.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Keine Fristen gefunden.</p>
          </CardContent></Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Fällig am</TableHead>
                <TableHead>Titel</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Liegenschaft</TableHead>
                <TableHead>Erinnerung</TableHead>
                <TableHead>Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deadlines.map(d => {
                const daysLeft = differenceInDays(new Date(d.deadline_date), today);
                const isOverdue = d.status === 'offen' && daysLeft < 0;
                const isUrgent = d.status === 'offen' && daysLeft >= 0 && daysLeft <= d.reminder_days;

                return (
                  <TableRow key={d.id} className={isOverdue ? 'bg-destructive/5' : isUrgent ? 'bg-amber-50 dark:bg-amber-950/10' : ''}>
                    <TableCell>{statusIcons[d.status]}</TableCell>
                    <TableCell className={`font-medium ${isOverdue ? 'text-destructive' : ''}`}>
                      {format(new Date(d.deadline_date), 'dd.MM.yyyy')}
                      {isOverdue && <span className="text-xs ml-1">({Math.abs(daysLeft)}d überfällig)</span>}
                      {isUrgent && !isOverdue && <span className="text-xs ml-1 text-amber-600">({daysLeft}d)</span>}
                    </TableCell>
                    <TableCell>
                      <div>{d.title}</div>
                      {d.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{d.description}</p>}
                    </TableCell>
                    <TableCell><Badge className={categoryColors[d.category]}>{getCategoryLabel(d.category)}</Badge></TableCell>
                    <TableCell className="text-sm">{getPropertyName(d.property_id)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.reminder_days} Tage vorher</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {d.status === 'offen' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => updateDeadline.mutate({ id: d.id, status: 'erledigt' } as any)}>
                              Erledigt
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => updateDeadline.mutate({ id: d.id, status: 'uebersprungen' } as any)}>
                              Skip
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Neue Frist</DialogTitle><DialogDescription>Erstellen Sie eine Erinnerungsfrist.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Titel</Label><Input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="z.B. Versicherung verlängern" /></div>
            <div className="space-y-2"><Label>Beschreibung</Label><Input value={fDesc} onChange={e => setFDesc(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Fällig am</Label><Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>Erinnerung (Tage vorher)</Label><Input type="number" value={fReminderDays} onChange={e => setFReminderDays(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Kategorie</Label>
                <Select value={fCategory} onValueChange={setFCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="vertrag">Vertrag</SelectItem>
                  <SelectItem value="versicherung">Versicherung</SelectItem>
                  <SelectItem value="wartung">Wartung</SelectItem>
                  <SelectItem value="abrechnung">Abrechnung</SelectItem>
                  <SelectItem value="steuer">Steuer</SelectItem>
                  <SelectItem value="sonstiges">Sonstiges</SelectItem>
                </SelectContent></Select>
              </div>
              <div className="space-y-2"><Label>Liegenschaft (optional)</Label>
                <Select value={fPropId} onValueChange={setFPropId}><SelectTrigger><SelectValue placeholder="Alle" /></SelectTrigger><SelectContent>
                  {properties.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent></Select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={fRecurring} onCheckedChange={setFRecurring} />
                <Label>Wiederkehrend</Label>
              </div>
              {fRecurring && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">alle</Label>
                  <Input type="number" className="w-20" value={fRecurrenceMonths} onChange={e => setFRecurrenceMonths(e.target.value)} />
                  <Label className="text-sm">Monate</Label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleCreate} disabled={!fTitle || !fDate || createDeadline.isPending}>
              {createDeadline.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
