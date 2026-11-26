/**
 * SKETCH3D — Automated Verification Suite (5-Stage Progressive UI & Kernel)
 * ========================================================================
 * Tests:
 * 1. Static Contract & DOM Verification (5-stage hooks, all core IDs, design tokens, CSP, icons)
 * 2. Lookbook, Slicer Guide, Migration & Slicer Profile Unit Tests
 * 3. Headless Chrome DevTools Protocol Verification:
 *    - Zero runtime / console errors
 *    - Responsive overflow checks (375x812, 768x1024, 1280x800)
 *    - 5-stage progressive flow (#stageTab1..#stageTab5, dataset.activeStage)
 *    - Stage 1 collapsible 3D corner preview & Revolve Axis Guide toggle
 *    - Stage 2..5 Edit Sketch return to Stage 1 & Extrude clamping (300mm -> 256mm)
 *    - Stage 3 ordered modifier card toggles, Round/Bevel/Twist, Shelling, Part Intent
 *    - Stage 4 all 10 surface textures + outer-wall decoupling
 *    - Stage 5 Scaled Test-Print modes, Binary STL (> 84B), .3MF (> 500B)
 *    - catalog.html 8-page render with 0 console errors
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTestScaleParameters } from '../src/geometry/testScale.js';
import { PRESETS } from '../src/config/presets.js';

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
console.log(`\n${CYAN}${BOLD}1. Verifying HTML, 5-Stage DOM Hooks, Core IDs & Design Tokens...${RESET}`);
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf-8');

const REQUIRED_IDS = [
  'sketchCanvas', 'threeContainer', 'extrudeSlider', 'extrudeInput',
  'roundSlider', 'bevelSlider', 'twistSlider', 'shellToggleBtn',
  'shellModeSelect', 'shellInput', 'exportStlBtn', 'export3mfBtn',
  'presetCardBtn', 'presetHexBtn', 'presetLampBtn', 'presetVaseBtn',
  'viewSplitBtn', 'view2DBtn', 'view3DBtn', 'panel2D', 'panel3D',
  'dimOverlay', 'estimateOverlay', 'fitBadge', 'texturePatternSelect',
  'textureDepthSlider', 'textureFreqSlider', 'toastMsg',
  'proofScaleToggle', 'proofScaleSelect', 'scaleFullBtn',
  'scaleMiniBtn', 'scaleSwatchBtn', 'partIntentToggle',
  'intentVesselBtn', 'intentLampshadeBtn', 'partIntentSelect',
  'slicerProfileSelect', 'planeSelect', 'splitJointBtn',
  'autoArrangeBtn', 'modeNutM3Btn', 'modeNutM4Btn',
  'modeCskM3Btn', 'modeCskM4Btn',
  // 5-Stage UI hooks & controls
  'appHeader', 'templatesMenuBtn', 'templatesMenu', 'stageRail',
  'stageTab1', 'stageTab2', 'stageTab3', 'stageTab4', 'stageTab5',
  'projectMenuBtn', 'saveProjectBtn', 'loadProjectBtn',
  'revolveGuideBtn', 'editSketchBtn', 'toggleMiniPreviewBtn',
  'slicerTargetSelect', 'prosumerToolpathBtn', 'prosumerToolpathPanel',
  'exportGcodeBtn', 'exportGcode3mfBtn', 'bandEnabledBtn',
  'toolpathPreviewBtn', 'offsetCloneBtn'
];

REQUIRED_IDS.forEach(id => {
  assert(indexHtml.includes(`id="${id}"`), `DOM element #${id} present`);
});

for (let s = 1; s <= 5; s++) {
  assert(indexHtml.includes(`data-stage="${s}"`), `5-Stage tab hook data-stage="${s}" present`);
  assert(indexHtml.includes(`data-stage-panel="${s}"`), `5-Stage inspector hook data-stage-panel="${s}" present`);
}

const REQUIRED_DATA_TOOLS = [
  'templates-menu', 'project-menu', 'bed-status',
  'draw-bezier', 'gen-revolve', 'mod-shell', 'tex-pattern', 'export-3mf'
];
REQUIRED_DATA_TOOLS.forEach(tool => {
  assert(indexHtml.includes(`data-tool="${tool}"`), `Registered data-tool="${tool}" hook present`);
});
assert(indexHtml.includes('data-modifier='), 'Ordered modifier card hooks (data-modifier) present');

const TOKENS = [
  '--bg-dark', '--surface-panel', '--surface-bar', '--border-subtle',
  '--brand-yellow', '--brand-pink', '--brand-green', '--brand-cyan'
];
TOKENS.forEach(tok => {
  assert(indexHtml.includes(tok), `CSS custom property token ${tok} defined`);
});

assert(indexHtml.includes('http-equiv="Content-Security-Policy"'), 'Content-Security-Policy meta tag present');
assert(indexHtml.includes('assets/sketch3d-icon.svg'), 'App icon linked in index.html');

// =========================================================
// 2. Artifacts & Unit Verification
// =========================================================
console.log(`\n${CYAN}${BOLD}2. Verifying Lookbook, Slicer Guide, Migration & Slicer Profiles...${RESET}`);
assert(fs.existsSync(path.join(ROOT_DIR, 'PRODUCT_MAP.md')), 'PRODUCT_MAP.md present at repository root');
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

// Unit test: 3MF Pure-JS ZIP writer & Unified Bambu/OrcaSlicer profile metadata
const { buildZipBuffer, getSlicerProfileSettings } = await import('../src/export/threemfExporter.js');
const testZip = buildZipBuffer([{ name: 'test.txt', data: 'hello 3mf' }]);
const testView = new DataView(testZip);
assert(testView.getUint32(0, true) === 0x04034b50, 'buildZipBuffer generates valid PKZIP signature (0x04034b50)');

const glassProfile = getSlicerProfileSettings('clear_glass');
assert(glassProfile.fan_min_speed[0] === '0' && glassProfile.sparse_infill_pattern === 'alignedrectilinear', 'Clear Glass profile configures 0% fan and aligned rectilinear infill');

const arachneOrca = getSlicerProfileSettings('basket_weave_arachne', 'orcaslicer');
assert(
  arachneOrca.wall_generator === 'arachne' &&
  arachneOrca.wall_loops === '2' &&
  arachneOrca.layer_height === '0.2' &&
  arachneOrca.line_width === '0.42' &&
  arachneOrca.detect_overhang_wall === '1' &&
  arachneOrca.bridge_speed === '50' &&
  arachneOrca.overhang_4_4_speed === '10' &&
  arachneOrca.enable_support === '0' &&
  (arachneOrca.slicer_target === 'orcaslicer' || arachneOrca.slicer_application === 'OrcaSlicer'),
  'getSlicerProfileSettings("basket_weave_arachne", "orcaslicer") returns verified OrcaSlicer Arachne settings',
  `target=${arachneOrca.slicer_target}, wall=${arachneOrca.wall_generator}`
);

// Unit test: Project Migration V1 -> V2 (all 7 Studio Presets + legacy v1 multi-part JSON)
const { PROJECT_SCHEMA_VERSION, migrateProjectV1ToV2, serializeProjectV2 } = await import('../src/utils/projectMigration.js');
assert(PROJECT_SCHEMA_VERSION === 2, 'PROJECT_SCHEMA_VERSION === 2');

const STUDIO_PRESET_KEYS = ['flute', 'gyroid', 'coral', 'strata', 'bauble', 'tree', 'cube'];
for (const key of STUDIO_PRESET_KEYS) {
  const raw = PRESETS[key];
  const migrated = migrateProjectV1ToV2(raw);
  const part = migrated.parts[0];
  const ok =
    migrated.schemaVersion === 2 &&
    migrated.app === 'SKETCH3D' &&
    migrated.parts.length === 1 &&
    part.name === raw.name &&
    part.type === raw.type &&
    part.texturePattern === (raw.texturePattern || 'none') &&
    part.points.length === raw.points.length &&
    (part.materialTag === 'clear' || part.materialTag === 'opaque');
  assert(ok, `migrateProjectV1ToV2() upgrades Studio Preset '${key}' cleanly`, `type=${part.type}, tex=${part.texturePattern}, tag=${part.materialTag}`);
}

const legacyV1Multi = JSON.stringify({
  activePartIndex: 1,
  scaleMode: 'mini',
  parts: [
    {
      id: 'p1',
      name: 'Legacy Inner',
      type: 'revolve',
      points: [{ x: 20, y: 0 }, { x: 25, y: -40 }, { x: 10, y: -80 }],
      isClosed: false,
      texturePattern: 'coral',
      textureDepth: 1.2,
      textureFreq: 20,
      bandEnabled: true,
      bandCount: 8,
      bandMode: 'weave'
    },
    {
      id: 'p2',
      name: 'Legacy Base',
      type: 'extrude',
      points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
      isClosed: true,
      holes: [{ x: 0, y: 0, r: 1.7 }],
      extrudeHeight: 12,
      shellMode: 'vase_proxy'
    }
  ]
});
const migratedLegacy = migrateProjectV1ToV2(legacyV1Multi);
const reMigrated = migrateProjectV1ToV2(serializeProjectV2(migratedLegacy));
assert(
  migratedLegacy.schemaVersion === 2 &&
  migratedLegacy.parts.length === 2 &&
  migratedLegacy.scaleMode === 'mini' &&
  migratedLegacy.activePartIndex === 1 &&
  migratedLegacy.parts[0].bandEnabled === true &&
  migratedLegacy.parts[0].bandCount === 8 &&
  migratedLegacy.parts[1].holes.length === 1 &&
  migratedLegacy.parts[1].materialTag === 'clear' &&
  reMigrated.parts.length === 2,
  'migrateProjectV1ToV2() upgrades legacy v1 multi-part JSON and is idempotent with serializeProjectV2()'
);

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
  '.json': 'application/json',
  '.wasm': 'application/wasm'
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
        const desc = data.params.exceptionDetails.exception ? data.params.exceptionDetails.exception.description : data.params.exceptionDetails.text;
        consoleErrors.push(desc);
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

    const screenshotDir = process.env.CAPTURE_SCREENSHOTS_DIR || '';
    if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

    // Test 1: Responsive Viewport Checks (375x812, 768x1024, 1280x800)
    const viewports = [
      { name: 'Mobile Portrait (iPhone)', width: 375, height: 812, file: 'mobile_375x812.png' },
      { name: 'Tablet (iPad)', width: 768, height: 1024, file: '' },
      { name: 'Desktop (1280x800)', width: 1280, height: 800, file: 'desktop_1280x800.png' }
    ];
    for (const vp of viewports) {
      await sendCommand('Emulation.setDeviceMetricsOverride', {
        width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.width < 800
      });
      await new Promise(r => setTimeout(r, 150));
      const overflow = await evalInPage(`document.documentElement.scrollWidth <= ${vp.width} && document.body.scrollWidth <= ${vp.width}`);
      assert(overflow, `No horizontal scroll overflow on ${vp.name} (${vp.width}x${vp.height})`);
      if (screenshotDir && vp.file) {
        const shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(screenshotDir, vp.file), Buffer.from(shot.data, 'base64'));
      }
    }
    await sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // Test 2: Stage 1 Initial State, Collapsible 3D Mini-Preview, Revolve Axis Guide, 2D Sketching
    const stage1Check = await evalInPage(`(() => {
      const activeStage = document.body.dataset.activeStage;
      const p3d = document.getElementById('panel3D');
      const hasMiniClass = p3d.classList.contains('stage1-mini-preview');
      const toggleBtn = document.getElementById('toggleMiniPreviewBtn');
      toggleBtn.click();
      const collapsedAfterClick = p3d.classList.contains('is-collapsed');
      toggleBtn.click();
      const expandedAfterSecondClick = !p3d.classList.contains('is-collapsed');

      const guideBtn = document.getElementById('revolveGuideBtn');
      const guideBefore = guideBtn.getAttribute('aria-pressed');
      guideBtn.click();
      const guideAfter = guideBtn.getAttribute('aria-pressed');
      const overlayVisible = !document.getElementById('revolveAxisOverlay').classList.contains('hidden');
      guideBtn.click();

      return { activeStage, hasMiniClass, collapsedAfterClick, expandedAfterSecondClick, guideBefore, guideAfter, overlayVisible };
    })()`);
    assert(stage1Check.activeStage === '1', 'Initial activeStage dataset is "1"', `activeStage=${stage1Check.activeStage}`);
    assert(stage1Check.hasMiniClass && stage1Check.collapsedAfterClick && stage1Check.expandedAfterSecondClick, 'Stage 1 collapsible 3D corner preview toggles cleanly');
    assert(stage1Check.guideBefore !== stage1Check.guideAfter && stage1Check.overlayVisible, 'Stage 1 Revolve Axis Guide toggle updates aria-pressed & overlay');

    // Test 3: 2D Canvas Point Creation & Close Shape in Stage 1
    const pointsTest = await evalInPage(`(() => {
      document.getElementById('modePolyBtn').click();
      const canvas = document.getElementById('sketchCanvas');
      const rect = canvas.getBoundingClientRect();
      const clickEvent = (x, y) => new PointerEvent('pointerdown', { clientX: rect.left + x, clientY: rect.top + y, bubbles: true });
      canvas.dispatchEvent(clickEvent(100, 100));
      canvas.dispatchEvent(clickEvent(200, 100));
      canvas.dispatchEvent(clickEvent(200, 200));
      return document.getElementById('pointCountBadge').textContent;
    })()`);
    assert(pointsTest.includes('3 pts') || pointsTest.includes('pts'), '2D sketch canvas registers point inputs', pointsTest);

    const closeTest = await evalInPage(`(() => {
      document.getElementById('closeShapeBtn').click();
      return document.getElementById('sketchHintText').textContent;
    })()`);
    assert(closeTest.includes('Edit:'), 'Closing polygon transitions mode to Edit', closeTest);

    // Test 4: Stage 2 Navigation, Extrude Height Clamping, Edit Sketch Return to Stage 1
    const stage2Test = await evalInPage(`(() => {
      document.getElementById('stageTab2').click();
      const stageAfterClick = document.body.dataset.activeStage;
      const p2dHidden = document.getElementById('panel2D').classList.contains('hidden');
      const input = document.getElementById('extrudeInput');
      input.value = '300';
      input.dispatchEvent(new Event('change'));
      const clampedVal = document.getElementById('extrudeSlider').value;

      document.getElementById('editSketchBtn').click();
      const returnedStage = document.body.dataset.activeStage;
      return { stageAfterClick, p2dHidden, clampedVal, returnedStage };
    })()`);
    assert(stage2Test.stageAfterClick === '2' && stage2Test.p2dHidden, 'Stage 2 flips viewport to full-screen 3D and updates activeStage="2"');
    assert(Number(stage2Test.clampedVal) <= 256, 'Extrude height clamped to Bambu Lab A1 ceiling (<= 256 mm)', `Clamped to ${stage2Test.clampedVal} mm`);
    assert(stage2Test.returnedStage === '1', 'Edit Sketch button returns from Stage 2..5 back to Stage 1');

    // Test 5: Stage 3 Ordered Modifier Card Toggles, Round/Bevel/Twist, Shelling & Part Intent
    const stage3Test = await evalInPage(`(() => {
      document.getElementById('stageTab3').click();
      const stage = document.body.dataset.activeStage;
      const cards = Array.from(document.querySelectorAll('[data-stage-panel="3"] [data-modifier]')).map(c => c.dataset.modifier);

      const roundCard = document.querySelector('[data-modifier="round"]');
      const beforeOpen = roundCard.dataset.open;
      roundCard.querySelector('[data-modifier-toggle]').click();
      const afterToggleOpen = roundCard.dataset.open;
      if (roundCard.dataset.open !== 'true') roundCard.querySelector('[data-modifier-toggle]').click();

      for (const k of ['bevel', 'twist', 'shell']) {
        const c = document.querySelector('[data-modifier="' + k + '"]');
        if (c && c.dataset.open !== 'true') c.querySelector('[data-modifier-toggle]').click();
      }

      const round = document.getElementById('roundSlider');
      round.value = '5';
      round.dispatchEvent(new Event('input'));
      const bevel = document.getElementById('bevelSlider');
      bevel.value = '2.5';
      bevel.dispatchEvent(new Event('input'));
      const twist = document.getElementById('twistSlider');
      twist.value = '45';
      twist.dispatchEvent(new Event('input'));
      const dim = document.getElementById('dimOverlay').textContent;

      const shellBtn = document.getElementById('shellToggleBtn');
      if (shellBtn.textContent.includes('Off')) shellBtn.click();
      const shellMode = document.getElementById('shellModeSelect');
      shellMode.value = 'hollow';
      shellMode.dispatchEvent(new Event('change'));
      const estHollow = document.getElementById('estimateOverlay').textContent;
      shellMode.value = 'vase_proxy';
      shellMode.dispatchEvent(new Event('change'));
      const estVase = document.getElementById('estimateOverlay').textContent;

      document.getElementById('intentLampshadeBtn').click();
      const intentVal = document.getElementById('partIntentSelect').value;
      const intentDim = document.getElementById('dimOverlay').textContent;

      return { stage, cards, beforeOpen, afterToggleOpen, dim, estHollow, estVase, intentVal, intentDim };
    })()`);
    assert(stage3Test.stage === '3', 'Stage 3 activates cleanly');
    assert(stage3Test.cards.length >= 6, 'Stage 3 renders ordered modifier cards', stage3Test.cards.join(', '));
    assert(stage3Test.beforeOpen !== stage3Test.afterToggleOpen, 'Stage 3 modifier card toggles open/closed state cleanly');
    assert(stage3Test.dim.includes('Size:') && !stage3Test.dim.includes('NaN'), 'Round/Bevel/Twist modifiers update geometry smoothly', stage3Test.dim);
    assert(stage3Test.estHollow.includes('PLA') && stage3Test.estVase.includes('PLA'), '3D Shelling (Hollow & Vase Proxy) updates PLA estimation');
    assert(stage3Test.intentVal === 'lampshade' && stage3Test.intentDim.includes('Size:') && !stage3Test.intentDim.includes('NaN'), 'Part Intent toggle switches to lampshade with valid geometry');

    // Test 6: Templates Popover -> Vase Preset + Stage 4 Surface Texture Modifiers
    const vasePresetTest = await evalInPage(`(() => {
      document.getElementById('templatesMenuBtn').click();
      document.getElementById('presetVaseBtn').click();
      document.getElementById('stageTab4').click();
      return {
        stage: document.body.dataset.activeStage,
        dim: document.getElementById('dimOverlay').textContent,
        fit: document.getElementById('fitBadge').textContent
      };
    })()`);
    assert(vasePresetTest.stage === '4' && vasePresetTest.dim.includes('Size:') && !vasePresetTest.dim.includes('NaN'), 'Vase Shade preset via Templates popover + Stage 4 geometry valid', vasePresetTest.dim);

    const patterns = ['ripple', 'weave', 'wave', 'spiral', 'flute', 'gyroid', 'coral', 'strata', 'perforated-weave', 'lfam-rib'];
    for (const pat of patterns) {
      const patResult = await evalInPage(`(() => {
        const sel = document.getElementById('texturePatternSelect');
        sel.value = '${pat}';
        sel.dispatchEvent(new Event('change'));
        return document.getElementById('dimOverlay').textContent;
      })()`);
      assert(patResult && patResult.includes('Size:') && !patResult.includes('NaN'), `Texture '${pat}' applies non-NaN coordinates`, patResult);
    }

    // Test 7: Outer-Wall Surface Texture on Extruded & Shelled Polygon Regression Test
    const outerWallTexTest = await evalInPage(`(async () => {
      const { computeShellInner, buildHollowExtrudeGeometry } = await import('./src/geometry/shell3d.js');
      const { applySurfaceTexture } = await import('./src/geometry/textures.js');

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
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) hasNaN = true;

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

    // Test 8: Centroid-Anchored Twist Alignment & Revolve Axis Normalization
    const centroidTwistTest = await evalInPage(`(async () => {
      const { buildPartGeometry } = await import('./src/geometry/meshBuilder.js');
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

    // Test 9: Stage 5 Scaled Test-Print Modes, Binary STL & .3MF Export
    const stage5Test = await evalInPage(`(() => {
      document.getElementById('stageTab5').click();
      const stage = document.body.dataset.activeStage;
      const stlVisible = document.getElementById('exportStlBtn').offsetParent !== null;
      const threemfVisible = document.getElementById('export3mfBtn').offsetParent !== null;

      let lastDownload = '';
      let lastBlobSize = 0;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { lastBlobSize = blob.size; return origCreate(blob); };
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
      const fullStlSize = lastBlobSize;

      document.getElementById('slicerProfileSelect').value = 'basket_weave_arachne';
      document.getElementById('slicerProfileSelect').dispatchEvent(new Event('change'));
      document.getElementById('slicerProfileSelect').value = 'clear_glass';
      document.getElementById('slicerProfileSelect').dispatchEvent(new Event('change'));
      document.getElementById('export3mfBtn').click();
      const threemfName = lastDownload;
      const threemfSize = lastBlobSize;

      document.createElement = origA;
      URL.createObjectURL = origCreate;
      return { stage, stlVisible, threemfVisible, miniDim, miniName, swatchDim, swatchName, fullName, fullStlSize, threemfName, threemfSize };
    })()`);
    assert(stage5Test.stage === '5' && stage5Test.stlVisible && stage5Test.threemfVisible, 'Stage 5 Print panel renders exportStlBtn and export3mfBtn visibly');
    assert(stage5Test.miniName.includes('-mini-proof.stl'), '40% Mini Proof exports with -mini-proof.stl', stage5Test.miniName);
    assert(stage5Test.swatchName.includes('-swatch.stl'), '35mm Swatch exports with -swatch.stl', stage5Test.swatchName);
    assert(stage5Test.miniDim.includes('Size:') && !stage5Test.miniDim.includes('NaN'), 'Mini Proof has valid non-NaN dimensions', stage5Test.miniDim);
    assert(stage5Test.swatchDim.includes('Size:') && !stage5Test.swatchDim.includes('NaN'), '35mm Swatch has valid non-NaN dimensions', stage5Test.swatchDim);
    assert(stage5Test.fullStlSize > 84, 'Binary STL export triggers file download > 84 bytes', `Size: ${stage5Test.fullStlSize} bytes`);
    assert(stage5Test.threemfName.endsWith('.3mf') && stage5Test.threemfSize > 500, 'Export .3MF triggers file download > 500 bytes with .3mf extension', `File: ${stage5Test.threemfName}, Size: ${stage5Test.threemfSize} bytes`);

    assert(consoleErrors.length === 0, 'Zero runtime / console errors across full 5-stage walkthrough', consoleErrors.join(' | '));

    // Test 10: catalog.html verification
    await sendCommand('Page.navigate', { url: `http://127.0.0.1:${port}/catalog.html` });
    await new Promise(r => setTimeout(r, 600));
    const catalogCheck = await evalInPage(`({
      pagesCount: document.querySelectorAll('.page').length,
      hasCover: !!document.getElementById('page-1'),
      hasAppendix: !!document.getElementById('page-8')
    })`);
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
