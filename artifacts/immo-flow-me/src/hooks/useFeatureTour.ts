import { useState, useEffect, useCallback } from 'react';
import type { TourStep } from '@/components/tour/FeatureTour';

const TOUR_COMPLETED_KEY = 'immoflow_tour_completed';
const TOUR_DISMISSED_KEY = 'immoflow_tour_dismissed';

// Define the tour steps
export const tourSteps: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="dashboard"]',
    title: 'Willkommen bei ImmoFlow! 🏠',
    content: 'Diese kurze Tour zeigt Ihnen die wichtigsten Funktionen der Software. Sie können die Tour jederzeit überspringen und später in den Einstellungen erneut starten.',
    position: 'bottom',
  },
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    title: 'Navigation',
    content: 'Über die Seitenleiste erreichen Sie alle Bereiche: Liegenschaften, Einheiten, Mieter, Buchhaltung, Ausgaben und mehr. Auf mobilen Geräten öffnen Sie das Menü über das Hamburger-Symbol.',
    position: 'right',
  },
  {
    id: 'properties',
    target: '[data-tour="nav-properties"]',
    title: 'Liegenschaften verwalten',
    content: 'Hier legen Sie Ihre Immobilien an. Jede Liegenschaft enthält Einheiten (Wohnungen, Geschäfte, Garagen) und kann mehrere Eigentümer haben.',
    position: 'right',
  },
  {
    id: 'units',
    target: '[data-tour="nav-units"]',
    title: 'Einheiten & Tops',
    content: 'Verwalten Sie alle Einheiten Ihrer Liegenschaften. Hier definieren Sie MEA-Anteile, Nutzflächen und MRG-Einstellungen für die Betriebskostenabrechnung.',
    position: 'right',
  },
  {
    id: 'tenants',
    target: '[data-tour="nav-tenants"]',
    title: 'Mieterverwaltung',
    content: 'Erfassen Sie Mieter mit allen Vertragsdetails: Grundmiete, BK-Vorschuss, Kaution und SEPA-Mandat. Der Mieterstatus wird automatisch aktualisiert.',
    position: 'right',
  },
  {
    id: 'expenses',
    target: '[data-tour="nav-expenses"]',
    title: 'Ausgaben erfassen',
    content: 'Dokumentieren Sie alle Betriebskosten und sonstigen Ausgaben. Die Kosten werden automatisch für die Jahresabrechnung berücksichtigt.',
    position: 'right',
  },
  {
    id: 'accounting',
    target: '[data-tour="nav-accounting"]',
    title: 'Finanzbuchhaltung & Banking',
    content: 'Hier finden Sie Banking und die doppelte Buchführung: Kontoauszüge importieren, Zahlungen zuordnen, Saldenliste, Bilanz, GuV und UVA. Alle Berichte stehen als XLSX-Export für Ihren Steuerberater bereit.',
    position: 'right',
  },
  {
    id: 'weg-management',
    target: '[data-tour="nav-weg"]',
    title: 'WEG-Verwaltung',
    content: 'Verwalten Sie Wohnungseigentümergemeinschaften: Eigentümer und MEA-Anteile zuordnen, Versammlungen planen, Wirtschaftspläne erstellen, Rücklagen verwalten und Erhaltungsmaßnahmen dokumentieren.',
    position: 'right',
  },
  {
    id: 'weg-vorschreibungen',
    target: '[data-tour="nav-weg-vs"]',
    title: 'WEG-Vorschreibungen',
    content: 'Erstellen Sie monatliche Eigentümer-Vorschreibungen aus dem Wirtschaftsplan. Die Verteilung erfolgt automatisch nach MEA-Anteilen mit korrekter Restcent-Verteilung.',
    position: 'right',
  },
  {
    id: 'offene-posten',
    target: '[data-tour="nav-op"]',
    title: 'Offene Posten',
    content: 'Behalten Sie den Überblick über offene Forderungen. Fälligkeitsampeln zeigen sofort, welche Posten überfällig sind. Die Bank-Abstimmung matcht unzugeordnete Zahlungen automatisch.',
    position: 'right',
  },
  {
    id: 'jahresabschluss',
    target: '[data-tour="nav-ja"]',
    title: 'Jahresabschluss-Assistent',
    content: 'Der geführte 6-Schritte-Assistent begleitet Sie durch den Jahresabschluss: Periode wählen, AfA buchen, Abgrenzungen prüfen, Bilanz/GuV reviewen, Periode sperren und Abschlussbericht exportieren.',
    position: 'right',
  },
  {
    id: 'reports',
    target: '[data-tour="nav-reports"]',
    title: 'Berichte & Auswertungen',
    content: 'Erstellen Sie Betriebskostenabrechnungen, Eigentümerabrechnungen und USt-Übersichten. Alle Berichte können als PDF exportiert werden.',
    position: 'right',
  },
  {
    id: 'settings',
    target: '[data-tour="nav-settings"]',
    title: 'Einstellungen & Hilfe',
    content: 'Konfigurieren Sie Verteilungsschlüssel, lesen Sie das Handbuch oder durchsuchen Sie die FAQ. Hier können Sie auch diese Tour erneut starten.',
    position: 'right',
  },
];

export function useFeatureTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasCompletedTour, setHasCompletedTour] = useState(true);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
    const dismissed = localStorage.getItem(TOUR_DISMISSED_KEY);
    setHasCompletedTour(completed === 'true' || dismissed === 'true');
  }, []);

  const startTour = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem(TOUR_DISMISSED_KEY, 'true');
    setHasCompletedTour(true);
  }, []);

  const completeTour = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    setHasCompletedTour(true);
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
    localStorage.removeItem(TOUR_DISMISSED_KEY);
    setHasCompletedTour(false);
  }, []);

  const autoStartTour = useCallback(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
    const dismissed = localStorage.getItem(TOUR_DISMISSED_KEY);
    if (completed !== 'true' && dismissed !== 'true') {
      // Delay to ensure DOM is ready
      setTimeout(() => {
        setIsOpen(true);
      }, 1000);
    }
  }, []);

  return {
    isOpen,
    hasCompletedTour,
    steps: tourSteps,
    startTour,
    closeTour,
    completeTour,
    resetTour,
    autoStartTour,
  };
}
