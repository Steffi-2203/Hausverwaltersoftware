import { Router, Request, Response } from "express";
import { isAuthenticated, getProfileFromSession } from "./helpers";

const router = Router();

interface SearchResult {
  type: "property" | "unit" | "tenant";
  id: string;
  label: string;
  sublabel: string;
  score: number;
}

router.get("/api/search", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileFromSession(req);
    if (!profile?.organizationId) {
      return res.status(400).json({ error: "Keine Organisation gefunden" });
    }

    // Alle Abfragen laufen über die RLS-gebundene Verbindung aus rlsMiddleware.
    // req.dbClient ist ein appPool-Client mit gesetztem app.current_org,
    // sodass RLS auch für die Rohtext-Suche greift.
    const client = (req as any).dbClient;
    if (!client) {
      return res.status(500).json({ error: "Kein Datenbankkontext (kein orgContext)" });
    }

    const q = (req.query.q as string || "").trim();
    const type = (req.query.type as string || "all").toLowerCase();

    if (!q || q.length < 1) {
      return res.json({ results: [] });
    }

    const orgId = profile.organizationId;
    const results: SearchResult[] = [];

    if (type === "all" || type === "property") {
      const propertyResults = await client.query(
        `SELECT p.id, p.name as label, 
                COALESCE(p.address, '') || ', ' || COALESCE(p.postal_code, '') || ' ' || COALESCE(p.city, '') as sublabel,
                'property' as type,
                GREATEST(
                  similarity(COALESCE(p.name, ''), $1),
                  similarity(COALESCE(p.address, ''), $1),
                  similarity(COALESCE(p.city, ''), $1),
                  similarity(COALESCE(p.postal_code, ''), $1)
                ) as score
         FROM properties p
         WHERE p.organization_id = $2
           AND p.deleted_at IS NULL
           AND (
             COALESCE(p.name, '') % $1
             OR COALESCE(p.address, '') % $1
             OR COALESCE(p.city, '') % $1
             OR COALESCE(p.postal_code, '') % $1
             OR COALESCE(p.name, '') ILIKE '%' || $1 || '%'
             OR COALESCE(p.address, '') ILIKE '%' || $1 || '%'
             OR COALESCE(p.city, '') ILIKE '%' || $1 || '%'
           )
         ORDER BY score DESC
         LIMIT 20`,
        [q, orgId]
      );
      results.push(...propertyResults.rows);
    }

    if (type === "all" || type === "unit") {
      const unitResults = await client.query(
        `SELECT u.id,
                u.property_id as "propertyId",
                'Top ' || u.top_nummer as label,
                COALESCE(p.name, '') || ' - ' || COALESCE(p.address, '') as sublabel,
                'unit' as type,
                GREATEST(
                  similarity(COALESCE(u.top_nummer, ''), $1),
                  similarity(COALESCE(p.name, ''), $1)
                ) as score
         FROM units u
         INNER JOIN properties p ON u.property_id = p.id
         WHERE p.organization_id = $2
           AND u.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND (
             COALESCE(u.top_nummer, '') % $1
             OR COALESCE(u.top_nummer, '') ILIKE '%' || $1 || '%'
             OR COALESCE(p.name, '') ILIKE '%' || $1 || '%'
           )
         ORDER BY score DESC
         LIMIT 20`,
        [q, orgId]
      );
      results.push(...unitResults.rows);
    }

    if (type === "all" || type === "tenant") {
      const tenantResults = await client.query(
        `SELECT t.id,
                COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '') as label,
                'Top ' || COALESCE(u.top_nummer, '') || ' - ' || COALESCE(p.name, '') as sublabel,
                'tenant' as type,
                GREATEST(
                  similarity(COALESCE(t.first_name, ''), $1),
                  similarity(COALESCE(t.last_name, ''), $1),
                  similarity(COALESCE(t.email, ''), $1),
                  similarity(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, ''), $1)
                ) as score
         FROM tenants t
         INNER JOIN units u ON t.unit_id = u.id
         INNER JOIN properties p ON u.property_id = p.id
         WHERE p.organization_id = $2
           AND t.deleted_at IS NULL
           AND u.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND (
             COALESCE(t.first_name, '') % $1
             OR COALESCE(t.last_name, '') % $1
             OR COALESCE(t.email, '') % $1
             OR (COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) % $1
             OR COALESCE(t.first_name, '') ILIKE '%' || $1 || '%'
             OR COALESCE(t.last_name, '') ILIKE '%' || $1 || '%'
             OR COALESCE(t.email, '') ILIKE '%' || $1 || '%'
           )
         ORDER BY score DESC
         LIMIT 20`,
        [q, orgId]
      );
      results.push(...tenantResults.rows);
    }

    results.sort((a, b) => b.score - a.score);

    res.json({ results });
  } catch (error: any) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Fehler bei der Suche" });
  }
});

export default router;
