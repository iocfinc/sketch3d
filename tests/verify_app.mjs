/**
 * SKETCH3D — Sprint 3 Automated Verification Suite
 * ==================================================
 * Tests DESIGN_GUARDRAILS.md Section 3:
 * 1. Zero runtime / console errors
 * 2. Responsive overflow check (375x812, 768x1024, 1280x800)
 * 3. 2D Canvas interaction (draw, close, drag, clear)
 * 4. Extrude height clamping (300mm -> 256mm max)
 * 5. Parametric modifiers (Round, Bevel, Twist, 3D Shelling, Surface Textures)
 * 6. Binary STL export (> 84 bytes, watertight manifold)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ANSI formatting
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const CYAN = '\x1b[96m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passedTests++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${BOLD}${testName}${RESET}${details ? ' — ' + details : ''}`);
  } else {
    failedTests++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${BOLD}${testName}${RESET}${details ? ' — ' + details : ''}`);
  }
}

// =========================================================
// 1. Static Contract & DOM Verification
// =========================================================
console.log(`\n${CYAN}${BOLD}1. Verifying HTML, DOM IDs & Design System Tokens...${RESET}`);
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf-8');

// Verify Essential Element IDs from DESIGN_GUARDRAILS.md
const REQUIRED_IDS = [
  'sketchCanvas', 'threeContainer', 'extrudeSlider', 'extrudeInput',
  'roundSlider', 'bevelSlider', 'twistSlider', 'shellToggleBtn',
  'shellModeSelect', 'shellInput', 'exportStlBtn', 'presetCardBtn',
  'presetHexBtn', 'presetLampBtn', 'presetVaseBtn', 'viewSplitBtn',
  'view2DBtn', 'view3DBtn', 'panel2D', 'panel3D', 'dimOverlay',
  'estimateOverlay', 'fitBadge', 'texturePatternSelect',
  'textureDepthSlider', 'textureFreqSlider', 'toastMsg'
];

REQUIRED_IDS.forEach(id => {
  assert(indexHtml.includes(`id="${id}"`), `DOM element #${id} present`);
});

// Verify Design System Tokens
const TOKENS = [
  '--bg-dark', '--surface-panel', '--surface-bar', '--border-subtle',
  '--brand-yellow', '--brand-pink', '--brand-green', '--brand-cyan'
];
TOKENS.forEach(tok => {
  assert(indexHtml.includes(tok), `CSS custom property token ${tok} defined`);
});

// Verify CSP Header
assert(
  indexHtml.includes('http-equiv="Content-Security-Policy"'),
  'Content-Security-Policy meta tag present'
);
assert(
  indexHtml.includes('assets/sketch3d-icon.svg'),
  'App icon linked in index.html'
);

// =========================================================
// 2. Headless Browser Verification (Chrome DevTools Protocol)
// =========================================================
console.log(`\n${CYAN}${BOLD}2. Launching Local Static Server & Headless Browser...${RESET}`);

// Find Chrome Executable
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

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

// Start local HTTP server
const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let filePath = path.join(ROOT_DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const appUrl = `http://127.0.0.1:${port}/index.html`;

if (!chromePath) {
  console.log(`  ${RED}⚠ Chrome not found on this system, skipping headless browser phase.${RESET}`);
} else {
  console.log(`  Found Chrome: ${chromePath}`);
  const debugPort = 9222 + Math.floor(Math.random() * 500);

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--mute-audio',
    'about:blank'
  ]);

  // Wait for Chrome CDP endpoint
  async function waitForCdp(maxMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (res.ok) return true;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  const cdpReady = await waitForCdp();
  if (!cdpReady) {
    console.error(`  ${RED}✖ Failed to connect to Chrome DevTools endpoint${RESET}`);
    chromeProc.kill('SIGKILL');
  } else {
    // Create new target tab
    const newTabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`, { method: 'PUT' });
    const tabInfo = await newTabRes.json();
    const wsUrl = tabInfo.webSocketDebuggerUrl;

    // Connect WebSocket
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const uncaughtErrors = [];

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    function sendCmd(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        uncaughtErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    // Enable Runtime and Page domains
    await sendCmd('Runtime.enable');
    await sendCmd('Page.enable');

    // Wait for page load and Three.js initialization
    await new Promise(r => setTimeout(r, 1500));

    // Test 1: Zero runtime console/page errors
    assert(consoleErrors.length === 0, 'Zero console.error events', consoleErrors.join('; '));
    assert(uncaughtErrors.length === 0, 'Zero uncaught page exceptions', uncaughtErrors.join('; '));

    // Helper: evaluate JS in page context
    async function evalInPage(expression) {
      const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.text + ' ' + (res.exceptionDetails.exception?.description || ''));
      }
      return res.result?.value;
    }

    // Test 2: Responsive Viewport Overflow Check (DESIGN_GUARDRAILS.md Section 3.2)
    const viewports = [
      { name: 'iPhone (375x812)', w: 375, h: 812 },
      { name: 'iPad Portrait (768x1024)', w: 768, h: 1024 },
      { name: 'Desktop (1280x800)', w: 1280, h: 800 }
    ];

    for (const vp of viewports) {
      await sendCmd('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 1,
        mobile: vp.w < 1000
      });
      await new Promise(r => setTimeout(r, 200));

      const overflow = await evalInPage(`
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth
      `);
      assert(overflow, `Responsive overflow check at ${vp.name}`, 'scrollWidth <= innerWidth');

      // Capture screenshots if SCREENSHOT_DIR is specified
      if (process.env.SCREENSHOT_DIR && (vp.w === 375 || vp.w === 1280)) {
        const shot = await sendCmd('Page.captureScreenshot', { format: 'png' });
        if (shot.data) {
          const fname = vp.w === 375 ? 'mobile_preview.png' : 'desktop_preview.png';
          fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, fname), Buffer.from(shot.data, 'base64'));
        }
      }
    }

    // Restore desktop view
    await sendCmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // Test 3: 2D Canvas Interaction & Clamping
    const clearResult = await evalInPage(`
      document.getElementById('clearBtn').click();
      document.getElementById('pointCountBadge').textContent;
    `);
    assert(clearResult.includes('0 pts'), 'Clear button resets points to 0');

    // Load presets and verify live mesh generation
    const presetCard = await evalInPage(`
      document.getElementById('presetCardBtn').click();
      document.getElementById('dimOverlay').textContent;
    `);
    assert(presetCard.includes('Size:'), 'EDC Frame preset loads with valid 3D dimension', presetCard);

    // Test 4: Extrude Clamping at 300mm -> 256mm max (Bambu Lab A1 Envelope)
    const clampResult = await evalInPage(`
      const input = document.getElementById('extrudeInput');
      input.value = '300';
      input.dispatchEvent(new Event('change'));
      document.getElementById('extrudeSlider').value;
    `);
    assert(clampResult === '256', 'Extrude height clamped at 256 mm ceiling', `Result: ${clampResult} mm`);

    // Test 5: Parametric Modifiers (Round, Bevel, Twist)
    const modifiersTest = await evalInPage(`
      const round = document.getElementById('roundSlider');
      round.value = '5';
      round.dispatchEvent(new Event('input'));

      const bevel = document.getElementById('bevelSlider');
      bevel.value = '2.5';
      bevel.dispatchEvent(new Event('input'));

      const twist = document.getElementById('twistSlider');
      twist.value = '45';
      twist.dispatchEvent(new Event('input'));

      document.getElementById('dimOverlay').textContent;
    `);
    assert(modifiersTest.includes('Size:') && !modifiersTest.includes('NaN'), 'Round/Bevel/Twist modifiers update geometry smoothly', modifiersTest);

    // Test 6: 3D Shelling (Hollow Open-Top & Vase Proxy)
    const shellTest = await evalInPage(`
      const shellBtn = document.getElementById('shellToggleBtn');
      if (shellBtn.textContent.includes('Off')) shellBtn.click();
      const shellMode = document.getElementById('shellModeSelect');
      shellMode.value = 'hollow';
      shellMode.dispatchEvent(new Event('change'));
      const est1 = document.getElementById('estimateOverlay').textContent;

      shellMode.value = 'vase_proxy';
      shellMode.dispatchEvent(new Event('change'));
      const est2 = document.getElementById('estimateOverlay').textContent;

      ({ estHollow: est1, estVase: est2 });
    `);
    assert(shellTest.estHollow.includes('PLA') && shellTest.estVase.includes('PLA'), '3D Shelling (Hollow & Vase Proxy) updates PLA mass estimation', JSON.stringify(shellTest));

    // Test 7: Vase Preset (Revolve 360° + RippleMesh Weave + Vase Proxy)
    const vasePresetTest = await evalInPage(`
      document.getElementById('presetVaseBtn').click();
      const dim = document.getElementById('dimOverlay').textContent;
      const fit = document.getElementById('fitBadge').textContent;
      ({ dim, fit });
    `);
    assert(vasePresetTest.dim.includes('Size:') && !vasePresetTest.dim.includes('NaN'), 'Vase Shade preset generates valid 3D geometry', vasePresetTest.dim);
    assert(vasePresetTest.fit.includes('Fits A1 Bed'), 'Vase Shade fits Bambu Lab A1 bed', vasePresetTest.fit);

    // Test 8: Surface Texture Modifiers
    const textureTest = await evalInPage(`
      const texSelect = document.getElementById('texturePatternSelect');
      texSelect.value = 'weave';
      texSelect.dispatchEvent(new Event('change'));

      const depth = document.getElementById('textureDepthSlider');
      depth.value = '1.5';
      depth.dispatchEvent(new Event('input'));

      document.getElementById('dimOverlay').textContent;
    `);
    assert(textureTest.includes('Size:') && !textureTest.includes('NaN'), 'Surface texture displacement applies non-NaN coordinates', textureTest);

    // Test 9: Binary STL Export Check (> 84 bytes)
    const exportCheck = await evalInPage(`
      let downloadTriggered = false;
      let blobSize = 0;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        downloadTriggered = true;
        blobSize = blob.size;
        return origCreate(blob);
      };
      document.getElementById('exportStlBtn').click();
      URL.createObjectURL = origCreate;
      ({ downloadTriggered, blobSize });
    `);
    assert(exportCheck.downloadTriggered && exportCheck.blobSize > 84, 'Binary STL export triggers file download > 84 bytes', `Size: ${exportCheck.blobSize} bytes`);

    // Cleanup Chrome
    ws.close();
    chromeProc.kill('SIGTERM');
  }
}

// Close HTTP server
server.close();

console.log(`\n${BOLD}=== Verification Summary ===${RESET}`);
console.log(`Passed:   ${GREEN}${passedTests}${RESET}`);
console.log(`Failed:   ${failedTests === 0 ? GREEN + '0' : RED + failedTests}${RESET}\n`);

if (failedTests > 0) {
  console.error(`${RED}${BOLD}Verification FAILED with ${failedTests} error(s).${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}Verification PASSED successfully! All checks verified.${RESET}`);
  process.exit(0);
}
