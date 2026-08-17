import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Upload, FileText, Loader2, CheckCircle2, AlertCircle, 
  TrendingUp, TrendingDown, Building, User, Sparkles, X
} from 'lucide-react';
import { toast } from 'sonner';
import { useOCRBankStatement, BankStatementLine, MatchedBankLine } from '@/hooks/useOCRBankStatement';
import { createSearchCandidates, fuzzyMatch as fuzzyMatchUnit, LearnedPattern } from '@/utils/fuzzyMatching';

interface Unit {
  id: string;
  top_nummer: string;
  property_id: string;
  qm: number;
  type: string;
}

interface Tenant {
  id: string;
  first_name: string;
  last_name: string;
  unit_id: string;
  iban?: string | null;
  grundmiete: number;
  betriebskosten_vorschuss: number;
  heizungskosten_vorschuss: number;
}

interface Property {
  id: string;
  name: string;
}

interface LearnedMatch {
  id: string;
  pattern: string;
  unit_id: string | null;
  tenant_id: string | null;
  match_count?: number | null;
}

interface AccountCategory {
  id: string;
  name: string;
  type: string;
}

interface BankStatementOCRProps {
  units: Unit[];
  tenants: Tenant[];
  properties: Property[];
  learnedMatches: LearnedMatch[];
  categories: AccountCategory[];
  bankAccountId: string | null;
  organizationId: string | null;
  bankAccountPropertyId?: string | null;
  onImport: (transactions: MatchedBankLine[]) => Promise<void>;
}

export function BankStatementOCR({
  units,
  tenants,
  properties,
  learnedMatches,
  categories,
  bankAccountId,
  organizationId,
  bankAccountPropertyId,
  onImport
}: BankStatementOCRProps) {
  const { processFile, isProcessing, result, reset } = useOCRBankStatement();
  const [matchedLines, setMatchedLines] = useState<MatchedBankLine[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Build search candidates for fuzzy matching - filtered by bank account property if assigned
  const searchCandidates = useMemo(() => {
    // Filter units/tenants by property if bank account is assigned to a property
    const filteredUnits = bankAccountPropertyId 
      ? units.filter(u => u.property_id === bankAccountPropertyId)
      : units;
    
    const filteredTenants = bankAccountPropertyId
      ? tenants.filter(t => filteredUnits.some(u => u.id === t.unit_id))
      : tenants;

    const unitData = filteredUnits.map(u => ({
      id: u.id,
      top_nummer: u.top_nummer,
      property_id: u.property_id
    }));
    const tenantData = filteredTenants.map(t => ({
      id: t.id,
      first_name: t.first_name,
      last_name: t.last_name,
      unit_id: t.unit_id,
      iban: t.iban
    }));
    const patterns: LearnedPattern[] = learnedMatches.map(m => ({
      id: m.id,
      pattern: m.pattern,
      unit_id: m.unit_id,
      tenant_id: m.tenant_id,
      match_count: m.match_count ?? null
    }));
    return createSearchCandidates(unitData, tenantData, patterns);
  }, [units, tenants, learnedMatches, bankAccountPropertyId]);

  // Filter tenants for IBAN matching based on bank account property
  const tenantsForMatching = useMemo(() => {
    if (!bankAccountPropertyId) return tenants;
    const propertyUnits = units.filter(u => u.property_id === bankAccountPropertyId);
    return tenants.filter(t => propertyUnits.some(u => u.id === t.unit_id));
  }, [tenants, units, bankAccountPropertyId]);

  // Get income category ID
  const incomeCategory = useMemo(() => 
    categories.find(c => c.type === 'income' && c.name.toLowerCase().includes('miet')),
    [categories]
  );

  // Match a single line to tenant/unit
  const matchLine = useCallback((line: BankStatementLine, index: number): MatchedBankLine => {
    const searchText = [
      line.auftraggeber_empfaenger,
      line.verwendungszweck,
      line.iban
    ].filter(Boolean).join(' ');

    let matchedUnitId: string | null = null;
    let matchedTenantId: string | null = null;
    let matchedPropertyId: string | null = bankAccountPropertyId || null; // Use bank account property as default
    let confidence = 0;
    let matchReason = '';
    let matchType: 'exact' | 'fuzzy' | 'learned' | 'none' = 'none';

    // If bank account has property, set higher base confidence
    if (bankAccountPropertyId) {
      matchReason = 'Bankkonto → Liegenschaft';
    }

    // Check learned patterns first (exact match)
    for (const lm of learnedMatches) {
      if (searchText.toLowerCase().includes(lm.pattern.toLowerCase())) {
        // If bank account has property, only use patterns that match this property
        if (bankAccountPropertyId && lm.unit_id) {
          const patternUnit = units.find(u => u.id === lm.unit_id);
          if (patternUnit && patternUnit.property_id !== bankAccountPropertyId) {
            continue; // Skip patterns from other properties
          }
        }
        matchedUnitId = lm.unit_id;
        matchedTenantId = lm.tenant_id;
        confidence = 1;
        matchReason = `Gelerntes Muster: "${lm.pattern}"`;
        matchType = 'learned';
        break;
      }
    }

    // If no learned match, try fuzzy matching
    if (!matchedUnitId && searchCandidates.length > 0) {
      const fuzzyResult = fuzzyMatchUnit(searchText, searchCandidates, 0.4);
      if (fuzzyResult.unitId) {
        matchedUnitId = fuzzyResult.unitId;
        matchedTenantId = fuzzyResult.tenantId;
        confidence = fuzzyResult.confidence;
        matchReason = fuzzyResult.matchReason || 'Fuzzy Match';
        matchType = fuzzyResult.matchType;
      }
    }

    // Check IBAN match with tenants (filtered by property if applicable)
    if (!matchedTenantId && line.iban) {
      const tenantByIban = tenantsForMatching.find(t => 
        t.iban && t.iban.replace(/\s/g, '').toUpperCase() === line.iban?.replace(/\s/g, '').toUpperCase()
      );
      if (tenantByIban) {
        matchedTenantId = tenantByIban.id;
        matchedUnitId = tenantByIban.unit_id;
        confidence = 0.95;
        matchReason = 'IBAN-Match';
        matchType = 'exact';
      }
    }

    // Get property from unit (or use bank account property)
    if (matchedUnitId) {
      const unit = units.find(u => u.id === matchedUnitId);
      if (unit) {
        matchedPropertyId = unit.property_id;
      }
    } else if (bankAccountPropertyId) {
      // Even without unit match, use bank account property
      matchedPropertyId = bankAccountPropertyId;
    }

    // Determine if this is likely rental income
    const isRentalIncome = line.betrag > 0 && (
      matchedTenantId !== null ||
      /miete|monatsmiete|wohnungsmiete/i.test(line.verwendungszweck)
    );

    return {
      ...line,
      id: `ocr-line-${index}`,
      matchedUnitId,
      matchedTenantId,
      matchedPropertyId,
      confidence,
      matchReason,
      matchType,
      selected: isRentalIncome || confidence > 0.5, // Pre-select likely matches
      categoryId: isRentalIncome ? (incomeCategory?.id || null) : null,
      isRentalIncome
    };
  }, [searchCandidates, learnedMatches, tenantsForMatching, units, incomeCategory, bankAccountPropertyId]);

  // Process file and match lines
  const handleFile = useCallback(async (file: File) => {
    const ocrResult = await processFile(file);
    if (ocrResult && ocrResult.buchungen.length > 0) {
      const matched = ocrResult.buchungen.map((line, idx) => matchLine(line, idx));
      setMatchedLines(matched);
    }
  }, [processFile, matchLine]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleMatchChange = useCallback((lineId: string, unitId: string | null) => {
    setMatchedLines(prev => prev.map(line => {
      if (line.id === lineId) {
        const unit = unitId ? units.find(u => u.id === unitId) : null;
        const tenant = unitId ? tenants.find(t => t.unit_id === unitId) : null;
        return {
          ...line,
          matchedUnitId: unitId,
          matchedTenantId: tenant?.id || null,
          matchedPropertyId: unit?.property_id || null,
          confidence: unitId ? 1 : 0,
          matchReason: unitId ? 'Manuell zugeordnet' : '',
          matchType: unitId ? 'exact' as const : 'none' as const
        };
      }
      return line;
    }));
  }, [units, tenants]);

  const handleToggleSelect = useCallback((lineId: string) => {
    setMatchedLines(prev => prev.map(line =>
      line.id === lineId ? { ...line, selected: !line.selected } : line
    ));
  }, []);

  const handleSelectAllIncome = useCallback(() => {
    setMatchedLines(prev => prev.map(line => ({
      ...line,
      selected: line.betrag > 0
    })));
  }, []);

  const handleImport = useCallback(async () => {
    const selected = matchedLines.filter(l => l.selected);
    if (selected.length === 0) {
      toast.error('Bitte mindestens eine Buchung auswählen');
      return;
    }

    if (!bankAccountId) {
      toast.error('Bitte zuerst ein Bankkonto auswählen');
      return;
    }

    setIsImporting(true);
    try {
      await onImport(selected);
      toast.success(`${selected.length} Buchungen importiert`);
      reset();
      setMatchedLines([]);
    } catch (err) {
      toast.error('Fehler beim Import');
      console.error(err);
    } finally {
      setIsImporting(false);
    }
  }, [matchedLines, bankAccountId, onImport, reset]);

  const handleReset = useCallback(() => {
    reset();
    setMatchedLines([]);
  }, [reset]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);

  const getUnitLabel = (unitId: string) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return unitId;
    const property = properties.find(p => p.id === unit.property_id);
    return `${property?.name || ''} - Top ${unit.top_nummer}`;
  };

  const getTenantName = (tenantId: string | null) => {
    if (!tenantId) return null;
    const tenant = tenants.find(t => t.id === tenantId);
    return tenant ? `${tenant.first_name} ${tenant.last_name}` : null;
  };

  // Summary statistics
  const stats = useMemo(() => {
    const income = matchedLines.filter(l => l.betrag > 0);
    const expense = matchedLines.filter(l => l.betrag < 0);
    const matched = matchedLines.filter(l => l.matchedUnitId);
    const selected = matchedLines.filter(l => l.selected);
    
    return {
      totalLines: matchedLines.length,
      incomeCount: income.length,
      incomeSum: income.reduce((sum, l) => sum + l.betrag, 0),
      expenseCount: expense.length,
      expenseSum: expense.reduce((sum, l) => sum + l.betrag, 0),
      matchedCount: matched.length,
      selectedCount: selected.length
    };
  }, [matchedLines]);

  // Render upload area when no result
  if (!result || matchedLines.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Kontoauszug per OCR scannen
          </CardTitle>
          <CardDescription>
            Laden Sie einen Kontoauszug als PDF oder Bild hoch. Die KI erkennt automatisch 
            alle Buchungszeilen und ordnet Mieteinnahmen den passenden Einheiten zu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {isProcessing ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div>
                  <p className="font-medium">Kontoauszug wird analysiert...</p>
                  <p className="text-sm text-muted-foreground">
                    Die KI erkennt alle Buchungszeilen
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 rounded-full bg-primary/10">
                  <FileText className="h-10 w-10 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-lg">
                    Kontoauszug hierher ziehen
                  </p>
                  <p className="text-muted-foreground mt-1">
                    oder klicken zum Auswählen (PDF, JPG, PNG)
                  </p>
                </div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  id="bank-statement-upload"
                  onChange={handleFileSelect}
                />
                <Button asChild variant="outline">
                  <label htmlFor="bank-statement-upload" className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" />
                    Datei auswählen
                  </label>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render matched lines
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              {stats.totalLines} Buchungen erkannt
            </CardTitle>
            <CardDescription>
              {result.kontoinhaber && `Konto: ${result.kontoinhaber}`}
              {result.iban && ` (${result.iban})`}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={handleReset}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
            <div className="flex items-center gap-2 text-green-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Eingänge</span>
            </div>
            <p className="text-lg font-bold text-green-600">
              {formatCurrency(stats.incomeSum)}
            </p>
            <p className="text-xs text-muted-foreground">{stats.incomeCount} Buchungen</p>
          </div>
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-red-600">
              <TrendingDown className="h-4 w-4" />
              <span className="text-sm font-medium">Ausgänge</span>
            </div>
            <p className="text-lg font-bold text-red-600">
              {formatCurrency(stats.expenseSum)}
            </p>
            <p className="text-xs text-muted-foreground">{stats.expenseCount} Buchungen</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
            <div className="flex items-center gap-2 text-blue-600">
              <Building className="h-4 w-4" />
              <span className="text-sm font-medium">Zugeordnet</span>
            </div>
            <p className="text-lg font-bold text-blue-600">
              {stats.matchedCount}
            </p>
            <p className="text-xs text-muted-foreground">von {stats.totalLines}</p>
          </div>
          <div className="p-3 rounded-lg bg-primary/10">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-medium">Ausgewählt</span>
            </div>
            <p className="text-lg font-bold text-primary">
              {stats.selectedCount}
            </p>
            <p className="text-xs text-muted-foreground">zum Import</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSelectAllIncome}>
            <TrendingUp className="h-4 w-4 mr-1" />
            Alle Eingänge wählen
          </Button>
        </div>

        {/* Validation Warnings */}
        {result.validierung.warnungen.length > 0 && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200">
            <div className="flex items-center gap-2 text-yellow-700 mb-1">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Hinweise</span>
            </div>
            <ul className="text-sm text-yellow-600 list-disc list-inside">
              {result.validierung.warnungen.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Bookings Table */}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="w-24">Datum</TableHead>
                <TableHead className="w-28 text-right">Betrag</TableHead>
                <TableHead>Verwendungszweck</TableHead>
                <TableHead>Auftraggeber/Empfänger</TableHead>
                <TableHead className="w-48">Zuordnung</TableHead>
                <TableHead className="w-28">Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matchedLines.map((line) => (
                <TableRow 
                  key={line.id}
                  className={line.selected ? 'bg-primary/5' : ''}
                >
                  <TableCell>
                    <Checkbox
                      checked={line.selected}
                      onCheckedChange={() => handleToggleSelect(line.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {new Date(line.datum).toLocaleDateString('de-AT')}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${
                    line.betrag >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(line.betrag)}
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={line.verwendungszweck}>
                    {line.verwendungszweck}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {line.auftraggeber_empfaenger || '-'}
                    {line.iban && (
                      <span className="block text-xs text-muted-foreground font-mono">
                        {line.iban}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={line.matchedUnitId || 'none'}
                      onValueChange={(val) => handleMatchChange(line.id, val === 'none' ? null : val)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Zuordnen..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- Keine Zuordnung --</SelectItem>
                        {units.map(unit => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {getUnitLabel(unit.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {line.matchedTenantId && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {getTenantName(line.matchedTenantId)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {line.matchType !== 'none' && (
                      <Badge 
                        variant={
                          line.confidence >= 0.8 ? 'default' :
                          line.confidence >= 0.5 ? 'secondary' : 'outline'
                        }
                        className="text-xs"
                      >
                        {Math.round(line.confidence * 100)}%
                      </Badge>
                    )}
                    {line.isRentalIncome && (
                      <Badge variant="outline" className="ml-1 text-xs text-green-600 border-green-600">
                        Miete
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Import Button */}
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={handleReset}>
            Abbrechen
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={isImporting || stats.selectedCount === 0 || !bankAccountId}
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {stats.selectedCount} Buchungen importieren
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
