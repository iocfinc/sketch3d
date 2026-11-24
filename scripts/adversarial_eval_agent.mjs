/**
 * SKETCH3D — @adversarial-agent Evaluator
 * ========================================
 * Autonomous adversarial verification agent for SKETCH3D CAD pipelines.
 * Executes "elephant goldfish" boundary stress tests across 4 product archetypes:
 * 1. Minimalist Cylindrical Vase (Revolve 360° + Wave/Spiral/Flute/Ripple textures)
 * 2. Christmas Bauble Ornament (Spherical/Teardrop Profile Revolve + Spiral/Strata)
 * 3. Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave Branch Needles)
 * 4. Precision Cube with Fastener Hardware (Extrude + Bevel + M4 Pocket + Bore)
 *
 * Maps out the service execution graph, audits rendering consistency on the live page,
 * and outputs structured telemetry to evals/runs/latest/adversarial_verdict.json.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT_DIR, 'evals', 'runs', 'latest');

const CYAN = '\x1b[96m', GREEN = '\x1b[92m', RED = '\x1b[91m', YELLOW = '\x1b[93m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.wasm': 'application/wasm'
};

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

/**
 * Service dependency map for CAD pipeline stages
 */
const SERVICE_DEPENDENCY_GRAPH = {
  'Minimalist Cylindrical Vase': [
    { service: '2D Profile Normalization', module: 'src/geometry/shell3d.js::normalizeLatheProfile2D' },
    { service: 'Profile Arc Resampling', module: 'src/geometry/shell3d.js::subdivideLatheProfile2D' },
    { service: 'Hollow Vessel Generator', module: 'src/geometry/shell3d.js::buildHollowLatheProfile' },
    { service: 'Lathe Revolve Kernel', module: 'src/geometry/meshBuilder.js::buildRevolveGeometry' },
    { service: 'Outer Wall Attribute Masking', module: 'src/geometry/meshBuilder.js::aOuterWallMask' },
    { service: 'Procedural Surface Texture', module: 'src/geometry/textures.js::applySurfaceTexture' },
    { service: 'Overhang Slope Clamping', module: 'src/geometry/textures.js::clampOverhang' }
  ],
  'Christmas Bauble Ornament': [
    { service: 'Teardrop Profile Resampling', module: 'src/geometry/shell3d.js::subdivideLatheProfile2D' },
    { service: 'Spherical Lathe Mesh Generation', module: 'src/geometry/meshBuilder.js::buildRevolveGeometry' },
    { service: 'Helical Ribbon Wrap', module: 'src/geometry/textures.js::evaluateDisplacement(spiral)' },
    { service: 'Pole Singularity Protection', module: 'src/geometry/textures.js::computeRimMask' },
    { service: 'Filament Mass Estimator', module: 'src/geometry/shell3d.js::calculateVaseModeMass' }
  ],
  'Multi-Tiered Christmas Tree': [
    { service: 'Stepped Conical Lathe Profile', module: 'src/geometry/revolveTool.js::buildSteppedRevolveProfile' },
    { service: 'Support-Free Overhang Audit', module: 'src/geometry/revolveTool.js::auditRevolveOverhangs' },
    { service: 'Solid Lathe Revolve Kernel', module: 'src/geometry/meshBuilder.js::buildRevolveGeometry' },
    { service: 'Branch Needle Wave Displacement', module: 'src/geometry/textures.js::evaluateDisplacement(wave)' },
    { service: 'Bambu Lab A1 Envelope Clamping', module: 'src/geometry/plateArranger.js::BED_SIZE_MM' }
  ],
  'Precision Cube with Fastener Hardware': [
    { service: 'Square Base Extrude', module: 'src/geometry/csgKernel.js::createExtrudedSolid' },
    { service: 'Manifold-3D WASM Boolean Engine', module: 'src/geometry/csgKernel.js::initCsg' },
    { service: 'Bolt Through-Bore Cutter', module: 'src/geometry/pocketCutter.js::cutThroughHole' },
    { service: 'Captive Hex Nut Pocket Cutter', module: 'src/geometry/pocketCutter.js::cutHexNutPocket' },
    { service: 'Fastener Hardware Specifications', module: 'src/config/hardwarePresets.js::HARDWARE_PRESETS' },
    { service: '2-Manifold Watertightness Audit', module: 'src/geometry/csgKernel.js::manifoldToThreeGeometry' }
  ]
};

async function main() {
  console.log(`\n${CYAN}${BOLD}[@adversarial-agent] Launching Automated Stress-Testing Agent...${RESET}`);

  fs.mkdirSync(RUNS_DIR, { recursive: true });

  const chromePath = findChrome();
  if (!chromePath) {
    console.error(`  ${RED}✖ Chrome/Chromium not found. Cannot launch headless agent.${RESET}`);
    process.exit(1);
  }

  // 1. Static Server
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

  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  // 2. Headless Chrome Driver
  const tempProfile = fs.mkdtempSync(path.join('/tmp', 'sketch3d-adv-agent-'));
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
      cdpPort = parseInt(fs.readFileSync(activePortFile, 'utf-8').trim().split('\n')[0], 10);
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!cdpPort) {
    chromeProc.kill();
    server.close();
    console.error(`  ${RED}✖ Failed to connect to CDP port.${RESET}`);
    process.exit(1);
  }

  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const pages = await listRes.json();
  const targetPage = pages.find(p => p.type === 'page');
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let msgId = 1;
  const pendingRequests = new Map();
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
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
    return res.result ? res.result.value : null;
  };

  // Run comprehensive evaluation in browser
  const archetypesToRender = [
    {
      id: 'vase_wave',
      name: 'Minimalist Cylinder Vase (Wave Ribs)',
      part: {
        points: [{ x: 25, y: 0 }, { x: 25, y: -100 }],
        type: 'revolve',
        isClosed: false,
        shellEnabled: true,
        shellMode: 'hollow',
        shellThickness: 1.6,
        texturePattern: 'wave',
        textureDepth: 1.2,
        textureFreq: 24,
        color: '#73E6F1'
      }
    },
    {
      id: 'vase_spiral',
      name: 'Minimalist Cylinder Vase (Spiral Ribbon)',
      part: {
        points: [{ x: 25, y: 0 }, { x: 25, y: -100 }],
        type: 'revolve',
        isClosed: false,
        shellEnabled: true,
        shellMode: 'hollow',
        shellThickness: 1.6,
        texturePattern: 'spiral',
        textureDepth: 1.2,
        textureFreq: 24,
        color: '#FEFF00'
      }
    },
    {
      id: 'vase_flute',
      name: 'Minimalist Cylinder Vase (Vintage Flute)',
      part: {
        points: [{ x: 25, y: 0 }, { x: 25, y: -100 }],
        type: 'revolve',
        isClosed: false,
        shellEnabled: true,
        shellMode: 'hollow',
        shellThickness: 1.6,
        texturePattern: 'flute',
        textureDepth: 1.2,
        textureFreq: 24,
        color: '#FF0055'
      }
    },
    {
      id: 'bauble_ornament',
      name: 'Christmas Bauble Ornament (Spiral Bulb)',
      part: {
        points: [{ x: 0.01, y: 0 }, { x: 18, y: -12 }, { x: 35, y: -35 }, { x: 30, y: -55 }, { x: 16, y: -65 }, { x: 8, y: -72 }, { x: 8, y: -80 }],
        type: 'revolve',
        isClosed: false,
        shellEnabled: true,
        shellMode: 'hollow',
        shellThickness: 1.6,
        texturePattern: 'spiral',
        textureDepth: 1.0,
        textureFreq: 20,
        color: '#FF0055'
      }
    },
    {
      id: 'christmas_tree',
      name: 'Multi-Tiered Christmas Tree (Stepped Lathe)',
      part: {
        points: [
          { x: 45, y: 0 }, { x: 32, y: -30 }, { x: 38, y: -30 },
          { x: 24, y: -60 }, { x: 30, y: -60 },
          { x: 12, y: -90 }, { x: 16, y: -90 }, { x: 0.5, y: -110 }
        ],
        type: 'revolve',
        isClosed: false,
        shellEnabled: false,
        texturePattern: 'wave',
        textureDepth: 1.0,
        textureFreq: 32,
        color: '#00E56D'
      }
    },
    {
      id: 'precision_cube',
      name: 'Precision Cube with Hardware Pocket & Bore',
      part: {
        points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
        type: 'extrude',
        extrudeHeight: 40,
        isClosed: true,
        shellEnabled: false,
        texturePattern: 'strata',
        textureDepth: 0.8,
        textureFreq: 16,
        color: '#73E6F1'
      }
    }
  ];

  // Switch to 3D View for clear screenshots
  await evalInPage(`(() => {
    const d3Btn = document.getElementById('view3DBtn');
    if (d3Btn) d3Btn.click();
  })()`);
  await new Promise(r => setTimeout(r, 200));

  const visualReports = {};

  for (const item of archetypesToRender) {
    const renderRes = await evalInPage(`(async () => {
      if (!window.sketch3d) return { ok: false, error: 'window.sketch3d not initialized' };
      const { state, rebuild3DMesh, viewport3D } = window.sketch3d;
      state.parts = [${JSON.stringify(item.part)}];
      state.activePartIndex = 0;
      rebuild3DMesh();
      viewport3D.resetView();
      viewport3D.updateCamera();

      const geom = viewport3D.partsGroup.children.find(c => c.isMesh)?.geometry;
      if (!geom) return { ok: false, error: 'No mesh generated in viewport' };
      geom.computeBoundingBox();
      const bbox = geom.boundingBox;

      const dimOverlay = document.getElementById('dimOverlay')?.textContent || '';
      const estOverlay = document.getElementById('estimateOverlay')?.textContent || '';

      return {
        ok: true,
        vertexCount: geom.attributes.position.count,
        dims: {
          x: +(bbox.max.x - bbox.min.x).toFixed(1),
          y: +(bbox.max.y - bbox.min.y).toFixed(1),
          z: +(bbox.max.z - bbox.min.z).toFixed(1)
        },
        dimOverlay,
        estOverlay
      };
    })()`);

    await new Promise(r => setTimeout(r, 150));
    const shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const imgFilename = `${item.id}.png`;
    const imgPath = path.join(RUNS_DIR, imgFilename);
    fs.writeFileSync(imgPath, Buffer.from(shot.data, 'base64'));

    visualReports[item.id] = {
      name: item.name,
      screenshot: imgFilename,
      bytes: shot.data.length,
      measured: renderRes
    };
  }

  // Run deep geometrical & topological analysis
  const verdict = await evalInPage(`(async () => {
    const { buildRevolveGeometry } = await import('./src/geometry/meshBuilder.js');
    const { auditRevolveOverhangs } = await import('./src/geometry/revolveTool.js');
    const { calculateVaseModeMass } = await import('./src/geometry/shell3d.js');
    const { initCsg, CsgScope } = await import('./src/geometry/csgKernel.js');
    const { cutThroughHole, cutHexNutPocket } = await import('./src/geometry/pocketCutter.js');

    const results = {};

    // 1. Minimalist Cylindrical Vase (Wave, Spiral, Flute variance comparison)
    const vaseBase = {
      points: [{ x: 25, y: 0 }, { x: 25, y: -100 }],
      isClosed: false,
      shellEnabled: true,
      shellMode: 'hollow',
      shellThickness: 1.6,
      textureDepth: 1.2,
      textureFreq: 24
    };

    const gWave = buildRevolveGeometry({ ...vaseBase, texturePattern: 'wave' });
    const gSpiral = buildRevolveGeometry({ ...vaseBase, texturePattern: 'spiral' });
    const gFlute = buildRevolveGeometry({ ...vaseBase, texturePattern: 'flute' });

    const calcVariance = (geom) => {
      const pos = geom.attributes.position;
      const mask = geom.attributes.aOuterWallMask;
      const yDep = [], thetaDep = [];
      let maxInnerDrift = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const r = Math.hypot(x, z);
        const m = mask ? mask.getX(i) : 1.0;
        const theta = Math.atan2(z, x);
        if (m <= 0.001 && y > 5 && y < 95 && r > 5) {
          const d = Math.abs(r - 23.4);
          if (d > maxInnerDrift) maxInnerDrift = d;
        }
        if (m >= 0.999 && y >= 20 && y <= 80) {
          if (Math.abs(theta) < 0.05) yDep.push(r);
          if (Math.abs(y - 50) < 0.8) thetaDep.push(r);
        }
      }
      const meanY = yDep.reduce((a, b) => a + b, 0) / (yDep.length || 1);
      const varY = yDep.reduce((a, b) => a + (b - meanY) ** 2, 0) / (yDep.length || 1);
      const meanTh = thetaDep.reduce((a, b) => a + b, 0) / (thetaDep.length || 1);
      const varTh = thetaDep.reduce((a, b) => a + (b - meanTh) ** 2, 0) / (thetaDep.length || 1);
      return { varY, varTh, maxInnerDrift, verts: pos.count };
    };

    const vWave = calcVariance(gWave);
    const vSpiral = calcVariance(gSpiral);
    const vFlute = calcVariance(gFlute);

    results.vase = {
      vertices: vWave.verts,
      innerCavityDriftMm: vWave.maxInnerDrift,
      wave: { varY: +vWave.varY.toFixed(4), varTheta: +vWave.varTh.toFixed(4) },
      spiral: { varY: +vSpiral.varY.toFixed(4), varTheta: +vSpiral.varTh.toFixed(4) },
      flute: { varY: +vFlute.varY.toFixed(4), varTheta: +vFlute.varTh.toFixed(4) },
      status: vWave.verts >= 4000 && vWave.maxInnerDrift < 0.01 && vWave.varY > 0.1 && vSpiral.varTh > 0.1 ? 'PASS' : 'FAIL'
    };

    // 2. Christmas Bauble
    const baublePart = {
      points: [{ x: 0.01, y: 0 }, { x: 18, y: -12 }, { x: 35, y: -35 }, { x: 30, y: -55 }, { x: 16, y: -65 }, { x: 8, y: -72 }, { x: 8, y: -80 }],
      isClosed: false,
      shellEnabled: true,
      shellMode: 'hollow',
      shellThickness: 1.6,
      texturePattern: 'spiral',
      textureDepth: 1.0,
      textureFreq: 20
    };
    const geomBauble = buildRevolveGeometry(baublePart);
    geomBauble.computeBoundingBox();
    const bBbox = geomBauble.boundingBox;
    const bW = bBbox.max.x - bBbox.min.x;
    const bH = bBbox.max.y - bBbox.min.y;
    const bMass = calculateVaseModeMass(Math.PI * bW, bH, Math.PI * 100);
    results.bauble = {
      vertices: geomBauble.attributes.position.count,
      diameterMm: +bW.toFixed(1),
      heightMm: +bH.toFixed(1),
      estMassGrams: +bMass.toFixed(1),
      status: bW > 68 && bW < 75 && bMass < 35 ? 'PASS' : 'FAIL'
    };

    // 3. Multi-Tiered Tree
    const treeProfile = [
      { r: 45, y: 0 }, { r: 32, y: 30 }, { r: 38, y: 30 },
      { r: 24, y: 60 }, { r: 30, y: 60 },
      { r: 12, y: 90 }, { r: 16, y: 90 }, { r: 0.5, y: 110 }
    ];
    const treeAudit = auditRevolveOverhangs(treeProfile, 55);
    const treePart = {
      points: treeProfile.map(p => ({ x: p.r, y: -p.y })),
      isClosed: false,
      shellEnabled: false,
      texturePattern: 'wave',
      textureDepth: 1.0,
      textureFreq: 32
    };
    const geomTree = buildRevolveGeometry(treePart);
    geomTree.computeBoundingBox();
    const tBbox = geomTree.boundingBox;
    const tW = tBbox.max.x - tBbox.min.x;
    const tH = tBbox.max.y - tBbox.min.y;
    results.tree = {
      overhangWarnings: treeAudit.warnings.length,
      widthMm: +tW.toFixed(1),
      heightMm: +tH.toFixed(1),
      fitsA1: tW <= 256 && tH <= 256,
      status: treeAudit.warnings.length === 0 && tW <= 256 ? 'PASS' : 'FAIL'
    };

    // 4. Precision Cube
    const csg = await initCsg();
    const scope = new CsgScope();
    const baseCube = scope.track(csg.Manifold.cube([40, 40, 40], true));
    const initVol = baseCube.getProperties().volume;
    const bored = scope.track(cutThroughHole(baseCube, 0, 0, 2.25));
    const boredVol = bored.getProperties().volume;
    const pocketed = scope.track(cutHexNutPocket(bored, 0, 0, 'HEX_NUT_M4', 'axial'));
    const finalVol = pocketed.getProperties().volume;
    const pMesh = pocketed.getMesh();
    results.cube = {
      initialVolumeMm3: +initVol.toFixed(1),
      boltRemovedMm3: +(initVol - boredVol).toFixed(1),
      nutRemovedMm3: +(boredVol - finalVol).toFixed(1),
      numTris: pMesh.numTri,
      numVerts: pMesh.numVert,
      status: (initVol - boredVol > 600) && (boredVol - finalVol > 80) ? 'PASS' : 'FAIL'
    };
    scope.dispose();

    return results;
  })()`);

  chromeProc.kill();
  server.close();
  await new Promise(r => setTimeout(r, 200));
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch {}

  // Output telemetry & verdicts
  console.log(`\n${BOLD}=== Adversarial Agent Execution Report ===${RESET}`);
  for (const [archetype, res] of Object.entries(verdict)) {
    const isPass = res.status === 'PASS';
    const tag = isPass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`  [${tag}] ${BOLD}${archetype.toUpperCase()}${RESET} — ${JSON.stringify(res)}`);
  }

  // Print service mapping
  console.log(`\n${BOLD}=== Mapped Pipeline Services ===${RESET}`);
  for (const [name, services] of Object.entries(SERVICE_DEPENDENCY_GRAPH)) {
    console.log(`  ${BOLD}${name}:${RESET}`);
    services.forEach(s => console.log(`    ↳ ${CYAN}${s.service}${RESET} (${s.module})`));
  }

  const finalPayload = {
    timestamp: new Date().toISOString(),
    agent: '@adversarial-agent',
    archetypes: verdict,
    visual_evidence: visualReports,
    services: SERVICE_DEPENDENCY_GRAPH,
    overallVerdict: Object.values(verdict).every(v => v.status === 'PASS') ? 'PASS' : 'FAIL'
  };

  const verdictPath = path.join(RUNS_DIR, 'adversarial_verdict.json');
  fs.writeFileSync(verdictPath, JSON.stringify(finalPayload, null, 2), 'utf-8');
  console.log(`\n${GREEN}✔ Structured telemetry written to ${path.relative(ROOT_DIR, verdictPath)}${RESET}\n`);

  process.exit(finalPayload.overallVerdict === 'PASS' ? 0 : 1);
}

main().catch(err => {
  console.error(`\n${RED}Fatal error in adversarial agent:${RESET}`, err);
  process.exit(1);
});
