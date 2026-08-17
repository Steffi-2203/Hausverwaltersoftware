import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Calculator, Euro, Building, Info, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const bundeslaender = [
  "Wien", "Niederösterreich", "Oberösterreich", "Salzburg",
  "Tirol", "Vorarlberg", "Steiermark", "Kärnten", "Burgenland",
];

const kategorien = [
  { value: "A", label: "Kategorie A" },
  { value: "B", label: "Kategorie B" },
  { value: "C", label: "Kategorie C" },
  { value: "D_brauchbar", label: "Kategorie D (brauchbar)" },
  { value: "D_unbrauchbar", label: "Kategorie D (unbrauchbar)" },
];

function formatEur(value: number): string {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function Richtwertmietzins() {
  const { data: referenceValues } = useQuery<{
    richtwerte: Record<string, number>;
    kategorien: Record<string, number>;
    stand: string;
  }>({
    queryKey: ["/api/richtwert/values"],
  });

  const richtwerte = referenceValues?.richtwerte ?? {
    "Wien": 6.67, "Niederösterreich": 6.85, "Oberösterreich": 7.23,
    "Salzburg": 9.22, "Tirol": 8.14, "Vorarlberg": 10.25,
    "Steiermark": 9.21, "Kärnten": 7.81, "Burgenland": 6.09,
  };

  const kategorieRates = referenceValues?.kategorien ?? {
    "A": 4.47, "B": 3.35, "C": 2.24, "D_brauchbar": 2.24, "D_unbrauchbar": 1.12,
  };

  const [bundesland, setBundesland] = useState("Wien");
  const [nutzflaeche, setNutzflaeche] = useState(60);
  const [lagezuschlag, setLagezuschlag] = useState(0);
  const [ausstattung, setAusstattung] = useState(0);
  const [balkonTerrasse, setBalkonTerrasse] = useState(0);
  const [stockwerk, setStockwerk] = useState(0);
  const [aufzug, setAufzug] = useState(false);
  const [aufzugProzent, setAufzugProzent] = useState(10);
  const [befristung, setBefristung] = useState(false);
  const [moeblierung, setMoeblierung] = useState(0);
  const [zustand, setZustand] = useState(0);
  const [garageStellplatz, setGarageStellplatz] = useState(0);

  const [katKategorie, setKatKategorie] = useState("A");
  const [katNutzflaeche, setKatNutzflaeche] = useState(60);

  const richtwertCalc = useMemo(() => {
    const baseRichtwert = richtwerte[bundesland] ?? 0;
    const baseRent = nutzflaeche * baseRichtwert;

    let stockwerkProzent = 0;
    if (stockwerk > 0) {
      stockwerkProzent = Math.min(stockwerk * 3, 10);
    } else if (stockwerk < 0) {
      stockwerkProzent = Math.max(stockwerk * 5, -5);
    }

    const aufzugValue = aufzug ? aufzugProzent : 0;
    const befristungValue = befristung ? -25 : 0;

    const surcharges = [
      { label: "Lagezuschlag", prozent: lagezuschlag, betrag: baseRent * (lagezuschlag / 100) },
      { label: "Ausstattung", prozent: ausstattung, betrag: baseRent * (ausstattung / 100) },
      { label: "Balkon/Terrasse", prozent: balkonTerrasse, betrag: baseRent * (balkonTerrasse / 100) },
      { label: "Stockwerk", prozent: stockwerkProzent, betrag: baseRent * (stockwerkProzent / 100) },
      { label: "Aufzug", prozent: aufzugValue, betrag: baseRent * (aufzugValue / 100) },
      { label: "Befristungsabschlag", prozent: befristungValue, betrag: baseRent * (befristungValue / 100) },
      { label: "Möblierung", prozent: moeblierung, betrag: baseRent * (moeblierung / 100) },
      { label: "Zustand", prozent: zustand, betrag: baseRent * (zustand / 100) },
    ];

    const sumPercent = surcharges.reduce((s, c) => s + c.prozent, 0);
    const adjustedRent = baseRent * (1 + sumPercent / 100);
    const finalRent = adjustedRent + garageStellplatz;
    const totalSurchargesAmount = finalRent - baseRent;

    return {
      baseRichtwert,
      baseRent,
      surcharges,
      garageStellplatz,
      sumPercent,
      totalSurchargesAmount,
      monatsmiete: finalRent,
      jahresmiete: finalRent * 12,
    };
  }, [bundesland, nutzflaeche, lagezuschlag, ausstattung, balkonTerrasse, stockwerk, aufzug, aufzugProzent, befristung, moeblierung, zustand, garageStellplatz, richtwerte]);

  const kategorieCalc = useMemo(() => {
    const rate = kategorieRates[katKategorie] ?? 0;
    const monatsmiete = katNutzflaeche * rate;
    return { rate, monatsmiete, jahresmiete: monatsmiete * 12 };
  }, [katKategorie, katNutzflaeche, kategorieRates]);

  return (
    <MainLayout title="Mietzinsrechner" subtitle="Richtwertmietzins & Kategoriemietzins nach MRG">
      {/* PUNKT 4 — Richtwert ehrlich kennzeichnen:
          Dieser Rechner ist eine Rechenhilfe, KEINE rechtsverbindliche Prüfung.
          Kein Verwalter soll den Eindruck bekommen, eine berechnete Zahl sei geprüft. */}
      <Alert className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertDescription className="text-amber-800 dark:text-amber-200">
          <strong>Rechenhilfe — keine rechtsverbindliche Zulässigkeitsprüfung.</strong>{" "}
          Dieser Rechner zeigt einen orientierenden Richtwert nach § 16 MRG.
          Er ersetzt <em>keine</em> anwaltliche Prüfung des zulässigen Hauptmietzinses.
          Zu-/Abschläge (Lage, Ausstattung, Befristung) sind im Einzelfall zu beurteilen
          und vom Rechtsanwalt oder der Schlichtungsstelle zu bestätigen.
          Die hier errechneten Beträge begründen keinen Anspruch.
        </AlertDescription>
      </Alert>
      <Tabs defaultValue="richtwert" className="space-y-4">
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="richtwert" data-testid="tab-richtwert">
            <Calculator className="h-4 w-4 mr-2" />
            Richtwertmietzins
          </TabsTrigger>
          <TabsTrigger value="kategorie" data-testid="tab-kategorie">
            <Building className="h-4 w-4 mr-2" />
            Kategoriemietzins
          </TabsTrigger>
        </TabsList>

        <TabsContent value="richtwert" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Grunddaten
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bundesland">Bundesland</Label>
                      <Select value={bundesland} onValueChange={setBundesland} data-testid="select-bundesland">
                        <SelectTrigger data-testid="select-bundesland-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {bundeslaender.map((bl) => (
                            <SelectItem key={bl} value={bl} data-testid={`option-bundesland-${bl}`}>
                              {bl}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nutzflaeche">Nutzfläche (m²)</Label>
                      <Input
                        id="nutzflaeche"
                        type="number"
                        min={1}
                        step={0.5}
                        value={nutzflaeche}
                        onChange={(e) => setNutzflaeche(parseFloat(e.target.value) || 0)}
                        data-testid="input-nutzflaeche"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      Richtwert für {bundesland}: <strong>{formatEur(richtwertCalc.baseRichtwert)}/m²</strong>
                      {referenceValues?.stand && <span className="ml-1">(Stand: {referenceValues.stand})</span>}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Zu- und Abschläge</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Lagezuschlag</Label>
                      <Badge variant={lagezuschlag >= 0 ? "default" : "destructive"} className="text-xs">
                        {lagezuschlag > 0 ? "+" : ""}{lagezuschlag}%
                      </Badge>
                    </div>
                    <Slider
                      min={-30}
                      max={100}
                      step={1}
                      value={[lagezuschlag]}
                      onValueChange={([v]) => setLagezuschlag(v)}
                      data-testid="slider-lagezuschlag"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>-30%</span>
                      <span>+100%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Ausstattung</Label>
                      <Badge className="text-xs">
                        +{ausstattung}%
                      </Badge>
                    </div>
                    <Slider
                      min={0}
                      max={50}
                      step={1}
                      value={[ausstattung]}
                      onValueChange={([v]) => setAusstattung(v)}
                      data-testid="slider-ausstattung"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0%</span>
                      <span>+50%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Balkon/Terrasse</Label>
                      <Badge className="text-xs">
                        +{balkonTerrasse}%
                      </Badge>
                    </div>
                    <Slider
                      min={0}
                      max={10}
                      step={1}
                      value={[balkonTerrasse]}
                      onValueChange={([v]) => setBalkonTerrasse(v)}
                      data-testid="slider-balkon"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0%</span>
                      <span>+10%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="stockwerk">Stockwerk (OG)</Label>
                      <Input
                        id="stockwerk"
                        type="number"
                        min={-1}
                        max={20}
                        value={stockwerk}
                        onChange={(e) => setStockwerk(parseInt(e.target.value) || 0)}
                        data-testid="input-stockwerk"
                      />
                      <p className="text-xs text-muted-foreground">
                        Ergibt: {stockwerk > 0 ? `+${Math.min(stockwerk * 3, 10)}%` : stockwerk < 0 ? `${Math.max(stockwerk * 5, -5)}%` : "0%"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="garage">Garage/Stellplatz (EUR)</Label>
                      <Input
                        id="garage"
                        type="number"
                        min={0}
                        step={10}
                        value={garageStellplatz}
                        onChange={(e) => setGarageStellplatz(parseFloat(e.target.value) || 0)}
                        data-testid="input-garage"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="aufzug"
                        checked={aufzug}
                        onCheckedChange={(v) => setAufzug(v === true)}
                        data-testid="checkbox-aufzug"
                      />
                      <Label htmlFor="aufzug" className="flex-1">Aufzug vorhanden</Label>
                      {aufzug && (
                        <div className="flex items-center gap-2">
                          <Slider
                            min={5}
                            max={15}
                            step={1}
                            value={[aufzugProzent]}
                            onValueChange={([v]) => setAufzugProzent(v)}
                            className="w-24"
                            data-testid="slider-aufzug"
                          />
                          <Badge className="text-xs">+{aufzugProzent}%</Badge>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="befristung"
                        checked={befristung}
                        onCheckedChange={(v) => setBefristung(v === true)}
                        data-testid="checkbox-befristung"
                      />
                      <Label htmlFor="befristung" className="flex-1">Befristeter Mietvertrag</Label>
                      {befristung && (
                        <Badge variant="destructive" className="text-xs">-25%</Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Möblierung</Label>
                      <Badge className="text-xs">
                        +{moeblierung}%
                      </Badge>
                    </div>
                    <Slider
                      min={0}
                      max={30}
                      step={1}
                      value={[moeblierung]}
                      onValueChange={([v]) => setMoeblierung(v)}
                      data-testid="slider-moeblierung"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0%</span>
                      <span>+30%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Zustand</Label>
                      <Badge variant={zustand >= 0 ? "default" : "destructive"} className="text-xs">
                        {zustand > 0 ? "+" : ""}{zustand}%
                      </Badge>
                    </div>
                    <Slider
                      min={-20}
                      max={20}
                      step={1}
                      value={[zustand]}
                      onValueChange={([v]) => setZustand(v)}
                      data-testid="slider-zustand"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>-20%</span>
                      <span>+20%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Euro className="h-5 w-5" />
                    Berechnung
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Grundmiete ({nutzflaeche} m² × {formatEur(richtwertCalc.baseRichtwert)})</span>
                    <span className="font-medium" data-testid="text-base-rent">{formatEur(richtwertCalc.baseRent)}</span>
                  </div>

                  <div className="border-t pt-2 space-y-1.5">
                    {richtwertCalc.surcharges.filter(s => s.prozent !== 0).map((s) => (
                      <div key={s.label} className="flex justify-between text-sm">
                        <span className={s.prozent > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                          {s.label} ({s.prozent > 0 ? "+" : ""}{s.prozent}%)
                        </span>
                        <span className={s.prozent > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                          {s.betrag > 0 ? "+" : ""}{formatEur(s.betrag)}
                        </span>
                      </div>
                    ))}
                    {garageStellplatz > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-green-600 dark:text-green-400">Garage/Stellplatz (fix)</span>
                        <span className="text-green-600 dark:text-green-400">+{formatEur(garageStellplatz)}</span>
                      </div>
                    )}
                  </div>

                  {(richtwertCalc.surcharges.some(s => s.prozent !== 0) || garageStellplatz > 0) && (
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className="text-muted-foreground">Zu-/Abschläge gesamt</span>
                      <span className={richtwertCalc.totalSurchargesAmount >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                        {richtwertCalc.totalSurchargesAmount >= 0 ? "+" : ""}{formatEur(richtwertCalc.totalSurchargesAmount)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-2 border-primary">
                <CardContent className="pt-6 space-y-4">
                  <div className="text-center space-y-1">
                    <p className="text-sm text-muted-foreground">Monatsmiete</p>
                    <p className="text-3xl font-bold" data-testid="text-monatsmiete">
                      {formatEur(richtwertCalc.monatsmiete)}
                    </p>
                  </div>
                  <div className="text-center space-y-1 border-t pt-3">
                    <p className="text-sm text-muted-foreground">Jahresmiete</p>
                    <p className="text-xl font-semibold" data-testid="text-jahresmiete">
                      {formatEur(richtwertCalc.jahresmiete)}
                    </p>
                  </div>
                  <div className="text-center pt-2">
                    <Badge variant="outline" className="text-xs">
                      §16 Abs 2 MRG — Richtwertmietzins
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Hinweis:</strong> Diese Berechnung dient als Orientierung und ersetzt keine rechtliche Beratung.</p>
                    <p>Die Richtwerte werden regelmäßig per Verordnung angepasst.</p>
                    <p>Zu- und Abschläge sind individuell und können abweichen.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="kategorie" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Kategoriemietzins berechnen
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="kat-kategorie">Ausstattungskategorie</Label>
                      <Select value={katKategorie} onValueChange={setKatKategorie}>
                        <SelectTrigger data-testid="select-kategorie-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {kategorien.map((k) => (
                            <SelectItem key={k.value} value={k.value} data-testid={`option-kategorie-${k.value}`}>
                              {k.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kat-nutzflaeche">Nutzfläche (m²)</Label>
                      <Input
                        id="kat-nutzflaeche"
                        type="number"
                        min={1}
                        step={0.5}
                        value={katNutzflaeche}
                        onChange={(e) => setKatNutzflaeche(parseFloat(e.target.value) || 0)}
                        data-testid="input-kat-nutzflaeche"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      Höchstzulässiger Mietzins für {kategorien.find(k => k.value === katKategorie)?.label}: <strong>{formatEur(kategorieCalc.rate)}/m²</strong>
                    </span>
                  </div>

                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground space-y-2">
                        <p><strong>Kategorie A:</strong> Wohnung in brauchbarem Zustand mit mindestens Zimmer, Küche/Kochnische, Vorraum, WC, Badegelegenheit (Baderaum oder Badenische) und Zentralheizung oder Etagenheizung.</p>
                        <p><strong>Kategorie B:</strong> Wie A, jedoch ohne Zentralheizung/Etagenheizung.</p>
                        <p><strong>Kategorie C:</strong> Wohnung in brauchbarem Zustand mit WC und Wasserentnahme im Inneren.</p>
                        <p><strong>Kategorie D (brauchbar):</strong> Wohnung in brauchbarem Zustand ohne WC oder Wasserentnahme im Inneren.</p>
                        <p><strong>Kategorie D (unbrauchbar):</strong> Wohnung in unbrauchbarem Zustand.</p>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="border-2 border-primary">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fläche</span>
                    <span className="font-medium">{katNutzflaeche} m²</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Satz</span>
                    <span className="font-medium">{formatEur(kategorieCalc.rate)}/m²</span>
                  </div>
                  <div className="border-t pt-3 text-center space-y-1">
                    <p className="text-sm text-muted-foreground">Monatsmiete</p>
                    <p className="text-3xl font-bold" data-testid="text-kat-monatsmiete">
                      {formatEur(kategorieCalc.monatsmiete)}
                    </p>
                  </div>
                  <div className="text-center space-y-1 border-t pt-3">
                    <p className="text-sm text-muted-foreground">Jahresmiete</p>
                    <p className="text-xl font-semibold" data-testid="text-kat-jahresmiete">
                      {formatEur(kategorieCalc.jahresmiete)}
                    </p>
                  </div>
                  <div className="text-center pt-2">
                    <Badge variant="outline" className="text-xs">
                      §15a MRG — Kategoriemietzins
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Hinweis:</strong> Der Kategoriemietzins gilt für Mietverträge, die vor dem 1.3.1994 abgeschlossen wurden.</p>
                    <p>Die Kategoriebeträge werden jährlich valorisiert.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}
