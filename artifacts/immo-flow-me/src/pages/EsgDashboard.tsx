import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Leaf, Zap, Thermometer, Plus, Trash2, BarChart3, Award, AlertTriangle } from "lucide-react";
import { EsgScoreChart } from '@/components/charts/FinanceChart';

const ENERGY_CLASSES = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ENERGY_TYPES = [
  { value: 'strom', label: 'Strom' },
  { value: 'gas', label: 'Gas' },
  { value: 'fernwaerme', label: 'Fernwärme' },
  { value: 'heizoel', label: 'Heizöl' },
  { value: 'pellets', label: 'Pellets' },
  { value: 'wasser', label: 'Wasser' },
  { value: 'photovoltaik', label: 'Photovoltaik' },
];
const CERT_TYPES = [
  { value: 'HWB', label: 'Heizwärmebedarf (HWB)' },
  { value: 'fGEE', label: 'Gesamtenergieeffizienz (fGEE)' },
  { value: 'PEB', label: 'Primärenergiebedarf (PEB)' },
  { value: 'CO2', label: 'CO2-Emissionen' },
];
const CONSUMPTION_UNITS = [
  { value: 'kWh', label: 'kWh' },
  { value: 'MWh', label: 'MWh' },
  { value: 'm3', label: 'm\u00B3' },
  { value: 'l', label: 'Liter' },
  { value: 'kg', label: 'kg' },
];

function getClassColor(energyClass: string | null): string {
  switch (energyClass) {
    case 'A++': case 'A+': return 'bg-green-600 text-white';
    case 'A': return 'bg-green-500 text-white';
    case 'B': return 'bg-lime-500 text-white';
    case 'C': return 'bg-yellow-500 text-black';
    case 'D': return 'bg-orange-400 text-black';
    case 'E': return 'bg-orange-500 text-white';
    case 'F': return 'bg-red-400 text-white';
    case 'G': return 'bg-red-600 text-white';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default function EsgDashboard() {
  const { toast } = useToast();
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [consumptionDialogOpen, setConsumptionDialogOpen] = useState(false);

  const { data: dashboard, isLoading } = useQuery<any>({ queryKey: ['/api/esg/dashboard'] });
  const { data: certificates = [] } = useQuery<any[]>({ queryKey: ['/api/esg/certificates'] });
  const { data: consumption = [] } = useQuery<any[]>({ queryKey: ['/api/esg/consumption'] });

  const createCert = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/esg/certificates', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/esg/certificates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/esg/dashboard'] });
      setCertDialogOpen(false);
      toast({ title: "Energieausweis hinzugefügt" });
    },
    onError: () => toast({ title: "Fehler", description: "Konnte nicht gespeichert werden", variant: "destructive" }),
  });

  const deleteCert = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/esg/certificates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/esg/certificates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/esg/dashboard'] });
    },
  });

  const createConsumption = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/esg/consumption', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/esg/consumption'] });
      queryClient.invalidateQueries({ queryKey: ['/api/esg/dashboard'] });
      setConsumptionDialogOpen(false);
      toast({ title: "Verbrauchsdaten gespeichert" });
    },
    onError: () => toast({ title: "Fehler", description: "Konnte nicht gespeichert werden", variant: "destructive" }),
  });

  const deleteConsumption = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/esg/consumption/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/esg/consumption'] });
      queryClient.invalidateQueries({ queryKey: ['/api/esg/dashboard'] });
    },
  });

  const handleCertSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createCert.mutate({
      propertyId: fd.get('propertyId'),
      certificateType: fd.get('certificateType'),
      energyClass: fd.get('energyClass') || null,
      heatingDemand: fd.get('heatingDemand') || null,
      primaryEnergyDemand: fd.get('primaryEnergyDemand') || null,
      co2Emissions: fd.get('co2Emissions') || null,
      validFrom: fd.get('validFrom') || null,
      validUntil: fd.get('validUntil') || null,
      issuer: fd.get('issuer') || null,
      certificateNumber: fd.get('certificateNumber') || null,
    });
  };

  const handleConsumptionSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createConsumption.mutate({
      propertyId: fd.get('propertyId'),
      year: fd.get('year'),
      month: fd.get('month') || null,
      energyType: fd.get('energyType'),
      consumption: fd.get('consumption'),
      unit: fd.get('unit'),
      costEur: fd.get('costEur') || null,
      co2Kg: fd.get('co2Kg') || null,
      source: fd.get('source') || null,
    });
  };

  const esgScore = dashboard?.esgScore ?? 0;
  const properties = dashboard?.properties ?? [];

  return (
    <MainLayout title="ESG & Energiemonitoring" subtitle="Energieverbrauch, CO2-Bilanz und Energieausweise">
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-esg-title">ESG & Energiemonitoring</h1>
            <p className="text-muted-foreground">Energieverbrauch, CO2-Bilanz und Energieausweise verwalten</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ESG-Score</CardTitle>
              <Award className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <EsgScoreChart score={esgScore} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Energieausweise</CardTitle>
              <Leaf className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-cert-count">{dashboard?.certificates?.total ?? 0}</div>
              <p className="text-xs text-muted-foreground">
                {dashboard?.certificates?.active ?? 0} aktiv, {dashboard?.certificates?.expired ?? 0} abgelaufen
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Verbrauchsdaten</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-consumption-types">
                {dashboard?.consumptionCurrent?.length ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Energiearten erfasst ({new Date().getFullYear()})</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Liegenschaften</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard?.propertiesCount ?? 0}</div>
              <p className="text-xs text-muted-foreground">im ESG-Monitoring</p>
            </CardContent>
          </Card>
        </div>

        {(dashboard?.certificates?.expired ?? 0) > 0 && (
          <Card className="border-orange-300 dark:border-orange-700">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
              <p className="text-sm">
                <strong>{dashboard?.certificates?.expired}</strong> Energieausweis(e) abgelaufen. Bitte erneuern Sie diese zeitnah.
              </p>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="certificates">
          <TabsList>
            <TabsTrigger value="certificates" data-testid="tab-certificates">Energieausweise</TabsTrigger>
            <TabsTrigger value="consumption" data-testid="tab-consumption">Verbrauchsdaten</TabsTrigger>
            <TabsTrigger value="co2" data-testid="tab-co2">CO2-Bilanz</TabsTrigger>
          </TabsList>

          <TabsContent value="certificates" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={certDialogOpen} onOpenChange={setCertDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-certificate"><Plus className="h-4 w-4 mr-2" />Energieausweis hinzufügen</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>Neuer Energieausweis</DialogTitle></DialogHeader>
                  <form onSubmit={handleCertSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Liegenschaft</Label>
                      <select name="propertyId" required className="w-full border rounded-md p-2 bg-background">
                        <option value="">Bitte wählen...</option>
                        {properties.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Ausweistyp</Label>
                        <select name="certificateType" required className="w-full border rounded-md p-2 bg-background">
                          {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Energieklasse</Label>
                        <select name="energyClass" className="w-full border rounded-md p-2 bg-background">
                          <option value="">-</option>
                          {ENERGY_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>HWB (kWh/m2a)</Label>
                        <Input name="heatingDemand" type="number" step="0.01" />
                      </div>
                      <div className="space-y-2">
                        <Label>PEB (kWh/m2a)</Label>
                        <Input name="primaryEnergyDemand" type="number" step="0.01" />
                      </div>
                      <div className="space-y-2">
                        <Label>CO2 (kg/m2a)</Label>
                        <Input name="co2Emissions" type="number" step="0.01" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Gültig ab</Label>
                        <Input name="validFrom" type="date" />
                      </div>
                      <div className="space-y-2">
                        <Label>Gültig bis</Label>
                        <Input name="validUntil" type="date" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Aussteller</Label>
                        <Input name="issuer" />
                      </div>
                      <div className="space-y-2">
                        <Label>Ausweisnummer</Label>
                        <Input name="certificateNumber" />
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={createCert.isPending} data-testid="button-submit-certificate">
                      {createCert.isPending ? "Wird gespeichert..." : "Speichern"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {certificates.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Noch keine Energieausweise erfasst.</CardContent></Card>
            ) : (
              <div className="grid gap-3">
                {certificates.map((cert: any) => (
                  <Card key={cert.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex items-center gap-3">
                        <Thermometer className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div>
                          <div className="font-medium">{CERT_TYPES.find(t => t.value === cert.certificateType)?.label ?? cert.certificateType}</div>
                          <div className="text-sm text-muted-foreground">
                            {cert.issuer && `${cert.issuer} `}
                            {cert.certificateNumber && `Nr. ${cert.certificateNumber}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {cert.energyClass && (
                          <Badge className={getClassColor(cert.energyClass)}>{cert.energyClass}</Badge>
                        )}
                        {cert.heatingDemand && <Badge variant="outline">HWB: {cert.heatingDemand} kWh/m2a</Badge>}
                        {cert.validUntil && (
                          <Badge variant={new Date(cert.validUntil) < new Date() ? "destructive" : "outline"}>
                            bis {new Date(cert.validUntil).toLocaleDateString('de-AT')}
                          </Badge>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => deleteCert.mutate(cert.id)} data-testid={`button-delete-cert-${cert.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="consumption" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={consumptionDialogOpen} onOpenChange={setConsumptionDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-consumption"><Plus className="h-4 w-4 mr-2" />Verbrauch erfassen</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>Verbrauchsdaten erfassen</DialogTitle></DialogHeader>
                  <form onSubmit={handleConsumptionSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Liegenschaft</Label>
                      <select name="propertyId" required className="w-full border rounded-md p-2 bg-background">
                        <option value="">Bitte wählen...</option>
                        {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Jahr</Label>
                        <Input name="year" type="number" defaultValue={new Date().getFullYear()} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Monat (optional)</Label>
                        <select name="month" className="w-full border rounded-md p-2 bg-background">
                          <option value="">Jahresgesamt</option>
                          {Array.from({ length: 12 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('de-AT', { month: 'long' })}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Energieart</Label>
                        <select name="energyType" required className="w-full border rounded-md p-2 bg-background">
                          {ENERGY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Verbrauch</Label>
                        <Input name="consumption" type="number" step="0.01" required />
                      </div>
                      <div className="space-y-2">
                        <Label>Einheit</Label>
                        <select name="unit" required className="w-full border rounded-md p-2 bg-background">
                          {CONSUMPTION_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Kosten (EUR)</Label>
                        <Input name="costEur" type="number" step="0.01" />
                      </div>
                      <div className="space-y-2">
                        <Label>CO2 (kg)</Label>
                        <Input name="co2Kg" type="number" step="0.01" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Quelle</Label>
                      <Input name="source" placeholder="z.B. Rechnung Stadtwerke" />
                    </div>
                    <Button type="submit" className="w-full" disabled={createConsumption.isPending} data-testid="button-submit-consumption">
                      {createConsumption.isPending ? "Wird gespeichert..." : "Speichern"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {consumption.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Noch keine Verbrauchsdaten erfasst.</CardContent></Card>
            ) : (
              <div className="grid gap-3">
                {consumption.map((c: any) => (
                  <Card key={c.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex items-center gap-3">
                        <Zap className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div>
                          <div className="font-medium">
                            {ENERGY_TYPES.find(t => t.value === c.energyType)?.label ?? c.energyType}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {c.year}{c.month ? `/${String(c.month).padStart(2, '0')}` : ''} {c.source && `- ${c.source}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{c.consumption} {c.unit}</Badge>
                        {c.costEur && <Badge variant="outline">{parseFloat(c.costEur).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</Badge>}
                        {c.co2Kg && <Badge variant="outline">{c.co2Kg} kg CO2</Badge>}
                        <Button size="icon" variant="ghost" onClick={() => deleteConsumption.mutate(c.id)} data-testid={`button-delete-consumption-${c.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="co2" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>CO2-Bilanz {new Date().getFullYear()}</CardTitle></CardHeader>
              <CardContent>
                {(dashboard?.consumptionCurrent?.length ?? 0) === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Erfassen Sie Verbrauchsdaten mit CO2-Werten, um die Bilanz zu sehen.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {dashboard?.consumptionCurrent?.map((item: any, idx: number) => {
                      const prev = dashboard?.consumptionPrevious?.find((p: any) => p.energyType === item.energyType);
                      const co2Current = parseFloat(item.totalCo2 ?? '0');
                      const co2Prev = parseFloat(prev?.totalCo2 ?? '0');
                      const change = co2Prev > 0 ? ((co2Current - co2Prev) / co2Prev * 100) : 0;
                      return (
                        <div key={idx} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md bg-muted/50">
                          <div>
                            <div className="font-medium">{ENERGY_TYPES.find(t => t.value === item.energyType)?.label ?? item.energyType}</div>
                            <div className="text-sm text-muted-foreground">
                              Verbrauch: {parseFloat(item.totalConsumption ?? '0').toLocaleString('de-AT')}
                              {item.totalCost && ` | Kosten: ${parseFloat(item.totalCost).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {co2Current > 0 && <Badge variant="outline">{co2Current.toLocaleString('de-AT')} kg CO2</Badge>}
                            {change !== 0 && (
                              <Badge variant={change < 0 ? "default" : "destructive"}>
                                {change > 0 ? '+' : ''}{change.toFixed(1)}% gg. Vorjahr
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="border-t pt-4 mt-4">
                      <div className="flex justify-between items-center">
                        <span className="font-bold">Gesamt CO2</span>
                        <span className="font-bold text-lg">
                          {dashboard?.consumptionCurrent?.reduce((s: number, i: any) => s + parseFloat(i.totalCo2 ?? '0'), 0).toLocaleString('de-AT')} kg
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
