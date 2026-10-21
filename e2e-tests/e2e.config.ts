import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export const APP_URLS = {
  customer: process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3000',
  admin: process.env.ADMIN_URL ?? 'http://127.0.0.1:3001',
  restaurant: process.env.RESTAURANT_URL ?? 'http://127.0.0.1:3002',
  grocery: process.env.GROCERY_URL ?? 'http://127.0.0.1:3003',
  merchant: process.env.MERCHANT_URL ?? 'http://127.0.0.1:3004',
};

export default {
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        url: APP_URLS.customer,
      },
    },
  ],
  timeout: 30000,
} satisfies E2EConfig;
