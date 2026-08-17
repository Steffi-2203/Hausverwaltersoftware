import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "../db";
import { idempotencyKeys } from "@shared/schema";
import { eq, lt } from "drizzle-orm";

function hashBody(body: any): string {
  const str = JSON.stringify(body || {});
  return crypto.createHash("sha256").update(str).digest("hex");
}

let lastCleanup = 0;
const CLEANUP_INTERVAL = 60 * 60 * 1000;

async function cleanupExpiredKeys() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  try {
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  } catch (err) {
    console.error("Idempotency cleanup error:", err);
  }
}

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(method)) {
    return next();
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
  if (!idempotencyKey) {
    return next();
  }

  const requestHash = hashBody(req.body);
  const endpoint = req.originalUrl || req.url;
  const orgId = (req as any).session?.organizationId || null;

  cleanupExpiredKeys().catch(() => {});

  (async () => {
    try {
      const existing = await db.select().from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        const record = existing[0];

        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
          await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, record.id));
        } else {
          if (record.requestHash && record.requestHash !== requestHash) {
            return res.status(422).json({
              error: "Idempotency key reuse with different request body",
            });
          }

          if (record.responseStatus !== null && record.responseBody !== null) {
            return res.status(record.responseStatus).json(record.responseBody);
          }
        }
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insert(idempotencyKeys).values({
        key: idempotencyKey,
        organizationId: orgId,
        endpoint,
        requestHash,
        expiresAt,
      }).onConflictDoNothing();

      const originalJson = res.json.bind(res);
      res.json = function (body: any) {
        const statusCode = res.statusCode;

        db.update(idempotencyKeys)
          .set({
            responseStatus: statusCode,
            responseBody: body,
          })
          .where(eq(idempotencyKeys.key, idempotencyKey))
          .catch((err) => {
            console.error("Failed to store idempotency response:", err);
          });

        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error("Idempotency middleware error:", err);
      next();
    }
  })();
}
