import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Wallet, Plus, Trash2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

const einnahmenCategories = ['Mieteinnahmen', 'BK-Einnahmen', 'Heizkosten-Einnahmen', 'Sonstige Einnahmen'];
const ausgabenCategories = ['Betriebskosten', 'Instandhaltung', 'Verwaltung', 'Versicherung', 'Steuern/Abgaben', 'Sonstige Ausgaben'];
const taxRates = [
  { value: '0', label: '0%' },
  { value: '10', label: '10%' },
  { value: '13', label: '13%' },
  { value: '20', label: '20%' },
];

interface EaRechnungTabProps {
  propertyId?: string;
}

export function EaRechnungTab({ propertyId }: EaRechnungTabProps) {
  const { toast } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [showDialog, setShowDialog] = useState(false);
  const [formType, setFormType] = useState<'einnahme' | 'ausgabe'>('einnahme');
  const [formDate, setFormDate] = useState(now.toISOString().split('T')[0]);
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTaxRate, setFormTaxRate] = useState('20');
  const [formDocRef, setFormDocRef] = useState('');
  const [formBelegNr, setFormBelegNr] = useState('');

  const queryParams = new URLSearchParams({ year: year.toString() });
  if (propertyId) queryParams.set('propertyId', propertyId);
  const queryString = queryParams.toString();

  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['/api/ea-rechnung/bookings', year, propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/ea-rechnung/bookings?${queryString}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['/api/ea-rechnung/summary', year, propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/ea-rechnung/summary?${queryString}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/ea-rechnung/bookings', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ea-rechnung/bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ea-rechnung/summary'] });
      setShowDialog(false);
      resetForm();
      toast({ title: 'Buchung erstellt' });
    },
    onError: (err: any) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/ea-rechnung/bookings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ea-rechnung/bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ea-rechnung/summary'] });
      toast({ title: 'Buchung gelöscht' });
    },
    onError: (err: any) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setFormType('einnahme');
    setFormDate(now.toISOString().split('T')[0]);
    setFormAmount('');
    setFormDescription('');
    setFormCategory('');
    setFormTaxRate('20');
    setFormDocRef('');
    setFormBelegNr('');
  };

  const calculatedValues = useMemo(() => {
    const gross = Number(formAmount) || 0;
    const rate = Number(formTaxRate) || 0;
    const net = gross / (1 + rate / 100);
    const tax = gross - net;
    return {
      net: Math.round(net * 100) / 100,
      tax: Math.round(tax * 100) / 100,
    };
  }, [formAmount, formTaxRate]);

  const handleSubmit = () => {
    if (!formAmount || !formDescription || !formCategory || !formDate) {
      toast({ title: 'Bitte alle Pflichtfelder ausfüllen', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      type: formType,
      date: formDate,
      amount: formAmount,
      description: formDescription,
      category: formCategory,
      taxRate: formTaxRate,
      documentRef: formDocRef || undefined,
      belegNummer: formBelegNr || undefined,
      propertyId: propertyId || undefined,
    });
  };

  const categories = formType === 'einnahme' ? einnahmenCategories : ausgabenCategories;
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  if (bookingsLoading || summaryLoading) return <Skeleton className="h-64 w-full" />;

  const s = summary as any || {};
  const items = (bookings as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="card-ea-einnahmen">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-md bg-green-100 dark:bg-green-900/30">
                <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-muted-foreground">Einnahmen</p>
            </div>
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-ea-total-einnahmen">{formatEur(s.totalEinnahmen || 0)}</p>
            <p className="text-xs text-muted-foreground">{s.countEinnahmen || 0} Buchungen</p>
          </CardContent>
        </Card>
        <Card data-testid="card-ea-ausgaben">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-md bg-red-100 dark:bg-red-900/30">
                <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-sm text-muted-foreground">Ausgaben</p>
            </div>
            <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-ea-total-ausgaben">{formatEur(s.totalAusgaben || 0)}</p>
            <p className="text-xs text-muted-foreground">{s.countAusgaben || 0} Buchungen</p>
          </CardContent>
        </Card>
        <Card data-testid="card-ea-ergebnis">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30">
                <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-sm text-muted-foreground">Ergebnis</p>
            </div>
            <p className={`text-xl font-bold ${(s.ergebnis || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="text-ea-ergebnis">{formatEur(s.ergebnis || 0)}</p>
            <p className="text-xs text-muted-foreground">Einnahmen − Ausgaben</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" />E/A Buchungen
            </CardTitle>
            <div className="flex gap-2">
              <Select value={year.toString()} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-[100px]" data-testid="select-ea-year"><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={() => { resetForm(); setShowDialog(true); }} data-testid="button-ea-add">
                <Plus className="h-4 w-4 mr-1" />Buchung
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-ea-empty">
              Keine E/A Buchungen vorhanden
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-ea-bookings">
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                    <TableHead className="text-right">USt</TableHead>
                    <TableHead className="text-right">Brutto</TableHead>
                    <TableHead>Beleg-Nr.</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b: any) => (
                    <TableRow key={b.id} data-testid={`row-ea-booking-${b.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(b.date).toLocaleDateString('de-AT')}
                      </TableCell>
                      <TableCell>
                        {b.type === 'einnahme' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-ea-type-${b.id}`}>Einnahme</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-ea-type-${b.id}`}>Ausgabe</Badge>
                        )}
                      </TableCell>
                      <TableCell>{b.description}</TableCell>
                      <TableCell><Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">{b.category}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatEur(Number(b.netAmount || 0))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatEur(Number(b.taxAmount || 0))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">{formatEur(Number(b.amount || 0))}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{b.belegNummer || '-'}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(b.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-ea-delete-${b.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-ea-add">
          <DialogHeader>
            <DialogTitle>Neue E/A Buchung</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Typ</Label>
                <Select value={formType} onValueChange={(v: 'einnahme' | 'ausgabe') => { setFormType(v); setFormCategory(''); }}>
                  <SelectTrigger data-testid="select-ea-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="einnahme">Einnahme</SelectItem>
                    <SelectItem value="ausgabe">Ausgabe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Datum</Label>
                <Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} data-testid="input-ea-form-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Bruttobetrag (€)</Label>
                <Input type="number" step="0.01" min="0" value={formAmount} onChange={e => setFormAmount(e.target.value)} placeholder="0,00" data-testid="input-ea-form-amount" />
              </div>
              <div className="space-y-1.5">
                <Label>Steuersatz</Label>
                <Select value={formTaxRate} onValueChange={setFormTaxRate}>
                  <SelectTrigger data-testid="select-ea-form-taxrate"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {taxRates.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formAmount && (
              <div className="flex gap-4 text-sm text-muted-foreground" data-testid="text-ea-form-calculated">
                <span>Netto: {formatEur(calculatedValues.net)}</span>
                <span>USt: {formatEur(calculatedValues.tax)}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Beschreibung</Label>
              <Input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Buchungsbeschreibung" data-testid="input-ea-form-description" />
            </div>
            <div className="space-y-1.5">
              <Label>Kategorie</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger data-testid="select-ea-form-category"><SelectValue placeholder="Kategorie wählen" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Beleg-Nr.</Label>
                <Input value={formBelegNr} onChange={e => setFormBelegNr(e.target.value)} placeholder="z.B. RE-2025-001" data-testid="input-ea-form-belegnr" />
              </div>
              <div className="space-y-1.5">
                <Label>Dokumentreferenz</Label>
                <Input value={formDocRef} onChange={e => setFormDocRef(e.target.value)} placeholder="Optional" data-testid="input-ea-form-docref" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-ea-form-cancel">Abbrechen</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-ea-form-save">
              {createMutation.isPending ? 'Speichern...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
