import { db } from "../db";
import { eq, and, lte, gte, isNull, or, inArray } from "drizzle-orm";
import {
  AutomationRule,
  automationRuleLogs,
  payments,
  monthlyInvoices,
  tenants,
  units,
  properties,
  leases,
  maintenanceContracts,
  maintenanceTasks,
  messages,
} from "@shared/schema";

export interface RuleActionPreview {
  type: string;
  description: string;
  target?: string;
  details?: Record<string, any>;
}

export interface RuleExecutionResult {
  ruleId: string;
  isDryRun: boolean;
  matchedItems: number;
  actions: RuleActionPreview[];
  status: "success" | "error" | "skipped";
  errorMessage?: string;
}

function parseConditions(conditions: any): Record<string, any> {
  if (!conditions) return {};
  if (typeof conditions === "string") {
    try { return JSON.parse(conditions); } catch { return {}; }
  }
  return conditions as Record<string, any>;
}

async function evaluatePaymentReceived(
  orgId: string,
  conditions: Record<string, any>,
  dryRun: boolean
): Promise<RuleExecutionResult> {
  const result: RuleExecutionResult = {
    ruleId: "",
    isDryRun: dryRun,
    matchedItems: 0,
    actions: [],
    status: "success",
  };

  const orgProperties = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.organizationId, orgId));
  const propIds = orgProperties.map((p) => p.id);
  if (!propIds.length) return result;

  const unmatchedPayments = await db
    .select({
      payment: payments,
      tenant: tenants,
      unit: units,
    })
    .from(payments)
    .innerJoin(tenants, eq(payments.tenantId, tenants.id))
    .innerJoin(units, eq(tenants.unitId, units.id))
    .where(isNull(payments.invoiceId));

  const filtered = unmatchedPayments.filter((row) => {
    return propIds.includes(row.unit.propertyId);
  });

  result.matchedItems = filtered.length;

  for (const row of filtered) {
    const tenantName = `${row.tenant.firstName} ${row.tenant.lastName}`.trim();
    const amount = Number(row.payment.betrag || 0);

    const openInvoices = await db
      .select()
      .from(monthlyInvoices)
      .where(
        and(
          eq(monthlyInvoices.tenantId, row.tenant.id),
          or(
            eq(monthlyInvoices.status, "offen"),
            eq(monthlyInvoices.status, "teilbezahlt")
          )
        )
      );

    if (openInvoices.length > 0) {
      const inv = openInvoices[0];
      result.actions.push({
        type: "assign_payment",
        description: `Zahlung ${amount.toFixed(2)} EUR von ${tenantName} der Rechnung ${inv.month}/${inv.year} zuordnen`,
        target: row.payment.id,
        details: {
          paymentId: row.payment.id,
          invoiceId: inv.id,
          tenantName,
          amount,
          invoiceMonth: inv.month,
          invoiceYear: inv.year,
        },
      });

      if (!dryRun) {
        // Org-Scope (Defense-in-Depth zu RLS): payments hat keine
        // organization_id — Zuordnung über tenant → unit → property.
        // Ein fremdes payment.id trifft dadurch 0 Zeilen.
        await db
          .update(payments)
          .set({ invoiceId: inv.id })
          .where(
            and(
              eq(payments.id, row.payment.id),
              inArray(
                payments.tenantId,
                db
                  .select({ id: tenants.id })
                  .from(tenants)
                  .innerJoin(units, eq(tenants.unitId, units.id))
                  .innerJoin(properties, eq(units.propertyId, properties.id))
                  .where(eq(properties.organizationId, orgId))
              )
            )
          );
      }
    }
  }

  return result;
}

async function evaluateInvoiceDue(
  orgId: string,
  conditions: Record<string, any>,
  dryRun: boolean
): Promise<RuleExecutionResult> {
  const result: RuleExecutionResult = {
    ruleId: "",
    isDryRun: dryRun,
    matchedItems: 0,
    actions: [],
    status: "success",
  };

  const daysAhead = Number(conditions.daysBeforeDue || 7);
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const futureDateStr = futureDate.toISOString().split("T")[0];

  const dueInvoices = await db
    .select({
      invoice: monthlyInvoices,
      tenant: tenants,
      unit: units,
      property: properties,
    })
    .from(monthlyInvoices)
    .innerJoin(tenants, eq(monthlyInvoices.tenantId, tenants.id))
    .innerJoin(units, eq(tenants.unitId, units.id))
    .innerJoin(properties, eq(units.propertyId, properties.id))
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(monthlyInvoices.status, "offen"),
        lte(monthlyInvoices.faelligAm, futureDateStr)
      )
    );

  result.matchedItems = dueInvoices.length;

  for (const row of dueInvoices) {
    const tenantName = `${row.tenant.firstName} ${row.tenant.lastName}`.trim();
    const amount = Number(row.invoice.gesamtbetrag || 0);

    result.actions.push({
      type: "send_reminder",
      description: `Zahlungserinnerung an ${tenantName} senden (${amount.toFixed(2)} EUR, fällig am ${row.invoice.faelligAm})`,
      target: row.invoice.id,
      details: {
        invoiceId: row.invoice.id,
        tenantName,
        tenantEmail: row.tenant.email,
        amount,
        dueDate: row.invoice.faelligAm,
        propertyName: row.property.name,
      },
    });

    if (!dryRun) {
      await db.insert(messages).values({
        organizationId: orgId,
        recipientType: "tenant",
        messageType: "payment_reminder",
        subject: `Zahlungserinnerung: ${amount.toFixed(2)} EUR fällig`,
        messageBody: `Sehr geehrte(r) ${tenantName}, bitte überweisen Sie den offenen Betrag von ${amount.toFixed(2)} EUR (fällig am ${row.invoice.faelligAm}).`,
        status: "sent",
        sentAt: new Date(),
      });
    }
  }

  return result;
}

async function evaluateLeaseExpiring(
  orgId: string,
  conditions: Record<string, any>,
  dryRun: boolean
): Promise<RuleExecutionResult> {
  const result: RuleExecutionResult = {
    ruleId: "",
    isDryRun: dryRun,
    matchedItems: 0,
    actions: [],
    status: "success",
  };

  const monthsAhead = Number(conditions.monthsBeforeExpiry || 3);
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setMonth(futureDate.getMonth() + monthsAhead);
  const futureDateStr = futureDate.toISOString().split("T")[0];

  const expiringLeases = await db
    .select({
      lease: leases,
      tenant: tenants,
      unit: units,
      property: properties,
    })
    .from(leases)
    .innerJoin(tenants, eq(leases.tenantId, tenants.id))
    .innerJoin(units, eq(leases.unitId, units.id))
    .innerJoin(properties, eq(units.propertyId, properties.id))
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(leases.status, "aktiv"),
        lte(leases.endDate, futureDateStr)
      )
    );

  result.matchedItems = expiringLeases.length;

  for (const row of expiringLeases) {
    const tenantName = `${row.tenant.firstName} ${row.tenant.lastName}`.trim();

    result.actions.push({
      type: "notify_lease_expiry",
      description: `Mietvertrag von ${tenantName} läuft am ${row.lease.endDate} aus (${row.property.name}, Top ${row.unit.topNummer})`,
      target: row.lease.id,
      details: {
        leaseId: row.lease.id,
        tenantName,
        endDate: row.lease.endDate,
        propertyName: row.property.name,
        unitNumber: row.unit.topNummer,
      },
    });

    if (!dryRun) {
      await db.insert(messages).values({
        organizationId: orgId,
        recipientType: "internal",
        messageType: "lease_expiry_notice",
        subject: `Mietvertrag läuft aus: ${tenantName}`,
        messageBody: `Der Mietvertrag von ${tenantName} (${row.property.name}, Top ${row.unit.topNummer}) läuft am ${row.lease.endDate} aus.`,
        status: "sent",
        sentAt: new Date(),
      });
    }
  }

  return result;
}

async function evaluateMaintenanceDue(
  orgId: string,
  conditions: Record<string, any>,
  dryRun: boolean
): Promise<RuleExecutionResult> {
  const result: RuleExecutionResult = {
    ruleId: "",
    isDryRun: dryRun,
    matchedItems: 0,
    actions: [],
    status: "success",
  };

  const today = new Date().toISOString().split("T")[0];

  const overdueContracts = await db
    .select()
    .from(maintenanceContracts)
    .where(
      and(
        eq(maintenanceContracts.organizationId, orgId),
        eq(maintenanceContracts.isActive, true),
        lte(maintenanceContracts.nextDueDate, today)
      )
    );

  result.matchedItems = overdueContracts.length;

  for (const contract of overdueContracts) {
    result.actions.push({
      type: "create_maintenance_ticket",
      description: `Wartungsticket erstellen: ${contract.title} (fällig: ${contract.nextDueDate})`,
      target: contract.id,
      details: {
        contractId: contract.id,
        title: contract.title,
        nextDueDate: contract.nextDueDate,
        propertyId: contract.propertyId,
      },
    });

    if (!dryRun) {
      await db.insert(maintenanceTasks).values({
        organizationId: orgId,
        propertyId: contract.propertyId,
        title: `[Automatisch] ${contract.title}`,
        description: `Wiederkehrende Wartung überfällig seit ${contract.nextDueDate}.`,
        category: "maintenance",
        priority: "high",
        dueDate: today,
        status: "open",
      });
    }
  }

  return result;
}

export async function evaluateRule(
  rule: AutomationRule,
  orgId: string,
  dryRun: boolean
): Promise<RuleExecutionResult> {
  const conditions = parseConditions(rule.conditions);

  let result: RuleExecutionResult;

  try {
    switch (rule.triggerType) {
      case "payment_received":
        result = await evaluatePaymentReceived(orgId, conditions, dryRun);
        break;
      case "invoice_due":
        result = await evaluateInvoiceDue(orgId, conditions, dryRun);
        break;
      case "lease_expiring":
        result = await evaluateLeaseExpiring(orgId, conditions, dryRun);
        break;
      case "maintenance_due":
        result = await evaluateMaintenanceDue(orgId, conditions, dryRun);
        break;
      default:
        result = {
          ruleId: rule.id,
          isDryRun: dryRun,
          matchedItems: 0,
          actions: [],
          status: "skipped",
          errorMessage: `Unbekannter Trigger-Typ: ${rule.triggerType}`,
        };
    }

    result.ruleId = rule.id;
    result.isDryRun = dryRun;
    return result;
  } catch (error: any) {
    return {
      ruleId: rule.id,
      isDryRun: dryRun,
      matchedItems: 0,
      actions: [],
      status: "error",
      errorMessage: error.message || "Unbekannter Fehler",
    };
  }
}
