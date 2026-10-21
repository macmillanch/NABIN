const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'qa_screenshots', 'after');
fs.mkdirSync(outDir, { recursive: true });

const captures = [
  // Auth
  { url: 'http://localhost:3000/login', output: 'qa_screenshots/after/customer_login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3000/login', output: 'qa_screenshots/after/customer_login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },

  // Customer Screens (Authenticated with demo token)
  { url: 'http://localhost:3000/', output: 'qa_screenshots/after/customer_home_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/', output: 'qa_screenshots/after/customer_home_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/ride', output: 'qa_screenshots/after/customer_ride_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/ride', output: 'qa_screenshots/after/customer_ride_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/food', output: 'qa_screenshots/after/customer_food_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/food', output: 'qa_screenshots/after/customer_food_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/grocery', output: 'qa_screenshots/after/customer_grocery_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/grocery', output: 'qa_screenshots/after/customer_grocery_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/parcel', output: 'qa_screenshots/after/customer_parcel_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/parcel', output: 'qa_screenshots/after/customer_parcel_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/orders', output: 'qa_screenshots/after/customer_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/orders', output: 'qa_screenshots/after/customer_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/wallet', output: 'qa_screenshots/after/customer_wallet_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/wallet', output: 'qa_screenshots/after/customer_wallet_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/support', output: 'qa_screenshots/after/customer_support_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/support', output: 'qa_screenshots/after/customer_support_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },

  { url: 'http://localhost:3000/profile', output: 'qa_screenshots/after/customer_profile_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'CUSTOMER' },
  { url: 'http://localhost:3000/profile', output: 'qa_screenshots/after/customer_profile_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'CUSTOMER' },
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
  console.log('Customer captures finished!');
}

main();
