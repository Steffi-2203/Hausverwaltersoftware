import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calculator, Info, AlertTriangle, TrendingUp, Calendar, Building2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useProperties } from "@/hooks/useProperties";
import { useUnits } from "@/hooks/useUnits";
import { useTenants } from "@/hooks/useTenants";

type RentType = 'kategoriemiete' | 'richtwertmiete' | 'freier_markt';

interface IndexationResult {
  allowedIncreasePercent: number;
  newRent: number;
  increaseAmount: number;
  explanation: string;
  nextIndexationDate: Date;
  isApplicable: boolean;
  notApplicableReason?: string;
}

export function RentIndexationCalculator() {
  const { data: properties } = useProperties();
  const { data: units } = useUnits();
  const { data: tenants } = useTenants();
  
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [currentRent, setCurrentRent] = useState<string>("850");
  const [inflationRate, setInflationRate] = useState<string>("4.5");
  const [rentType, setRentType] = useState<RentType>("richtwertmiete");
  const [indexationYear, setIndexationYear] = useState<string>("2026");
  const [lastIndexationDate, setLastIndexationDate] = useState<string>("2025-04-01");
  const [isEinZweifamilienhaus, setIsEinZweifamilienhaus] = useState(false);
  const [result, setResult] = useState<IndexationResult | null>(null);
  
  // Filter units and tenants by selected property
  const propertyUnits = units?.filter(u => u.propertyId === selectedPropertyId) || [];
  const propertyTenants = tenants?.filter(t => {
    const unit = units?.find(u => u.id === t.unitId);
    return unit?.propertyId === selectedPropertyId && t.status === 'aktiv';
  }) || [];
  
  // Auto-fill rent when tenant is selected
  useEffect(() => {
    if (selectedTenantId) {
      const tenant = tenants?.find(t => t.id === selectedTenantId);
      if (tenant) {
        const rent = Number(tenant.grundmiete) || 0;
        setCurrentRent(rent.toFixed(2));
      }
    }
  }, [selectedTenantId, tenants]);

  const calculateHaelfteRegelung = (inflation: number): number => {
    const baseRate = Math.min(inflation, 3);
    const excessRate = Math.max(0, (inflation - 3) * 0.5);
    return baseRate + excessRate;
  };

  const calculateNextIndexationDate = (lastDate: Date): Date => {
    const nextYear = lastDate.getFullYear() + 1;
    const nextApril1 = new Date(nextYear, 3, 1);
    
    const oneYearFromLast = new Date(lastDate);
    oneYearFromLast.setFullYear(oneYearFromLast.getFullYear() + 1);

    if (oneYearFromLast > nextApril1) {
      return new Date(nextYear + 1, 3, 1);
    }

    return nextApril1;
  };

  const handleCalculate = () => {
    const rent = parseFloat(currentRent);
    const inflation = parseFloat(inflationRate);
    const year = parseInt(indexationYear);
    const lastDate = new Date(lastIndexationDate);

    if (isNaN(rent) || rent <= 0 || isNaN(inflation) || inflation < 0 || isNaN(year) || isNaN(lastDate.getTime())) {
      setResult({
        allowedIncreasePercent: 0,
        newRent: rent || 0,
        increaseAmount: 0,
        explanation: 'Bitte geben Sie gültige Werte ein (positive Miete, nicht-negative Inflation, gültiges Datum).',
        nextIndexationDate: new Date(),
        isApplicable: false,
        notApplicableReason: 'Ungültige Eingabewerte.'
      });
      return;
    }

    const today = new Date();
    const oneYearFromLast = new Date(lastDate);
    oneYearFromLast.setFullYear(oneYearFromLast.getFullYear() + 1);
    
    const april1OfYear = new Date(year, 3, 1);
    
    let nextPossibleDate = calculateNextIndexationDate(lastDate);
    if (nextPossibleDate < april1OfYear) {
      nextPossibleDate = april1OfYear;
    }

    if (today < april1OfYear) {
      setResult({
        allowedIncreasePercent: 0,
        newRent: rent,
        increaseAmount: 0,
        explanation: `Die Indexierung für ${year} ist frühestens am 1. April ${year} möglich. Aktuelles Datum: ${formatDate(today)}.`,
        nextIndexationDate: april1OfYear,
        isApplicable: false,
        notApplicableReason: `Indexierung frühestens ab 01.04.${year} möglich.`
      });
      return;
    }

    if (today < oneYearFromLast) {
      setResult({
        allowedIncreasePercent: 0,
        newRent: rent,
        increaseAmount: 0,
        explanation: `Die letzte Indexierung (${formatDate(lastDate)}) liegt weniger als ein Jahr zurück. Eine Indexierung ist nur einmal jährlich zulässig.`,
        nextIndexationDate: nextPossibleDate,
        isApplicable: false,
        notApplicableReason: `Nächste mögliche Indexierung: ${formatDate(nextPossibleDate)}`
      });
      return;
    }

    if (isEinZweifamilienhaus) {
      setResult({
        allowedIncreasePercent: 0,
        newRent: rent,
        increaseAmount: 0,
        explanation: 'Das Mieten-Wertsicherungsgesetz (MieWeG) ist auf Ein- und Zweifamilienhäuser nicht anwendbar.',
        nextIndexationDate: calculateNextIndexationDate(lastDate),
        isApplicable: false,
        notApplicableReason: 'Ein- und Zweifamilienhäuser sind vom MieWeG ausgenommen.'
      });
      return;
    }

    let allowedIncreasePercent: number;
    let explanation: string;

    if (rentType === 'freier_markt') {
      allowedIncreasePercent = calculateHaelfteRegelung(inflation);
      
      if (inflation <= 3) {
        explanation = `Bei einer VPI-Inflation von ${inflation.toFixed(2)}% (≤ 3%) wird die volle Inflation weitergegeben. Zulässige Erhöhung: ${allowedIncreasePercent.toFixed(2)}%.`;
      } else {
        const baseRate = 3;
        const excessInflation = inflation - 3;
        const halfExcess = excessInflation * 0.5;
        explanation = `Hälfteregelung angewendet: Bei VPI-Inflation von ${inflation.toFixed(2)}% werden die ersten 3% voll und der Überschuss von ${excessInflation.toFixed(2)}% nur zur Hälfte (${halfExcess.toFixed(2)}%) weitergegeben. Formel: min(${inflation.toFixed(2)}%, 3%) + max(0, (${inflation.toFixed(2)}% - 3%) × 0,5) = ${baseRate}% + ${halfExcess.toFixed(2)}% = ${allowedIncreasePercent.toFixed(2)}%.`;
      }
    } else {
      if (year === 2026) {
        allowedIncreasePercent = Math.min(inflation, 1);
        explanation = `Für Kategorie- und Richtwertmieten gilt 2026 eine maximale Erhöhung von 1% gemäß MieWeG. Bei einer VPI-Inflation von ${inflation.toFixed(2)}% ergibt sich eine zulässige Erhöhung von ${allowedIncreasePercent.toFixed(2)}%.`;
      } else if (year === 2027) {
        allowedIncreasePercent = Math.min(inflation, 2);
        explanation = `Für Kategorie- und Richtwertmieten gilt 2027 eine maximale Erhöhung von 2% gemäß MieWeG. Bei einer VPI-Inflation von ${inflation.toFixed(2)}% ergibt sich eine zulässige Erhöhung von ${allowedIncreasePercent.toFixed(2)}%.`;
      } else {
        allowedIncreasePercent = calculateHaelfteRegelung(inflation);
        if (inflation <= 3) {
          explanation = `Kategorie- und Richtwertmieten ab 2028: Bei einer VPI-Inflation von ${inflation.toFixed(2)}% (≤ 3%) gilt die Hälfteregelung, die volle Inflation wird weitergegeben. Zulässige Erhöhung: ${allowedIncreasePercent.toFixed(2)}%.`;
        } else {
          const baseRate = 3;
          const excessInflation = inflation - 3;
          const halfExcess = excessInflation * 0.5;
          explanation = `Kategorie- und Richtwertmieten ab 2028: Hälfteregelung angewendet. Bei VPI-Inflation von ${inflation.toFixed(2)}% werden die ersten 3% voll und der Überschuss von ${excessInflation.toFixed(2)}% nur zur Hälfte (${halfExcess.toFixed(2)}%) weitergegeben. Zulässige Erhöhung: ${baseRate}% + ${halfExcess.toFixed(2)}% = ${allowedIncreasePercent.toFixed(2)}%.`;
        }
      }
    }

    const increaseAmount = rent * (allowedIncreasePercent / 100);
    const newRent = rent + increaseAmount;

    setResult({
      allowedIncreasePercent: Math.round(allowedIncreasePercent * 100) / 100,
      newRent: Math.round(newRent * 100) / 100,
      increaseAmount: Math.round(increaseAmount * 100) / 100,
      explanation,
      nextIndexationDate: calculateNextIndexationDate(lastDate),
      isApplicable: true
    });
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('de-AT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  };

  const getRentTypeLabel = (type: RentType): string => {
    switch (type) {
      case 'kategoriemiete': return 'Kategoriemiete';
      case 'richtwertmiete': return 'Richtwertmiete';
      case 'freier_markt': return 'Freier Markt';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            MieWeG Indexierungsrechner
          </CardTitle>
          <CardDescription>
            Berechnung der zulässigen Mieterhöhung nach dem Mieten-Wertsicherungsgesetz (MieWeG) ab 2026
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Hälfteregelung</AlertTitle>
            <AlertDescription>
              Bei Inflation über 3% wird nur die Hälfte des Überschusses weitergegeben: min(VPI, 3%) + max(0, (VPI - 3%) × 0,5)
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property">Liegenschaft (optional)</Label>
              <Select value={selectedPropertyId} onValueChange={(v) => { setSelectedPropertyId(v); setSelectedTenantId(""); }}>
                <SelectTrigger id="property" data-testid="select-property">
                  <SelectValue placeholder="Liegenschaft wählen..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Manuelle Eingabe</SelectItem>
                  {properties?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenant">Mieter (optional)</Label>
              <Select 
                value={selectedTenantId} 
                onValueChange={setSelectedTenantId}
                disabled={!selectedPropertyId}
              >
                <SelectTrigger id="tenant" data-testid="select-tenant">
                  <SelectValue placeholder={selectedPropertyId ? "Mieter wählen..." : "Zuerst Liegenschaft wählen"} />
                </SelectTrigger>
                <SelectContent>
                  {propertyTenants.map((t: any) => {
                    const unit = units?.find((u: any) => u.id === t.unitId);
                    return (
                      <SelectItem key={t.id} value={t.id}>
                        {t.firstName} {t.lastName} ({unit?.topNummer || 'N/A'})
                      </SelectItem>
                    );
                  })}
                  {propertyTenants.length === 0 && (
                    <SelectItem value="" disabled>Keine aktiven Mieter</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currentRent">Aktuelle Nettomiete (EUR)</Label>
              <Input
                id="currentRent"
                type="number"
                step="0.01"
                value={currentRent}
                onChange={(e) => setCurrentRent(e.target.value)}
                placeholder="z.B. 850.00"
                data-testid="input-current-rent"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inflationRate">VPI-Inflationsrate (%)</Label>
              <Input
                id="inflationRate"
                type="number"
                step="0.1"
                value={inflationRate}
                onChange={(e) => setInflationRate(e.target.value)}
                placeholder="z.B. 4.5"
                data-testid="input-inflation-rate"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rentType">Miettyp</Label>
              <Select value={rentType} onValueChange={(v) => setRentType(v as RentType)}>
                <SelectTrigger id="rentType" data-testid="select-rent-type">
                  <SelectValue placeholder="Miettyp wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kategoriemiete">Kategoriemiete (MRG §15a)</SelectItem>
                  <SelectItem value="richtwertmiete">Richtwertmiete (MRG §16)</SelectItem>
                  <SelectItem value="freier_markt">Freier Markt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="indexationYear">Jahr der Indexierung</Label>
              <Select value={indexationYear} onValueChange={setIndexationYear}>
                <SelectTrigger id="indexationYear" data-testid="select-indexation-year">
                  <SelectValue placeholder="Jahr wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2026">2026 (max. 1% für Kat./RW)</SelectItem>
                  <SelectItem value="2027">2027 (max. 2% für Kat./RW)</SelectItem>
                  <SelectItem value="2028">2028 (Hälfteregelung)</SelectItem>
                  <SelectItem value="2029">2029 (Hälfteregelung)</SelectItem>
                  <SelectItem value="2030">2030 (Hälfteregelung)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastIndexationDate">Letzter Indexierungszeitpunkt</Label>
              <Input
                id="lastIndexationDate"
                type="date"
                value={lastIndexationDate}
                onChange={(e) => setLastIndexationDate(e.target.value)}
                data-testid="input-last-indexation-date"
              />
            </div>

            <div className="flex items-center space-x-2 pt-6">
              <Checkbox
                id="isEinZweifamilienhaus"
                checked={isEinZweifamilienhaus}
                onCheckedChange={(checked) => setIsEinZweifamilienhaus(checked as boolean)}
                data-testid="checkbox-ein-zweifamilienhaus"
              />
              <Label htmlFor="isEinZweifamilienhaus" className="text-sm">
                Ein- oder Zweifamilienhaus (MieWeG nicht anwendbar)
              </Label>
            </div>
          </div>

          <Button onClick={handleCalculate} className="w-full" data-testid="button-calculate">
            <Calculator className="mr-2 h-4 w-4" />
            Indexierung berechnen
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className={result.isApplicable ? "border-green-200 dark:border-green-800" : "border-amber-200 dark:border-amber-800"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.isApplicable ? (
                <>
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Berechnungsergebnis
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Nicht anwendbar
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.isApplicable ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-muted rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-primary" data-testid="text-increase-percent">
                      {result.allowedIncreasePercent.toFixed(2)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Zulässige Erhöhung</div>
                  </div>
                  
                  <div className="bg-muted rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600" data-testid="text-new-rent">
                      {formatCurrency(result.newRent)}
                    </div>
                    <div className="text-sm text-muted-foreground">Neue Miete</div>
                  </div>
                  
                  <div className="bg-muted rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold" data-testid="text-increase-amount">
                      +{formatCurrency(result.increaseAmount)}
                    </div>
                    <div className="text-sm text-muted-foreground">Erhöhungsbetrag</div>
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Berechnung</AlertTitle>
                  <AlertDescription data-testid="text-explanation">
                    {result.explanation}
                  </AlertDescription>
                </Alert>

                <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <span className="font-medium">Nächster möglicher Indexierungstermin: </span>
                    <Badge variant="outline" data-testid="text-next-indexation-date">
                      {formatDate(result.nextIndexationDate)}
                    </Badge>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Hinweis: Die Indexierung ist nur einmal jährlich zulässig, frühestens am 1. April.</p>
                  <p>Miettyp: <Badge variant="secondary">{getRentTypeLabel(rentType)}</Badge></p>
                </div>
              </>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ausnahme</AlertTitle>
                <AlertDescription>
                  {result.notApplicableReason}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
