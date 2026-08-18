/**
 * Gemeinsame MRG-Status-Logik für Liegenschaftsliste und Detailansicht.
 * Zentralisiert hier, damit Ampelfarben und Schwellenwerte konsistent bleiben.
 */
import type { Feather } from '@expo/vector-icons';

export type MrgStatus = 'ok' | 'grenzwertig' | 'ueberschritten' | 'nicht_anwendbar';

export interface MrgCheck {
  ueberschritten: boolean;
  differenz: number;
  zulassigerHmz: number | null;
  berechnungsgrundlage: string;
}

/**
 * Leitet den Ampelstatus aus dem Server-Response und der Grundmiete ab.
 * Grenzwertig = noch nicht überschritten, aber ≥ 90 % des Richtwerts.
 */
export function deriveStatus(check: MrgCheck | undefined, grundmiete: number): MrgStatus {
  if (!check || check.zulassigerHmz === null) return 'nicht_anwendbar';
  if (check.ueberschritten) return 'ueberschritten';
  if (check.zulassigerHmz > 0 && grundmiete / check.zulassigerHmz >= 0.9) return 'grenzwertig';
  return 'ok';
}

/** Schlimmsten Status aus einer Liste von Stati ableiten (für Zusammenfassungen). */
export function worstMrgStatus(statuses: MrgStatus[]): MrgStatus {
  if (statuses.includes('ueberschritten')) return 'ueberschritten';
  if (statuses.includes('grenzwertig')) return 'grenzwertig';
  if (statuses.includes('ok')) return 'ok';
  return 'nicht_anwendbar';
}

export const STATUS_META: Record<
  MrgStatus,
  { label: string; icon: React.ComponentProps<typeof Feather>['name'] }
> = {
  ok:              { label: 'OK',              icon: 'check-circle'    },
  grenzwertig:     { label: 'Grenzwertig',     icon: 'alert-triangle'  },
  ueberschritten:  { label: 'Überschritten',   icon: 'x-circle'        },
  nicht_anwendbar: { label: 'Nicht anwendbar', icon: 'minus-circle'    },
};
