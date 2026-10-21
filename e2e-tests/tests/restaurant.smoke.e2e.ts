import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const RESTAURANT_URL = process.env.RESTAURANT_URL ?? 'http://127.0.0.1:3002';

describe('Restaurant Merchant Web Smoke Tests', () => {
  test('unauthenticated /menu redirects to /login', async ({ browser }) => {
    await browser.goto(`${RESTAURANT_URL}/menu`);
    await expect(browser.locator('.nabin-auth__subtitle')).toBeVisible();
    await expect(browser.locator('body')).toBeVisible();
  });

  test('login page renders restaurant kitchen console sign-in', async ({ browser }) => {
    await browser.goto(`${RESTAURANT_URL}/login`);
    await expect(browser.locator('.nabin-wordmark')).toContainText('NABIN');
    await expect(browser.locator('.nabin-auth__subtitle')).toContainText('restaurant kitchen console');
    await expect(browser.locator('input[type="tel"]')).toBeVisible();
    await expect(browser.locator('button[type="submit"]')).toBeVisible();
  });

  test('authenticated merchant session loads kitchen console and orders', async ({ browser }) => {
    await browser.goto(`${RESTAURANT_URL}/login`);
    // Seed authenticated restaurant token
    await browser.evaluate(() => {
      localStorage.setItem('nabin_merchant_token', 'demo-restaurant-token');
    });

    await browser.goto(`${RESTAURANT_URL}/menu`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Menu|Restaurant|Console/i);

    // Navigate to active orders
    await browser.goto(`${RESTAURANT_URL}/orders`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
