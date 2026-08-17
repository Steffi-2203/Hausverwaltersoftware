import { HelpCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQCategory {
  title: string;
  items: FAQItem[];
}

const faqData: FAQCategory[] = [
  {
    title: 'Erste Schritte',
    items: [
      {
        question: 'Wie lege ich meine erste Liegenschaft an?',
        answer: 'Gehen Sie zu "Liegenschaften" in der Navigation und klicken Sie auf "Neue Liegenschaft". Füllen Sie die Grunddaten wie Name, Adresse und Gesamtfläche aus. Nach dem Speichern können Sie Einheiten und Eigentümer hinzufügen.',
      },
      {
        question: 'Wie erstelle ich Einheiten für meine Liegenschaft?',
        answer: 'Öffnen Sie die Liegenschaft und klicken Sie auf "Neue Einheit". Wählen Sie den Einheitstyp (Wohnung, Geschäft, Garage etc.), geben Sie die Top-Nummer, Fläche und MEA-Anteil ein. Die MEA (Miteigentumsanteile) werden für die Kostenverteilung benötigt.',
      },
      {
        question: 'Wie füge ich einen Mieter hinzu?',
        answer: 'Gehen Sie zu "Mieter" und klicken Sie auf "Neuer Mieter". Wählen Sie die Einheit aus, geben Sie die Mieterdaten und Mietkonditionen (Grundmiete, BK-Vorschuss, Heizkosten-Vorschuss) ein. Bei SEPA-Mandat können Sie auch die Bankverbindung hinterlegen.',
      },
    ],
  },
  {
    title: 'Mieteinnahmen & Banking',
    items: [
      {
        question: 'Wie importiere ich meine Bankkontoauszüge?',
        answer: 'Gehen Sie zu "Banking" und klicken Sie auf "Kontoauszug importieren". Sie können CSV-Dateien von Ihrer Bank hochladen oder PDF-Kontoauszüge per OCR einlesen lassen. Die Transaktionen werden automatisch importiert.',
      },
      {
        question: 'Wie funktioniert die automatische Zahlungszuordnung?',
        answer: 'Das System analysiert Verwendungszweck, Betrag und IBAN der eingehenden Zahlungen und vergleicht diese mit Ihren Mietern. Bei hoher Übereinstimmung wird die Zahlung automatisch zugeordnet. Sie können die Zuordnung jederzeit manuell anpassen.',
      },
      {
        question: 'Was bedeutet "Nicht zugeordnet" bei Transaktionen?',
        answer: 'Transaktionen ohne automatische Zuordnung müssen manuell einem Mieter oder einer Kostenkategorie zugewiesen werden. Klicken Sie auf die Transaktion und wählen Sie den passenden Mieter oder die Ausgabenkategorie aus.',
      },
      {
        question: 'Wie verbuche ich Teilzahlungen?',
        answer: 'Wenn ein Mieter nur einen Teil der Miete zahlt, wird dies automatisch erkannt. Die Rechnung bleibt als "teilbezahlt" markiert, bis der vollständige Betrag eingegangen ist. Sie können auch Zahlungen aufteilen.',
      },
    ],
  },
  {
    title: 'Betriebskostenabrechnung',
    items: [
      {
        question: 'Wie erstelle ich eine BK-Abrechnung?',
        answer: 'Gehen Sie zu "Betriebskosten" und wählen Sie das Abrechnungsjahr. Das System berechnet automatisch die Kostenanteile basierend auf den Verteilungsschlüsseln und den gezahlten Vorschüssen. Sie können die Abrechnung als PDF exportieren.',
      },
      {
        question: 'Was sind Verteilungsschlüssel?',
        answer: 'Verteilungsschlüssel bestimmen, wie Kosten auf die Einheiten aufgeteilt werden. Typische Schlüssel sind: MEA (Miteigentumsanteile), Nutzfläche (m²), Personenanzahl oder Verbrauch. In Österreich sind nach MRG bestimmte Schlüssel für bestimmte Kostenarten vorgeschrieben.',
      },
      {
        question: 'Wie berechne ich die korrekten MEA-Anteile?',
        answer: 'Die MEA (Miteigentumsanteile) werden üblicherweise in Promille (‰) angegeben und stehen im Grundbuch oder Nutzwertgutachten. Die Summe aller MEA einer Liegenschaft muss 1000‰ ergeben. Bei Unklarheiten konsultieren Sie Ihren Hausverwaltungsvertrag.',
      },
      {
        question: 'Was ist bei der Jahresabrechnung zu beachten?',
        answer: 'Die Abrechnung muss laut MRG bis spätestens 30. Juni des Folgejahres erstellt und den Mietern zugestellt werden. Alle Belege müssen für die Einsichtnahme verfügbar sein. Das System unterstützt Sie bei der fristgerechten Erstellung.',
      },
    ],
  },
  {
    title: 'Rechtliches (Österreich)',
    items: [
      {
        question: 'Was ist das MRG und wann gilt es?',
        answer: 'Das Mietrechtsgesetz (MRG) regelt Mietverhältnisse in Österreich. Es gilt bei Vollanwendung für Altbauten (Baubewilligung vor 1945/1953) und teilweise für Neubauten. Bei "ausgenommen" gelten nur die allgemeinen Regeln des ABGB.',
      },
      {
        question: 'Was sind Ausstattungskategorien?',
        answer: 'Die Kategorien A bis D beschreiben den Ausstattungsstandard einer Wohnung nach MRG: A = Zentralheizung, Bad/WC, B = Bad oder WC, Etagenheizung, C = WC im Wohnungsverband, Wasserentnahme, D = ohne diese Ausstattung. Die Kategorie beeinflusst die zulässige Miethöhe.',
      },
      {
        question: 'Wie funktioniert die Richtwertmiete?',
        answer: 'Bei MRG-Vollanwendung gilt für Hauptmietzins die Richtwertmiete. Der Richtwert wird jährlich vom Justizministerium festgelegt und variiert je nach Bundesland. Zu- und Abschläge für Lage, Ausstattung etc. sind möglich.',
      },
      {
        question: 'Welche Kosten sind auf Mieter umlegbar?',
        answer: 'Nach §21 MRG sind bestimmte Betriebskosten umlegbar: Wasser, Kanal, Müll, Hausbetreuung, Versicherung, Lift, Allgemeinstrom etc. Nicht umlegbar sind z.B. Instandhaltungskosten und Hausverwalterhonorar (außer bei abweichender Vereinbarung).',
      },
    ],
  },
  {
    title: 'Technik & Tipps',
    items: [
      {
        question: 'Kann ich Daten exportieren?',
        answer: 'Ja, Sie können Mieterlisten, Transaktionen und Abrechnungen als PDF oder CSV exportieren. Gehen Sie zur jeweiligen Übersicht und nutzen Sie die Export-Funktion.',
      },
      {
        question: 'Wie funktioniert der PDF-Export?',
        answer: 'Bei Abrechnungen und Berichten können Sie auf "PDF exportieren" klicken. Das Dokument wird im Browser generiert und kann gespeichert oder direkt gedruckt werden.',
      },
      {
        question: 'Wie ändere ich meine Organisation?',
        answer: 'Die Organisationseinstellungen finden Sie unter "Einstellungen" im Tab "Konto". Dort sehen Sie Ihren Organisationsnamen und Status.',
      },
      {
        question: 'Kann ich mehrere Benutzer hinzufügen?',
        answer: 'Ja, Sie können weitere Benutzer zu Ihrer Organisation einladen. Kontaktieren Sie uns für Informationen zu Mehrbenutzer-Lizenzen.',
      },
    ],
  },
];

export function FAQSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Häufig gestellte Fragen (FAQ)
        </CardTitle>
        <CardDescription>
          Antworten auf die häufigsten Fragen zur Nutzung der Software
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {faqData.map((category, categoryIndex) => (
          <div key={categoryIndex}>
            <h3 className="text-lg font-semibold mb-3 text-foreground">
              {category.title}
            </h3>
            <Accordion type="single" collapsible className="w-full">
              {category.items.map((item, itemIndex) => (
                <AccordionItem
                  key={itemIndex}
                  value={`${categoryIndex}-${itemIndex}`}
                >
                  <AccordionTrigger className="text-left hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
