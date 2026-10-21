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

async function captureFlutter({ url, outputPath, waitMs = 8000, width = 390, height = 844 }) {
  const port = 9222 + Math.floor(Math.random() * 500);
  const tempDir = path.join(process.env.TEMP || '.', `edge_flutter_${Date.now()}`);
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

    if (!wsUrl) throw new Error('Could not find Edge page target WebSocket');

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

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

    client.on('Runtime.consoleAPICalled', (p) => {
      console.log('FLUTTER CONSOLE:', p.type, p.args.map((a) => a.value || a.description).join(' '));
    });
    client.on('Runtime.exceptionThrown', (p) => {
      console.error('FLUTTER EXCEPTION:', p.exceptionDetails.text, p.exceptionDetails.exception?.description);
    });

    console.log(`Navigating to ${url}...`);
    await client.send('Page.navigate', { url });

    console.log(`Waiting ${waitMs}ms for Flutter engine and canvas to paint...`);
    await sleep(waitMs);

    const bodyHtml = await client.send('Runtime.evaluate', { expression: 'document.body.innerHTML' });
    console.log('Body HTML length:', bodyHtml.result?.value?.length, 'snippet:', (bodyHtml.result?.value || '').substring(0, 300));

    const errors = await client.send('Runtime.evaluate', { expression: 'window.__flutter_web_errors || []' });
    console.log('Evaluated errors:', errors.result?.value);

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

captureFlutter({
  url: 'http://127.0.0.1:8088/#/phone-entry',
  outputPath: 'qa_screenshots/flutter/customer_phone_entry.png',
  waitMs: 8000
}).catch((err) => {
  console.error('Test capture error:', err);
  process.exit(1);
});
