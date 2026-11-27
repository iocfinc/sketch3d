#!/usr/bin/env node
/**
 * SKETCH3D — Sprints 11–16 Verification & Blind 5-Stage Dual-Shell Christmas Tree Walkthrough
 * ==========================================================================================
 * Verifies:
 * - sketch3d-11: Cubic Bezier profile & uniform 0.5mm arc-length resampling
 * - sketch3d-12: Linked Concentric Offset Shell Clone (+10mm) & auto-sync
 * - sketch3d-13: Vertical Band Subdivision (8 bands) & Composable Texture Stack
 * - sketch3d-14: Direct Helical Toolpath Compiler (M83, flow, bridge, 50% scale)
 * - sketch3d-15: 5-Layer Safety Firewall (pass + negative-case blocking) & Donor Wrap
 * - sketch3d-16: Blind Stage 1 -> 2 -> 3 -> 4 -> 5 Dual-Shell Christmas Tree UI Benchmark + gcode_validator.py
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { computeAutoTangents, sampleBezierCurve, evalCubicBezierTangent, polyToBezierNodes, getProfileBoundsMm } from '../src/geometry/bezier2d.js';
import { createLinkedOffsetClone, syncLinkedClones, offsetProfile2D } from '../src/geometry/offsetClone.js';
import { getBandCoordinates, evaluateBandOperator, evaluateComposableTexture } from '../src/geometry/bandEngine.js';
import { compilePartToolpath } from '../src/geometry/toolpathKernel.js';
import { validateGCodeSafety } from '../src/export/gcodeSafetyGate.js';
import { compileAndValidateGCode, parseDonorGCode, buildGCode3MFBuffer } from '../src/export/gcodeExporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✔ [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  ✘ [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n1. Unit Verification: Sprints 11–15 Modules...');

// sketch3d-11: Cubic Bezier S-curve 70mm tall x 30mm base radius
const sCurveAnchors = computeAutoTangents([
  { x: 30, y: 0 },
  { x: 20, y: 24 },
  { x: 14, y: 48 },
  { x: 1.0, y: 70 }
], 0.35, false);
const resampled = sampleBezierCurve(sCurveAnchors, 0.5, false);
assert(resampled.length >= 120, 'Bezier 0.5mm arc-length resampling produces dense profile', `Pts: ${resampled.length}`);

// sketch3d-12: Linked Concentric Offset Shell Clone (+10mm)
const innerPart = {
  id: 'core_1',
  name: 'Inner Core',
  type: 'revolve',
  intent: 'vessel',
  profileType: 'bezier',
  bezierNodes: sCurveAnchors,
  points: resampled,
  isClosed: false,
  extrudeHeight: 70,
  color: '#FF66D9'
};
const outerClone = createLinkedOffsetClone(innerPart, 10);
assert(Math.abs(outerClone.points[0].x - 40) < 1.5, 'Offset Shell Clone (+10mm) expands base radius ~40mm', `r0=${outerClone.points[0].x}`);
innerPart.bezierNodes[0].x = 32;
syncLinkedClones([innerPart, outerClone]);
assert(outerClone.points[0].x > 40.0, 'Linked clone auto-updates when parent Bezier changes', `r0=${outerClone.points[0].x}`);
innerPart.bezierNodes[0].x = 30;
syncLinkedClones([innerPart, outerClone]);

// ISSUE-011: Revolved 78.0mm OD Christmas Tree +10mm Linked Offset Clone >= 98.0mm OD
const tree78Half = [
  { x: 0.01, y: 0 }, { x: 39, y: 0 }, { x: 24, y: -35 }, { x: 30, y: -35 },
  { x: 16, y: -72 }, { x: 22, y: -72 }, { x: 0.5, y: -120 }
];
const offsetTreePts = offsetProfile2D(tree78Half, 10, false, true);
const maxTreeR = Math.max(...offsetTreePts.map(p => p.x));
const hasNegR = offsetTreePts.some(p => p.x < 0);
assert(maxTreeR * 2 >= 98.0 && !hasNegR, 'ISSUE-011: +10mm revolved offset on 78.0mm OD tree yields >= 98.0mm OD with R >= 0',
  `outerOD=${(maxTreeR * 2).toFixed(2)}mm`);

// sketch3d-13: Vertical Band Subdivision & Composable Texture Stack
const b0 = getBandCoordinates(10, 0, 70, 4.0, 8);
const b1 = getBandCoordinates(18, 0, 70, 4.0, 8);
assert(b0.inBand && b1.inBand && b0.bandIndex !== b1.bandIndex, '8-band subdivision assigns distinct bands', `b0=${b0.bandIndex}, b1=${b1.bandIndex}`);
const dCoralBand0 = evaluateComposableTexture({
  theta: 0.4, y: 10, r: 35, minY: 0, maxY: 70,
  options: { pattern: 'coral', depth: 1.0, freq: 24, bandEnabled: true, bandCount: 8, bandMode: 'weave', bandFreq: 10, bandPhaseDeg: 90, bandDepth: 1.0 }
});
assert(Number.isFinite(dCoralBand0) && Math.abs(dCoralBand0) > 0.01, 'Composable Coral + Banded Weave returns finite displacement', `${dCoralBand0.toFixed(3)}mm`);

// sketch3d-14 & 15: Direct Helical Toolpath Compiler + 5-Layer Safety Firewall
outerClone.texturePattern = 'coral';
outerClone.textureDepth = 1.0;
outerClone.textureFreq = 24;
outerClone.bandEnabled = true;
outerClone.bandCount = 8;
outerClone.bandMode = 'weave';
outerClone.bandFreq = 10;
outerClone.bandPhaseDeg = 90;
outerClone.bandDepth = 1.0;

const compiled = await compileAndValidateGCode(outerClone, { nozzleDiameter: 0.4, primitive: 'standard', scaleFactor: 1.0 });
assert(compiled.safety.passed, '5-Layer Safety Firewall PASSES on valid Christmas Tree outer shell', `layers=${compiled.stats.layerCount}, flow=${compiled.stats.maxFlowMm3S}`);

// Negative test: Safety Firewall blocks forbidden M82 & over-temp
const badGcode = compiled.gcode.replace('M83 ; Relative extrusion mode', 'M82 ; Bad absolute').replace('M109 S210', 'M109 S310');
const badRes = validateGCodeSafety(badGcode);
assert(!badRes.passed && badRes.errors.length >= 2, '5-Layer Safety Firewall BLOCKS M82 and 310C over-temp', `errors=${badRes.errors.length}`);

// Donor wrap parser test
const donorSample = `; HEADER\nG90\nM83\nG28\nM109 S210\n; LAYER_CHANGE\nG1 X128 Y128 Z0.2 E1.0 F1500\n; EXECUTABLE_BLOCK_END\nM104 S0\nM140 S0\nM106 S0\nM84\n`;
const donorParsed = parseDonorGCode(donorSample);
assert(donorParsed && donorParsed.header.includes('G28') && donorParsed.footer.includes('M84'), 'Donor Wrap extracts Start/End G-code');

// 50% scale test print
const compiled50 = await compileAndValidateGCode(outerClone, { nozzleDiameter: 0.4, scaleFactor: 0.5 });
assert(compiled50.safety.passed && compiled50.stats.bounds.maxZ < 45, '50% Scale Test Print passes Safety Firewall at half height', `maxZ=${compiled50.stats.bounds.maxZ}`);

// Write golden .gcode.3mf to temp & verify with scripts/gcode_validator.py
const tmpDir = fs.mkdtempSync('/tmp/sketch3d_sprint_');
const outGcode3mf = path.join(tmpDir, 'christmas_tree_outer_a1.gcode.3mf');
const buf3mf = buildGCode3MFBuffer(compiled.gcode, compiled.bodySha, [outerClone], [], 'vase');
fs.writeFileSync(outGcode3mf, Buffer.from(buf3mf));

const pyCheck = spawnSync('python3', [path.join(ROOT, 'scripts/gcode_validator.py'), outGcode3mf, '0.4'], { encoding: 'utf8' });
assert(pyCheck.status === 0, 'Python scripts/gcode_validator.py PASSES on exported .gcode.3mf', pyCheck.stdout.trim());
fs.rmSync(tmpDir, { recursive: true, force: true });

// Additional coverage: Bezier tangent/bounds, Band Flare/Twist, Toolpath Primitives & 5-Layer Firewall Isolation
const tang = evalCubicBezierTangent(sCurveAnchors[0], sCurveAnchors[0].cpOut, sCurveAnchors[1].cpIn, sCurveAnchors[1], 0.5);
assert(Number.isFinite(tang.x) && Number.isFinite(tang.y), 'evalCubicBezierTangent returns finite derivative');
const polyNodes = polyToBezierNodes([{ x: 30, y: 0 }, { x: 15, y: 35 }, { x: 1, y: 70 }], 0.35, false);
const bounds = getProfileBoundsMm(resampled);
assert(polyNodes.length === 3 && Math.abs(bounds.height - 70) < 0.5 && Math.abs(bounds.maxRadius - 30) < 0.5, 'getProfileBoundsMm & polyToBezierNodes accurate', `H=${bounds.height} R=${bounds.maxRadius}`);

const dFlare = evaluateBandOperator(b0, 0.5, 35, { bandMode: 'flare', bandFlareDeg: 12, bandPivot: 'endpoint', bandAltFlare: true });
const dTwist = evaluateBandOperator(b1, 0.5, 35, { bandMode: 'twist_flute', bandFreq: 10, bandDepth: 1.0 });
assert(Number.isFinite(dFlare) && Number.isFinite(dTwist), 'Band operators flare & twist_flute return finite displacements');

for (const prim of ['thick', 'arc', 'wiggle']) {
  const tp = compilePartToolpath(outerClone, { primitive: prim, zWaveAmpMm: 0.4, nozzleDiameter: 0.4 });
  assert(tp.waypoints.length > 500 && tp.stats.maxZSlopeDeg <= 22.0, `Toolpath primitive '${prim}' + non-planar Z-wave stays <= 22 deg`, `slope=${tp.stats.maxZSlopeDeg}`);
}

const badXY = validateGCodeSafety(compiled.gcode.replace('; SKETCH3D_BODY_START\n', '; SKETCH3D_BODY_START\nG1 X250.000 Y250.000 Z0.200 E0.1 F1500\n'));
const badBridge = validateGCodeSafety(compiled.gcode.replace(/G1 X[\d.]+ Y[\d.]+ Z0\.200/, 'G1 X200.000 Y200.000 Z0.200'));
const badAudit = validateGCodeSafety(compiled.gcode.replace('; SKETCH3D SAFETY AUDIT REPORT', '; NO_AUDIT'));
assert(!badXY.passed && badXY.errors.some(e => e.layer === 2), 'Layer 2 blocks out-of-bounds XY (250mm)');
assert(!badBridge.passed && badBridge.errors.some(e => e.layer === 4), 'Layer 4 blocks unsupported bridge > 6.0mm');
assert(!badAudit.passed && badAudit.errors.some(e => e.layer === 5), 'Layer 5 blocks missing safety audit provenance');

console.log('\n2. Headless UI Benchmark: Blind Stage 1 -> 5 Dual-Shell Christmas Tree Walkthrough...');
const chromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];
const chromeBin = chromePaths.find(p => fs.existsSync(p));
if (!chromeBin) {
  console.log('  ⚠ Skipping headless Chrome UI check (Chrome binary not found)');
} else {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    const filePath = path.join(ROOT, cleanUrl === '/' ? 'index.html' : cleanUrl);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const { spawn } = await import('node:child_process');
  const userDataDir = fs.mkdtempSync('/tmp/sketch3d_cdp_');
  const chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    `--user-data-dir=${userDataDir}`, `http://127.0.0.1:${port}/`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools timeout')), 10000);
    chrome.stderr.on('data', d => {
      const m = d.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  const pagesRes = await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json'));
  const pages = await pagesRes.json();
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });

  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.text || 'Unhandled exception');
    }
  });

  let msgId = 0;
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener('message', handler); msg.error ? rej(msg.error) : res(msg.result); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Runtime.enable');
  for (let i = 0; i < 40; i++) {
    const ready = await cdp('Runtime.evaluate', { expression: 'Boolean(window.sketch3d?.stageRouter)', returnByValue: true });
    if (ready?.result?.value) break;
    await new Promise(r => setTimeout(r, 150));
  }

  const walkthrough = await cdp('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      // Stage 1: Sketch Bezier S-curve (30mm base to 1mm apex, 70mm height)
      document.querySelector('[data-stage="1"]').click();
      const stage1Active = document.body.dataset.activeStage === '1';
      const snapBtn = document.getElementById('snapToggleBtn');
      for (let i = 0; i < 4 && snapBtn && !snapBtn.textContent.includes('1mm'); i++) snapBtn.click();
      document.getElementById('modeBezierBtn').click();

      const canvas = document.getElementById('sketchCanvas');
      const rect = canvas.getBoundingClientRect();
      const mmClick = (mmX, mmY) => {
        const cx = rect.left + ((mmX + 128) / 256) * rect.width;
        const cy = rect.top + ((mmY + 128) / 256) * rect.height;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
      };
      mmClick(30, 0);
      mmClick(20, -24);
      mmClick(14, -48);
      mmClick(1, -70);
      const ptsBadge = document.getElementById('pointCountBadge')?.textContent || '';

      // Stage 2: 3D Form -> Revolve 360 + Linked +10mm Offset Clone
      document.querySelector('[data-stage="2"]').click();
      const stage2Active = document.body.dataset.activeStage === '2';
      document.getElementById('typeRevolveBtn').click();
      const offsetInput = document.getElementById('offsetCloneInput');
      if (offsetInput) offsetInput.value = '10';
      document.getElementById('offsetCloneBtn').click();
      const partsCount = document.querySelectorAll('#partsList > *').length;

      // Stage 3: Adjust -> Ordered Modifier Cards toggle cleanly
      document.querySelector('[data-stage="3"]').click();
      const stage3Active = document.body.dataset.activeStage === '3';
      const modCards = Array.from(document.querySelectorAll('[data-stage-panel="3"] [data-modifier]'));
      let modToggleOk = modCards.length >= 4;
      if (modCards[0]) {
        const prev = modCards[0].dataset.open;
        modCards[0].querySelector('[data-modifier-toggle]')?.click();
        modToggleOk = modToggleOk && (modCards[0].dataset.open !== prev);
      }

      // Stage 4: Texture -> Coral + Band Subdivision (8 bands, Weave) + Bead Preview
      document.querySelector('[data-stage="4"]').click();
      const stage4Active = document.body.dataset.activeStage === '4';
      const texSel = document.getElementById('texturePatternSelect');
      texSel.value = 'coral';
      texSel.dispatchEvent(new Event('change'));
      const bandsCard = document.querySelector('[data-stage-panel="4"] [data-modifier="bands"]');
      if (bandsCard && bandsCard.dataset.open !== 'true') {
        bandsCard.querySelector('[data-modifier-toggle]')?.click();
      }
      const bandBtn = document.getElementById('bandEnabledBtn');
      if (bandBtn.textContent.includes('Off')) bandBtn.click();
      const bandCount = document.getElementById('bandCountInput');
      bandCount.value = '8';
      bandCount.dispatchEvent(new Event('change'));
      const bandMode = document.getElementById('bandModeSelect');
      bandMode.value = 'weave';
      bandMode.dispatchEvent(new Event('change'));
      document.getElementById('toolpathPreviewBtn').click();
      const previewLabel = document.getElementById('toolpathPreviewBtn').textContent;

      // Stage 5: Print -> Basket-Weave Arachne + Prosumer Toolpath Unlock + Visible Exports
      document.querySelector('[data-stage="5"]').click();
      const stage5Active = document.body.dataset.activeStage === '5';
      const profileSel = document.getElementById('slicerProfileSelect');
      profileSel.value = 'basket_weave_arachne';
      profileSel.dispatchEvent(new Event('change'));
      document.getElementById('prosumerToolpathBtn').click();
      const ackBtn = document.getElementById('prosumerAckBtn');
      if (ackBtn && ackBtn.offsetParent !== null) ackBtn.click();
      const prosumerUnlocked = !document.getElementById('prosumerToolpathPanel').classList.contains('hidden');
      const exportGcodeVisible = document.getElementById('exportGcodeBtn').offsetParent !== null;
      const export3mfVisible = document.getElementById('export3mfBtn').offsetParent !== null;
      const exportStlVisible = document.getElementById('exportStlBtn').offsetParent !== null;
      const dimText = document.getElementById('dimOverlay')?.textContent || '';

      return {
        stage1Active, ptsBadge,
        stage2Active, partsCount,
        stage3Active, modCardCount: modCards.length, modToggleOk,
        stage4Active, previewLabel,
        stage5Active, prosumerUnlocked, exportGcodeVisible, export3mfVisible, exportStlVisible, dimText,
        overflowX: document.documentElement.scrollWidth > window.innerWidth
      };
    })()`
  });

  const val = walkthrough.result.value;
  assert(val.stage1Active && val.ptsBadge.includes('pts'), 'Stage 1: Bezier S-curve profile sketched on canvas', val.ptsBadge);
  assert(val.stage2Active && val.partsCount >= 2, 'Stage 2: Revolve 360 + Linked +10mm Offset Clone created', `parts=${val.partsCount}`);
  assert(val.stage3Active && val.modToggleOk, 'Stage 3: Ordered modifier cards toggle cleanly', `cards=${val.modCardCount}`);
  assert(val.stage4Active && val.previewLabel.includes('Hide'), 'Stage 4: Coral texture + 8-band Weave + Bead Preview active', val.previewLabel);
  assert(val.stage5Active && val.prosumerUnlocked, 'Stage 5: Basket-Weave Arachne & Prosumer Toolpath unlocked in Stage 5');
  assert(val.exportGcodeVisible && val.export3mfVisible && val.exportStlVisible, 'Stage 5: exportGcodeBtn, export3mfBtn & exportStlBtn directly visible without legacy drawer');
  assert(val.dimText.includes('Size:') && !val.dimText.includes('NaN'), 'Dual-Shell Christmas Tree dimensions valid and non-NaN', val.dimText);
  assert(!val.overflowX, 'Zero horizontal overflow on desktop viewport');
  assert(consoleErrors.length === 0, 'Zero console errors during 5-stage Dual-Shell Christmas Tree walkthrough', consoleErrors.join(' | '));

  for (const vp of [{ name: 'mobile', width: 375, height: 812 }, { name: 'ipad', width: 768, height: 1024 }]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.name === 'mobile' });
    await new Promise(r => setTimeout(r, 120));
    const ov = await cdp('Runtime.evaluate', { returnByValue: true, expression: 'document.documentElement.scrollWidth > window.innerWidth' });
    assert(!ov.result.value, `Zero horizontal overflow on ${vp.name} (${vp.width}x${vp.height})`);
  }

  ws.close();
  chrome.kill();
  server.close();
  await new Promise(r => setTimeout(r, 250));
  fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\n=== Sprints 11–16 Summary: ${passed} Passed, ${failed} Failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
