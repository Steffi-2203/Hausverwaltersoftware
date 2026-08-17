import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";
import { isAuthenticated, getProfileFromSession } from "./helpers";
import {
  createSignatureRequest,
  signDocument,
  declineSignature,
  verifySignature,
  getAuditTrail,
} from "../services/signatureService";

const router = Router();

async function getOrgId(req: any, res: Response): Promise<string | null> {
  const profile = await getProfileFromSession(req);
  if (!profile?.organizationId) {
    res.status(400).json({ error: "Keine Organisation gefunden" });
    return null;
  }
  return profile.organizationId;
}

router.get(
  "/api/signatures/requests",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const orgId = await getOrgId(req, res);
      if (!orgId) return;

      const requests = await db
        .select()
        .from(schema.signatureRequests)
        .where(eq(schema.signatureRequests.organizationId, orgId))
        .orderBy(desc(schema.signatureRequests.createdAt));

      const requestsWithSignatures = await Promise.all(
        requests.map(async (r) => {
          const sigs = await db
            .select()
            .from(schema.signatures)
            .where(eq(schema.signatures.requestId, r.id));

          let requestedByName: string | null = null;
          if (r.requestedBy) {
            const [profile] = await db
              .select({ fullName: schema.profiles.fullName })
              .from(schema.profiles)
              .where(eq(schema.profiles.id, r.requestedBy))
              .limit(1);
            requestedByName = profile?.fullName || null;
          }

          return { ...r, signatures: sigs, requestedByName };
        })
      );

      res.json(requestsWithSignatures);
    } catch (error) {
      console.error("Error fetching signature requests:", error);
      res.status(500).json({ error: "Fehler beim Laden der Signaturanfragen" });
    }
  }
);

router.post(
  "/api/signatures/requests",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const orgId = await getOrgId(req, res);
      if (!orgId) return;

      const profile = await getProfileFromSession(req);
      const { documentId, documentName, signerEmails, signatureType } =
        req.body;

      if (!documentId || !documentName || !signerEmails?.length) {
        return res.status(400).json({
          error: "documentId, documentName und signerEmails sind erforderlich",
        });
      }

      const request = await createSignatureRequest(
        orgId,
        documentId,
        documentName,
        profile!.id,
        signerEmails,
        signatureType || "simple"
      );

      res.json(request);
    } catch (error) {
      console.error("Error creating signature request:", error);
      res
        .status(500)
        .json({ error: "Fehler beim Erstellen der Signaturanfrage" });
    }
  }
);

router.get(
  "/api/signatures/requests/:id",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const orgId = await getOrgId(req, res);
      if (!orgId) return;

      const [request] = await db
        .select()
        .from(schema.signatureRequests)
        .where(
          and(
            eq(schema.signatureRequests.id, req.params.id),
            eq(schema.signatureRequests.organizationId, orgId)
          )
        )
        .limit(1);

      if (!request) {
        return res
          .status(404)
          .json({ error: "Signaturanfrage nicht gefunden" });
      }

      const sigs = await db
        .select()
        .from(schema.signatures)
        .where(eq(schema.signatures.requestId, request.id));

      let requestedByName: string | null = null;
      if (request.requestedBy) {
        const [profile] = await db
          .select({ fullName: schema.profiles.fullName })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, request.requestedBy))
          .limit(1);
        requestedByName = profile?.fullName || null;
      }

      res.json({ ...request, signatures: sigs, requestedByName });
    } catch (error) {
      console.error("Error fetching signature request:", error);
      res
        .status(500)
        .json({ error: "Fehler beim Laden der Signaturanfrage" });
    }
  }
);

router.post(
  "/api/signatures/sign/:requestId",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      const { signerName, signerEmail, signatureData } = req.body;

      if (!signerName || !signerEmail || !signatureData) {
        return res.status(400).json({
          error: "signerName, signerEmail und signatureData sind erforderlich",
        });
      }

      const ipAddress =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const signature = await signDocument(
        req.params.requestId,
        signerName,
        signerEmail,
        signatureData,
        ipAddress,
        userAgent,
        profile?.id
      );

      res.json(signature);
    } catch (error: any) {
      console.error("Error signing document:", error);
      res
        .status(500)
        .json({ error: error.message || "Fehler beim Unterschreiben" });
    }
  }
);

router.post(
  "/api/signatures/decline/:requestId",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const profile = await getProfileFromSession(req);
      const { signerEmail } = req.body;

      const email = signerEmail || profile?.email;
      if (!email) {
        return res.status(400).json({ error: "signerEmail ist erforderlich" });
      }

      await declineSignature(req.params.requestId, email);
      res.json({ success: true });
    } catch (error) {
      console.error("Error declining signature:", error);
      res.status(500).json({ error: "Fehler beim Ablehnen" });
    }
  }
);

router.get("/api/signatures/verify/:code", async (req: Request, res: Response) => {
  try {
    const result = await verifySignature(req.params.code);
    if (!result) {
      return res
        .status(404)
        .json({ error: "Verifizierungscode nicht gefunden" });
    }
    res.json(result);
  } catch (error) {
    console.error("Error verifying signature:", error);
    res.status(500).json({ error: "Fehler bei der Verifizierung" });
  }
});

router.get(
  "/api/signatures/audit/:requestId",
  isAuthenticated,
  async (req: any, res) => {
    try {
      const orgId = await getOrgId(req, res);
      if (!orgId) return;

      const [request] = await db
        .select()
        .from(schema.signatureRequests)
        .where(
          and(
            eq(schema.signatureRequests.id, req.params.requestId),
            eq(schema.signatureRequests.organizationId, orgId)
          )
        )
        .limit(1);

      if (!request) {
        return res
          .status(404)
          .json({ error: "Signaturanfrage nicht gefunden" });
      }

      const audit = await getAuditTrail(req.params.requestId);
      res.json(audit);
    } catch (error) {
      console.error("Error fetching audit trail:", error);
      res.status(500).json({ error: "Fehler beim Laden des Audit-Trails" });
    }
  }
);

export function registerSignatureRoutes(app: any) {
  app.use(router);
}
