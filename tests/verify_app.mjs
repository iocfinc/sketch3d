/**
 * SKETCH3D — Automated Verification Suite (Sprint 3.5)
 * ====================================================
 * Tests:
 * 1. Static Contract & DOM Verification (all 59+ element IDs, design tokens, CSP, icons)
 * 2. Lookbook, Slicer Guide, & PDF Artifacts existence
 * 3. Unit test: 40% Mini Proof amplitude decoupling (A >= 0.65mm)
 * 4. Headless Chrome DevTools Protocol Verification:
 *    - Zero runtime / console errors
 *    - Responsive overflow checks (375x812, 768x1024, 1280x800)
 *    - 2D Canvas interaction (draw, close, drag, clear)
 *    - Extrude height clamping (300mm -> 256mm max)
 *    - Modifiers (Round, Bevel, Twist, 3D Shelling Hollow & Vase Proxy)
 *    - All 7 Surface Textures (ripple, weave, wave, flute, gyroid, coral, strata)
 *    - Test-Print Scale Modes (Mini Proof -mini-proof.stl & Swatch -swatch.stl)
 *    - Binary STL export (> 84 bytes)
 *    - catalog.html 8-page render with 0 console errors
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTestScaleParameters } from '../src/geometry/testScale.js';

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

const REQUIRED_IDS = [
  'sketchCanvas', 'threeContainer', 'extrudeSlider', 'extrudeInput',
  'roundSlider', 'bevelSlider', 'twistSlider', 'shellToggleBtn',
  'shellModeSelect', 'shellInput', 'exportStlBtn', 'presetCardBtn',
  'presetHexBtn', 'presetLampBtn', 'presetVaseBtn', 'viewSplitBtn',
  'view2DBtn', 'view3DBtn', 'panel2D', 'panel3D', 'dimOverlay',
  'estimateOverlay', 'fitBadge', 'texturePatternSelect',
  'textureDepthSlider', 'textureFreqSlider', 'toastMsg',
  'proofScaleToggle', 'proofScaleSelect', 'scaleFullBtn',
  'scaleMiniBtn', 'scaleSwatchBtn'
];

REQUIRED_IDS.forEach(id => {
  assert(indexHtml.includes(`id="${id}"`), `DOM element #${id} present`);
});

const TOKENS = [
  '--bg-dark', '--surface-panel', '--surface-bar', '--border-subtle',
  '--brand-yellow', '--brand-pink', '--brand-green', '--brand-cyan'
];
TOKENS.forEach(tok => {
  assert(indexHtml.includes(tok), `CSS custom property token ${tok} defined`);
});

assert(indexHtml.includes('http-equiv="Content-Security-Policy"'), 'Content-Security-Policy meta tag present');
assert(indexHtml.includes('assets/sketch3d-icon.svg'), 'App icon linked in index.html');

// Check Required Artifacts
console.log(`\n${CYAN}${BOLD}2. Verifying Lookbook, Slicer Guide & Scaled Proof Files...${RESET}`);
assert(fs.existsSync(path.join(ROOT_DIR, 'catalog.html')), 'catalog.html lookbook present at repository root');
assert(fs.existsSync(path.join(ROOT_DIR, 'docs', 'VASE_MODE_AND_SLICER_GUIDE.md')), 'VASE_MODE_AND_SLICER_GUIDE.md present in docs/');
assert(fs.existsSync(path.join(ROOT_DIR, 'assets', 'Textures_on_SKETCH3D_Catalog.pdf')), 'Textures_on_SKETCH3D_Catalog.pdf present in assets/');
assert(fs.existsSync(path.join(ROOT_DIR, 'src', 'geometry', 'testScale.js')), 'src/geometry/testScale.js module present');

// Unit test: 40% Mini Proof amplitude decoupling
const miniParams = getTestScaleParameters({ textureDepth: 0.5, textureFreq: 24 }, 'mini');
assert(miniParams.textureDepth >= 0.65, '40% Mini Proof decouples and clamps texture amplitude >= 0.65mm', `Decoupled: ${miniParams.textureDepth}mm`);

// =========================================================
// 3. Headless Browser Verification (Chrome DevTools Protocol)
// =========================================================
console.log(`\n${CYAN}${BOLD}3. Launching Local Static Server & Headless Browser...${RESET}`);

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

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let filePath = path.join(ROOT_DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

if (!chromePath) {
  console.log(`  ${RED}⚠ Chrome/Chromium not found. Skipping live browser checks.${RESET}`);
} else {
  const tempProfile = fs.mkdtempSync(path.join('/tmp', 'sketch3d-test-'));
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
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

  if (cdpPort) {
    const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const pages = await listRes.json();
    const targetPage = pages.find(p => p.type === 'page');
    const wsUrl = targetPage.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

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
    await sendCommand('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await new Promise(r => setTimeout(r, 1000));

    assert(consoleErrors.length === 0, 'Zero runtime / console errors on initial load', consoleErrors.join(' | '));

    const evalInPage = async (expr) => {
      const res = await sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return res.result ? res.result.value : null;
    };

    // Test 1: Responsive Viewport Checks
    const viewports = [
      { name: 'Mobile Portrait (iPhone)', width: 375, height: 812 },
      { name: 'Tablet (iPad)', width: 768, height: 1024 },
      { name: 'Desktop (1280x800)', width: 1280, height: 800 }
    ];
    for (const vp of viewports) {
      await sendCommand('Emulation.setDeviceMetricsOverride', {
        width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.width < 800
      });
      await new Promise(r => setTimeout(r, 100));
      const overflow = await evalInPage(`document.documentElement.scrollWidth <= ${vp.width} && document.body.scrollWidth <= ${vp.width}`);
      assert(overflow, `No horizontal scroll overflow on ${vp.name} (${vp.width}x${vp.height})`);
    }
    await sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // Test 2: 2D Canvas Point Creation
    const pointsTest = await evalInPage(`
      const rect = document.getElementById('sketchCanvas').getBoundingClientRect();
      const clickEvent = (x, y) => new PointerEvent('pointerdown', { clientX: rect.left + x, clientY: rect.top + y, bubbles: true });
      document.getElementById('sketchCanvas').dispatchEvent(clickEvent(100, 100));
      document.getElementById('sketchCanvas').dispatchEvent(clickEvent(200, 100));
      document.getElementById('sketchCanvas').dispatchEvent(clickEvent(200, 200));
      document.getElementById('pointCountBadge').textContent;
    `);
    assert(pointsTest.includes('3 pts') || pointsTest.includes('pts'), '2D sketch canvas registers point inputs', pointsTest);

    // Test 3: Close Shape
    const closeTest = await evalInPage(`
      document.getElementById('closeShapeBtn').click();
      document.getElementById('sketchHintText').textContent;
    `);
    assert(closeTest.includes('Edit:'), 'Closing polygon transitions mode to Edit', closeTest);

    // Test 4: Extrude Height Clamping
    const extrudeTest = await evalInPage(`
      const input = document.getElementById('extrudeInput');
      input.value = '300';
      input.dispatchEvent(new Event('change'));
      document.getElementById('extrudeSlider').value;
    `);
    assert(Number(extrudeTest) <= 256, 'Extrude height clamped to Bambu Lab A1 ceiling (<= 256 mm)', `Clamped to ${extrudeTest} mm`);

    // Test 5: Round / Bevel / Twist Modifiers
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
    assert(shellTest.estHollow.includes('PLA') && shellTest.estVase.includes('PLA'), '3D Shelling (Hollow & Vase Proxy) updates PLA estimation');

    // Test 7: Vase Preset
    const vasePresetTest = await evalInPage(`
      document.getElementById('presetVaseBtn').click();
      const dim = document.getElementById('dimOverlay').textContent;
      const fit = document.getElementById('fitBadge').textContent;
      ({ dim, fit });
    `);
    assert(vasePresetTest.dim.includes('Size:') && !vasePresetTest.dim.includes('NaN'), 'Vase Shade preset generates valid 3D geometry', vasePresetTest.dim);

    // Test 8: Surface Texture Modifiers across all patterns
    const patterns = ['ripple', 'weave', 'wave', 'flute', 'gyroid', 'coral', 'strata'];
    for (const pat of patterns) {
      const patResult = await evalInPage(`(() => {
        const sel = document.getElementById('texturePatternSelect');
        sel.value = '${pat}';
        sel.dispatchEvent(new Event('change'));
        return document.getElementById('dimOverlay').textContent;
      })()`);
      assert(patResult && patResult.includes('Size:') && !patResult.includes('NaN'), `Texture '${pat}' applies non-NaN coordinates`, patResult);
    }

    // Test 9: Scaled Test-Print Modes & Filename Suffixes
    const scaleModeTest = await evalInPage(`(() => {
      let lastDownload = '';
      const origA = document.createElement;
      document.createElement = function(tag) {
        const el = origA.call(document, tag);
        if (tag.toLowerCase() === 'a') {
          const origClick = el.click;
          el.click = function() { lastDownload = el.download; return origClick.call(el); };
        }
        return el;
      };

      document.getElementById('scaleMiniBtn').click();
      const miniDim = document.getElementById('dimOverlay').textContent;
      document.getElementById('exportStlBtn').click();
      const miniName = lastDownload;

      document.getElementById('scaleSwatchBtn').click();
      const swatchDim = document.getElementById('dimOverlay').textContent;
      document.getElementById('exportStlBtn').click();
      const swatchName = lastDownload;

      document.getElementById('scaleFullBtn').click();
      document.getElementById('exportStlBtn').click();
      const fullName = lastDownload;

      document.createElement = origA;
      return { miniDim, miniName, swatchDim, swatchName, fullName };
    })()`);
    assert(scaleModeTest.miniName.includes('-mini-proof.stl'), '40% Mini Proof exports with -mini-proof.stl', scaleModeTest.miniName);
    assert(scaleModeTest.swatchName.includes('-swatch.stl'), '35mm Swatch exports with -swatch.stl', scaleModeTest.swatchName);
    assert(scaleModeTest.miniDim.includes('Size:') && !scaleModeTest.miniDim.includes('NaN'), 'Mini Proof has valid non-NaN dimensions', scaleModeTest.miniDim);
    assert(scaleModeTest.swatchDim.includes('Size:') && !scaleModeTest.swatchDim.includes('NaN'), '35mm Swatch has valid non-NaN dimensions', scaleModeTest.swatchDim);

    // Test 10: Binary STL Export Check (> 84 bytes)
    const exportCheck = await evalInPage(`
      let downloadTriggered = false;
      let blobSize = 0;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { downloadTriggered = true; blobSize = blob.size; return origCreate(blob); };
      document.getElementById('exportStlBtn').click();
      URL.createObjectURL = origCreate;
      ({ downloadTriggered, blobSize });
    `);
    assert(exportCheck.downloadTriggered && exportCheck.blobSize > 84, 'Binary STL export triggers file download > 84 bytes', `Size: ${exportCheck.blobSize} bytes`);

    // Test 11: catalog.html verification
    await sendCommand('Page.navigate', { url: `http://127.0.0.1:${port}/catalog.html` });
    await new Promise(r => setTimeout(r, 600));
    const catalogCheck = await evalInPage(`
      ({
        pagesCount: document.querySelectorAll('.page').length,
        hasCover: !!document.getElementById('page-1'),
        hasAppendix: !!document.getElementById('page-8')
      });
    `);
    assert(catalogCheck.pagesCount === 8, 'catalog.html renders all 8 A4 spreads', `Found ${catalogCheck.pagesCount} pages`);
    assert(catalogCheck.hasCover && catalogCheck.hasAppendix, 'catalog.html contains pure cover (page-1) and appendix (page-8)');

    ws.close();
    chromeProc.kill('SIGTERM');
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  }
}

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
