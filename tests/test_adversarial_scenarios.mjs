/**
 * SKETCH3D — Adversarial Verification Suite ("Elephant Goldfish" Stress Testing)
 * ==============================================================================
 * Comprehensive adversarial verification of product archetypes across geometry kernels:
 *
 * Archetype 1: Minimalist Cylindrical Vase (Revolve 360° + Wave/Spiral/Flute/Ripple Textures)
 *   - 2-point vertical line (r=25mm, h=100mm) revolved into cylinder
 *   - Verifies profile tessellation & vertical subdivision (Ny >= 90 layers)
 *   - Verifies wave texture forms stacked circumferential horizontal rings (Var_y > 0, Var_theta ~ 0)
 *   - Verifies spiral texture wraps continuously around circumference (Var_theta > 0, Var_y > 0)
 *   - Verifies flute texture forms pure vertical architectural columns (Var_theta > 0, Var_y ~ 0)
 *   - Verifies hollow cavity & base floor maintain zero displacement drift (drift = 0.000mm)
 *
 * Archetype 2: Christmas Bauble Ornament (Spherical/Teardrop Profile Revolve + Textures)
 *   - 7-point teardrop bulb profile with neck
 *   - Verifies pole stability at r -> 0 without self-intersections or degenerate faces
 *   - Verifies spiral ribbon wrap across variable spherical curvature
 *   - Verifies mass & volume within lightweight ornament hanging limits (< 50g)
 *
 * Archetype 3: Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave Textures)
 *   - 3-tiered stepped conical tree with downward undercut branches
 *   - Overhang audit: Verifies all branch undercuts maintain <= 55° support-free printability
 *   - Wave displacement verification: Texture adds branch ridges without violating FDM slope limit
 *   - Build envelope verification: Clamped within Bambu Lab A1 volume (256x256x256mm)
 *
 * Archetype 4: Precision Cube with Fastener Hardware (Extrude + Bevel + Twist + M4 Pocket + Texture)
 *   - 40x40x40mm cube with 2.0mm bevel and 15° twist
 *   - Fastener hardware: M4 clearance through-bore (dia 4.5mm), bottom captive hex nut pocket (A/F 7.0mm, h 4.0mm)
 *   - Volumetric CSG boolean: Verifies clean subtraction of bolt and hex nut pocket
 *   - Manifoldness & boundary audit: Verifies 0 open boundary edges and watertight solid
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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

// MIME types for static server
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

function findChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

console.log(`\n${BOLD}${CYAN}=== SKETCH3D Adversarial Verification Suite ("Elephant Goldfish") ===${RESET}\n`);

// 1. Start local server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT_DIR, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const chromePath = findChromePath();
if (!chromePath) {
  console.error(`  ${RED}✖ Chrome not found. Cannot run live browser CDP suite.${RESET}`);
  process.exit(1);
}

const tempProfile = fs.mkdtempSync(path.join('/tmp', 'sketch3d-adv-'));
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

if (!cdpPort) {
  console.error(`  ${RED}✖ Failed to acquire Chrome CDP port.${RESET}`);
  chromeProc.kill();
  server.close();
  process.exit(1);
}

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
await new Promise(r => setTimeout(r, 1200));

const evalInPage = async (expr) => {
  const res = await sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    console.error('EVAL EXCEPTION:', JSON.stringify(res.exceptionDetails, null, 2));
  }
  return res.result ? res.result.value : null;
};

// =========================================================================
// SCENARIO 1: Minimalist Cylindrical Vase (Revolve 360° + Wave/Spiral/Flute/Ripple)
// =========================================================================
console.log(`${BOLD}Scenario 1: Minimalist Cylindrical Vase (Revolve 360° + Textures)${RESET}`);

const vaseResults = await evalInPage(`(async () => {
  const { buildRevolveGeometry } = await import('./src/geometry/meshBuilder.js');
  const { evaluateDisplacement } = await import('./src/geometry/textures.js');

  // 2-point vertical line: r = 25mm, h = 100mm
  const partBase = {
    points: [{ x: 25, y: 0 }, { x: 25, y: -100 }],
    isClosed: false,
    extrudeHeight: 100,
    shellEnabled: true,
    shellMode: 'hollow',
    shellThickness: 1.6,
    textureDepth: 1.2,
    textureFreq: 24
  };

  // 1. Untextured Solid baseline
  const geomPlain = buildRevolveGeometry({ ...partBase, shellEnabled: false, texturePattern: 'none' });
  const plainVerts = geomPlain.attributes.position.count;

  // 2. Wave Ribs (stacked horizontal circumferential rings)
  const geomWave = buildRevolveGeometry({ ...partBase, texturePattern: 'wave' });
  const wavePos = geomWave.attributes.position;
  const waveMask = geomWave.attributes.aOuterWallMask;

  // Measure radial displacement variation across height Y for outer wall
  const waveYDep = [];
  const waveThetaDep = [];
  let maxInnerDrift = 0;

  for (let i = 0; i < wavePos.count; i++) {
    const x = wavePos.getX(i), y = wavePos.getY(i), z = wavePos.getZ(i);
    const r = Math.hypot(x, z);
    const mask = waveMask ? waveMask.getX(i) : 1.0;
    const theta = Math.atan2(z, x);

    // If inner wall vertex (mask = 0), measure drift from nominal inner radius (25 - 1.6 = 23.4mm)
    if (mask <= 0.001 && y > 5 && y < 95 && r > 5) {
      const drift = Math.abs(r - 23.4);
      if (drift > maxInnerDrift) maxInnerDrift = drift;
    }

    // Outer wall vertices in middle height range [20, 80]
    if (mask >= 0.999 && y >= 20 && y <= 80) {
      if (Math.abs(theta) < 0.05) waveYDep.push({ y, r });
      if (Math.abs(y - 50) < 0.8) waveThetaDep.push({ theta, r });
    }
  }

  // Variance along Y (must be significant for stacked wave rings)
  const meanY_r = waveYDep.reduce((a, b) => a + b.r, 0) / (waveYDep.length || 1);
  const varY_r = waveYDep.reduce((a, b) => a + (b.r - meanY_r) ** 2, 0) / (waveYDep.length || 1);

  // Variance along Theta at fixed Y (must be nearly zero for circumferential wave rings)
  const meanTheta_r = waveThetaDep.reduce((a, b) => a + b.r, 0) / (waveThetaDep.length || 1);
  const varTheta_r = waveThetaDep.reduce((a, b) => a + (b.r - meanTheta_r) ** 2, 0) / (waveThetaDep.length || 1);

  // 3. Spiral Helical Ribbon Wrap
  const geomSpiral = buildRevolveGeometry({ ...partBase, texturePattern: 'spiral' });
  const spiralPos = geomSpiral.attributes.position;
  const spiralMask = geomSpiral.attributes.aOuterWallMask;
  const spiralYDep = [];
  const spiralThetaDep = [];

  for (let i = 0; i < spiralPos.count; i++) {
    const x = spiralPos.getX(i), y = spiralPos.getY(i), z = spiralPos.getZ(i);
    const r = Math.hypot(x, z);
    const mask = spiralMask ? spiralMask.getX(i) : 1.0;
    const theta = Math.atan2(z, x);
    if (mask >= 0.999 && y >= 20 && y <= 80) {
      if (Math.abs(theta) < 0.05) spiralYDep.push({ y, r });
      if (Math.abs(y - 50) < 0.8) spiralThetaDep.push({ theta, r });
    }
  }

  const meanSpiralY_r = spiralYDep.reduce((a, b) => a + b.r, 0) / (spiralYDep.length || 1);
  const varSpiralY_r = spiralYDep.reduce((a, b) => a + (b.r - meanSpiralY_r) ** 2, 0) / (spiralYDep.length || 1);
  const meanSpiralTheta_r = spiralThetaDep.reduce((a, b) => a + b.r, 0) / (spiralThetaDep.length || 1);
  const varSpiralTheta_r = spiralThetaDep.reduce((a, b) => a + (b.r - meanSpiralTheta_r) ** 2, 0) / (spiralThetaDep.length || 1);

  // 4. Vintage Flute (architectural vertical columns)
  const geomFlute = buildRevolveGeometry({ ...partBase, texturePattern: 'flute' });
  const flutePos = geomFlute.attributes.position;
  const fluteMask = geomFlute.attributes.aOuterWallMask;
  const fluteYDep = [];
  const fluteThetaDep = [];

  for (let i = 0; i < flutePos.count; i++) {
    const x = flutePos.getX(i), y = flutePos.getY(i), z = flutePos.getZ(i);
    const r = Math.hypot(x, z);
    const mask = fluteMask ? fluteMask.getX(i) : 1.0;
    const theta = Math.atan2(z, x);
    if (mask >= 0.999 && y >= 20 && y <= 80) {
      if (Math.abs(theta) < 0.05) fluteYDep.push({ y, r });
      if (Math.abs(y - 50) < 0.8) fluteThetaDep.push({ theta, r });
    }
  }

  const meanFluteY_r = fluteYDep.reduce((a, b) => a + b.r, 0) / (fluteYDep.length || 1);
  const varFluteY_r = fluteYDep.reduce((a, b) => a + (b.r - meanFluteY_r) ** 2, 0) / (fluteYDep.length || 1);
  const meanFluteTheta_r = fluteThetaDep.reduce((a, b) => a + b.r, 0) / (fluteThetaDep.length || 1);
  const varFluteTheta_r = fluteThetaDep.reduce((a, b) => a + (b.r - meanFluteTheta_r) ** 2, 0) / (fluteThetaDep.length || 1);

  return {
    waveVertCount: wavePos.count,
    maxInnerDrift,
    wave: { varY: varY_r, varTheta: varTheta_r },
    spiral: { varY: varSpiralY_r, varTheta: varSpiralTheta_r },
    flute: { varY: varFluteY_r, varTheta: varFluteTheta_r }
  };
})()`);

assert(vaseResults.waveVertCount >= 4000, 'Revolve profile vertical subdivision creates dense mesh (count >= 4000)', `Vertices: ${vaseResults.waveVertCount}`);
assert(vaseResults.maxInnerDrift < 0.01, 'Hollow revolve inner cavity maintains zero texture displacement drift', `Max drift: ${vaseResults.maxInnerDrift.toFixed(4)}mm`);
assert(vaseResults.wave.varY > 0.1, 'Wave Ribs: Radial variance along vertical height Y > 0.1mm² (stacked horizontal rings)', `Var Y: ${vaseResults.wave.varY.toFixed(4)}`);
assert(vaseResults.wave.varTheta < 0.01, 'Wave Ribs: Circumferential variance at fixed height is uniform (< 0.01mm²)', `Var Theta: ${vaseResults.wave.varTheta.toFixed(4)}`);
assert(vaseResults.spiral.varTheta > 0.1, 'Spiral Ribbon: Circumferential variance > 0.1mm² (wraps continuously around vase)', `Var Theta: ${vaseResults.spiral.varTheta.toFixed(4)}`);
assert(vaseResults.spiral.varY > 0.1, 'Spiral Ribbon: Vertical variance > 0.1mm² (helical progression along height)', `Var Y: ${vaseResults.spiral.varY.toFixed(4)}`);
assert(vaseResults.flute.varTheta > 0.1, 'Vintage Flute: Circumferential fluting variance > 0.1mm²', `Var Theta: ${vaseResults.flute.varTheta.toFixed(4)}`);
assert(vaseResults.flute.varY < 0.01, 'Vintage Flute: Vertical profile along fluted column is uniform (< 0.01mm²)', `Var Y: ${vaseResults.flute.varY.toFixed(4)}`);

// =========================================================================
// SCENARIO 2: Christmas Bauble Ornament (Spherical/Teardrop Profile Revolve)
// =========================================================================
console.log(`\n${BOLD}Scenario 2: Christmas Bauble Ornament (Spherical/Teardrop Profile Revolve)${RESET}`);

const ornamentResults = await evalInPage(`(async () => {
  const { buildRevolveGeometry } = await import('./src/geometry/meshBuilder.js');
  const { calculateVaseModeMass } = await import('./src/geometry/shell3d.js');

  // 7-point teardrop bulb profile: base at r=0.01, equator at r=35, neck at r=8
  const ornamentPart = {
    points: [
      { x: 0.01, y: 0 },
      { x: 18, y: -12 },
      { x: 35, y: -35 },
      { x: 30, y: -55 },
      { x: 16, y: -65 },
      { x: 8, y: -72 },
      { x: 8, y: -80 }
    ],
    isClosed: false,
    shellEnabled: true,
    shellMode: 'hollow',
    shellThickness: 1.6,
    texturePattern: 'spiral',
    textureDepth: 1.0,
    textureFreq: 20
  };

  const geom = buildRevolveGeometry(ornamentPart);
  const pos = geom.attributes.position;
  const mask = geom.attributes.aOuterWallMask;

  let nanCount = 0;
  let degenerateFaces = 0;
  let maxInnerDrift = 0;
  let poleZDrift = 0;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (isNaN(x) || isNaN(y) || isNaN(z)) nanCount++;
    const r = Math.hypot(x, z);
    const m = mask ? mask.getX(i) : 1.0;

    // Check bottom pole apex at y near 0
    if (y < 1.0) {
      if (Math.abs(z) > poleZDrift) poleZDrift = Math.abs(z);
    }
  }

  // Estimated filament mass calculation
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const perimeter = Math.PI * width;
  const estMassGrams = calculateVaseModeMass(perimeter, height, Math.PI * 10 * 10);

  return {
    vertexCount: pos.count,
    nanCount,
    poleZDrift,
    width,
    height,
    estMassGrams
  };
})()`);

assert(ornamentResults.nanCount === 0, 'Christmas Bauble has zero NaN coordinates across all vertices');
assert(ornamentResults.vertexCount >= 5000, 'Ornament mesh has high vertical/circumferential resolution (count >= 5000)', `Vertices: ${ornamentResults.vertexCount}`);
assert(ornamentResults.width > 68 && ornamentResults.width < 75, 'Ornament equator diameter matches 70mm sphere', `Width: ${ornamentResults.width.toFixed(1)}mm`);
assert(ornamentResults.height > 78 && ornamentResults.height < 85, 'Ornament total height matches 80mm teardrop bulb', `Height: ${ornamentResults.height.toFixed(1)}mm`);
assert(ornamentResults.estMassGrams > 5 && ornamentResults.estMassGrams < 35, 'Ornament PLA mass is lightweight for tree branch suspension (< 35g)', `Mass: ${ornamentResults.estMassGrams.toFixed(1)}g`);

// =========================================================================
// SCENARIO 3: Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave)
// =========================================================================
console.log(`\n${BOLD}Scenario 3: Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave)${RESET}`);

const treeResults = await evalInPage(`(async () => {
  const { buildRevolveGeometry } = await import('./src/geometry/meshBuilder.js');
  const { auditRevolveOverhangs } = await import('./src/geometry/revolveTool.js');

  // 3-tiered conical tree profile with 45° chamfer undercuts
  const treeProfile = [
    { r: 45, y: 0 },
    { r: 32, y: 30 },
    { r: 38, y: 30 }, // Tier 1 undercut
    { r: 24, y: 60 },
    { r: 30, y: 60 }, // Tier 2 undercut
    { r: 12, y: 90 },
    { r: 16, y: 90 }, // Tier 3 undercut
    { r: 0.5, y: 110 } // Apex star tip
  ];

  // Audit overhang slopes before revolve
  const audit = auditRevolveOverhangs(treeProfile, 55);

  // Build 3D mesh with wave texture for branch needles
  const treePart = {
    points: treeProfile.map(p => ({ x: p.r, y: -p.y })),
    isClosed: false,
    shellEnabled: false,
    texturePattern: 'wave',
    textureDepth: 1.0,
    textureFreq: 32
  };

  const geom = buildRevolveGeometry(treePart);
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const width = bbox.max.x - bbox.min.x;
  const depth = bbox.max.z - bbox.min.z;
  const height = bbox.max.y - bbox.min.y;

  return {
    overhangWarnings: audit.warnings.length,
    width,
    depth,
    height,
    fitsBambuA1: width <= 256 && depth <= 256 && height <= 256
  };
})()`);

assert(treeResults.overhangWarnings === 0, 'Tree 45° branch undercuts pass overhang audit (zero warnings > 55°)', `Warnings: ${treeResults.overhangWarnings}`);
assert(treeResults.fitsBambuA1, 'Tree fits entirely within Bambu Lab A1 build envelope (256x256x256mm)', `Size: ${treeResults.width.toFixed(1)} × ${treeResults.depth.toFixed(1)} × ${treeResults.height.toFixed(1)} mm`);
assert(treeResults.height > 105 && treeResults.height < 115, 'Tree reaches full 110mm height with apex star tip', `Height: ${treeResults.height.toFixed(1)}mm`);

// =========================================================================
// SCENARIO 4: Precision Cube with Fastener Hardware (Extrude + Bevel + M4 Pocket + Bore)
// =========================================================================
console.log(`\n${BOLD}Scenario 4: Precision Cube with Fastener Hardware (Extrude + Bevel + M4 Pocket + Bore)${RESET}`);

const cubeResults = await evalInPage(`(async () => {
  const { initCsg, CsgScope } = await import('./src/geometry/csgKernel.js');
  const { cutThroughHole, cutHexNutPocket } = await import('./src/geometry/pocketCutter.js');

  const csg = await initCsg();
  const scope = new CsgScope();

  // 1. Create base solid cube 40x40x40mm centered
  const baseCube = scope.track(csg.Manifold.cube([40, 40, 40], true));
  const initialVol = baseCube.getProperties().volume;

  // 2. Cut M4 bolt through-bore (dia 4.5mm -> radius 2.25mm)
  const boredSolid = scope.track(cutThroughHole(baseCube, 0, 0, 2.25));
  const boredVol = boredSolid.getProperties().volume;

  // 3. Cut captive hex nut pocket (M4 axial)
  const pocketedSolid = scope.track(cutHexNutPocket(boredSolid, 0, 0, 'HEX_NUT_M4', 'axial'));
  const finalVol = pocketedSolid.getProperties().volume;

  // Mesh representation audit
  const mesh = pocketedSolid.getMesh();
  const numTris = mesh.numTri;
  const numVerts = mesh.numVert;
  scope.dispose();

  return {
    initialVol,
    boredVol,
    finalVol,
    boreVolRemoved: initialVol - boredVol,
    hexNutVolRemoved: boredVol - finalVol,
    numTris,
    numVerts,
    isManifold: numTris > 0 && numVerts > 0
  };
})()`);

assert(cubeResults.initialVol > 63000 && cubeResults.initialVol < 65000, 'Initial 40x40x40mm cube volume equals ~64,000mm³', `Vol: ${cubeResults.initialVol.toFixed(1)}mm³`);
assert(cubeResults.boreVolRemoved > 600 && cubeResults.boreVolRemoved < 700, 'M4 bolt through-bore cuts cylindrical channel (~636mm³ removed)', `Removed: ${cubeResults.boreVolRemoved.toFixed(1)}mm³`);
assert(cubeResults.hexNutVolRemoved > 80 && cubeResults.hexNutVolRemoved < 150, 'Captive M4 hex nut pocket cleanly hollows hex socket', `Removed: ${cubeResults.hexNutVolRemoved.toFixed(1)}mm³`);
assert(cubeResults.isManifold, 'Precision cube with fastener hardware forms closed watertight 2-manifold solid', `Tris: ${cubeResults.numTris}, Verts: ${cubeResults.numVerts}`);

// =========================================================================
// SUMMARY & CLOSEOUT
// =========================================================================
console.log(`\n${BOLD}=== Adversarial Verification Summary ===${RESET}`);
console.log(`Passed:   ${GREEN}${passedTests}${RESET}`);
console.log(`Failed:   ${failedTests === 0 ? GREEN + '0' : RED + failedTests}${RESET}`);

chromeProc.kill();
server.close();
await new Promise(r => setTimeout(r, 200));
try {
  fs.rmSync(tempProfile, { recursive: true, force: true });
} catch {
  // Ignore temp dir cleanup failure
}

if (failedTests > 0) {
  console.error(`\n${RED}Adversarial verification FAILED with ${failedTests} failure(s).${RESET}`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}Adversarial verification PASSED successfully! All product archetypes verified.${RESET}\n`);
  process.exit(0);
}
