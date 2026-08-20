import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, rootDb, withOrgContext } from "./db";
import { encryptField, decryptIbanRows, decryptIbanFields } from "./lib/fieldEncryption";
import { parseMoneyInput } from "./lib/money";
import { eq, and, sql, desc, asc, count, sum, or, isNull, gte, lte, inArray, ne, ilike } from "drizzle-orm";
import * as schema from "@shared/schema";
import { roundMoney } from "@shared/utils";
import { isAuthenticated, requireRole, requireMutationAccess, requireFinanceAccess, requireAdminAccess, getUserRoles, getProfileFromSession, isTester, maskPersonalData } from "./routes/helpers";
import { registerFunctionRoutes } from "./functions";
import { registerStripeRoutes } from "./stripeRoutes";
import { jobQueueService } from "./services/jobQueueService";
import { apiErrorHandler as globalErrorHandler } from "./lib/apiErrors";
import multer from "multer";
import OpenAI from "openai";
import propertyRoutes from "./routes/propertyRoutes";
import tenantRoutes from "./routes/tenantRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import accountingRoutes from "./routes/accountingRoutes";
import ebicsRoutes from "./routes/ebicsRoutes";
import openItemsRoutes from "./routes/openItemsRoutes";
import fiscalYearRoutes from "./routes/fiscalYearRoutes";
import searchRoutes from "./routes/searchRoutes";
import bulkRoutes from "./routes/bulkRoutes";
import kautionRoutes from "./routes/kautionRoutes";
import wegReportRoutes from "./routes/wegReportRoutes";
import eaRechnungRoutes from "./routes/eaRechnungRoutes";
import heatingSettlementRoutes from "./routes/heatingSettlementRoutes";
import heatBillingRoutes from "./routes/heatBillingRoutes";
import richtwertRoutes from "./routes/richtwertRoutes";
import activityRoutes from "./routes/activityRoutes";
import incomingInvoiceRoutes from "./routes/incomingInvoiceRoutes";
import featureRoutes from "./routes/featureRoutes";
import { registerPushRoutes } from "./routes/pushRoutes";
import * as demoService from "./services/demoService";
import { registerScheduledReportRoutes } from "./routes/scheduledReportRoutes";
import { registerDocumentRoutes } from "./routes/documentRoutes";
import { registerAutomationRoutes } from "./routes/automationRoutes";
import { registerTwoFactorRoutes } from "./routes/twoFactorRoutes";
import { invalidateUserSessions } from "./lib/sessionInvalidation";
import { snakeToCamel } from "./routes/helpers";
import { registerSignatureRoutes } from "./routes/signatureRoutes";
import { registerQueryBuilderRoutes } from "./routes/queryBuilderRoutes";
import ocrRoutes from "./routes/ocrRoutes";
import readonlyRouter from "./routes/readonly";
import vpiCrudRouter from "./routes/vpiRoutes";
import leaseExpiryRouter from "./routes/leaseExpiryRoutes";
import { sendLeaseExpiryNotifications } from "./services/leaseExpiryService";
import { reportSchedules, organizations as orgsTable } from "@shared/schema";
import { sendScheduledReport, parseNextRun } from "./services/scheduledReportsService";
import { automatedDunningService } from "./services/automatedDunningService";
import { getDunningChargesByInvoice, getOutstandingInvoiceAmount } from "./services/invoiceTotalsService";

async function getDunningSurchargeMap(invoiceIds: string[]): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await db.select({
    invoiceId: schema.invoiceLines.invoiceId,
    amount: sum(schema.invoiceLines.amount),
  })
    .from(schema.invoiceLines)
    .where(and(
      inArray(schema.invoiceLines.invoiceId, invoiceIds),
      inArray(schema.invoiceLines.lineType, ['mahnstufe_fee', 'verzugszinsen']),
    ))
    .groupBy(schema.invoiceLines.invoiceId);

  return new Map(rows.map((row) => [row.invoiceId, roundMoney(Number(row.amount) || 0)]));
}

// Runs hourly; the dedup table in lease_expiry_notifications prevents double-sends.
function startLeaseExpiryChecker() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    try {
      await sendLeaseExpiryNotifications();
    } catch (err) {
      console.error('[LeaseExpiry] Checker error:', err);
    }
  }, INTERVAL_MS);
  console.log('[LeaseExpiry] Checker started (every 60 min)');
}

function startScheduledReportChecker() {
  const INTERVAL_MS = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const now = new Date();
      // rootDb reads organizations (excluded from RLS) without org context.
      // For each org we then use withOrgContext so report_schedules — an
      // org-scoped table — is visible under the correct app.current_org.
      const allOrgs = await rootDb
        .select({ id: orgsTable.id })
        .from(orgsTable);

      for (const org of allOrgs) {
        try {
          await withOrgContext(org.id, async () => {
            const dueSchedules = await db.select().from(reportSchedules)
              .where(and(
                eq(reportSchedules.isActive, true),
                lte(reportSchedules.nextRun, now)
              ));

            for (const schedule of dueSchedules) {
              try {
                await sendScheduledReport(
                  schedule.organizationId,
                  schedule.reportType,
                  schedule.recipients,
                  schedule.propertyId || undefined
                );
                const nextRun = parseNextRun(schedule.schedule, now);
                await db.update(reportSchedules)
                  .set({ lastRun: now, nextRun })
                  .where(and(
                    eq(reportSchedules.id, schedule.id),
                    eq(reportSchedules.organizationId, org.id)
                  ));
                console.log(`[ScheduledReports] Executed schedule ${schedule.id} (${schedule.reportType})`);
              } catch (err) {
                console.error(`[ScheduledReports] Error executing schedule ${schedule.id}:`, err);
              }
            }
          });
        } catch (err) {
          console.error(`[ScheduledReports] Error for org ${org.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[ScheduledReports] Checker error:', err);
    }
  }, INTERVAL_MS);
  console.log(`[ScheduledReports] Checker started (every ${INTERVAL_MS / 1000}s)`);
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(propertyRoutes);
  app.use(tenantRoutes);
  app.use(paymentRoutes);
  app.use(accountingRoutes);
  app.use(ebicsRoutes);
  app.use(openItemsRoutes);
  app.use(fiscalYearRoutes);
  app.use(searchRoutes);
  app.use(bulkRoutes);
  app.use(kautionRoutes);
  app.use(wegReportRoutes);
  app.use(eaRechnungRoutes);
  app.use(heatingSettlementRoutes);
  app.use(heatBillingRoutes);
  app.use(richtwertRoutes);
  app.use(incomingInvoiceRoutes);
  app.use(ocrRoutes);
  app.use('/api/readonly', readonlyRouter);
  app.use(activityRoutes);
  app.use(featureRoutes);
  registerPushRoutes(app);
  registerDocumentRoutes(app);
  registerAutomationRoutes(app);
  registerTwoFactorRoutes(app);
  registerSignatureRoutes(app);
  registerQueryBuilderRoutes(app);

  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const profile = await storage.getProfileById(userId);
      
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      const roles = await storage.getUserRoles(profile.id);
      res.json({ ...profile, roles: roles.map(r => r.role) });
    } catch (error) {
      console.error("Profile error:", error);
      res.status(500).json({ error: "Failed to get profile" });
    }
  });

  app.get("/api/user/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const profile = await storage.getProfileById(userId);
      
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      const tier = (profile as any).subscriptionTier || 'trial';
      const trialEndsAt = (profile as any).trialEndsAt;
      const subscriptionEndsAt = (profile as any).subscriptionEndsAt;
      
      const now = new Date();
      const trialDaysRemaining = trialEndsAt 
        ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      
      const isTrialExpired = tier === 'trial' && trialEndsAt ? new Date(trialEndsAt) < now : false;
      const isSubscriptionExpired = subscriptionEndsAt ? new Date(subscriptionEndsAt) < now : false;
      
      res.json({
        tier,
        trialEndsAt,
        subscriptionEndsAt,
        trialDaysRemaining,
        isTrialExpired,
        isSubscriptionExpired,
      });
    } catch (error) {
      console.error("Subscription error:", error);
      res.status(500).json({ error: "Failed to get subscription" });
    }
  });

  app.get("/api/profile/organization", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId;
      const profile = await storage.getProfileById(userId);
      
      if (!profile?.organizationId) {
        return res.json(null);
      }
      
      const org = await storage.getOrganization(profile.organizationId);
      res.json(org);
    } catch (error) {
      res.status(500).json({ error: "Failed to get organization" });
    }
  });

  app.post("/api/invites", isAuthenticated, requireAdminAccess(), async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const profile = await storage.getProfileByEmail(userEmail);
      
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization found" });
      }
      
      const roles = await storage.getUserRoles(profile.id);
      if (!roles.some(r => r.role === 'admin')) {
        return res.status(403).json({ error: "Only admins can send invites" });
      }
      
      const normalizedBody = snakeToCamel(req.body);
      const { email, role } = normalizedBody;
      
      if (!email || !role) {
        return res.status(400).json({ error: "Email and role are required" });
      }
      
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      const invite = await storage.createInvite({
        organizationId: profile.organizationId,
        email,
        role: role as any,
        token,
        expiresAt,
        invitedBy: profile.id,
      });
      
      const org = await storage.getOrganization(profile.organizationId);
      const inviteUrl = `${req.protocol}://${req.get('host')}/register?invite=${token}`;
      
      try {
        const { sendInviteEmail } = await import("./lib/resend");
        const emailResult = await sendInviteEmail({
          to: email,
          inviterName: profile.fullName || profile.email,
          organizationName: org?.name || 'ImmoFlowMe',
          role,
          inviteUrl,
        });
        console.log("Invite email sent successfully:", { to: email, inviteUrl, result: emailResult });
      } catch (emailError: any) {
        console.error("Email send error:", emailError?.message || emailError);
        console.error("Email error details:", JSON.stringify(emailError, null, 2));
      }
      
      res.json(invite);
    } catch (error) {
      console.error("Create invite error:", error);
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.get("/api/invites", isAuthenticated, async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const profile = await storage.getProfileByEmail(userEmail);
      
      if (!profile?.organizationId) {
        return res.json([]);
      }
      
      const invites = await storage.getInvitesByOrganization(profile.organizationId);
      res.json(invites);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invites" });
    }
  });

  // Unauthenticated bootstrap endpoint: no session/orgContext exists yet.
  // Must use rootDb directly — storage uses the orgContext-bound db proxy
  // which throws without an active org context.
  app.get("/api/invites/:token", async (req, res) => {
    try {
      const inviteRows = await rootDb
        .select()
        .from(schema.organizationInvites)
        .where(eq(schema.organizationInvites.token, req.params.token))
        .limit(1);
      const invite = inviteRows[0];

      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      if (invite.status !== 'pending') {
        return res.status(400).json({ error: "Invite is no longer valid" });
      }

      if (new Date(invite.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Invite has expired" });
      }

      const orgRows = await rootDb
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, invite.organizationId))
        .limit(1);
      const org = orgRows[0];
      res.json({ ...invite, organizationName: org?.name });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invite" });
    }
  });

  // Cross-org bootstrap: the invite target org may differ from the current
  // session org. Use rootDb so the lookup and profile updates are not
  // filtered by the session's orgContext.
  app.post("/api/invites/:token/accept", isAuthenticated, async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const inviteRows = await rootDb
        .select()
        .from(schema.organizationInvites)
        .where(eq(schema.organizationInvites.token, req.params.token))
        .limit(1);
      const invite = inviteRows[0];

      if (!invite || invite.status !== 'pending' || new Date(invite.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Invalid or expired invite" });
      }

      if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        return res.status(403).json({ error: "This invite is for a different email address" });
      }

      let profileRows = await rootDb
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.email, userEmail))
        .limit(1);
      let profile = profileRows[0] as typeof profileRows[0] | undefined;

      if (!profile) {
        const created = await rootDb
          .insert(schema.profiles)
          .values({ email: userEmail, fullName: userEmail, organizationId: invite.organizationId })
          .returning();
        profile = created[0];
      } else {
        await rootDb
          .update(schema.profiles)
          .set({ organizationId: invite.organizationId, updatedAt: new Date() })
          .where(eq(schema.profiles.id, profile.id));
        const refreshed = await rootDb
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.id, profile.id))
          .limit(1);
        profile = refreshed[0];
      }

      await rootDb
        .insert(schema.userRoles)
        .values({ userId: profile!.id, role: invite.role as any });

      await rootDb
        .update(schema.organizationInvites)
        .set({ status: 'accepted' as any, acceptedAt: new Date() })
        .where(eq(schema.organizationInvites.id, invite.id));

      res.json({ success: true, profile });
    } catch (error) {
      console.error("Accept invite error:", error);
      res.status(500).json({ error: "Failed to accept invite" });
    }
  });

  app.delete("/api/invites/:id", isAuthenticated, requireAdminAccess(), async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const profile = await storage.getProfileByEmail(userEmail);
      
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "No organization found" });
      }
      
      const roles = await storage.getUserRoles(profile.id);
      if (!roles.some(r => r.role === 'admin')) {
        return res.status(403).json({ error: "Only admins can delete invites" });
      }
      
      await storage.deleteInvite(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete invite error:", error);
      res.status(500).json({ error: "Failed to delete invite" });
    }
  });

  // Unauthenticated bootstrap endpoint: no session/orgContext exists yet.
  app.get("/api/invites/token/:token", async (req, res) => {
    try {
      const inviteRows = await rootDb
        .select()
        .from(schema.organizationInvites)
        .where(eq(schema.organizationInvites.token, req.params.token))
        .limit(1);
      const invite = inviteRows[0];

      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      if (invite.status !== 'pending') {
        return res.status(400).json({ error: "Invite is no longer valid" });
      }

      if (new Date(invite.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Invite has expired" });
      }

      const orgRows = await rootDb
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, invite.organizationId))
        .limit(1);
      const org = orgRows[0];
      res.json({ ...invite, organizationName: org?.name });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invite" });
    }
  });

  app.get("/api/organization/members", isAuthenticated, async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const profile = await storage.getProfileByEmail(userEmail);
      
      if (!profile?.organizationId) {
        return res.json([]);
      }
      
      const members = await storage.getProfilesByOrganization(profile.organizationId);
      
      const membersWithRoles = await Promise.all(
        members.map(async (member) => {
          const memberRoles = await storage.getUserRoles(member.id);
          return { ...member, roles: memberRoles.map(r => r.role) };
        })
      );
      
      const userRoles = await getUserRoles(req);
      res.json(isTester(userRoles) ? maskPersonalData(membersWithRoles) : membersWithRoles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch members" });
    }
  });

  app.post("/api/organization/members/:memberId/roles", isAuthenticated, requireAdminAccess(), async (req: any, res) => {
    try {
      const userEmail = req.session?.email;
      const profile = await storage.getProfileByEmail(userEmail);
      
      const roles = await storage.getUserRoles(profile!.id);
      if (!roles.some(r => r.role === 'admin')) {
        return res.status(403).json({ error: "Only admins can manage roles" });
      }
      
      const normalizedBody = snakeToCamel(req.body);
      const { role, action } = normalizedBody;
      const memberId = req.params.memberId;
      
      if (action === 'add') {
        await storage.addUserRole(memberId, role);
      } else if (action === 'remove') {
        await storage.removeUserRole(memberId, role);
      }

      // Rollenänderung ist sicherheitsrelevant: alle Sitzungen und Tokens des
      // betroffenen Nutzers sofort invalidieren (2FA-Pflicht/Berechtigungen
      // greifen sonst erst nach Ablauf des 60s-Session-Caches).
      if (action === 'add' || action === 'remove') {
        await invalidateUserSessions(memberId);
      }

      const updatedRoles = await storage.getUserRoles(memberId);
      res.json({ roles: updatedRoles.map(r => r.role) });
    } catch (error) {
      console.error("Role update error:", error);
      res.status(500).json({ error: "Failed to update roles" });
    }
  });

  app.post("/api/admin/run-simulation", isAuthenticated, requireAdminAccess(), async (req, res) => {
    try {
      const result = await runSimulation();
      res.json({ 
        success: true, 
        message: 'Simulation 2025 erfolgreich erstellt',
        data: result 
      });
    } catch (error) {
      console.error('Simulation error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Simulation fehlgeschlagen' 
      });
    }
  });

  // ===== SEPA Export Routes =====
  app.post("/api/sepa/direct-debit", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const normalizedBody = snakeToCamel(req.body);
      const { creditorName, creditorIban, creditorBic, creditorId, invoiceIds } = normalizedBody;
      const xml = await sepaExportService.generateDirectDebitXml(
        profile.organizationId,
        creditorName,
        creditorIban,
        creditorBic,
        creditorId,
        invoiceIds
      );
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', 'attachment; filename=sepa-lastschrift.xml');
      res.send(xml);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "SEPA export failed" });
    }
  });

  app.post("/api/sepa/credit-transfer", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const normalizedBody = snakeToCamel(req.body);
      const { debtorName, debtorIban, debtorBic, transfers } = normalizedBody;
      const xml = await sepaExportService.generateCreditTransferXml(
        profile.organizationId,
        debtorName,
        debtorIban,
        debtorBic,
        transfers
      );
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', 'attachment; filename=sepa-ueberweisung.xml');
      res.send(xml);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "SEPA export failed" });
    }
  });

  // ===== Settlement Finalization (§21 Abs.3 MRG: OP-Kette) =====
  app.patch("/api/settlements/:id/finalize", isAuthenticated, requireRole('property_manager', 'finance'), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation" });

      // 1. Settlement laden + Org-Zugehörigkeit prüfen
      const settRows = await db.select()
        .from(schema.settlements)
        .innerJoin(schema.properties, eq(schema.settlements.propertyId, schema.properties.id))
        .where(and(
          eq(schema.settlements.id, req.params.id),
          eq(schema.properties.organizationId, profile.organizationId),
        ))
        .limit(1);

      if (!settRows.length) return res.status(404).json({ error: "Abrechnung nicht gefunden" });
      const { settlements: settlement } = settRows[0] as any;

      if (settlement.status === 'abgeschlossen') {
        return res.status(409).json({ error: "Abrechnung ist bereits abgeschlossen" });
      }

      // 2. Detailzeilen laden
      const details = await db.select()
        .from(schema.settlementDetails)
        .where(eq(schema.settlementDetails.settlementId, req.params.id));

      // 3. In Transaktion: Status setzen + OP-Einträge erzeugen
      const openItemsCreated: string[] = [];
      await db.transaction(async (tx) => {
        await tx.update(schema.settlements)
          .set({ status: 'abgeschlossen', updatedAt: new Date() })
          .where(eq(schema.settlements.id, req.params.id));

        const today = new Date();
        const dueDate = new Date(today);
        dueDate.setDate(dueDate.getDate() + 30);
        const dueDateStr = dueDate.toISOString().split('T')[0];
        const nowYear = today.getFullYear();
        const nowMonth = today.getMonth() + 1;

        for (const detail of details) {
          const diff = Number(detail.differenz ?? 0);
          // differenz = vorschuss - ausgabenAnteil
          // Negative differenz → Mieter hat zu wenig gezahlt → Nachzahlung erforderlich
          if (diff >= -0.005) continue; // keine Nachzahlung nötig (überbezahlt oder ausgeglichen)

          const nachzahlung = Math.round(Math.abs(diff) * 100) / 100;

          // Einheit für diesen Mieter finden
          const unitRows = await tx.select()
            .from(schema.tenants)
            .where(eq(schema.tenants.id, detail.tenantId))
            .limit(1);
          const unitId = unitRows[0]?.unitId;
          if (!unitId) continue;

          // Offene Position als monthlyInvoice anlegen (§21 Abs.3 MRG)
          const [opEntry] = await tx.insert(schema.monthlyInvoices).values({
            unitId,
            tenantId: detail.tenantId,
            year: nowYear,
            month: nowMonth,
            grundmiete: '0',
            betriebskosten: String(nachzahlung),
            heizungskosten: '0',
            wasserkosten: '0',
            ust: '0',
            gesamtbetrag: String(nachzahlung),
            status: 'offen',
            faelligAm: dueDateStr,
            isVacancy: false,
          }).returning({ id: schema.monthlyInvoices.id });

          if (opEntry?.id) openItemsCreated.push(opEntry.id);
        }

        await tx.execute(sql`
          INSERT INTO audit_logs (user_id, table_name, record_id, action, new_data, created_at)
          VALUES (
            ${profile.userId || null}, 'settlements', ${req.params.id},
            'finalize',
            ${JSON.stringify({ openItemsCreated: openItemsCreated.length, year: settlement.year })}::jsonb,
            now()
          )
        `);
      });

      res.json({
        success: true,
        message: `Abrechnung ${settlement.year} abgeschlossen. ${openItemsCreated.length} Nachzahlungs-OP(s) erstellt.`,
        openItemsCreated,
      });
    } catch (err: any) {
      console.error("[Settlement] Finalize error:", err);
      res.status(500).json({ error: err.message || "Fehler beim Abschließen der Abrechnung" });
    }
  });

  // ===== Settlement PDF Routes =====
  app.get("/api/settlements/:id/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const data = await settlementPdfService.getSettlementData(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Settlement not found" });
      }
      const html = settlementPdfService.generateHtml(data);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate settlement PDF" });
    }
  });

  // ===== Dunning Overview (for Mahnwesen page) =====
  app.get("/api/dunning-overview", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }

      const overdueInvoices = await db.select({
        invoice: schema.monthlyInvoices,
        tenant: schema.tenants,
        unit: schema.units,
        property: schema.properties,
      })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.tenants, eq(schema.monthlyInvoices.tenantId, schema.tenants.id))
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(
          eq(schema.properties.organizationId, profile.organizationId),
          or(
            eq(schema.monthlyInvoices.status, 'offen'),
            eq(schema.monthlyInvoices.status, 'teilbezahlt'),
            eq(schema.monthlyInvoices.status, 'ueberfaellig')
          ),
          lt(schema.monthlyInvoices.faelligAm, new Date().toISOString().split('T')[0])
        ));

      const dunningSurcharges = await getDunningSurchargeMap(
        overdueInvoices.map((row) => row.invoice.id),
      );
      const tenantMap = new Map<string, any>();

      for (const row of overdueInvoices) {
        const tid = row.tenant.id;
        if (!tenantMap.has(tid)) {
          tenantMap.set(tid, {
            tenantId: tid,
            tenantName: `${row.tenant.firstName || ''} ${row.tenant.lastName || ''}`.trim(),
            email: row.tenant.email || null,
            phone: row.tenant.phone || null,
            propertyId: row.property.id,
            propertyName: row.property.name || '',
            unitId: row.unit.id,
            unitNumber: row.unit.topNummer || '',
            invoices: [],
            totalAmount: 0,
            highestMahnstufe: 0,
            oldestOverdue: row.invoice.faelligAm,
          });
        }
        const entry = tenantMap.get(tid)!;
        const invoiceTotal = roundMoney(
          Number(row.invoice.gesamtbetrag || 0) + (dunningSurcharges.get(row.invoice.id) || 0),
        );
        const invAmount = invoiceTotal - Number(row.invoice.paidAmount || 0);
        entry.invoices.push({
          id: row.invoice.id,
          month: row.invoice.month,
          year: row.invoice.year,
          gesamtbetrag: invoiceTotal,
          faellig_am: row.invoice.faelligAm,
          mahnstufe: row.invoice.mahnstufe || 0,
          zahlungserinnerung_am: (row.invoice as any).zahlungserinnerungAm || null,
          mahnung_am: (row.invoice as any).mahnungAm || null,
        });
        entry.totalAmount += invAmount;
        if ((row.invoice.mahnstufe || 0) > entry.highestMahnstufe) {
          entry.highestMahnstufe = row.invoice.mahnstufe || 0;
        }
        if (row.invoice.faelligAm && (!entry.oldestOverdue || row.invoice.faelligAm < entry.oldestOverdue)) {
          entry.oldestOverdue = row.invoice.faelligAm;
        }
      }

      const cases = Array.from(tenantMap.values());
      const stats = {
        totalCases: cases.length,
        totalOpen: cases.filter(c => c.highestMahnstufe === 0).length,
        totalReminded: cases.filter(c => c.highestMahnstufe === 1).length,
        totalDunned: cases.filter(c => c.highestMahnstufe >= 2).length,
        totalAmount: Math.round(cases.reduce((s, c) => s + c.totalAmount, 0) * 100) / 100,
      };

      res.json({ cases, stats });
    } catch (error) {
      console.error("Error fetching dunning overview:", error);
      res.status(500).json({ error: "Fehler beim Laden der Mahnübersicht" });
    }
  });

  // ===== Send Dunning Email =====
  app.post("/api/dunning/send", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const body = snakeToCamel(req.body);
      const { invoiceId, dunningLevel, tenantEmail, tenantName, propertyName, unitNumber } = body;

      if (!invoiceId || !tenantEmail) {
        return res.status(400).json({ error: "invoiceId und tenantEmail sind erforderlich" });
      }

      const invoiceWithOrg = await db.select({
        invoice: schema.monthlyInvoices,
        orgId: schema.properties.organizationId,
        unitType: schema.units.type,
      })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.tenants, eq(schema.monthlyInvoices.tenantId, schema.tenants.id))
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(
          eq(schema.monthlyInvoices.id, invoiceId),
          eq(schema.properties.organizationId, profile.organizationId)
        ))
        .limit(1);
      if (!invoiceWithOrg.length) return res.status(404).json({ error: "Rechnung nicht gefunden" });

      const invoice = invoiceWithOrg[0].invoice;
      const newLevel = dunningLevel || ((invoice.mahnstufe || 0) + 1);
      const dunningChargesByInvoice = await getDunningChargesByInvoice([invoiceId]);
      const outstandingAmount = getOutstandingInvoiceAmount(
        invoice.gesamtbetrag,
        invoice.paidAmount,
        dunningChargesByInvoice.get(invoiceId) || 0,
      );
      const dueDateValue = invoice.faelligAm ? new Date(invoice.faelligAm) : new Date();
      const daysOverdue = Math.max(
        0,
        Math.floor((Date.now() - dueDateValue.getTime()) / (1000 * 60 * 60 * 24)),
      );
      const business = invoiceWithOrg[0].unitType === 'geschaeft'
        || invoiceWithOrg[0].unitType === 'lager';
      const charges = automatedDunningService.calculateDunningCharges(
        outstandingAmount,
        daysOverdue,
        newLevel,
        business,
      );

      const levelLabels: Record<number, string> = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
      const levelLabel = levelLabels[newLevel] || 'Zahlungserinnerung';
      const subject = `${levelLabel} - Offener Betrag für ${propertyName || 'Ihre Wohnung'}`;

      // Claim and persist the charge before notifying the tenant. This avoids
      // an email that demands a surcharge which lost the conditional
      // escalation race and therefore was never booked on the invoice.
      const recorded = await automatedDunningService.recordDunningCharges(profile.organizationId, {
        invoiceId,
        unitId: invoice.unitId,
        currentLevel: invoice.mahnstufe || 0,
        newLevel,
        fee: charges.fee,
        interest: charges.interest,
      });
      if (!recorded) {
        return res.status(409).json({ error: "Die Mahnstufe wurde bereits verarbeitet" });
      }

      const htmlBody = `
        <div style="font-family: Arial, sans-serif;">
          <h2>${levelLabel}</h2>
          <p>Sehr geehrte(r) ${tenantName || 'Mieter/in'},</p>
          <p>für Ihre Wohnung in der ${propertyName || ''} (${unitNumber || ''}) besteht noch ein offener Betrag:</p>
           <p><strong>Offener Betrag: ${new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(outstandingAmount)}</strong></p>
           ${charges.fee > 0 ? `<p><strong>Mahngebühr: ${new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(charges.fee)}</strong></p>` : ''}
           ${charges.interest > 0 ? `<p><strong>Verzugszinsen: ${new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(charges.interest)}</strong></p>` : ''}
           ${newLevel >= 2 ? `<p><strong>Gesamtbetrag: ${new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(charges.totalDue)}</strong></p>` : ''}
          ${newLevel >= 3 ? `<p><strong style="color: red;">Dies ist die letzte Mahnung vor Einleitung rechtlicher Schritte.</strong></p>` : ''}
          <p>Mit freundlichen Grüßen,<br>Ihre Hausverwaltung</p>
        </div>
      `;

      const { sendEmail } = await import("./lib/resend");
      await sendEmail({ to: tenantEmail, subject, html: htmlBody });

      res.json({ success: true, message: `${levelLabel} an ${tenantEmail} gesendet` });
    } catch (error) {
      console.error("Error sending dunning:", error);
      res.status(500).json({ error: "Fehler beim Versenden der Mahnung" });
    }
  });

  // ===== Automated Dunning Routes =====
  app.get("/api/dunning/check", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const actions = await automatedDunningService.checkOverdueInvoices(profile.organizationId);
      res.json({ actions });
    } catch (error) {
      res.status(500).json({ error: "Failed to check dunning" });
    }
  });

  app.post("/api/dunning/process", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const normalizedBody = snakeToCamel(req.body);
      const { sendEmails } = normalizedBody;
      const result = await automatedDunningService.processAutomatedDunning(
        profile.organizationId,
        sendEmails === true
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to process dunning" });
    }
  });

  // ===== VPI Routes =====
  // Alle VPI-Endpunkte in server/routes/vpiRoutes.ts — importierbar und unabhängig testbar.
  app.use(vpiCrudRouter);

  // ===== Maintenance Reminder Routes =====
  app.get("/api/maintenance/reminders", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const reminders = await maintenanceReminderService.checkMaintenanceReminders(profile.organizationId);
      res.json({ reminders });
    } catch (error) {
      res.status(500).json({ error: "Failed to check maintenance reminders" });
    }
  });

  app.post("/api/maintenance/send-reminders", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const normalizedBody = snakeToCamel(req.body);
      const { managerEmail } = normalizedBody;
      const result = await maintenanceReminderService.sendMaintenanceReminders(
        profile.organizationId,
        managerEmail
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send maintenance reminders" });
    }
  });

  // ===== Owner CRUD Routes =====
  app.get("/api/owners", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }

      const ownerRows = await db.select().from(schema.owners)
        .where(eq(schema.owners.organizationId, profile.organizationId))
        .orderBy(asc(schema.owners.lastName), asc(schema.owners.firstName));

      res.json(decryptIbanRows(ownerRows));
    } catch (error) {
      console.error("Error fetching owners:", error);
      res.status(500).json({ error: "Failed to fetch owners" });
    }
  });

  app.post("/api/owners", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }

      const normalizedBody = snakeToCamel(req.body);
      const validationResult = insertOwnerSchema.safeParse(normalizedBody);

      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationResult.error.flatten() 
        });
      }

      const ownerData = {
        ...validationResult.data,
        organizationId: profile.organizationId,
        iban: encryptField(validationResult.data.iban),
        bic: encryptField(validationResult.data.bic ?? null),
      };

      const [owner] = await db.insert(schema.owners)
        .values(ownerData)
        .returning();

      res.status(201).json(decryptIbanFields(owner));
    } catch (error) {
      console.error("Error creating owner:", error);
      res.status(500).json({ error: "Failed to create owner" });
    }
  });

  app.patch("/api/owners/:id", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }

      const { id } = req.params;

      const [existingOwner] = await db.select().from(schema.owners)
        .where(eq(schema.owners.id, id))
        .limit(1);

      if (!existingOwner) {
        return res.status(404).json({ error: "Owner not found" });
      }

      if (existingOwner.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const normalizedBody = snakeToCamel(req.body);
      
      const allowedFields = [
        'firstName', 'lastName', 'companyName', 'email', 'phone', 'mobilePhone',
        'address', 'city', 'postalCode', 'country', 'iban', 'bic', 'bankName',
        'taxNumber', 'notes'
      ];

      const updateData: any = {};
      for (const field of allowedFields) {
        if (field in normalizedBody) {
          updateData[field] = normalizedBody[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      if ('iban' in updateData) updateData.iban = encryptField(updateData.iban);
      if ('bic' in updateData) updateData.bic = encryptField(updateData.bic ?? null);

      const [updatedOwner] = await db.update(schema.owners)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.owners.id, id),
          eq(schema.owners.organizationId, profile.organizationId)
        ))
        .returning();

      res.json(decryptIbanFields(updatedOwner));
    } catch (error) {
      console.error("Error updating owner:", error);
      res.status(500).json({ error: "Failed to update owner" });
    }
  });

  app.delete("/api/owners/:id", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }

      const { id } = req.params;

      const [existingOwner] = await db.select().from(schema.owners)
        .where(eq(schema.owners.id, id))
        .limit(1);

      if (!existingOwner) {
        return res.status(404).json({ error: "Owner not found" });
      }

      if (existingOwner.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [referencedCount] = await db.select({ count: count() }).from(schema.wegUnitOwners)
        .where(eq(schema.wegUnitOwners.ownerId, id));

      if (referencedCount && referencedCount.count > 0) {
        return res.status(409).json({ 
          error: "Owner cannot be deleted", 
          message: "This owner is referenced by WEG unit owners. Please remove those references first." 
        });
      }

      await db.delete(schema.owners)
        .where(eq(schema.owners.id, id));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting owner:", error);
      res.status(500).json({ error: "Failed to delete owner" });
    }
  });

  // ===== Owner Reporting Routes =====
  app.get("/api/owners/:ownerId/report", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { period, date } = req.query;
      const report = await ownerReportingService.generateOwnerReport(
        profile.organizationId,
        req.params.ownerId,
        period as any || 'month',
        date ? new Date(date as string) : new Date()
      );
      if (!report) {
        return res.status(404).json({ error: "Owner not found" });
      }
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate owner report" });
    }
  });

  app.get("/api/owners/:ownerId/report/html", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { period, date } = req.query;
      const report = await ownerReportingService.generateOwnerReport(
        profile.organizationId,
        req.params.ownerId,
        period as any || 'month',
        date ? new Date(date as string) : new Date()
      );
      if (!report) {
        return res.status(404).json({ error: "Owner not found" });
      }
      const html = ownerReportingService.generateReportHtml(report, period as string || 'Monat');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate owner report" });
    }
  });

  // ===== BMD/DATEV Export Routes =====
  app.get("/api/export/datev", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { startDate, endDate } = req.query;
      const csv = await bmdDatevExportService.generateDatevExport(
        profile.organizationId,
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=datev-export.csv');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate DATEV export" });
    }
  });

  app.get("/api/export/bmd", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { startDate, endDate } = req.query;
      const csv = await bmdDatevExportService.generateBmdExport(
        profile.organizationId,
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=bmd-export.csv');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate BMD export" });
    }
  });

  // ===== FinanzOnline Routes =====
  app.get("/api/finanzonline/ust-summary", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { year, period } = req.query;
      const voranmeldung = await finanzOnlineService.generateUstVoranmeldung(
        profile.organizationId,
        parseInt(year as string) || new Date().getFullYear(),
        period as any || 'Q1'
      );
      res.json(voranmeldung);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate USt summary" });
    }
  });

  app.get("/api/finanzonline/ust-xml", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      const { year, period } = req.query;
      const voranmeldung = await finanzOnlineService.generateUstVoranmeldung(
        profile.organizationId,
        parseInt(year as string) || new Date().getFullYear(),
        period as any || 'Q1'
      );
      const xml = finanzOnlineService.generateXml(voranmeldung);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', 'attachment; filename=ust-voranmeldung.xml');
      res.send(xml);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate USt XML" });
    }
  });

  app.get("/api/finanzonline/periods", isAuthenticated, async (req: any, res) => {
    const { year } = req.query;
    const periods = finanzOnlineService.getAvailablePeriods(parseInt(year as string) || new Date().getFullYear());
    res.json({ periods });
  });

  // ===== Accountant Dashboard KPIs =====
  app.get("/api/accountant/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "No organization" });
      }
      
      const [dunningActions, maintenanceReminders, vpiAdjustments] = await Promise.all([
        automatedDunningService.checkOverdueInvoices(profile.organizationId),
        maintenanceReminderService.checkMaintenanceReminders(profile.organizationId),
        vpiAutomationService.checkVpiAdjustments(profile.organizationId),
      ]);

      const overdueAmount = dunningActions.reduce((sum, a) => sum + a.amount, 0);
      const overdueCount = dunningActions.length;
      const maintenanceOverdue = maintenanceReminders.filter(r => r.reminderType === 'overdue').length;
      const maintenanceDue = maintenanceReminders.filter(r => r.reminderType === 'due').length;
      const pendingVpiAdjustments = vpiAdjustments.length;

      res.json({
        dunning: {
          overdueAmount,
          overdueCount,
          byLevel: {
            level1: dunningActions.filter(a => a.newLevel === 1).length,
            level2: dunningActions.filter(a => a.newLevel === 2).length,
            level3: dunningActions.filter(a => a.newLevel === 3).length,
          }
        },
        maintenance: {
          overdueCount: maintenanceOverdue,
          dueThisWeek: maintenanceDue,
          upcomingCount: maintenanceReminders.filter(r => r.reminderType === 'upcoming').length,
        },
        vpiAdjustments: {
          pendingCount: pendingVpiAdjustments,
          totalIncrease: vpiAdjustments.reduce((sum, a) => sum + (a.newRent - a.currentRent), 0),
        },
        actions: {
          dunning: dunningActions.slice(0, 5),
          maintenance: maintenanceReminders.slice(0, 5),
          vpi: vpiAdjustments.slice(0, 5),
        }
      });
    } catch (error) {
      console.error('Accountant dashboard error:', error);
      res.status(500).json({ error: "Failed to load accountant dashboard" });
    }
  });

  // ===== Storage Endpoints =====
  app.post("/api/storage/signed-url", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
    try {
      const normalizedBody = snakeToCamel(req.body);
      const { bucket, filePath, expiresIn } = normalizedBody;
      // For now, return the direct path since we're not using external storage
      // In production, this would generate a signed URL from the storage provider
      const signedUrl = `/api/storage/files/${bucket}/${filePath}`;
      res.json({ signedUrl });
    } catch (error) {
      console.error('Signed URL error:', error);
      res.status(500).json({ error: "Failed to generate signed URL" });
    }
  });

  app.post("/api/storage/upload", isAuthenticated, requireMutationAccess(), async (req: any, res) => {
    try {
      const { ObjectStorageService } = await import("./replit_integrations/object_storage");
      const oss = new ObjectStorageService();
      const uploadURL = await oss.getObjectEntityUploadURL();
      const objectPath = oss.normalizeObjectEntityPath(uploadURL);
      res.json({ 
        success: true, 
        uploadURL,
        objectPath,
        path: objectPath,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  // ===== KEY INVENTORY ENDPOINTS =====
  app.get("/api/key-inventory", isAuthenticated, async (req: any, res) => {
    try {
      const organizationId = req.session?.organizationId;
      const propertyId = req.query.property_id;
      
      let query = db.select({
        key: schema.keyInventory,
        property: schema.properties,
        unit: schema.units,
      })
      .from(schema.keyInventory)
      .leftJoin(schema.properties, eq(schema.keyInventory.propertyId, schema.properties.id))
      .leftJoin(schema.units, eq(schema.keyInventory.unitId, schema.units.id));
      
      if (!organizationId) {
        return res.status(403).json({ error: "Kein Organisationskontext — Zugriff verweigert" });
      }
      query = query.where(eq(schema.properties.organizationId, organizationId));
      
      const results = await query;
      
      const keys = results
        .filter(r => !propertyId || r.key.propertyId === propertyId)
        .map(r => ({
          ...r.key,
          property_id: r.key.propertyId,
          unit_id: r.key.unitId,
          key_type: r.key.keyType,
          key_number: r.key.keyNumber,
          total_count: r.key.totalCount,
          available_count: r.key.availableCount,
          created_at: r.key.createdAt,
          updated_at: r.key.updatedAt,
          properties: r.property ? { id: r.property.id, name: r.property.name } : null,
          units: r.unit ? { id: r.unit.id, top_nummer: r.unit.topNummer } : null,
        }));
      
      res.json(keys);
    } catch (error) {
      console.error('Key inventory fetch error:', error);
      res.status(500).json({ error: "Failed to fetch key inventory" });
    }
  });

  app.get("/api/key-inventory/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const result = await db.select({
        key: schema.keyInventory,
        property: schema.properties,
        unit: schema.units,
      })
      .from(schema.keyInventory)
      .leftJoin(schema.properties, eq(schema.keyInventory.propertyId, schema.properties.id))
      .leftJoin(schema.units, eq(schema.keyInventory.unitId, schema.units.id))
      .where(eq(schema.keyInventory.id, id))
      .limit(1);
      
      if (!result.length) {
        return res.status(404).json({ error: "Key not found" });
      }
      
      const r = result[0];
      const key = {
        ...r.key,
        property_id: r.key.propertyId,
        unit_id: r.key.unitId,
        key_type: r.key.keyType,
        key_number: r.key.keyNumber,
        total_count: r.key.totalCount,
        available_count: r.key.availableCount,
        created_at: r.key.createdAt,
        updated_at: r.key.updatedAt,
        properties: r.property ? { id: r.property.id, name: r.property.name } : null,
        units: r.unit ? { id: r.unit.id, top_nummer: r.unit.topNummer } : null,
      };
      
      res.json(key);
    } catch (error) {
      console.error('Key inventory fetch error:', error);
      res.status(500).json({ error: "Failed to fetch key" });
    }
  });

  app.post("/api/key-inventory", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
    try {
      const body = snakeToCamel(req.body);
      const result = await db.insert(schema.keyInventory).values({
        propertyId: body.propertyId,
        unitId: body.unitId || null,
        keyType: body.keyType,
        keyNumber: body.keyNumber || null,
        description: body.description || null,
        totalCount: body.totalCount || 1,
        availableCount: body.availableCount || 1,
        notes: body.notes || null,
      }).returning();
      
      const key = result[0];
      res.json({
        ...key,
        property_id: key.propertyId,
        unit_id: key.unitId,
        key_type: key.keyType,
        key_number: key.keyNumber,
        total_count: key.totalCount,
        available_count: key.availableCount,
        created_at: key.createdAt,
        updated_at: key.updatedAt,
      });
    } catch (error) {
      console.error('Key inventory create error:', error);
      res.status(500).json({ error: "Failed to create key" });
    }
  });

  app.patch("/api/key-inventory/:id", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "No organization" });
      }
      const body = snakeToCamel(req.body);
      
      const updates: any = { updatedAt: new Date() };
      if (body.propertyId !== undefined) updates.propertyId = body.propertyId;
      if (body.unitId !== undefined) updates.unitId = body.unitId || null;
      if (body.keyType !== undefined) updates.keyType = body.keyType;
      if (body.keyNumber !== undefined) updates.keyNumber = body.keyNumber || null;
      if (body.description !== undefined) updates.description = body.description || null;
      if (body.totalCount !== undefined) updates.totalCount = body.totalCount;
      if (body.availableCount !== undefined) updates.availableCount = body.availableCount;
      if (body.notes !== undefined) updates.notes = body.notes || null;
      
      // Org-Scope: nur Schlüssel, deren Liegenschaft zur Org des Nutzers gehört
      const result = await db.update(schema.keyInventory)
        .set(updates)
        .where(and(
          eq(schema.keyInventory.id, id),
          inArray(schema.keyInventory.propertyId,
            db.select({ id: schema.properties.id }).from(schema.properties)
              .where(eq(schema.properties.organizationId, profile.organizationId)))
        ))
        .returning();
      
      if (!result.length) {
        return res.status(404).json({ error: "Key not found" });
      }
      
      const key = result[0];
      res.json({
        ...key,
        property_id: key.propertyId,
        unit_id: key.unitId,
        key_type: key.keyType,
        key_number: key.keyNumber,
        total_count: key.totalCount,
        available_count: key.availableCount,
        created_at: key.createdAt,
        updated_at: key.updatedAt,
      });
    } catch (error) {
      console.error('Key inventory update error:', error);
      res.status(500).json({ error: "Failed to update key" });
    }
  });

  app.delete("/api/key-inventory/:id", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "No organization" });
      }
      // Org-Scope: Schlüssel darf nur gelöscht werden, wenn seine Liegenschaft
      // zur Organisation des Nutzers gehört — fremde IDs treffen 0 Zeilen.
      const deleted = await db.delete(schema.keyInventory)
        .where(and(
          eq(schema.keyInventory.id, id),
          inArray(schema.keyInventory.propertyId,
            db.select({ id: schema.properties.id }).from(schema.properties)
              .where(eq(schema.properties.organizationId, profile.organizationId)))
        ))
        .returning({ id: schema.keyInventory.id });
      if (deleted.length === 0) {
        return res.status(404).json({ error: "Key not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Key inventory delete error:', error);
      res.status(500).json({ error: "Failed to delete key" });
    }
  });

  // Key Handovers
  app.get("/api/key-inventory/:keyInventoryId/handovers", isAuthenticated, async (req: any, res) => {
    try {
      const { keyInventoryId } = req.params;
      const results = await db.select({
        handover: schema.keyHandovers,
        tenant: schema.tenants,
      })
      .from(schema.keyHandovers)
      .leftJoin(schema.tenants, eq(schema.keyHandovers.tenantId, schema.tenants.id))
      .where(eq(schema.keyHandovers.keyInventoryId, keyInventoryId));
      
      const handovers = results.map(r => ({
        ...r.handover,
        key_inventory_id: r.handover.keyInventoryId,
        tenant_id: r.handover.tenantId,
        recipient_name: r.handover.recipientName,
        handover_date: r.handover.handoverDate,
        return_date: r.handover.returnDate,
        handover_protocol: r.handover.handoverProtocol,
        created_at: r.handover.createdAt,
        tenants: r.tenant ? {
          id: r.tenant.id,
          first_name: r.tenant.firstName,
          last_name: r.tenant.lastName,
        } : null,
      }));
      
      res.json(handovers);
    } catch (error) {
      console.error('Key handovers fetch error:', error);
      res.status(500).json({ error: "Failed to fetch key handovers" });
    }
  });

  app.post("/api/key-inventory/:keyInventoryId/handovers", isAuthenticated, requireRole("property_manager"), async (req: any, res) => {
    try {
      const { keyInventoryId } = req.params;
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "No organization" });
      }
      const body = snakeToCamel(req.body);

      const { createKeyHandover, KeyHandoverError } = await import('./services/keyHandoverService');
      let result;
      try {
        result = await createKeyHandover({
          organizationId: profile.organizationId,
          keyInventoryId,
          body,
        });
      } catch (e) {
        if (e instanceof KeyHandoverError) {
          return res.status(e.statusCode).json({ error: e.message });
        }
        throw e;
      }

      const handover = result[0];
      res.json({
        ...handover,
        key_inventory_id: handover.keyInventoryId,
        tenant_id: handover.tenantId,
        recipient_name: handover.recipientName,
        handover_date: handover.handoverDate,
        return_date: handover.returnDate,
        handover_protocol: handover.handoverProtocol,
        created_at: handover.createdAt,
      });
    } catch (error) {
      console.error('Key handover create error:', error);
      res.status(500).json({ error: "Failed to create key handover" });
    }
  });

  // ===== MieWeG Indexation Calculator =====
  app.post("/api/mieweg-calculate", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const body = snakeToCamel(req.body);
      const { miewegIndexationService } = await import('./services/miewegIndexationService');
      
      const result = miewegIndexationService.calculateAllowedIncrease({
        currentRent: Number(body.currentRent),
        inflationRate: Number(body.inflationRate),
        rentType: body.rentType || 'freier_markt',
        indexationYear: Number(body.indexationYear) || new Date().getFullYear(),
        lastIndexationDate: new Date(body.lastIndexationDate || new Date()),
        isEinZweifamilienhaus: body.isEinZweifamilienhaus || false,
      });
      
      res.json(result);
    } catch (error) {
      console.error('MieWeG calculation error:', error);
      res.status(500).json({ error: "Failed to calculate MieWeG indexation" });
    }
  });

  // ===== Property Budgets =====
  app.get("/api/budgets", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = req.session.organizationId;
      const { property_id, year } = req.query;
      
      let query = db.select({
        budget: schema.propertyBudgets,
        property: {
          name: schema.properties.name,
          address: schema.properties.address,
        }
      })
        .from(schema.propertyBudgets)
        .leftJoin(schema.properties, eq(schema.propertyBudgets.propertyId, schema.properties.id))
        .where(eq(schema.propertyBudgets.organizationId, orgId));
      
      const budgets = await query;
      
      // Filter by property_id and year if provided
      let filtered = budgets;
      if (property_id) {
        filtered = filtered.filter(b => b.budget.propertyId === property_id);
      }
      if (year) {
        filtered = filtered.filter(b => b.budget.year === parseInt(year as string));
      }
      
      res.json(filtered.map(b => ({
        ...b.budget,
        id: b.budget.id,
        property_id: b.budget.propertyId,
        organization_id: b.budget.organizationId,
        position_1_name: b.budget.position1Name,
        position_1_amount: parseFloat(b.budget.position1Amount || '0'),
        position_2_name: b.budget.position2Name,
        position_2_amount: parseFloat(b.budget.position2Amount || '0'),
        position_3_name: b.budget.position3Name,
        position_3_amount: parseFloat(b.budget.position3Amount || '0'),
        position_4_name: b.budget.position4Name,
        position_4_amount: parseFloat(b.budget.position4Amount || '0'),
        position_5_name: b.budget.position5Name,
        position_5_amount: parseFloat(b.budget.position5Amount || '0'),
        approved_by: b.budget.approvedBy,
        approved_at: b.budget.approvedAt,
        created_at: b.budget.createdAt,
        updated_at: b.budget.updatedAt,
        properties: b.property,
      })));
    } catch (error) {
      console.error('Budgets fetch error:', error);
      res.status(500).json({ error: "Failed to fetch budgets" });
    }
  });

  app.get("/api/budgets/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const orgId = req.session.organizationId;
      const result = await db.select()
        .from(schema.propertyBudgets)
        .where(and(eq(schema.propertyBudgets.id, id), eq(schema.propertyBudgets.organizationId, orgId)));
      
      if (result.length === 0) {
        return res.status(404).json({ error: "Budget not found" });
      }
      
      const b = result[0];
      res.json({
        ...b,
        property_id: b.propertyId,
        organization_id: b.organizationId,
        position_1_name: b.position1Name,
        position_1_amount: parseFloat(b.position1Amount || '0'),
        position_2_name: b.position2Name,
        position_2_amount: parseFloat(b.position2Amount || '0'),
        position_3_name: b.position3Name,
        position_3_amount: parseFloat(b.position3Amount || '0'),
        position_4_name: b.position4Name,
        position_4_amount: parseFloat(b.position4Amount || '0'),
        position_5_name: b.position5Name,
        position_5_amount: parseFloat(b.position5Amount || '0'),
        approved_by: b.approvedBy,
        approved_at: b.approvedAt,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
      });
    } catch (error) {
      console.error('Budget fetch error:', error);
      res.status(500).json({ error: "Failed to fetch budget" });
    }
  });

  app.post("/api/budgets", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const orgId = req.session.organizationId;
      const body = snakeToCamel(req.body);
      
      // Validate property ownership
      const propertyId = body.propertyId || body.property_id;
      const property = await db.select().from(schema.properties)
        .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, orgId)));
      if (property.length === 0) {
        return res.status(403).json({ error: "Property not found or access denied" });
      }

      for (let i = 1; i <= 5; i++) {
        const raw = body[`position${i}Amount`] ?? body[`position_${i}_amount`];
        if (raw === undefined || raw === null || raw === "") continue;
        const parsed = parseMoneyInput(raw, `position_${i}_amount`);
        if ("error" in parsed) return res.status(400).json({ error: parsed.error });
        body[`position${i}Amount`] = parsed.value;
        delete body[`position_${i}_amount`];
      }

      const result = await db.insert(schema.propertyBudgets).values({
        propertyId: body.propertyId || body.property_id,
        organizationId: orgId,
        year: body.year,
        position1Name: body.position1Name || body.position_1_name,
        position1Amount: String(body.position1Amount || body.position_1_amount || 0),
        position2Name: body.position2Name || body.position_2_name,
        position2Amount: String(body.position2Amount || body.position_2_amount || 0),
        position3Name: body.position3Name || body.position_3_name,
        position3Amount: String(body.position3Amount || body.position_3_amount || 0),
        position4Name: body.position4Name || body.position_4_name,
        position4Amount: String(body.position4Amount || body.position_4_amount || 0),
        position5Name: body.position5Name || body.position_5_name,
        position5Amount: String(body.position5Amount || body.position_5_amount || 0),
        notes: body.notes,
        status: 'entwurf',
      }).returning();
      
      res.json(result[0]);
    } catch (error: any) {
      console.error('Budget create error:', error);
      if (error.message?.includes('unique')) {
        res.status(400).json({ error: "Budget for this property and year already exists" });
      } else {
        res.status(500).json({ error: "Failed to create budget" });
      }
    }
  });

  app.patch("/api/budgets/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const body = snakeToCamel(req.body);

      for (let i = 1; i <= 5; i++) {
        const raw = body[`position${i}Amount`] ?? body[`position_${i}_amount`];
        if (raw === undefined || raw === null || raw === "") continue;
        const parsed = parseMoneyInput(raw, `position_${i}_amount`);
        if ("error" in parsed) return res.status(400).json({ error: parsed.error });
        body[`position${i}Amount`] = parsed.value;
        delete body[`position_${i}_amount`];
      }

      const updateData: any = { updatedAt: new Date() };
      
      if (body.position1Name !== undefined || body.position_1_name !== undefined) updateData.position1Name = body.position1Name || body.position_1_name;
      if (body.position1Amount !== undefined || body.position_1_amount !== undefined) updateData.position1Amount = String(body.position1Amount ?? body.position_1_amount ?? 0);
      if (body.position2Name !== undefined || body.position_2_name !== undefined) updateData.position2Name = body.position2Name || body.position_2_name;
      if (body.position2Amount !== undefined || body.position_2_amount !== undefined) updateData.position2Amount = String(body.position2Amount ?? body.position_2_amount ?? 0);
      if (body.position3Name !== undefined || body.position_3_name !== undefined) updateData.position3Name = body.position3Name || body.position_3_name;
      if (body.position3Amount !== undefined || body.position_3_amount !== undefined) updateData.position3Amount = String(body.position3Amount ?? body.position_3_amount ?? 0);
      if (body.position4Name !== undefined || body.position_4_name !== undefined) updateData.position4Name = body.position4Name || body.position_4_name;
      if (body.position4Amount !== undefined || body.position_4_amount !== undefined) updateData.position4Amount = String(body.position4Amount ?? body.position_4_amount ?? 0);
      if (body.position5Name !== undefined || body.position_5_name !== undefined) updateData.position5Name = body.position5Name || body.position_5_name;
      if (body.position5Amount !== undefined || body.position_5_amount !== undefined) updateData.position5Amount = String(body.position5Amount ?? body.position_5_amount ?? 0);
      if (body.notes !== undefined) updateData.notes = body.notes;
      
      const orgId = req.session.organizationId;
      const result = await db.update(schema.propertyBudgets)
        .set(updateData)
        .where(and(eq(schema.propertyBudgets.id, id), eq(schema.propertyBudgets.organizationId, orgId)))
        .returning();
      
      if (result.length === 0) {
        return res.status(404).json({ error: "Budget not found" });
      }
      res.json(result[0]);
    } catch (error) {
      console.error('Budget update error:', error);
      res.status(500).json({ error: "Failed to update budget" });
    }
  });

  app.patch("/api/budgets/:id/status", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const orgId = req.session.organizationId;
      const { status, approved_by } = req.body;
      
      const updateData: any = { 
        status,
        updatedAt: new Date(),
      };
      
      if (status === 'genehmigt') {
        updateData.approvedBy = approved_by;
        updateData.approvedAt = new Date();
      }
      
      const result = await db.update(schema.propertyBudgets)
        .set(updateData)
        .where(and(eq(schema.propertyBudgets.id, id), eq(schema.propertyBudgets.organizationId, orgId)))
        .returning();
      
      if (result.length === 0) {
        return res.status(404).json({ error: "Budget not found" });
      }
      res.json(result[0]);
    } catch (error) {
      console.error('Budget status update error:', error);
      res.status(500).json({ error: "Failed to update budget status" });
    }
  });

  app.delete("/api/budgets/:id", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const orgId = req.session.organizationId;
      await db.delete(schema.propertyBudgets).where(and(eq(schema.propertyBudgets.id, id), eq(schema.propertyBudgets.organizationId, orgId)));
      res.json({ success: true });
    } catch (error) {
      console.error('Budget delete error:', error);
      res.status(500).json({ error: "Failed to delete budget" });
    }
  });

  // Get expenses for budget comparison
  app.get("/api/budgets/expenses", isAuthenticated, async (req: any, res) => {
    try {
      const { property_id, year } = req.query;
      
      if (!property_id || !year) {
        return res.status(400).json({ error: "property_id and year required" });
      }
      
      const expenses = await db.select()
        .from(schema.expenses)
        .where(eq(schema.expenses.propertyId, property_id as string));
      
      // Group by position (month) for budget comparison
      const byPosition: Record<number, number> = {};
      expenses.forEach(e => {
        const expenseDate = new Date(e.date);
        if (expenseDate.getFullYear() === parseInt(year as string)) {
          const position = expenseDate.getMonth() + 1;
          byPosition[position] = (byPosition[position] || 0) + parseFloat(e.amount || '0');
        }
      });
      
      res.json(byPosition);
    } catch (error) {
      console.error('Budget expenses fetch error:', error);
      res.status(500).json({ error: "Failed to fetch budget expenses" });
    }
  });

  app.get("/api/budgets/expenses-all", isAuthenticated, async (req: any, res) => {
    try {
      const { property_id, year } = req.query;
      
      if (!property_id || !year) {
        return res.status(400).json({ error: "property_id and year required" });
      }
      
      const expenses = await db.select()
        .from(schema.expenses)
        .where(eq(schema.expenses.propertyId, property_id as string));
      
      // Sum all expenses for the year
      const byPosition: Record<number, number> = {};
      let total = 0;
      expenses.forEach(e => {
        const expenseDate = new Date(e.date);
        if (expenseDate.getFullYear() === parseInt(year as string)) {
          total += parseFloat(e.amount || '0');
        }
      });
      
      byPosition[1] = total;
      res.json(byPosition);
    } catch (error) {
      console.error('Budget expenses-all fetch error:', error);
      res.status(500).json({ error: "Failed to fetch budget expenses" });
    }
  });


  // Demo Access Routes (public - no auth required)
  app.post("/api/demo/request", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Gültige E-Mail-Adresse erforderlich" });
      }
      
      const ipAddress = req.headers['x-forwarded-for']?.toString() || req.ip;
      const userAgent = req.headers['user-agent'];
      
      const result = await demoService.requestDemoAccess(email, ipAddress, userAgent);
      
      if (result.success) {
        res.json({ 
          message: result.message,
          activationUrl: result.activationUrl
        });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (error) {
      console.error('Demo request error:', error);
      res.status(500).json({ error: "Fehler beim Erstellen der Demo-Anfrage" });
    }
  });

  app.get("/api/demo/validate", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ valid: false, error: "Token fehlt" });
      }
      
      const [invite] = await db.select()
        .from(schema.demoInvites)
        .where(eq(schema.demoInvites.token, token))
        .limit(1);
      
      if (!invite) {
        return res.json({ valid: false, error: "Ungültiger Demo-Link" });
      }
      
      if (invite.status !== 'pending') {
        return res.json({ valid: false, error: "Dieser Demo-Link wurde bereits verwendet" });
      }
      
      if (new Date() > invite.expiresAt) {
        return res.json({ valid: false, error: "Dieser Demo-Link ist abgelaufen" });
      }
      
      res.json({ valid: true, email: invite.email });
    } catch (error) {
      console.error('Demo validate error:', error);
      res.status(500).json({ valid: false, error: "Validierungsfehler" });
    }
  });

  app.post("/api/demo/activate", async (req: Request, res: Response) => {
    try {
      const { token, fullName, password } = req.body;
      
      if (!token || !fullName || !password) {
        return res.status(400).json({ error: "Alle Felder sind erforderlich" });
      }
      
      if (password.length < 6) {
        return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
      }
      
      const result = await demoService.activateDemo(token, fullName, password);
      
      if (result.success && result.userId) {
        // Auto-login the user
        req.session.userId = result.userId;
        req.session.save((err) => {
          if (err) {
            console.error('Session save error:', err);
          }
        });
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (error) {
      console.error('Demo activate error:', error);
      res.status(500).json({ error: "Fehler beim Aktivieren der Demo" });
    }
  });

  app.get("/api/demo/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const status = await demoService.getDemoStatus(userId);
      res.json(status);
    } catch (error) {
      console.error('Demo status error:', error);
      res.status(500).json({ error: "Fehler beim Abrufen des Demo-Status" });
    }
  });

  // Admin: Send demo invitation directly
  app.post("/api/admin/demo/invite", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Check if user is admin
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren können Demo-Einladungen versenden" });
      }
      
      const { email, name } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Gültige E-Mail-Adresse erforderlich" });
      }
      
      const result = await demoService.requestDemoAccess(email);
      
      if (result.success) {
        res.json({ 
          message: `Demo-Einladung an ${email} gesendet`,
          activationUrl: result.activationUrl
        });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (error) {
      console.error('Admin demo invite error:', error);
      res.status(500).json({ error: "Fehler beim Versenden der Einladung" });
    }
  });

  // Admin: List all demo invitations
  app.get("/api/admin/demo/invites", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }
      
      const invites = await db.select()
        .from(schema.demoInvites)
        .orderBy(desc(schema.demoInvites.createdAt))
        .limit(50);
      
      res.json(invites);
    } catch (error) {
      console.error('Admin demo invites list error:', error);
      res.status(500).json({ error: "Fehler beim Laden der Einladungen" });
    }
  });

  // Admin: Delete a demo invitation
  app.delete("/api/admin/demo/invites/:id", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren können Demo-Einladungen löschen" });
      }
      
      await db.delete(schema.demoInvites)
        .where(eq(schema.demoInvites.id, id));
      
      res.json({ message: "Einladung gelöscht" });
    } catch (error) {
      console.error('Admin demo invite delete error:', error);
      res.status(500).json({ error: "Fehler beim Löschen der Einladung" });
    }
  });

  // OCR tenant extraction route
  const ocrUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Nur Bilder (JPG, PNG) und PDFs sind erlaubt'));
      }
    },
  });

  // OCR-Client via Replit AI Integrations (kein eigener API-Key erforderlich)
  const ocrClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  app.post("/api/ocr/tenant", isAuthenticated, requireRole("property_manager"), (req: Request, res: Response, next: any) => {
    ocrUpload.single('file')(req, res, (err: any) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({ message: err.message || 'Datei-Upload fehlgeschlagen' });
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Keine Datei hochgeladen' });
      }

      if (req.file.mimetype === 'application/pdf') {
        return res.status(400).json({ 
          message: 'PDFs müssen im Browser konvertiert werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.' 
        });
      }

      const base64Image = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype;
      const imageUrl = `data:${mimeType};base64,${base64Image}`;

      const extractionPrompt = `Du bist ein Experte für österreichische Immobilienverwaltung und Mietverträge.
Analysiere dieses Dokument (Mietvertrag, Vorschreibung, Mieterliste oder ähnliches) und extrahiere ALLE Mieterdaten.

WICHTIG: 
- Extrahiere ALLE Mieter die im Dokument vorkommen, nicht nur den ersten!
- ALLE Beträge sind NETTOBETRÄGE (ohne USt)!
- JEDE Kostenposition EINZELN erfassen (NICHT zusammenfassen!) - wegen unterschiedlicher Verteilerschlüssel
- USt-Satz pro Position erfassen: Heizung = 20%, Wohnungen BK = 10%, Geschäftslokale = 20%

Antworte im JSON-Format als ARRAY von Mietern:
{
  "tenants": [
    {
      "firstName": "Vorname des Mieters",
      "lastName": "Nachname des Mieters",
      "email": "E-Mail-Adresse (falls vorhanden)",
      "phone": "Telefonnummer (falls vorhanden)",
      "mietbeginn": "Mietbeginn im Format YYYY-MM-DD",
      "grundmiete": Hauptmietzins NETTO als Zahl,
      "grundmieteUst": USt-Satz als Zahl (10 für Wohnung, 20 für Geschäft),
      "betriebskostenVorschuss": 0,
      "heizkostenVorschuss": 0,
      "wasserkostenVorschuss": 0,
      "warmwasserkostenVorschuss": 0,
      "sonstigeKosten": {
        "Positionsname": { "betrag": NETTO-Betrag, "ust": USt-Satz, "schluessel": "Verteilerschlüssel" },
        ...
      },
      "kaution": Kaution als Zahl (falls angegeben),
      "topNummer": "Wohnungs-/Einheitsnummer (z.B. Top 1, GE01, 001)",
      "address": "Adresse der Wohnung",
      "nutzungsart": "Wohnung" oder "Geschäftslokal",
      "notes": "Weitere relevante Informationen (kurz)"
    }
  ]
}

KRITISCH - JEDE Kostenposition EINZELN in sonstigeKosten erfassen MIT Verteilerschlüssel:
- "Betriebskosten": { "betrag": 73.42, "ust": 10, "schluessel": "Betriebskosten 01" }
- "Betriebskosten2": { "betrag": 65.89, "ust": 10, "schluessel": "Betriebskosten inkl Stellplätze" }
- "Kaltwasser": { "betrag": 43.93, "ust": 10, "schluessel": "Betriebskosten 01" }
- "Warmwasser": { "betrag": 12.01, "ust": 10, "schluessel": "Direktwert" }
- "Zentralheizung": { "betrag": 44.79, "ust": 20, "schluessel": "Zentralheizung" }
- "Lift": { "betrag": 13.81, "ust": 10, "schluessel": "BK Lift" }
- "Garage": { "betrag": 85.00, "ust": 20, "schluessel": "Direktwert" }
- "Mahnkosten": { "betrag": 15.00, "ust": 0, "schluessel": "Direktwert" }

Typische Verteilerschlüssel in österreichischen Vorschreibungen:
- "Direktwert" = fixer Betrag pro Mieter
- "Betriebskosten 01", "Betriebskosten 02" = nach Nutzfläche/Einheiten
- "Betriebskosten inkl Stellplätze" = inkl. Stellplätze nach Einheiten
- "Zentralheizung" = nach Heizungsverbrauch
- "BK Lift" = Liftkosten nach m²
- "Einheiten" = nach Anzahl Einheiten

Weitere mögliche Positionen: Müll, Kabel-TV, Internet, Strom, Versicherung, Garten, Reinigung, Stellplatz

USt-Sätze Österreich:
- Wohnungsmiete/BK: 10%
- Geschäftslokalmiete/BK: 20%
- Heizung/Zentralheizung: IMMER 20%
- Mahnkosten: 0%

- Datumsformat immer als YYYY-MM-DD
- Zahlen ohne Währungssymbol, nur numerisch (NETTO!)
- Wenn etwas nicht erkennbar ist, setze null oder 0
- Bei Personen-Namen: Vorname und Nachname getrennt

Antworte NUR mit dem JSON-Objekt, ohne zusätzlichen Text.`;

      const response = await ocrClient.chat.completions.create({
        model: 'gpt-5.2',
        max_completion_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ message: 'Keine Antwort von der KI erhalten' });
      }

      let extractedData;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Kein JSON in der Antwort gefunden');
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Content:', content);
        return res.status(500).json({ message: 'Konnte die extrahierten Daten nicht verarbeiten' });
      }

      const tenants = (extractedData.tenants || [extractedData]).map((t: any) => ({
        firstName: t.firstName || '',
        lastName: t.lastName || '',
        email: t.email || '',
        phone: t.phone || '',
        mietbeginn: t.mietbeginn || '',
        grundmiete: parseFloat(t.grundmiete) || 0,
        grundmieteUst: parseFloat(t.grundmieteUst) || 10,
        betriebskostenVorschuss: parseFloat(t.betriebskostenVorschuss) || 0,
        heizkostenVorschuss: parseFloat(t.heizkostenVorschuss) || 0,
        wasserkostenVorschuss: parseFloat(t.wasserkostenVorschuss) || 0,
        warmwasserkostenVorschuss: parseFloat(t.warmwasserkostenVorschuss) || 0,
        sonstigeKosten: t.sonstigeKosten || null,
        kaution: parseFloat(t.kaution) || 0,
        topNummer: t.topNummer || '',
        address: t.address || '',
        nutzungsart: t.nutzungsart || 'Wohnung',
        notes: t.notes || '',
      }));

      res.json({ tenants });
    } catch (error: any) {
      console.error('OCR processing error:', error);
      res.status(500).json({ message: error.message || 'OCR-Verarbeitung fehlgeschlagen' });
    }
  });

  // ========================================
  // WHITE LABEL INQUIRY ROUTES
  // ========================================

  // Helper function to escape HTML for email templates
  const escapeHtml = (text: string | null | undefined): string => {
    if (!text) return '-';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Public: Submit White Label inquiry
  app.post("/api/white-label/inquiry", async (req: Request, res: Response) => {
    try {
      const { companyName, contactPerson, email, phone, propertyCount, unitCount, message } = req.body;

      if (!companyName || !contactPerson || !email) {
        return res.status(400).json({ error: "Firmenname, Ansprechpartner und E-Mail sind erforderlich" });
      }

      // Validate string lengths
      if (companyName.length > 200 || contactPerson.length > 200 || email.length > 200) {
        return res.status(400).json({ error: "Eingaben sind zu lang" });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Bitte geben Sie eine gültige E-Mail-Adresse ein" });
      }

      // Sanitize numeric values
      const parsedPropertyCount = propertyCount ? parseInt(propertyCount, 10) : null;
      const parsedUnitCount = unitCount ? parseInt(unitCount, 10) : null;
      
      if (propertyCount && (isNaN(parsedPropertyCount!) || parsedPropertyCount! < 0)) {
        return res.status(400).json({ error: "Ungültige Anzahl Objekte" });
      }
      if (unitCount && (isNaN(parsedUnitCount!) || parsedUnitCount! < 0)) {
        return res.status(400).json({ error: "Ungültige Anzahl Einheiten" });
      }

      // Create inquiry
      const [inquiry] = await db.insert(schema.whiteLabelInquiries)
        .values({
          companyName: companyName.trim(),
          contactPerson: contactPerson.trim(),
          email: email.trim().toLowerCase(),
          phone: phone?.trim() || null,
          propertyCount: parsedPropertyCount,
          unitCount: parsedUnitCount,
          message: message?.trim() || null,
          ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
          userAgent: req.headers['user-agent'] || null,
        })
        .returning();

      // Send notification email to admin with escaped HTML
      try {
        {
          const { sendEmail } = await import('./lib/resend');

          await sendEmail({
            to: 'office@immoflowme.at',
            subject: `Neue White-Label Anfrage: ${escapeHtml(companyName)}`,
            html: `
              <h2>Neue White-Label Anfrage</h2>
              <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Firma:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(companyName)}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Ansprechpartner:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(contactPerson)}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>E-Mail:</strong></td><td style="padding: 8px; border: 1px solid #ddd;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Telefon:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(phone)}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Anzahl Objekte:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${parsedPropertyCount || '-'}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Anzahl Einheiten:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${parsedUnitCount || '-'}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Nachricht:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(message)}</td></tr>
              </table>
              <p style="margin-top: 20px; color: #666;">Anfrage eingegangen am ${new Date().toLocaleString('de-AT')}</p>
            `,
          });
          console.log('White Label inquiry notification sent to admin');
        }
      } catch (emailError) {
        console.error('Failed to send White Label notification email:', emailError);
      }

      res.json({ success: true, message: "Ihre Anfrage wurde erfolgreich übermittelt. Wir melden uns in Kürze bei Ihnen." });
    } catch (error) {
      console.error('White Label inquiry error:', error);
      res.status(500).json({ error: "Fehler beim Übermitteln der Anfrage" });
    }
  });

  // Admin: List all White Label inquiries
  app.get("/api/admin/white-label/inquiries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }
      
      const inquiries = await db.select()
        .from(schema.whiteLabelInquiries)
        .orderBy(desc(schema.whiteLabelInquiries.createdAt));
      
      res.json(inquiries);
    } catch (error) {
      console.error('Admin White Label inquiries list error:', error);
      res.status(500).json({ error: "Fehler beim Laden der Anfragen" });
    }
  });

  // Admin: Update White Label inquiry status
  const validInquiryStatuses = ['neu', 'kontaktiert', 'demo_vereinbart', 'verhandlung', 'abgeschlossen', 'abgelehnt'];
  const validLicenseStatuses = ['aktiv', 'gekuendigt', 'pausiert', 'abgelaufen'];

  app.patch("/api/admin/white-label/inquiries/:id", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      const { status, notes } = req.body;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }

      // Validate status if provided
      if (status && !validInquiryStatuses.includes(status)) {
        return res.status(400).json({ error: "Ungültiger Status" });
      }

      // Validate notes length
      if (notes && notes.length > 2000) {
        return res.status(400).json({ error: "Notizen zu lang (max. 2000 Zeichen)" });
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (status) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes?.trim() || null;
      
      const [updated] = await db.update(schema.whiteLabelInquiries)
        .set(updateData)
        .where(eq(schema.whiteLabelInquiries.id, id))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error('Admin White Label inquiry update error:', error);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    }
  });

  // Admin: Delete White Label inquiry
  app.delete("/api/admin/white-label/inquiries/:id", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }
      
      await db.delete(schema.whiteLabelInquiries)
        .where(eq(schema.whiteLabelInquiries.id, id));
      
      res.json({ message: "Anfrage gelöscht" });
    } catch (error) {
      console.error('Admin White Label inquiry delete error:', error);
      res.status(500).json({ error: "Fehler beim Löschen" });
    }
  });

  // Admin: List all White Label licenses
  app.get("/api/admin/white-label/licenses", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }
      
      const licenses = await db.select({
        license: schema.whiteLabelLicenses,
        organization: schema.organizations,
      })
        .from(schema.whiteLabelLicenses)
        .leftJoin(schema.organizations, eq(schema.whiteLabelLicenses.organizationId, schema.organizations.id))
        .orderBy(desc(schema.whiteLabelLicenses.createdAt));
      
      res.json(licenses);
    } catch (error) {
      console.error('Admin White Label licenses list error:', error);
      res.status(500).json({ error: "Fehler beim Laden der Lizenzen" });
    }
  });

  // Admin: Create White Label license
  app.post("/api/admin/white-label/licenses", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }

      const { organizationId, licenseName, monthlyPrice, setupFee, contractStart, contractEnd, customDomain, maxUsers, notes } = req.body;

      if (!organizationId || !licenseName || !contractStart) {
        return res.status(400).json({ error: "Organisation, Lizenzname und Vertragsbeginn sind erforderlich" });
      }

      // Validate string lengths
      if (licenseName.length > 100) {
        return res.status(400).json({ error: "Lizenzname zu lang (max. 100 Zeichen)" });
      }
      if (customDomain && customDomain.length > 100) {
        return res.status(400).json({ error: "Domain zu lang (max. 100 Zeichen)" });
      }
      if (notes && notes.length > 2000) {
        return res.status(400).json({ error: "Notizen zu lang (max. 2000 Zeichen)" });
      }

      // Validate numeric values
      const parsedMonthlyPrice = monthlyPrice ? parseFloat(monthlyPrice) : null;
      const parsedSetupFee = setupFee ? parseFloat(setupFee) : null;
      const parsedMaxUsers = maxUsers ? parseInt(maxUsers, 10) : null;

      if (monthlyPrice && (isNaN(parsedMonthlyPrice!) || parsedMonthlyPrice! < 0)) {
        return res.status(400).json({ error: "Ungültiger Monatspreis" });
      }
      if (setupFee && (isNaN(parsedSetupFee!) || parsedSetupFee! < 0)) {
        return res.status(400).json({ error: "Ungültige Setup-Gebühr" });
      }
      if (maxUsers && (isNaN(parsedMaxUsers!) || parsedMaxUsers! < 0)) {
        return res.status(400).json({ error: "Ungültige Benutzeranzahl" });
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(contractStart)) {
        return res.status(400).json({ error: "Ungültiges Datumsformat für Vertragsbeginn" });
      }
      if (contractEnd && !/^\d{4}-\d{2}-\d{2}$/.test(contractEnd)) {
        return res.status(400).json({ error: "Ungültiges Datumsformat für Vertragsende" });
      }
      
      const [license] = await db.insert(schema.whiteLabelLicenses)
        .values({
          organizationId,
          licenseName: licenseName.trim(),
          monthlyPrice: parsedMonthlyPrice?.toString() || null,
          setupFee: parsedSetupFee?.toString() || null,
          contractStart,
          contractEnd: contractEnd || null,
          customDomain: customDomain?.trim() || null,
          maxUsers: parsedMaxUsers,
          notes: notes?.trim() || null,
        })
        .returning();
      
      res.json(license);
    } catch (error) {
      console.error('Admin White Label license create error:', error);
      res.status(500).json({ error: "Fehler beim Erstellen der Lizenz" });
    }
  });

  // Admin: Update White Label license
  app.patch("/api/admin/white-label/licenses/:id", isAuthenticated, requireAdminAccess(), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      
      const [userRole] = await db.select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
        .limit(1);
      
      if (!userRole || userRole.role !== 'admin') {
        return res.status(403).json({ error: "Nur Administratoren" });
      }

      const { status, monthlyPrice, contractEnd, customDomain, maxUsers, notes } = req.body;

      // Validate status
      if (status && !validLicenseStatuses.includes(status)) {
        return res.status(400).json({ error: "Ungültiger Status" });
      }

      // Validate numeric values if provided
      if (monthlyPrice !== undefined && monthlyPrice !== '' && monthlyPrice !== null) {
        const parsed = parseFloat(monthlyPrice);
        if (isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Ungültiger Monatspreis" });
        }
      }
      if (maxUsers !== undefined && maxUsers !== '' && maxUsers !== null) {
        const parsed = parseInt(maxUsers, 10);
        if (isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Ungültige Benutzeranzahl" });
        }
      }

      // Validate string lengths
      if (customDomain && customDomain.length > 100) {
        return res.status(400).json({ error: "Domain zu lang" });
      }
      if (notes && notes.length > 2000) {
        return res.status(400).json({ error: "Notizen zu lang" });
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (status) updateData.status = status;
      if (monthlyPrice !== undefined) updateData.monthlyPrice = monthlyPrice || null;
      if (contractEnd !== undefined) updateData.contractEnd = contractEnd || null;
      if (customDomain !== undefined) updateData.customDomain = customDomain?.trim() || null;
      if (maxUsers !== undefined) updateData.maxUsers = maxUsers ? parseInt(maxUsers) : null;
      if (notes !== undefined) updateData.notes = notes;
      
      const [updated] = await db.update(schema.whiteLabelLicenses)
        .set(updateData)
        .where(eq(schema.whiteLabelLicenses.id, id))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error('Admin White Label license update error:', error);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    }
  });

  // ===== Job Queue Routes =====
  app.post("/api/jobs", isAuthenticated, requireRole("property_manager", "finance"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      const { type, payload } = req.body;
      if (!type) return res.status(400).json({ error: "Job type required" });
      const jobId = await jobQueueService.enqueue(type, payload || {}, profile?.organizationId, profile?.id);
      res.json({ jobId, status: 'pending' });
    } catch (error) {
      console.error("Job enqueue error:", error);
      res.status(500).json({ error: "Failed to enqueue job" });
    }
  });

  app.get("/api/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      const jobs = await jobQueueService.getJobsByOrganization(profile?.organizationId);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  app.get("/api/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      const job = await jobQueueService.getJobStatus(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.organizationId && job.organizationId !== profile?.organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch job status" });
    }
  });

  // ===== DSGVO / GDPR Routes =====
  app.get("/api/gdpr/export/:tenantId", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }
      const data = await exportTenantData(req.params.tenantId, profile.organizationId);
      res.json(data);
    } catch (error: any) {
      console.error("DSGVO export error:", error);
      res.status(error.message?.includes("gehört nicht") ? 403 : 500).json({
        error: error.message || "Fehler beim Datenexport",
      });
    }
  });

  app.post("/api/gdpr/anonymize/:tenantId", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) {
        return res.status(400).json({ error: "Keine Organisation zugeordnet" });
      }
      const result = await anonymizeTenantData(req.params.tenantId, profile.organizationId);
      res.json(result);
    } catch (error: any) {
      console.error("DSGVO anonymize error:", error);
      const status = error.message?.includes("gehört nicht") ? 403
        : error.message?.includes("bereits anonymisiert") ? 409
        : 500;
      res.status(status).json({
        error: error.message || "Fehler bei der Datenanonymisierung",
      });
    }
  });


  // ====== KI-AUTOPILOT ENDPOINTS ======

  // KI Autopilot status
  app.get("/api/user/ki-autopilot-status", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      if (!profile) return res.status(401).json({ error: "Nicht authentifiziert" });

      const roles = await storage.getUserRoles(profile.id);
      const isAdmin = roles.some(r => r.role === 'admin');

      res.json({
        active: isAdmin || !!(profile as any).kiAutopilotActive,
        trialEndsAt: null,
      });
    } catch (error) {
      console.error("KI Autopilot status error:", error);
      res.status(500).json({ error: "Fehler beim Abrufen des KI-Status" });
    }
  });

  // KI Chat endpoint
  app.post("/api/ki/chat", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Nachricht erforderlich" });

      const orgId = profile.organizationId;
      const [propCount] = await db.select({ count: count() }).from(schema.properties).where(eq(schema.properties.organizationId, orgId));
      const [unitCount] = await db.select({ count: count() })
        .from(schema.units)
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(eq(schema.properties.organizationId, orgId));

      const tenantRows = await db.select({ count: count() })
        .from(schema.tenants)
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(eq(schema.properties.organizationId, orgId), isNull(schema.tenants.deletedAt)));

      const openInvoiceRows = await db.select({ count: count() })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.units, eq(schema.monthlyInvoices.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(eq(schema.properties.organizationId, orgId), sql`${schema.monthlyInvoices.status} != 'bezahlt'`));

      const overdueRows = await db.select({ total: sql<string>`COALESCE(SUM(${schema.monthlyInvoices.gesamtbetrag}), 0)` })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.units, eq(schema.monthlyInvoices.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(eq(schema.properties.organizationId, orgId), sql`${schema.monthlyInvoices.status} != 'bezahlt'`, lt(schema.monthlyInvoices.faelligAm, sql`CURRENT_DATE`)));

      const kiClient = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await kiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du bist ein KI-Assistent für österreichische Hausverwaltung. Du hilfst bei Fragen zu Liegenschaften, Mietern, Zahlungen, Abrechnungen und österreichischem Mietrecht (MRG). Antworte immer auf Deutsch.

Kontext der aktuellen Organisation:
- ${propCount.count} Liegenschaften
- ${unitCount.count} Einheiten
- ${tenantRows[0].count} Mieter
- ${openInvoiceRows[0].count} offene Rechnungen
- ${overdueRows[0]?.total || '0'} EUR überfällige Zahlungen

Antworte hilfreich, präzise und in österreichischem Deutsch.`
          },
          { role: "user", content: message }
        ],
        max_tokens: 1000,
      });

      res.json({ response: completion.choices[0]?.message?.content || "Keine Antwort erhalten." });
    } catch (error) {
      console.error("KI Chat error:", error);
      res.status(500).json({ error: "Fehler bei der KI-Anfrage" });
    }
  });

  // Automation settings endpoints
  app.get("/api/automation/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const settings = await db.select().from(schema.automationSettings)
        .where(eq(schema.automationSettings.organizationId, profile.organizationId)).limit(1);

      res.json(settings[0] || null);
    } catch (error) {
      res.status(500).json({ error: "Fehler beim Abrufen der Einstellungen" });
    }
  });

  app.put("/api/automation/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const orgId = profile.organizationId;
      const existing = await db.select().from(schema.automationSettings)
        .where(eq(schema.automationSettings.organizationId, orgId)).limit(1);

      const data = {
        organizationId: orgId,
        autoInvoicingEnabled: req.body.autoInvoicingEnabled ?? false,
        invoicingDayOfMonth: req.body.invoicingDayOfMonth ?? 1,
        autoInvoicingEmail: req.body.autoInvoicingEmail ?? true,
        autoSepaGeneration: req.body.autoSepaGeneration ?? false,
        autoDunningEnabled: req.body.autoDunningEnabled ?? false,
        dunningDays1: req.body.dunningDays1 ?? 14,
        dunningDays2: req.body.dunningDays2 ?? 28,
        dunningDays3: req.body.dunningDays3 ?? 42,
        autoDunningEmail: req.body.autoDunningEmail ?? true,
        dunningInterestRate: req.body.dunningInterestRate ?? "4.00",
        updatedAt: new Date(),
      };

      if (existing[0]) {
        await db.update(schema.automationSettings).set(data).where(eq(schema.automationSettings.id, existing[0].id));
        const updated = await db.select().from(schema.automationSettings).where(eq(schema.automationSettings.id, existing[0].id)).limit(1);
        res.json(updated[0]);
      } else {
        const [created] = await db.insert(schema.automationSettings).values(data).returning();
        res.json(created);
      }
    } catch (error) {
      console.error("Automation settings save error:", error);
      res.status(500).json({ error: "Fehler beim Speichern der Einstellungen" });
    }
  });

  app.get("/api/automation/log", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.json([]);

      const logs = await db.select().from(schema.automationLog)
        .where(eq(schema.automationLog.organizationId, profile.organizationId))
        .orderBy(desc(schema.automationLog.createdAt))
        .limit(50);

      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Fehler beim Abrufen der Protokolle" });
    }
  });

  app.post("/api/automation/run-invoicing", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const orgId = profile.organizationId;
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const activeTenants = await db.select({
        tenant: schema.tenants,
        unitId: schema.units.id,
        unitTopNummer: schema.units.topNummer,
        propertyAddress: schema.properties.address,
      })
        .from(schema.tenants)
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(
          eq(schema.properties.organizationId, orgId),
          eq(schema.tenants.status, 'aktiv'),
          isNull(schema.tenants.deletedAt)
        ));

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of activeTenants) {
        const t = row.tenant;
        try {
          const existing = await db.select({ id: schema.monthlyInvoices.id })
            .from(schema.monthlyInvoices)
            .where(and(
              eq(schema.monthlyInvoices.unitId, t.unitId),
              eq(schema.monthlyInvoices.year, year),
              eq(schema.monthlyInvoices.month, month)
            )).limit(1);

          if (existing[0]) {
            skipped++;
            continue;
          }

          const grundmieteNetto = parseFloat(t.grundmiete || '0');
          const bkNetto = parseFloat(t.betriebskostenVorschuss || '0');
          const hkNetto = parseFloat(t.heizkostenVorschuss || '0');
          const wkNetto = parseFloat(t.wasserkostenVorschuss || '0');

          const ustMiete = grundmieteNetto * 0.10;
          const ustBk = bkNetto * 0.10;
          const ustHk = hkNetto * 0.20;
          const ustWk = wkNetto * 0.10;
          const totalUst = ustMiete + ustBk + ustHk + ustWk;
          const gesamtbetrag = grundmieteNetto + bkNetto + hkNetto + wkNetto + totalUst;

          const settings = await db.select().from(schema.automationSettings)
            .where(eq(schema.automationSettings.organizationId, orgId)).limit(1);
          const dayOfMonth = settings[0]?.invoicingDayOfMonth || 5;
          const dueDay = Math.min(dayOfMonth, 28);
          const faelligAm = `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;

          await db.insert(schema.monthlyInvoices).values({
            tenantId: t.id,
            unitId: t.unitId,
            year,
            month,
            grundmiete: String(grundmieteNetto),
            betriebskosten: String(bkNetto),
            heizungskosten: String(hkNetto),
            wasserkosten: String(wkNetto),
            ustSatzMiete: 10,
            ustSatzBk: 10,
            ustSatzHeizung: 20,
            ustSatzWasser: 10,
            ust: String(totalUst.toFixed(2)),
            gesamtbetrag: String(gesamtbetrag.toFixed(2)),
            status: 'offen',
            faelligAm,
          });

          created++;

          if (settings[0]?.autoInvoicingEmail && t.email) {
            try {
              const { sendEmail } = await import('./lib/resend');
              await sendEmail({
                to: t.email,
                subject: `Vorschreibung ${String(month).padStart(2, '0')}/${year}`,
                text: `Sehr geehrte/r ${t.firstName} ${t.lastName},\n\nIhre Vorschreibung für ${String(month).padStart(2, '0')}/${year} wurde erstellt.\n\nGesamtbetrag: \u20AC ${gesamtbetrag.toFixed(2)}\nFällig am: ${faelligAm}\n\nMit freundlichen Grüßen\nIhre Hausverwaltung`,
              });
            } catch (emailErr) {
              console.error('Email notification failed:', emailErr);
            }
          }
        } catch (err: any) {
          errors.push(`${t.firstName} ${t.lastName}: ${err.message}`);
        }
      }

      await db.update(schema.automationSettings)
        .set({ lastInvoicingRun: new Date() } as any)
        .where(eq(schema.automationSettings.organizationId, orgId));

      await db.insert(schema.automationLog).values({
        organizationId: orgId,
        type: "vorschreibung",
        status: errors.length > 0 ? "teilweise_erfolgreich" : "erfolgreich",
        details: `${created} Vorschreibungen erstellt, ${skipped} übersprungen (bereits vorhanden)${errors.length > 0 ? `, ${errors.length} Fehler` : ''}`,
        itemsProcessed: created,
      });

      res.json({
        success: true,
        created,
        skipped,
        errors: errors.length,
        message: `${created} Vorschreibungen für ${String(month).padStart(2, '0')}/${year} erstellt, ${skipped} übersprungen`,
      });
    } catch (error: any) {
      console.error("Run invoicing error:", error);
      res.status(500).json({ error: "Fehler beim Starten der Vorschreibung" });
    }
  });

  app.post("/api/automation/run-dunning", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const orgId = profile.organizationId;

      const settingsRows = await db.select().from(schema.automationSettings)
        .where(eq(schema.automationSettings.organizationId, orgId)).limit(1);
      const settings = settingsRows[0];
      const dunningRun = await automatedDunningService.processAutomatedDunning(
        orgId,
        settings?.autoDunningEmail === true,
      );
      const processed = dunningRun.processed;
      const emailsSent = dunningRun.emailsSent;
      const results = dunningRun.actions.map((action) =>
        `${action.tenantName}: Mahnstufe ${action.newLevel} (EUR ${action.amount.toFixed(2)} + EUR ${(action.fee + action.interest).toFixed(2)} Zuschläge)`,
      );

      if (settings) {
        await db.update(schema.automationSettings)
          .set({ lastDunningRun: new Date() } as any)
          .where(eq(schema.automationSettings.organizationId, orgId));
      }

      await db.insert(schema.automationLog).values({
        organizationId: orgId,
        type: "mahnlauf",
        status: "erfolgreich",
        details: `${processed} Mahnungen verarbeitet, ${emailsSent} E-Mails versendet`,
        itemsProcessed: processed,
      });

      res.json({
        success: true,
        processed,
        emailsSent,
        details: results,
        message: `${processed} Mahnungen verarbeitet, ${emailsSent} E-Mails versendet`,
      });
    } catch (error: any) {
      console.error("Run dunning error:", error);
      res.status(500).json({ error: "Fehler beim Starten des Mahnlaufs" });
    }
  });

  // KI Invoice OCR
  const kiOcrUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Nur Bilder und PDFs sind erlaubt'));
      }
    },
  });

  app.post("/api/ki/invoice-ocr", isAuthenticated, (req: Request, res: Response, next: any) => {
    kiOcrUpload.single('file')(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload fehlgeschlagen' });
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

      const base64Image = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype;
      const imageUrl = `data:${mimeType};base64,${base64Image}`;

      const kiClient = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await kiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analysiere diese Rechnung und extrahiere folgende Daten im JSON-Format:
{
  "lieferant": "Name des Lieferanten/Dienstleisters",
  "rechnungsnummer": "Rechnungsnummer",
  "rechnungsdatum": "Datum im Format YYYY-MM-DD",
  "bruttobetrag": Bruttobetrag als Zahl,
  "nettobetrag": Nettobetrag als Zahl,
  "ustBetrag": USt-Betrag als Zahl,
  "ustSatz": USt-Satz als Zahl (z.B. 20),
  "beschreibung": "Kurze Beschreibung der Leistung",
  "kategorie": "Vorgeschlagene Kategorie (z.B. Reparatur, Wartung, Verwaltung, Versicherung, Betriebskosten)",
  "validierung": {
    "confidence_score": 0.95,
    "unsichere_felder": [],
    "warnungen": [],
    "fehler": []
  }
}
confidence_score: 0.0–1.0. Setze ihn niedrig (< 0.7) wenn Felder unleserlich, abgeschnitten oder mehrdeutig sind.
Füge unsichere Feldnamen in unsichere_felder ein (z.B. ["betrag", "datum"]).
Antworte NUR mit dem JSON-Objekt, ohne zusätzlichen Text.`
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 500,
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      let parsed;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
      } catch {
        parsed = { error: "Konnte Rechnung nicht analysieren", raw: responseText };
      }

      // Pflichtfelder-Prüfung + needs_review Flag
      const kiVal = parsed.validierung ?? {};
      const kiConfidence = typeof kiVal.confidence_score === 'number' ? kiVal.confidence_score : 1.0;
      const kiNeedsReview =
        kiConfidence < 0.75 ||
        !parsed.bruttobetrag ||
        !parsed.rechnungsdatum ||
        !parsed.lieferant ||
        (kiVal.fehler?.length ?? 0) > 0 ||
        (kiVal.unsichere_felder?.length ?? 0) > 0;

      res.json({ ...parsed, needs_review: kiNeedsReview });
    } catch (error) {
      console.error("KI Invoice OCR error:", error);
      res.status(500).json({ error: "Fehler bei der Rechnungserkennung" });
    }
  });

  app.post("/api/ki/invoice-ocr/confirm", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const { lieferant, rechnungsnummer, rechnungsdatum, bruttobetrag, nettobetrag, ustBetrag, ustSatz, beschreibung, kategorie, propertyId } = req.body;

      if (!propertyId) {
        return res.status(400).json({ error: 'Bitte wählen Sie eine Liegenschaft aus' });
      }

      const property = await db.select().from(schema.properties)
        .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, profile.organizationId))).limit(1);
      if (!property[0]) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Liegenschaft' });
      }

      const invoiceDate = rechnungsdatum ? new Date(rechnungsdatum) : new Date();
      const [expense] = await db.insert(schema.expenses).values({
        propertyId,
        category: 'betriebskosten_umlagefaehig',
        bezeichnung: `${lieferant || 'Rechnung'}: ${beschreibung || rechnungsnummer || 'Keine Beschreibung'}`,
        betrag: String(bruttobetrag || 0),
        datum: rechnungsdatum || new Date().toISOString().split('T')[0],
        belegNummer: rechnungsnummer || null,
        year: invoiceDate.getFullYear(),
        month: invoiceDate.getMonth() + 1,
        notizen: `KI-erkannt: Lieferant: ${lieferant}, Netto: ${nettobetrag}, USt: ${ustBetrag} (${ustSatz}%)`,
      }).returning();

      res.json(expense);
    } catch (error) {
      console.error("KI Invoice confirm error:", error);
      res.status(500).json({ error: "Fehler beim Erstellen der Buchung" });
    }
  });

  // KI Insights / Anomaly Detection
  app.get("/api/ki/insights", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.json([]);

      const orgId = profile.organizationId;
      const insights: any[] = [];

      const overdueInvoices = await db.select({
        id: schema.monthlyInvoices.id,
        tenantId: schema.monthlyInvoices.tenantId,
        gesamtbetrag: schema.monthlyInvoices.gesamtbetrag,
        faelligAm: schema.monthlyInvoices.faelligAm,
        tenantFirstName: schema.tenants.firstName,
        tenantLastName: schema.tenants.lastName,
      })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.units, eq(schema.monthlyInvoices.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .leftJoin(schema.tenants, eq(schema.monthlyInvoices.tenantId, schema.tenants.id))
        .where(and(
          eq(schema.properties.organizationId, orgId),
          or(eq(schema.monthlyInvoices.status, 'offen'), eq(schema.monthlyInvoices.status, 'ueberfaellig')),
          lt(schema.monthlyInvoices.faelligAm, sql`CURRENT_DATE - INTERVAL '14 days'`)
        ))
        .limit(20);

      for (const inv of overdueInvoices) {
        const daysOverdue = inv.faelligAm ? Math.floor((Date.now() - new Date(inv.faelligAm).getTime()) / (1000*60*60*24)) : 0;
        insights.push({
          type: 'overdue_payment',
          severity: daysOverdue > 30 ? 'critical' : 'warning',
          title: `Überfällige Zahlung${inv.tenantFirstName ? ': ' + inv.tenantFirstName + ' ' + inv.tenantLastName : ''}`,
          description: `\u20AC ${parseFloat(inv.gesamtbetrag || '0').toFixed(2)} seit ${daysOverdue} Tagen überfällig (fällig am ${inv.faelligAm})`,
          entityId: inv.id,
          entityType: 'invoice',
        });
      }

      const expiringLeases = await db.select({
        id: schema.tenants.id,
        firstName: schema.tenants.firstName,
        lastName: schema.tenants.lastName,
        mietende: schema.tenants.mietende,
      })
        .from(schema.tenants)
        .innerJoin(schema.units, eq(schema.tenants.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .where(and(
          eq(schema.properties.organizationId, orgId),
          eq(schema.tenants.status, 'aktiv'),
          isNull(schema.tenants.deletedAt),
          sql`${schema.tenants.mietende} IS NOT NULL`,
          sql`${schema.tenants.mietende} <= CURRENT_DATE + INTERVAL '90 days'`,
          sql`${schema.tenants.mietende} >= CURRENT_DATE`
        ))
        .limit(20);

      for (const t of expiringLeases) {
        const daysLeft = t.mietende ? Math.floor((new Date(t.mietende).getTime() - Date.now()) / (1000*60*60*24)) : 0;
        insights.push({
          type: 'expiring_lease',
          severity: daysLeft <= 30 ? 'warning' : 'info',
          title: `Ablaufender Mietvertrag: ${t.firstName} ${t.lastName}`,
          description: `Vertrag endet am ${t.mietende} (noch ${daysLeft} Tage)`,
          entityId: t.id,
          entityType: 'tenant',
        });
      }

      const vacantUnits = await db.select({
        unitId: schema.units.id,
        topNummer: schema.units.topNummer,
        propertyAddress: schema.properties.address,
      })
        .from(schema.units)
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .leftJoin(schema.tenants, and(
          eq(schema.tenants.unitId, schema.units.id),
          eq(schema.tenants.status, 'aktiv'),
          isNull(schema.tenants.deletedAt)
        ))
        .where(and(
          eq(schema.properties.organizationId, orgId),
          isNull(schema.tenants.id)
        ))
        .limit(20);

      if (vacantUnits.length > 0) {
        insights.push({
          type: 'vacancy',
          severity: vacantUnits.length > 5 ? 'warning' : 'info',
          title: `Leerstand: ${vacantUnits.length} Einheit${vacantUnits.length > 1 ? 'en' : ''}`,
          description: vacantUnits.length <= 3
            ? `Leerstehend: ${vacantUnits.map(u => `${u.propertyAddress} Top ${u.topNummer}`).join(', ')}`
            : `${vacantUnits.length} Einheiten sind aktuell nicht vermietet`,
          entityId: null,
          entityType: 'property',
        });
      }

      const highBalanceTenants = await db.select({
        tenantId: schema.tenants.id,
        firstName: schema.tenants.firstName,
        lastName: schema.tenants.lastName,
        totalOpen: sql<string>`COALESCE(SUM(${schema.monthlyInvoices.gesamtbetrag}), 0)`,
        invoiceCount: count(),
      })
        .from(schema.monthlyInvoices)
        .innerJoin(schema.units, eq(schema.monthlyInvoices.unitId, schema.units.id))
        .innerJoin(schema.properties, eq(schema.units.propertyId, schema.properties.id))
        .innerJoin(schema.tenants, eq(schema.monthlyInvoices.tenantId, schema.tenants.id))
        .where(and(
          eq(schema.properties.organizationId, orgId),
          or(eq(schema.monthlyInvoices.status, 'offen'), eq(schema.monthlyInvoices.status, 'ueberfaellig'))
        ))
        .groupBy(schema.tenants.id, schema.tenants.firstName, schema.tenants.lastName)
        .having(sql`SUM(${schema.monthlyInvoices.gesamtbetrag}) > 500`)
        .limit(10);

      for (const t of highBalanceTenants) {
        const totalOpen = parseFloat(t.totalOpen || '0');
        insights.push({
          type: 'high_balance',
          severity: totalOpen > 2000 ? 'critical' : 'warning',
          title: `Hoher Rückstand: ${t.firstName} ${t.lastName}`,
          description: `\u20AC ${totalOpen.toFixed(2)} offen über ${t.invoiceCount} Rechnung${Number(t.invoiceCount) > 1 ? 'en' : ''}`,
          entityId: t.tenantId,
          entityType: 'tenant',
        });
      }

      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      insights.sort((a: any, b: any) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

      res.json(insights);
    } catch (error) {
      console.error("KI Insights error:", error);
      res.status(500).json({ error: "Fehler bei der Analyse" });
    }
  });

  // KI Communication - Generate Email
  app.post("/api/ki/generate-email", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      if (!profile?.organizationId) return res.status(400).json({ error: "Keine Organisation gefunden" });

      const { template, tenantId, propertyId, notes } = req.body;
      if (!template) return res.status(400).json({ error: "Vorlage erforderlich" });

      // Verify tenant belongs to user's org if provided
      if (tenantId) {
        const tenant = await db.select().from(schema.tenants)
          .where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.organizationId, profile.organizationId))).limit(1);
        if (!tenant[0]) {
          return res.status(403).json({ error: 'Keine Berechtigung für diesen Mieter' });
        }
      }

      // Verify property belongs to user's org if provided
      if (propertyId) {
        const property = await db.select().from(schema.properties)
          .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.organizationId, profile.organizationId))).limit(1);
        if (!property[0]) {
          return res.status(403).json({ error: 'Keine Berechtigung für diese Liegenschaft' });
        }
      }

      let tenantInfo = '';
      if (tenantId) {
        const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
        if (tenant[0]) {
          tenantInfo = `Mieter: ${tenant[0].firstName} ${tenant[0].lastName}, Adresse: ${tenant[0].address || 'k.A.'}`;
        }
      }

      let propertyInfo = '';
      if (propertyId) {
        const property = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
        if (property[0]) {
          propertyInfo = `Liegenschaft: ${property[0].address}, ${property[0].city}`;
        }
      }

      const templateMap: Record<string, string> = {
        mieterhoehung: 'Mieterhöhung gemäß MRG',
        kuendigung: 'Kündigung des Mietverhältnisses',
        bk_info: 'Information zur Betriebskostenabrechnung',
        mahnung: 'Zahlungserinnerung / Mahnung',
        wartung: 'Ankündigung von Wartungsarbeiten',
        allgemein: 'Allgemeine Mitteilung',
      };

      const kiClient = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await kiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du bist ein Assistent für österreichische Hausverwaltung. Erstelle professionelle E-Mails auf Deutsch (österreichisches Deutsch). Die E-Mails müssen höflich, rechtlich korrekt und MRG-konform sein.`
          },
          {
            role: "user",
            content: `Erstelle eine E-Mail zum Thema: ${templateMap[template] || template}
${tenantInfo}
${propertyInfo}
${notes ? `Zusätzliche Hinweise: ${notes}` : ''}

Antworte im JSON-Format: { "subject": "Betreff", "body": "E-Mail-Text" }`
          }
        ],
        max_tokens: 800,
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      let parsed;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
      } catch {
        parsed = { subject: templateMap[template] || 'Mitteilung', body: responseText };
      }

      res.json(parsed);
    } catch (error) {
      console.error("KI Email generation error:", error);
      res.status(500).json({ error: "Fehler bei der E-Mail-Generierung" });
    }
  });

  app.post("/api/ki/send-email", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireKiAutopilot(req, res))) return;

      const profile = await getProfileFromSession(req);
      const { to, subject, body, tenantId } = req.body;
      if (!to || !subject || !body) return res.status(400).json({ error: "Empfänger, Betreff und Text erforderlich" });

      // Verify tenant belongs to user's org if provided
      if (tenantId) {
        const tenant = await db.select().from(schema.tenants)
          .where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.organizationId, profile?.organizationId))).limit(1);
        if (!tenant[0]) {
          return res.status(403).json({ error: 'Keine Berechtigung für diesen Mieter' });
        }
      }

      // Zentrales Resend-Utility (Env-Key oder Replit-Connector); wirft bei Fehler.
      {
        const { sendEmail } = await import('./lib/resend');
        await sendEmail({
          to,
          subject,
          html: body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>'),
          text: body,
        });
      }

      res.json({ success: true, message: "E-Mail gesendet" });
    } catch (error) {
      console.error("KI Send email error:", error);
      res.status(500).json({ error: "Fehler beim Senden der E-Mail" });
    }
  });

  registerFunctionRoutes(app);
  registerStripeRoutes(app);
  registerScheduledReportRoutes(app);
  app.use(leaseExpiryRouter);

  jobQueueService.startPolling(5000);

  startScheduledReportChecker();
  startLeaseExpiryChecker();

  app.use(globalErrorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
