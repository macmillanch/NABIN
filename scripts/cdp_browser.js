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

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((res, rej) => {
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

async function renderScreenshot({ url, outputPath, width = 1280, height = 900, isMobile = false, authRole = null, clickSelector = null }) {
  const port = 9222 + Math.floor(Math.random() * 500);
  const tempDir = path.join(process.env.TEMP || '.', `edge_cdp_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
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
    for (let i = 0; i < 25; i++) {
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

    if (!wsUrl) throw new Error('Could not find page target WebSocket in Edge');

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    client.on('Runtime.consoleAPICalled', (p) => {
      console.log('PAGE CONSOLE:', p.type, p.args.map((a) => a.value || a.description).join(' '));
    });

    client.on('Runtime.exceptionThrown', (p) => {
      console.error('PAGE EXCEPTION:', p.exceptionDetails.text, p.exceptionDetails.exception?.description);
    });

    // No Fetch.enable needed: demo token bypasses network seamlessly

    if (isMobile) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: true,
        fitWindow: false
      });
      await client.send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      });
    } else {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        fitWindow: false
      });
    }

    // Set localStorage on origin if auth role requested
    if (authRole) {
      const origin = new URL(url).origin;
      await client.send('Page.navigate', { url: `${origin}/login` });
      await sleep(1500);
      // `raw:<token>` carries a session the backend itself minted, which is what the consoles
      // with no offline demo fallback (restaurant- / grocery-merchant-web) need to render a
      // populated screen instead of redirecting to /login.
      const rawToken = authRole.startsWith('raw:') ? authRole.slice(4) : null;
      await client.send('Runtime.evaluate', {
        expression: rawToken
          ? [
              `window.localStorage.setItem('nabin_merchant_token', ${JSON.stringify(rawToken)});`,
              `window.localStorage.setItem('nabin_restaurant_merchant_token', ${JSON.stringify(rawToken)});`,
              `window.localStorage.setItem('nabin_grocery_merchant_token', ${JSON.stringify(rawToken)});`,
              `window.localStorage.setItem('nabin_merchant_active_context', 'ALL');`,
            ].join('\n')
          : `
          if (${JSON.stringify(authRole)} === 'CUSTOMER') {
            window.localStorage.setItem('nabin_customer_token', 'demo-customer-token');
          } else if (${JSON.stringify(authRole)} === 'ADMIN') {
            window.localStorage.setItem('nabin_admin_token', 'demo-admin-token');
          } else {
            window.localStorage.setItem('nabin_merchant_token', 'demo-token-qa');
            window.localStorage.setItem('nabin_restaurant_merchant_token', 'demo-token-qa');
            window.localStorage.setItem('nabin_grocery_merchant_token', 'demo-token-qa');
            window.localStorage.setItem('nabin_merchant_active_context', 'ALL');
          }
        `
      });
      await sleep(500);
    }

    // Navigate to target page
    await client.send('Page.navigate', { url });

    // Wait for load and Next.js hydration
    await sleep(2500);

    // Optional click on element or custom script before screenshot (e.g. to open modal or draw)
    if (clickSelector) {
      if (clickSelector.startsWith('js:')) {
        await client.send('Runtime.evaluate', {
          expression: clickSelector.slice(3)
        });
      } else {
        await client.send('Runtime.evaluate', {
          expression: `
            const el = document.querySelector(${JSON.stringify(clickSelector)});
            if (el) el.click();
          `
        });
      }
      await sleep(1500);
    }

    const checkStorage = await client.send('Runtime.evaluate', { expression: 'window.localStorage.getItem("nabin_merchant_token")' });
    // Presence and length only: with `raw:<token>` this value is a live session bearer, and the
    // repo is public, so the tool must never print what it was given.
    console.log('localStorage token present:', Boolean(checkStorage.result?.value),
      'length:', String(checkStorage.result?.value ?? '').length);

    const urlCheck = await client.send('Runtime.evaluate', { expression: 'window.location.href' });
    console.log('Evaluated URL:', urlCheck.result?.value);
    const htmlCheck = await client.send('Runtime.evaluate', { expression: 'document.body.innerHTML' });
    console.log('HTML length:', htmlCheck.result?.value?.length, 'HTML snippet:', (htmlCheck.result?.value || '').substring(0, 300));

    // Capture screenshot
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const buffer = Buffer.from(shot.data, 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    console.log(`Successfully captured: ${outputPath} (${buffer.length} bytes)`);

    client.close();
  } finally {
    try { edgeProc.kill('SIGKILL'); } catch {}
    await sleep(200);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

// CLI usage: node scripts/cdp_browser.js <url> <outputPath> [width] [height] [isMobile] [authRole] [clickSelector]
if (require.main === module) {
  const [,, url, outputPath, widthStr, heightStr, isMobileStr, authRole, clickSelector] = process.argv;
  if (!url || !outputPath) {
    console.error('Usage: node scripts/cdp_browser.js <url> <outputPath> [width] [height] [isMobile] [authRole] [clickSelector]');
    process.exit(1);
  }
  const width = widthStr ? parseInt(widthStr, 10) : 1280;
  const height = heightStr ? parseInt(heightStr, 10) : 900;
  const isMobile = isMobileStr === 'true' || isMobileStr === '1';

  renderScreenshot({ url, outputPath, width, height, isMobile, authRole, clickSelector })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Render error:', err);
      process.exit(1);
    });
}
