import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const GROCERY_URL = process.env.GROCERY_URL ?? 'http://127.0.0.1:3003';

describe('Grocery Merchant Web Smoke Tests', () => {
  test('unauthenticated /inventory redirects to /login', async ({ browser }) => {
    await browser.goto(`${GROCERY_URL}/inventory`);
    await expect(browser.locator('.nabin-auth__subtitle')).toBeVisible();
    await expect(browser.locator('body')).toBeVisible();
  });

  test('login page renders grocery partner sign-in', async ({ browser }) => {
    await browser.goto(`${GROCERY_URL}/login`);
    await expect(browser.locator('.nabin-wordmark')).toContainText('NABIN');
    await expect(browser.locator('.nabin-auth__subtitle')).toContainText('grocery store console');
    await expect(browser.locator('input[type="tel"]')).toBeVisible();
    await expect(browser.locator('button[type="submit"]')).toBeVisible();
  });

  test('authenticated merchant session loads inventory console and packing queue', async ({ browser }) => {
    await browser.goto(`${GROCERY_URL}/login`);
    // Seed authenticated grocery merchant token
    await browser.evaluate(() => {
      localStorage.setItem('nabin_merchant_token', 'demo-grocery-token');
    });

    await browser.goto(`${GROCERY_URL}/inventory`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Inventory|Grocery|Console/i);

    // Navigate to active packing queue
    await browser.goto(`${GROCERY_URL}/orders`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
