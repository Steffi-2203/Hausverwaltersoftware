import { BookOpen, Home, Building2, Users, CreditCard, Calculator, FileText, List } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { helpTexts } from '@/lib/helpTexts';

interface HandbookChapter {
  id: string;
  title: string;
  icon: React.ReactNode;
  sections: {
    title: string;
    content: string;
  }[];
}

const chapters: HandbookChapter[] = [
  {
    id: 'start',
    title: 'Schnellstart',
    icon: <Home className="h-4 w-4" />,
    sections: [
      {
        title: 'Übersicht der Software',
        content: `ImmoFlow ist eine spezialisierte Software für die Verwaltung von Mietliegenschaften in Österreich. 
        
Die Software unterstützt Sie bei:
• Verwaltung von Liegenschaften und Einheiten
• Mieterverwaltung mit Vertragsdetails
• Banking und Zahlungsverfolgung
• Betriebskostenabrechnung nach MRG
• Berichte und Auswertungen

Das Dashboard gibt Ihnen einen schnellen Überblick über alle wichtigen Kennzahlen.`,
      },
      {
        title: 'Erste Liegenschaft anlegen',
        content: `1. Klicken Sie in der Navigation auf "Liegenschaften"
2. Klicken Sie auf "Neue Liegenschaft"
3. Füllen Sie die Grunddaten aus:
   • Name der Liegenschaft
   • Adresse (Straße, PLZ, Ort)
   • Baujahr und Gesamtfläche
   • MRG-relevante Daten (falls zutreffend)
4. Speichern Sie die Liegenschaft

Nach dem Anlegen können Sie Einheiten und Eigentümer hinzufügen.`,
      },
      {
        title: 'Einheiten erstellen',
        content: `1. Öffnen Sie die Liegenschaft
2. Klicken Sie auf "Neue Einheit"
3. Wählen Sie den Typ (Wohnung, Geschäft, Garage etc.)
4. Geben Sie ein:
   • Top-Nummer (z.B. "Top 1", "W1")
   • Nutzfläche in m²
   • MEA-Anteil in ‰
   • Stockwerk (optional)
5. Bei MRG-Anwendung: Ausstattungskategorie wählen
6. Speichern

Wiederholen Sie dies für alle Einheiten der Liegenschaft.`,
      },
      {
        title: 'Mieter hinzufügen',
        content: `1. Gehen Sie zu "Mieter" in der Navigation
2. Klicken Sie auf "Neuer Mieter"
3. Wählen Sie die Einheit aus
4. Geben Sie die Mieterdaten ein:
   • Vor- und Nachname
   • Kontaktdaten (E-Mail, Telefon)
   • Mietbeginn und ggf. Mietende
5. Legen Sie die Mietkonditionen fest:
   • Grundmiete (netto)
   • BK-Vorschuss
   • Heizkosten-Vorschuss
   • Kaution
6. Optional: SEPA-Mandat mit Bankverbindung
7. Speichern`,
      },
    ],
  },
  {
    id: 'properties',
    title: 'Liegenschaften',
    icon: <Building2 className="h-4 w-4" />,
    sections: [
      {
        title: 'Liegenschaft bearbeiten',
        content: `Klicken Sie auf eine Liegenschaft, um die Detailansicht zu öffnen. Dort können Sie:

• Stammdaten ändern (Name, Adresse)
• MRG-Einstellungen anpassen
• Gesamtkosten für BK und Heizung eintragen
• Kostenaufteilung zwischen Nutzungsarten festlegen

Änderungen werden nach dem Speichern sofort übernommen.`,
      },
      {
        title: 'Eigentümer hinzufügen',
        content: `In der Liegenschaftsansicht finden Sie den Bereich "Eigentümer":

1. Klicken Sie auf "Eigentümer hinzufügen"
2. Geben Sie Name und Kontaktdaten ein
3. Legen Sie den Eigentumsanteil fest (in %)
4. Hinterlegen Sie die Bankverbindung für Auszahlungen
5. Markieren Sie den Haupteigentümer

Bei mehreren Eigentümern müssen die Anteile 100% ergeben.`,
      },
      {
        title: 'Dokumente hochladen',
        content: `Sie können relevante Dokumente zur Liegenschaft speichern:

• Grundbuchauszüge
• Nutzwertgutachten
• Versicherungspolizzen
• Wartungsverträge
• Bescheide

Klicken Sie auf "Dokument hinzufügen" und wählen Sie die Datei aus. Unterstützte Formate: PDF, JPG, PNG.`,
      },
    ],
  },
  {
    id: 'units',
    title: 'Einheiten',
    icon: <Home className="h-4 w-4" />,
    sections: [
      {
        title: 'Einheitstypen',
        content: `Die Software unterscheidet folgende Einheitstypen:

• Wohnung: Hauptwohneinheiten
• Geschäft: Gewerblich genutzte Einheiten
• Garage: PKW-Abstellplätze in Garagengebäuden
• Stellplatz: Einzelne PKW-Stellplätze
• Lager: Kellerabteile, Lagerräume
• Sonstiges: Alle anderen Nutzungsarten

Der Einheitstyp beeinflusst die BK-Kostenverteilung.`,
      },
      {
        title: 'MEA und Nutzwert verstehen',
        content: `MEA (Miteigentumsanteile) in Promille (‰):
• Bestimmen den Anteil am Gesamtobjekt
• Stehen im Grundbuch oder Nutzwertgutachten
• Summe aller MEA = 1000‰

Nutzwert:
• Berechnet nach §9 WEG 2002
• Basiert auf Nutzfläche und Zuschlägen
• Relevant für WEG-Abrechnungen

Die MEA werden für viele Kostenverteilungen verwendet.`,
      },
      {
        title: 'MRG-Einstellungen',
        content: `Für jede Einheit können Sie den MRG-Anwendungsbereich festlegen:

Vollanwendung:
• Altbau vor 1945/1953
• Strenge Mietzinsbeschränkungen
• Richtwertmiete gilt

Teilanwendung:
• Kündigungsschutz gilt
• Freie Mietzinsvereinbarung

Ausgenommen:
• Neubauten nach 1945/1953
• Nur ABGB-Regelungen

Bei Vollanwendung: Ausstattungskategorie (A-D) und Richtwert-Basis eintragen.`,
      },
    ],
  },
  {
    id: 'tenants',
    title: 'Mieterverwaltung',
    icon: <Users className="h-4 w-4" />,
    sections: [
      {
        title: 'Mietverträge anlegen',
        content: `Beim Anlegen eines Mieters erfassen Sie alle Vertragsdaten:

Pflichtfelder:
• Vor- und Nachname
• Einheit
• Mietbeginn
• Grundmiete

Optionale Felder:
• Mietende (bei befristeten Verträgen)
• Kontaktdaten
• BK- und HK-Vorschuss
• Kaution

Der Status wird automatisch verwaltet: aktiv, beendet oder Leerstand.`,
      },
      {
        title: 'SEPA-Lastschrift einrichten',
        content: `Für automatische Abbuchungen:

1. Aktivieren Sie "SEPA-Lastschriftmandat erteilt"
2. Geben Sie die IBAN des Mieters ein
3. Optional: BIC eingeben
4. Mandatsreferenz vergeben

Die Mandatsreferenz sollte eindeutig sein, z.B. "MV-2024-001".

Hinweis: Die Software erstellt keine SEPA-Dateien, sondern dokumentiert nur das Mandat.`,
      },
      {
        title: 'Mietanpassungen',
        content: `Bei Mietänderungen:

1. Öffnen Sie den Mieter
2. Passen Sie die Beträge an:
   • Grundmiete
   • BK-Vorschuss
   • HK-Vorschuss
3. Speichern

Die Änderung gilt ab dem Speicherdatum. Historische Daten bleiben erhalten.

Bei MRG-Vollanwendung beachten: Richtwertanpassungen sind nur zu bestimmten Terminen möglich.`,
      },
    ],
  },
  {
    id: 'banking',
    title: 'Banking & Zahlungen',
    icon: <CreditCard className="h-4 w-4" />,
    sections: [
      {
        title: 'Bankdaten importieren',
        content: `CSV-Import:
1. Exportieren Sie Ihre Kontoauszüge als CSV
2. Gehen Sie zu "Banking"
3. Klicken Sie auf "Import"
4. Wählen Sie die CSV-Datei
5. Prüfen Sie die Zuordnung der Spalten
6. Importieren

PDF-Import (OCR):
1. Laden Sie den PDF-Kontoauszug hoch
2. Das System erkennt die Transaktionen
3. Prüfen und bestätigen Sie die Daten`,
      },
      {
        title: 'Zahlungen zuordnen',
        content: `Automatische Zuordnung:
Das System analysiert:
• Verwendungszweck
• Betrag
• IBAN des Absenders

Bei hoher Übereinstimmung erfolgt automatische Zuordnung.

Manuelle Zuordnung:
1. Klicken Sie auf die Transaktion
2. Wählen Sie den Mieter
3. Oder: Ordnen Sie einer Ausgabenkategorie zu
4. Speichern

Gelernte Zuordnungen werden für künftige Transaktionen verwendet.`,
      },
      {
        title: 'Offene Posten verwalten',
        content: `Übersicht offener Posten:
• Dashboard zeigt überfällige Zahlungen
• Zahlungsliste filtert nach Status
• Mahnwesen unterstützt bei Zahlungsrückständen

Teilzahlungen:
Wenn nur ein Teil der Miete eingeht, wird dies automatisch erkannt. Die Rechnung bleibt als "teilbezahlt" markiert.

Überzahlungen:
Gutschriften werden beim nächsten Monat verrechnet.`,
      },
      {
        title: 'Mahnwesen',
        content: `Bei überfälligen Zahlungen:

Mahnstufen:
1. Zahlungserinnerung (nach 7 Tagen)
2. 1. Mahnung (nach 14 Tagen)
3. 2. Mahnung (nach 21 Tagen)

Die Software unterstützt:
• Automatische Mahnstufen-Berechnung
• E-Mail-Versand von Mahnungen
• Dokumentation aller Mahnungen

Mahnstufen können manuell angepasst werden.`,
      },
    ],
  },
  {
    id: 'costs',
    title: 'Betriebskosten',
    icon: <Calculator className="h-4 w-4" />,
    sections: [
      {
        title: 'Verteilungsschlüssel einrichten',
        content: `Unter Einstellungen → Verteilungsschlüssel:

Standard-Schlüssel:
• MEA (Miteigentumsanteile)
• Nutzfläche (m²)
• Personenanzahl
• Verbrauch

MRG-konforme Schlüssel:
Das System zeigt, welche Schlüssel nach §21 MRG zulässig sind.

Eigene Schlüssel:
Sie können zusätzliche Schlüssel definieren, z.B. für Garten- oder Liftnutzung.`,
      },
      {
        title: 'Kosten erfassen',
        content: `Ausgaben erfassen unter "Ausgaben":

1. Klicken Sie auf "Neue Ausgabe"
2. Wählen Sie die Liegenschaft
3. Kategorie auswählen (Wasser, Müll, etc.)
4. Betrag und Datum eingeben
5. Optional: Beleg hochladen
6. Speichern

Die Kosten werden automatisch der richtigen Abrechnungsperiode zugeordnet.`,
      },
      {
        title: 'BK-Abrechnung erstellen',
        content: `Jährliche Abrechnung:

1. Gehen Sie zu "Betriebskosten"
2. Wählen Sie Liegenschaft und Jahr
3. Prüfen Sie die Kostenaufstellung
4. System berechnet:
   • Gesamtkosten pro Kategorie
   • Verteilung nach Schlüsseln
   • Vorschussverrechnung
   • Nachzahlung oder Guthaben
5. PDF-Export für jeden Mieter

Frist: Abrechnung bis 30. Juni des Folgejahres (§21 MRG).`,
      },
      {
        title: 'PDF-Export',
        content: `Abrechnungs-PDF enthält:

• Abrechnungszeitraum
• Kostenaufstellung nach Kategorien
• Verteilungsschlüssel und Anteile
• Vorschusszahlungen
• Saldo (Nachzahlung/Guthaben)

Export-Optionen:
• Einzelne Mieterabrechnung
• Gesamtübersicht Liegenschaft
• Eigentümerabrechnung

Die PDFs können per E-Mail versendet oder gedruckt werden.`,
      },
    ],
  },
  {
    id: 'reports',
    title: 'Berichte',
    icon: <FileText className="h-4 w-4" />,
    sections: [
      {
        title: 'USt-Voranmeldung',
        content: `Unter "Berichte" finden Sie die USt-Übersicht:

• Einnahmen nach Steuersätzen (10%, 20%)
• Ausgaben mit Vorsteuerabzug
• Berechnung der Zahllast

Export als PDF oder CSV für Ihren Steuerberater.

Hinweis: Die Übersicht ersetzt keine steuerliche Beratung.`,
      },
      {
        title: 'Eigentümerabrechnung',
        content: `Jährliche Abrechnung für Eigentümer:

Inhalt:
• Mieteinnahmen nach Einheiten
• Betriebskosten-Einnahmen und -Ausgaben
• Sonstige Kosten (Reparaturen, etc.)
• Nettoergebnis

Bei mehreren Eigentümern: Aufteilung nach Anteilen.`,
      },
      {
        title: 'Statistiken',
        content: `Dashboard und Berichte zeigen:

• Leerstandsquote
• Mieteinnahmen über Zeit
• Zahlungsverhalten
• Offene Forderungen
• Kostenentwicklung

Zeiträume: Monat, Quartal, Jahr oder individuell.`,
      },
    ],
  },
  {
    id: 'glossary',
    title: 'Glossar',
    icon: <List className="h-4 w-4" />,
    sections: Object.entries(helpTexts)
      .sort(([a], [b]) => a.localeCompare(b, 'de'))
      .map(([key, text]) => ({
        title: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        content: text,
      })),
  },
];

export function HandbookSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Benutzerhandbuch
        </CardTitle>
        <CardDescription>
          Schritt-für-Schritt Anleitungen zu allen Funktionen
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="start" className="w-full">
          <ScrollArea className="w-full">
            <TabsList className="inline-flex w-auto mb-4">
              {chapters.map((chapter) => (
                <TabsTrigger
                  key={chapter.id}
                  value={chapter.id}
                  className="flex items-center gap-1.5 whitespace-nowrap"
                >
                  {chapter.icon}
                  <span className="hidden sm:inline">{chapter.title}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </ScrollArea>

          {chapters.map((chapter) => (
            <TabsContent key={chapter.id} value={chapter.id} className="mt-0">
              <div className="space-y-6">
                {chapter.sections.map((section, index) => (
                  <div key={index} className="space-y-2">
                    <h4 className="font-semibold text-foreground">
                      {section.title}
                    </h4>
                    <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                      {section.content}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
