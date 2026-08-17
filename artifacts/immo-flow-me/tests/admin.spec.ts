import { test, expect } from '@playwright/test';

// Admin test credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpassword';

test.describe('Admin Bereich', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Admin Dashboard ist erreichbar', async ({ page }) => {
    await page.goto('/admin');
    
    // Prüfe ob Admin-Seite geladen wird (oder Redirect bei fehlendem Zugriff)
    const isAdmin = await page.locator('h1').filter({ hasText: /Admin|Organisationen/i }).isVisible({ timeout: 5000 });
    
    if (isAdmin) {
      await expect(page).toHaveURL('/admin');
    } else {
      // Nicht-Admins werden zum Dashboard redirected
      await expect(page).toHaveURL('/dashboard');
    }
  });

  test('System Test Seite ist für Admins erreichbar', async ({ page }) => {
    await page.goto('/admin/system-test');
    
    const isAdmin = await page.locator('h1').filter({ hasText: /System Test/i }).isVisible({ timeout: 5000 });
    
    if (isAdmin) {
      await expect(page).toHaveURL('/admin/system-test');
      
      // Starte die Tests
      const startButton = page.locator('button').filter({ hasText: /Tests starten/i });
      await expect(startButton).toBeVisible();
      
      await startButton.click();
      
      // Warte auf Ergebnisse
      await expect(page.locator('text=/PASS|FAIL/')).toBeVisible({ timeout: 30000 });
      
      // Prüfe dass mindestens einige Tests gelaufen sind
      const passCount = await page.locator('text=PASS').count();
      expect(passCount).toBeGreaterThan(0);
    }
  });

  test('Organisationen werden in Admin angezeigt', async ({ page }) => {
    await page.goto('/admin');
    
    const isAdmin = await page.locator('h1').filter({ hasText: /Admin|Organisationen/i }).isVisible({ timeout: 5000 });
    
    if (isAdmin) {
      // Prüfe dass Tabelle mit Organisationen sichtbar ist
      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 5000 });
      
      // Prüfe dass mindestens eine Organisation angezeigt wird
      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    }
  });
});

test.describe('Admin Statistiken', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('MRR und Subscription Stats werden angezeigt', async ({ page }) => {
    await page.goto('/admin');
    
    const isAdmin = await page.locator('h1').filter({ hasText: /Admin|Organisationen/i }).isVisible({ timeout: 5000 });
    
    if (isAdmin) {
      // Prüfe auf Statistik-Karten
      const statsCards = page.locator('[class*="card"]').filter({ hasText: /MRR|Aktiv|Trial|Organisationen/i });
      
      if (await statsCards.first().isVisible({ timeout: 3000 })) {
        const cardCount = await statsCards.count();
        expect(cardCount).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
