import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const MERCHANT_URL = process.env.MERCHANT_URL ?? 'http://127.0.0.1:3004';

describe('Unified Merchant Web Smoke Tests', () => {
  test('unauthenticated /menu renders skeleton or redirects without session', async ({ browser }) => {
    await browser.goto(`${MERCHANT_URL}/login`);
    await browser.evaluate(() => {
      localStorage.clear();
    });
    await browser.goto(`${MERCHANT_URL}/menu`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });

  test('login page renders unified merchant branding and input', async ({ browser }) => {
    await browser.goto(`${MERCHANT_URL}/login`);
    await expect(browser.locator('img[alt="NABIN"]')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Unified Merchant Console/i);
    await expect(browser.locator('input[type="tel"]')).toBeVisible();
    await expect(browser.locator('button[type="submit"]')).toBeVisible();
  });

  test('authenticated merchant session loads unified console overview', async ({ browser }) => {
    await browser.goto(`${MERCHANT_URL}/login`);
    await browser.evaluate(() => {
      localStorage.setItem('nabin_merchant_token', 'demo-merchant-token');
    });

    await browser.goto(`${MERCHANT_URL}/`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Merchant|Orders|Revenue|Catalog|Inventory/i);

    // Navigate to menu section
    await browser.goto(`${MERCHANT_URL}/menu`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
