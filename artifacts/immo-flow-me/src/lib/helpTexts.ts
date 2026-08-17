// Zentrale Sammlung aller Hilfetexte für Fachbegriffe
export const helpTexts = {
  // Einheiten-bezogene Begriffe
  mea: "Miteigentumsanteil - Der prozentuale Anteil einer Einheit am Gesamtobjekt für die BK-Verteilung.",
  qm: "Quadratmeter - Die Wohnfläche der Einheit in m².",
  nutzwert: "Der Nutzwert bestimmt den Anteil einer Einheit an den Gesamtkosten nach dem WEG.",
  nutzflaeche_mrg: "Die Nutzfläche gemäß MRG (Mietrechtsgesetz) kann von der tatsächlichen m²-Zahl abweichen.",
  mrg_scope: "Anwendungsbereich des Mietrechtsgesetzes: Vollanwendung, Teilanwendung oder Ausgenommen.",
  ausstattungskategorie: "Kategorie A bis D gemäß MRG: Bestimmt die Richtwertmiete basierend auf der Ausstattung der Wohnung.",
  richtwertmiete_basis: "Basis für die Richtwertmiete je m² gemäß dem österreichischen Richtwertgesetz.",
  
  // Mieter-bezogene Begriffe
  grundmiete: "Nettomiete ohne Betriebskosten und Heizkosten.",
  betriebskosten: "BK-Vorschuss - Monatliche Vorauszahlung für Betriebskosten, wird jährlich abgerechnet.",
  heizkosten: "HK-Vorschuss - Monatliche Vorauszahlung für Heizung, wird jährlich abgerechnet.",
  kaution: "Mietkaution - Sicherheitsleistung des Mieters, üblicherweise 3 Bruttomonatsmieten.",
  sepa_mandat: "SEPA-Lastschrift ermöglicht den automatischen Einzug der Miete vom Konto des Mieters.",
  mietbeginn: "Beginn des Mietverhältnisses - ab diesem Datum werden Sollstellungen erzeugt.",
  mietende: "Ende des Mietverhältnisses - leer lassen für unbefristete Verträge.",
  mandat_reference: "SEPA-Mandatsreferenz - Eindeutige Kennung für das Lastschriftmandat.",
  
  // Verteilungsschlüssel
  vs_personen: "Anzahl der Personen für personenabhängige Kosten (z.B. Müllabfuhr, Wasserverbrauch).",
  vs_qm: "Quadratmeter als Verteilungsschlüssel für flächenabhängige Kosten.",
  vs_mea: "Miteigentumsanteil als Verteilungsschlüssel.",
  vs_heizung_verbrauch: "Heizungsverbrauch für die verbrauchsabhängige Abrechnung.",
  vs_wasser_verbrauch: "Wasserverbrauch für die verbrauchsabhängige Abrechnung.",
  vs_lift_wohnung: "Liftkosten-Anteil für Wohnungen (oft nach Stockwerk gestaffelt).",
  vs_lift_geschaeft: "Liftkosten-Anteil für Geschäftslokale.",
  vs_ruecklage: "Beitrag zur Instandhaltungsrücklage des Gebäudes.",
  vs_garten: "Anteil an den Gartenkosten (falls vorhanden).",
  
  // Liegenschafts-bezogene Begriffe
  total_mea: "Summe aller Miteigentumsanteile - sollte 100% oder 1000 Anteile ergeben.",
  total_qm: "Gesamtfläche aller Einheiten in Quadratmetern.",
  total_units: "Anzahl der Einheiten in dieser Liegenschaft.",
  baujahr_mrg: "Baujahr relevant für die MRG-Einordnung der Liegenschaft.",
  richtwert_bundesland: "Bundesland für die Richtwertberechnung gemäß österreichischem Richtwertgesetz.",
  
  // BK-Abrechnungs-Begriffe
  bk_anteil_wohnung: "Prozentsatz der Betriebskosten, der auf Wohnungen entfällt.",
  bk_anteil_geschaeft: "Prozentsatz der Betriebskosten, der auf Geschäftslokale entfällt.",
  bk_anteil_garage: "Prozentsatz der Betriebskosten, der auf Garagen/Stellplätze entfällt.",
  heizung_anteil_wohnung: "Prozentsatz der Heizkosten, der auf Wohnungen entfällt.",
  heizung_anteil_geschaeft: "Prozentsatz der Heizkosten, der auf Geschäftslokale entfällt.",
  
  // Banking-Begriffe
  iban: "Internationale Bankkontonummer für SEPA-Zahlungen.",
  bic: "Bank Identifier Code (SWIFT-Code) der Bank.",
  transaction_date: "Datum der Buchung auf dem Bankkonto.",
  counterpart_name: "Name des Zahlenden oder Empfängers der Transaktion.",
};

export type HelpTextKey = keyof typeof helpTexts;
