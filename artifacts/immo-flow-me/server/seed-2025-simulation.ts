import { db } from './db';
import { 
  organizations, properties, units, tenants, monthlyInvoices, 
  payments, expenses, owners, propertyOwners, settlements, settlementDetails 
} from '@shared/schema';
import { encryptField } from './lib/fieldEncryption';
import { eq } from 'drizzle-orm';

const MIETE = 650;
const BK_VORSCHUSS = 120;
const HK_VORSCHUSS = 80;
const KAUTION = 1950;

interface SimulationResult {
  organizationId: string;
  propertyId: string;
  ownerId: string;
  unitIds: string[];
  tenantIds: string[];
  invoiceCount: number;
  paymentCount: number;
  expenseCount: number;
}

export async function runSimulation(): Promise<SimulationResult> {
  console.log('🏠 Starting 2025 Simulation...');

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new Error('Keine Organisation gefunden. Bitte zuerst einloggen.');
  }
  const orgId = org.id;

  const [property] = await db.insert(properties).values({
    organizationId: orgId,
    name: 'Musterhaus Simulation 2025',
    address: 'Simulationsstraße 42',
    city: 'Wien',
    postalCode: '1100',
    totalUnits: 5,
    totalArea: '450.00',
    constructionYear: 1985,
    notes: 'Simulation für BK-Abrechnung 2025',
  }).returning();

  console.log(`✅ Liegenschaft erstellt: ${property.name}`);

  const [owner] = await db.insert(owners).values({
    organizationId: orgId,
    firstName: 'Maria',
    lastName: 'Eigentümer',
    email: 'eigentuemer@beispiel.at',
    phone: '+43 1 234 5678',
    address: 'Eigentümerweg 1',
    city: 'Wien',
    postalCode: '1010',
  }).returning();

  await db.insert(propertyOwners).values({
    propertyId: property.id,
    ownerId: owner.id,
    ownershipShare: '100.00',
    validFrom: '2020-01-01',
  });

  console.log(`✅ Eigentümer erstellt: ${owner.firstName} ${owner.lastName}`);

  const unitData = [
    { topNummer: 'Top 1', flaeche: '85.00', zimmer: 3, nutzwert: '0.1889' },
    { topNummer: 'Top 2', flaeche: '92.00', zimmer: 3, nutzwert: '0.2044' },
    { topNummer: 'Top 3', flaeche: '78.00', zimmer: 2, nutzwert: '0.1733' },
    { topNummer: 'Top 4', flaeche: '95.00', zimmer: 4, nutzwert: '0.2111' },
    { topNummer: 'Top 5', flaeche: '100.00', zimmer: 4, nutzwert: '0.2222' },
  ];

  const createdUnits = await db.insert(units).values(
    unitData.map(u => ({
      propertyId: property.id,
      topNummer: u.topNummer,
      type: 'wohnung' as const,
      status: 'aktiv' as const,
      flaeche: u.flaeche,
      zimmer: u.zimmer,
      nutzwert: u.nutzwert,
      stockwerk: parseInt(u.topNummer.replace('Top ', '')),
    }))
  ).returning();

  console.log(`✅ ${createdUnits.length} Einheiten erstellt`);

  const tenantData = [
    { firstName: 'Hans', lastName: 'Müller', unitIndex: 0, mietbeginn: '2022-01-01', mietende: null, status: 'aktiv' as const },
    { firstName: 'Anna', lastName: 'Schmidt', unitIndex: 1, mietbeginn: '2021-06-01', mietende: null, status: 'aktiv' as const },
    { firstName: 'Peter', lastName: 'Huber', unitIndex: 2, mietbeginn: '2020-03-01', mietende: '2025-03-31', status: 'beendet' as const },
    { firstName: 'Lisa', lastName: 'Neumieter', unitIndex: 2, mietbeginn: '2025-05-01', mietende: null, status: 'aktiv' as const },
    { firstName: 'Franz', lastName: 'Zahlungssäumig', unitIndex: 3, mietbeginn: '2023-09-01', mietende: null, status: 'aktiv' as const },
    { firstName: 'Claudia', lastName: 'Bauer', unitIndex: 4, mietbeginn: '2019-11-01', mietende: null, status: 'aktiv' as const },
  ];

  const createdTenants = await db.insert(tenants).values(
    tenantData.map((t, i) => ({
      unitId: createdUnits[t.unitIndex].id,
      firstName: t.firstName,
      lastName: t.lastName,
      email: `${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}@beispiel.at`,
      phone: `+43 1 ${100 + i}${200 + i}${300 + i}`,
      status: t.status,
      mietbeginn: t.mietbeginn,
      mietende: t.mietende,
      grundmiete: MIETE.toString(),
      betriebskostenVorschuss: BK_VORSCHUSS.toString(),
      heizkostenVorschuss: HK_VORSCHUSS.toString(),
      kaution: KAUTION.toString(),
      kautionBezahlt: true,
      iban: encryptField(`AT61 1234 5678 9012 ${3456 + i}`),
      sepaMandat: true,
      sepaMandatDatum: t.mietbeginn,
    }))
  ).returning();

  console.log(`✅ ${createdTenants.length} Mieter erstellt`);

  const hansMueller = createdTenants[0];
  const annaSchmidt = createdTenants[1];
  const peterHuber = createdTenants[2];
  const lisaNeumieter = createdTenants[3];
  const franzSaeumig = createdTenants[4];
  const claudiaBauer = createdTenants[5];

  const invoices: any[] = [];
  const paymentsToCreate: any[] = [];

  const calculateVAT = (miete: number, bk: number, hk: number) => {
    return miete * 0.10 + bk * 0.10 + hk * 0.20;
  };

  for (let month = 1; month <= 12; month++) {
    const ust = calculateVAT(MIETE, BK_VORSCHUSS, HK_VORSCHUSS);
    const total = MIETE + BK_VORSCHUSS + HK_VORSCHUSS + ust;
    const faellig = `2025-${month.toString().padStart(2, '0')}-05`;
    const buchung = `2025-${month.toString().padStart(2, '0')}-03`;

    invoices.push({
      tenantId: hansMueller.id,
      unitId: createdUnits[0].id,
      year: 2025,
      month,
      grundmiete: MIETE.toString(),
      betriebskosten: BK_VORSCHUSS.toString(),
      heizungskosten: HK_VORSCHUSS.toString(),
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      ust: ust.toFixed(2),
      gesamtbetrag: total.toFixed(2),
      status: 'bezahlt' as const,
      faelligAm: faellig,
    });
    paymentsToCreate.push({ tenantId: hansMueller.id, unitId: createdUnits[0].id, betrag: total, buchung });

    invoices.push({
      tenantId: annaSchmidt.id,
      unitId: createdUnits[1].id,
      year: 2025,
      month,
      grundmiete: MIETE.toString(),
      betriebskosten: BK_VORSCHUSS.toString(),
      heizungskosten: HK_VORSCHUSS.toString(),
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      ust: ust.toFixed(2),
      gesamtbetrag: total.toFixed(2),
      status: 'bezahlt' as const,
      faelligAm: faellig,
    });
    paymentsToCreate.push({ tenantId: annaSchmidt.id, unitId: createdUnits[1].id, betrag: total, buchung });

    if (month <= 3) {
      invoices.push({
        tenantId: peterHuber.id,
        unitId: createdUnits[2].id,
        year: 2025,
        month,
        grundmiete: MIETE.toString(),
        betriebskosten: BK_VORSCHUSS.toString(),
        heizungskosten: HK_VORSCHUSS.toString(),
        ustSatzMiete: 10,
        ustSatzBk: 10,
        ustSatzHeizung: 20,
        ust: ust.toFixed(2),
        gesamtbetrag: total.toFixed(2),
        status: 'bezahlt' as const,
        faelligAm: faellig,
      });
      paymentsToCreate.push({ tenantId: peterHuber.id, unitId: createdUnits[2].id, betrag: total, buchung });
    }

    if (month >= 5) {
      invoices.push({
        tenantId: lisaNeumieter.id,
        unitId: createdUnits[2].id,
        year: 2025,
        month,
        grundmiete: MIETE.toString(),
        betriebskosten: BK_VORSCHUSS.toString(),
        heizungskosten: HK_VORSCHUSS.toString(),
        ustSatzMiete: 10,
        ustSatzBk: 10,
        ustSatzHeizung: 20,
        ust: ust.toFixed(2),
        gesamtbetrag: total.toFixed(2),
        status: 'bezahlt' as const,
        faelligAm: faellig,
      });
      paymentsToCreate.push({ tenantId: lisaNeumieter.id, unitId: createdUnits[2].id, betrag: total, buchung });
    }

    const unpaidMieteMonths = [8, 11];
    const unpaidBkMonths = [3, 6, 9];
    
    let franzStatus: 'offen' | 'bezahlt' | 'teilbezahlt' = 'bezahlt';
    let franzPaid = true;
    
    if (unpaidMieteMonths.includes(month)) {
      franzStatus = 'offen';
      franzPaid = false;
    } else if (unpaidBkMonths.includes(month) && !unpaidMieteMonths.includes(month)) {
      franzStatus = 'teilbezahlt';
    }

    invoices.push({
      tenantId: franzSaeumig.id,
      unitId: createdUnits[3].id,
      year: 2025,
      month,
      grundmiete: MIETE.toString(),
      betriebskosten: BK_VORSCHUSS.toString(),
      heizungskosten: HK_VORSCHUSS.toString(),
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      ust: ust.toFixed(2),
      gesamtbetrag: total.toFixed(2),
      status: franzStatus,
      faelligAm: faellig,
      vortragBk: unpaidBkMonths.includes(month) ? BK_VORSCHUSS.toFixed(2) : '0.00',
    });
    
    if (franzPaid) {
      if (unpaidBkMonths.includes(month)) {
        paymentsToCreate.push({ tenantId: franzSaeumig.id, unitId: createdUnits[3].id, betrag: total - BK_VORSCHUSS, buchung });
      } else {
        paymentsToCreate.push({ tenantId: franzSaeumig.id, unitId: createdUnits[3].id, betrag: total, buchung });
      }
    }

    invoices.push({
      tenantId: claudiaBauer.id,
      unitId: createdUnits[4].id,
      year: 2025,
      month,
      grundmiete: MIETE.toString(),
      betriebskosten: BK_VORSCHUSS.toString(),
      heizungskosten: HK_VORSCHUSS.toString(),
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      ust: ust.toFixed(2),
      gesamtbetrag: total.toFixed(2),
      status: 'bezahlt' as const,
      faelligAm: faellig,
    });
    paymentsToCreate.push({ tenantId: claudiaBauer.id, unitId: createdUnits[4].id, betrag: total, buchung });
  }

  await db.insert(monthlyInvoices).values(invoices);
  console.log(`✅ ${invoices.length} Vorschreibungen erstellt`);

  const paymentInserts = paymentsToCreate.map(p => ({
    tenantId: p.tenantId,
    betrag: p.betrag.toFixed(2),
    buchungsDatum: p.buchung,
    paymentType: 'ueberweisung' as const,
    verwendungszweck: `Miete + BK ${p.buchung.substring(0, 7)}`,
  }));

  await db.insert(payments).values(paymentInserts);
  console.log(`✅ ${paymentInserts.length} Zahlungen erstellt`);

  const expenseData = [
    { month: 1, type: 'wasser_abwasser', betrag: 450, bezeichnung: 'Wassergebühren Q1', kategorie: 'betriebskosten_umlagefaehig', mrg: 'wasserversorgung' },
    { month: 1, type: 'muellabfuhr', betrag: 280, bezeichnung: 'Müllabfuhr Q1', kategorie: 'betriebskosten_umlagefaehig', mrg: 'muellabfuhr' },
    { month: 2, type: 'versicherung', betrag: 1200, bezeichnung: 'Gebäudeversicherung 2025', kategorie: 'betriebskosten_umlagefaehig', mrg: 'feuerversicherung' },
    { month: 2, type: 'hausbetreuung', betrag: 320, bezeichnung: 'Hausbetreuung Jan-Feb', kategorie: 'betriebskosten_umlagefaehig', mrg: 'hausbetreuung' },
    { month: 3, type: 'heizung', betrag: 2800, bezeichnung: 'Heizkosten Winter Q1', kategorie: 'betriebskosten_umlagefaehig', mrg: 'sonstige' },
    { month: 3, type: 'reparatur', betrag: 3500, bezeichnung: 'Dachsanierung Teil 1', kategorie: 'instandhaltung', mrg: null },
    { month: 4, type: 'grundsteuer', betrag: 890, bezeichnung: 'Grundsteuer 2025', kategorie: 'betriebskosten_umlagefaehig', mrg: 'grundsteuer' },
    { month: 4, type: 'wasser_abwasser', betrag: 480, bezeichnung: 'Wassergebühren Q2', kategorie: 'betriebskosten_umlagefaehig', mrg: 'wasserversorgung' },
    { month: 5, type: 'hausbetreuung', betrag: 320, bezeichnung: 'Hausbetreuung März-Apr', kategorie: 'betriebskosten_umlagefaehig', mrg: 'hausbetreuung' },
    { month: 5, type: 'sanierung', betrag: 5000, bezeichnung: 'Fassadenreparatur (Budgetüberschreitung)', kategorie: 'instandhaltung', mrg: null },
    { month: 6, type: 'gartenpflege', betrag: 450, bezeichnung: 'Gartenpflege Frühjahr', kategorie: 'betriebskosten_umlagefaehig', mrg: 'sonstige' },
    { month: 6, type: 'strom_allgemein', betrag: 380, bezeichnung: 'Allgemeinstrom H1', kategorie: 'betriebskosten_umlagefaehig', mrg: 'lichtkosten' },
    { month: 7, type: 'wasser_abwasser', betrag: 420, bezeichnung: 'Wassergebühren Q3', kategorie: 'betriebskosten_umlagefaehig', mrg: 'wasserversorgung' },
    { month: 7, type: 'muellabfuhr', betrag: 290, bezeichnung: 'Müllabfuhr Q2', kategorie: 'betriebskosten_umlagefaehig', mrg: 'muellabfuhr' },
    { month: 8, type: 'hausbetreuung', betrag: 320, bezeichnung: 'Hausbetreuung Mai-Jun', kategorie: 'betriebskosten_umlagefaehig', mrg: 'hausbetreuung' },
    { month: 8, type: 'reparatur', betrag: 2200, bezeichnung: 'Aufzugswartung + Reparatur', kategorie: 'instandhaltung', mrg: null },
    { month: 9, type: 'heizung', betrag: 1200, bezeichnung: 'Heizungsanlage Service', kategorie: 'betriebskosten_umlagefaehig', mrg: 'sonstige' },
    { month: 10, type: 'wasser_abwasser', betrag: 440, bezeichnung: 'Wassergebühren Q4', kategorie: 'betriebskosten_umlagefaehig', mrg: 'wasserversorgung' },
    { month: 10, type: 'hausbetreuung', betrag: 320, bezeichnung: 'Hausbetreuung Jul-Aug', kategorie: 'betriebskosten_umlagefaehig', mrg: 'hausbetreuung' },
    { month: 11, type: 'muellabfuhr', betrag: 285, bezeichnung: 'Müllabfuhr Q3', kategorie: 'betriebskosten_umlagefaehig', mrg: 'muellabfuhr' },
    { month: 11, type: 'reparatur', betrag: 1300, bezeichnung: 'Fensterreparatur Top 3', kategorie: 'instandhaltung', mrg: null },
    { month: 12, type: 'heizung', betrag: 2600, bezeichnung: 'Heizkosten Winter Q4', kategorie: 'betriebskosten_umlagefaehig', mrg: 'sonstige' },
    { month: 12, type: 'verwaltung', betrag: 2400, bezeichnung: 'Verwaltungshonorar 2025', kategorie: 'betriebskosten_umlagefaehig', mrg: 'verwaltung' },
    { month: 12, type: 'strom_allgemein', betrag: 395, bezeichnung: 'Allgemeinstrom H2', kategorie: 'betriebskosten_umlagefaehig', mrg: 'lichtkosten' },
  ];

  const expenseInserts = expenseData.map(e => ({
    propertyId: property.id,
    category: e.kategorie as 'betriebskosten_umlagefaehig' | 'instandhaltung',
    expenseType: e.type as any,
    bezeichnung: e.bezeichnung,
    betrag: e.betrag.toFixed(2),
    datum: `2025-${e.month.toString().padStart(2, '0')}-15`,
    belegNummer: `2025/${e.month.toString().padStart(2, '0')}/${Math.floor(Math.random() * 1000)}`,
    year: 2025,
    month: e.month,
    mrgKategorie: e.mrg as any,
    istUmlagefaehig: e.kategorie === 'betriebskosten_umlagefaehig',
  }));

  await db.insert(expenses).values(expenseInserts);
  console.log(`✅ ${expenseInserts.length} Ausgaben erstellt`);

  const totalBK = expenseData
    .filter(e => e.kategorie === 'betriebskosten_umlagefaehig')
    .reduce((sum, e) => sum + e.betrag, 0);
  
  const totalInstandhaltung = expenseData
    .filter(e => e.kategorie === 'instandhaltung')
    .reduce((sum, e) => sum + e.betrag, 0);

  console.log(`\n📊 ZUSAMMENFASSUNG:`);
  console.log(`   Betriebskosten gesamt: €${totalBK.toFixed(2)}`);
  console.log(`   Instandhaltung gesamt: €${totalInstandhaltung.toFixed(2)}`);
  console.log(`   Budget genehmigt: €4.500,00`);
  console.log(`   Budgetüberschreitung: €${(totalInstandhaltung - 4500).toFixed(2)}`);
  console.log(`\n   Rückstände Franz Zahlungssäumig:`);
  console.log(`   - 2 Monate Miete: €${(MIETE * 2).toFixed(2)}`);
  console.log(`   - 3 Monate BK: €${(BK_VORSCHUSS * 3).toFixed(2)}`);
  console.log(`   Leerstand Top 3: April 2025 (1 Monat)`);

  return {
    organizationId: orgId,
    propertyId: property.id,
    ownerId: owner.id,
    unitIds: createdUnits.map(u => u.id),
    tenantIds: createdTenants.map(t => t.id),
    invoiceCount: invoices.length,
    paymentCount: paymentInserts.length,
    expenseCount: expenseInserts.length,
  };
}
