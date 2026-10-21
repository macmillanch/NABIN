const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { res, rej } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) rej(msg.error);
          else res(msg.result);
        } else if (msg.method && this.eventHandlers.has(msg.method)) {
          const handler = this.eventHandlers.get(msg.method);
          handler(msg.params);
        }
      };
    });
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler);
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.id++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          rej(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.callbacks.set(id, {
        res: (val) => {
          clearTimeout(timer);
          res(val);
        },
        rej: (err) => {
          clearTimeout(timer);
          rej(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

const SCREENS = [
  // 0. Catalog Hub
  { path: '/', output: 'qa_screenshots/flutter/catalog_hub.png', name: 'Catalog Hub' },

  // 1. Customer Screens (37)
  { path: '/customer/splash', output: 'qa_screenshots/flutter/customer_01_splash.png', name: 'Customer Splash' },
  { path: '/customer/welcome', output: 'qa_screenshots/flutter/customer_welcome.png', altOutput: 'qa_screenshots/flutter/customer_02_welcome.png', name: 'Customer Welcome' },
  { path: '/customer/phone-entry', output: 'qa_screenshots/flutter/customer_phone_entry.png', altOutput: 'qa_screenshots/flutter/customer_03_phone_entry.png', name: 'Customer Phone Entry' },
  { path: '/customer/otp', output: 'qa_screenshots/flutter/customer_otp.png', altOutput: 'qa_screenshots/flutter/customer_04_otp.png', name: 'Customer OTP' },
  { path: '/customer/personalization', output: 'qa_screenshots/flutter/customer_05_personalization.png', name: 'Customer Personalization' },
  { path: '/customer/kyc-submission', output: 'qa_screenshots/flutter/customer_06_kyc_submission.png', name: 'Customer KYC Submission' },
  { path: '/customer/kyc-status', output: 'qa_screenshots/flutter/customer_07_kyc_status.png', name: 'Customer KYC Status' },
  { path: '/customer/home', output: 'qa_screenshots/flutter/customer_home.png', altOutput: 'qa_screenshots/flutter/customer_08_home.png', name: 'Customer Home' },
  { path: '/customer/ride-booking', output: 'qa_screenshots/flutter/customer_ride_booking.png', altOutput: 'qa_screenshots/flutter/customer_09_ride_booking.png', name: 'Customer Ride Booking' },
  { path: '/customer/ride-active', output: 'qa_screenshots/flutter/customer_10_ride_active.png', name: 'Customer Active Ride' },
  { path: '/customer/ride-receipt', output: 'qa_screenshots/flutter/customer_11_ride_receipt.png', name: 'Customer Ride Receipt' },
  { path: '/customer/parcel-booking', output: 'qa_screenshots/flutter/customer_parcel_booking.png', altOutput: 'qa_screenshots/flutter/customer_12_parcel_booking.png', name: 'Customer Parcel Booking' },
  { path: '/customer/parcel-confirmation', output: 'qa_screenshots/flutter/customer_13_parcel_confirmation.png', name: 'Customer Parcel Confirmation' },
  { path: '/customer/payment', output: 'qa_screenshots/flutter/customer_14_payment.png', name: 'Customer Payment Sheet' },
  { path: '/customer/food-home', output: 'qa_screenshots/flutter/customer_food_home.png', altOutput: 'qa_screenshots/flutter/customer_15_food_home.png', name: 'Customer Food Home' },
  { path: '/customer/food-category', output: 'qa_screenshots/flutter/customer_16_food_category.png', name: 'Customer Food Categories' },
  { path: '/customer/restaurant-menu', output: 'qa_screenshots/flutter/customer_17_restaurant_menu.png', name: 'Customer Restaurant Menu' },
  { path: '/customer/dish-detail', output: 'qa_screenshots/flutter/customer_18_dish_detail.png', name: 'Customer Dish Detail' },
  { path: '/customer/food-checkout', output: 'qa_screenshots/flutter/customer_19_food_checkout.png', name: 'Customer Food Checkout' },
  { path: '/customer/food-tracking', output: 'qa_screenshots/flutter/customer_20_food_tracking.png', name: 'Customer Food Tracking' },
  { path: '/customer/grocery-app-shell', output: 'qa_screenshots/flutter/customer_grocery_home.png', altOutput: 'qa_screenshots/flutter/customer_21_grocery_app_shell.png', name: 'Customer Grocery App Shell' },
  { path: '/customer/grocery-home', output: 'qa_screenshots/flutter/customer_22_grocery_home.png', name: 'Customer Grocery Home' },
  { path: '/customer/grocery-categories', output: 'qa_screenshots/flutter/customer_23_grocery_categories.png', name: 'Customer Grocery Categories' },
  { path: '/customer/grocery-products', output: 'qa_screenshots/flutter/customer_24_grocery_products.png', name: 'Customer Grocery Products' },
  { path: '/customer/grocery-product-detail', output: 'qa_screenshots/flutter/customer_25_grocery_product_detail.png', name: 'Customer Grocery Product Detail' },
  { path: '/customer/grocery-cart', output: 'qa_screenshots/flutter/customer_26_grocery_cart.png', name: 'Customer Grocery Cart' },
  { path: '/customer/grocery-checkout', output: 'qa_screenshots/flutter/customer_27_grocery_checkout.png', name: 'Customer Grocery Checkout' },
  { path: '/customer/grocery-order-status', output: 'qa_screenshots/flutter/customer_28_grocery_order_status.png', name: 'Customer Grocery Order Status' },
  { path: '/customer/grocery-deals', output: 'qa_screenshots/flutter/customer_29_grocery_deals.png', name: 'Customer Grocery Deals' },
  { path: '/customer/grocery-account', output: 'qa_screenshots/flutter/customer_30_grocery_account.png', name: 'Customer Grocery Account' },
  { path: '/customer/grocery-login', output: 'qa_screenshots/flutter/customer_31_grocery_login.png', name: 'Customer Grocery Login' },
  { path: '/customer/grocery-otp', output: 'qa_screenshots/flutter/customer_32_grocery_otp.png', name: 'Customer Grocery OTP' },
  { path: '/customer/grocery-splash', output: 'qa_screenshots/flutter/customer_33_grocery_splash.png', name: 'Customer Grocery Splash' },
  { path: '/customer/activity', output: 'qa_screenshots/flutter/customer_activity.png', altOutput: 'qa_screenshots/flutter/customer_34_activity.png', name: 'Customer Activity' },
  { path: '/customer/profile', output: 'qa_screenshots/flutter/customer_profile.png', altOutput: 'qa_screenshots/flutter/customer_35_profile.png', name: 'Customer Profile' },
  { path: '/customer/support', output: 'qa_screenshots/flutter/customer_support.png', altOutput: 'qa_screenshots/flutter/customer_36_support.png', name: 'Customer Support' },
  { path: '/customer/wallet', output: 'qa_screenshots/flutter/customer_wallet.png', altOutput: 'qa_screenshots/flutter/customer_37_wallet.png', name: 'Customer Wallet' },

  // 2. Driver Screens (15)
  { path: '/driver/splash', output: 'qa_screenshots/flutter/driver_splash.png', altOutput: 'qa_screenshots/flutter/driver_01_splash.png', name: 'Driver Splash' },
  { path: '/driver/login', output: 'qa_screenshots/flutter/driver_login.png', altOutput: 'qa_screenshots/flutter/driver_02_login.png', name: 'Driver Login' },
  { path: '/driver/otp', output: 'qa_screenshots/flutter/driver_03_otp.png', name: 'Driver OTP' },
  { path: '/driver/kyc-registration', output: 'qa_screenshots/flutter/driver_04_kyc_registration.png', name: 'Driver KYC Registration' },
  { path: '/driver/app-shell', output: 'qa_screenshots/flutter/driver_05_app_shell.png', name: 'Driver App Shell' },
  { path: '/driver/home', output: 'qa_screenshots/flutter/driver_home.png', altOutput: 'qa_screenshots/flutter/driver_06_home.png', name: 'Driver Dispatch Home' },
  { path: '/driver/active-job', output: 'qa_screenshots/flutter/driver_07_active_job.png', name: 'Driver Active Job' },
  { path: '/driver/earnings', output: 'qa_screenshots/flutter/driver_earnings.png', altOutput: 'qa_screenshots/flutter/driver_08_earnings.png', name: 'Driver Earnings' },
  { path: '/driver/payout', output: 'qa_screenshots/flutter/driver_payout.png', altOutput: 'qa_screenshots/flutter/driver_09_payout.png', name: 'Driver Payout' },
  { path: '/driver/notifications', output: 'qa_screenshots/flutter/driver_10_notifications.png', name: 'Driver Notifications' },
  { path: '/driver/notification-preferences', output: 'qa_screenshots/flutter/driver_11_notification_preferences.png', name: 'Driver Notification Preferences' },
  { path: '/driver/support', output: 'qa_screenshots/flutter/driver_support.png', altOutput: 'qa_screenshots/flutter/driver_12_support.png', name: 'Driver Support' },
  { path: '/driver/support-ticket', output: 'qa_screenshots/flutter/driver_13_support_ticket.png', name: 'Driver Support Ticket' },
  { path: '/driver/support-new-ticket', output: 'qa_screenshots/flutter/driver_14_support_new_ticket.png', name: 'Driver New Support Ticket' },
  { path: '/driver/account', output: 'qa_screenshots/flutter/driver_account.png', altOutput: 'qa_screenshots/flutter/driver_15_account.png', name: 'Driver Account' },

  // 3. Restaurant Merchant Screens (7)
  { path: '/restaurant/splash', output: 'qa_screenshots/flutter/restaurant_splash.png', altOutput: 'qa_screenshots/flutter/restaurant_01_splash.png', name: 'Restaurant Splash' },
  { path: '/restaurant/login', output: 'qa_screenshots/flutter/restaurant_login.png', altOutput: 'qa_screenshots/flutter/restaurant_02_login.png', name: 'Restaurant Login' },
  { path: '/restaurant/otp', output: 'qa_screenshots/flutter/restaurant_03_otp.png', name: 'Restaurant OTP' },
  { path: '/restaurant/register', output: 'qa_screenshots/flutter/restaurant_04_register.png', name: 'Restaurant Registration' },
  { path: '/restaurant/app-shell', output: 'qa_screenshots/flutter/restaurant_05_app_shell.png', name: 'Restaurant App Shell' },
  { path: '/restaurant/dashboard', output: 'qa_screenshots/flutter/restaurant_dashboard.png', altOutput: 'qa_screenshots/flutter/restaurant_06_dashboard.png', name: 'Restaurant Dashboard' },
  { path: '/restaurant/dish-detail', output: 'qa_screenshots/flutter/restaurant_07_dish_detail.png', name: 'Restaurant Dish Detail' },

  // 4. Grocery Merchant Screens (10)
  { path: '/grocery/splash', output: 'qa_screenshots/flutter/grocery_splash.png', altOutput: 'qa_screenshots/flutter/grocery_merchant_01_splash.png', name: 'Grocery Merchant Splash' },
  { path: '/grocery/login', output: 'qa_screenshots/flutter/grocery_login.png', altOutput: 'qa_screenshots/flutter/grocery_merchant_02_login.png', name: 'Grocery Merchant Login' },
  { path: '/grocery/otp', output: 'qa_screenshots/flutter/grocery_merchant_03_otp.png', name: 'Grocery Merchant OTP' },
  { path: '/grocery/dashboard', output: 'qa_screenshots/flutter/grocery_dashboard.png', altOutput: 'qa_screenshots/flutter/grocery_merchant_04_dashboard.png', name: 'Grocery Merchant Dashboard' },
  { path: '/grocery/orders', output: 'qa_screenshots/flutter/grocery_orders.png', altOutput: 'qa_screenshots/flutter/grocery_merchant_05_orders.png', name: 'Grocery Merchant Orders' },
  { path: '/grocery/order-detail', output: 'qa_screenshots/flutter/grocery_merchant_06_order_detail.png', name: 'Grocery Merchant Order Detail' },
  { path: '/grocery/catalog', output: 'qa_screenshots/flutter/grocery_merchant_07_catalog.png', name: 'Grocery Merchant Catalog' },
  { path: '/grocery/inventory', output: 'qa_screenshots/flutter/grocery_inventory.png', altOutput: 'qa_screenshots/flutter/grocery_merchant_08_inventory.png', name: 'Grocery Merchant Inventory' },
  { path: '/grocery/price-management', output: 'qa_screenshots/flutter/grocery_merchant_09_price_management.png', name: 'Grocery Merchant Price Management' },
  { path: '/grocery/notifications', output: 'qa_screenshots/flutter/grocery_merchant_10_notifications.png', name: 'Grocery Merchant Notifications' },

  // 5. Admin Screens (9)
  { path: '/admin/splash', output: 'qa_screenshots/flutter/admin_splash.png', altOutput: 'qa_screenshots/flutter/admin_01_splash.png', name: 'Admin Splash' },
  { path: '/admin/login', output: 'qa_screenshots/flutter/admin_login.png', altOutput: 'qa_screenshots/flutter/admin_02_login.png', name: 'Admin Login' },
  { path: '/admin/otp', output: 'qa_screenshots/flutter/admin_03_otp.png', name: 'Admin OTP' },
  { path: '/admin/dashboard', output: 'qa_screenshots/flutter/admin_dashboard.png', altOutput: 'qa_screenshots/flutter/admin_04_dashboard.png', name: 'Admin Dashboard' },
  { path: '/admin/users', output: 'qa_screenshots/flutter/admin_users.png', altOutput: 'qa_screenshots/flutter/admin_05_users.png', name: 'Admin Users' },
  { path: '/admin/merchants', output: 'qa_screenshots/flutter/admin_merchants.png', altOutput: 'qa_screenshots/flutter/admin_06_merchants.png', name: 'Admin Merchants' },
  { path: '/admin/orders', output: 'qa_screenshots/flutter/admin_orders.png', altOutput: 'qa_screenshots/flutter/admin_07_orders.png', name: 'Admin Orders' },
  { path: '/admin/fleet', output: 'qa_screenshots/flutter/admin_fleet.png', altOutput: 'qa_screenshots/flutter/admin_08_fleet.png', name: 'Admin Fleet' },
  { path: '/admin/features', output: 'qa_screenshots/flutter/admin_features.png', altOutput: 'qa_screenshots/flutter/admin_09_features.png', name: 'Admin Features' },
];

async function main() {
  const port = 9222 + Math.floor(Math.random() * 500);
  const tempDir = path.join(process.env.TEMP || '.', `edge_flutter_batch_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const edgeProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const pages = await res.json();
          const page = pages.find((p) => p.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            wsUrl = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }

    if (!wsUrl) throw new Error('Could not connect to Edge DevTools WebSocket');

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    // Emulate iPhone 14/15 Mobile Viewport (390 x 844, 2x scale)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      fitWindow: false,
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });

    console.log(`Starting capture of ${SCREENS.length} Flutter mobile screens on http://127.0.0.1:8088/ ...`);
    console.log('Warming up Flutter CanvasKit Web engine on port 8088...');
    await client.send('Page.navigate', { url: 'http://127.0.0.1:8088/#/' });
    await sleep(4500);

    let passCount = 0;

    for (let i = 0; i < SCREENS.length; i++) {
      const screen = SCREENS[i];
      const targetUrl = `http://127.0.0.1:8088/?t=${Date.now()}_${i}#${screen.path}`;
      process.stdout.write(`[${i + 1}/${SCREENS.length}] Capturing ${screen.name} (${screen.path}) ... `);

      try {
        await client.send('Page.navigate', { url: targetUrl });
        await sleep(1500);

        const shot = await client.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });

        const buffer = Buffer.from(shot.data, 'base64');
        fs.mkdirSync(path.dirname(screen.output), { recursive: true });
        fs.writeFileSync(screen.output, buffer);

        if (screen.altOutput) {
          fs.mkdirSync(path.dirname(screen.altOutput), { recursive: true });
          fs.writeFileSync(screen.altOutput, buffer);
        }

        console.log(`OK (${(buffer.length / 1024).toFixed(1)} KB) -> ${screen.output}`);
        passCount++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
    }

    console.log(`\n======================================================`);
    console.log(`SUCCESS: Captured ${passCount}/${SCREENS.length} Flutter mobile screens!`);
    console.log(`======================================================\n`);

    client.close();
  } finally {
    edgeProc.kill();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});
