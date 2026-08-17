import { Router, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, max } from "drizzle-orm";
import * as schema from "@shared/schema";
import { isAuthenticated, getProfileFromSession } from "./helpers";
import multer from "multer";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function getOrgId(req: any, res: Response): Promise<string | null> {
  const profile = await getProfileFromSession(req);
  if (!profile?.organizationId) {
    res.status(400).json({ error: "Keine Organisation gefunden" });
    return null;
  }
  return profile.organizationId;
}

router.get("/api/documents/versions/:documentId", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const documentId = decodeURIComponent(req.params.documentId);
    const versions = await db.select()
      .from(schema.documentVersions)
      .where(and(
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.organizationId, orgId)
      ))
      .orderBy(desc(schema.documentVersions.versionNumber));

    const versionsWithUploader = await Promise.all(versions.map(async (v) => {
      let uploaderName = null;
      if (v.uploadedBy) {
        const profile = await db.select({ fullName: schema.profiles.fullName })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, v.uploadedBy))
          .limit(1);
        uploaderName = profile[0]?.fullName || null;
      }
      return { ...v, uploaderName };
    }));

    res.json(versionsWithUploader);
  } catch (error) {
    console.error("Error fetching document versions:", error);
    res.status(500).json({ error: "Fehler beim Laden der Versionen" });
  }
});

router.post("/api/documents/versions", isAuthenticated, upload.single("file"), async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const { documentId, changeNote } = req.body;
    if (!documentId || !req.file) {
      return res.status(400).json({ error: "documentId und Datei sind erforderlich" });
    }

    const existing = await db.select({ maxVersion: max(schema.documentVersions.versionNumber) })
      .from(schema.documentVersions)
      .where(and(
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.organizationId, orgId)
      ));

    const nextVersion = (existing[0]?.maxVersion || 0) + 1;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const storagePath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": req.file.mimetype },
      body: req.file.buffer,
    });

    const userId = req.session?.userId;

    const [version] = await db.insert(schema.documentVersions).values({
      documentId,
      organizationId: orgId,
      versionNumber: nextVersion,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      storagePath,
      uploadedBy: userId || null,
      changeNote: changeNote || null,
    }).returning();

    res.json(version);
  } catch (error) {
    console.error("Error creating document version:", error);
    res.status(500).json({ error: "Fehler beim Erstellen der Version" });
  }
});

router.get("/api/documents/tags", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const tags = await db.select()
      .from(schema.documentTags)
      .where(eq(schema.documentTags.organizationId, orgId))
      .orderBy(schema.documentTags.name);

    res.json(tags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ error: "Fehler beim Laden der Tags" });
  }
});

router.post("/api/documents/tags", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name ist erforderlich" });
    }

    const [tag] = await db.insert(schema.documentTags).values({
      organizationId: orgId,
      name,
      color: color || null,
    }).returning();

    res.json(tag);
  } catch (error) {
    console.error("Error creating tag:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des Tags" });
  }
});

router.patch("/api/documents/tags/:id", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const { name, color } = req.body;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (color !== undefined) updateData.color = color;

    const [tag] = await db.update(schema.documentTags)
      .set(updateData)
      .where(and(
        eq(schema.documentTags.id, req.params.id),
        eq(schema.documentTags.organizationId, orgId)
      ))
      .returning();

    if (!tag) {
      return res.status(404).json({ error: "Tag nicht gefunden" });
    }

    res.json(tag);
  } catch (error) {
    console.error("Error updating tag:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Tags" });
  }
});

router.delete("/api/documents/tags/:id", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    await db.delete(schema.documentTagAssignments)
      .where(eq(schema.documentTagAssignments.tagId, req.params.id));

    const [deleted] = await db.delete(schema.documentTags)
      .where(and(
        eq(schema.documentTags.id, req.params.id),
        eq(schema.documentTags.organizationId, orgId)
      ))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Tag nicht gefunden" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting tag:", error);
    res.status(500).json({ error: "Fehler beim Löschen des Tags" });
  }
});

router.post("/api/documents/:documentId/tags", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const documentId = decodeURIComponent(req.params.documentId);
    const { tagIds } = req.body;

    if (!Array.isArray(tagIds) || tagIds.length === 0) {
      return res.status(400).json({ error: "tagIds Array ist erforderlich" });
    }

    const tags = await db.select()
      .from(schema.documentTags)
      .where(eq(schema.documentTags.organizationId, orgId));
    const validTagIds = new Set(tags.map(t => t.id));

    const toInsert = tagIds
      .filter((id: string) => validTagIds.has(id))
      .map((tagId: string) => ({ documentId, tagId }));

    if (toInsert.length > 0) {
      await db.insert(schema.documentTagAssignments)
        .values(toInsert)
        .onConflictDoNothing();
    }

    const assignments = await db.select()
      .from(schema.documentTagAssignments)
      .where(eq(schema.documentTagAssignments.documentId, documentId));

    res.json(assignments);
  } catch (error) {
    console.error("Error assigning tags:", error);
    res.status(500).json({ error: "Fehler beim Zuweisen der Tags" });
  }
});

router.delete("/api/documents/:documentId/tags/:tagId", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const documentId = decodeURIComponent(req.params.documentId);

    const tag = await db.select()
      .from(schema.documentTags)
      .where(and(
        eq(schema.documentTags.id, req.params.tagId),
        eq(schema.documentTags.organizationId, orgId)
      ))
      .limit(1);

    if (!tag.length) {
      return res.status(404).json({ error: "Tag nicht gefunden" });
    }

    await db.delete(schema.documentTagAssignments)
      .where(and(
        eq(schema.documentTagAssignments.documentId, documentId),
        eq(schema.documentTagAssignments.tagId, req.params.tagId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing tag:", error);
    res.status(500).json({ error: "Fehler beim Entfernen des Tags" });
  }
});

router.get("/api/documents/:documentId/tags", isAuthenticated, async (req: any, res) => {
  try {
    const orgId = await getOrgId(req, res);
    if (!orgId) return;

    const documentId = decodeURIComponent(req.params.documentId);

    const assignments = await db.select({
      assignment: schema.documentTagAssignments,
      tag: schema.documentTags,
    })
      .from(schema.documentTagAssignments)
      .innerJoin(schema.documentTags, eq(schema.documentTagAssignments.tagId, schema.documentTags.id))
      .where(and(
        eq(schema.documentTagAssignments.documentId, documentId),
        eq(schema.documentTags.organizationId, orgId)
      ));

    res.json(assignments.map(a => a.tag));
  } catch (error) {
    console.error("Error fetching document tags:", error);
    res.status(500).json({ error: "Fehler beim Laden der Dokument-Tags" });
  }
});

export function registerDocumentRoutes(app: any) {
  app.use(router);
}

export default router;
