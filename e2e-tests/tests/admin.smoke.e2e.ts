import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://127.0.0.1:3001';

describe('Admin Web Smoke Tests', () => {
  test('unauthenticated root redirects to /login', async ({ browser }) => {
    await browser.goto(`${ADMIN_URL}/`);
    await expect(browser.locator('input#username')).toBeVisible();
    await expect(browser.locator('body')).toBeVisible();
  });

  test('login page renders administrator credential inputs and controls', async ({ browser }) => {
    await browser.goto(`${ADMIN_URL}/login`);
    await expect(browser.locator('img[alt="NABIN"]')).toBeVisible();
    await expect(browser.locator('input#username')).toBeVisible();
    await expect(browser.locator('input#password')).toBeVisible();
    await expect(browser.locator('button[type="submit"]')).toBeVisible();
    await expect(browser.locator('.nabin-auth__subtitle')).toContainText('Operations console — admin access only');
  });

  test('authenticated admin session loads dashboard overview and navigates to operations', async ({ browser }) => {
    await browser.goto(`${ADMIN_URL}/login`);
    // Seed authenticated admin token
    await browser.evaluate(() => {
      localStorage.setItem('nabin_admin_token', 'demo-admin-qa-token');
    });

    await browser.goto(`${ADMIN_URL}/`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Operations|Live Operations|Geofencing|Finance/i);

    // Navigate to operations section
    await browser.goto(`${ADMIN_URL}/operations`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
