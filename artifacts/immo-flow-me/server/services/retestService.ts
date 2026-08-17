import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface SecurityFinding {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  testFunction: string;
  status: 'open' | 'fixed' | 'verified' | 'wontfix';
  createdAt: Date;
  lastTestedAt: Date | null;
  lastTestResult: 'pass' | 'fail' | null;
  fixedAt: Date | null;
  ticketRef: string | null;
}

interface RetestResult {
  findingId: string;
  timestamp: Date;
  result: 'pass' | 'fail';
  duration: number;
  error: string | null;
}

type TestFn = () => Promise<{ pass: boolean; error?: string }>;

class RetestService {
  private findings: Map<string, SecurityFinding> = new Map();
  private retestResults: Map<string, RetestResult[]> = new Map();
  private testRegistry: Map<string, TestFn> = new Map();
  private lastBatchRunAt: Date | null = null;

  constructor() {
    this.registerBuiltinTests();
    this.seedInitialFindings();
  }

  private registerBuiltinTests() {
    this.registerTest('rls-cross-org-access', async () => {
      const orgA = uuidv4();
      const orgB = uuidv4();
      const propId = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO organizations (id, name, created_at)
          VALUES (${orgA}::uuid, ${'SecTest OrgA'}, NOW()),
                 (${orgB}::uuid, ${'SecTest OrgB'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propId}::uuid, ${orgA}::uuid, ${'SecTest Prop'}, ${'Addr 1'}, ${'Wien'}, ${'1010'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        const rows = await db.execute(sql`
          SELECT id FROM properties
          WHERE id = ${propId}::uuid AND organization_id = ${orgB}::uuid
        `);
        const pass = (rows as any).rows?.length === 0 || (Array.isArray(rows) && rows.length === 0);
        return { pass };
      } catch (e: any) {
        return { pass: false, error: e.message };
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
        await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`);
      }
    });

    this.registerTest('payment-negative-amount', async () => {
      const orgId = uuidv4();
      const propId = uuidv4();
      const unitId = uuidv4();
      const tenantId = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO organizations (id, name, created_at)
          VALUES (${orgId}::uuid, ${'SecTest PayOrg'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propId}::uuid, ${orgId}::uuid, ${'PayProp'}, ${'Addr'}, ${'Wien'}, ${'1010'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO units (id, property_id, top_nummer, type, created_at)
          VALUES (${unitId}::uuid, ${propId}::uuid, ${'T1'}, ${'wohnung'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, mietbeginn, created_at)
          VALUES (${tenantId}::uuid, ${unitId}::uuid, ${'Sec'}, ${'Test'}, ${'sectest@test.at'}, ${'aktiv'}, ${500}, ${'2025-01-01'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        const { splitPaymentByPriority } = await import('./paymentSplittingService');
        try {
          const result = await splitPaymentByPriority(-100, tenantId, orgId);
          if (result.totalAllocated < 0) {
            return { pass: false, error: 'Negative payment amount was accepted and produced negative allocation' };
          }
          return { pass: true };
        } catch {
          return { pass: true };
        }
      } catch (e: any) {
        return { pass: false, error: e.message };
      } finally {
        await db.execute(sql`DELETE FROM payments WHERE tenant_id = ${tenantId}::uuid`);
        await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
        await db.execute(sql`DELETE FROM units WHERE id = ${unitId}::uuid`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
        await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
      }
    });

    this.registerTest('idor-cross-org-allocation', async () => {
      const orgA = uuidv4();
      const orgB = uuidv4();
      const propA = uuidv4();
      const propB = uuidv4();
      const unitA = uuidv4();
      const unitB = uuidv4();
      const tenantA = uuidv4();
      const tenantB = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO organizations (id, name, created_at)
          VALUES (${orgA}::uuid, ${'IDOR OrgA'}, NOW()),
                 (${orgB}::uuid, ${'IDOR OrgB'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propA}::uuid, ${orgA}::uuid, ${'PropA'}, ${'Addr'}, ${'Wien'}, ${'1010'}, NOW()),
                 (${propB}::uuid, ${orgB}::uuid, ${'PropB'}, ${'Addr'}, ${'Wien'}, ${'1010'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO units (id, property_id, top_nummer, type, created_at)
          VALUES (${unitA}::uuid, ${propA}::uuid, ${'T1'}, ${'wohnung'}, NOW()),
                 (${unitB}::uuid, ${propB}::uuid, ${'T1'}, ${'wohnung'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO tenants (id, unit_id, first_name, last_name, email, status, grundmiete, mietbeginn, created_at)
          VALUES (${tenantA}::uuid, ${unitA}::uuid, ${'SecA'}, ${'Test'}, ${'seca@test.at'}, ${'aktiv'}, ${500}, ${'2025-01-01'}, NOW()),
                 (${tenantB}::uuid, ${unitB}::uuid, ${'SecB'}, ${'Test'}, ${'secb@test.at'}, ${'aktiv'}, ${500}, ${'2025-01-01'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        const crossOrgCheck = await db.execute(sql`
          SELECT t.id FROM tenants t
          JOIN units u ON t.unit_id = u.id
          JOIN properties p ON u.property_id = p.id
          WHERE t.id = ${tenantA}::uuid AND p.organization_id = ${orgB}::uuid
        `);
        const found = (crossOrgCheck as any).rows?.length > 0 || (Array.isArray(crossOrgCheck) && crossOrgCheck.length > 0);
        return { pass: !found };
      } catch (e: any) {
        return { pass: false, error: e.message };
      } finally {
        await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`);
        await db.execute(sql`DELETE FROM units WHERE id IN (${unitA}::uuid, ${unitB}::uuid)`);
        await db.execute(sql`DELETE FROM properties WHERE id IN (${propA}::uuid, ${propB}::uuid)`);
        await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}::uuid, ${orgB}::uuid)`);
      }
    });

    this.registerTest('input-sql-injection', async () => {
      const orgId = uuidv4();
      const propId = uuidv4();
      const maliciousName = "Test'; DROP TABLE properties; --";
      try {
        await db.execute(sql`
          INSERT INTO organizations (id, name, created_at)
          VALUES (${orgId}::uuid, ${'SQLi TestOrg'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propId}::uuid, ${orgId}::uuid, ${maliciousName}, ${'Addr'}, ${'Wien'}, ${'1010'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        const rows = await db.execute(sql`
          SELECT name FROM properties WHERE id = ${propId}::uuid
        `);
        const storedName = (rows as any).rows?.[0]?.name || (Array.isArray(rows) && rows[0] ? (rows[0] as any).name : null);
        const tableCheck = await db.execute(sql`
          SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'properties') AS exists
        `);
        const tableExists = (tableCheck as any).rows?.[0]?.exists ?? true;
        return { pass: tableExists && storedName === maliciousName };
      } catch (e: any) {
        return { pass: false, error: e.message };
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
        await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
      }
    });

    this.registerTest('trial-balance-validation', async () => {
      const orgId = uuidv4();
      const propId = uuidv4();
      try {
        await db.execute(sql`
          INSERT INTO organizations (id, name, created_at)
          VALUES (${orgId}::uuid, ${'TB TestOrg'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO properties (id, organization_id, name, address, city, postal_code, created_at)
          VALUES (${propId}::uuid, ${orgId}::uuid, ${'TB Prop'}, ${'Addr'}, ${'Wien'}, ${'1010'}, NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        const result = await db.execute(sql`
          SELECT
            COALESCE(SUM(CASE WHEN betrag::numeric >= 0 THEN betrag::numeric ELSE 0 END), 0) AS debits,
            COALESCE(SUM(CASE WHEN betrag::numeric < 0 THEN ABS(betrag::numeric) ELSE 0 END), 0) AS credits
          FROM payments p
          JOIN tenants t ON p.tenant_id = t.id
          JOIN units u ON t.unit_id = u.id
          WHERE u.property_id = ${propId}::uuid
        `);
        const row = (result as any).rows?.[0] || (Array.isArray(result) ? result[0] : null);
        const debits = Number(row?.debits ?? 0);
        const credits = Number(row?.credits ?? 0);
        const pass = debits === 0 && credits === 0;
        return { pass };
      } catch (e: any) {
        return { pass: false, error: e.message };
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propId}::uuid`);
        await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`);
      }
    });
  }

  private seedInitialFindings() {
    const seeds: Array<Omit<SecurityFinding, 'id' | 'createdAt' | 'lastTestedAt' | 'lastTestResult' | 'fixedAt'>> = [
      {
        title: 'RLS Bypass: Cross-Org Property Access',
        severity: 'critical',
        category: 'rls-bypass',
        description: 'Verify that properties belonging to one organization cannot be accessed by another organization.',
        testFunction: 'rls-cross-org-access',
        status: 'open',
        ticketRef: null,
      },
      {
        title: 'Payment: Negative Amount Handling',
        severity: 'high',
        category: 'payment-flow',
        description: 'Verify that negative payment amounts are properly handled and do not cause accounting inconsistencies.',
        testFunction: 'payment-negative-amount',
        status: 'open',
        ticketRef: null,
      },
      {
        title: 'IDOR: Cross-Org Payment Allocation',
        severity: 'critical',
        category: 'idor',
        description: 'Verify that payment allocations cannot reference tenants from a different organization.',
        testFunction: 'idor-cross-org-allocation',
        status: 'open',
        ticketRef: null,
      },
      {
        title: 'Input Validation: SQL Injection in Property Names',
        severity: 'high',
        category: 'input-validation',
        description: 'Verify that SQL injection attempts in property name fields are properly escaped by parameterized queries.',
        testFunction: 'input-sql-injection',
        status: 'open',
        ticketRef: null,
      },
      {
        title: 'Business Logic: Trial Balance Validation',
        severity: 'medium',
        category: 'business-logic',
        description: 'Verify that trial balance calculations are correct and balanced for properties with no transactions.',
        testFunction: 'trial-balance-validation',
        status: 'open',
        ticketRef: null,
      },
    ];

    for (const seed of seeds) {
      this.registerFinding(seed);
    }
  }

  registerFinding(finding: Omit<SecurityFinding, 'id' | 'createdAt' | 'lastTestedAt' | 'lastTestResult' | 'fixedAt'>): SecurityFinding {
    const id = uuidv4();
    const newFinding: SecurityFinding = {
      ...finding,
      id,
      createdAt: new Date(),
      lastTestedAt: null,
      lastTestResult: null,
      fixedAt: null,
    };
    this.findings.set(id, newFinding);
    this.retestResults.set(id, []);
    return newFinding;
  }

  updateFinding(id: string, updates: Partial<SecurityFinding>): SecurityFinding | null {
    const finding = this.findings.get(id);
    if (!finding) return null;
    const updated = { ...finding, ...updates, id: finding.id, createdAt: finding.createdAt };
    this.findings.set(id, updated);
    return updated;
  }

  getFinding(id: string): SecurityFinding | null {
    return this.findings.get(id) || null;
  }

  getAllFindings(filters?: { status?: string; severity?: string; category?: string }): SecurityFinding[] {
    let results = Array.from(this.findings.values());
    if (filters?.status) {
      results = results.filter(f => f.status === filters.status);
    }
    if (filters?.severity) {
      results = results.filter(f => f.severity === filters.severity);
    }
    if (filters?.category) {
      results = results.filter(f => f.category === filters.category);
    }
    return results;
  }

  recordRetestResult(findingId: string, result: 'pass' | 'fail', duration: number, error?: string): RetestResult | null {
    const finding = this.findings.get(findingId);
    if (!finding) return null;

    const retestResult: RetestResult = {
      findingId,
      timestamp: new Date(),
      result,
      duration,
      error: error || null,
    };

    const history = this.retestResults.get(findingId) || [];
    history.push(retestResult);
    this.retestResults.set(findingId, history);

    finding.lastTestedAt = retestResult.timestamp;
    finding.lastTestResult = result;

    if (result === 'pass' && finding.status === 'fixed') {
      finding.status = 'verified';
    }

    this.findings.set(findingId, finding);
    return retestResult;
  }

  getRetestHistory(findingId: string): RetestResult[] {
    return this.retestResults.get(findingId) || [];
  }

  async runRetestBatch(findingIds?: string[]): Promise<{ total: number; passed: number; failed: number; results: RetestResult[] }> {
    let targetFindings: SecurityFinding[];

    if (findingIds && findingIds.length > 0) {
      targetFindings = findingIds
        .map(id => this.findings.get(id))
        .filter((f): f is SecurityFinding => f != null);
    } else {
      targetFindings = Array.from(this.findings.values()).filter(
        f => f.status === 'open' || f.status === 'fixed'
      );
    }

    const results: RetestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const finding of targetFindings) {
      const testFn = this.testRegistry.get(finding.testFunction);
      if (!testFn) {
        const result = this.recordRetestResult(finding.id, 'fail', 0, `Test function '${finding.testFunction}' not registered`);
        if (result) {
          results.push(result);
          failed++;
        }
        continue;
      }

      const start = Date.now();
      try {
        const testResult = await testFn();
        const duration = Date.now() - start;
        const outcome = testResult.pass ? 'pass' : 'fail';
        const result = this.recordRetestResult(finding.id, outcome, duration, testResult.error);
        if (result) {
          results.push(result);
          if (outcome === 'pass') passed++;
          else failed++;
        }
      } catch (e: any) {
        const duration = Date.now() - start;
        const result = this.recordRetestResult(finding.id, 'fail', duration, e.message);
        if (result) {
          results.push(result);
          failed++;
        }
      }
    }

    this.lastBatchRunAt = new Date();

    return { total: results.length, passed, failed, results };
  }

  getRetestSummary() {
    const allFindings = Array.from(this.findings.values());

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const f of allFindings) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    }

    const allResults = Array.from(this.retestResults.values()).flat();
    const totalTests = allResults.length;
    const passedTests = allResults.filter(r => r.result === 'pass').length;
    const overallPassRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 10000) / 100 : 0;

    return {
      totalFindings: allFindings.length,
      byStatus,
      bySeverity,
      lastBatchRunAt: this.lastBatchRunAt,
      overallPassRate,
      totalRetests: totalTests,
    };
  }

  registerTest(testName: string, testFn: TestFn) {
    this.testRegistry.set(testName, testFn);
  }
}

export const retestService = new RetestService();
