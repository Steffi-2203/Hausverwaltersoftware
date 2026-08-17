import { db, rootDb } from "./db";
import { eq, and, or, desc, asc, isNull, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { encryptField, decryptField, decryptIbanRows, decryptIbanFields } from "./lib/fieldEncryption";

export interface IStorage {
  getOrganizations(): Promise<schema.Organization[]>;
  getOrganization(id: string): Promise<schema.Organization | undefined>;
  getProperties(): Promise<schema.Property[]>;
  getPropertiesByOrganization(organizationId?: string): Promise<schema.Property[]>;
  getProperty(id: string): Promise<schema.Property | undefined>;
  getUnitsByProperty(propertyId: string): Promise<schema.Unit[]>;
  getUnitsByOrganization(organizationId?: string): Promise<schema.Unit[]>;
  getUnit(id: string): Promise<schema.Unit | undefined>;
  getTenants(): Promise<schema.Tenant[]>;
  getTenantsByOrganization(organizationId?: string): Promise<schema.Tenant[]>;
  getTenant(id: string): Promise<schema.Tenant | undefined>;
  getTenantsByUnit(unitId: string): Promise<schema.Tenant[]>;
  getMonthlyInvoices(year?: number, month?: number): Promise<schema.MonthlyInvoice[]>;
  getMonthlyInvoicesByOrganization(organizationId?: string, year?: number, month?: number): Promise<schema.MonthlyInvoice[]>;
  getInvoicesByTenant(tenantId: string): Promise<schema.MonthlyInvoice[]>;
  getAllPayments(): Promise<schema.Payment[]>;
  getPaymentsByOrganization(organizationId?: string): Promise<schema.Payment[]>;
  getPaymentsByTenant(tenantId: string): Promise<schema.Payment[]>;
  getExpensesByProperty(propertyId: string, year?: number): Promise<schema.Expense[]>;
  getExpensesByOrganization(organizationId?: string): Promise<schema.Expense[]>;
  getExpense(id: string): Promise<schema.Expense | undefined>;
  getBankAccounts(): Promise<schema.BankAccount[]>;
  getBankAccount(id: string): Promise<schema.BankAccount | undefined>;
  getBankAccountsByOrganization(organizationId?: string): Promise<schema.BankAccount[]>;
  createBankAccount(data: Partial<schema.InsertBankAccount>): Promise<schema.BankAccount>;
  updateBankAccount(id: string, data: Partial<schema.InsertBankAccount>, organizationId?: string): Promise<schema.BankAccount | undefined>;
  deleteBankAccount(id: string, organizationId?: string): Promise<void>;
  getBankAccountBalance(id: string, asOfDate?: string): Promise<number>;
  getTransactionsByBankAccount(bankAccountId: string): Promise<schema.Transaction[]>;
  getTransactionsByOrganization(organizationId?: string): Promise<schema.Transaction[]>;
  getSettlementsByProperty(propertyId: string): Promise<schema.Settlement[]>;
  getMaintenanceContractsByProperty(propertyId: string): Promise<schema.MaintenanceContract[]>;
  getMaintenanceTasks(status?: string): Promise<schema.MaintenanceTask[]>;
  getMaintenanceTasksByOrganization(organizationId?: string, status?: string): Promise<schema.MaintenanceTask[]>;
  getContractors(): Promise<schema.Contractor[]>;
  getContractorsByOrganization(organizationId?: string): Promise<schema.Contractor[]>;
  getDistributionKeys(): Promise<schema.DistributionKey[]>;
  getDistributionKeysByProperty(propertyId: string): Promise<schema.DistributionKey[]>;
  getDistributionKey(id: string): Promise<schema.DistributionKey | undefined>;
  createDistributionKey(data: Partial<schema.InsertDistributionKey>): Promise<schema.DistributionKey>;
  updateDistributionKey(id: string, data: Partial<schema.InsertDistributionKey>, organizationId?: string): Promise<schema.DistributionKey | undefined>;
  deleteDistributionKey(id: string, organizationId?: string): Promise<void>;
  getAccountCategories(organizationId: string): Promise<schema.AccountCategory[]>;
  createAccountCategory(data: Partial<schema.InsertAccountCategory>): Promise<schema.AccountCategory>;
  updateAccountCategory(id: string, data: Partial<schema.InsertAccountCategory>): Promise<schema.AccountCategory | undefined>;
  deleteAccountCategory(id: string): Promise<void>;
  getUnitDistributionValues(unitId: string): Promise<schema.UnitDistributionValue[]>;
  getUnitDistributionValuesByProperty(propertyId: string): Promise<schema.UnitDistributionValue[]>;
  upsertUnitDistributionValue(data: schema.InsertUnitDistributionValue): Promise<schema.UnitDistributionValue>;
  deleteUnitDistributionValue(unitId: string, keyId: string): Promise<void>;
  createUnit(data: Partial<schema.InsertUnit>): Promise<schema.Unit>;
  updateUnit(id: string, data: Partial<schema.InsertUnit>): Promise<schema.Unit | undefined>;
  softDeleteUnit(id: string): Promise<void>;
  softDeleteTenant(id: string): Promise<void>;
  getRentHistoryByTenant(tenantId: string): Promise<schema.RentHistory[]>;
  createRentHistory(data: schema.InsertRentHistory): Promise<schema.RentHistory>;
  getSettlementByPropertyAndYear(propertyId: string, year: number): Promise<schema.Settlement | undefined>;
  getSettlementItems(settlementId: string): Promise<schema.SettlementDetail[]>;
  createSettlement(data: any): Promise<schema.Settlement>;
  updateSettlement(id: string, data: any): Promise<schema.Settlement | undefined>;
  deleteSettlementItems(settlementId: string): Promise<void>;
  createSettlementItem(data: any): Promise<schema.SettlementDetail>;
  updateTenantAdvances(tenantId: string, betriebskostenVorschuss: number, heizkostenVorschuss: number): Promise<schema.Tenant | undefined>;
  
  // Leases
  getLeasesByTenant(tenantId: string): Promise<schema.Lease[]>;
  getLeasesByUnit(unitId: string): Promise<schema.Lease[]>;
  getLease(id: string): Promise<schema.Lease | undefined>;
  createLease(data: schema.InsertLease): Promise<schema.Lease>;
  updateLease(id: string, data: Partial<schema.InsertLease>): Promise<schema.Lease | undefined>;
  
  // Payment Allocations
  getPaymentAllocationsByPayment(paymentId: string): Promise<schema.PaymentAllocation[]>;
  getPaymentAllocationsByInvoice(invoiceId: string): Promise<schema.PaymentAllocation[]>;
  createPaymentAllocation(data: schema.InsertPaymentAllocation): Promise<schema.PaymentAllocation>;
  deletePaymentAllocation(id: string): Promise<void>;
}

class DatabaseStorage implements IStorage {
  async getOrganizations(): Promise<schema.Organization[]> {
    const rows = await db.select().from(schema.organizations).orderBy(asc(schema.organizations.name));
    return decryptIbanRows(rows) as schema.Organization[];
  }

  async getOrganization(id: string): Promise<schema.Organization | undefined> {
    const result = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    if (!result[0]) return undefined;
    return decryptIbanFields(result[0]) as schema.Organization;
  }

  async getProperties(): Promise<schema.Property[]> {
    return db.select().from(schema.properties)
      .where(isNull(schema.properties.deletedAt))
      .orderBy(asc(schema.properties.name));
  }

  async getPropertiesByOrganization(organizationId?: string): Promise<schema.Property[]> {
    if (!organizationId) return [];
    return db.select().from(schema.properties)
      .where(and(
        eq(schema.properties.organizationId, organizationId),
        isNull(schema.properties.deletedAt)
      ))
      .orderBy(asc(schema.properties.name));
  }

  async getProperty(id: string): Promise<schema.Property | undefined> {
    const result = await db.select().from(schema.properties)
      .where(and(eq(schema.properties.id, id), isNull(schema.properties.deletedAt)))
      .limit(1);
    return result[0];
  }

  async getUnitsByProperty(propertyId: string): Promise<schema.Unit[]> {
    return db.select().from(schema.units)
      .where(and(
        eq(schema.units.propertyId, propertyId),
        isNull(schema.units.deletedAt)
      ))
      .orderBy(asc(schema.units.topNummer));
  }

  async getTenants(): Promise<schema.Tenant[]> {
    const rows = await db.select().from(schema.tenants)
      .where(isNull(schema.tenants.deletedAt))
      .orderBy(asc(schema.tenants.lastName));
    return decryptIbanRows(rows);
  }

  async getTenantsByOrganization(organizationId?: string): Promise<schema.Tenant[]> {
    if (!organizationId) return [];
    const units = await this.getUnitsByOrganization(organizationId);
    if (units.length === 0) return [];
    const allTenants: schema.Tenant[] = [];
    for (const unit of units) {
      const tenants = await db.select().from(schema.tenants)
        .where(and(
          eq(schema.tenants.unitId, unit.id),
          isNull(schema.tenants.deletedAt)
        ))
        .orderBy(asc(schema.tenants.lastName));
      allTenants.push(...tenants);
    }
    return decryptIbanRows(allTenants);
  }

  async getTenant(id: string): Promise<schema.Tenant | undefined> {
    const result = await db.select().from(schema.tenants)
      .where(and(eq(schema.tenants.id, id), isNull(schema.tenants.deletedAt)))
      .limit(1);
    return result[0] ? decryptIbanFields(result[0]) : undefined;
  }

  async getTenantsByUnit(unitId: string): Promise<schema.Tenant[]> {
    const rows = await db.select().from(schema.tenants)
      .where(and(
        eq(schema.tenants.unitId, unitId),
        isNull(schema.tenants.deletedAt)
      ))
      .orderBy(desc(schema.tenants.createdAt));
    return decryptIbanRows(rows);
  }

  async getMonthlyInvoices(year?: number, month?: number): Promise<schema.MonthlyInvoice[]> {
    let query = db.select().from(schema.monthlyInvoices);
    if (year && month) {
      return query.where(and(
        eq(schema.monthlyInvoices.year, year),
        eq(schema.monthlyInvoices.month, month)
      )).orderBy(desc(schema.monthlyInvoices.createdAt));
    } else if (year) {
      return query.where(eq(schema.monthlyInvoices.year, year)).orderBy(desc(schema.monthlyInvoices.createdAt));
    }
    return query.orderBy(desc(schema.monthlyInvoices.createdAt));
  }

  async getMonthlyInvoicesByOrganization(organizationId?: string, year?: number, month?: number): Promise<schema.MonthlyInvoice[]> {
    if (!organizationId) return [];
    const units = await this.getUnitsByOrganization(organizationId);
    if (units.length === 0) return [];
    const unitIds = units.map(u => u.id);
    const allInvoices: schema.MonthlyInvoice[] = [];
    for (const unitId of unitIds) {
      let invoices: schema.MonthlyInvoice[];
      if (year && month) {
        invoices = await db.select().from(schema.monthlyInvoices)
          .where(and(
            eq(schema.monthlyInvoices.unitId, unitId),
            eq(schema.monthlyInvoices.year, year),
            eq(schema.monthlyInvoices.month, month)
          )).orderBy(desc(schema.monthlyInvoices.createdAt));
      } else if (year) {
        invoices = await db.select().from(schema.monthlyInvoices)
          .where(and(
            eq(schema.monthlyInvoices.unitId, unitId),
            eq(schema.monthlyInvoices.year, year)
          )).orderBy(desc(schema.monthlyInvoices.createdAt));
      } else {
        invoices = await db.select().from(schema.monthlyInvoices)
          .where(eq(schema.monthlyInvoices.unitId, unitId))
          .orderBy(desc(schema.monthlyInvoices.createdAt));
      }
      allInvoices.push(...invoices);
    }
    return allInvoices;
  }

  async getInvoicesByTenant(tenantId: string): Promise<schema.MonthlyInvoice[]> {
    return db.select().from(schema.monthlyInvoices)
      .where(eq(schema.monthlyInvoices.tenantId, tenantId))
      .orderBy(desc(schema.monthlyInvoices.year), desc(schema.monthlyInvoices.month));
  }

  async getAllPayments(): Promise<schema.Payment[]> {
    return db.select().from(schema.payments)
      .orderBy(desc(schema.payments.buchungsDatum));
  }

  async getPaymentsByOrganization(organizationId?: string): Promise<schema.Payment[]> {
    if (!organizationId) return [];
    const tenants = await this.getTenantsByOrganization(organizationId);
    if (tenants.length === 0) return [];
    const allPayments: schema.Payment[] = [];
    for (const tenant of tenants) {
      const payments = await db.select().from(schema.payments)
        .where(eq(schema.payments.tenantId, tenant.id))
        .orderBy(desc(schema.payments.buchungsDatum));
      allPayments.push(...payments);
    }
    return allPayments.sort((a, b) => 
      new Date(b.buchungsDatum).getTime() - new Date(a.buchungsDatum).getTime()
    );
  }

  async getPaymentsByTenant(tenantId: string): Promise<schema.Payment[]> {
    return db.select().from(schema.payments)
      .where(eq(schema.payments.tenantId, tenantId))
      .orderBy(desc(schema.payments.buchungsDatum));
  }

  async getExpensesByOrganization(organizationId?: string): Promise<schema.Expense[]> {
    if (!organizationId) return [];
    const properties = await this.getPropertiesByOrganization(organizationId);
    if (properties.length === 0) return [];
    const allExpenses: schema.Expense[] = [];
    for (const prop of properties) {
      const expenses = await db.select().from(schema.expenses)
        .where(eq(schema.expenses.propertyId, prop.id))
        .orderBy(desc(schema.expenses.datum));
      allExpenses.push(...expenses);
    }
    return allExpenses.sort((a, b) => 
      new Date(b.datum).getTime() - new Date(a.datum).getTime()
    );
  }

  async getExpensesByProperty(propertyId: string, year?: number): Promise<schema.Expense[]> {
    if (year) {
      return db.select().from(schema.expenses)
        .where(and(eq(schema.expenses.propertyId, propertyId), eq(schema.expenses.year, year)))
        .orderBy(desc(schema.expenses.datum));
    }
    return db.select().from(schema.expenses)
      .where(eq(schema.expenses.propertyId, propertyId))
      .orderBy(desc(schema.expenses.datum));
  }

  async getExpense(id: string): Promise<schema.Expense | undefined> {
    const result = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).limit(1);
    return result[0];
  }

  async getBankAccounts(): Promise<schema.BankAccount[]> {
    const rows = await db.select().from(schema.bankAccounts).orderBy(asc(schema.bankAccounts.accountName));
    return decryptIbanRows(rows);
  }

  async getBankAccount(id: string): Promise<schema.BankAccount | undefined> {
    const result = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, id));
    return result[0] ? decryptIbanFields(result[0]) : undefined;
  }

  async getBankAccountsByOrganization(organizationId?: string): Promise<schema.BankAccount[]> {
    if (!organizationId) return [];
    const rows = await db.select().from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.organizationId, organizationId))
      .orderBy(asc(schema.bankAccounts.accountName));
    return decryptIbanRows(rows);
  }

  async createBankAccount(data: Partial<schema.InsertBankAccount>): Promise<schema.BankAccount> {
    const encrypted = {
      ...data,
      iban: encryptField(data.iban),
      bic: encryptField(data.bic),
    };
    const result = await db.insert(schema.bankAccounts).values(encrypted as schema.InsertBankAccount).returning();
    return decryptIbanFields(result[0]);
  }

  async updateBankAccount(id: string, data: Partial<schema.InsertBankAccount>, organizationId?: string): Promise<schema.BankAccount | undefined> {
    const encrypted: typeof data = { ...data };
    if ('iban' in data) encrypted.iban = encryptField(data.iban);
    if ('bic' in data) encrypted.bic = encryptField(data.bic);
    // Org-Scope (Defense-in-Depth): mit organizationId trifft eine fremde ID 0 Zeilen
    const scope = organizationId
      ? and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.organizationId, organizationId))
      : eq(schema.bankAccounts.id, id);
    const result = await db.update(schema.bankAccounts)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(scope)
      .returning();
    return result[0] ? decryptIbanFields(result[0]) : undefined;
  }

  async deleteBankAccount(id: string, organizationId?: string): Promise<void> {
    const scope = organizationId
      ? and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.organizationId, organizationId))
      : eq(schema.bankAccounts.id, id);
    await db.delete(schema.bankAccounts).where(scope);
  }

  async getBankAccountBalance(id: string, asOfDate?: string): Promise<number> {
    const account = await this.getBankAccount(id);
    if (!account) return 0;
    
    const openingBalance = Number(account.openingBalance) || 0;
    const openingDate = account.openingBalanceDate;
    
    const transactions = await this.getTransactionsByBankAccount(id);
    
    let balance = openingBalance;
    const cutoffDate = asOfDate || new Date().toISOString().split('T')[0];
    
    for (const tx of transactions) {
      const txDate = tx.transactionDate;
      if (txDate && txDate <= cutoffDate) {
        if (!openingDate || txDate >= openingDate) {
          balance += Number(tx.amount) || 0;
        }
      }
    }
    
    return balance;
  }

  async getTransactionsByBankAccount(bankAccountId: string): Promise<schema.Transaction[]> {
    const rows = await db.select().from(schema.transactions)
      .where(eq(schema.transactions.bankAccountId, bankAccountId))
      .orderBy(desc(schema.transactions.transactionDate));
    return rows.map(r => ({ ...r, partnerIban: decryptField(r.partnerIban) }));
  }

  async getTransactionsByOrganization(organizationId?: string): Promise<(schema.Transaction & { property_id?: string })[]> {
    if (!organizationId) return [];
    const bankAccounts = await this.getBankAccountsByOrganization(organizationId);
    if (bankAccounts.length === 0) return [];
    
    // Create a map of bankAccountId -> propertyId for enrichment
    const bankAccountPropertyMap = new Map(bankAccounts.map(ba => [ba.id, ba.propertyId]));
    
    const bankAccountIds = bankAccounts.map(ba => ba.id);
    const allTransactions: (schema.Transaction & { property_id?: string })[] = [];
    for (const baId of bankAccountIds) {
      const txns = await db.select().from(schema.transactions)
        .where(eq(schema.transactions.bankAccountId, baId))
        .orderBy(desc(schema.transactions.transactionDate));
      // Enrich each transaction with property_id from its bank account
      const enrichedTxns = txns.map(t => ({
        ...t,
        partnerIban: decryptField(t.partnerIban),
        property_id: bankAccountPropertyMap.get(t.bankAccountId) || undefined
      }));
      allTransactions.push(...enrichedTxns);
    }
    return allTransactions.sort((a, b) => 
      new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
    );
  }

  async getUnitsByOrganization(organizationId?: string): Promise<schema.Unit[]> {
    if (!organizationId) return [];
    const properties = await this.getPropertiesByOrganization(organizationId);
    if (properties.length === 0) return [];
    const allUnits: schema.Unit[] = [];
    for (const prop of properties) {
      const units = await db.select().from(schema.units)
        .where(and(
          eq(schema.units.propertyId, prop.id),
          isNull(schema.units.deletedAt)
        ))
        .orderBy(asc(schema.units.topNummer));
      allUnits.push(...units);
    }
    return allUnits;
  }

  async getSettlementsByProperty(propertyId: string): Promise<schema.Settlement[]> {
    return db.select().from(schema.settlements)
      .where(eq(schema.settlements.propertyId, propertyId))
      .orderBy(desc(schema.settlements.year));
  }

  async getMaintenanceContractsByProperty(propertyId: string): Promise<schema.MaintenanceContract[]> {
    return db.select().from(schema.maintenanceContracts)
      .where(eq(schema.maintenanceContracts.propertyId, propertyId))
      .orderBy(asc(schema.maintenanceContracts.nextDueDate));
  }

  async getMaintenanceTasks(status?: string): Promise<schema.MaintenanceTask[]> {
    if (status) {
      return db.select().from(schema.maintenanceTasks)
        .where(eq(schema.maintenanceTasks.status, status))
        .orderBy(asc(schema.maintenanceTasks.dueDate));
    }
    return db.select().from(schema.maintenanceTasks).orderBy(asc(schema.maintenanceTasks.dueDate));
  }

  async getMaintenanceTasksByOrganization(organizationId?: string, status?: string): Promise<schema.MaintenanceTask[]> {
    if (!organizationId) return [];
    const properties = await this.getPropertiesByOrganization(organizationId);
    if (properties.length === 0) return [];
    const allTasks: schema.MaintenanceTask[] = [];
    for (const prop of properties) {
      const contracts = await this.getMaintenanceContractsByProperty(prop.id);
      for (const contract of contracts) {
        let tasks: schema.MaintenanceTask[];
        if (status) {
          tasks = await db.select().from(schema.maintenanceTasks)
            .where(and(
              eq(schema.maintenanceTasks.contractId, contract.id),
              eq(schema.maintenanceTasks.status, status)
            ))
            .orderBy(asc(schema.maintenanceTasks.dueDate));
        } else {
          tasks = await db.select().from(schema.maintenanceTasks)
            .where(eq(schema.maintenanceTasks.contractId, contract.id))
            .orderBy(asc(schema.maintenanceTasks.dueDate));
        }
        allTasks.push(...tasks);
      }
    }
    return allTasks;
  }

  async getContractors(): Promise<schema.Contractor[]> {
    const rows = await db.select().from(schema.contractors)
      .where(eq(schema.contractors.isActive, true))
      .orderBy(asc(schema.contractors.companyName));
    return decryptIbanRows(rows) as schema.Contractor[];
  }

  async getContractorsByOrganization(organizationId?: string): Promise<schema.Contractor[]> {
    if (!organizationId) return [];
    const rows = await db.select().from(schema.contractors)
      .where(and(
        eq(schema.contractors.organizationId, organizationId),
        eq(schema.contractors.isActive, true)
      ))
      .orderBy(asc(schema.contractors.companyName));
    return decryptIbanRows(rows) as schema.Contractor[];
  }

  async getDistributionKeys(): Promise<schema.DistributionKey[]> {
    return db.select().from(schema.distributionKeys)
      .where(eq(schema.distributionKeys.isActive, true))
      .orderBy(asc(schema.distributionKeys.sortOrder));
  }

  async getDistributionKeysByProperty(propertyId: string): Promise<schema.DistributionKey[]> {
    return db.select().from(schema.distributionKeys)
      .where(and(
        eq(schema.distributionKeys.propertyId, propertyId),
        eq(schema.distributionKeys.isActive, true)
      ))
      .orderBy(asc(schema.distributionKeys.sortOrder));
  }

  async getDistributionKey(id: string): Promise<schema.DistributionKey | undefined> {
    const result = await db.select().from(schema.distributionKeys)
      .where(eq(schema.distributionKeys.id, id))
      .limit(1);
    return result[0];
  }

  async createDistributionKey(data: Partial<schema.InsertDistributionKey>): Promise<schema.DistributionKey> {
    const result = await db.insert(schema.distributionKeys).values(data as schema.InsertDistributionKey).returning();
    return result[0];
  }

  /**
   * Org-Scope für distribution_keys (Defense-in-Depth): organization_id ist
   * seit Migration 20260825 backfilled (Legacy-NULL-Zeilen wurden pro Org
   * kopiert bzw. aus der Liegenschaft abgeleitet) — der frühere
   * property-Fallback für NULL-org-Zeilen ist damit entfallen.
   */
  private distributionKeyScope(id: string, organizationId?: string) {
    if (!organizationId) return eq(schema.distributionKeys.id, id);
    return and(
      eq(schema.distributionKeys.id, id),
      eq(schema.distributionKeys.organizationId, organizationId)
    );
  }

  async updateDistributionKey(id: string, data: Partial<schema.InsertDistributionKey>, organizationId?: string): Promise<schema.DistributionKey | undefined> {
    const result = await db.update(schema.distributionKeys)
      .set({ ...data, updatedAt: new Date() })
      .where(this.distributionKeyScope(id, organizationId))
      .returning();
    return result[0];
  }

  async deleteDistributionKey(id: string, organizationId?: string): Promise<void> {
    await db.update(schema.distributionKeys)
      .set({ isActive: false, updatedAt: new Date() })
      .where(this.distributionKeyScope(id, organizationId));
  }

  async getUnitDistributionValues(unitId: string): Promise<schema.UnitDistributionValue[]> {
    return db.select().from(schema.unitDistributionValues)
      .where(eq(schema.unitDistributionValues.unitId, unitId));
  }

  async getUnitDistributionValuesByProperty(propertyId: string): Promise<schema.UnitDistributionValue[]> {
    const propertyUnits = await db.select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.propertyId, propertyId));
    const unitIds = propertyUnits.map(u => u.id);
    if (unitIds.length === 0) return [];
    const { inArray } = await import("drizzle-orm");
    return db.select().from(schema.unitDistributionValues)
      .where(inArray(schema.unitDistributionValues.unitId, unitIds));
  }

  async upsertUnitDistributionValue(data: schema.InsertUnitDistributionValue): Promise<schema.UnitDistributionValue> {
    const existing = await db.select().from(schema.unitDistributionValues)
      .where(and(
        eq(schema.unitDistributionValues.unitId, data.unitId),
        eq(schema.unitDistributionValues.keyId, data.keyId)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const result = await db.update(schema.unitDistributionValues)
        .set({ value: data.value, updatedAt: new Date() })
        .where(eq(schema.unitDistributionValues.id, existing[0].id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(schema.unitDistributionValues).values(data).returning();
      return result[0];
    }
  }

  async deleteUnitDistributionValue(unitId: string, keyId: string): Promise<void> {
    await db.delete(schema.unitDistributionValues)
      .where(and(
        eq(schema.unitDistributionValues.unitId, unitId),
        eq(schema.unitDistributionValues.keyId, keyId)
      ));
  }

  async getProfileByEmail(email: string): Promise<schema.Profile | undefined> {
    // Auth-level lookup (pre-org-context): rootDb bypasses RLS, like getProfileById
    const result = await rootDb.select().from(schema.profiles)
      .where(eq(schema.profiles.email, email)).limit(1);
    return result[0];
  }

  async getProfileById(id: string): Promise<schema.Profile | undefined> {
    // Auth-level lookup: must work before org context is established → rootDb
    const result = await rootDb.select().from(schema.profiles)
      .where(eq(schema.profiles.id, id)).limit(1);
    return result[0];
  }

  async createProfile(data: schema.InsertProfile): Promise<schema.Profile> {
    const result = await db.insert(schema.profiles).values(data).returning();
    return result[0];
  }

  async updateProfile(id: string, data: Partial<schema.InsertProfile>): Promise<schema.Profile | undefined> {
    const result = await db.update(schema.profiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.profiles.id, id))
      .returning();
    return result[0];
  }

  async getProfilesByOrganization(organizationId: string): Promise<schema.Profile[]> {
    return db.select().from(schema.profiles)
      .where(eq(schema.profiles.organizationId, organizationId))
      .orderBy(asc(schema.profiles.fullName));
  }

  async getUserRoles(userId: string): Promise<schema.UserRole[]> {
    // Auth-level lookup: userRoles has no organization_id → rootDb, no org context needed
    return rootDb.select().from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
  }

  async addUserRole(userId: string, role: string): Promise<schema.UserRole> {
    const result = await db.insert(schema.userRoles).values({
      userId,
      role: role as any,
    }).returning();
    return result[0];
  }

  async removeUserRole(userId: string, role: string): Promise<void> {
    await db.delete(schema.userRoles)
      .where(and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.role, role as any)
      ));
  }

  async createInvite(data: schema.InsertOrganizationInvite): Promise<schema.OrganizationInvite> {
    const result = await db.insert(schema.organizationInvites).values(data).returning();
    return result[0];
  }

  async getInviteByToken(token: string): Promise<schema.OrganizationInvite | undefined> {
    const result = await db.select().from(schema.organizationInvites)
      .where(eq(schema.organizationInvites.token, token)).limit(1);
    return result[0];
  }

  async getInvitesByOrganization(organizationId: string): Promise<schema.OrganizationInvite[]> {
    return db.select().from(schema.organizationInvites)
      .where(eq(schema.organizationInvites.organizationId, organizationId))
      .orderBy(desc(schema.organizationInvites.createdAt));
  }

  async updateInvite(id: string, data: Partial<schema.InsertOrganizationInvite>): Promise<schema.OrganizationInvite | undefined> {
    const result = await db.update(schema.organizationInvites)
      .set(data)
      .where(eq(schema.organizationInvites.id, id))
      .returning();
    return result[0];
  }

  async getPendingInviteByEmail(email: string): Promise<schema.OrganizationInvite | undefined> {
    const result = await db.select().from(schema.organizationInvites)
      .where(and(
        eq(schema.organizationInvites.email, email.toLowerCase()),
        eq(schema.organizationInvites.status, 'pending')
      ))
      .limit(1);
    return result[0];
  }

  async deleteInvite(id: string): Promise<void> {
    await db.delete(schema.organizationInvites)
      .where(eq(schema.organizationInvites.id, id));
  }

  async createOrganization(data: schema.InsertOrganization): Promise<schema.Organization> {
    const encrypted = {
      ...data,
      iban: encryptField(data.iban ?? null),
      bic: encryptField(data.bic ?? null),
    };
    const result = await db.insert(schema.organizations).values(encrypted).returning();
    return decryptIbanFields(result[0]) as schema.Organization;
  }

  async getOrganizationByName(name: string): Promise<schema.Organization | undefined> {
    const result = await db.select().from(schema.organizations)
      .where(eq(schema.organizations.name, name))
      .limit(1);
    if (!result[0]) return undefined;
    return decryptIbanFields(result[0]) as schema.Organization;
  }

  async createProperty(data: schema.InsertProperty): Promise<schema.Property> {
    const result = await db.insert(schema.properties).values(data).returning();
    return result[0];
  }

  async updateProperty(id: string, data: Partial<schema.InsertProperty>): Promise<schema.Property | undefined> {
    const result = await db.update(schema.properties)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.properties.id, id))
      .returning();
    return result[0];
  }

  async deleteProperty(id: string): Promise<void> {
    await db.update(schema.properties)
      .set({ deletedAt: new Date() })
      .where(eq(schema.properties.id, id));
  }

  async createUnit(data: Partial<schema.InsertUnit>): Promise<schema.Unit> {
    const result = await db.insert(schema.units).values(data as schema.InsertUnit).returning();
    return result[0];
  }

  async updateUnit(id: string, data: Partial<schema.InsertUnit>): Promise<schema.Unit | undefined> {
    const result = await db.update(schema.units)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.units.id, id))
      .returning();
    return result[0];
  }

  async softDeleteUnit(id: string): Promise<void> {
    await db.update(schema.units)
      .set({ deletedAt: new Date() })
      .where(eq(schema.units.id, id));
  }

  async softDeleteTenant(id: string): Promise<void> {
    await db.update(schema.tenants)
      .set({ deletedAt: new Date() })
      .where(eq(schema.tenants.id, id));
  }

  async getRentHistoryByTenant(tenantId: string): Promise<schema.RentHistory[]> {
    return db.select().from(schema.rentHistory)
      .where(eq(schema.rentHistory.tenantId, tenantId))
      .orderBy(desc(schema.rentHistory.validFrom));
  }

  async createRentHistory(data: schema.InsertRentHistory): Promise<schema.RentHistory> {
    const result = await db.insert(schema.rentHistory).values(data).returning();
    return result[0];
  }

  async createPropertyManager(data: { userId: string; propertyId: string }): Promise<schema.PropertyManager> {
    const result = await db.insert(schema.propertyManagers).values(data).returning();
    return result[0];
  }

  async deletePropertyManager(userId: string, propertyId: string): Promise<void> {
    await db.delete(schema.propertyManagers)
      .where(and(
        eq(schema.propertyManagers.userId, userId),
        eq(schema.propertyManagers.propertyId, propertyId)
      ));
  }

  async getPropertyManagersByUser(userId: string): Promise<schema.PropertyManager[]> {
    return db.select().from(schema.propertyManagers)
      .where(eq(schema.propertyManagers.userId, userId));
  }

  async createPayment(data: schema.InsertPayment): Promise<schema.Payment> {
    const result = await db.insert(schema.payments).values(data).returning();
    return result[0];
  }

  async deletePayment(id: string): Promise<void> {
    await db.delete(schema.payments).where(eq(schema.payments.id, id));
  }

  async getPayment(id: string): Promise<schema.Payment | undefined> {
    const result = await db.select().from(schema.payments)
      .where(eq(schema.payments.id, id)).limit(1);
    return result[0];
  }

  async createTransaction(data: schema.InsertTransaction): Promise<schema.Transaction> {
    const encrypted = {
      ...data,
      partnerIban: encryptField(data.partnerIban ?? null),
    };
    const result = await db.insert(schema.transactions).values(encrypted).returning();
    return { ...result[0], partnerIban: decryptField(result[0].partnerIban) };
  }

  async getTransaction(id: string): Promise<schema.Transaction | undefined> {
    const result = await db.select().from(schema.transactions)
      .where(eq(schema.transactions.id, id)).limit(1);
    if (!result[0]) return undefined;
    return { ...result[0], partnerIban: decryptField(result[0].partnerIban) };
  }

  async deleteTransaction(id: string): Promise<void> {
    await db.delete(schema.transactions).where(eq(schema.transactions.id, id));
  }

  async getTransactions(): Promise<schema.Transaction[]> {
    const rows = await db.select().from(schema.transactions)
      .orderBy(desc(schema.transactions.transactionDate));
    return rows.map(r => ({ ...r, partnerIban: decryptField(r.partnerIban) }));
  }

  async createExpense(data: schema.InsertExpense): Promise<schema.Expense> {
    const result = await db.insert(schema.expenses).values(data).returning();
    return result[0];
  }

  async deleteExpense(id: string): Promise<void> {
    await db.delete(schema.expenses).where(eq(schema.expenses.id, id));
  }

  async deleteExpensesByTransactionId(transactionId: string): Promise<void> {
    await db.delete(schema.expenses)
      .where(eq(schema.expenses.transactionId, transactionId));
  }

  async deleteTransactionSplits(transactionId: string): Promise<void> {
    // transactionSplits table not implemented yet - function placeholder
    console.log('deleteTransactionSplits called for:', transactionId);
  }

  async getAccountCategories(organizationId: string): Promise<schema.AccountCategory[]> {
    const { or, isNull } = await import('drizzle-orm');
    return db.select().from(schema.accountCategories)
      .where(or(
        eq(schema.accountCategories.organizationId, organizationId),
        isNull(schema.accountCategories.organizationId)
      ))
      .orderBy(asc(schema.accountCategories.name));
  }

  async createAccountCategory(data: Partial<schema.InsertAccountCategory>): Promise<schema.AccountCategory> {
    const result = await db.insert(schema.accountCategories).values(data as schema.InsertAccountCategory).returning();
    return result[0];
  }

  async updateAccountCategory(id: string, data: Partial<schema.InsertAccountCategory>): Promise<schema.AccountCategory | undefined> {
    const result = await db.update(schema.accountCategories)
      .set(data)
      .where(eq(schema.accountCategories.id, id))
      .returning();
    return result[0];
  }

  async deleteAccountCategory(id: string): Promise<void> {
    await db.delete(schema.accountCategories).where(eq(schema.accountCategories.id, id));
  }

  async getUnit(id: string): Promise<schema.Unit | undefined> {
    const result = await db.select().from(schema.units)
      .where(and(eq(schema.units.id, id), isNull(schema.units.deletedAt)))
      .limit(1);
    return result[0];
  }

  async getUnits(): Promise<schema.Unit[]> {
    return db.select().from(schema.units)
      .where(isNull(schema.units.deletedAt))
      .orderBy(asc(schema.units.topNummer));
  }

  async getExpenses(year?: number, month?: number): Promise<schema.Expense[]> {
    let query = db.select().from(schema.expenses);
    if (year && month) {
      return query.where(and(
        eq(schema.expenses.year, year),
        eq(schema.expenses.month, month)
      )).orderBy(desc(schema.expenses.datum));
    } else if (year) {
      return query.where(eq(schema.expenses.year, year)).orderBy(desc(schema.expenses.datum));
    }
    return query.orderBy(desc(schema.expenses.datum));
  }

  async updateExpense(id: string, data: Partial<schema.InsertExpense>): Promise<schema.Expense> {
    const result = await db.update(schema.expenses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.expenses.id, id))
      .returning();
    return result[0];
  }

  async getInvoice(id: string): Promise<schema.MonthlyInvoice | undefined> {
    const result = await db.select().from(schema.monthlyInvoices)
      .where(eq(schema.monthlyInvoices.id, id)).limit(1);
    return result[0];
  }

  async createInvoice(data: schema.InsertMonthlyInvoice): Promise<schema.MonthlyInvoice> {
    const result = await db.insert(schema.monthlyInvoices).values(data).returning();
    return result[0];
  }

  async updateInvoice(id: string, data: Partial<schema.InsertMonthlyInvoice>): Promise<schema.MonthlyInvoice> {
    const result = await db.update(schema.monthlyInvoices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.monthlyInvoices.id, id))
      .returning();
    return result[0];
  }

  async deleteInvoice(id: string): Promise<void> {
    await db.delete(schema.monthlyInvoices).where(eq(schema.monthlyInvoices.id, id));
  }

  async getPaymentsByInvoice(invoiceId: string): Promise<schema.Payment[]> {
    return db.select().from(schema.payments)
      .where(eq(schema.payments.invoiceId, invoiceId))
      .orderBy(asc(schema.payments.buchungsDatum));
  }

  async updatePayment(id: string, data: Partial<schema.InsertPayment>): Promise<schema.Payment> {
    const result = await db.update(schema.payments)
      .set(data)
      .where(eq(schema.payments.id, id))
      .returning();
    return result[0];
  }
  async getSettlementByPropertyAndYear(propertyId: string, year: number): Promise<schema.Settlement | undefined> {
    const result = await db.select().from(schema.settlements)
      .where(and(
        eq(schema.settlements.propertyId, propertyId),
        eq(schema.settlements.year, year)
      ))
      .limit(1);
    return result[0];
  }

  async getSettlementItems(settlementId: string): Promise<schema.SettlementDetail[]> {
    return db.select().from(schema.settlementDetails)
      .where(eq(schema.settlementDetails.settlementId, settlementId));
  }

  async createSettlement(data: any): Promise<schema.Settlement> {
    const [result] = await db.insert(schema.settlements).values({
      propertyId: data.propertyId,
      year: data.year,
      gesamtausgaben: data.totalBk + data.totalHk,
      status: data.status,
      createdBy: data.createdBy,
    }).returning();
    return result;
  }

  async updateSettlement(id: string, data: any): Promise<schema.Settlement | undefined> {
    const [result] = await db.update(schema.settlements)
      .set({
        gesamtausgaben: data.gesamtkosten,
        status: data.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.settlements.id, id))
      .returning();
    return result;
  }

  async deleteSettlementItems(settlementId: string): Promise<void> {
    await db.delete(schema.settlementDetails).where(eq(schema.settlementDetails.settlementId, settlementId));
  }

  async createSettlementItem(data: any): Promise<schema.SettlementDetail> {
    const [result] = await db.insert(schema.settlementDetails).values({
      settlementId: data.settlementId,
      unitId: data.unitId,
      tenantId: data.tenantId,
      anteil: data.bkAnteil + data.hkAnteil,
      ausgabenAnteil: data.bkAnteil + data.hkAnteil,
      vorschuss: data.bkVorschuss + data.hkVorschuss,
      differenz: data.gesamtSaldo,
    }).returning();
    return result;
  }

  async updateTenantAdvances(tenantId: string, betriebskostenVorschuss: number, heizkostenVorschuss: number): Promise<schema.Tenant | undefined> {
    const [result] = await db.update(schema.tenants)
      .set({
        betriebskostenVorschuss: betriebskostenVorschuss.toString(),
        heizkostenVorschuss: heizkostenVorschuss.toString(),
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, tenantId))
      .returning();
    return result ? decryptIbanFields(result) : result;
  }

  // ====== LEASES ======
  async getLeasesByTenant(tenantId: string): Promise<schema.Lease[]> {
    return db.select().from(schema.leases)
      .where(eq(schema.leases.tenantId, tenantId))
      .orderBy(desc(schema.leases.startDate));
  }

  async getLeasesByUnit(unitId: string): Promise<schema.Lease[]> {
    return db.select().from(schema.leases)
      .where(eq(schema.leases.unitId, unitId))
      .orderBy(desc(schema.leases.startDate));
  }

  async getLease(id: string): Promise<schema.Lease | undefined> {
    const result = await db.select().from(schema.leases)
      .where(eq(schema.leases.id, id))
      .limit(1);
    return result[0];
  }

  async createLease(data: schema.InsertLease): Promise<schema.Lease> {
    const [result] = await db.insert(schema.leases).values(data).returning();
    return result;
  }

  async updateLease(id: string, data: Partial<schema.InsertLease>): Promise<schema.Lease | undefined> {
    const [result] = await db.update(schema.leases)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.leases.id, id))
      .returning();
    return result;
  }

  // ====== PAYMENT ALLOCATIONS ======
  async getPaymentAllocationsByPayment(paymentId: string): Promise<schema.PaymentAllocation[]> {
    return db.select().from(schema.paymentAllocations)
      .where(eq(schema.paymentAllocations.paymentId, paymentId));
  }

  async getPaymentAllocationsByInvoice(invoiceId: string): Promise<schema.PaymentAllocation[]> {
    return db.select().from(schema.paymentAllocations)
      .where(eq(schema.paymentAllocations.invoiceId, invoiceId));
  }

  async createPaymentAllocation(data: schema.InsertPaymentAllocation): Promise<schema.PaymentAllocation> {
    const [result] = await db.insert(schema.paymentAllocations).values(data).returning();
    return result;
  }

  async deletePaymentAllocation(id: string): Promise<void> {
    await db.delete(schema.paymentAllocations)
      .where(eq(schema.paymentAllocations.id, id));
  }
}

export const storage = new DatabaseStorage();
