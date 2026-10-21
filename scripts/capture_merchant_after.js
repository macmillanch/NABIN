const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'qa_screenshots', 'after');
fs.mkdirSync(outDir, { recursive: true });

const captures = [
  // Public Auth
  { url: 'http://localhost:3004/register', output: 'qa_screenshots/after/register_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3004/register', output: 'qa_screenshots/after/register_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },
  { url: 'http://localhost:3004/login', output: 'qa_screenshots/after/login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3004/login', output: 'qa_screenshots/after/login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },

  // Hybrid Persona
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/hybrid_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/hybrid_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/hybrid_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/hybrid_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/merchant_order_modal_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token', clickSelector: 'button[data-testid="order-details-btn"]' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/merchant_order_modal_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token', clickSelector: 'button[data-testid="order-details-btn"]' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/after/hybrid_menu_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/after/hybrid_menu_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/after/hybrid_inventory_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/after/hybrid_inventory_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/payouts', output: 'qa_screenshots/after/merchant_payouts_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/profile', output: 'qa_screenshots/after/hybrid_profile_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/profile', output: 'qa_screenshots/after/hybrid_profile_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/settings', output: 'qa_screenshots/after/hybrid_settings_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/settings', output: 'qa_screenshots/after/hybrid_settings_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },

  // Restaurant-Only Persona
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/restaurant_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/restaurant_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/restaurant_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/restaurant_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/after/restaurant_menu_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/after/restaurant_inventory_guard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },

  // Grocery-Only Persona
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/grocery_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/after/grocery_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/grocery_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/after/grocery_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/after/grocery_inventory_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/after/grocery_menu_guard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
];

function runCapture(item) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(__dirname, 'cdp_browser.js'),
      item.url,
      item.output,
      String(item.width),
      String(item.height),
      String(item.isMobile),
    ];
    if (item.authRole) args.push(item.authRole);
    if (item.clickSelector) args.push(item.clickSelector);

    const proc = spawn('node', args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });
  });
}

async function main() {
  console.log(`Starting captures for ${captures.length} target viewports...`);
  for (const item of captures) {
    try {
      console.log(`Capturing: ${item.output}`);
      await runCapture(item);
    } catch (e) {
      console.error(`Error capturing ${item.output}:`, e.message);
    }
  }
  console.log('All after captures finished!');
}

main();
