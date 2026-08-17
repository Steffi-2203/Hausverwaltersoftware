import { db } from "../db";
import { eq, and, or } from "drizzle-orm";
import { tenants, units, properties, monthlyInvoices, payments, transactions, bankAccounts, accountCategories } from "@shared/schema";

export async function verifyPropertyOwnership(propertyId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyUnitOwnership(unitId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: units.id })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(units.id, unitId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyTenantOwnership(tenantId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: tenants.id })
    .from(tenants)
    .innerJoin(units, eq(units.id, tenants.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(tenants.id, tenantId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyInvoiceOwnership(invoiceId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: monthlyInvoices.id })
    .from(monthlyInvoices)
    .innerJoin(units, eq(units.id, monthlyInvoices.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(monthlyInvoices.id, invoiceId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyPaymentOwnership(paymentId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: payments.id })
    .from(payments)
    .innerJoin(tenants, eq(tenants.id, payments.tenantId))
    .innerJoin(units, eq(units.id, tenants.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(payments.id, paymentId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyTransactionOwnership(transactionId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}

export async function verifyCategoryOwnership(categoryId: string, organizationId: string): Promise<boolean> {
  const result = await db.select({ id: accountCategories.id })
    .from(accountCategories)
    .where(and(eq(accountCategories.id, categoryId), eq(accountCategories.organizationId, organizationId)))
    .limit(1);
  return result.length > 0;
}
