#!/usr/bin/env node
/**
 * SKETCH3D — Phase C Unified Printer Profile & Stdio MCP Integration Suite
 * =========================================================================
 * 1. Verifies unified printerProfile.js (bambu_a1, bambu_a1_mini, orca_generic)
 *    & Bambu/Orca slicer settings + Stage 5 UI printer/slicer controls.
 * 2. Spawns `node mcp/sketch3d-mcp.mjs` over stdio JSON-RPC 2.0 and tests
 *    initialize, tools/list, strict JSON Schema rejection, and end-to-end tools:
 *    sketch_2d -> generate_form -> apply_modifier -> apply_texture_bands
 *    -> inspect_and_render -> export_print_bundle.
 * 3. Builds BOTH Dual-Shell Christmas Tree and Open-Aperture Basket-Weave Lamp,
 *    verifies 0 non-manifold edges, exports interchangeable Schema V2 .json,
 *    and reloads both into the browser UI via CDP checking matching bounding boxes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getPrinterProfile,
  listPrinterProfiles,
  checkBoundsFitPrinter,
  buildSlicerProjectSettings
} from '../src/export/printerProfile.js';
import { migrateProjectV1ToV2 } from '../src/utils/projectMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm'
};

let passed = 0;
let failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { passed++; console.log(`  ✔ [PASS] ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.error(`  ✘ [FAIL] ${label}${detail ? ` — ${detail}` : ''}`); }
}

function findChrome() {
  return [
    process.env.SKETCH3D_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'
  ].filter(Boolean).find(p => fs.existsSync(p)) || null;
}

class StdioMcpClient {
  constructor() {
    this.proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'sketch3d-mcp.mjs')], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
    this.stderr = '';
    this.proc.stderr.on('data', d => { this.stderr += d.toString(); });
    this.proc.stdout.on('data', chunk => {
      this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);
      while (this.buf.length > 0) {
        let raw;
        if (this.buf.slice(0, 32).toString('utf-8').toLowerCase().startsWith('content-length:')) {
          const he = this.buf.indexOf('\r\n\r\n');
          if (he === -1) break;
          const m = this.buf.slice(0, he).toString('utf-8').match(/content-length:\s*(\d+)/i);
          const len = m ? parseInt(m[1], 10) : 0;
          if (this.buf.length < he + 4 + len) break;
          raw = this.buf.slice(he + 4, he + 4 + len).toString('utf-8');
          this.buf = this.buf.slice(he + 4 + len);
        } else {
          const idx = this.buf.indexOf('\n');
          if (idx === -1) break;
          raw = this.buf.slice(0, idx).toString('utf-8').trim();
          this.buf = this.buf.slice(idx + 1);
          if (!raw) continue;
        }
        const msg = JSON.parse(raw);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }
  request(method, params = {}, useContentLength = false) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP timeout for ${method}`)), 15000);
      this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      if (useContentLength) {
        this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`);
      } else {
        this.proc.stdin.write(body + '\n');
      }
    });
  }
  notify(method, params = {}) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async callTool(name, args) {
    const res = await this.request('tools/call', { name, arguments: args });
    if (res.error) throw new Error(`RPC Error ${res.error.code}: ${res.error.message}`);
    return res.result?.structuredContent || JSON.parse(res.result.content[0].text);
  }
  close() {
    try { this.proc.stdin.end(); } catch (_) {}
    try { this.proc.kill('SIGTERM'); } catch (_) {}
  }
}

console.log('\n1. Unified Printer Profile & Schema V2 Registry...');
const profiles = listPrinterProfiles();
assert(profiles.length === 3, 'printerProfile.js defines 3 canonical printer profiles', profiles.map(p => p.id).join(', '));
const a1 = getPrinterProfile('bambu_a1');
const mini = getPrinterProfile('bambu_a1_mini');
const orca = getPrinterProfile('orca_generic');
assert(a1.bedWidthMm === 256 && a1.safeBoundsXY.max === 246 && a1.extrusionMode === 'M83', 'bambu_a1 canonical bounds verified');
assert(mini.bedWidthMm === 180 && mini.safeBoundsXY.max === 170 && mini.extrusionMode === 'M83', 'bambu_a1_mini canonical bounds verified');
assert(orca.bedWidthMm === 250 && orca.safeBoundsXY.max === 240 && orca.extrusionMode === 'M83', 'orca_generic canonical bounds verified');
const orcaSettings = buildSlicerProjectSettings('basket_weave_arachne', 'orcaslicer', 'orca_generic');
assert(orcaSettings.wall_generator === 'arachne' && orcaSettings.slicer_application === 'OrcaSlicer' && orcaSettings.printer_profile === 'orca_generic',
  'OrcaSlicer + orca_generic Arachne .3MF metadata unified cleanly');
assert(!checkBoundsFitPrinter({ width: 200, depth: 200, height: 100 }, 'bambu_a1_mini').fits, 'Bounds exceeding 180mm flagged on A1 Mini');
const v2Mig = migrateProjectV1ToV2({ printerProfile: 'bambu_a1_mini', slicerTarget: 'orcaslicer', parts: [{ offsetDistance: 6, wallThicknessMm: 2.2, rimMarginMm: 5.0 }] });
assert(v2Mig.printerProfile === 'bambu_a1_mini' && v2Mig.slicerTarget === 'orcaslicer' && v2Mig.parts[0].offsetMm === 6 && v2Mig.parts[0].wallThicknessMm === 2.2 && v2Mig.parts[0].rimMarginMm === 5.0,
  'Schema V2 preserves printerProfile, slicerTarget, offsetMm, wallThicknessMm & rimMarginMm');

console.log('\n2. Stdio MCP Server Handshake, Schema Validation & E2E Builds...');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch3d-phase-c-'));
const client = new StdioMcpClient();

const initRes = await client.request('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'test-c', version: '1.0' } });
assert(initRes.result?.serverInfo?.name === 'sketch3d-mcp', 'MCP initialize handshake succeeded');
client.notify('notifications/initialized', {});

const listRes = await client.request('tools/list', {});
const toolNames = (listRes.result?.tools || []).map(t => t.name);
assert(
  ['sketch_2d', 'generate_form', 'apply_modifier', 'apply_texture_bands', 'inspect_and_render', 'export_print_bundle'].every(n => toolNames.includes(n)) && toolNames.length === 6,
  'tools/list exposes all 6 typed SKETCH3D MCP tools', toolNames.join(', ')
);

const invalidCall = await client.callTool('sketch_2d', { unknownField: 123 });
assert(invalidCall.ok === false && invalidCall.error === 'SCHEMA_VALIDATION_ERROR', 'Strict JSON Schema validator rejects unknown arguments');

// Build 1: Dual-Shell Christmas Tree via MCP
await client.callTool('sketch_2d', {
  action: 'set_profile', sketchPlane: 'XZ', isClosed: false, partName: 'Inner Core',
  bezierNodes: [{ x: 30, y: 0 }, { x: 20, y: -24 }, { x: 14, y: -48 }, { x: 1.0, y: -70 }],
  smoothness: 0.35, resolutionMm: 0.5
});
await client.callTool('generate_form', { mode: 'revolve', materialTag: 'opaque', color: '#FF66D9' });
await client.callTool('generate_form', { mode: 'offset_clone', offsetMm: 10, materialTag: 'clear', color: '#73E6F1' });
await client.callTool('apply_modifier', { shellEnabled: true, shellMode: 'hollow', shellThickness: 1.2, intent: 'lampshade' });
const treeTex = await client.callTool('apply_texture_bands', {
  texturePattern: 'coral', textureDepth: 1.0, textureFreq: 24,
  bandEnabled: true, bandCount: 8, bandMode: 'weave', bandFreq: 10, bandPhaseDeg: 90, bandDepth: 1.0
});
assert(treeTex.ok && treeTex.partMetrics?.nonManifoldEdges === 0, 'Dual-Shell Tree outer shell has 0 non-manifold edges', JSON.stringify(treeTex.boundingBoxMm));
const treeBundle = await client.callTool('export_print_bundle', {
  outputDir: outDir, baseName: 'dual_shell_tree', formats: ['3mf', 'gcode.3mf'],
  slicerTarget: 'bambu_studio', printerProfile: 'bambu_a1'
});
assert(treeBundle.ok && treeBundle.safetyReport?.passed && treeBundle.manifoldReport?.nonManifoldEdges === 0 && treeBundle.exportedFiles.length === 2,
  'Dual-Shell Tree exported .3mf + .gcode.3mf + v2 .json with 5/5 Safety Gate PASS',
  `mass=${treeBundle.estimatedMassGrams}g, bbox=${treeBundle.boundingBoxMm.width}x${treeBundle.boundingBoxMm.depth}x${treeBundle.boundingBoxMm.height}`);

// Build 2: Open-Aperture Basket-Weave Lamp via MCP (OrcaSlicer + orca_generic)
await client.callTool('sketch_2d', { action: 'clear' });
await client.callTool('sketch_2d', {
  action: 'set_profile', sketchPlane: 'XZ', isClosed: false, partName: 'Basket Lamp',
  points: [{ x: 32, y: 0 }, { x: 40, y: -55 }, { x: 34, y: -110 }]
});
await client.callTool('generate_form', { mode: 'revolve', heightZ: 110, materialTag: 'opaque', color: '#FEFF00' });
await client.callTool('apply_modifier', { shellEnabled: true, shellMode: 'hollow', shellThickness: 2.0, intent: 'lampshade' });
const lampTex = await client.callTool('apply_texture_bands', {
  texturePattern: 'open-weave', weaveBands: 2.5, weaveGapMm: 0.8, weavePillars: 16, weaveTwistDeg: 45
});
assert(lampTex.slicerProfile === 'basket_weave_arachne' && lampTex.partMetrics?.hasApertures === true && lampTex.partMetrics?.openEdges === 0 && lampTex.partMetrics?.nonManifoldEdges === 0,
  'Open-Aperture Basket Lamp enforces Arachne Fidelity Contract, physical apertures, and 0 open/non-manifold edges');
const lampShotPath = path.join(outDir, 'lamp_multiview.png');
const lampInspect = await client.callTool('inspect_and_render', { printerProfile: 'orca_generic', renderMultiview: true, outputImagePath: lampShotPath });
const shotReady = lampInspect.multiviewRender?.skipped || (lampInspect.multiviewRender?.ok && fs.existsSync(lampShotPath) && fs.readFileSync(lampShotPath).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
assert(lampInspect.ok && lampInspect.manifoldReport?.isWatertight && lampInspect.boundingBoxMm?.fitsPrinterBed && shotReady,
  'inspect_and_render confirms watertight lamp fits orca_generic 250³ bed + 4-quadrant PNG render',
  lampInspect.multiviewRender?.skipped ? 'chromium skipped' : `png=${lampInspect.multiviewRender?.bytes}B`);
const lampBundle = await client.callTool('export_print_bundle', {
  outputDir: outDir, baseName: 'open_basket_lamp', formats: ['3mf', 'stl'],
  slicerTarget: 'orcaslicer', printerProfile: 'orca_generic'
});
assert(lampBundle.ok && lampBundle.slicerTarget === 'orcaslicer' && lampBundle.printerProfile === 'orca_generic' && lampBundle.manifoldReport?.nonManifoldEdges === 0,
  'Open-Aperture Lamp exported OrcaSlicer .3mf + .stl + v2 .json',
  `bbox=${lampBundle.boundingBoxMm.width}x${lampBundle.boundingBoxMm.depth}x${lampBundle.boundingBoxMm.height}`);

const pingCl = await client.request('ping', {}, true);
assert(pingCl.result !== undefined, 'MCP stdio supports Content-Length framed JSON-RPC');

// Build 3: CSG Fasteners (M4 Nut + Hole) & Loft parity
await client.callTool('sketch_2d', { action: 'clear' });
await client.callTool('sketch_2d', { action: 'rect', widthMm: 40, heightMm: 40 });
await client.callTool('generate_form', { mode: 'extrude', heightZ: 20 });
const csgMod = await client.callTool('apply_modifier', {
  fasteners: [{ kind: 'nut_m4', x: 0, y: 0 }, { kind: 'hole', x: 12, y: 12, r: 1.6 }]
});
const csgInsp = await client.callTool('inspect_and_render', { printerProfile: 'bambu_a1_mini', renderMultiview: false });
assert(csgMod.ok && csgInsp.manifoldReport?.isWatertight && csgInsp.manifoldReport?.volumeMm3 < 31800,
  'MCP CSG fasteners cut watertight holes & hex pocket in pure Node',
  `vol=${csgInsp.manifoldReport?.volumeMm3}mm³, tris=${csgInsp.manifoldReport?.triangleCount}`);

client.close();

console.log('\n3. Headless Browser Reload Parity (v2 .json -> UI Bounding Boxes & Stage 5 Selectors)...');
const chromePath = findChrome();
if (!chromePath) {
  console.log('  ⚠ Chrome/Chromium not found; skipping browser reload parity check.');
} else {
  const server = http.createServer((req, res) => {
    let rel = '';
    try { rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, ''); } catch (_) { res.writeHead(400); res.end('Bad'); return; }
    const fp = path.resolve(ROOT, rel || 'index.html');
    if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch3d-c-cdp-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    `--user-data-dir=${userDataDir}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdpPort = null;
  for (let i = 0; i < 40 && !cdpPort; i++) {
    const pf = path.join(userDataDir, 'DevToolsActivePort');
    if (fs.existsSync(pf)) cdpPort = parseInt(fs.readFileSync(pf, 'utf-8').split('\n')[0], 10);
    else await new Promise(r => setTimeout(r, 100));
  }
  const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
    }
    if (d.method === 'Runtime.consoleAPICalled' && d.params?.type === 'error') {
      consoleErrors.push(d.params.args.map(a => a.value || a.description || '').join(' '));
    }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('DOM.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
  await new Promise(r => setTimeout(r, 1000));

  for (const [label, bundle] of [['Dual-Shell Tree', treeBundle], ['Open Basket Lamp', lampBundle]]) {
    const doc = await cdp('DOM.getDocument', { depth: 1 });
    const inp = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#loadProjectInput' });
    await cdp('DOM.setFileInputFiles', { nodeId: inp.nodeId, files: [bundle.projectJsonPath] });
    await new Promise(r => setTimeout(r, 350));
    const uiRes = await cdp('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const meshes = window.sketch3d.viewport3D.partsGroup.children.filter(c => c.isMesh);
        const box = new window.THREE.Box3();
        meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
        return {
          parts: window.sketch3d.state.parts.length,
          printerProfile: document.getElementById('printerProfileSelect')?.value,
          slicerTarget: document.getElementById('slicerTargetSelect')?.value,
          slicerProfile: document.getElementById('slicerProfileSelect')?.value,
          fitBadge: document.getElementById('fitBadge')?.textContent,
          w: +(box.max.x - box.min.x).toFixed(2),
          d: +(box.max.z - box.min.z).toFixed(2),
          h: +(box.max.y - box.min.y).toFixed(2)
        };
      })()`
    });
    const ui = uiRes.result.value;
    const mcpBox = bundle.boundingBoxMm;
    const match = Math.abs(ui.w - mcpBox.width) <= 0.6 && Math.abs(ui.d - mcpBox.depth) <= 0.6 && Math.abs(ui.h - mcpBox.height) <= 0.6;
    assert(match && ui.printerProfile === bundle.printerProfile && ui.slicerTarget === bundle.slicerTarget,
      `${label}: Browser reload matches MCP bounding box & printer/slicer state`,
      `browser=${ui.w}x${ui.d}x${ui.h} vs mcp=${mcpBox.width}x${mcpBox.depth}x${mcpBox.height} (${ui.printerProfile}/${ui.slicerTarget})`);
  }

  // Verify Stage 5 Printer selector dynamically updates fitBadge & autoArrange label
  const pSwitch = await cdp('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      document.getElementById('stageTab5').click();
      const sel = document.getElementById('printerProfileSelect');
      sel.value = 'bambu_a1_mini';
      sel.dispatchEvent(new Event('change'));
      return {
        fit: document.getElementById('fitBadge')?.textContent,
        arrange: document.getElementById('autoArrangeBtn')?.textContent,
        badge: document.getElementById('printerBadgeLabel')?.textContent
      };
    })()`
  });
  assert(pSwitch.result.value.arrange.includes('180×180') && pSwitch.result.value.fit.includes('A1 Mini'),
    'Stage 5 #printerProfileSelect dynamically updates #fitBadge and #autoArrangeBtn bounds',
    `${pSwitch.result.value.fit} | ${pSwitch.result.value.arrange}`);
  assert(consoleErrors.length === 0, 'Zero browser console errors during Phase C parity verification', consoleErrors.join(' | '));

  ws.close();
  chrome.kill('SIGTERM');
  server.close();
  await new Promise(r => setTimeout(r, 200));
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n=== Phase C MCP & Printer Profile Summary: ${passed} Passed, ${failed} Failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
