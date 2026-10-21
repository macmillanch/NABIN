const { spawn } = require('child_process');
const path = require('path');

const captures = [
  // Restaurant Merchant Web (3002)
  { url: 'http://localhost:3002/login', output: 'qa_screenshots/restaurant_login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3002/login', output: 'qa_screenshots/restaurant_login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },
  { url: 'http://localhost:3002/', output: 'qa_screenshots/restaurant_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3002/', output: 'qa_screenshots/restaurant_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },
  { url: 'http://localhost:3002/orders', output: 'qa_screenshots/restaurant_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3002/orders', output: 'qa_screenshots/restaurant_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },
  { url: 'http://localhost:3002/menu', output: 'qa_screenshots/restaurant_menu_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3002/menu', output: 'qa_screenshots/restaurant_menu_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },

  // Grocery Merchant Web (3003)
  { url: 'http://localhost:3003/login', output: 'qa_screenshots/grocery_login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3003/login', output: 'qa_screenshots/grocery_login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },
  { url: 'http://localhost:3003/', output: 'qa_screenshots/grocery_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3003/', output: 'qa_screenshots/grocery_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },
  { url: 'http://localhost:3003/orders', output: 'qa_screenshots/grocery_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3003/orders', output: 'qa_screenshots/grocery_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },
  { url: 'http://localhost:3003/inventory', output: 'qa_screenshots/grocery_inventory_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'MERCHANT' },
  { url: 'http://localhost:3003/inventory', output: 'qa_screenshots/grocery_inventory_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'MERCHANT' },
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
  console.log('All captures finished!');
}

main();
