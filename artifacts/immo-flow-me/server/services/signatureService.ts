import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { createHash, randomBytes } from "crypto";
import { sendEmail } from "../lib/resend";

export function generateSignatureHash(documentContent: string): string {
  return createHash("sha256").update(documentContent).digest("hex");
}

export function generateVerificationCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export async function createSignatureRequest(
  orgId: string,
  documentId: string,
  documentName: string,
  requestedById: string,
  signerEmails: string[],
  signatureType: string = "simple"
) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [request] = await db
    .insert(schema.signatureRequests)
    .values({
      organizationId: orgId,
      documentId,
      documentName,
      requestedBy: requestedById,
      status: "pending",
      signatureType,
      expiresAt,
    })
    .returning();

  for (const email of signerEmails) {
    const verificationCode = generateVerificationCode();
    await db.insert(schema.signatures).values({
      requestId: request.id,
      signerName: email.split("@")[0],
      signerEmail: email,
      verificationCode,
    });

    try {
      await sendEmail({
        to: email,
        subject: `Signaturanfrage: ${documentName} - ImmoFlowMe`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a365d;">Signaturanfrage</h2>
            <p>Sie wurden gebeten, das folgende Dokument zu unterschreiben:</p>
            <p><strong>${documentName}</strong></p>
            <p>Signaturtyp: <strong>${signatureType === "simple" ? "Einfach" : signatureType === "advanced" ? "Fortgeschritten" : "Qualifiziert"}</strong></p>
            <p>Bitte melden Sie sich bei ImmoFlowMe an, um das Dokument zu unterschreiben.</p>
            <p style="color: #666; font-size: 14px;">Verifizierungscode: ${verificationCode}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #999; font-size: 12px;">ImmoFlowMe - Elektronische Signatur</p>
          </div>
        `,
      });
    } catch (err) {
      console.error(`[Signatures] Failed to send email to ${email}:`, err);
    }
  }

  return request;
}

export async function signDocument(
  requestId: string,
  signerName: string,
  signerEmail: string,
  signatureData: string,
  ipAddress: string,
  userAgent: string,
  signerId?: string
) {
  const documentHash = generateSignatureHash(
    `${requestId}:${signerEmail}:${Date.now()}`
  );

  const existing = await db
    .select()
    .from(schema.signatures)
    .where(
      and(
        eq(schema.signatures.requestId, requestId),
        eq(schema.signatures.signerEmail, signerEmail)
      )
    )
    .limit(1);

  if (existing.length > 0 && existing[0].signedAt) {
    throw new Error("Dokument wurde bereits unterschrieben");
  }

  const verificationCode =
    existing.length > 0 && existing[0].verificationCode
      ? existing[0].verificationCode
      : generateVerificationCode();

  let signature;
  if (existing.length > 0) {
    [signature] = await db
      .update(schema.signatures)
      .set({
        signerName,
        signerId: signerId || null,
        signedAt: new Date(),
        ipAddress,
        userAgent,
        signatureHash: documentHash,
        signatureData,
        verificationCode,
      })
      .where(eq(schema.signatures.id, existing[0].id))
      .returning();
  } else {
    [signature] = await db
      .insert(schema.signatures)
      .values({
        requestId,
        signerId: signerId || null,
        signerName,
        signerEmail,
        signedAt: new Date(),
        ipAddress,
        userAgent,
        signatureHash: documentHash,
        signatureData,
        verificationCode,
      })
      .returning();
  }

  const allSignatures = await db
    .select()
    .from(schema.signatures)
    .where(eq(schema.signatures.requestId, requestId));

  const allSigned = allSignatures.every((s) => s.signedAt !== null);
  if (allSigned) {
    await db
      .update(schema.signatureRequests)
      .set({ status: "signed" })
      .where(eq(schema.signatureRequests.id, requestId));
  }

  return signature;
}

export async function declineSignature(
  requestId: string,
  signerEmail: string
) {
  const existing = await db
    .select()
    .from(schema.signatures)
    .where(
      and(
        eq(schema.signatures.requestId, requestId),
        eq(schema.signatures.signerEmail, signerEmail)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.signatures)
      .set({ signedAt: null, signatureData: null, signatureHash: "DECLINED" })
      .where(eq(schema.signatures.id, existing[0].id));
  }

  await db
    .update(schema.signatureRequests)
    .set({ status: "declined" })
    .where(eq(schema.signatureRequests.id, requestId));
}

export async function verifySignature(verificationCode: string) {
  const [signature] = await db
    .select()
    .from(schema.signatures)
    .where(eq(schema.signatures.verificationCode, verificationCode))
    .limit(1);

  if (!signature) return null;

  const [request] = await db
    .select()
    .from(schema.signatureRequests)
    .where(eq(schema.signatureRequests.id, signature.requestId))
    .limit(1);

  return {
    valid: !!signature.signedAt,
    signature: {
      signerName: signature.signerName,
      signerEmail: signature.signerEmail,
      signedAt: signature.signedAt,
      signatureHash: signature.signatureHash,
      ipAddress: signature.ipAddress,
    },
    document: request
      ? {
          documentName: request.documentName,
          documentId: request.documentId,
          signatureType: request.signatureType,
          status: request.status,
        }
      : null,
  };
}

export async function getAuditTrail(requestId: string) {
  const [request] = await db
    .select()
    .from(schema.signatureRequests)
    .where(eq(schema.signatureRequests.id, requestId))
    .limit(1);

  if (!request) return null;

  let requestedByName: string | null = null;
  if (request.requestedBy) {
    const [profile] = await db
      .select({ fullName: schema.profiles.fullName })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, request.requestedBy))
      .limit(1);
    requestedByName = profile?.fullName || null;
  }

  const sigs = await db
    .select()
    .from(schema.signatures)
    .where(eq(schema.signatures.requestId, requestId))
    .orderBy(desc(schema.signatures.createdAt));

  const events: Array<{
    timestamp: Date | null;
    action: string;
    actor: string;
    details: Record<string, any>;
  }> = [];

  events.push({
    timestamp: request.createdAt,
    action: "Signaturanfrage erstellt",
    actor: requestedByName || "System",
    details: {
      documentName: request.documentName,
      signatureType: request.signatureType,
      expiresAt: request.expiresAt,
    },
  });

  for (const sig of sigs) {
    events.push({
      timestamp: sig.createdAt,
      action: "Unterzeichner eingeladen",
      actor: "System",
      details: {
        signerName: sig.signerName,
        signerEmail: sig.signerEmail,
      },
    });

    if (sig.signedAt) {
      if (sig.signatureHash === "DECLINED") {
        events.push({
          timestamp: sig.signedAt,
          action: "Unterschrift abgelehnt",
          actor: sig.signerName,
          details: { signerEmail: sig.signerEmail },
        });
      } else {
        events.push({
          timestamp: sig.signedAt,
          action: "Dokument unterschrieben",
          actor: sig.signerName,
          details: {
            signerEmail: sig.signerEmail,
            ipAddress: sig.ipAddress,
            userAgent: sig.userAgent,
            signatureHash: sig.signatureHash,
            verificationCode: sig.verificationCode,
          },
        });
      }
    }
  }

  events.sort(
    (a, b) =>
      new Date(a.timestamp || 0).getTime() -
      new Date(b.timestamp || 0).getTime()
  );

  return { request, signatures: sigs, events };
}
