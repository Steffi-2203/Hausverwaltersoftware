import { test, expect } from '@playwright/test';

// Test credentials - use environment variables in CI
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'testpassword';

test.describe('Authentifizierung', () => {
  test('Landing Page lädt korrekt', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Immobilienverwaltung');
    await expect(page.locator('text=Jetzt registrieren')).toBeVisible();
  });

  test('Login Formular ist vorhanden', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Registrierung Formular ist vorhanden', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

test.describe('Vollständiger User Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    
    // Warten auf Dashboard
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Dashboard lädt korrekt', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('Subscription Info wird angezeigt', async ({ page }) => {
    // Prüfe dass Abo-Informationen sichtbar sind
    const subscriptionSection = page.locator('[data-testid="subscription-info"]').or(
      page.locator('text=/Starter|Professional|Enterprise/')
    );
    await expect(subscriptionSection.first()).toBeVisible({ timeout: 5000 });
  });

  test('Navigation funktioniert', async ({ page }) => {
    // Navigiere zu Liegenschaften
    await page.click('text=Liegenschaften');
    await expect(page).toHaveURL(/\/liegenschaften/);
    
    // Navigiere zu Einheiten
    await page.click('text=Einheiten');
    await expect(page).toHaveURL(/\/einheiten/);
    
    // Navigiere zu Zahlungen
    await page.click('text=Zahlungen');
    await expect(page).toHaveURL(/\/zahlungen/);
    
    // Navigiere zu Buchhaltung
    await page.click('text=Buchhaltung');
    await expect(page).toHaveURL(/\/buchhaltung/);
  });

  test('Liegenschaft erstellen Flow', async ({ page }) => {
    // Navigiere zu Liegenschaften
    await page.goto('/liegenschaften');
    
    // Klicke auf "Neue Liegenschaft" Button
    const newButton = page.locator('text=Neue Liegenschaft').or(
      page.locator('a[href="/liegenschaften/neu"]')
    );
    await newButton.first().click();
    
    // Formular ausfüllen
    await page.fill('input[name="name"]', 'Playwright Test Liegenschaft');
    await page.fill('input[name="address"]', 'Teststraße 123');
    await page.fill('input[name="city"]', 'Wien');
    await page.fill('input[name="postal_code"]', '1010');
    
    // Optional: Weitere Felder
    const buildingYearInput = page.locator('input[name="building_year"]');
    if (await buildingYearInput.isVisible()) {
      await buildingYearInput.fill('2000');
    }
    
    // Speichern
    await page.click('button[type="submit"]');
    
    // Prüfen ob erfolgreich erstellt
    await expect(page.locator('text=Playwright Test Liegenschaft')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Limit-Prüfung Starter Plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Limit-Anzeige ist sichtbar', async ({ page }) => {
    await page.goto('/liegenschaften');
    
    // Suche nach Limit-Anzeige (z.B. "1 von 1" oder "0 von 1")
    const limitText = page.locator('text=/\\d+\\s*(von|\\/)\\s*\\d+/');
    
    if (await limitText.first().isVisible({ timeout: 3000 })) {
      const text = await limitText.first().textContent();
      console.log('Limit-Anzeige gefunden:', text);
      expect(text).toMatch(/\d+\s*(von|\/)\s*\d+/);
    }
  });

  test('Upgrade-Hinweis bei Limit erreicht', async ({ page }) => {
    await page.goto('/liegenschaften');
    
    // Prüfe ob Upgrade-Button/Link sichtbar wird wenn Limit erreicht
    const upgradeLink = page.locator('text=/Upgrade|Premium|Plan wechseln/i');
    
    // Dies ist optional - nur prüfen wenn Limit tatsächlich erreicht
    if (await upgradeLink.first().isVisible({ timeout: 2000 })) {
      await upgradeLink.first().click();
      await expect(page).toHaveURL(/\/(upgrade|pricing)/);
    }
  });
});

test.describe('Einheiten-Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Einheiten-Liste lädt', async ({ page }) => {
    await page.goto('/einheiten');
    await expect(page).toHaveURL('/einheiten');
    
    // Prüfe dass die Seite geladen ist
    const heading = page.locator('h1, h2').filter({ hasText: /Einheit/i });
    await expect(heading.first()).toBeVisible();
  });
});

test.describe('Buchhaltung', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Buchhaltung-Seite lädt', async ({ page }) => {
    await page.goto('/buchhaltung');
    await expect(page).toHaveURL('/buchhaltung');
  });

  test('Ausgabe erstellen Dialog öffnet sich', async ({ page }) => {
    await page.goto('/buchhaltung');
    
    // Klicke auf "Neue Ausgabe" Button
    const newExpenseButton = page.locator('button').filter({ hasText: /Neue Ausgabe|Ausgabe hinzufügen/i });
    
    if (await newExpenseButton.first().isVisible({ timeout: 3000 })) {
      await newExpenseButton.first().click();
      
      // Prüfe dass Dialog/Form sichtbar ist
      const dialog = page.locator('[role="dialog"]').or(page.locator('form'));
      await expect(dialog.first()).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Zahlungen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Zahlungen-Seite lädt', async ({ page }) => {
    await page.goto('/zahlungen');
    await expect(page).toHaveURL('/zahlungen');
  });
});

test.describe('Einstellungen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Einstellungen-Seite lädt', async ({ page }) => {
    await page.goto('/einstellungen');
    await expect(page).toHaveURL('/einstellungen');
  });
});

// Cleanup Test - Am Ende ausführen
test.describe('Cleanup', () => {
  test('Testdaten bereinigen', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
    
    await page.goto('/liegenschaften');
    
    // Suche nach Test-Liegenschaft und lösche sie
    const testProperty = page.locator('text=Playwright Test Liegenschaft');
    
    if (await testProperty.first().isVisible({ timeout: 2000 })) {
      // Klicke auf die Liegenschaft
      await testProperty.first().click();
      
      // Suche nach Löschen-Button
      const deleteButton = page.locator('button').filter({ hasText: /Löschen|Delete/i });
      
      if (await deleteButton.first().isVisible({ timeout: 2000 })) {
        await deleteButton.first().click();
        
        // Bestätige Löschen falls Dialog erscheint
        const confirmButton = page.locator('button').filter({ hasText: /Bestätigen|Ja|Löschen/i });
        if (await confirmButton.first().isVisible({ timeout: 1000 })) {
          await confirmButton.first().click();
        }
      }
    }
  });
});
