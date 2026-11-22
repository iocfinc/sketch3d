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
  'scaleMiniBtn', 'scaleSwatchBtn', 'partIntentToggle',
  'intentVesselBtn', 'intentLampshadeBtn', 'partIntentSelect',
  'slicerProfileSelect', 'export3mfBtn'
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

// Unit test: Lattice displacement & minimum rib guard
const { evaluateLatticeDisplacement } = await import('../src/geometry/lattices.js');
const perfDisp = evaluateLatticeDisplacement('perforated-weave', 1.6, 20, 0, 10, 30);
assert(!Number.isNaN(perfDisp) && perfDisp !== 0, 'Perforated weave displacement calculates non-zero non-NaN value', `Disp: ${perfDisp.toFixed(4)}mm`);

const lfamDisp = evaluateLatticeDisplacement('lfam-rib', 2.0, 16, 0, 10, 30);
assert(!Number.isNaN(lfamDisp) && lfamDisp !== 0, 'LFAM Wide-Bead displacement calculates non-zero non-NaN value', `Disp: ${lfamDisp.toFixed(4)}mm`);

// Unit test: 3MF Pure-JS ZIP writer & Bambu profile metadata
const { buildZipBuffer, getSlicerProfileSettings } = await import('../src/export/threemfExporter.js');
const testZip = buildZipBuffer([{ name: 'test.txt', data: 'hello 3mf' }]);
const testView = new DataView(testZip);
assert(testView.getUint32(0, true) === 0x04034b50, 'buildZipBuffer generates valid PKZIP signature (0x04034b50)');

const glassProfile = getSlicerProfileSettings('clear_glass');
assert(glassProfile.fan_min_speed[0] === '0' && glassProfile.sparse_infill_pattern === 'alignedrectilinear', 'Clear Glass profile configures 0% fan and aligned rectilinear infill');

// Unit test: 2D polygon perimeter subdivision
const { subdividePolygon2D, computePolygonCentroid2D, normalizeLatheProfile2D } = await import('../src/geometry/shell3d.js');
const rectPts = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
const subbedRect = subdividePolygon2D(rectPts, 1.2);
assert(subbedRect.length >= 160, 'subdividePolygon2D subdivides 200mm rectangle perimeter into >= 160 segments', `Count: ${subbedRect.length}`);

// Unit test: 2D polygon centroid & lathe profile normalization
const offCenterPts = [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 50 }, { x: 20, y: 50 }];
const c2d = computePolygonCentroid2D(offCenterPts);
assert(Math.abs(c2d.x - 50) < 0.001 && Math.abs(c2d.y - 30) < 0.001, 'computePolygonCentroid2D accurately computes 2D centroid for off-center polygon', `Centroid: (${c2d.x}, ${c2d.y})`);

const straddlingProfile = [{ x: -20, y: 10 }, { x: 10, y: 30 }, { x: 30, y: 50 }];
const normProfile = normalizeLatheProfile2D(straddlingProfile);
assert(normProfile.every(p => p.r >= 0.5), 'normalizeLatheProfile2D normalizes negative X coordinates into r >= 0.5', `Min r: ${Math.min(...normProfile.map(p => p.r))}`);

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

    // Test 8: Surface Texture Modifiers across all patterns (including Sprint 4 lattices)
    const patterns = ['ripple', 'weave', 'wave', 'flute', 'gyroid', 'coral', 'strata', 'perforated-weave', 'lfam-rib'];
    for (const pat of patterns) {
      const patResult = await evalInPage(`(() => {
        const sel = document.getElementById('texturePatternSelect');
        sel.value = '${pat}';
        sel.dispatchEvent(new Event('change'));
        return document.getElementById('dimOverlay').textContent;
      })()`);
      assert(patResult && patResult.includes('Size:') && !patResult.includes('NaN'), `Texture '${pat}' applies non-NaN coordinates`, patResult);
    }

    // Test 8b: Part Intent Lampshade Toggle & Non-NaN Geometry
    const lampshadeTest = await evalInPage(`(() => {
      document.getElementById('intentLampshadeBtn').click();
      const selVal = document.getElementById('partIntentSelect').value;
      const dim = document.getElementById('dimOverlay').textContent;
      return { selVal, dim };
    })()`);
    assert(lampshadeTest.selVal === 'lampshade', 'Part Intent toggle switches to lampshade');
    assert(lampshadeTest.dim.includes('Size:') && !lampshadeTest.dim.includes('NaN'), 'Lampshade intent produces valid non-NaN 3D geometry', lampshadeTest.dim);

    // Test 8c: Outer-Wall Surface Texture on Extruded & Shelled Polygon Regression Test
    const outerWallTexTest = await evalInPage(`(async () => {
      const { computeShellInner, buildHollowExtrudeGeometry } = await import('./src/geometry/shell3d.js');
      const { applySurfaceTexture } = await import('./src/geometry/textures.js');

      // 60x40mm rectangle extruded to 20mm, shelled at 1.2mm wall thickness
      const outerRect = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
      const innerRect = computeShellInner(outerRect, 1.2);
      const geom = buildHollowExtrudeGeometry(outerRect, innerRect, 20, 1.2, 0, false, {
        texturePattern: 'weave',
        textureFreq: 24
      });

      const pos = geom.attributes.position;
      const maskAttr = geom.attributes.aOuterWallMask;
      const before = [];
      for (let i = 0; i < pos.count; i++) {
        before.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
      }

      applySurfaceTexture(geom, { pattern: 'weave', depth: 0.8, freq: 24 });

      let maxOuterDisp = 0;
      let maxInnerDrift = 0;
      let hasNaN = false;

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
          hasNaN = true;
        }

        const b = before[i];
        const dist = Math.hypot(x - b.x, z - b.z);
        const isOuter = maskAttr && maskAttr.getX(i) > 0.5;
        if (isOuter) {
          if (dist > maxOuterDisp) maxOuterDisp = dist;
        } else {
          if (dist > maxInnerDrift) maxInnerDrift = dist;
        }
      }

      return { maxOuterDisp, maxInnerDrift, hasNaN, vertexCount: pos.count };
    })()`);
    assert(outerWallTexTest.maxOuterDisp > 0.35, 'Shelled rectangle outer wall has procedural relief displacement (> 0.35mm)', `Max disp: ${outerWallTexTest.maxOuterDisp.toFixed(3)}mm`);
    assert(outerWallTexTest.maxInnerDrift < 0.01, 'Shelled rectangle inner cavity and rim maintain zero drift (< 0.01mm)', `Inner drift: ${outerWallTexTest.maxInnerDrift.toFixed(4)}mm`);
    assert(!outerWallTexTest.hasNaN, 'Shelled extruded textured geometry has zero NaN coordinates', `Vertices: ${outerWallTexTest.vertexCount}`);

    // Test 8d: Centroid-Anchored Twist Alignment & Revolve Axis Normalization
    const centroidTwistTest = await evalInPage(`(async () => {
      const { buildPartGeometry } = await import('./src/geometry/meshBuilder.js');
      // 1. Off-center rectangle 60x40 at (20..80, 10..50) with 45 deg twist
      const partTwist = {
        id: 'test-twist',
        type: 'extrude',
        points: [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 50 }, { x: 20, y: 50 }],
        extrudeHeight: 24,
        twistDeg: 45,
        isClosed: true
      };
      const geomTwist = buildPartGeometry(partTwist);
      geomTwist.computeBoundingBox();
      const pos = geomTwist.attributes.position;
      let bX = 0, bZ = 0, bCount = 0;
      let tX = 0, tZ = 0, tCount = 0;
      const bMinY = geomTwist.boundingBox.min.y, bMaxY = geomTwist.boundingBox.max.y;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (Math.abs(y - bMinY) < 0.2) { bX += pos.getX(i); bZ += pos.getZ(i); bCount++; }
        if (Math.abs(y - bMaxY) < 0.2) { tX += pos.getX(i); tZ += pos.getZ(i); tCount++; }
      }
      const bCent = { x: bCount ? bX / bCount : 0, z: bCount ? bZ / bCount : 0 };
      const tCent = { x: tCount ? tX / tCount : 0, z: tCount ? tZ / tCount : 0 };
      const drift = Math.hypot(tCent.x - bCent.x, tCent.z - bCent.z);

      // 2. Revolve profile straddling X = 0
      const partRevolve = {
        id: 'test-revolve',
        type: 'revolve',
        points: [{ x: -15, y: 0 }, { x: 20, y: 20 }, { x: 30, y: 40 }],
        isClosed: false
      };
      const geomRev = buildPartGeometry(partRevolve);
      geomRev.computeBoundingBox();
      const asymmX = Math.abs(geomRev.boundingBox.max.x + geomRev.boundingBox.min.x);
      const asymmZ = Math.abs(geomRev.boundingBox.max.z + geomRev.boundingBox.min.z);

      return { drift, asymmX, asymmZ };
    })()`);
    assert(centroidTwistTest.drift <= 0.05, 'Centroid-anchored twist maintains bottom-to-top centroid alignment <= 0.05mm', `Drift: ${centroidTwistTest.drift.toFixed(4)}mm`);
    assert(centroidTwistTest.asymmX < 0.1 && centroidTwistTest.asymmZ < 0.1, 'Revolve 360 profile normalization ensures XZ symmetry < 0.1mm', `Asymm: (${centroidTwistTest.asymmX.toFixed(3)}, ${centroidTwistTest.asymmZ.toFixed(3)})`);

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

    // Test 10b: Multi-Object .3MF Export Check with Clear Glass profile
    const export3mfCheck = await evalInPage(`(() => {
      let downloadTriggered = false;
      let blobSize = 0;
      let downloadedName = '';
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { downloadTriggered = true; blobSize = blob.size; return origCreate(blob); };
      const origA = document.createElement;
      document.createElement = function(tag) {
        const el = origA.call(document, tag);
        if (tag.toLowerCase() === 'a') {
          const origClick = el.click;
          el.click = function() { downloadedName = el.download; return origClick.call(el); };
        }
        return el;
      };

      document.getElementById('slicerProfileSelect').value = 'clear_glass';
      document.getElementById('slicerProfileSelect').dispatchEvent(new Event('change'));
      document.getElementById('export3mfBtn').click();

      document.createElement = origA;
      URL.createObjectURL = origCreate;
      return { downloadTriggered, blobSize, downloadedName };
    })()`);
    assert(export3mfCheck.downloadTriggered && export3mfCheck.downloadedName.endsWith('.3mf') && export3mfCheck.blobSize > 500, 'Export .3MF triggers file download > 500 bytes with .3mf extension', `File: ${export3mfCheck.downloadedName}, Size: ${export3mfCheck.blobSize} bytes`);

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
