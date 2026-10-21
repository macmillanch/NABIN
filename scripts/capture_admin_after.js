const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'qa_screenshots', 'after');
fs.mkdirSync(outDir, { recursive: true });

const captures = [
  // Admin Auth
  { url: 'http://localhost:3001/login', output: 'qa_screenshots/after/admin_login_desktop.png', width: 1280, height: 900, isMobile: false, authRole: null },
  { url: 'http://localhost:3001/login', output: 'qa_screenshots/after/admin_login_mobile.png', width: 390, height: 844, isMobile: true, authRole: null },

  // Admin Overview
  { url: 'http://localhost:3001/', output: 'qa_screenshots/after/admin_dashboard_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/', output: 'qa_screenshots/after/admin_dashboard_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Operations & Geofencing
  { url: 'http://localhost:3001/operations', output: 'qa_screenshots/after/admin_operations_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/operations', output: 'qa_screenshots/after/admin_operations_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/geofencing', output: 'qa_screenshots/after/geofencing_default_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/geofencing', output: 'qa_screenshots/after/geofencing_mobile_layout.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Finance & Refunds
  { url: 'http://localhost:3001/finance', output: 'qa_screenshots/after/admin_finance_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/finance', output: 'qa_screenshots/after/admin_finance_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/finance/refund', output: 'qa_screenshots/after/admin_finance_refund_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/finance/refund', output: 'qa_screenshots/after/admin_finance_refund_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Support & KYC
  { url: 'http://localhost:3001/support', output: 'qa_screenshots/after/admin_support_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/support', output: 'qa_screenshots/after/admin_support_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/kyc', output: 'qa_screenshots/after/admin_kyc_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/kyc', output: 'qa_screenshots/after/admin_kyc_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Security & Audit
  { url: 'http://localhost:3001/security', output: 'qa_screenshots/after/admin_security_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/security', output: 'qa_screenshots/after/admin_security_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/audit', output: 'qa_screenshots/after/admin_audit_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/audit', output: 'qa_screenshots/after/admin_audit_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Settings & Campaigns
  { url: 'http://localhost:3001/settings', output: 'qa_screenshots/after/admin_settings_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/settings', output: 'qa_screenshots/after/admin_settings_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/campaigns', output: 'qa_screenshots/after/admin_campaigns_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/campaigns', output: 'qa_screenshots/after/admin_campaigns_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },

  // Directories & Records
  { url: 'http://localhost:3001/customers', output: 'qa_screenshots/after/admin_customers_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/customers', output: 'qa_screenshots/after/admin_customers_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/drivers', output: 'qa_screenshots/after/admin_drivers_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/drivers', output: 'qa_screenshots/after/admin_drivers_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/merchants', output: 'qa_screenshots/after/admin_merchants_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/merchants', output: 'qa_screenshots/after/admin_merchants_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/orders', output: 'qa_screenshots/after/admin_orders_desktop.png', width: 1280, height: 900, isMobile: false, authRole: 'ADMIN' },
  { url: 'http://localhost:3001/orders', output: 'qa_screenshots/after/admin_orders_mobile.png', width: 390, height: 844, isMobile: true, authRole: 'ADMIN' },
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
  console.log('Admin captures finished!');
}

main();
