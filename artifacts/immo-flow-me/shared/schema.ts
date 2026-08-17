// @ts-nocheck — drizzle-zod@0.8.3 × zod@3.25 Typinkompatibilität (ZodObject-Generics geändert)
// Runtime: korrekt. Typecheck: Fehler nur im z.infer<>-Constraint, nicht im Laufzeitverhalten.
import { pgTable, text, serial, integer, boolean, timestamp, numeric, date, uuid, pgEnum, jsonb, varchar, inet, uniqueIndex, index, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

export * from "./models/auth";

export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
});

export const managementTypeEnum = pgEnum('management_type', ['mietverwaltung', 'weg']);
export const appRoleEnum = pgEnum('app_role', ['admin', 'property_manager', 'finance', 'viewer', 'tester']);
export const expenseCategoryEnum = pgEnum('expense_category', ['betriebskosten_umlagefaehig', 'instandhaltung']);
export const expenseTypeEnum = pgEnum('expense_type', [
  'versicherung', 'grundsteuer', 'muellabfuhr', 'wasser_abwasser', 'heizung',
  'strom_allgemein', 'hausbetreuung', 'lift', 'gartenpflege', 'schneeraeumung',
  'verwaltung', 'ruecklage', 'reparatur', 'sanierung', 'sonstiges'
]);
export const invoiceStatusEnum = pgEnum('invoice_status', ['offen', 'bezahlt', 'teilbezahlt', 'ueberfaellig']);
export const paymentTypeEnum = pgEnum('payment_type', ['sepa', 'ueberweisung', 'bar', 'sonstiges']);
export const settlementStatusEnum = pgEnum('settlement_status', ['entwurf', 'berechnet', 'versendet', 'abgeschlossen']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['trial', 'active', 'cancelled', 'expired']);
export const subscriptionTierEnum = pgEnum('subscription_tier', ['starter', 'professional', 'enterprise']);
export const userSubscriptionTierEnum = pgEnum('user_subscription_tier', ['trial', 'inactive', 'starter', 'pro', 'enterprise']);
export const tenantStatusEnum = pgEnum('tenant_status', ['aktiv', 'leerstand', 'beendet']);
export const unitTypeEnum = pgEnum('unit_type', ['wohnung', 'geschaeft', 'garage', 'stellplatz', 'lager', 'sonstiges']);
export const leaseStatusEnum = pgEnum('lease_status', ['aktiv', 'beendet', 'gekuendigt']);
export const mrgBkKategorieEnum = pgEnum('mrg_bk_kategorie', [
  'wasserversorgung', 'abwasserentsorgung', 'muellabfuhr', 'kanalraeumung',
  'hausreinigung', 'hausbetreuung', 'rauchfangkehrer', 'schaedlingsbekaempfung',
  'lichtkosten', 'beleuchtung', 'feuerversicherung', 'haftpflichtversicherung',
  'leitungswasserschaden', 'sturmschaden', 'glasversicherung',
  'grundsteuer', 'verwaltung', 'sonstige'
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  subscriptionTier: subscriptionTierEnum("subscription_tier").default('starter'),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default('trial'),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  iban: text("iban"),
  bic: text("bic"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  // White-Label Branding
  brandName: text("brand_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  supportEmail: text("support_email"),
  // Readonly API key — org-spezifischer Schlüssel für /api/readonly/*
  // Bindet den Key an genau diese Organisation; Fremdzugriff mit fremder org_id → 403.
  // Wenn nicht gesetzt, greift der globale READONLY_API_KEY als Fallback (Legacy).
  readonlyApiKey: text("readonly_api_key"),
  // Lease-expiry e-mail notifications
  leaseExpiryNotificationsEnabled: boolean("lease_expiry_notifications_enabled").notNull().default(true),
  leaseExpiryThresholds: integer("lease_expiry_thresholds").array().notNull().default([90, 60, 30]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Payment status for user subscriptions
export const paymentStatusEnum = pgEnum('payment_status', ['active', 'past_due', 'canceled', 'unpaid']);

export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  fullName: text("full_name"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  subscriptionTier: userSubscriptionTierEnum("subscription_tier").default('trial'),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Payment status tracking
  paymentStatus: paymentStatusEnum("payment_status").default('active'),
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  kiAutopilotActive: boolean("ki_autopilot_active").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  role: appRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'expired', 'cancelled']);

export const organizationInvites = pgTable("organization_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  email: text("email").notNull(),
  role: appRoleEnum("role").notNull(),
  token: text("token").notNull().unique(),
  status: inviteStatusEnum("status").default('pending'),
  invitedBy: uuid("invited_by").references(() => profiles.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertOrganizationInviteSchema = createInsertSchema(organizationInvites).omit({ id: true, createdAt: true });
export type OrganizationInvite = typeof organizationInvites.$inferSelect;
export type InsertOrganizationInvite = typeof organizationInvites.$inferInsert;

export const passwordHistory = pgTable("password_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  ipAddress: text("ip_address"),
  success: boolean("success").notNull().default(false),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow(),
});

export const user2fa = pgTable("user_2fa", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull().unique(),
  secret: text("secret").notNull(),
  isEnabled: boolean("is_enabled").default(false),
  backupCodes: text("backup_codes").array(),
  lastUsed: timestamp("last_used", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertUser2faSchema = createInsertSchema(user2fa).omit({ id: true, createdAt: true });
export type User2fa = typeof user2fa.$inferSelect;
export type InsertUser2fa = typeof user2fa.$inferInsert;

export const properties = pgTable("properties", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  managementType: managementTypeEnum("management_type").notNull().default('mietverwaltung'),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  totalUnits: integer("total_units").default(0),
  totalArea: numeric("total_area", { precision: 10, scale: 2 }),
  constructionYear: integer("construction_year"),
  notes: text("notes"),
  // Bundesland für MRG-Richtwertberechnung (§ 5 RichtWG)
  bundesland: text("bundesland"),
  // Mietrechtstyp: bestimmt ob MRG gilt und welcher Höchstmietzins berechnet wird.
  // Muss explizit gesetzt sein — fehlendes Bundesland oder fehlender mietrecht_typ → keine Warnung.
  // Gültige Werte: 'richtwert' | 'kategorie' | 'frei' (null = unbekannt, Warnung unterdrückt)
  mietrechtTyp: text("mietrecht_typ"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const propertyManagers = pgTable("property_managers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const units = pgTable("units", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  topNummer: text("top_nummer").notNull(),
  type: unitTypeEnum("type").default('wohnung'),
  status: tenantStatusEnum("status").default('leerstand'),
  flaeche: numeric("flaeche", { precision: 10, scale: 2 }),
  zimmer: integer("zimmer"),
  nutzwert: numeric("nutzwert", { precision: 10, scale: 4 }),
  stockwerk: integer("stockwerk"),
  vsPersonen: integer("vs_personen").default(0),
  leerstandBk: numeric("leerstand_bk", { precision: 10, scale: 2 }).default('0'),
  leerstandHk: numeric("leerstand_hk", { precision: 10, scale: 2 }).default('0'),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("units_property_top_unique").on(table.propertyId, table.topNummer),
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  mobilePhone: text("mobile_phone"),
  status: tenantStatusEnum("status").default('aktiv'),
  mietbeginn: date("mietbeginn"),
  mietende: date("mietende"),
  grundmiete: numeric("grundmiete", { precision: 10, scale: 2 }).default('0'),
  betriebskostenVorschuss: numeric("betriebskosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  heizkostenVorschuss: numeric("heizungskosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  wasserkostenVorschuss: numeric("wasserkosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  warmwasserkostenVorschuss: numeric("warmwasserkosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  sonstigeKosten: jsonb("sonstige_kosten").$type<Record<string, { betrag: number; ust: number; schluessel?: string }>>(),
  kaution: numeric("kaution", { precision: 10, scale: 2 }),
  kautionBezahlt: boolean("kaution_bezahlt").default(false),
  iban: text("iban"),
  bic: text("bic"),
  sepaMandat: boolean("sepa_mandat").default(false),
  sepaMandatDatum: date("sepa_mandat_datum"),
  notes: text("notes"),
  // Vertragsindividueller VPI-Schwellenwert (Dezimalwert, z.B. 0.05 = 5%).
  // NULL = globaler Systemwert (5%) wird verwendet.
  vpiSchwellenwert: numeric("vpi_schwellenwert", { precision: 5, scale: 4 }),
  // VPI-Tracking: Basiswert bei Vertragsabschluss / letzter Anpassung
  vpiBase: numeric("vpi_base", { precision: 8, scale: 2 }),
  lastVpiAdjustment: date("last_vpi_adjustment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ====== LEASES (Mietverträge) ======
export const leases = pgTable("leases", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  grundmiete: numeric("grundmiete", { precision: 10, scale: 2 }).notNull(),
  betriebskostenVorschuss: numeric("betriebskosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  heizkostenVorschuss: numeric("heizungskosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  wasserkostenVorschuss: numeric("wasserkosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  kaution: numeric("kaution", { precision: 10, scale: 2 }),
  kautionBezahlt: boolean("kaution_bezahlt").default(false),
  status: leaseStatusEnum("status").default('aktiv'),
  notes: text("notes"),
  // MRG-Felder für Befristungsabschlag (§ 16 Abs. 7 MRG)
  befristet: boolean("befristet").default(false),
  befristungEnde: date("befristung_ende"),
  // MRG-Richtwert-Parameter (§ 16 Abs. 2 MRG): Lagezuschlag in Prozent
  // (z. B. 10 für +10 %) und Ausstattungs-/sonstige Abschläge in Prozent
  // (negativ, z. B. -5 für -5 %). NULL = nicht erfasst → 0 im Check.
  lagezuschlag: numeric("lagezuschlag", { precision: 5, scale: 2 }),
  abschlaege: numeric("abschlaege", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("leases_tenant_unit_start_unique").on(table.tenantId, table.unitId, table.startDate),
]);

export const insertLeaseSchema = createInsertSchema(leases).omit({ id: true, createdAt: true, updatedAt: true });
export type Lease = typeof leases.$inferSelect;
export type InsertLease = typeof leases.$inferInsert;

// Dedup-Tabelle: eine Zeile pro (Mietvertrag, Schwellenwert) — verhindert Doppelversand
export const leaseExpiryNotifications = pgTable("lease_expiry_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leaseId: uuid("lease_id").notNull().references(() => leases.id, { onDelete: 'cascade' }),
  daysThreshold: integer("days_threshold").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Outbox lifecycle state:
   *  'pending' — claimed by a worker, e-mail not yet confirmed sent
   *  'sent'    — Resend accepted the e-mail; permanent dedup marker
   * Pending rows older than 2 h are treated as stale (crashed worker) and
   * are eligible for re-claim by the next scheduler run.
   */
  status: text("status").notNull().default('sent'),
}, (t) => [
  uniqueIndex("lease_expiry_notif_lease_threshold_unique").on(t.leaseId, t.daysThreshold),
]);

export type LeaseExpiryNotification = typeof leaseExpiryNotifications.$inferSelect;

export const rentHistory = pgTable("rent_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until"),
  grundmiete: numeric("grundmiete", { precision: 10, scale: 2 }).notNull(),
  betriebskostenVorschuss: numeric("betriebskosten_vorschuss", { precision: 10, scale: 2 }).notNull(),
  heizkostenVorschuss: numeric("heizungskosten_vorschuss", { precision: 10, scale: 2 }).notNull(),
  wasserkostenVorschuss: numeric("wasserkosten_vorschuss", { precision: 10, scale: 2 }).default('0'),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type RentHistory = typeof rentHistory.$inferSelect;
export type InsertRentHistory = typeof rentHistory.$inferInsert;

// ====== KAUTIONEN (SECURITY DEPOSITS - § 16b MRG) ======
export const kautionen = pgTable("kautionen", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  leaseId: uuid("lease_id").references(() => leases.id),
  betrag: numeric("betrag", { precision: 12, scale: 2 }).notNull(),
  eingangsdatum: date("eingangsdatum"),
  treuhandkontoIban: text("treuhandkonto_iban"),
  treuhandkontoBank: text("treuhandkonto_bank"),
  zinssatz: numeric("zinssatz", { precision: 5, scale: 3 }).default('0'),
  aufgelaufeneZinsen: numeric("aufgelaufene_zinsen", { precision: 12, scale: 2 }).default('0'),
  letzteZinsberechnung: date("letzte_zinsberechnung"),
  status: text("status").default('aktiv'),
  rueckzahlungsdatum: date("rueckzahlungsdatum"),
  rueckzahlungsbetrag: numeric("rueckzahlungsbetrag", { precision: 12, scale: 2 }),
  einbehaltenBetrag: numeric("einbehalten_betrag", { precision: 12, scale: 2 }).default('0'),
  einbehaltenGrund: text("einbehalten_grund"),
  // Zahlungsreferenz: Pflichtfeld beim Abschluss (completeReturn)
  zahlungsreferenz: text("zahlungsreferenz"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertKautionSchema = createInsertSchema(kautionen).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKaution = z.infer<typeof insertKautionSchema>;
export type Kaution = typeof kautionen.$inferSelect;

// ====== KAUTIONS-BEWEGUNGEN (DEPOSIT TRANSACTIONS) ======
export const kautionsBewegungen = pgTable("kautions_bewegungen", {
  id: uuid("id").defaultRandom().primaryKey(),
  kautionId: uuid("kaution_id").references(() => kautionen.id).notNull(),
  datum: date("datum").notNull(),
  betrag: numeric("betrag", { precision: 12, scale: 2 }).notNull(),
  typ: text("typ").notNull(),
  beschreibung: text("beschreibung"),
  // Zahlungsreferenz (Pflichtfeld für Abschluss-Buchungen, optional für andere)
  zahlungsreferenz: text("zahlungsreferenz"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertKautionsBewegungSchema = createInsertSchema(kautionsBewegungen).omit({ id: true, createdAt: true });
export type InsertKautionsBewegung = z.infer<typeof insertKautionsBewegungSchema>;
export type KautionsBewegung = typeof kautionsBewegungen.$inferSelect;

export const monthlyInvoices = pgTable("monthly_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  grundmiete: numeric("grundmiete", { precision: 10, scale: 2 }).default('0'),
  betriebskosten: numeric("betriebskosten", { precision: 10, scale: 2 }).default('0'),
  heizungskosten: numeric("heizungskosten", { precision: 10, scale: 2 }).default('0'),
  wasserkosten: numeric("wasserkosten", { precision: 10, scale: 2 }).default('0'),
  ustSatzMiete: integer("ust_satz_miete").default(10),
  ustSatzBk: integer("ust_satz_bk").default(10),
  ustSatzHeizung: integer("ust_satz_heizung").default(20),
  ustSatzWasser: integer("ust_satz_wasser").default(10),
  ust: numeric("ust", { precision: 10, scale: 2 }).default('0'),
  gesamtbetrag: numeric("gesamtbetrag", { precision: 10, scale: 2 }).default('0'),
  status: invoiceStatusEnum("status").default('offen'),
  faelligAm: date("faellig_am"),
  pdfUrl: text("pdf_url"),
  isVacancy: boolean("is_vacancy").default(false),
  wegBudgetPlanId: uuid("weg_budget_plan_id"),
  ownerId: uuid("owner_id"),
  vortragMiete: numeric("vortrag_miete", { precision: 10, scale: 2 }).default('0'),
  vortragBk: numeric("vortrag_bk", { precision: 10, scale: 2 }).default('0'),
  vortragHk: numeric("vortrag_hk", { precision: 10, scale: 2 }).default('0'),
  vortragSonstige: numeric("vortrag_sonstige", { precision: 10, scale: 2 }).default('0'),
  runId: uuid("run_id"),
  /** Bereits bezahlter Anteil (bei Status 'teilbezahlt' oder 'bezahlt'). Null = noch nicht gesetzt. */
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_invoices_unit_status_year_month").on(table.unitId, table.status, table.year, table.month),
  index("idx_invoices_run_id").on(table.runId),
  // Race-Condition-Schutz für Wirtschaftsplan-Aktivierung (eine WEG-Vorschreibungs-
  // Rechnung pro Plan+Einheit+Eigentümer+Monat) — siehe migrations/20260817b_weg_vorschreibungen_unique.sql
  uniqueIndex("uq_monthly_invoices_weg_plan_month")
    .on(table.wegBudgetPlanId, table.unitId, table.ownerId, table.year, table.month)
    .where(sql`weg_budget_plan_id IS NOT NULL`),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => monthlyInvoices.id),
  unitId: uuid("unit_id").references(() => units.id),
  lineType: varchar("line_type", { length: 50 }).notNull(),
  description: text("description"),
  normalizedDescription: text("normalized_description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  taxRate: integer("tax_rate").default(0),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_invoice_lines_invoice").on(table.invoiceId),
  index("idx_invoice_lines_unit").on(table.unitId),
  uniqueIndex("invoice_lines_unique_idx").on(table.invoiceId, table.unitId, table.lineType, table.normalizedDescription),
]);

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({ id: true, createdAt: true });
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type InsertInvoiceLine = typeof invoiceLines.$inferInsert;

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => monthlyInvoices.id),
  betrag: numeric("betrag", { precision: 10, scale: 2 }).notNull(),
  buchungsDatum: date("buchungs_datum").notNull(),
  paymentType: paymentTypeEnum("payment_type").default('ueberweisung'),
  verwendungszweck: text("verwendungszweck"),
  transactionId: uuid("transaction_id"),
  notizen: text("notizen"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ====== PAYMENT ALLOCATIONS (Zahlungszuordnungen) ======
export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").references(() => payments.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => monthlyInvoices.id).notNull(),
  appliedAmount: numeric("applied_amount", { precision: 10, scale: 2 }).notNull(),
  allocationType: text("allocation_type").default('miete'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocations).omit({ id: true, createdAt: true });
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type InsertPaymentAllocation = typeof paymentAllocations.$inferInsert;

// ====== IDEMPOTENCY KEYS ======
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  endpoint: text("endpoint"),
  requestHash: text("request_hash"),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const insertIdempotencyKeySchema = createInsertSchema(idempotencyKeys).omit({ id: true, createdAt: true });
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyKey = typeof idempotencyKeys.$inferInsert;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  accountName: text("account_name").notNull(),
  iban: text("iban"),
  bic: text("bic"),
  bankName: text("bank_name"),
  openingBalance: numeric("opening_balance", { precision: 10, scale: 2 }).default('0'),
  openingBalanceDate: date("opening_balance_date"),
  currentBalance: numeric("current_balance", { precision: 10, scale: 2 }).default('0'),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  transactionDate: date("transaction_date").notNull(),
  bookingText: text("booking_text"),
  partnerName: text("partner_name"),
  partnerIban: text("partner_iban"),
  reference: text("reference"),
  categoryId: uuid("category_id"),
  isMatched: boolean("is_matched").default(false),
  matchedTenantId: uuid("matched_tenant_id").references(() => tenants.id),
  matchedUnitId: uuid("matched_unit_id").references(() => units.id),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  category: expenseCategoryEnum("category").notNull(),
  expenseType: expenseTypeEnum("expense_type").default('sonstiges'),
  bezeichnung: text("bezeichnung").notNull(),
  betrag: numeric("betrag", { precision: 10, scale: 2 }).default('0'),
  datum: date("datum").notNull(),
  belegNummer: text("beleg_nummer"),
  belegUrl: text("beleg_url"),
  notizen: text("notes"),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  mrgKategorie: mrgBkKategorieEnum("mrg_kategorie"),
  mrgParagraph: text("mrg_paragraph"),
  istUmlagefaehig: boolean("ist_umlagefaehig").default(true),
  distributionKeyId: uuid("distribution_key_id").references(() => distributionKeys.id),
  transactionId: uuid("transaction_id").references(() => transactions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const expenseAllocations = pgTable("expense_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  expenseId: uuid("expense_id").notNull().references(() => expenses.id),
  unitId: uuid("unit_id").notNull().references(() => units.id),
  allocatedNet: numeric("allocated_net", { precision: 12, scale: 2 }).notNull(),
  allocationBasis: varchar("allocation_basis", { length: 50 }).notNull(),
  allocationDetail: text("allocation_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertExpenseAllocationSchema = createInsertSchema(expenseAllocations).omit({ id: true, createdAt: true });
export type ExpenseAllocation = typeof expenseAllocations.$inferSelect;
export type InsertExpenseAllocation = typeof expenseAllocations.$inferInsert;

export const settlements = pgTable("settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  year: integer("year").notNull(),
  status: settlementStatusEnum("status").default('entwurf'),
  gesamtausgaben: numeric("gesamtausgaben", { precision: 10, scale: 2 }).default('0'),
  gesamtvorschuss: numeric("gesamtvorschuss", { precision: 10, scale: 2 }).default('0'),
  differenz: numeric("differenz", { precision: 10, scale: 2 }).default('0'),
  berechnungsDatum: timestamp("berechnungs_datum", { withTimezone: true }),
  versandDatum: timestamp("versand_datum", { withTimezone: true }),
  pdfUrl: text("pdf_url"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const settlementDetails = pgTable("settlement_details", {
  id: uuid("id").defaultRandom().primaryKey(),
  settlementId: uuid("settlement_id").references(() => settlements.id).notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  anteil: numeric("anteil", { precision: 10, scale: 4 }).default('0'),
  ausgabenAnteil: numeric("ausgaben_anteil", { precision: 10, scale: 2 }).default('0'),
  vorschuss: numeric("vorschuss", { precision: 10, scale: 2 }).default('0'),
  differenz: numeric("differenz", { precision: 10, scale: 2 }).default('0'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const distributionKeys = pgTable("distribution_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  keyCode: text("key_code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  formula: text("formula").default('flaeche'),
  unit: text("unit").default('m²'),
  inputType: text("input_type").default('flaeche'),
  includedUnitTypes: text("included_unit_types").array(),
  isSystem: boolean("is_system").default(false),
  isActive: boolean("is_active").default(true),
  mrgKonform: boolean("mrg_konform").default(true),
  mrgParagraph: text("mrg_paragraph"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const unitDistributionValues = pgTable("unit_distribution_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  keyId: uuid("key_id").references(() => distributionKeys.id).notNull(),
  value: numeric("value", { precision: 10, scale: 4 }).default('0'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const maintenanceContracts = pgTable("maintenance_contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  contractType: text("contract_type").default('wartung'),
  contractorName: text("contractor_name"),
  contractorContact: text("contractor_contact"),
  contractorEmail: text("contractor_email"),
  contractFee: numeric("contract_fee", { precision: 10, scale: 2 }),
  intervalMonths: integer("interval_months").default(12),
  nextDueDate: date("next_due_date").notNull(),
  lastMaintenanceDate: date("last_maintenance_date"),
  reminderDays: integer("reminder_days").default(14),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  documentUrl: text("document_url"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 2 }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const maintenanceTasks = pgTable("maintenance_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  contractId: uuid("contract_id").references(() => maintenanceContracts.id),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").default('reparatur'),
  priority: text("priority").default('normal'),
  status: text("status").default('open'),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contractorName: text("contractor_name"),
  contractorContact: text("contractor_contact"),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const contractors = pgTable("contractors", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  companyName: text("company_name").notNull(),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  iban: text("iban"),
  bic: text("bic"),
  specializations: text("specializations").array(),
  rating: integer("rating"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const accountCategories = pgTable("account_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  parentId: uuid("parent_id"),
  isSystem: boolean("is_system").default(false),
  defaultDistributionKeyId: uuid("default_distribution_key_id").references(() => distributionKeys.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const learnedMatches = pgTable("learned_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  pattern: text("pattern").notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  matchCount: integer("match_count").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sepaCollections = pgTable("sepa_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).default('0'),
  tenantCount: integer("tenant_count").default(0),
  status: text("status").default('draft'),
  xmlContent: text("xml_content"),
  fileName: text("file_name"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  recipientType: text("recipient_type").default('internal'),
  recipientEmail: text("recipient_email"),
  messageType: text("message_type"),
  subject: text("subject"),
  messageBody: text("message_body"),
  status: text("status").default('draft'),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id),
  runId: text("run_id"),
  tableName: text("table_name").notNull(),
  recordId: text("record_id"),
  action: text("action").notNull(),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // SECURITY PUNKT 6: HMAC-Integritätskette für audit_logs
  chainHmac: text("chain_hmac"),
  previousHmac: text("previous_hmac"),
  // Monotone Append-Reihenfolge: von einer Sequence UNTER Advisory Lock vergeben.
  // Unabhängig von created_at (Transaktionsstartzeit) → korrekte Verifikationsreihenfolge.
  chainSeq: bigint("chain_seq", { mode: "number" }),
  // HMAC-Version: 'v3' = vollständige Nutzlast (old/new data, userId, IP, userAgent).
  // NULL = Legacy-Zeile ohne HMAC; wird bei Verifikation übersprungen.
  hmacVersion: text("hmac_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const invoiceRuns = pgTable("invoice_runs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().unique(),
  period: text("period").notNull(),
  initiatedBy: uuid("initiated_by").references(() => profiles.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  status: text("status").notNull().default("started"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPropertySchema = createInsertSchema(properties).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUnitSchema = createInsertSchema(units).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true }).partial({
  type: true,
  status: true,
  flaeche: true,
  zimmer: true,
  nutzwert: true,
  stockwerk: true,
  notes: true,
});
export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMonthlyInvoiceSchema = createInsertSchema(monthlyInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertSettlementSchema = createInsertSchema(settlements).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMaintenanceContractSchema = createInsertSchema(maintenanceContracts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMaintenanceTaskSchema = createInsertSchema(maintenanceTasks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContractorSchema = createInsertSchema(contractors).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRentHistorySchema = createInsertSchema(rentHistory).omit({ id: true, createdAt: true });

// ====== EIGENTÜMER (OWNERS) ======
export const owners = pgTable("owners", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  mobilePhone: text("mobile_phone"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  country: text("country").default('Österreich'),
  iban: text("iban"),
  bic: text("bic"),
  bankName: text("bank_name"),
  taxNumber: text("tax_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Zuordnung Eigentümer zu Liegenschaften (many-to-many mit Anteil)
export const propertyOwners = pgTable("property_owners", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  ownershipShare: numeric("ownership_share", { precision: 5, scale: 2 }).default('100.00'),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ====== ZÄHLERSTÄNDE (METER READINGS) ======
export const meterTypeEnum = pgEnum('meter_type', ['strom', 'gas', 'wasser', 'heizung', 'warmwasser', 'sonstiges']);

export const meters = pgTable("meters", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  meterNumber: text("meter_number").notNull(),
  meterType: meterTypeEnum("meter_type").notNull(),
  location: text("location"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const meterReadings = pgTable("meter_readings", {
  id: uuid("id").defaultRandom().primaryKey(),
  meterId: uuid("meter_id").references(() => meters.id).notNull(),
  readingDate: date("reading_date").notNull(),
  readingValue: numeric("reading_value", { precision: 12, scale: 3 }).notNull(),
  isEstimated: boolean("is_estimated").default(false),
  readBy: text("read_by"),
  imageUrl: text("image_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_meter_readings_date").on(table.meterId, table.readingDate),
]);

// ====== SCHLÜSSELVERWALTUNG (KEY MANAGEMENT) ======
export const keyTypeEnum = pgEnum('key_type', ['hauptschluessel', 'wohnungsschluessel', 'kellerschluessel', 'garagenschluessel', 'briefkastenschluessel', 'sonstiges']);
export const keyStatusEnum = pgEnum('key_status', ['vorhanden', 'ausgegeben', 'verloren', 'gesperrt']);

export const keyInventory = pgTable("key_inventory", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  keyType: keyTypeEnum("key_type").notNull(),
  keyNumber: text("key_number"),
  description: text("description"),
  totalCount: integer("total_count").default(1),
  availableCount: integer("available_count").default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const keyHandovers = pgTable("key_handovers", {
  id: uuid("id").defaultRandom().primaryKey(),
  keyInventoryId: uuid("key_inventory_id").references(() => keyInventory.id).notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  recipientName: text("recipient_name"),
  handoverDate: date("handover_date").notNull(),
  returnDate: date("return_date"),
  quantity: integer("quantity").default(1),
  status: keyStatusEnum("status").default('ausgegeben'),
  handoverProtocol: text("handover_protocol"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ====== VPI INDEXANPASSUNGEN ======
export const vpiAdjustments = pgTable("vpi_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  adjustmentDate: date("adjustment_date").notNull(),
  previousRent: numeric("previous_rent", { precision: 10, scale: 2 }).notNull(),
  newRent: numeric("new_rent", { precision: 10, scale: 2 }).notNull(),
  vpiOld: numeric("vpi_old", { precision: 8, scale: 2 }),
  vpiNew: numeric("vpi_new", { precision: 8, scale: 2 }),
  percentageChange: numeric("percentage_change", { precision: 5, scale: 2 }),
  notificationSent: boolean("notification_sent").default(false),
  notificationDate: date("notification_date"),
  effectiveDate: date("effective_date"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const vpiValues = pgTable("vpi_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  value: numeric("value", { precision: 8, scale: 2 }).notNull(),
  source: text("source").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertOwnerSchema = createInsertSchema(owners).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPropertyOwnerSchema = createInsertSchema(propertyOwners).omit({ id: true, createdAt: true });
export const insertMeterSchema = createInsertSchema(meters).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMeterReadingSchema = createInsertSchema(meterReadings).omit({ id: true, createdAt: true });
export const insertKeyInventorySchema = createInsertSchema(keyInventory).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKeyHandoverSchema = createInsertSchema(keyHandovers).omit({ id: true, createdAt: true });
export const insertVpiAdjustmentSchema = createInsertSchema(vpiAdjustments).omit({ id: true, createdAt: true });

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type InsertMonthlyInvoice = z.infer<typeof insertMonthlyInvoiceSchema>;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;
export type InsertMaintenanceContract = z.infer<typeof insertMaintenanceContractSchema>;
export type InsertMaintenanceTask = z.infer<typeof insertMaintenanceTaskSchema>;
export type InsertContractor = z.infer<typeof insertContractorSchema>;

export type Organization = typeof organizations.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type MonthlyInvoice = typeof monthlyInvoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type MaintenanceContract = typeof maintenanceContracts.$inferSelect;
export type MaintenanceTask = typeof maintenanceTasks.$inferSelect;
export type Contractor = typeof contractors.$inferSelect;
export type DistributionKey = typeof distributionKeys.$inferSelect;
export const insertDistributionKeySchema = createInsertSchema(distributionKeys).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDistributionKey = z.infer<typeof insertDistributionKeySchema>;
export type UnitDistributionValue = typeof unitDistributionValues.$inferSelect;
export const insertUnitDistributionValueSchema = createInsertSchema(unitDistributionValues).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUnitDistributionValue = z.infer<typeof insertUnitDistributionValueSchema>;
export type AccountCategory = typeof accountCategories.$inferSelect;
export type LearnedMatch = typeof learnedMatches.$inferSelect;
export type SepaCollection = typeof sepaCollections.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InvoiceRun = typeof invoiceRuns.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;

export type Owner = typeof owners.$inferSelect;
export type PropertyOwner = typeof propertyOwners.$inferSelect;
export type PropertyManager = typeof propertyManagers.$inferSelect;
export type Meter = typeof meters.$inferSelect;
export type MeterReading = typeof meterReadings.$inferSelect;
export type KeyInventory = typeof keyInventory.$inferSelect;
export type KeyHandover = typeof keyHandovers.$inferSelect;
export type VpiAdjustment = typeof vpiAdjustments.$inferSelect;

export type InsertOwner = z.infer<typeof insertOwnerSchema>;
export type InsertPropertyOwner = z.infer<typeof insertPropertyOwnerSchema>;
export type InsertMeter = z.infer<typeof insertMeterSchema>;
export type InsertMeterReading = z.infer<typeof insertMeterReadingSchema>;
export type InsertKeyInventory = z.infer<typeof insertKeyInventorySchema>;
export type InsertKeyHandover = z.infer<typeof insertKeyHandoverSchema>;
export type InsertVpiAdjustment = z.infer<typeof insertVpiAdjustmentSchema>;

// Budget status enum
export const budgetStatusEnum = pgEnum('budget_status', ['entwurf', 'eingereicht', 'genehmigt', 'abgelehnt']);

// Property Budgets table
export const propertyBudgets = pgTable("property_budgets", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  year: integer("year").notNull(),
  position1Name: text("position_1_name"),
  position1Amount: numeric("position_1_amount", { precision: 12, scale: 2 }).default("0"),
  position2Name: text("position_2_name"),
  position2Amount: numeric("position_2_amount", { precision: 12, scale: 2 }).default("0"),
  position3Name: text("position_3_name"),
  position3Amount: numeric("position_3_amount", { precision: 12, scale: 2 }).default("0"),
  position4Name: text("position_4_name"),
  position4Amount: numeric("position_4_amount", { precision: 12, scale: 2 }).default("0"),
  position5Name: text("position_5_name"),
  position5Amount: numeric("position_5_amount", { precision: 12, scale: 2 }).default("0"),
  status: budgetStatusEnum("status").default('entwurf'),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertPropertyBudgetSchema = createInsertSchema(propertyBudgets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPropertyBudget = z.infer<typeof insertPropertyBudgetSchema>;
export type PropertyBudget = typeof propertyBudgets.$inferSelect;

// Document category enum
export const documentCategoryEnum = pgEnum('document_category', [
  'vertrag', 'rechnung', 'bescheid', 'protokoll', 'korrespondenz', 
  'abrechnung', 'mahnung', 'kaution', 'uebergabe', 'sonstiges'
]);

// Property Documents table
export const propertyDocuments = pgTable("property_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  category: documentCategoryEnum("category").default('sonstiges'),
  fileUrl: text("file_url"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Tenant Documents table  
export const tenantDocuments = pgTable("tenant_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  category: documentCategoryEnum("category").default('sonstiges'),
  fileUrl: text("file_url"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertPropertyDocumentSchema = createInsertSchema(propertyDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPropertyDocument = z.infer<typeof insertPropertyDocumentSchema>;
export type PropertyDocument = typeof propertyDocuments.$inferSelect;

export const insertTenantDocumentSchema = createInsertSchema(tenantDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantDocument = z.infer<typeof insertTenantDocumentSchema>;
export type TenantDocument = typeof tenantDocuments.$inferSelect;

// Demo status enum
export const demoStatusEnum = pgEnum('demo_status', ['pending', 'activated', 'expired', 'converted']);

// Demo Invites table for prospect testing
export const demoInvites = pgTable("demo_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  status: demoStatusEnum("status").default('pending'),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  demoEndsAt: timestamp("demo_ends_at", { withTimezone: true }),
  userId: uuid("user_id").references(() => profiles.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertDemoInviteSchema = createInsertSchema(demoInvites).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDemoInvite = z.infer<typeof insertDemoInviteSchema>;
export type DemoInvite = typeof demoInvites.$inferSelect;

// White Label Inquiry status enum
export const whiteLabelInquiryStatusEnum = pgEnum('white_label_inquiry_status', ['neu', 'kontaktiert', 'demo_vereinbart', 'verhandlung', 'abgeschlossen', 'abgelehnt']);

// White Label Inquiries table for prospective White Label customers
export const whiteLabelInquiries = pgTable("white_label_inquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyName: text("company_name").notNull(),
  contactPerson: text("contact_person").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  propertyCount: integer("property_count"),
  unitCount: integer("unit_count"),
  message: text("message"),
  status: whiteLabelInquiryStatusEnum("status").default('neu'),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWhiteLabelInquirySchema = createInsertSchema(whiteLabelInquiries).omit({ id: true, createdAt: true, updatedAt: true, ipAddress: true, userAgent: true, notes: true, status: true });
export type InsertWhiteLabelInquiry = z.infer<typeof insertWhiteLabelInquirySchema>;
export type WhiteLabelInquiry = typeof whiteLabelInquiries.$inferSelect;

// White Label Licenses table for active White Label customers
export const whiteLabelLicenseStatusEnum = pgEnum('white_label_license_status', ['aktiv', 'gekuendigt', 'pausiert', 'abgelaufen']);

export const whiteLabelLicenses = pgTable("white_label_licenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  licenseName: text("license_name").notNull(),
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }),
  setupFee: numeric("setup_fee", { precision: 10, scale: 2 }),
  contractStart: date("contract_start").notNull(),
  contractEnd: date("contract_end"),
  status: whiteLabelLicenseStatusEnum("status").default('aktiv'),
  customDomain: text("custom_domain"),
  maxUsers: integer("max_users"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWhiteLabelLicenseSchema = createInsertSchema(whiteLabelLicenses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhiteLabelLicense = z.infer<typeof insertWhiteLabelLicenseSchema>;
export type WhiteLabelLicense = typeof whiteLabelLicenses.$inferSelect;

// ====== WEG EINHEITEN-EIGENTÜMER (UNIT OWNERS with MEA - § 2 WEG 2002) ======
export const wegUnitOwners = pgTable("weg_unit_owners", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  meaShare: numeric("mea_share", { precision: 10, scale: 4 }).notNull(),
  nutzwert: numeric("nutzwert", { precision: 10, scale: 4 }),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegUnitOwnerSchema = createInsertSchema(wegUnitOwners).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegUnitOwner = z.infer<typeof insertWegUnitOwnerSchema>;
export type WegUnitOwner = typeof wegUnitOwners.$inferSelect;

// ====== WEG VERSAMMLUNGEN (WEG ASSEMBLIES - § 24-25 WEG 2002) ======
export const wegAssemblies = pgTable("weg_assemblies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  title: text("title").notNull(),
  assemblyType: text("assembly_type").default('ordentlich'),
  assemblyDate: timestamp("assembly_date", { withTimezone: true }).notNull(),
  location: text("location"),
  invitationSentAt: timestamp("invitation_sent_at", { withTimezone: true }),
  invitationDeadline: timestamp("invitation_deadline", { withTimezone: true }),
  isCircularResolution: boolean("is_circular_resolution").default(false),
  circularDeadline: timestamp("circular_deadline", { withTimezone: true }),
  protocolUrl: text("protocol_url"),
  protocolNumber: text("protocol_number"),
  status: text("status").default('geplant'),
  totalMeaPresent: numeric("total_mea_present", { precision: 10, scale: 4 }),
  totalMeaProperty: numeric("total_mea_property", { precision: 10, scale: 4 }),
  quorumReached: boolean("quorum_reached"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegAssemblySchema = createInsertSchema(wegAssemblies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegAssembly = z.infer<typeof insertWegAssemblySchema>;
export type WegAssembly = typeof wegAssemblies.$inferSelect;

// ====== WEG TAGESORDNUNGSPUNKTE (AGENDA ITEMS / TOPs) ======
export const wegAgendaItems = pgTable("weg_agenda_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  assemblyId: uuid("assembly_id").references(() => wegAssemblies.id).notNull(),
  topNumber: integer("top_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").default('sonstiges'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegAgendaItemSchema = createInsertSchema(wegAgendaItems).omit({ id: true, createdAt: true });
export type InsertWegAgendaItem = z.infer<typeof insertWegAgendaItemSchema>;
export type WegAgendaItem = typeof wegAgendaItems.$inferSelect;

// ====== WEG ABSTIMMUNGEN (WEG VOTES - § 24 WEG 2002) ======
export const wegVotes = pgTable("weg_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  assemblyId: uuid("assembly_id").references(() => wegAssemblies.id).notNull(),
  agendaItemId: uuid("agenda_item_id").references(() => wegAgendaItems.id),
  topic: text("topic").notNull(),
  description: text("description"),
  requiredMajority: text("required_majority").default('einfach'),
  votesYes: integer("votes_yes").default(0),
  votesNo: integer("votes_no").default(0),
  votesAbstain: integer("votes_abstain").default(0),
  meaVotesYes: numeric("mea_votes_yes", { precision: 10, scale: 4 }).default('0'),
  meaVotesNo: numeric("mea_votes_no", { precision: 10, scale: 4 }).default('0'),
  meaVotesAbstain: numeric("mea_votes_abstain", { precision: 10, scale: 4 }).default('0'),
  totalMea: numeric("total_mea", { precision: 10, scale: 4 }),
  result: text("result"),
  resultBasis: text("result_basis").default('mea'),
  isCircularVote: boolean("is_circular_vote").default(false),
  voteType: text("vote_type").$type<'versammlung' | 'umlauf'>().default('versammlung'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegVoteSchema = createInsertSchema(wegVotes).omit({ id: true, createdAt: true });
export type InsertWegVote = z.infer<typeof insertWegVoteSchema>;
export type WegVote = typeof wegVotes.$inferSelect;

// ====== WEG EIGENTÜMER-EINZELSTIMMEN (PER-OWNER VOTES) ======
export const wegOwnerVotes = pgTable("weg_owner_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  voteId: uuid("vote_id").references(() => wegVotes.id).notNull(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  voteValue: text("vote_value").notNull(),
  meaWeight: numeric("mea_weight", { precision: 10, scale: 4 }),
  votedAt: timestamp("voted_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegOwnerVoteSchema = createInsertSchema(wegOwnerVotes).omit({ id: true, createdAt: true });
export type InsertWegOwnerVote = z.infer<typeof insertWegOwnerVoteSchema>;
export type WegOwnerVote = typeof wegOwnerVotes.$inferSelect;

// ====== WEG ABSTIMMUNGSERGEBNISSE (persistierte Ergebnisse § 24-25 WEG 2002) ======
export const wegVoteResults = pgTable("weg_vote_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  voteId: uuid("vote_id").references(() => wegVotes.id).notNull().unique(),
  passed: boolean("passed").notNull(),
  quorumReached: boolean("quorum_reached").notNull(),
  yesShares: numeric("yes_shares", { precision: 10, scale: 4 }),
  noShares: numeric("no_shares", { precision: 10, scale: 4 }),
  abstainShares: numeric("abstain_shares", { precision: 10, scale: 4 }),
  yesCount: integer("yes_count"),
  noCount: integer("no_count"),
  abstainCount: integer("abstain_count"),
  resultText: text("result_text"),
  kopfMajorityReached: boolean("kopf_majority_reached"),
  kopfResultText: text("kopf_result_text"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  /** Gesetzt wenn ein Umlaufbeschluss von passed=true auf passed=false wechselt
   *  (§ 24 Abs. 1 WEG 2002: nachträgliche Nein-Stimme / Enthaltung invalidiert das Protokoll). */
  invalidationWarning: text("invalidation_warning"),
});

export const insertWegVoteResultSchema = createInsertSchema(wegVoteResults).omit({ id: true });
export type InsertWegVoteResult = z.infer<typeof insertWegVoteResultSchema>;
export type WegVoteResult = typeof wegVoteResults.$inferSelect;

// ====== WEG RÜCKLAGE (WEG RESERVE FUND - § 31 WEG 2002) ======
export const wegReserveFund = pgTable("weg_reserve_fund", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).default('0'),
  description: text("description"),
  entryType: text("entry_type").default('einzahlung'),
  unitId: uuid("unit_id").references(() => units.id),
  ownerId: uuid("owner_id").references(() => owners.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegReserveFundSchema = createInsertSchema(wegReserveFund).omit({ id: true, createdAt: true });
export type InsertWegReserveFund = z.infer<typeof insertWegReserveFundSchema>;
export type WegReserveFund = typeof wegReserveFund.$inferSelect;

// ====== WEG WIRTSCHAFTSPLAN (BUDGET PLAN - § 31 WEG 2002) ======
export const wegBudgetPlans = pgTable("weg_budget_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  year: integer("year").notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).default('0'),
  reserveContribution: numeric("reserve_contribution", { precision: 12, scale: 2 }).default('0'),
  managementFee: numeric("management_fee", { precision: 12, scale: 2 }).default('0'),
  activeFrom: date("active_from"),
  dueDay: integer("due_day").default(5),
  status: text("status").default('entwurf'),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByVoteId: uuid("approved_by_vote_id"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegBudgetPlanSchema = createInsertSchema(wegBudgetPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegBudgetPlan = z.infer<typeof insertWegBudgetPlanSchema>;
export type WegBudgetPlan = typeof wegBudgetPlans.$inferSelect;

// ====== WEG WIRTSCHAFTSPLAN-POSITIONEN (BUDGET LINES) ======
export const wegBudgetLines = pgTable("weg_budget_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  budgetPlanId: uuid("budget_plan_id").references(() => wegBudgetPlans.id).notNull(),
  category: text("category").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).default('0'),
  allocationKey: text("allocation_key").default('mea'),
  ustRate: integer("ust_rate").default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegBudgetLineSchema = createInsertSchema(wegBudgetLines).omit({ id: true, createdAt: true });
export type InsertWegBudgetLine = z.infer<typeof insertWegBudgetLineSchema>;
export type WegBudgetLine = typeof wegBudgetLines.$inferSelect;

// ====== WEG-VORSCHREIBUNGEN (OWNER INVOICING) ======
export const wegVorschreibungen = pgTable("weg_vorschreibungen", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  budgetPlanId: uuid("budget_plan_id").references(() => wegBudgetPlans.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  meaShare: numeric("mea_share", { precision: 10, scale: 4 }).notNull(),
  betriebskosten: numeric("betriebskosten", { precision: 12, scale: 2 }).default('0'),
  ruecklage: numeric("ruecklage", { precision: 12, scale: 2 }).default('0'),
  instandhaltung: numeric("instandhaltung", { precision: 12, scale: 2 }).default('0'),
  verwaltungshonorar: numeric("verwaltungshonorar", { precision: 12, scale: 2 }).default('0'),
  heizung: numeric("heizung", { precision: 12, scale: 2 }).default('0'),
  ust: numeric("ust", { precision: 12, scale: 2 }).default('0'),
  gesamtbetrag: numeric("gesamtbetrag", { precision: 12, scale: 2 }).default('0'),
  // Tatsächlich bezahlter Betrag bei Teilzahlungen (status='teilbezahlt').
  // Muss beim Buchen einer Teilzahlung gesetzt werden.
  // NULL = noch nicht gesetzt; bei status='bezahlt' wird gesamtbetrag verwendet.
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
  status: invoiceStatusEnum("status").default('offen'),
  faelligAm: date("faellig_am"),
  pdfUrl: text("pdf_url"),
  runId: uuid("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_weg_vorschreibungen_property").on(table.propertyId, table.year, table.month),
  index("idx_weg_vorschreibungen_owner").on(table.ownerId),
  index("idx_weg_vorschreibungen_run").on(table.runId),
  // Race-Condition-Schutz: eine PLAN-Vorschreibung pro Eigentümer+Einheit+Monat.
  // Partiell (budget_plan_id IS NOT NULL): Sonderumlage-Zeilen dürfen zusätzlich
  // existieren — siehe migrations/20260817b_weg_vorschreibungen_unique.sql
  uniqueIndex("uq_weg_vorschreibungen_owner_month")
    .on(table.propertyId, table.unitId, table.ownerId, table.year, table.month)
    .where(sql`budget_plan_id IS NOT NULL`),
]);

export const insertWegVorschreibungSchema = createInsertSchema(wegVorschreibungen)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .refine(
    (data) => {
      if (data.status === 'teilbezahlt') {
        const paid = data.paidAmount !== undefined && data.paidAmount !== null
          ? Number(data.paidAmount)
          : null;
        return paid !== null && isFinite(paid) && paid > 0;
      }
      return true;
    },
    {
      message: "paidAmount ist Pflichtfeld bei Status 'teilbezahlt' und muss > 0 sein",
      path: ['paidAmount'],
    }
  );
export type InsertWegVorschreibung = z.infer<typeof insertWegVorschreibungSchema>;
export type WegVorschreibung = typeof wegVorschreibungen.$inferSelect;

// ====== WEG SONDERUMLAGEN (SPECIAL ASSESSMENTS) ======
export const wegSpecialAssessments = pgTable("weg_special_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  allocationKey: text("allocation_key").default('mea'),
  dueDate: date("due_date"),
  approvedByVoteId: uuid("approved_by_vote_id"),
  status: text("status").default('beschlossen'),
  // Dauerhaftes Feld: krediert diese Sonderumlage die Instandhaltungsrücklage?
  // Ersetzt Text-Matching auf Titel/Beschreibung — klar und eindeutig.
  creditsReserveFund: boolean("credits_reserve_fund").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegSpecialAssessmentSchema = createInsertSchema(wegSpecialAssessments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegSpecialAssessment = z.infer<typeof insertWegSpecialAssessmentSchema>;
export type WegSpecialAssessment = typeof wegSpecialAssessments.$inferSelect;

// ====== WEG JAHRESABRECHNUNG (ANNUAL SETTLEMENT) ======
export const wegSettlements = pgTable("weg_settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  year: integer("year").notNull(),
  totalExpenses: numeric("total_expenses", { precision: 12, scale: 2 }).default('0'),
  totalPrepayments: numeric("total_prepayments", { precision: 12, scale: 2 }).default('0'),
  totalDifference: numeric("total_difference", { precision: 12, scale: 2 }).default('0'),
  ownerCount: integer("owner_count").default(0),
  totalMea: numeric("total_mea", { precision: 10, scale: 4 }).default('0'),
  reserveFundBalance: numeric("reserve_fund_balance", { precision: 12, scale: 2 }).default('0'),
  status: text("status").default('entwurf'),
  createdBy: uuid("created_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegSettlementSchema = createInsertSchema(wegSettlements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegSettlement = z.infer<typeof insertWegSettlementSchema>;
export type WegSettlement = typeof wegSettlements.$inferSelect;

// ====== WEG ABRECHNUNGS-DETAILS (SETTLEMENT DETAILS PER OWNER) ======
export const wegSettlementDetails = pgTable("weg_settlement_details", {
  id: uuid("id").defaultRandom().primaryKey(),
  settlementId: uuid("settlement_id").references(() => wegSettlements.id).notNull(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  meaShare: numeric("mea_share", { precision: 10, scale: 4 }).notNull(),
  meaRatio: numeric("mea_ratio", { precision: 10, scale: 6 }).notNull(),
  totalSoll: numeric("total_soll", { precision: 12, scale: 2 }).default('0'),
  totalIst: numeric("total_ist", { precision: 12, scale: 2 }).default('0'),
  saldo: numeric("saldo", { precision: 12, scale: 2 }).default('0'),
  ruecklageAnteil: numeric("ruecklage_anteil", { precision: 12, scale: 2 }).default('0'),
  sonderumlagen: numeric("sonderumlagen", { precision: 12, scale: 2 }).default('0'),
  categoryDetails: jsonb("category_details"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertWegSettlementDetailSchema = createInsertSchema(wegSettlementDetails).omit({ id: true, createdAt: true });
export type InsertWegSettlementDetail = z.infer<typeof insertWegSettlementDetailSchema>;
export type WegSettlementDetail = typeof wegSettlementDetails.$inferSelect;

// ====== WEG ABRECHNUNGS-VERSAND-LOG ======
/** Persistenter Nachweis jeder versendeten/fehlgeschlagenen E-Mail (DSGVO Art. 5, § 34 WEG 2002). */
export const wegSettlementEmails = pgTable("weg_settlement_emails", {
  id:           uuid("id").defaultRandom().primaryKey(),
  settlementId: uuid("settlement_id").references(() => wegSettlements.id, { onDelete: "cascade" }).notNull(),
  ownerId:      uuid("owner_id").references(() => owners.id, { onDelete: "set null" }),
  email:        text("email").notNull(),
  /** 'sent' | 'failed' */
  status:       text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt:       timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_weg_settlement_emails_settlement_id").on(table.settlementId),
  index("idx_weg_settlement_emails_owner_id").on(table.ownerId),
  // Partieller Covering-Index für MAX(sent_at) je Settlement (Versandspalte
  // in GET /api/weg/settlements) — siehe migrations/20260817_weg_settlement_emails_sent_idx.sql
  index("idx_weg_settlement_emails_sent_lookup")
    .on(table.settlementId, table.sentAt.desc())
    .where(sql`status = 'sent'`),
]);

export type WegSettlementEmail = typeof wegSettlementEmails.$inferSelect;

// ====== WEG VORSCHREIBUNGS-VERSAND-LOG ======
/** Persistenter Nachweis jeder versendeten/fehlgeschlagenen Vorschreibungs-E-Mail. */
export const wegVorschreibungEmails = pgTable("weg_vorschreibung_emails", {
  id:               uuid("id").defaultRandom().primaryKey(),
  vorschreibungId:  uuid("vorschreibung_id").references(() => monthlyInvoices.id, { onDelete: "cascade" }).notNull(),
  ownerId:          uuid("owner_id").references(() => owners.id, { onDelete: "set null" }),
  email:            text("email").notNull(),
  /** 'sent' | 'failed' */
  status:           text("status").notNull().default("sent"),
  errorMessage:     text("error_message"),
  sentAt:           timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_weg_vorschreibung_emails_vorschreibung_id").on(table.vorschreibungId),
  index("idx_weg_vorschreibung_emails_owner_id").on(table.ownerId),
]);

export type WegVorschreibungEmail = typeof wegVorschreibungEmails.$inferSelect;

// ====== WEG ERHALTUNG & VERBESSERUNG (MAINTENANCE - § 28-29 WEG 2002) ======
export const wegMaintenanceItems = pgTable("weg_maintenance_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").default('ordentliche_verwaltung'),
  priority: text("priority").default('normal'),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 12, scale: 2 }),
  financingSource: text("financing_source").default('ruecklage'),
  specialAssessmentId: uuid("special_assessment_id").references(() => wegSpecialAssessments.id),
  approvedByVoteId: uuid("approved_by_vote_id"),
  status: text("status").default('geplant'),
  startDate: date("start_date"),
  completionDate: date("completion_date"),
  contractorName: text("contractor_name"),
  contractorContact: text("contractor_contact"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegMaintenanceItemSchema = createInsertSchema(wegMaintenanceItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWegMaintenanceItem = z.infer<typeof insertWegMaintenanceItemSchema>;
export type WegMaintenanceItem = typeof wegMaintenanceItems.$inferSelect;

// ====== WEG EIGENTÜMERWECHSEL (OWNER CHANGE - § 38 WEG 2002) ======
export const ownerChangeRechtsgrundEnum = pgEnum('owner_change_rechtsgrund', ['kauf', 'schenkung', 'erbschaft', 'zwangsversteigerung', 'einbringung']);
export const ownerChangeStatusEnum = pgEnum('owner_change_status', ['entwurf', 'grundbuch_eingetragen', 'abgeschlossen']);

export const wegOwnerChanges = pgTable("weg_owner_changes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  previousOwnerId: uuid("previous_owner_id").references(() => owners.id).notNull(),
  newOwnerId: uuid("new_owner_id").references(() => owners.id).notNull(),
  transferDate: date("transfer_date").notNull(),
  grundbuchDate: date("grundbuch_date"),
  tzNumber: text("tz_number"),
  kaufvertragDate: date("kaufvertrag_date"),
  rechtsgrund: ownerChangeRechtsgrundEnum("rechtsgrund").default('kauf'),
  status: ownerChangeStatusEnum("status").default('entwurf'),
  meaShare: numeric("mea_share", { precision: 10, scale: 4 }),
  nutzwert: numeric("nutzwert", { precision: 10, scale: 4 }),
  reserveAmount: numeric("reserve_amount", { precision: 12, scale: 2 }).default('0'),
  openDebtsAmount: numeric("open_debts_amount", { precision: 12, scale: 2 }).default('0'),
  aliquotMonth: integer("aliquot_month"),
  aliquotOldOwnerAmount: numeric("aliquot_old_owner_amount", { precision: 12, scale: 2 }).default('0'),
  aliquotNewOwnerAmount: numeric("aliquot_new_owner_amount", { precision: 12, scale: 2 }).default('0'),
  cancelledInvoiceCount: integer("cancelled_invoice_count").default(0),
  newInvoiceCount: integer("new_invoice_count").default(0),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertWegOwnerChangeSchema = createInsertSchema(wegOwnerChanges).omit({ id: true, createdAt: true, updatedAt: true, executedAt: true });
export type InsertWegOwnerChange = z.infer<typeof insertWegOwnerChangeSchema>;
export type WegOwnerChange = typeof wegOwnerChanges.$inferSelect;

// ====== VERSICHERUNGSPOLICEN (INSURANCE POLICIES) ======
export const insurancePolicies = pgTable("insurance_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  insuranceType: text("insurance_type").default('gebaeudeversicherung'),
  provider: text("provider").notNull(),
  policyNumber: text("policy_number"),
  coverageAmount: numeric("coverage_amount", { precision: 12, scale: 2 }),
  annualPremium: numeric("annual_premium", { precision: 12, scale: 2 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  autoRenew: boolean("auto_renew").default(true),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertInsurancePolicySchema = createInsertSchema(insurancePolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInsurancePolicy = z.infer<typeof insertInsurancePolicySchema>;
export type InsurancePolicy = typeof insurancePolicies.$inferSelect;

// ====== VERSICHERUNGSSCHÄDEN (INSURANCE CLAIMS) ======
export const insuranceClaims = pgTable("insurance_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  insurancePolicyId: uuid("insurance_policy_id").references(() => insurancePolicies.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  claimDate: date("claim_date").notNull(),
  description: text("description").notNull(),
  damageAmount: numeric("damage_amount", { precision: 12, scale: 2 }),
  reimbursedAmount: numeric("reimbursed_amount", { precision: 12, scale: 2 }).default('0'),
  status: text("status").default('gemeldet'),
  claimNumber: text("claim_number"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertInsuranceClaimSchema = createInsertSchema(insuranceClaims).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInsuranceClaim = z.infer<typeof insertInsuranceClaimSchema>;
export type InsuranceClaim = typeof insuranceClaims.$inferSelect;

// ====== FRISTEN (DEADLINES) ======
export const deadlines = pgTable("deadlines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  title: text("title").notNull(),
  description: text("description"),
  deadlineDate: date("deadline_date").notNull(),
  reminderDays: integer("reminder_days").default(14),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  category: text("category").default('sonstiges'),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceMonths: integer("recurrence_months"),
  status: text("status").default('offen'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertDeadlineSchema = createInsertSchema(deadlines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeadline = z.infer<typeof insertDeadlineSchema>;
export type Deadline = typeof deadlines.$inferSelect;

// ====== BRIEFVORLAGEN (LETTER TEMPLATES) ======
export const letterTemplates = pgTable("letter_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  category: text("category").default('allgemein'),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertLetterTemplateSchema = createInsertSchema(letterTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLetterTemplate = z.infer<typeof insertLetterTemplateSchema>;
export type LetterTemplate = typeof letterTemplates.$inferSelect;

// ====== SERIENBRIEFE (SERIAL LETTERS) ======
export const serialLetters = pgTable("serial_letters", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  templateId: uuid("template_id").references(() => letterTemplates.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipientCount: integer("recipient_count").default(0),
  sentVia: text("sent_via").default('pdf'),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertSerialLetterSchema = createInsertSchema(serialLetters).omit({ id: true, createdAt: true });
export type InsertSerialLetter = z.infer<typeof insertSerialLetterSchema>;
export type SerialLetter = typeof serialLetters.$inferSelect;

// ====== VERWALTUNGSVERTRÄGE (MANAGEMENT CONTRACTS) ======
export const managementContracts = pgTable("management_contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  ownerName: text("owner_name"),
  contractType: text("contract_type").default('hausverwaltung'),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  autoRenew: boolean("auto_renew").default(true),
  renewalMonths: integer("renewal_months").default(12),
  noticePeriodMonths: integer("notice_period_months").default(3),
  noticeDeadline: text("notice_deadline"),
  monthlyFee: numeric("monthly_fee", { precision: 10, scale: 2 }),
  feeType: text("fee_type").default('pro_einheit'),
  notes: text("notes"),
  documentUrl: text("document_url"),
  status: text("status").default('aktiv'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertManagementContractSchema = createInsertSchema(managementContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertManagementContract = z.infer<typeof insertManagementContractSchema>;
export type ManagementContract = typeof managementContracts.$inferSelect;

// ====== HEIZKOSTENABLESUNGEN (HEATING COST READINGS) ======
export const heatingCostReadings = pgTable("heating_cost_readings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  consumption: numeric("consumption", { precision: 12, scale: 4 }).default('0'),
  consumptionUnit: text("consumption_unit").default('kWh'),
  costShare: numeric("cost_share", { precision: 12, scale: 2 }).default('0'),
  source: text("source").default('manual'),
  provider: text("provider"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertHeatingCostReadingSchema = createInsertSchema(heatingCostReadings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHeatingCostReading = z.infer<typeof insertHeatingCostReadingSchema>;
export type HeatingCostReading = typeof heatingCostReadings.$inferSelect;

// ====== EIGENTÜMER-AUSZAHLUNGEN (OWNER PAYOUTS) ======
export const ownerPayouts = pgTable("owner_payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  ownerId: uuid("owner_id").references(() => propertyOwners.id).notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  totalIncome: numeric("total_income", { precision: 12, scale: 2 }).default('0'),
  totalExpenses: numeric("total_expenses", { precision: 12, scale: 2 }).default('0'),
  managementFee: numeric("management_fee", { precision: 12, scale: 2 }).default('0'),
  netPayout: numeric("net_payout", { precision: 12, scale: 2 }).default('0'),
  status: text("status").default('entwurf'),
  pdfUrl: text("pdf_url"),
  sepaExportedAt: timestamp("sepa_exported_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertOwnerPayoutSchema = createInsertSchema(ownerPayouts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOwnerPayout = z.infer<typeof insertOwnerPayoutSchema>;
export type OwnerPayout = typeof ownerPayouts.$inferSelect;

// ====== BENUTZER-ORGANISATIONEN (USER ORGANIZATIONS) ======
export const userOrganizations = pgTable("user_organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  role: text("role").default('viewer'),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertUserOrganizationSchema = createInsertSchema(userOrganizations).omit({ id: true, createdAt: true });
export type InsertUserOrganization = z.infer<typeof insertUserOrganizationSchema>;
export type UserOrganization = typeof userOrganizations.$inferSelect;

// ====== MIETERPORTAL-ZUGANG (TENANT PORTAL ACCESS) ======
export const tenantPortalAccess = pgTable("tenant_portal_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  organizationId: uuid("organization_id"),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertTenantPortalAccessSchema = createInsertSchema(tenantPortalAccess).omit({ id: true, passwordHash: true, inviteToken: true, inviteExpiresAt: true, createdAt: true, updatedAt: true });
export type InsertTenantPortalAccess = z.infer<typeof insertTenantPortalAccessSchema>;
export type TenantPortalAccess = typeof tenantPortalAccess.$inferSelect;

// ====== EIGENTÜMERPORTAL-ZUGANG (OWNER PORTAL ACCESS) ======
export const ownerPortalAccess = pgTable("owner_portal_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => owners.id).notNull(),
  organizationId: uuid("organization_id"),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertOwnerPortalAccessSchema = createInsertSchema(ownerPortalAccess).omit({ id: true, passwordHash: true, inviteToken: true, inviteExpiresAt: true, createdAt: true, updatedAt: true });
export type InsertOwnerPortalAccess = z.infer<typeof insertOwnerPortalAccessSchema>;
export type OwnerPortalAccess = typeof ownerPortalAccess.$inferSelect;

export const jobQueue = pgTable("job_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 100 }).notNull(),
  payload: jsonb("payload").default('{}'),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  result: jsonb("result"),
  error: text("error"),
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  organizationId: uuid("organization_id"),
  createdBy: uuid("created_by"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_job_queue_status").on(table.status),
  index("idx_job_queue_org").on(table.organizationId),
]);

export const insertJobQueueSchema = createInsertSchema(jobQueue).omit({ id: true, createdAt: true });
export type JobQueue = typeof jobQueue.$inferSelect;
export type InsertJobQueue = typeof jobQueue.$inferInsert;

// ====== REPORT SCHEDULES (Geplante Berichte) ======
export const reportSchedules = pgTable("report_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  reportType: text("report_type").notNull(),
  schedule: text("schedule").notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  recipients: text("recipients").array().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertReportScheduleSchema = createInsertSchema(reportSchedules).omit({ id: true, createdAt: true, lastRun: true, nextRun: true });
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type InsertReportSchedule = z.infer<typeof insertReportScheduleSchema>;

export const reconcileRuns = pgTable("reconcile_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: text("run_id").notNull().unique(),
  type: text("type").notNull().default("batch_upsert"),
  status: text("status").notNull().default("started"),
  inserted: integer("inserted").default(0),
  updated: integer("updated").default(0),
  skipped: integer("skipped").default(0),
  errors: integer("errors").default(0),
  totalRows: integer("total_rows").default(0),
  error: text("error"),
  meta: jsonb("meta"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_reconcile_runs_run_id").on(table.runId),
  index("idx_reconcile_runs_status").on(table.status),
]);

export const insertReconcileRunSchema = createInsertSchema(reconcileRuns).omit({ id: true, createdAt: true });
export type ReconcileRun = typeof reconcileRuns.$inferSelect;
export type InsertReconcileRun = typeof reconcileRuns.$inferInsert;

// ====== DSGVO CONSENT RECORDS ======
export const consentRecords = pgTable("consent_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  consentType: text("consent_type").notNull(),
  consentVersion: text("consent_version").notNull().default('1.0'),
  granted: boolean("granted").notNull().default(false),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  legalBasis: text("legal_basis"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_consent_user").on(table.userId),
  index("idx_consent_type").on(table.consentType),
]);

export const insertConsentRecordSchema = createInsertSchema(consentRecords).omit({ id: true, createdAt: true });
export type InsertConsentRecord = z.infer<typeof insertConsentRecordSchema>;
export type ConsentRecord = typeof consentRecords.$inferSelect;

// ====== DSGVO ART. 30 - VERARBEITUNGSTÄTIGKEITEN ======
export const processingActivities = pgTable("processing_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  purpose: text("purpose").notNull(),
  legalBasis: text("legal_basis").notNull(),
  dataCategories: text("data_categories").array().notNull(),
  dataSubjects: text("data_subjects").array().notNull(),
  recipients: text("recipients").array(),
  thirdCountryTransfer: boolean("third_country_transfer").default(false),
  transferSafeguards: text("transfer_safeguards"),
  retentionPeriod: text("retention_period").notNull(),
  technicalMeasures: text("technical_measures").array(),
  organizationalMeasures: text("organizational_measures").array(),
  responsiblePerson: text("responsible_person"),
  dpiaConducted: boolean("dpia_conducted").default(false),
  dpiaDate: date("dpia_date"),
  isActive: boolean("is_active").default(true),
  lastReviewDate: date("last_review_date"),
  nextReviewDate: date("next_review_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertProcessingActivitySchema = createInsertSchema(processingActivities).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProcessingActivity = z.infer<typeof insertProcessingActivitySchema>;
export type ProcessingActivity = typeof processingActivities.$inferSelect;

// ====== LÖSCHFRISTEN / DATA RETENTION POLICIES ======
export const dataRetentionPolicies = pgTable("data_retention_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  dataCategory: text("data_category").notNull(),
  retentionDays: integer("retention_days").notNull(),
  legalBasis: text("legal_basis").notNull(),
  autoDelete: boolean("auto_delete").default(false),
  notifyBeforeDays: integer("notify_before_days").default(30),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertDataRetentionPolicySchema = createInsertSchema(dataRetentionPolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDataRetentionPolicy = z.infer<typeof insertDataRetentionPolicySchema>;
export type DataRetentionPolicy = typeof dataRetentionPolicies.$inferSelect;

// ====== SECURITY SESSIONS (Enhanced Tracking) ======
export const securitySessions = pgTable("security_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id).notNull(),
  sessionId: text("session_id").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  location: text("location"),
  isActive: boolean("is_active").default(true),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_security_sessions_user").on(table.userId),
  index("idx_security_sessions_active").on(table.isActive),
]);

export const insertSecuritySessionSchema = createInsertSchema(securitySessions).omit({ id: true, createdAt: true });
export type InsertSecuritySession = z.infer<typeof insertSecuritySessionSchema>;
export type SecuritySession = typeof securitySessions.$inferSelect;

// ====== SUPPORT TICKETS ======
export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  unitId: uuid("unit_id").references(() => units.id),
  propertyId: uuid("property_id").references(() => properties.id),
  createdById: uuid("created_by_id").references(() => profiles.id),
  assignedToId: uuid("assigned_to_id").references(() => profiles.id),
  ticketNumber: text("ticket_number").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull().default('normal'),
  status: text("status").notNull().default('offen'),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  dueDate: date("due_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_tickets_org").on(table.organizationId),
  index("idx_tickets_status").on(table.status),
  index("idx_tickets_tenant").on(table.tenantId),
]);

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

// ====== TICKET COMMENTS ======
export const ticketComments = pgTable("ticket_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id").references(() => supportTickets.id).notNull(),
  authorId: uuid("author_id").references(() => profiles.id),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({ id: true, createdAt: true });
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;

// ====== ESG / ENERGIEMONITORING ======
export const energyCertificates = pgTable("energy_certificates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  certificateType: text("certificate_type").notNull(),
  energyClass: text("energy_class"),
  heatingDemand: numeric("heating_demand"),
  primaryEnergyDemand: numeric("primary_energy_demand"),
  co2Emissions: numeric("co2_emissions"),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  issuer: text("issuer"),
  certificateNumber: text("certificate_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_energy_certs_property").on(table.propertyId),
  index("idx_energy_certs_org").on(table.organizationId),
]);

export const insertEnergyCertificateSchema = createInsertSchema(energyCertificates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyCertificate = z.infer<typeof insertEnergyCertificateSchema>;
export type EnergyCertificate = typeof energyCertificates.$inferSelect;

export const energyConsumption = pgTable("energy_consumption", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id),
  year: integer("year").notNull(),
  month: integer("month"),
  energyType: text("energy_type").notNull(),
  consumption: numeric("consumption").notNull(),
  unit: text("unit").notNull(),
  costEur: numeric("cost_eur", { precision: 12, scale: 2 }),
  co2Kg: numeric("co2_kg"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_energy_consumption_property").on(table.propertyId),
  index("idx_energy_consumption_year").on(table.year),
]);

export const insertEnergyConsumptionSchema = createInsertSchema(energyConsumption).omit({ id: true, createdAt: true });
export type InsertEnergyConsumption = z.infer<typeof insertEnergyConsumptionSchema>;
export type EnergyConsumption = typeof energyConsumption.$inferSelect;

// ====== SCHADENSMELDUNGEN (Mieter-Self-Service) ======
export const damageReports = pgTable("damage_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  propertyId: uuid("property_id").references(() => properties.id),
  unitId: uuid("unit_id").references(() => units.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  reportedById: uuid("reported_by_id").references(() => profiles.id),
  reportNumber: text("report_number").notNull(),
  category: text("category").notNull(),
  urgency: text("urgency").notNull().default('normal'),
  status: text("status").notNull().default('gemeldet'),
  title: text("title").notNull(),
  description: text("description").notNull(),
  location: text("location"),
  photoUrls: text("photo_urls").array(),
  assignedToId: uuid("assigned_to_id").references(() => profiles.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  costEstimate: numeric("cost_estimate", { precision: 12, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_damage_reports_org").on(table.organizationId),
  index("idx_damage_reports_property").on(table.propertyId),
  index("idx_damage_reports_tenant").on(table.tenantId),
  index("idx_damage_reports_status").on(table.status),
]);

export const insertDamageReportSchema = createInsertSchema(damageReports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDamageReport = z.infer<typeof insertDamageReportSchema>;
export type DamageReport = typeof damageReports.$inferSelect;

// ====== GUIDED WORKFLOWS ======
export const guidedWorkflows = pgTable("guided_workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  userId: uuid("user_id").references(() => profiles.id),
  workflowType: text("workflow_type").notNull(),
  currentStep: integer("current_step").notNull().default(1),
  totalSteps: integer("total_steps").notNull(),
  stepData: jsonb("step_data").default('{}'),
  status: text("status").notNull().default('in_progress'),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_workflows_org").on(table.organizationId),
  index("idx_workflows_user").on(table.userId),
]);

// ====== AUTOMATION SETTINGS (KI-Autopilot) ======
export const automationSettings = pgTable("automation_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  autoInvoicingEnabled: boolean("auto_invoicing_enabled").default(false),
  invoicingDayOfMonth: integer("invoicing_day_of_month").default(1),
  autoInvoicingEmail: boolean("auto_invoicing_email").default(true),
  autoSepaGeneration: boolean("auto_sepa_generation").default(false),
  autoDunningEnabled: boolean("auto_dunning_enabled").default(false),
  dunningDays1: integer("dunning_days_1").default(14),
  dunningDays2: integer("dunning_days_2").default(28),
  dunningDays3: integer("dunning_days_3").default(42),
  autoDunningEmail: boolean("auto_dunning_email").default(true),
  dunningInterestRate: text("dunning_interest_rate").default("4.00"),
  lastInvoicingRun: timestamp("last_invoicing_run", { withTimezone: true }),
  lastDunningRun: timestamp("last_dunning_run", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertAutomationSettingsSchema = createInsertSchema(automationSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutomationSettings = z.infer<typeof insertAutomationSettingsSchema>;
export type AutomationSettings = typeof automationSettings.$inferSelect;

// ====== AUTOMATION LOG (KI-Autopilot) ======
export const automationLog = pgTable("automation_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  details: text("details"),
  itemsProcessed: integer("items_processed").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertAutomationLogSchema = createInsertSchema(automationLog).omit({ id: true, createdAt: true });
export type InsertAutomationLog = z.infer<typeof insertAutomationLogSchema>;
export type AutomationLog = typeof automationLog.$inferSelect;

// ====== DOPPELTE BUCHFÜHRUNG / DOUBLE-ENTRY ACCOUNTING ======

export const accountTypeEnum = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  accountNumber: text("account_number").notNull(),
  name: text("name").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  description: text("description"),
  parentId: uuid("parent_id"),
  isActive: boolean("is_active").default(true).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertChartOfAccountsSchema = createInsertSchema(chartOfAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChartOfAccounts = z.infer<typeof insertChartOfAccountsSchema>;
export type ChartOfAccounts = typeof chartOfAccounts.$inferSelect;

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  bookingNumber: text("booking_number").notNull(),
  entryDate: date("entry_date").notNull(),
  description: text("description").notNull(),
  belegNummer: text("beleg_nummer"),
  belegUrl: text("beleg_url"),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  propertyId: uuid("property_id").references(() => properties.id),
  unitId: uuid("unit_id").references(() => units.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  isStorno: boolean("is_storno").default(false).notNull(),
  stornoOf: uuid("storno_of"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertJournalEntriesSchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJournalEntries = z.infer<typeof insertJournalEntriesSchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id).notNull(),
  accountId: uuid("account_id").references(() => chartOfAccounts.id).notNull(),
  debit: numeric("debit", { precision: 12, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 12, scale: 2 }).default("0").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertJournalEntryLinesSchema = createInsertSchema(journalEntryLines).omit({ id: true, createdAt: true });
export type InsertJournalEntryLines = z.infer<typeof insertJournalEntryLinesSchema>;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;

export const bookingNumberSequences = pgTable("booking_number_sequences", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  currentYear: integer("current_year").notNull(),
  currentNumber: integer("current_number").default(0).notNull(),
});

export const insertBookingNumberSequencesSchema = createInsertSchema(bookingNumberSequences).omit({ id: true });
export type InsertBookingNumberSequences = z.infer<typeof insertBookingNumberSequencesSchema>;
export type BookingNumberSequence = typeof bookingNumberSequences.$inferSelect;

// ====== EBICS LIVE-BANKING ======

export const ebicsConnections = pgTable("ebics_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  bankName: text("bank_name").notNull(),
  hostId: text("host_id").notNull(),
  hostUrl: text("host_url").notNull(),
  partnerId: text("partner_id").notNull(),
  userId: text("user_id").notNull(),
  iban: text("iban").notNull(),
  bic: text("bic"),
  status: text("status").default("pending").notNull(),
  keyInitialized: boolean("key_initialized").default(false).notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  encryptedKeys: text("encrypted_keys"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEbicsConnectionsSchema = createInsertSchema(ebicsConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEbicsConnection = z.infer<typeof insertEbicsConnectionsSchema>;
export type EbicsConnection = typeof ebicsConnections.$inferSelect;

export const ebicsOrders = pgTable("ebics_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectionId: uuid("connection_id").references(() => ebicsConnections.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  orderType: text("order_type").notNull(),
  orderStatus: text("order_status").default("pending").notNull(),
  requestData: text("request_data"),
  responseData: text("response_data"),
  errorMessage: text("error_message"),
  transactionCount: integer("transaction_count").default(0),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertEbicsOrdersSchema = createInsertSchema(ebicsOrders).omit({ id: true, createdAt: true, completedAt: true });
export type InsertEbicsOrder = z.infer<typeof insertEbicsOrdersSchema>;
export type EbicsOrder = typeof ebicsOrders.$inferSelect;

export const ebicsPaymentBatches = pgTable("ebics_payment_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  connectionId: uuid("connection_id").references(() => ebicsConnections.id).notNull(),
  batchType: text("batch_type").notNull(),
  status: text("status").default("draft").notNull(),
  paymentCount: integer("payment_count").default(0).notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).default("0").notNull(),
  sepaXml: text("sepa_xml"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEbicsPaymentBatchesSchema = createInsertSchema(ebicsPaymentBatches).omit({ id: true, createdAt: true, submittedAt: true, completedAt: true });
export type InsertEbicsPaymentBatch = z.infer<typeof insertEbicsPaymentBatchesSchema>;
export type EbicsPaymentBatch = typeof ebicsPaymentBatches.$inferSelect;

// ====== FISCAL PERIODS (Geschäftsjahre/Perioden) ======
export const fiscalPeriodStatusEnum = pgEnum('fiscal_period_status', ['open', 'in_review', 'closed']);

export const fiscalPeriods = pgTable("fiscal_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  year: integer("year").notNull(),
  status: fiscalPeriodStatusEnum("status").default('open').notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: text("closed_by"),
  depreciationBooked: boolean("depreciation_booked").default(false).notNull(),
  accrualsReviewed: boolean("accruals_reviewed").default(false).notNull(),
  balanceReviewed: boolean("balance_reviewed").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertFiscalPeriodSchema = createInsertSchema(fiscalPeriods).omit({ id: true, createdAt: true, updatedAt: true, closedAt: true });
export type InsertFiscalPeriod = z.infer<typeof insertFiscalPeriodSchema>;
export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;

// ====== DEPRECIATION ASSETS (Anlagevermögen/AfA) ======
export const depreciationAssets = pgTable("depreciation_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  name: text("name").notNull(),
  description: text("description"),
  acquisitionDate: date("acquisition_date").notNull(),
  acquisitionCost: numeric("acquisition_cost", { precision: 12, scale: 2 }).notNull(),
  usefulLifeYears: integer("useful_life_years").notNull(),
  depreciationRate: numeric("depreciation_rate", { precision: 5, scale: 2 }).notNull(),
  accumulatedDepreciation: numeric("accumulated_depreciation", { precision: 12, scale: 2 }).default('0').notNull(),
  bookValue: numeric("book_value", { precision: 12, scale: 2 }).notNull(),
  accountId: uuid("account_id").references(() => chartOfAccounts.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDepreciationAssetSchema = createInsertSchema(depreciationAssets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDepreciationAsset = z.infer<typeof insertDepreciationAssetSchema>;
export type DepreciationAsset = typeof depreciationAssets.$inferSelect;

// ====== DOCUMENT VERSIONING & TAGGING ======

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: text("document_id").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  versionNumber: integer("version_number").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storagePath: text("storage_path").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({ id: true, createdAt: true });
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type DocumentVersion = typeof documentVersions.$inferSelect;

export const documentTags = pgTable("document_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertDocumentTagSchema = createInsertSchema(documentTags).omit({ id: true, createdAt: true });
export type InsertDocumentTag = z.infer<typeof insertDocumentTagSchema>;
export type DocumentTag = typeof documentTags.$inferSelect;

export const documentTagAssignments = pgTable("document_tag_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: text("document_id").notNull(),
  tagId: uuid("tag_id").references(() => documentTags.id).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertDocumentTagAssignmentSchema = createInsertSchema(documentTagAssignments).omit({ id: true, createdAt: true });
export type InsertDocumentTagAssignment = z.infer<typeof insertDocumentTagAssignmentSchema>;
export type DocumentTagAssignment = typeof documentTagAssignments.$inferSelect;

// ====== ELECTRONIC SIGNATURES (eIDAS-conformant) ======
export const signatureRequests = pgTable("signature_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  documentId: text("document_id").notNull(),
  documentName: text("document_name").notNull(),
  requestedBy: uuid("requested_by").references(() => profiles.id),
  status: text("status").default('pending'),
  signatureType: text("signature_type").default('simple'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const insertSignatureRequestSchema = createInsertSchema(signatureRequests).omit({ id: true, createdAt: true });
export type InsertSignatureRequest = z.infer<typeof insertSignatureRequestSchema>;
export type SignatureRequest = typeof signatureRequests.$inferSelect;

export const signatures = pgTable("signatures", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").references(() => signatureRequests.id).notNull(),
  signerId: uuid("signer_id").references(() => profiles.id),
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  signatureHash: text("signature_hash"),
  signatureData: text("signature_data"),
  verificationCode: text("verification_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertSignatureSchema = createInsertSchema(signatures).omit({ id: true, createdAt: true });
export type InsertSignature = z.infer<typeof insertSignatureSchema>;
export type Signature = typeof signatures.$inferSelect;

// ====== SAVED REPORTS (Query Builder) ======
export const savedReports = pgTable("saved_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  reportConfig: jsonb("report_config").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  isShared: boolean("is_shared").default(false),
  lastRun: timestamp("last_run", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertSavedReportSchema = createInsertSchema(savedReports).omit({ id: true, createdAt: true, updatedAt: true, lastRun: true });
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;
export type SavedReport = typeof savedReports.$inferSelect;

// ====== AUTOMATION RULES (Rules Engine) ======
export const automationRules = pgTable("automation_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull(),
  conditions: jsonb("conditions"),
  actions: jsonb("actions"),
  isActive: boolean("is_active").default(false),
  lastRun: timestamp("last_run", { withTimezone: true }),
  runCount: integer("run_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({ id: true, createdAt: true, updatedAt: true, lastRun: true, runCount: true });
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRules.$inferSelect;

// ====== AUTOMATION RULE LOGS ======
export const automationRuleLogs = pgTable("automation_rule_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ruleId: uuid("rule_id").references(() => automationRules.id).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  isDryRun: boolean("is_dry_run").notNull().default(false),
  triggerData: jsonb("trigger_data"),
  matchedItems: integer("matched_items"),
  actionsPreview: jsonb("actions_preview"),
  actionsExecuted: jsonb("actions_executed"),
  status: text("status"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertAutomationRuleLogSchema = createInsertSchema(automationRuleLogs).omit({ id: true, createdAt: true });
export type InsertAutomationRuleLog = z.infer<typeof insertAutomationRuleLogSchema>;
export type AutomationRuleLog = typeof automationRuleLogs.$inferSelect;

export const eaBookingTypeEnum = pgEnum('ea_booking_type', ['einnahme', 'ausgabe']);

export const eaBookings = pgTable("ea_bookings", {
  id: serial("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  type: eaBookingTypeEnum("type").notNull(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).default('20'),
  netAmount: numeric("net_amount", { precision: 10, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }),
  documentRef: text("document_ref"),
  belegNummer: text("beleg_nummer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertEaBookingSchema = createInsertSchema(eaBookings).omit({ id: true, createdAt: true });
export type InsertEaBooking = z.infer<typeof insertEaBookingSchema>;
export type EaBooking = typeof eaBookings.$inferSelect;

export const heatingSettlementStatusEnum = pgEnum('heating_settlement_status', ['entwurf', 'berechnet', 'versendet', 'abgeschlossen']);

export const heatingSettlements = pgTable("heating_settlements", {
  id: serial("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }).notNull(),
  fixedCostShare: numeric("fixed_cost_share", { precision: 5, scale: 2 }).default('45'),
  variableCostShare: numeric("variable_cost_share", { precision: 5, scale: 2 }).default('55'),
  status: heatingSettlementStatusEnum("status").default('entwurf'),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const heatingSettlementDetails = pgTable("heating_settlement_details", {
  id: serial("id").primaryKey(),
  settlementId: integer("settlement_id").references(() => heatingSettlements.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  tenantName: text("tenant_name"),
  area: numeric("area", { precision: 10, scale: 2 }).notNull(),
  consumption: numeric("consumption", { precision: 10, scale: 2 }).notNull(),
  fixedAmount: numeric("fixed_amount", { precision: 10, scale: 2 }).notNull(),
  variableAmount: numeric("variable_amount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  prepayment: numeric("prepayment", { precision: 10, scale: 2 }).default('0'),
  balance: numeric("balance", { precision: 10, scale: 2 }),
});

export const insertHeatingSettlementSchema = createInsertSchema(heatingSettlements).omit({ id: true, createdAt: true });
export type InsertHeatingSettlement = z.infer<typeof insertHeatingSettlementSchema>;
export type HeatingSettlement = typeof heatingSettlements.$inferSelect;
export type HeatingSettlementDetail = typeof heatingSettlementDetails.$inferSelect;

export const heatBillingStatusEnum = pgEnum('heat_billing_status', ['entwurf', 'berechnet', 'geprueft', 'versendet', 'storniert']);
export const heatMeterTypeEnum = pgEnum('heat_meter_type', ['hkv', 'waermemengenzaehler', 'warmwasserzaehler']);

export const heatBillingRuns = pgTable("heat_billing_runs", {
  id: serial("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  status: heatBillingStatusEnum("status").default('entwurf'),
  version: integer("version").default(1),
  parentRunId: integer("parent_run_id"),

  heatingSupplyCost: numeric("heating_supply_cost", { precision: 12, scale: 2 }).notNull(),
  hotWaterSupplyCost: numeric("hot_water_supply_cost", { precision: 12, scale: 2 }).default('0'),
  maintenanceCost: numeric("maintenance_cost", { precision: 12, scale: 2 }).default('0'),
  meterReadingCost: numeric("meter_reading_cost", { precision: 12, scale: 2 }).default('0'),

  heatingConsumptionSharePct: numeric("heating_consumption_share_pct", { precision: 5, scale: 2 }).default('65'),
  heatingAreaSharePct: numeric("heating_area_share_pct", { precision: 5, scale: 2 }).default('35'),
  hotWaterConsumptionSharePct: numeric("hot_water_consumption_share_pct", { precision: 5, scale: 2 }).default('65'),
  hotWaterAreaSharePct: numeric("hot_water_area_share_pct", { precision: 5, scale: 2 }).default('35'),

  roundingMethod: text("rounding_method").default('kaufmaennisch'),
  restCentRule: text("rest_cent_rule").default('assign_to_largest_share'),

  totalDistributed: numeric("total_distributed", { precision: 12, scale: 2 }),
  trialBalanceDiff: numeric("trial_balance_diff", { precision: 12, scale: 4 }),

  complianceCheckResult: jsonb("compliance_check_result"),
  warnings: jsonb("warnings"),

  computedAt: timestamp("computed_at", { withTimezone: true }),
  computedBy: text("computed_by"),
  stornoReason: text("storno_reason"),
  stornoAt: timestamp("storno_at", { withTimezone: true }),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const heatBillingLines = pgTable("heat_billing_lines", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => heatBillingRuns.id).notNull(),
  unitId: uuid("unit_id").references(() => units.id).notNull(),
  tenantName: text("tenant_name"),

  areaM2: numeric("area_m2", { precision: 10, scale: 2 }).notNull(),
  mea: numeric("mea", { precision: 10, scale: 6 }),
  occupancy: integer("occupancy").default(1),

  heatingMeterType: heatMeterTypeEnum("heating_meter_type"),
  heatingMeterValue: numeric("heating_meter_value", { precision: 12, scale: 4 }),
  heatingMeterMissing: boolean("heating_meter_missing").default(false),

  hotWaterMeterValue: numeric("hot_water_meter_value", { precision: 12, scale: 4 }),
  hotWaterMeterMissing: boolean("hot_water_meter_missing").default(false),

  heatingConsumptionShare: numeric("heating_consumption_share", { precision: 12, scale: 2 }),
  heatingAreaShare: numeric("heating_area_share", { precision: 12, scale: 2 }),
  heatingTotal: numeric("heating_total", { precision: 12, scale: 2 }),

  hotWaterConsumptionShare: numeric("hot_water_consumption_share", { precision: 12, scale: 2 }),
  hotWaterAreaShare: numeric("hot_water_area_share", { precision: 12, scale: 2 }),
  hotWaterTotal: numeric("hot_water_total", { precision: 12, scale: 2 }),

  maintenanceShare: numeric("maintenance_share", { precision: 12, scale: 2 }),
  meterReadingShare: numeric("meter_reading_share", { precision: 12, scale: 2 }),

  totalCost: numeric("total_cost", { precision: 12, scale: 2 }),
  prepayment: numeric("prepayment", { precision: 12, scale: 2 }).default('0'),
  balance: numeric("balance", { precision: 12, scale: 2 }),

  isEstimated: boolean("is_estimated").default(false),
  estimationReason: text("estimation_reason"),
  plausibilityFlags: jsonb("plausibility_flags"),
});

export const heatBillingAuditLog = pgTable("heat_billing_audit_log", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => heatBillingRuns.id).notNull(),
  action: text("action").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertHeatBillingRunSchema = createInsertSchema(heatBillingRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHeatBillingRun = z.infer<typeof insertHeatBillingRunSchema>;
export type HeatBillingRun = typeof heatBillingRuns.$inferSelect;
export type HeatBillingLine = typeof heatBillingLines.$inferSelect;
export type HeatBillingAuditEntry = typeof heatBillingAuditLog.$inferSelect;

export const activityTypeEnum = pgEnum('activity_type', ['anruf', 'email', 'notiz', 'meeting', 'brief', 'besichtigung', 'wartung']);

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  propertyId: uuid("property_id").references(() => properties.id),
  unitId: uuid("unit_id").references(() => units.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  type: activityTypeEnum("type").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  contactPerson: text("contact_person"),
  createdBy: text("created_by"),
  dueDate: date("due_date"),
  completed: boolean("completed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// ====== AUTH TOKENS (Audit-Befund K3) ======
// Wurde von server/auth.ts und twoFactorRoutes.ts benutzt, fehlte aber im
// Schema und in allen Migrationen. Siehe migrations/20260815_audit_repair.sql.

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAuthTokenSchema = createInsertSchema(authTokens).omit({ id: true, createdAt: true });
export type InsertAuthToken = z.infer<typeof insertAuthTokenSchema>;
export type AuthToken = typeof authTokens.$inferSelect;

// ====== PERIODENSPERREN (Audit-Befund K6/M4) ======

export const periodLocks = pgTable("period_locks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  lockedBy: uuid("locked_by").notNull(),
});

export const insertPeriodLockSchema = createInsertSchema(periodLocks).omit({ id: true, lockedAt: true });
export type InsertPeriodLock = z.infer<typeof insertPeriodLockSchema>;
export type PeriodLock = typeof periodLocks.$inferSelect;
