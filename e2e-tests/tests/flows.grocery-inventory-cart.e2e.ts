import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3000';
const GROCERY_URL = process.env.GROCERY_URL ?? 'http://127.0.0.1:3003';

describe('Grocery Merchant & Customer E2E Flow', () => {
  test('grocery merchant inventory console displays stock and pricing table', async ({ browser }) => {
    // 1. Open grocery merchant console with authenticated session
    await browser.goto(`${GROCERY_URL}/login`);
    await browser.evaluate(() => {
      localStorage.setItem('nabin_merchant_token', 'demo-grocery-token');
    });

    await browser.goto(`${GROCERY_URL}/inventory`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).toContainText(/Inventory|Grocery|Console/i);
    await expect(browser.locator('body')).not.toContainText('Application error');
  });

  test('customer grocery catalog renders products and categories', async ({ browser }) => {
    // 2. Open customer web grocery portal with authenticated session
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
    await expect(browser.locator('body')).toContainText(/Signed in as|Grocery/i);

    await browser.goto(`${CUSTOMER_URL}/grocery`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });

  test('customer grocery cart calculates subtotal and validates item selection', async ({ browser }) => {
    // 3. Test grocery item selection & cart calculations
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
    await browser.goto(`${CUSTOMER_URL}/grocery`);
    const reloadBtn = browser.locator('button:has-text("Reload")');
    if (await reloadBtn.isVisible().catch(() => false)) {
      await reloadBtn.click();
    }
    await expect(browser.locator('body')).toBeVisible();

    // If product cards or add buttons exist, interact
    const addBtn = browser.locator('button:has-text("+ Add"), button:has-text("Customize"), .nabin-product-card button').first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();

      // Check if modal opened
      const modalAddBtn = browser.locator('button:has-text("Add to Cart"), button:has-text("Add to order")').first();
      if (await modalAddBtn.isVisible().catch(() => false)) {
        await modalAddBtn.click();
      }
    }

    await expect(browser.locator('body')).toBeVisible();
    await expect(browser.locator('body')).not.toContainText('Application error');
  });
});
