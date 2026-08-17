import { db } from "../db";
import { ebicsConnections, ebicsOrders, ebicsPaymentBatches } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { encryptField, decryptField, decryptIbanFields } from "../lib/fieldEncryption";
import { maskIban } from "../lib/maskPii";

interface EbicsKeyPair {
  publicKey: string;
  privateKey: string;
}

interface EbicsConnectionConfig {
  bankName: string;
  hostId: string;
  hostUrl: string;
  partnerId: string;
  userId: string;
  iban: string;
  bic?: string;
  organizationId: string;
}

interface EbicsOrderRequest {
  connectionId: string;
  organizationId: string;
  orderType: string;
  requestData?: string;
}

/**
 * Audit-Befund K5 (kritisch): Die EBICS-Transportschicht (INI/HIA/HPB/C52/C53/
 * CCT/CDD) war nicht implementiert, meldete aber `success: true` und setzte
 * Verbindungen auf "aktiv" bzw. Zahlungsstapel auf "eingereicht". Damit
 * konnte im Betrieb der Eindruck entstehen, Zahlungen seien bei der Bank
 * eingereicht worden, obwohl nie eine Bankverbindung bestand.
 *
 * Verhalten jetzt:
 *  - Ohne EBICS_ENABLED=true werfen alle Bank-Transportaufrufe einen
 *    eindeutigen Fehler. Verwaltung von Verbindungen, Schlüsseln und
 *    INI/HIA-Briefen bleibt nutzbar (reine Vorbereitung, kein Bankkontakt).
 *  - Der Datei-Weg (SEPA-XML-Export + CAMT.053-Import) ist der unterstützte
 *    produktive Zahlungsweg.
 * Für echten EBICS-Betrieb ist eine zertifizierte Client-Bibliothek bzw.
 * ein EBICS-Gateway anzubinden (Aufwand siehe AUDIT_REPORT.md).
 */
export class EbicsNotImplementedError extends Error {
  readonly code = 'EBICS_NOT_IMPLEMENTED';
  constructor(orderType: string) {
    super(
      `EBICS-Auftragsart ${orderType} ist in dieser Installation nicht verfügbar. ` +
      `Es besteht keine echte Bankverbindung. Bitte den Dateiweg nutzen: ` +
      `SEPA-XML exportieren, im Banking-Portal einreichen und den Kontoauszug ` +
      `als CAMT.053 importieren.`
    );
    this.name = 'EbicsNotImplementedError';
  }
}

/**
 * Audit-Befund M3: Private EBICS-Schlüssel wurden im Zweifel mit einem fest
 * einprogrammierten Default-Secret verschlüsselt. Ohne EBICS_KEY_SECRET wird
 * jetzt abgebrochen statt schwach zu verschlüsseln.
 * SESSION_SECRET-Fallback entfernt: jedes Secret muss einen eigenen Zweck haben.
 */
function requireEbicsSecret(): string {
  const secret = process.env.EBICS_KEY_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'EBICS-Schlüsselablage nicht konfiguriert: EBICS_KEY_SECRET ' +
      'mit mindestens 32 Zeichen setzen. SESSION_SECRET ist kein Ersatz.'
    );
  }
  return secret;
}

/**
 * In diesem Build gibt es KEINE echte EBICS-Transportimplementierung —
 * die send*-Methoden darunter sind Stubs. Deshalb fail-closed ohne Ausnahme:
 * Auch EBICS_ENABLED=true darf keine fabrizierten Erfolge freischalten
 * (sonst würden Zahlungsstapel als "eingereicht" markiert, ohne dass je eine
 * Bank kontaktiert wurde). Erst wenn eine zertifizierte Client-Bibliothek/
 * ein Gateway angebunden ist, darf diese Sperre — gekoppelt an einen echten
 * Provider-Readiness-Check, nicht an ein Env-Flag — geöffnet werden.
 */
function assertEbicsTransportAvailable(orderType: string): void {
  throw new EbicsNotImplementedError(orderType);
}

export class EbicsService {
  private static instance: EbicsService;

  static getInstance(): EbicsService {
    if (!EbicsService.instance) {
      EbicsService.instance = new EbicsService();
    }
    return EbicsService.instance;
  }

  async createConnection(config: EbicsConnectionConfig) {
    const keyPair = this.generateKeyPair();
    const encryptedKeys = this.encryptKeys(JSON.stringify(keyPair));

    const [connection] = await db.insert(ebicsConnections).values({
      ...config,
      iban: encryptField(config.iban) ?? config.iban,
      bic: encryptField(config.bic ?? null),
      status: 'pending',
      keyInitialized: false,
      encryptedKeys,
    }).returning();

    return decryptIbanFields(connection);
  }

  async getConnections(organizationId: string) {
    const rows = await db.select().from(ebicsConnections)
      .where(eq(ebicsConnections.organizationId, organizationId))
      .orderBy(desc(ebicsConnections.createdAt));
    return rows.map(decryptIbanFields);
  }

  /**
   * Org-Scope (Defense-in-Depth zu RLS): alle Lookup-/Update-/Delete-Pfade
   * filtern zusätzlich auf organization_id — fremde IDs treffen 0 Zeilen.
   */
  private connScope(id: string, organizationId?: string) {
    return organizationId
      ? and(eq(ebicsConnections.id, id), eq(ebicsConnections.organizationId, organizationId))
      : eq(ebicsConnections.id, id);
  }

  async getConnection(id: string, organizationId?: string) {
    const [conn] = await db.select().from(ebicsConnections)
      .where(this.connScope(id, organizationId));
    return conn ? decryptIbanFields(conn) : null;
  }

  async updateConnectionStatus(id: string, status: string, organizationId: string) {
    const [conn] = await db.update(ebicsConnections)
      .set({ status, updatedAt: new Date() })
      .where(this.connScope(id, organizationId))
      .returning();
    return conn;
  }

  async deleteConnection(id: string, organizationId: string) {
    await db.delete(ebicsConnections).where(this.connScope(id, organizationId));
  }

  async initializeKeys(connectionId: string, organizationId: string): Promise<{ iniLetter: string; hiaLetter: string }> {
    const conn = await this.getConnection(connectionId, organizationId);
    if (!conn) throw new Error("Verbindung nicht gefunden");

    const iniResult = await this.sendINI(conn);
    const hiaResult = await this.sendHIA(conn);

    await db.update(ebicsConnections)
      .set({ keyInitialized: true, status: 'key_sent', updatedAt: new Date() })
      .where(this.connScope(connectionId, organizationId));

    await this.createOrder({
      connectionId,
      organizationId: conn.organizationId,
      orderType: 'INI',
      requestData: JSON.stringify({ timestamp: new Date().toISOString() }),
    });

    await this.createOrder({
      connectionId,
      organizationId: conn.organizationId,
      orderType: 'HIA',
      requestData: JSON.stringify({ timestamp: new Date().toISOString() }),
    });

    return {
      iniLetter: this.generateINILetter(conn),
      hiaLetter: this.generateHIALetter(conn),
    };
  }

  async activateConnection(connectionId: string, organizationId: string) {
    // Org-Scope VOR dem Transportaufruf: keine externe EBICS-Operation
    // für fremde/gelöschte Verbindungen.
    const existing = await this.getConnection(connectionId, organizationId);
    if (!existing) throw new Error("Verbindung nicht gefunden");

    const hpbResult = await this.sendHPB(connectionId);

    const [conn] = await db.update(ebicsConnections)
      .set({ status: 'active', updatedAt: new Date() })
      .where(this.connScope(connectionId, organizationId))
      .returning();
    if (!conn) throw new Error("Verbindung nicht gefunden");

    await this.createOrder({
      connectionId,
      organizationId: conn.organizationId,
      orderType: 'HPB',
      requestData: JSON.stringify({ timestamp: new Date().toISOString() }),
    });

    return conn;
  }

  async fetchStatements(connectionId: string, fromDate: string, toDate: string, organizationId: string) {
    const conn = await this.getConnection(connectionId, organizationId);
    if (!conn) throw new Error("Verbindung nicht gefunden");
    if (conn.status !== 'active') throw new Error("Verbindung nicht aktiv");

    const camt053 = await this.sendC53(conn, fromDate, toDate);

    const [order] = await db.insert(ebicsOrders).values({
      connectionId,
      organizationId: conn.organizationId,
      orderType: 'C53',
      orderStatus: 'completed',
      requestData: JSON.stringify({ fromDate, toDate }),
      responseData: JSON.stringify(camt053),
      transactionCount: camt053.transactions?.length || 0,
      totalAmount: String(camt053.totalAmount || 0),
      completedAt: new Date(),
    }).returning();

    await db.update(ebicsConnections)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(this.connScope(connectionId, organizationId));

    return { order, statements: camt053 };
  }

  async fetchDailyStatements(connectionId: string, organizationId: string) {
    const conn = await this.getConnection(connectionId, organizationId);
    if (!conn) throw new Error("Verbindung nicht gefunden");
    if (conn.status !== 'active') throw new Error("Verbindung nicht aktiv");

    const camt052 = await this.sendC52(conn);

    const [order] = await db.insert(ebicsOrders).values({
      connectionId,
      organizationId: conn.organizationId,
      orderType: 'C52',
      orderStatus: 'completed',
      responseData: JSON.stringify(camt052),
      transactionCount: camt052.transactions?.length || 0,
      completedAt: new Date(),
    }).returning();

    return { order, statements: camt052 };
  }

  async submitPaymentBatch(batchId: string, organizationId: string) {
    const [batch] = await db.select().from(ebicsPaymentBatches)
      .where(and(eq(ebicsPaymentBatches.id, batchId), eq(ebicsPaymentBatches.organizationId, organizationId)));
    if (!batch) throw new Error("Zahlungsstapel nicht gefunden");
    if (!batch.sepaXml) throw new Error("Kein SEPA-XML vorhanden");

    const conn = await this.getConnection(batch.connectionId, organizationId);
    if (!conn || conn.status !== 'active') throw new Error("Verbindung nicht aktiv");

    const result = await this.sendCCT(conn, batch.sepaXml);

    await db.update(ebicsPaymentBatches)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(and(eq(ebicsPaymentBatches.id, batchId), eq(ebicsPaymentBatches.organizationId, organizationId)));

    const [order] = await db.insert(ebicsOrders).values({
      connectionId: batch.connectionId,
      organizationId: batch.organizationId,
      orderType: 'CCT',
      orderStatus: 'submitted',
      requestData: batch.sepaXml.substring(0, 1000),
      transactionCount: batch.paymentCount,
      totalAmount: batch.totalAmount,
    }).returning();

    return { order, result };
  }

  async submitDirectDebitBatch(batchId: string, organizationId: string) {
    const [batch] = await db.select().from(ebicsPaymentBatches)
      .where(and(eq(ebicsPaymentBatches.id, batchId), eq(ebicsPaymentBatches.organizationId, organizationId)));
    if (!batch) throw new Error("Lastschrift-Stapel nicht gefunden");
    if (!batch.sepaXml) throw new Error("Kein SEPA-XML vorhanden");

    const conn = await this.getConnection(batch.connectionId, organizationId);
    if (!conn || conn.status !== 'active') throw new Error("Verbindung nicht aktiv");

    const result = await this.sendCDD(conn, batch.sepaXml);

    await db.update(ebicsPaymentBatches)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(and(eq(ebicsPaymentBatches.id, batchId), eq(ebicsPaymentBatches.organizationId, organizationId)));

    const [order] = await db.insert(ebicsOrders).values({
      connectionId: batch.connectionId,
      organizationId: batch.organizationId,
      orderType: 'CDD',
      orderStatus: 'submitted',
      requestData: batch.sepaXml.substring(0, 1000),
      transactionCount: batch.paymentCount,
      totalAmount: batch.totalAmount,
    }).returning();

    return { order, result };
  }

  async createPaymentBatch(data: {
    organizationId: string;
    connectionId: string;
    batchType: string;
    paymentCount: number;
    totalAmount: string;
    sepaXml: string;
  }) {
    const [batch] = await db.insert(ebicsPaymentBatches).values({
      ...data,
      status: 'draft',
    }).returning();
    return batch;
  }

  async getOrders(organizationId: string, limit = 50) {
    return db.select().from(ebicsOrders)
      .where(eq(ebicsOrders.organizationId, organizationId))
      .orderBy(desc(ebicsOrders.createdAt))
      .limit(limit);
  }

  async getPaymentBatches(organizationId: string) {
    return db.select().from(ebicsPaymentBatches)
      .where(eq(ebicsPaymentBatches.organizationId, organizationId))
      .orderBy(desc(ebicsPaymentBatches.createdAt));
  }

  private async createOrder(req: EbicsOrderRequest) {
    const [order] = await db.insert(ebicsOrders).values({
      ...req,
      orderStatus: 'completed',
      completedAt: new Date(),
    }).returning();
    return order;
  }

  private generateKeyPair(): EbicsKeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
  }

  private encryptKeys(keys: string): string {
    const algorithm = 'aes-256-gcm';
    const secret = requireEbicsSecret();
    const key = crypto.scryptSync(secret, 'ebics-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv, { authTagLength: 16 });
    let encrypted = cipher.update(keys, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptKeys(encrypted: string): string {
    const algorithm = 'aes-256-gcm';
    const secret = requireEbicsSecret();
    const key = crypto.scryptSync(secret, 'ebics-salt', 32);
    const [ivHex, authTagHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private generateINILetter(conn: any): string {
    return `
EBICS INI-Brief
================
Bank: ${conn.bankName}
Host-ID: ${conn.hostId}
Partner-ID: ${conn.partnerId}
User-ID: ${conn.userId}
IBAN: ${conn.iban}
Datum: ${new Date().toLocaleDateString('de-AT')}

Dieser Brief muss unterschrieben an die Bank gesendet werden.
    `.trim();
  }

  private generateHIALetter(conn: any): string {
    return `
EBICS HIA-Brief
================
Bank: ${conn.bankName}
Host-ID: ${conn.hostId}
Partner-ID: ${conn.partnerId}
User-ID: ${conn.userId}
Datum: ${new Date().toLocaleDateString('de-AT')}

Dieser Brief muss unterschrieben an die Bank gesendet werden.
    `.trim();
  }

  private async sendINI(conn: any): Promise<any> {
    assertEbicsTransportAvailable('INI');
    console.log(`[EBICS] INI request to ${conn.hostUrl} for user ${conn.userId}`);
    return { success: true, orderType: 'INI', timestamp: new Date().toISOString() };
  }

  private async sendHIA(conn: any): Promise<any> {
    assertEbicsTransportAvailable('HIA');
    console.log(`[EBICS] HIA request to ${conn.hostUrl} for user ${conn.userId}`);
    return { success: true, orderType: 'HIA', timestamp: new Date().toISOString() };
  }

  private async sendHPB(connectionId: string): Promise<any> {
    assertEbicsTransportAvailable('HPB');
    console.log(`[EBICS] HPB request for connection ${connectionId}`);
    return { success: true, orderType: 'HPB', timestamp: new Date().toISOString() };
  }

  private async sendC53(conn: any, fromDate: string, toDate: string): Promise<any> {
    assertEbicsTransportAvailable('C53');
    console.log(`[EBICS] C53 request: ${fromDate} to ${toDate} for ${maskIban(conn.iban)}`);
    return {
      orderType: 'C53',
      iban: conn.iban,
      fromDate,
      toDate,
      transactions: [],
      totalAmount: 0,
      balance: { opening: 0, closing: 0 },
    };
  }

  private async sendC52(conn: any): Promise<any> {
    assertEbicsTransportAvailable('C52');
    console.log(`[EBICS] C52 intraday request for ${maskIban(conn.iban)}`);
    return {
      orderType: 'C52',
      iban: conn.iban,
      transactions: [],
      timestamp: new Date().toISOString(),
    };
  }

  private async sendCCT(conn: any, sepaXml: string): Promise<any> {
    assertEbicsTransportAvailable('CCT');
    console.log(`[EBICS] CCT payment submission for ${maskIban(conn.iban)}`);
    return {
      success: true,
      orderType: 'CCT',
      orderId: `CCT-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async sendCDD(conn: any, sepaXml: string): Promise<any> {
    assertEbicsTransportAvailable('CDD');
    console.log(`[EBICS] CDD direct debit submission for ${maskIban(conn.iban)}`);
    return {
      success: true,
      orderType: 'CDD',
      orderId: `CDD-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export const ebicsService = EbicsService.getInstance();
