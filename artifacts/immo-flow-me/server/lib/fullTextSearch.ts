import { pool } from "../db";

const TRGM_INDEXES = [
  { name: 'idx_properties_name_trgm', table: 'properties', column: 'name' },
  { name: 'idx_properties_address_trgm', table: 'properties', column: 'address' },
  { name: 'idx_properties_city_trgm', table: 'properties', column: 'city' },
  { name: 'idx_properties_postal_code_trgm', table: 'properties', column: 'postal_code' },
  { name: 'idx_units_top_nummer_trgm', table: 'units', column: 'top_nummer' },
  { name: 'idx_tenants_first_name_trgm', table: 'tenants', column: 'first_name' },
  { name: 'idx_tenants_last_name_trgm', table: 'tenants', column: 'last_name' },
  { name: 'idx_tenants_email_trgm', table: 'tenants', column: 'email' },
];

export async function setupFullTextSearch() {
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    if (isProduction) {
      for (const idx of TRGM_INDEXES) {
        try {
          await client.query(
            `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} USING gin (${idx.column} gin_trgm_ops)`
          );
        } catch (e: any) {
          console.warn(`Skipping index ${idx.name}: ${e.message}`);
        }
      }
      console.log("Full-text search with pg_trgm initialized (production, indexes created)");
    } else {
      console.log("Full-text search with pg_trgm initialized (development, GIN indexes skipped to avoid migration conflicts)");
    }

    await client.query(`SET pg_trgm.similarity_threshold = 0.1`);
  } catch (error: any) {
    console.warn("Full-text search setup warning:", error.message);
  } finally {
    client.release();
  }
}

export async function dropTrgmIndexes() {
  const client = await pool.connect();
  try {
    for (const idx of TRGM_INDEXES) {
      await client.query(`DROP INDEX IF EXISTS ${idx.name}`);
    }
    console.log("Trigram GIN indexes dropped (pre-deploy cleanup)");
  } catch (error: any) {
    console.warn("Failed to drop trigram indexes:", error.message);
  } finally {
    client.release();
  }
}
