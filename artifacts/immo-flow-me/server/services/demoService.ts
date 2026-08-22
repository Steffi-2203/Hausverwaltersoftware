import { db } from "../db";
import { 
  demoInvites, profiles, organizations, userRoles, properties, units, tenants,
  monthlyInvoices, bankAccounts, expenses, distributionKeys, meters, meterReadings, keyInventory
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "../lib/resend";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { encryptField } from "../lib/fieldEncryption";
import { seedDistributionKeysForOrg } from "../seedDistributionKeys";
import { getPublicBaseUrl } from "../lib/publicBaseUrl";

const DEMO_DURATION_MINUTES = 30;

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function sendDemoEmail(email: string, demoUrl: string): Promise<void> {
  console.log('[Demo] Sending demo invitation email to:', email);
  console.log('[Demo] Demo URL:', demoUrl);
  
  const emailResult = await sendEmail({
    to: email,
    subject: 'Ihr Demo-Zugang zu ImmoFlowMe',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a365d;">Willkommen bei ImmoFlowMe!</h1>
        <p>Vielen Dank für Ihr Interesse an unserer Hausverwaltungssoftware.</p>
        <p>Klicken Sie auf den Button unten, um Ihren <strong>30-Minuten Demo-Zugang</strong> zu aktivieren:</p>
        <p style="margin: 30px 0;">
          <a href="${demoUrl}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Demo starten
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          <strong>Was Sie erwartet:</strong>
        </p>
        <ul style="color: #666; font-size: 14px;">
          <li>Realistische Beispieldaten mit österreichischen Liegenschaften</li>
          <li>Alle Funktionen der Pro-Version</li>
          <li>30 Minuten zum Testen</li>
        </ul>
        <p style="color: #666; font-size: 14px;">
          Dieser Link ist 24 Stunden gültig.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px;">
          ImmoFlowMe - Professionelle Hausverwaltung für Österreich
        </p>
      </div>
    `,
    text: `
Willkommen bei ImmoFlowMe!

Vielen Dank für Ihr Interesse an unserer Hausverwaltungssoftware.

Klicken Sie auf diesen Link, um Ihren 30-Minuten Demo-Zugang zu aktivieren:
${demoUrl}

Was Sie erwartet:
- Realistische Beispieldaten mit österreichischen Liegenschaften
- Alle Funktionen der Pro-Version
- 30 Minuten zum Testen

Dieser Link ist 24 Stunden gültig.
    `
  });

  console.log('[Demo] Email send result:', JSON.stringify(emailResult, null, 2));
  
  if (emailResult.error) {
    console.error('[Demo] Resend API error:', emailResult.error);
    throw new Error('Email send failed');
  }
}

export async function requestDemoAccess(email: string, ipAddress?: string, userAgent?: string): Promise<{ success: boolean; message: string; activationUrl?: string }> {
  // Check if user is already registered in profiles
  const existingProfile = await db.select()
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);

  if (existingProfile.length > 0) {
    return { success: false, message: 'Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an oder verwenden Sie eine andere E-Mail.' };
  }

  // Check for existing pending invite - update it instead of failing
  const existingInvite = await db.select()
    .from(demoInvites)
    .where(and(
      eq(demoInvites.email, email),
      eq(demoInvites.status, 'pending')
    ))
    .limit(1);

  // If pending invite exists, update it with new token
  if (existingInvite.length > 0) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await db.update(demoInvites)
      .set({ token, expiresAt, ipAddress, userAgent })
      .where(eq(demoInvites.id, existingInvite[0].id));
    
    const baseUrl = getPublicBaseUrl();

    const demoUrl = `${baseUrl}/demo/activate?token=${token}`;
    
    // Send email with new token
    try {
      await sendDemoEmail(email, demoUrl);
    } catch (error) {
      console.error('Failed to resend demo email:', error);
    }
    
    return { 
      success: true, 
      message: 'Neuer Demo-Link wurde gesendet!',
      activationUrl: demoUrl
    };
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(demoInvites).values({
    email,
    token,
    expiresAt,
    ipAddress,
    userAgent,
  });

  const baseUrl = getPublicBaseUrl();

  const demoUrl = `${baseUrl}/demo/activate?token=${token}`;

  try {
    await sendDemoEmail(email, demoUrl);
    return { 
      success: true, 
      message: 'Demo-Einladung wurde an Ihre E-Mail-Adresse gesendet!',
      activationUrl: demoUrl
    };
  } catch (error) {
    console.error('Failed to send demo email:', error);
    return { 
      success: true, 
      message: 'E-Mail konnte nicht gesendet werden, aber Sie können den Link unten verwenden.',
      activationUrl: demoUrl
    };
  }
}

export async function activateDemo(token: string, fullName: string, password: string): Promise<{ success: boolean; message: string; userId?: string }> {
  const [invite] = await db.select()
    .from(demoInvites)
    .where(eq(demoInvites.token, token))
    .limit(1);

  if (!invite) {
    return { success: false, message: 'Ungültiger Demo-Link.' };
  }

  if (invite.status !== 'pending') {
    return { success: false, message: 'Dieser Demo-Link wurde bereits verwendet.' };
  }

  if (new Date() > invite.expiresAt) {
    await db.update(demoInvites)
      .set({ status: 'expired' })
      .where(eq(demoInvites.id, invite.id));
    return { success: false, message: 'Dieser Demo-Link ist abgelaufen. Bitte fordern Sie einen neuen an.' };
  }

  const existingUser = await db.select()
    .from(profiles)
    .where(eq(profiles.email, invite.email))
    .limit(1);

  if (existingUser.length > 0) {
    return { success: false, message: 'Diese E-Mail-Adresse ist bereits registriert.' };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const demoEndsAt = new Date(Date.now() + DEMO_DURATION_MINUTES * 60 * 1000);

  const [org] = await db.insert(organizations).values({
    name: `Demo - ${fullName}`,
    subscriptionTier: 'professional',
    subscriptionStatus: 'trial',
    trialEndsAt: demoEndsAt,
  }).returning();

  // Standard-Verteilerschlüssel sind org-gebunden — für neue Orgs sofort anlegen
  await seedDistributionKeysForOrg(org.id);

  const [user] = await db.insert(profiles).values({
    email: invite.email,
    passwordHash,
    fullName,
    organizationId: org.id,
    subscriptionTier: 'pro',
    trialEndsAt: demoEndsAt,
  }).returning();

  await db.insert(userRoles).values({
    userId: user.id,
    role: 'admin',
  });

  await db.update(demoInvites)
    .set({
      status: 'activated',
      activatedAt: new Date(),
      demoEndsAt,
      userId: user.id,
      organizationId: org.id,
    })
    .where(eq(demoInvites.id, invite.id));

  await createDemoData(org.id);

  return { success: true, message: 'Demo-Zugang erfolgreich aktiviert!', userId: user.id };
}

export async function getDemoStatus(userId: string): Promise<{ isDemo: boolean; endsAt: Date | null; remainingMinutes: number }> {
  const [invite] = await db.select()
    .from(demoInvites)
    .where(and(
      eq(demoInvites.userId, userId),
      eq(demoInvites.status, 'activated')
    ))
    .limit(1);

  if (!invite || !invite.demoEndsAt) {
    return { isDemo: false, endsAt: null, remainingMinutes: 0 };
  }

  const now = new Date();
  const remainingMs = invite.demoEndsAt.getTime() - now.getTime();
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return {
    isDemo: true,
    endsAt: invite.demoEndsAt,
    remainingMinutes,
  };
}

export async function isDemoExpired(userId: string): Promise<boolean> {
  const status = await getDemoStatus(userId);
  return status.isDemo && status.remainingMinutes <= 0;
}

async function createDemoData(organizationId: string): Promise<void> {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [existingKeys] = await db.select()
    .from(distributionKeys)
    .where(eq(distributionKeys.organizationId, organizationId))
    .limit(1);

  if (!existingKeys) {
    await db.insert(distributionKeys).values([
      { organizationId, keyCode: 'MEA', name: 'Miteigentumsanteile', unit: '‰', inputType: 'mea', isSystem: true, mrgKonform: true, mrgParagraph: '§21 Abs 1', sortOrder: 1 },
      { organizationId, keyCode: 'QM', name: 'Nutzfläche', unit: 'm²', inputType: 'qm', isSystem: true, mrgKonform: true, mrgParagraph: '§21 Abs 1', sortOrder: 2 },
      { organizationId, keyCode: 'PERS', name: 'Personenanzahl', unit: 'Pers.', inputType: 'personen', isSystem: true, mrgKonform: true, mrgParagraph: '§21 Abs 1', sortOrder: 3 },
      { organizationId, keyCode: 'EINH', name: 'Einheiten', unit: 'Stk.', inputType: 'anzahl', isSystem: true, mrgKonform: true, mrgParagraph: '§21 Abs 1', sortOrder: 4 },
    ]);
  }

  const [prop1] = await db.insert(properties).values({
    organizationId,
    name: 'Musterhaus Wien',
    address: 'Mariahilfer Straße 45',
    city: 'Wien',
    postalCode: '1060',
    totalUnits: 6,
    totalArea: '450.00',
    notes: 'Demo-Liegenschaft: Wiener Altbau mit 6 Einheiten',
  }).returning();

  const [prop2] = await db.insert(properties).values({
    organizationId,
    name: 'Neubau Graz',
    address: 'Herrengasse 12',
    city: 'Graz',
    postalCode: '8010',
    totalUnits: 4,
    totalArea: '320.00',
    notes: 'Demo-Liegenschaft: Moderner Neubau',
  }).returning();

  await db.insert(bankAccounts).values([
    { organizationId, propertyId: prop1.id, accountName: 'Hausverwaltung Wien', iban: encryptField('AT611904300234573201'), bic: encryptField('BKAUATWW'), bankName: 'Bank Austria' },
    { organizationId, propertyId: prop2.id, accountName: 'Hausverwaltung Graz', iban: encryptField('AT321904300234573202'), bic: encryptField('BKAUATWW'), bankName: 'Bank Austria' },
  ]);

  const wienUnits = await db.insert(units).values([
    { propertyId: prop1.id, topNummer: 'Top 1', stockwerk: 0, flaeche: '55.00', zimmer: 2, type: 'wohnung', nutzwert: '0.120', vsPersonen: 2 },
    { propertyId: prop1.id, topNummer: 'Top 2', stockwerk: 1, flaeche: '72.00', zimmer: 3, type: 'wohnung', nutzwert: '0.160', vsPersonen: 3 },
    { propertyId: prop1.id, topNummer: 'Top 3', stockwerk: 1, flaeche: '65.00', zimmer: 2, type: 'wohnung', nutzwert: '0.145', vsPersonen: 2 },
    { propertyId: prop1.id, topNummer: 'Top 4', stockwerk: 2, flaeche: '80.00', zimmer: 3, type: 'wohnung', nutzwert: '0.175', vsPersonen: 4 },
    { propertyId: prop1.id, topNummer: 'Top 5', stockwerk: 2, flaeche: '78.00', zimmer: 3, type: 'wohnung', nutzwert: '0.170', vsPersonen: 2 },
    { propertyId: prop1.id, topNummer: 'Geschäft EG', stockwerk: 0, flaeche: '100.00', zimmer: 1, type: 'geschaeft', nutzwert: '0.230', vsPersonen: 0 },
  ]).returning();

  const grazUnits = await db.insert(units).values([
    { propertyId: prop2.id, topNummer: 'Top 1', stockwerk: 0, flaeche: '65.00', zimmer: 2, type: 'wohnung', nutzwert: '0.200', vsPersonen: 2 },
    { propertyId: prop2.id, topNummer: 'Top 2', stockwerk: 1, flaeche: '85.00', zimmer: 3, type: 'wohnung', nutzwert: '0.270', vsPersonen: 3 },
    { propertyId: prop2.id, topNummer: 'Top 3', stockwerk: 2, flaeche: '85.00', zimmer: 3, type: 'wohnung', nutzwert: '0.270', vsPersonen: 2 },
    { propertyId: prop2.id, topNummer: 'Top 4', stockwerk: 3, flaeche: '85.00', zimmer: 3, type: 'wohnung', nutzwert: '0.260', vsPersonen: 4 },
  ]).returning();

  const demoTenants = [
    { unitId: wienUnits[0].id, lastName: 'Müller', firstName: 'Anna', email: 'anna.mueller@demo.at', grundmiete: '485.00', betriebskostenVorschuss: '95.00', heizkostenVorschuss: '65.00', kaution: '1500.00', mietbeginn: '2020-03-01' },
    { unitId: wienUnits[1].id, lastName: 'Schmidt', firstName: 'Hans', email: 'hans.schmidt@demo.at', grundmiete: '720.00', betriebskostenVorschuss: '120.00', heizkostenVorschuss: '85.00', kaution: '2200.00', mietbeginn: '2019-06-01' },
    { unitId: wienUnits[2].id, lastName: 'Weber', firstName: 'Maria', email: 'maria.weber@demo.at', grundmiete: '650.00', betriebskostenVorschuss: '110.00', heizkostenVorschuss: '75.00', kaution: '2000.00', mietbeginn: '2021-01-01' },
    { unitId: wienUnits[3].id, lastName: 'Huber', firstName: 'Franz', email: 'franz.huber@demo.at', grundmiete: '850.00', betriebskostenVorschuss: '135.00', heizkostenVorschuss: '95.00', kaution: '2600.00', mietbeginn: '2022-04-01' },
    { unitId: wienUnits[5].id, lastName: 'GmbH', firstName: 'Cafe Zentral', email: 'office@cafezentral.demo.at', grundmiete: '1800.00', betriebskostenVorschuss: '280.00', heizkostenVorschuss: '150.00', kaution: '5500.00', mietbeginn: '2018-01-01' },
    { unitId: grazUnits[0].id, lastName: 'Pichler', firstName: 'Eva', email: 'eva.pichler@demo.at', grundmiete: '580.00', betriebskostenVorschuss: '100.00', heizkostenVorschuss: '70.00', kaution: '1800.00', mietbeginn: '2023-02-01' },
    { unitId: grazUnits[1].id, lastName: 'Berger', firstName: 'Thomas', email: 'thomas.berger@demo.at', grundmiete: '780.00', betriebskostenVorschuss: '130.00', heizkostenVorschuss: '90.00', kaution: '2400.00', mietbeginn: '2022-08-01' },
    { unitId: grazUnits[2].id, lastName: 'Koller', firstName: 'Sabine', email: 'sabine.koller@demo.at', grundmiete: '780.00', betriebskostenVorschuss: '130.00', heizkostenVorschuss: '90.00', kaution: '2400.00', mietbeginn: '2021-11-01' },
  ];

  const insertedTenants = await db.insert(tenants).values(
    demoTenants.map(t => ({
      ...t,
      status: 'aktiv' as const,
      iban: encryptField('AT611904300234573201'),
    }))
  ).returning();

  for (const tenant of insertedTenants) {
    const tenantUnit = [...wienUnits, ...grazUnits].find(u => u.id === tenant.unitId);
    if (!tenantUnit) continue;

    const grundmiete = Number(tenant.grundmiete) || 0;
    const bk = Number(tenant.betriebskostenVorschuss) || 0;
    const hk = Number(tenant.heizkostenVorschuss) || 0;
    const gesamt = grundmiete + bk + hk;

    for (let m = 1; m <= currentMonth; m++) {
      await db.insert(monthlyInvoices).values({
        tenantId: tenant.id,
        unitId: tenantUnit.id,
        month: m,
        year: currentYear,
        grundmiete: grundmiete.toFixed(2),
        betriebskosten: bk.toFixed(2),
        heizungskosten: hk.toFixed(2),
        gesamtbetrag: gesamt.toFixed(2),
        status: 'offen',
        paidAmount: '0.00',
        faelligAm: `${currentYear}-${String(m).padStart(2, '0')}-05`,
      });
    }
  }

  await db.insert(expenses).values([
    { propertyId: prop1.id, expenseType: 'versicherung', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Gebäudeversicherung 2025', betrag: '3600.00', datum: `${currentYear}-01-15`, year: currentYear, month: 1 },
    { propertyId: prop1.id, expenseType: 'grundsteuer', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Grundsteuer Q1', betrag: '450.00', datum: `${currentYear}-02-01`, year: currentYear, month: 2 },
    { propertyId: prop1.id, expenseType: 'hausbetreuung', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Hausbetreuung Jänner-März', betrag: '1200.00', datum: `${currentYear}-03-31`, year: currentYear, month: 3 },
    { propertyId: prop1.id, expenseType: 'muellabfuhr', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Müllabfuhr Q1', betrag: '680.00', datum: `${currentYear}-03-15`, year: currentYear, month: 3 },
    { propertyId: prop2.id, expenseType: 'versicherung', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Gebäudeversicherung 2025', betrag: '2400.00', datum: `${currentYear}-01-20`, year: currentYear, month: 1 },
    { propertyId: prop2.id, expenseType: 'heizung', category: 'betriebskosten_umlagefaehig', bezeichnung: 'Fernwärme Q1', betrag: '3200.00', datum: `${currentYear}-03-31`, year: currentYear, month: 3 },
  ]);

  // Demo Zähler (Meters) für Wien
  const wienMeters = await db.insert(meters).values([
    { unitId: wienUnits[0].id, propertyId: prop1.id, meterNumber: 'W-ST-001', meterType: 'strom', location: 'Zählerkasten Keller' },
    { unitId: wienUnits[0].id, propertyId: prop1.id, meterNumber: 'W-WA-001', meterType: 'wasser', location: 'Badezimmer' },
    { unitId: wienUnits[1].id, propertyId: prop1.id, meterNumber: 'W-ST-002', meterType: 'strom', location: 'Zählerkasten Keller' },
    { unitId: wienUnits[1].id, propertyId: prop1.id, meterNumber: 'W-HZ-002', meterType: 'heizung', location: 'Wohnzimmer' },
    { unitId: wienUnits[2].id, propertyId: prop1.id, meterNumber: 'W-ST-003', meterType: 'strom', location: 'Zählerkasten Keller' },
    { unitId: wienUnits[3].id, propertyId: prop1.id, meterNumber: 'W-ST-004', meterType: 'strom', location: 'Zählerkasten Keller' },
  ]).returning();

  // Demo Zählerstand-Ablesungen
  const lastMonth = new Date(now);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const lastMonthStr = lastMonth.toISOString().split('T')[0];
  
  await db.insert(meterReadings).values([
    { meterId: wienMeters[0].id, readingDate: lastMonthStr, readingValue: '4523.500', readBy: 'Demo Ableser' },
    { meterId: wienMeters[1].id, readingDate: lastMonthStr, readingValue: '125.300', readBy: 'Demo Ableser' },
    { meterId: wienMeters[2].id, readingDate: lastMonthStr, readingValue: '6782.100', readBy: 'Demo Ableser' },
    { meterId: wienMeters[3].id, readingDate: lastMonthStr, readingValue: '3456.000', readBy: 'Demo Ableser' },
  ]);

  // Demo Schlüssel (Key Inventory) für Wien
  await db.insert(keyInventory).values([
    { propertyId: prop1.id, unitId: null, keyType: 'hauptschluessel', keyNumber: 'HS-001', description: 'Hauptschlüssel Hauseingang', totalCount: 3, availableCount: 1 },
    { propertyId: prop1.id, unitId: wienUnits[0].id, keyType: 'wohnungsschluessel', keyNumber: 'WS-T1-001', description: 'Wohnungsschlüssel Top 1', totalCount: 3, availableCount: 1 },
    { propertyId: prop1.id, unitId: wienUnits[0].id, keyType: 'kellerschluessel', keyNumber: 'KS-T1-001', description: 'Kellerschlüssel Top 1', totalCount: 2, availableCount: 0 },
    { propertyId: prop1.id, unitId: wienUnits[1].id, keyType: 'wohnungsschluessel', keyNumber: 'WS-T2-001', description: 'Wohnungsschlüssel Top 2', totalCount: 3, availableCount: 1 },
    { propertyId: prop1.id, unitId: wienUnits[2].id, keyType: 'wohnungsschluessel', keyNumber: 'WS-T3-001', description: 'Wohnungsschlüssel Top 3', totalCount: 3, availableCount: 1 },
    { propertyId: prop1.id, unitId: wienUnits[5].id, keyType: 'wohnungsschluessel', keyNumber: 'WS-GE-001', description: 'Geschäftsschlüssel EG', totalCount: 4, availableCount: 2 },
    { propertyId: prop2.id, unitId: null, keyType: 'hauptschluessel', keyNumber: 'HS-G-001', description: 'Hauptschlüssel Graz', totalCount: 2, availableCount: 1 },
    { propertyId: prop2.id, unitId: grazUnits[0].id, keyType: 'wohnungsschluessel', keyNumber: 'WS-G-T1', description: 'Wohnungsschlüssel Graz Top 1', totalCount: 3, availableCount: 1 },
  ]);

  console.log(`Demo data created for organization ${organizationId}`);
}

export const demoService = {
  requestDemoAccess,
  activateDemo,
  getDemoStatus,
  isDemoExpired,
};
