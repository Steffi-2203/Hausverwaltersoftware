/**
 * Zentrales Register für den P0001-Immutability-Audit-Handler.
 *
 * Diese Datei hat KEINE Imports von server/db.ts oder
 * server/lib/immutableViolationAudit.ts — sie ist absichtlich
 * zyklenfrei, damit beide Module sie gleichzeitig importieren können.
 *
 * Warum ein eigenes Modul?
 *   server/db.ts muss server/lib/immutableViolationAudit.ts importieren
 *   (damit der Handler in jedem Prozess registriert ist), und
 *   immutableViolationAudit.ts muss setImmutableViolationHandler aufrufen.
 *   Das erzeugt einen ESM-Zyklus — ESM-Live-Bindings für `let`-Variablen
 *   schlagen im Initialisierungspfad mit einem TDZ-Fehler fehl.
 *   Lösung: alles, was beide Seiten beim Modul-Start brauchen, kommt aus
 *   diesem dritten, zyklenfreien Modul.
 */

export interface ImmutableViolationEvent {
  message: string;
  queryText?: string;
}

let handler: ((e: ImmutableViolationEvent) => void) | null = null;

/** Registriert den (einen) Handler für Immutability-Trigger-Verletzungen. */
export function setImmutableViolationHandler(
  fn: (e: ImmutableViolationEvent) => void,
): void {
  handler = fn;
}

/** Gibt zurück ob ein Handler registriert ist (für Tests). */
export function hasImmutableViolationHandler(): boolean {
  return handler !== null;
}

/**
 * Leitet eine erkannte P0001-Verletzung an den registrierten Handler weiter.
 * Wird intern von server/db.ts aufgerufen — niemals vom Anwendungscode.
 */
export function fireImmutableViolation(event: ImmutableViolationEvent): void {
  handler?.(event);
}
