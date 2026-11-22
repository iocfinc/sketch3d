/**
 * SKETCH3D — Headless HTML-to-PDF Catalog Generator
 * ==================================================
 * Launches headless Chromium, navigates to catalog.html, verifies 0 console errors,
 * and exports vector A4 portrait PDF to assets/Textures_on_SKETCH3D_Catalog.pdf.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PDF = path.join(ROOT_DIR, 'assets', 'Textures_on_SKETCH3D_Catalog.pdf');

// ANSI formatting
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const CYAN = '\x1b[96m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error(`${RED}${BOLD}Error: No Chrome or Chromium binary found on host.${RESET}`);
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let filePath = path.join(ROOT_DIR, parsed.pathname === '/' ? 'catalog.html' : parsed.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`${CYAN}${BOLD}Local HTTP server running on http://127.0.0.1:${port}${RESET}`);

  const tempProfile = fs.mkdtempSync(path.join('/tmp', 'sketch3d-pdf-'));
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${tempProfile}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const activePortFile = path.join(tempProfile, 'DevToolsActivePort');
  let cdpPort = null;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(activePortFile)) {
      const content = fs.readFileSync(activePortFile, 'utf-8').trim().split('\n');
      cdpPort = parseInt(content[0], 10);
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!cdpPort) {
    throw new Error('Failed to obtain Chrome DevTools active port');
  }

  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const pages = await listRes.json();
  const targetPage = pages.find(p => p.type === 'page');
  const wsUrl = targetPage.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pendingRequests = new Map();
  const consoleErrors = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      const text = data.params.args.map(a => a.value || a.description || '').join(' ');
      consoleErrors.push(text);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(data.params.exceptionDetails.text);
    }
  };

  const sendCommand = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  console.log(`${CYAN}Navigating to catalog.html...${RESET}`);
  await sendCommand('Page.navigate', { url: `http://127.0.0.1:${port}/catalog.html` });

  // Wait for load and canvas animations
  await new Promise(r => setTimeout(r, 1200));

  if (consoleErrors.length > 0) {
    console.error(`${RED}${BOLD}Console errors detected in catalog.html:${RESET}`, consoleErrors);
    throw new Error(`catalog.html threw ${consoleErrors.length} console error(s)`);
  }

  console.log(`${CYAN}Exporting PDF via Page.printToPDF (A4 portrait, 0 margin)...${RESET}`);
  const pdfResult = await sendCommand('Page.printToPDF', {
    paperWidth: 8.27,
    paperHeight: 11.69,
    printBackground: true,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    preferCSSPageSize: true
  });

  const pdfBuffer = Buffer.from(pdfResult.data, 'base64');
  fs.mkdirSync(path.dirname(OUTPUT_PDF), { recursive: true });
  fs.writeFileSync(OUTPUT_PDF, pdfBuffer);

  ws.close();
  chromeProc.kill('SIGTERM');
  server.close();
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}

  const sizeKb = (pdfBuffer.length / 1024).toFixed(1);
  console.log(`\n${GREEN}${BOLD}✔ Successfully generated lookbook PDF!${RESET}`);
  console.log(`  Path: ${OUTPUT_PDF}`);
  console.log(`  Size: ${sizeKb} KB (${pdfBuffer.length} bytes)\n`);
}

main().catch(err => {
  console.error(`${RED}${BOLD}Failed to generate catalog PDF:${RESET}`, err);
  process.exit(1);
});
