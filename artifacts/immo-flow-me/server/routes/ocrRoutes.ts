/**
 * OCR-Korrekturen Audit-Route
 *
 * POST /api/ocr/corrections — schreibt vom Nutzer durchgeführte OCR-Korrekturen ins Audit-Log.
 * Verwendet die HMAC-gesicherte Kette (createAuditLog) statt eines direkten db.insert,
 * damit jeder Eintrag fälschungssicher ist und Manipulationen erkannt werden können.
 */
import { Router, type Request, type Response } from 'express';
import { isAuthenticated, getProfileFromSession, requireRole } from './helpers';
import {
  OcrInvoiceTransferValidationError,
  transferOcrInvoice,
} from '../services/ocrInvoiceTransferService';

const router = Router();

router.post('/api/ocr/corrections', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.id) return res.status(401).json({ error: 'Nicht authentifiziert' });

    const { originalData, correctedData, source, fileName } = req.body;

    if (!originalData || !correctedData) {
      return res.status(400).json({ error: 'originalData und correctedData sind erforderlich' });
    }

    // Tatsächliche Unterschiede berechnen
    const changes: Record<string, { vorher: unknown; nachher: unknown }> = {};
    const fields = ['lieferant', 'betrag', 'datum', 'rechnungsnummer', 'kategorie', 'expense_type', 'beschreibung'];
    for (const field of fields) {
      const orig = String(originalData[field] ?? '');
      const corr = String(correctedData[field] ?? '');
      if (orig !== corr) {
        changes[field] = { vorher: orig, nachher: corr };
      }
    }

    const changeCount = Object.keys(changes).length;
    if (changeCount === 0) {
      return res.json({ logged: false, message: 'Keine Korrekturen' });
    }

    // Strict write: propagiert Fehler als 500 statt sie zu unterdrücken.
    // Garantiert, dass logged:true nur zurückgegeben wird, wenn der HMAC-Eintrag
    // tatsächlich committed wurde. oldData/newData UND details sind signiert (v5).
    await createAuditLogStrict({
      userId: profile.id,
      tableName: 'ocr_corrections',
      recordId: fileName ?? 'unknown',
      action: 'ocr_correction',
      oldData: originalData,
      newData: correctedData,
      details: {
        source: source ?? 'expense_ocr',
        changes,
        change_count: changeCount,
        file_name: fileName ?? null,
        confidence_score: originalData.confidence_score ?? null,
      },
      ipAddress: (req as any).ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });

    res.json({ logged: true, change_count: changeCount });
  } catch (error) {
    console.error('OCR corrections audit error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Korrekturen' });
  }
});

/**
 * Gemeinsamer Übergabepfad für Web- und Mobile-OCR. Eine stabile Vorgangs-ID
 * wird organisationsgebunden einmalig in Rechnung, Journal und Kostenposition
 * umgesetzt; Wiederholungen liefern die vorhandenen IDs zurück.
 */
router.post('/api/ocr/invoice-transfer', isAuthenticated, requireRole('property_manager', 'finance'), async (req: Request, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.id || !profile.organizationId) {
      return res.status(400).json({ error: 'Keine Organisation zugeordnet' });
    }

    const result = await transferOcrInvoice({
      ...req.body,
      organizationId: profile.organizationId,
      userId: profile.userId ?? profile.id,
      audit: {
        originalData: req.body.originalData ?? null,
        source: req.body.source ?? 'web_ocr',
        ipAddress: (req as any).ip ?? null,
        userAgent: req.headers?.['user-agent'] ?? null,
      },
    });

    return res.status(result.created ? 201 : 200).json({
      created: result.created,
      alreadyTransferred: !result.created,
      incomingInvoiceId: result.incomingInvoice.id,
      journalEntryId: result.journalEntryId,
      expenseId: result.expenseId,
    });
  } catch (error) {
    if (error instanceof OcrInvoiceTransferValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('OCR invoice transfer error:', error);
    return res.status(500).json({ error: 'Die OCR-Rechnung konnte nicht vollständig in die Buchhaltung übernommen werden' });
  }
});

export default router;
