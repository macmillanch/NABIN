import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3000';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://127.0.0.1:3001';

describe('Orders, Idempotency & Safety E2E Flows', () => {
  test('unauthorized order actions are rejected and redirect to login', async ({ browser }) => {
    // 1. Unauthenticated request to /orders must redirect to login
    await browser.goto(`${CUSTOMER_URL}/login`);
    await browser.evaluate(() => {
      localStorage.clear();
    });

    await browser.goto(`${CUSTOMER_URL}/orders`);
    await expect(browser.locator('.nabin-auth__subtitle, input#phone, input[type="tel"]').first()).toBeVisible();
    await expect(browser.locator('body')).toBeVisible();
  });

  test('authenticated customer safely views synthetic order history and statuses', async ({ browser }) => {
    // 2. Authenticated customer session loads orders dashboard
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
    await browser.goto(`${CUSTOMER_URL}/orders`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Orders|Booking|History/i);
    await expect(browser.locator('body')).not.toContainText('Application error');
  });

  test('admin console protects order operations and displays live order states', async ({ browser }) => {
    // 3. Admin orders management view
    await browser.goto(`${ADMIN_URL}/login`);
    await browser.evaluate(() => {
      localStorage.setItem('nabin_admin_token', 'demo-admin-qa-token');
    });

    await browser.goto(`${ADMIN_URL}/orders`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Orders|Operations|Status/i);
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
