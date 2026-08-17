import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Plus, Wrench, CheckCircle, Clock, Camera, MapPin } from "lucide-react";

const DAMAGE_CATEGORIES = [
  { value: 'sanitaer', label: 'Sanitär' },
  { value: 'elektrik', label: 'Elektrik' },
  { value: 'heizung', label: 'Heizung' },
  { value: 'fenster_tueren', label: 'Fenster & Türen' },
  { value: 'fassade', label: 'Fassade & Dach' },
  { value: 'boden', label: 'Boden & Wände' },
  { value: 'aufzug', label: 'Aufzug' },
  { value: 'schimmel', label: 'Schimmel & Feuchtigkeit' },
  { value: 'allgemeinflaeche', label: 'Allgemeinfläche' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

const URGENCY_LEVELS = [
  { value: 'niedrig', label: 'Niedrig', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  { value: 'normal', label: 'Normal', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  { value: 'hoch', label: 'Hoch', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  { value: 'notfall', label: 'Notfall', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  gemeldet: { label: 'Gemeldet', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  in_bearbeitung: { label: 'In Bearbeitung', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  behoben: { label: 'Behoben', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  abgelehnt: { label: 'Abgelehnt', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

export default function DamageReports() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('alle');

  const { data: reports = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/damage-reports', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'alle' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/damage-reports${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const { data: stats } = useQuery<any>({ queryKey: ['/api/damage-reports/stats'] });

  const { data: properties = [] } = useQuery<any[]>({ queryKey: ['/api/properties'] });

  const createReport = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/damage-reports', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/damage-reports'] });
      queryClient.invalidateQueries({ queryKey: ['/api/damage-reports/stats'] });
      setCreateOpen(false);
      toast({ title: "Schadensmeldung erstellt" });
    },
    onError: () => toast({ title: "Fehler", description: "Konnte nicht erstellt werden", variant: "destructive" }),
  });

  const updateReport = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest('PATCH', `/api/damage-reports/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/damage-reports'] });
      queryClient.invalidateQueries({ queryKey: ['/api/damage-reports/stats'] });
      setSelectedReport(null);
      toast({ title: "Schadensmeldung aktualisiert" });
    },
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createReport.mutate({
      propertyId: fd.get('propertyId') || null,
      category: fd.get('category'),
      urgency: fd.get('urgency'),
      title: fd.get('title'),
      description: fd.get('description'),
      location: fd.get('location') || null,
    });
  };

  return (
    <MainLayout title="Schadensmeldungen" subtitle="Schäden melden, verfolgen und beheben">
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-damage-title">Schadensmeldungen</h1>
            <p className="text-muted-foreground">Schäden melden, verfolgen und beheben</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-damage-report"><Plus className="h-4 w-4 mr-2" />Neuer Schaden</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Schadensmeldung erstellen</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>Titel</Label>
                  <Input name="title" required placeholder="Kurze Beschreibung des Schadens" data-testid="input-damage-title" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Kategorie</Label>
                    <select name="category" required className="w-full border rounded-md p-2 bg-background" data-testid="select-damage-category">
                      {DAMAGE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Dringlichkeit</Label>
                    <select name="urgency" required className="w-full border rounded-md p-2 bg-background" data-testid="select-damage-urgency">
                      {URGENCY_LEVELS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Liegenschaft</Label>
                  <select name="propertyId" className="w-full border rounded-md p-2 bg-background">
                    <option value="">Optional auswählen...</option>
                    {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Ort / Lage</Label>
                  <Input name="location" placeholder="z.B. Badezimmer, 3. OG links" data-testid="input-damage-location" />
                </div>
                <div className="space-y-2">
                  <Label>Beschreibung</Label>
                  <Textarea name="description" required rows={4} placeholder="Beschreiben Sie den Schaden detailliert..." data-testid="input-damage-description" />
                </div>
                <Button type="submit" className="w-full" disabled={createReport.isPending} data-testid="button-submit-damage-report">
                  {createReport.isPending ? "Wird erstellt..." : "Schadensmeldung absenden"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gesamt</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-damage-total">{stats?.total ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Offen</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500" data-testid="text-damage-open">{stats?.open ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Behoben</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500" data-testid="text-damage-resolved">{stats?.resolved ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Bearbeitung</CardTitle>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats?.byStatus?.find((s: any) => s.status === 'in_bearbeitung')?.count ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm">Filter:</Label>
          {['alle', 'gemeldet', 'in_bearbeitung', 'behoben', 'abgelehnt'].map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s}`}
            >
              {s === 'alle' ? 'Alle' : STATUS_MAP[s]?.label ?? s}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Laden...</CardContent></Card>
        ) : reports.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Keine Schadensmeldungen vorhanden.</CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {reports.map((report: any) => {
              const statusInfo = STATUS_MAP[report.status] ?? { label: report.status, color: '' };
              const urgencyInfo = URGENCY_LEVELS.find(u => u.value === report.urgency);
              const categoryInfo = DAMAGE_CATEGORIES.find(c => c.value === report.category);

              return (
                <Card key={report.id} className="hover-elevate cursor-pointer" onClick={() => setSelectedReport(report)}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${report.urgency === 'notfall' ? 'text-red-500' : report.urgency === 'hoch' ? 'text-orange-500' : 'text-muted-foreground'}`} />
                      <div className="min-w-0">
                        <div className="font-medium flex flex-wrap items-center gap-2">
                          <span>{report.title}</span>
                          <Badge variant="outline" className="text-xs">{report.reportNumber}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {categoryInfo?.label ?? report.category}
                          {report.location && <span className="ml-2"><MapPin className="h-3 w-3 inline" /> {report.location}</span>}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{report.description}</p>
                        <div className="text-xs text-muted-foreground mt-1">
                          Erstellt: {new Date(report.createdAt).toLocaleDateString('de-AT')}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={urgencyInfo?.color ?? ''}>{urgencyInfo?.label ?? report.urgency}</Badge>
                      <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedReport?.title}
                <Badge variant="outline" className="ml-2 text-xs">{selectedReport?.reportNumber}</Badge>
              </DialogTitle>
            </DialogHeader>
            {selectedReport && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={URGENCY_LEVELS.find(u => u.value === selectedReport.urgency)?.color ?? ''}>
                    {URGENCY_LEVELS.find(u => u.value === selectedReport.urgency)?.label ?? selectedReport.urgency}
                  </Badge>
                  <Badge className={STATUS_MAP[selectedReport.status]?.color ?? ''}>
                    {STATUS_MAP[selectedReport.status]?.label ?? selectedReport.status}
                  </Badge>
                  <Badge variant="outline">{DAMAGE_CATEGORIES.find(c => c.value === selectedReport.category)?.label ?? selectedReport.category}</Badge>
                </div>

                {selectedReport.location && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4" /> {selectedReport.location}
                  </div>
                )}

                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-sm whitespace-pre-wrap">{selectedReport.description}</p>
                </div>

                {selectedReport.resolution && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md">
                    <Label className="text-xs font-medium">Lösung:</Label>
                    <p className="text-sm mt-1">{selectedReport.resolution}</p>
                  </div>
                )}

                <div className="border-t pt-4 space-y-3">
                  <Label className="text-sm font-medium">Status aktualisieren</Label>
                  <div className="flex flex-wrap gap-2">
                    {['gemeldet', 'in_bearbeitung', 'behoben', 'abgelehnt'].map(s => (
                      <Button
                        key={s}
                        variant={selectedReport.status === s ? "default" : "outline"}
                        size="sm"
                        onClick={() => updateReport.mutate({ id: selectedReport.id, data: { status: s } })}
                        disabled={updateReport.isPending}
                        data-testid={`button-status-${s}`}
                      >
                        {STATUS_MAP[s]?.label ?? s}
                      </Button>
                    ))}
                  </div>
                </div>

                {selectedReport.status !== 'behoben' && (
                  <div className="space-y-2">
                    <Label className="text-sm">Lösung dokumentieren</Label>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      updateReport.mutate({
                        id: selectedReport.id,
                        data: {
                          status: 'behoben',
                          resolution: fd.get('resolution'),
                          actualCost: fd.get('actualCost') || null,
                        },
                      });
                    }}>
                      <Textarea name="resolution" placeholder="Wie wurde der Schaden behoben?" rows={3} className="mb-2" />
                      <div className="flex gap-2">
                        <Input name="actualCost" type="number" step="0.01" placeholder="Tatsächliche Kosten (EUR)" className="flex-1" />
                        <Button type="submit" disabled={updateReport.isPending} data-testid="button-resolve-damage">
                          Als behoben markieren
                        </Button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
