import { useState, useEffect } from 'react';
import { AlertTriangle, Check, Pencil, ChevronUp, Save, Trash2, Calendar, MapPin, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { 
  expenseCategoryLabels,
  expenseTypeLabels,
  expenseTypesByCategory,
  type ExpenseCategory,
  type ExpenseType,
} from '@/hooks/useExpenses';
import { usePropertyMatcher } from '@/hooks/usePropertyMatcher';

export interface BatchResultItem {
  fileName: string;
  file?: File; // Original file for upload
  lieferant?: string;
  beschreibung?: string;
  betrag?: number;
  datum?: string;
  rechnungsnummer?: string;
  kategorie?: ExpenseCategory;
  expense_type?: ExpenseType;
  iban?: string;
  // Leistungsort für Property-Matching
  leistungsort_strasse?: string | null;
  leistungsort_plz?: string | null;
  leistungsort_stadt?: string | null;
  // Suggested property from matching
  suggestedPropertyId?: string;
  suggestedPropertyConfidence?: number;
  // Editable form state
  edited?: {
    bezeichnung: string;
    betrag: string;
    datum: string;
    beleg_nummer: string;
    category: ExpenseCategory;
    expense_type: ExpenseType;
    notizen: string;
  };
  // OCR quality signals
  needs_review?: boolean;
  validierung?: {
    confidence_score?: number;
    unsichere_felder?: string[];
    warnungen?: string[];
  };
  /**
   * Snapshot der original-OCR-Werte zum Zeitpunkt der Initialisierung.
   * Formatidentisch mit dem edited-State — ermöglicht präzisen Diff im Audit-Log.
   * Nur gesetzt wenn OCR tatsächlich ausgeführt wurde.
   */
  originalOcr?: {
    bezeichnung: string;
    betrag: string;
    datum: string;
    beleg_nummer: string;
    category: ExpenseCategory;
    expense_type: ExpenseType;
  };
  /**
   * Explizit durch den Verwalter als geprüft markiert.
   * undefined/true = kein Review erforderlich; false = Review ausstehend (nur bei needs_review=true).
   */
  reviewed?: boolean;
  // Selection state
  selected?: boolean;
  saved?: boolean;
  /** Fehlermeldung wenn das Speichern für diesen Beleg fehlgeschlagen ist. */
  saveError?: string;
  /**
   * Stabile Batch-interne ID, bei initializeItems vergeben.
   * Ermöglicht eindeutige Zuordnung von Speicher-Ergebnissen auch wenn
   * mehrere Dateien denselben Dateinamen tragen.
   */
  batchItemId?: string;
}

export interface BatchSaveResult {
  /** Ergebnisse in derselben Reihenfolge wie die übergebenen items. */
  outcomes: { batchItemId: string; success: boolean; error?: string }[];
}

interface BatchResultsSummaryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: BatchResultItem[];
  properties: { id: string; name: string }[];
  onSaveAll: (items: BatchResultItem[], propertyId: string, abrechnungsjahrConfig?: { useCustom: boolean; year: number; verbrauchsTypes: string[] }) => Promise<BatchSaveResult>;
  onClose: () => void;
}

export function BatchResultsSummary({
  open,
  onOpenChange,
  results,
  properties,
  onSaveAll,
  onClose,
}: BatchResultsSummaryProps) {
  const { matchPropertyByLeistungsort } = usePropertyMatcher();
  
  const initializeItems = (resultsToInit: BatchResultItem[]): BatchResultItem[] => 
    resultsToInit.map((r, idx) => {
      // Automatisches Property-Matching basierend auf Leistungsort
      let suggestedPropertyId: string | undefined;
      let suggestedPropertyConfidence: number | undefined;
      
      if (r.leistungsort_strasse || r.leistungsort_plz || r.leistungsort_stadt) {
        const match = matchPropertyByLeistungsort({
          strasse: r.leistungsort_strasse || null,
          plz: r.leistungsort_plz || null,
          stadt: r.leistungsort_stadt || null,
        });
        
        if (match) {
          suggestedPropertyId = match.propertyId;
          suggestedPropertyConfidence = match.confidence;
        }
      }
      
      // Basis-OCR-Werte in der gleichen Formatierung wie das Edit-Formular.
      // Der Snapshot dient als Vergleichsbasis für den Audit-Log-Diff.
      const ocrSnapshot = {
        bezeichnung:  r.beschreibung || r.lieferant || '',
        betrag:       r.betrag?.toString().replace('.', ',') || '',
        datum:        r.datum || new Date().toISOString().split('T')[0],
        beleg_nummer: r.rechnungsnummer || '',
        category:     (r.kategorie || 'betriebskosten_umlagefaehig') as ExpenseCategory,
        expense_type: (r.expense_type || 'sonstiges') as ExpenseType,
      };

      return {
        ...r,
        selected: true,
        saved: false,
        saveError: undefined,
        // Stabile Batch-interne ID für eindeutige Ergebnis-Zuordnung
        batchItemId: String(idx),
        // needs_review=true → Verwalter muss explizit bestätigen; sonst kein Review erforderlich
        reviewed: r.needs_review ? false : undefined,
        suggestedPropertyId,
        suggestedPropertyConfidence,
        // Snapshot formatidentisch mit edited — für präzisen Audit-Log-Diff
        originalOcr: ocrSnapshot,
        edited: {
          ...ocrSnapshot,
          notizen: r.iban ? `IBAN: ${r.iban}` : '',
        },
      };
    });

  const [items, setItems] = useState<BatchResultItem[]>([]);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());
  const [selectedProperty, setSelectedProperty] = useState<string>('');
  const [saving, setSaving] = useState(false);
  
  // Abrechnungsjahr für verbrauchsabhängige Kosten
  const currentYear = new Date().getFullYear();
  const [useCustomAbrechnungsjahr, setUseCustomAbrechnungsjahr] = useState(false);
  const [customAbrechnungsjahr, setCustomAbrechnungsjahr] = useState(currentYear - 1);
  
  // Verbrauchsabhängige Kostenarten
  const verbrauchsabhaengigeKosten = ['heizung', 'wasser_abwasser'];
  
  // Update items when results change (e.g., when dialog opens with new batch)
  useEffect(() => {
    if (open && results.length > 0) {
      const initialized = initializeItems(results);
      setItems(initialized);
      
      // Alle ungeprüften needs_review-Items sofort aufklappen — kein unsicheres Feld darf ungesehen bleiben
      const unreviewedIndices = initialized.reduce<number[]>((acc, item, idx) => {
        if (item.needs_review && !item.reviewed) acc.push(idx);
        return acc;
      }, []);
      setExpandedSet(new Set(unreviewedIndices));

      // Auto-select property if all items suggest the same property with high confidence
      const highConfidenceSuggestions = initialized
        .filter(i => i.suggestedPropertyId && (i.suggestedPropertyConfidence || 0) >= 0.6)
        .map(i => i.suggestedPropertyId);
      
      if (highConfidenceSuggestions.length > 0) {
        const uniqueProperties = [...new Set(highConfidenceSuggestions)];
        if (uniqueProperties.length === 1 && uniqueProperties[0]) {
          setSelectedProperty(uniqueProperties[0]);
        }
      }
    }
  }, [open, results]);

  // Failed items remain selected and unsaved — they should be retryable via the same save button.
  const selectedCount = items.filter(i => i.selected && !i.saved).length;
  const savedCount = items.filter(i => i.saved).length;
  const failedCount = items.filter(i => i.saveError).length;
  /** Ausgewählte Belege die noch explizit geprüft werden müssen — blockiert den Speichern-Button */
  const unreviewedSelectedCount = items.filter(
    i => i.selected && !i.saved && i.needs_review && !i.reviewed
  ).length;
  
  // Count items with property suggestions
  const itemsWithSuggestions = items.filter(i => i.suggestedPropertyId && (i.suggestedPropertyConfidence || 0) >= 0.5).length;

  const toggleSelect = (index: number) => {
    setItems(prev => prev.map((item, i) => 
      i === index ? { ...item, selected: !item.selected } : item
    ));
  };

  const toggleExpand = (index: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const updateItem = (index: number, field: keyof NonNullable<BatchResultItem['edited']>, value: string) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index || !item.edited) return item;
      
      const newEdited = { ...item.edited, [field]: value };
      
      // Reset expense_type when category changes
      if (field === 'category') {
        const newCategory = value as ExpenseCategory;
        const availableTypes = expenseTypesByCategory[newCategory];
        if (!availableTypes.includes(newEdited.expense_type)) {
          newEdited.expense_type = availableTypes[0];
        }
      }
      
      return { ...item, edited: newEdited };
    }));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  /** Markiert einen needs_review-Beleg als geprüft und klappt ihn zu. */
  const markReviewed = (index: number) => {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, reviewed: true } : item
    ));
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  const handleSaveAll = async () => {
    if (!selectedProperty) return;
    // Sicherheitsguard: niemals speichern wenn noch ungeprüfte Belege ausgewählt sind
    if (unreviewedSelectedCount > 0) return;
    
    const itemsToSave = items.filter(i => i.selected && !i.saved);
    if (itemsToSave.length === 0) return;
    
    setSaving(true);
    try {
      const result = await onSaveAll(itemsToSave, selectedProperty, {
        useCustom: useCustomAbrechnungsjahr,
        year: customAbrechnungsjahr,
        verbrauchsTypes: verbrauchsabhaengigeKosten,
      });
      
      // Build a map keyed by the stable batchItemId for O(1) lookup.
      const outcomeMap = new Map(result.outcomes.map(o => [o.batchItemId, o]));

      // Apply outcomes — each item is matched by its unique batchItemId, not fileName.
      // A successful retry clears any previous saveError.
      setItems(prev => prev.map(item => {
        if (!item.selected || item.saved || !item.batchItemId) return item;
        const outcome = outcomeMap.get(item.batchItemId);
        if (!outcome) return item;
        if (outcome.success) return { ...item, saved: true, saveError: undefined };
        return { ...item, saveError: outcome.error };
      }));
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value: string): string => {
    const num = parseFloat(value.replace(',', '.'));
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(num);
  };
  
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) {
      return <Badge variant="default" className="text-xs bg-green-600">Erkannt ({Math.round(confidence * 100)}%)</Badge>;
    } else if (confidence >= 0.5) {
      return <Badge variant="secondary" className="text-xs bg-yellow-500 text-black">Möglich ({Math.round(confidence * 100)}%)</Badge>;
    }
    return null;
  };

  /** OCR-Erkennungssicherheit: grün ≥ 85%, gelb ≥ 60%, rot < 60% */
  const getOcrConfidenceBadge = (score: number | undefined) => {
    if (score === undefined) return null;
    if (score >= 0.85)
      return <Badge className="text-xs bg-green-600 text-white">KI {Math.round(score * 100)}%</Badge>;
    if (score >= 0.60)
      return <Badge className="text-xs bg-amber-500 text-white">KI {Math.round(score * 100)}%</Badge>;
    return <Badge variant="destructive" className="text-xs">KI {Math.round(score * 100)}%</Badge>;
  };

  /** Gibt true zurück wenn das OCR-Feld als unsicher markiert ist. */
  const isUncertain = (item: BatchResultItem, ocrField: string) =>
    item.validierung?.unsichere_felder?.includes(ocrField) ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-primary" />
            Stapelverarbeitung abgeschlossen
          </DialogTitle>
          <DialogDescription>
            {results.length} Rechnungen wurden analysiert. Überprüfen Sie die Daten und speichern Sie die Einträge.
            {items.filter(i => i.needs_review).length > 0 && (
              <span className="block mt-1 text-amber-600 font-medium">
                {items.filter(i => i.needs_review).length} von {items.length} Belegen benötigen Prüfung
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Property selection and Abrechnungsjahr */}
        <div className="space-y-3 py-2 border-b">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium whitespace-nowrap">Liegenschaft:</Label>
              <Select value={selectedProperty} onValueChange={setSelectedProperty}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Liegenschaft auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {itemsWithSuggestions > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span>{itemsWithSuggestions} Rechnung(en) mit erkanntem Leistungsort</span>
              </div>
            )}
          </div>
          
          {/* Abrechnungsjahr für Verbrauchskosten */}
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Verbrauchskosten im Vorjahr buchen</Label>
                  <p className="text-xs text-muted-foreground">
                    Heizung und Wasser/Abwasser werden im ausgewählten Jahr gebucht
                  </p>
                </div>
                <Switch
                  checked={useCustomAbrechnungsjahr}
                  onCheckedChange={setUseCustomAbrechnungsjahr}
                />
              </div>
              {useCustomAbrechnungsjahr && (
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-xs text-muted-foreground">Abrechnungsjahr:</Label>
                  <Select 
                    value={customAbrechnungsjahr.toString()} 
                    onValueChange={(v) => setCustomAbrechnungsjahr(parseInt(v))}
                  >
                    <SelectTrigger className="w-24 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[currentYear - 2, currentYear - 1, currentYear].map(year => (
                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results list */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 py-2">
            {items.map((item, index) => (
              <div
                key={index}
                className={cn(
                  'border rounded-lg transition-all',
                  item.saved && 'bg-muted/50 opacity-60',
                  item.saveError && 'border-destructive/50 bg-destructive/5',
                  item.selected && !item.saved && !item.saveError && 'border-primary/50',
                  !item.selected && !item.saved && !item.saveError && 'opacity-50'
                )}
              >
                {/* Summary row */}
                <div className="flex items-center gap-3 p-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => !item.saved && toggleSelect(index)}
                    disabled={item.saved}
                    className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0',
                      item.saved && 'bg-primary border-primary',
                      item.selected && !item.saved && 'bg-primary border-primary',
                      !item.selected && !item.saved && 'border-muted-foreground/30 hover:border-primary'
                    )}
                  >
                    {(item.selected || item.saved) && <Check className="h-3 w-3 text-primary-foreground" />}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        {item.edited?.bezeichnung || item.fileName}
                      </span>
                      {item.saved && (
                        <Badge variant="secondary" className="text-xs">Gespeichert</Badge>
                      )}
                      {item.saveError && (
                        <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                          <XCircle className="h-3 w-3" />
                          Fehler beim Speichern
                        </span>
                      )}
                      {!item.saved && !item.saveError && item.suggestedPropertyId && item.suggestedPropertyConfidence && (
                        getConfidenceBadge(item.suggestedPropertyConfidence)
                      )}
                      {!item.saved && !item.saveError && getOcrConfidenceBadge(item.validierung?.confidence_score)}
                      {/* Reviewed-Status: ungeprüft (blockierend) oder bereits geprüft */}
                      {!item.saved && !item.saveError && item.needs_review && !item.reviewed && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          Prüfen erforderlich
                        </span>
                      )}
                      {!item.saved && !item.saveError && item.needs_review && item.reviewed && (
                        <Badge className="text-xs bg-green-600 text-white">✓ Geprüft</Badge>
                      )}
                    </div>
                    {item.saveError && (
                      <p className="text-xs text-destructive mt-0.5 truncate" title={item.saveError}>
                        {item.saveError}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{item.fileName}</span>
                      <span>•</span>
                      <span>{item.edited?.datum}</span>
                      {item.leistungsort_strasse && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {item.leistungsort_strasse}
                            {item.leistungsort_plz && `, ${item.leistungsort_plz}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <span className="font-medium text-sm whitespace-nowrap">
                    {item.edited?.betrag ? formatCurrency(item.edited.betrag) : '—'}
                  </span>

                  {/* Actions */}
                  {!item.saved && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleExpand(index)}
                      >
                        {expandedSet.has(index) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Expanded edit form */}
                {expandedSet.has(index) && !item.saved && item.edited && (
                  <div className="border-t p-4 space-y-4 bg-muted/30">
                    {/* needs_review Hinweis + Bestätigungs-Button */}
                    {item.needs_review && !item.reviewed && (
                      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <span className="font-medium">Niedrige Erkennungssicherheit</span>
                          {' — '}bitte alle Felder sorgfältig prüfen und ggf. korrigieren.
                          {item.validierung?.unsichere_felder && item.validierung.unsichere_felder.length > 0 && (
                            <span className="block mt-0.5">
                              Unsichere Felder: {item.validierung.unsichere_felder.join(', ')}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0"
                          onClick={() => markReviewed(index)}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Als geprüft markieren
                        </Button>
                      </div>
                    )}
                    {item.needs_review && item.reviewed && (
                      <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md text-xs text-green-700">
                        <Check className="h-4 w-4 flex-shrink-0" />
                        <span>Felder geprüft — Daten können gespeichert werden.</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'lieferant') && 'text-amber-600 font-medium')}>
                          Bezeichnung {isUncertain(item, 'lieferant') && '⚠'}
                        </Label>
                        <Input
                          value={item.edited.bezeichnung}
                          onChange={(e) => updateItem(index, 'bezeichnung', e.target.value)}
                          placeholder="Bezeichnung eingeben"
                          className={cn(isUncertain(item, 'lieferant') && 'ring-1 ring-amber-400 bg-amber-50/50')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'betrag') && 'text-amber-600 font-medium')}>
                          Betrag (€) {isUncertain(item, 'betrag') && '⚠'}
                        </Label>
                        <Input
                          value={item.edited.betrag}
                          onChange={(e) => updateItem(index, 'betrag', e.target.value)}
                          placeholder="0,00"
                          className={cn(isUncertain(item, 'betrag') && 'ring-1 ring-amber-400 bg-amber-50/50')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'datum') && 'text-amber-600 font-medium')}>
                          Datum {isUncertain(item, 'datum') && '⚠'}
                        </Label>
                        <Input
                          type="date"
                          value={item.edited.datum}
                          onChange={(e) => updateItem(index, 'datum', e.target.value)}
                          className={cn(isUncertain(item, 'datum') && 'ring-1 ring-amber-400 bg-amber-50/50')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'rechnungsnummer') && 'text-amber-600 font-medium')}>
                          Belegnummer {isUncertain(item, 'rechnungsnummer') && '⚠'}
                        </Label>
                        <Input
                          value={item.edited.beleg_nummer}
                          onChange={(e) => updateItem(index, 'beleg_nummer', e.target.value)}
                          placeholder="Optional"
                          className={cn(isUncertain(item, 'rechnungsnummer') && 'ring-1 ring-amber-400 bg-amber-50/50')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'kategorie') && 'text-amber-600 font-medium')}>
                          Kategorie {isUncertain(item, 'kategorie') && '⚠'}
                        </Label>
                        <Select
                          value={item.edited.category}
                          onValueChange={(v) => updateItem(index, 'category', v)}
                        >
                          <SelectTrigger className={cn(isUncertain(item, 'kategorie') && 'ring-1 ring-amber-400 bg-amber-50/50')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(expenseCategoryLabels).map(([key, label]) => (
                              <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className={cn('text-xs', isUncertain(item, 'expense_type') && 'text-amber-600 font-medium')}>
                          Kostenart {isUncertain(item, 'expense_type') && '⚠'}
                        </Label>
                        <Select
                          value={item.edited.expense_type}
                          onValueChange={(v) => updateItem(index, 'expense_type', v)}
                        >
                          <SelectTrigger className={cn(isUncertain(item, 'expense_type') && 'ring-1 ring-amber-400 bg-amber-50/50')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {expenseTypesByCategory[item.edited.category].map(type => (
                              <SelectItem key={type} value={type}>
                                {expenseTypeLabels[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t pt-4 flex-col gap-2 items-stretch sm:items-stretch">
          {failedCount > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive w-full">
              <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">{failedCount} Beleg{failedCount > 1 ? 'e' : ''} nicht gespeichert</span>
                {' — '}bitte Fehler prüfen und erneut versuchen.
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 w-full">
            <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground flex-wrap">
              {savedCount > 0 && <span>{savedCount} gespeichert</span>}
              {savedCount > 0 && selectedCount > 0 && <span>•</span>}
              {selectedCount > 0 && <span>{selectedCount} ausgewählt</span>}
              {/* Blockierungshinweis wenn ungeprüfte Belege ausgewählt sind */}
              {unreviewedSelectedCount > 0 && (
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {unreviewedSelectedCount} Beleg{unreviewedSelectedCount > 1 ? 'e' : ''} noch nicht geprüft — bitte Formular öffnen und bestätigen
                </span>
              )}
            </div>
            <Button variant="outline" onClick={onClose}>
              {savedCount === items.length && failedCount === 0 ? 'Schließen' : 'Abbrechen'}
            </Button>
            {selectedCount > 0 && (
              <Button 
                onClick={handleSaveAll} 
                disabled={!selectedProperty || saving || unreviewedSelectedCount > 0}
                title={unreviewedSelectedCount > 0 ? `${unreviewedSelectedCount} Beleg(e) müssen zuerst geprüft werden` : undefined}
              >
                {saving ? (
                  <>Speichern...</>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />
                    {selectedCount} speichern
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
