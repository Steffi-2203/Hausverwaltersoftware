/**
 * leaseExpiryRoutes.ts
 *
 * GET  /api/settings/lease-expiry  — read current notification settings
 * PUT  /api/settings/lease-expiry  — update notification settings (admin only)
 */

import { Router } from 'express';
import { db } from '../db';
import { organizations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { isAuthenticated, getProfileFromSession, requireAdminAccess } from './helpers';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings/lease-expiry
// ---------------------------------------------------------------------------
router.get(
  '/api/settings/lease-expiry',
  isAuthenticated,
  async (req, res) => {
    try {
      const profile = await getProfileFromSession(req as any);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: 'Keine Organisation zugeordnet' });
      }

      const [org] = await db
        .select({
          leaseExpiryNotificationsEnabled: organizations.leaseExpiryNotificationsEnabled,
          leaseExpiryThresholds: organizations.leaseExpiryThresholds,
        })
        .from(organizations)
        .where(eq(organizations.id, profile.organizationId));

      if (!org) return res.status(404).json({ error: 'Organisation nicht gefunden' });
      res.json(org);
    } catch (err) {
      console.error('[leaseExpiryRoutes] GET error:', err);
      res.status(500).json({ error: 'Einstellungen konnten nicht geladen werden' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/settings/lease-expiry  (admin only)
// ---------------------------------------------------------------------------
router.put(
  '/api/settings/lease-expiry',
  isAuthenticated,
  requireAdminAccess(),
  async (req, res) => {
    try {
      const profile = await getProfileFromSession(req as any);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: 'Keine Organisation zugeordnet' });
      }

      const { leaseExpiryNotificationsEnabled, leaseExpiryThresholds } = req.body as {
        leaseExpiryNotificationsEnabled: unknown;
        leaseExpiryThresholds: unknown;
      };

      if (typeof leaseExpiryNotificationsEnabled !== 'boolean') {
        return res.status(400).json({
          error: 'leaseExpiryNotificationsEnabled muss ein boolean sein',
        });
      }

      if (
        !Array.isArray(leaseExpiryThresholds) ||
        leaseExpiryThresholds.length === 0 ||
        leaseExpiryThresholds.some(
          (v) => typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 365,
        )
      ) {
        return res.status(400).json({
          error: 'leaseExpiryThresholds muss ein nicht-leeres Array ganzer Zahlen (1–365) sein',
        });
      }

      await db
        .update(organizations)
        .set({
          leaseExpiryNotificationsEnabled,
          leaseExpiryThresholds,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, profile.organizationId));

      res.json({ ok: true });
    } catch (err) {
      console.error('[leaseExpiryRoutes] PUT error:', err);
      res.status(500).json({ error: 'Einstellungen konnten nicht gespeichert werden' });
    }
  },
);

export default router;
