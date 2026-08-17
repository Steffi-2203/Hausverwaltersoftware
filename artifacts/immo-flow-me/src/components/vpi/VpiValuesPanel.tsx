/**
 * VpiValuesPanel
 *
 * Aufklappbare Tabelle der gespeicherten VPI-Indexwerte.
 * Erlaubt:
 *  - Anzeige aller Werte (Jahr, Monat, Wert, Quelle, Letzte Änderung)
 *  - Inline-Bearbeitung eines Werts (PATCH /api/vpi/values/:id)
 *  - Löschen mit Bestätigung (DELETE /api/vpi/values/:id)
 *  - Manuelles Hinzufügen eines einzelnen Werts (POST /api/vpi/values)
 *  - Filterung nach Jahr
 */
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown, ChevronUp, Pencil, Trash2, Plus, Check, X, Database, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const MONTHS_DE = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

interface VpiValue {
  id: string;
  year: number;
  month: number;
  value: string | number;
  source: string | null;
  updated_at: string | null;
  created_at: string | null;
}

interface VpiValuesPanelProps {
  values: VpiValue[];
  onRefresh: () => void;
}

export function VpiValuesPanel({ values, onRefresh }: VpiValuesPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  // Filterung
  const availableYears = useMemo(() => {
    const years = [...new Set(values.map(v => v.year))].sort((a, b) => b - a);
    return years;
  }, [values]);
  const [filterYear, setFilterYear] = useState<string>('all');

  const filtered = useMemo(() => {
    if (filterYear === 'all') return values;
    return values.filter(v => String(v.year) === filterYear);
  }, [values, filterYear]);

  // ── Bearbeiten ────────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const startEdit = (v: VpiValue) => {
    setEditingId(v.id);
    setEditValue(String(v.value));
  };
  const cancelEdit = () => { setEditingId(null); setEditValue(''); };

  const saveEdit = async (id: string) => {
    const num = parseFloat(editValue.replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      toast({ title: 'Ungültiger Wert', description: 'Bitte einen positiven Dezimalwert eingeben.', variant: 'destructive' });
      return;
    }
    setEditLoading(true);
    try {
      const res = await fetch(`/api/vpi/values/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: num, source: 'manual' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast({ title: 'Gespeichert', description: 'VPI-Wert wurde aktualisiert.' });
      cancelEdit();
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    } finally {
      setEditLoading(false);
    }
  };

  // ── Löschen ───────────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const confirmDelete = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/vpi/values/${deletingId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: 'Gelöscht', description: 'VPI-Wert wurde entfernt.' });
      setDeletingId(null);
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Neuen Wert hinzufügen ─────────────────────────────────────────────────
  const curYear = new Date().getFullYear();
  const [addOpen, setAddOpen] = useState(false);
  const [addYear, setAddYear] = useState(String(curYear));
  const [addMonth, setAddMonth] = useState('1');
  const [addValue, setAddValue] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const handleAdd = async () => {
    const num = parseFloat(addValue.replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      toast({ title: 'Ungültiger Wert', description: 'Bitte einen positiven Dezimalwert eingeben.', variant: 'destructive' });
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch('/api/vpi/values', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: parseInt(addYear), month: parseInt(addMonth), value: num, source: 'manual' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast({ title: 'Hinzugefügt', description: `VPI-Wert ${MONTHS_DE[parseInt(addMonth) - 1]} ${addYear}: ${num.toFixed(1)}` });
      setAddValue('');
      setAddOpen(false);
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer select-none">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">Gespeicherte VPI-Werte</CardTitle>
                  <Badge variant="secondary" data-testid="badge-vpi-count">
                    {values.length} {values.length === 1 ? 'Wert' : 'Werte'}
                  </Badge>
                </div>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CollapsibleTrigger>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Toolbar: Jahr-Filter + Hinzufügen */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground whitespace-nowrap">Jahr:</Label>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="w-[110px] h-8 text-sm" data-testid="select-vpi-year-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle</SelectItem>
                      {availableYears.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  data-testid="button-add-vpi-value"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Wert hinzufügen
                </Button>
              </div>

              {/* Formular: Neuen Wert hinzufügen */}
              {addOpen && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3" data-testid="form-add-vpi">
                  <p className="text-sm font-medium">Neuen VPI-Wert manuell eintragen</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Jahr</Label>
                      <Select value={addYear} onValueChange={setAddYear}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-add-year">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 15 }, (_, i) => curYear - i).map(y => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Monat</Label>
                      <Select value={addMonth} onValueChange={setAddMonth}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-add-month">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MONTHS_DE.map((m, i) => (
                            <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Wert (Basis 2020=100)</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="z.B. 112,4"
                        value={addValue}
                        onChange={e => setAddValue(e.target.value)}
                        data-testid="input-add-value"
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAdd} disabled={addLoading || !addValue.trim()} data-testid="button-add-confirm">
                      {addLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                      Hinzufügen
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddOpen(false); setAddValue(''); }}>
                      Abbrechen
                    </Button>
                  </div>
                </div>
              )}

              {/* Tabelle */}
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {values.length === 0 ? 'Noch keine VPI-Werte gespeichert.' : 'Keine Werte für dieses Jahr.'}
                </p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[70px]">Jahr</TableHead>
                        <TableHead className="w-[70px]">Monat</TableHead>
                        <TableHead className="text-right w-[100px]">VPI-Wert</TableHead>
                        <TableHead>Quelle</TableHead>
                        <TableHead className="hidden sm:table-cell">Geändert</TableHead>
                        <TableHead className="w-[90px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(v => (
                        <TableRow key={v.id} data-testid={`row-vpi-${v.id}`}>
                          <TableCell>{v.year}</TableCell>
                          <TableCell>{MONTHS_DE[(v.month - 1)] ?? v.month}</TableCell>
                          <TableCell className="text-right font-mono">
                            {editingId === v.id ? (
                              <Input
                                className="h-7 w-24 text-right text-sm font-mono ml-auto"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                autoFocus
                                data-testid={`input-edit-${v.id}`}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEdit(v.id);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                              />
                            ) : (
                              <span data-testid={`cell-value-${v.id}`}>
                                {Number(v.value).toFixed(1)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal">
                              {v.source || 'unbekannt'}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                            {v.updated_at
                              ? format(new Date(v.updated_at), 'dd.MM.yyyy', { locale: de })
                              : v.created_at
                                ? format(new Date(v.created_at), 'dd.MM.yyyy', { locale: de })
                                : '—'}
                          </TableCell>
                          <TableCell>
                            {editingId === v.id ? (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="icon" variant="ghost" className="h-7 w-7 text-green-600"
                                  onClick={() => saveEdit(v.id)}
                                  disabled={editLoading}
                                  data-testid={`button-save-${v.id}`}
                                >
                                  {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  size="icon" variant="ghost" className="h-7 w-7"
                                  onClick={cancelEdit}
                                  data-testid={`button-cancel-edit-${v.id}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="icon" variant="ghost" className="h-7 w-7"
                                  onClick={() => startEdit(v)}
                                  data-testid={`button-edit-${v.id}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeletingId(v.id)}
                                  data-testid={`button-delete-${v.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Lösch-Bestätigung */}
      <AlertDialog open={!!deletingId} onOpenChange={v => { if (!v) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>VPI-Wert löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Wert wird dauerhaft entfernt. VPI-Anpassungsberechnungen die diesen Wert
              verwenden könnten, werden davon beeinflusst.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
