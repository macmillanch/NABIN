import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3000';

describe('Customer Web Smoke Tests', () => {
  test('unauthenticated root redirects to /login', async ({ browser }) => {
    await browser.goto(`${CUSTOMER_URL}/`);
    await expect(browser).toHaveURL('/login');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('login page renders branding and phone input', async ({ browser }) => {
    await browser.goto(`${CUSTOMER_URL}/login`);
    await expect(browser.locator('img[alt="NABIN"]')).toBeVisible();
    await expect(browser.locator('input#phone')).toBeVisible();
    await expect(browser.locator('button[type="submit"]')).toBeVisible();
    await expect(browser.locator('.nabin-auth__subtitle')).toContainText('Sign in with your phone number');
  });

  test('authenticated session loads dashboard services and navigates to food', async ({ browser }) => {
    await browser.goto(`${CUSTOMER_URL}/login`);
    await browser.evaluate(() => {
      localStorage.setItem('nabin_customer_token', 'demo-customer-token');
      localStorage.setItem('nabin_customer_user', JSON.stringify({
        id: 'customer-demo-01',
        name: 'Lalrinfela (Customer)',
        phone: '+91 98765 43210',
        role: 'CUSTOMER',
        identityStatus: 'IDENTITY_VERIFICATION_PENDING',
      }));
    });

    await browser.goto(`${CUSTOMER_URL}/`);
    await expect(browser.locator('body')).toContainText(/Signed in as|Rides|Food|Grocery/i);

    // Navigate to food service
    await browser.goto(`${CUSTOMER_URL}/food`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
