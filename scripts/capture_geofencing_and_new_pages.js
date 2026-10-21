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
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function captureInteractiveGeofencing() {
  const port = 9226 + Math.floor(Math.random() * 200);
  const tempDir = path.join(process.env.TEMP || '.', `edge_geofence_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const edgeProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 25; i++) {
      await sleep(250);
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json`);
        if (resp.ok) {
          const targets = await resp.json();
          const page = targets.find((p) => p.type === 'page') || targets[0];
          if (page && page.webSocketDebuggerUrl) {
            wsUrl = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }
    if (!wsUrl) throw new Error('No debugger target');

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('DOM.enable');

    const outDir = path.join(__dirname, '..', 'qa_screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Step 1: Admin Geofencing Default Desktop
    console.log('Navigating to Admin Geofencing...');
    // set admin token in localStorage
    await client.send('Page.navigate', { url: 'http://localhost:3001/login' });
    await sleep(1000);
    await client.send('Runtime.evaluate', {
      expression: `window.localStorage.setItem('nabin_admin_token', 'demo-admin-token');`
    });
    await sleep(500);

    // Set Desktop viewport
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1360,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await client.send('Page.navigate', { url: 'http://localhost:3001/geofencing' });
    await sleep(3500); // Wait for Leaflet tiles to load

    // Capture Default Geofencing Screen
    let shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_default_desktop.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_default_desktop.png');

    // Step 2: Trigger Drawing Mode & Add Points on Map
    console.log('Activating Drawing Mode...');
    await client.send('Runtime.evaluate', {
      expression: `
        // Click "Draw New Zone" button
        const buttons = Array.from(document.querySelectorAll('button'));
        const drawBtn = buttons.find(b => b.textContent.includes('Draw New Zone'));
        if (drawBtn) drawBtn.click();
      `
    });
    await sleep(1000);

    // Simulate clicking on the map canvas to place vertices
    await client.send('Runtime.evaluate', {
      expression: `
        const mapEl = document.querySelector('.leaflet-container');
        if (mapEl) {
          const rect = mapEl.getBoundingClientRect();
          // Dispatch 4 clicks inside map viewport
          const pts = [
            { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.4 },
            { x: rect.left + rect.width * 0.65, y: rect.top + rect.height * 0.42 },
            { x: rect.left + rect.width * 0.6, y: rect.top + rect.height * 0.65 },
            { x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.62 },
          ];
          pts.forEach(p => {
            mapEl.dispatchEvent(new MouseEvent('click', {
              clientX: p.x,
              clientY: p.y,
              bubbles: true,
              cancelable: true
            }));
          });
        }
      `
    });
    await sleep(1500);

    // Capture Drawing In Progress Screen
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_drawing_in_progress.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_drawing_in_progress.png');

    // Step 3: Trigger Validation Message
    console.log('Testing Validation State...');
    const evalRes3 = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const saveBtn = buttons.find(b => b.textContent.includes('Save Service Zone'));
        if (!saveBtn) return { error: 'no save btn', buttons: buttons.map(b => b.textContent.trim()) };
        saveBtn.click();
        return { clicked: true };
      })()`,
      returnByValue: true
    });
    console.log('Step 3 eval result:', JSON.stringify(evalRes3));
    await sleep(1000);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_validation_error.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_validation_error.png');

    // Step 4: Fill Form Name & Save Zone
    console.log('Completing Zone Creation...');
    const evalRes4 = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.querySelector('input[placeholder*="Connaught Place"]');
        if (!input) return 'NO_INPUT';
        input.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, "Pragati Maidan Exhibition District [Demo Zone]");
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const buttons = Array.from(document.querySelectorAll('button'));
        const saveBtn = buttons.find(b => b.textContent.includes('Save Service Zone'));
        if (!saveBtn) return 'NO_SAVE_BTN';
        saveBtn.click();
        return 'CLICKED_SAVE';
      })()`,
      returnByValue: true
    });
    console.log('Step 4 eval result:', JSON.stringify(evalRes4));
    await sleep(2000);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_zone_saved.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_zone_saved.png');

    // Step 5: Vertex Editing Mode
    console.log('Activating Vertex Reshape Mode...');
    const evalRes5 = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const reshapeBtn = buttons.find(b => b.textContent.includes('Reshape'));
        if (!reshapeBtn) return { error: 'no reshape btn', buttons: buttons.map(b => b.textContent.trim()) };
        reshapeBtn.click();
        return { clicked: true };
      })()`,
      returnByValue: true
    });
    console.log('Step 5 eval result:', JSON.stringify(evalRes5));
    await sleep(2000);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_vertex_editing.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_vertex_editing.png');

    // Step 6: Trigger Delete Modal
    console.log('Triggering Delete Zone Modal...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        // First exit vertex editing if needed
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancel'));
        if (cancelBtn) cancelBtn.click();
      })()`
    });
    await sleep(800);

    const evalResDeleteModal = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const trashBtn = document.querySelector('button[title*="Delete zone from local preview"]');
        if (!trashBtn) return { error: 'no trash btn' };
        trashBtn.click();
        return { clicked: true };
      })()`,
      returnByValue: true
    });
    console.log('Delete modal trigger result:', JSON.stringify(evalResDeleteModal));
    await sleep(1000);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_delete_modal.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_delete_modal.png');

    // Step 7: Confirm Zone Deletion
    console.log('Confirming Zone Deletion in Modal...');
    const evalResConfirmDelete = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const deleteConfirmBtn = buttons.find(b => b.textContent.trim() === 'Delete Zone');
        if (!deleteConfirmBtn) return { error: 'no delete confirm btn', buttons: buttons.map(b => b.textContent.trim()) };
        deleteConfirmBtn.click();
        return { clicked: true };
      })()`,
      returnByValue: true
    });
    console.log('Delete confirm result:', JSON.stringify(evalResConfirmDelete));
    await sleep(1500);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_zone_deleted.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_zone_deleted.png');

    // Step 8: Mobile Responsive Viewport
    console.log('Capturing Mobile Geofencing Viewport...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(1500);
    shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'geofencing_mobile_layout.png'), Buffer.from(shot.data, 'base64'));
    console.log('Captured: geofencing_mobile_layout.png');

    await client.close();
  } finally {
    edgeProc.kill();
  }
}

captureInteractiveGeofencing()
  .then(() => {
    console.log('Geofencing capture suite completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Capture error:', err);
    process.exit(1);
  });
