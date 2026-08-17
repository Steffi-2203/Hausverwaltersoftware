/**
 * Unit Test Runner für ImmoflowMe
 * 
 * TESTSTRATEGIE:
 * Diese Tests validieren die mathematischen Formeln und Geschäftslogik
 * für österreichische rechtliche Compliance (MRG, ABGB §1333, MieWeG).
 * 
 * Die Tests implementieren reine Funktionen die die erwartete Logik
 * abbilden und dienen als Referenzimplementierung für Production-Code.
 * 
 * Getestete Komponenten:
 * - MRG-Zahlungsaufteilung (BK→HK→Miete Priorität)
 * - Betriebskostenabrechnung (§21 MRG Leerstand)
 * - MieWeG-Indexierung (Hälfteregelung, 2026/2027 Caps)
 * - SEPA-Export (IBAN/BIC Validierung, XML Escape)
 * - Mahnwesen (ABGB §1333 Verzugszinsen)
 * - Verteilerschlüssel (MEA, QM, Personen, Verbrauch)
 * 
 * Manuelle Testfälle: tests/manual/*.md
 */

import { runTests as runMrgAllocationTests } from './mrgAllocation.test';
import { runTests as runSettlementTests } from './settlement.test';
import { runTests as runMieWegTests } from './mieweg.test';
import { runTests as runSepaTests } from './sepa.test';
import { runTests as runDunningTests } from './dunning.test';
import { runTests as runDistributionKeysTests } from './distributionKeys.test';

interface TestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  results: string[];
}

async function runAllTests(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ImmoflowMe - Rechtssichere Komponenten Unit-Tests         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const suites: TestSuiteResult[] = [];
  
  // MRG Zahlungsaufteilung Tests
  console.log('▶ MRG-Zahlungsaufteilung (BK → HK → Miete)...');
  const mrgResult = runMrgAllocationTests();
  suites.push({
    name: 'MRG-Zahlungsaufteilung',
    ...mrgResult
  });
  mrgResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // Betriebskostenabrechnung Tests
  console.log('▶ Betriebskostenabrechnung (§21 MRG)...');
  const settlementResult = runSettlementTests();
  suites.push({
    name: 'Betriebskostenabrechnung',
    ...settlementResult
  });
  settlementResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // MieWeG Indexierungsrechner Tests
  console.log('▶ MieWeG-Indexierungsrechner (Hälfteregelung, Caps)...');
  const mieWegResult = runMieWegTests();
  suites.push({
    name: 'MieWeG-Indexierungsrechner',
    ...mieWegResult
  });
  mieWegResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // SEPA Export Tests
  console.log('▶ SEPA-Export (IBAN/BIC-Validierung, XML)...');
  const sepaResult = runSepaTests();
  suites.push({
    name: 'SEPA-Export',
    ...sepaResult
  });
  sepaResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // Mahnwesen Tests
  console.log('▶ Mahnwesen (ABGB §1333 Zinsen, Eskalation)...');
  const dunningResult = runDunningTests();
  suites.push({
    name: 'Mahnwesen',
    ...dunningResult
  });
  dunningResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // Verteilerschlüssel Tests
  console.log('▶ Verteilerschlüssel (MEA, QM, Personen, Verbrauch)...');
  const distributionResult = runDistributionKeysTests();
  suites.push({
    name: 'Verteilerschlüssel',
    ...distributionResult
  });
  distributionResult.results.forEach(r => console.log('  ' + r));
  console.log();

  // Zusammenfassung
  console.log('════════════════════════════════════════════════════════════');
  console.log('ZUSAMMENFASSUNG:');
  console.log('════════════════════════════════════════════════════════════');
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const suite of suites) {
    const status = suite.failed === 0 ? '✓' : '✗';
    console.log(`${status} ${suite.name}: ${suite.passed}/${suite.passed + suite.failed} Tests bestanden`);
    totalPassed += suite.passed;
    totalFailed += suite.failed;
  }
  
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Gesamt: ${totalPassed}/${totalPassed + totalFailed} Tests bestanden`);
  
  if (totalFailed > 0) {
    console.log('\n⚠ Es gibt fehlgeschlagene Tests!');
    process.exit(1);
  } else {
    console.log('\n✓ Alle Tests bestanden!');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Fehler beim Ausführen der Tests:', err);
  process.exit(1);
});
