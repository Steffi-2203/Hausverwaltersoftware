import { rootDb as db } from "../db";
import { organizations, profiles } from "@shared/schema";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sql, eq } from "drizzle-orm";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrator';

export async function seedProductionDatabase(): Promise<void> {
  try {
    if (!ADMIN_EMAIL) {
      console.warn('[SEED] ADMIN_EMAIL nicht gesetzt — Produktions-Seed übersprungen');
      return;
    }
    const existingAdmin = await db.select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, ADMIN_EMAIL))
      .limit(1);
    
    if (existingAdmin.length > 0) {
      console.log('[SEED] Admin profile exists, skipping production seed');
      return;
    }

    console.log('[SEED] Admin profile missing, creating admin user...');

    let orgId: string;
    const existingOrgs = await db.select({ id: organizations.id }).from(organizations).limit(1);
    
    if (existingOrgs.length > 0) {
      orgId = existingOrgs[0].id;
      console.log('[SEED] Using existing organization');
    } else {
      orgId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO organizations (id, name, subscription_tier, subscription_status)
        VALUES (${orgId}, 'ImmoflowMe Admin', 'professional', 'active')
      `);
      console.log('[SEED] Created admin organization');
    }

    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(16).toString('base64url');
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const userId = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO profiles (id, email, password_hash, full_name, organization_id, subscription_tier)
      VALUES (${userId}, ${ADMIN_EMAIL}, ${passwordHash}, ${ADMIN_NAME}, ${orgId}, 'pro')
    `);
    console.log('[SEED] Created admin profile');

    await db.execute(sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${userId}, 'admin')
    `);
    console.log('[SEED] Assigned admin role');

    await db.execute(sql`
      INSERT INTO user_organizations (user_id, organization_id, role, is_default)
      VALUES (${userId}, ${orgId}, 'admin', true)
    `);
    console.log('[SEED] Created organization membership');

    await db.execute(sql`
      DELETE FROM login_attempts WHERE email = ${ADMIN_EMAIL}
    `);

    if (process.env.ADMIN_INITIAL_PASSWORD) {
      console.log('[SEED] Production seed complete. Admin created with provided password.');
    } else {
      console.log('[SEED] Production seed complete. Use password reset via email to set admin password.');
    }
  } catch (error) {
    console.error('[SEED] Production seed error:', error);
  }
}
