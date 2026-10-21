const { spawn } = require('child_process');
const path = require('path');

const captures = [
  // Public Shared
  { url: 'http://localhost:3004/register', output: 'qa_screenshots/unified_merchant/register_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3004/register', output: 'qa_screenshots/unified_merchant/register_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },
  { url: 'http://localhost:3004/login', output: 'qa_screenshots/unified_merchant/login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3004/login', output: 'qa_screenshots/unified_merchant/login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },

  // Hybrid Persona (Both Restaurant & Grocery)
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/hybrid_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/hybrid_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/hybrid_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/hybrid_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/unified_merchant/hybrid_menu_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/unified_merchant/hybrid_menu_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/unified_merchant/hybrid_inventory_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/unified_merchant/hybrid_inventory_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/profile', output: 'qa_screenshots/unified_merchant/hybrid_profile_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/profile', output: 'qa_screenshots/unified_merchant/hybrid_profile_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/settings', output: 'qa_screenshots/unified_merchant/hybrid_settings_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-merchant-token' },
  { url: 'http://localhost:3004/settings', output: 'qa_screenshots/unified_merchant/hybrid_settings_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-merchant-token' },

  // Restaurant-Only Persona
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/restaurant_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/restaurant_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/restaurant_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/restaurant_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/unified_merchant/restaurant_menu_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/unified_merchant/restaurant_inventory_guard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-restaurant-token' },

  // Grocery-Only Persona
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/grocery_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/', output: 'qa_screenshots/unified_merchant/grocery_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/grocery_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/orders', output: 'qa_screenshots/unified_merchant/grocery_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/inventory', output: 'qa_screenshots/unified_merchant/grocery_inventory_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
  { url: 'http://localhost:3004/menu', output: 'qa_screenshots/unified_merchant/grocery_menu_guard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'raw:demo-grocery-token' },
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

    console.log(`Starting capture: ${item.output}...`);
    const proc = spawn('node', args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`Done: ${item.output}`);
        resolve();
      } else {
        console.error(`Failed: ${item.output} with code ${code}`);
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

async function main() {
  for (const item of captures) {
    try {
      await runCapture(item);
    } catch (e) {
      console.error(`Error capturing ${item.output}:`, e.message);
    }
  }
  console.log('All unified merchant captures completed!');
}

main();
