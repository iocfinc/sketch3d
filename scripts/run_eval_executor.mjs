/**
 * SKETCH3D — @eval-executor Runner
 * =================================
 * Headless Chromium browser driver executing canonical recipes R01-R10.
 * Emits binary .stl / .3mf files, viewport screenshots, and manifest.json.
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

const CYAN = '\x1b[96m', GREEN = '\x1b[92m', RED = '\x1b[91m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

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

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'
};

async function main() {
  console.log(`\n${CYAN}${BOLD}[@eval-executor] Starting Dual-Agent Evaluation Runner...${RESET}`);
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  const recipesData = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'evals', 'sanity_recipes.json'), 'utf-8'));
  const recipes = recipesData.recipes || [];

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

  const chromePath = findChrome();
  if (!chromePath) {
    console.error(`${RED}[@eval-executor] Chrome/Chromium executable not found.${RESET}`);
    server.close();
    process.exit(1);
  }

  const tempProfile = fs.mkdtempSync(path.join('/tmp', 'sketch3d-exec-'));
  const chromeProc = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
    `--user-data-dir=${tempProfile}`, 'about:blank'
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
    console.error(`${RED}[@eval-executor] DevTools port failed to open.${RESET}`);
    chromeProc.kill('SIGTERM'); server.close(); process.exit(1);
  }

  const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const pages = await listRes.json();
  const targetPage = pages.find(p => p.type === 'page');
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalInPage(expr) {
    const res = await sendCommand('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(`Browser Eval Error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');
  await sendCommand('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

  // Wait until window.THREE is loaded from CDN
  for (let i = 0; i < 40; i++) {
    const hasThree = await evalInPage('typeof window.THREE !== "undefined"');
    if (hasThree) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const manifest = {
    executed_at: new Date().toISOString(),
    recipes: {}
  };

  console.log(`[@eval-executor] Connected to live WebGL app. Executing ${recipes.length} recipes...`);

  for (const recipe of recipes) {
    const rId = recipe.id;
    process.stdout.write(`  -> Executing ${rId}: ${recipe.name}... `);

    const result = await evalInPage(`(async () => {
      const { buildPartGeometry } = await import('./src/geometry/meshBuilder.js');
      const { extractPrintableTriangles, buildBinarySTLBuffer } = await import('./src/export/stlExporter.js');
      const { buildThreeMFBuffer } = await import('./src/export/threemfExporter.js');

      const recipe = ${JSON.stringify(recipe)};
      const part = {
        id: 'eval-' + recipe.id,
        name: recipe.name,
        type: recipe.type || 'extrude',
        points: recipe.points || [],
        extrudeHeight: recipe.heightAttempt !== undefined ? Math.min(256, Math.max(1, recipe.heightAttempt)) : (recipe.height || 20),
        twistDeg: recipe.twist || 0,
        shellEnabled: !!recipe.shellMode,
        shellMode: recipe.shellMode || 'none',
        shellThickness: recipe.thicknessAttempt !== undefined ? Math.max(0.4, recipe.thicknessAttempt) : (recipe.shellThickness || 1.2),
        intent: recipe.intent || 'vessel',
        texturePattern: recipe.texturePattern || (recipe.patterns ? recipe.patterns[0] : 'none'),
        textureDepth: recipe.textureDepth ?? 0.8,
        textureFreq: recipe.textureFreq ?? 24,
        isClosed: true
      };

      const geom = buildPartGeometry(part);
      if (!geom) return { ok: false, error: 'Geometry generation returned null' };

      geom.computeBoundingBox();
      const bbox = geom.boundingBox;
      const dims = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
      };

      const mesh = new THREE.Mesh(geom);
      let format = recipe.format || 'stl';
      let buf;

      if (format === '3mf') {
        const profile = recipe.slicerProfile || 'clear_glass';
        buf = buildThreeMFBuffer([part], [mesh], profile);
      } else {
        const { triangles } = extractPrintableTriangles([mesh]);
        buf = buildBinarySTLBuffer(triangles);
      }

      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      const base64Data = btoa(binary);

      // Compute bottom and top cross section centroid difference for mesh
      const pos = geom.attributes.position;
      let botSumX = 0, botSumZ = 0, botCount = 0;
      let topSumX = 0, topSumZ = 0, topCount = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (Math.abs(y - bbox.min.y) < 0.2) {
          botSumX += pos.getX(i); botSumZ += pos.getZ(i); botCount++;
        }
        if (Math.abs(y - bbox.max.y) < 0.2) {
          topSumX += pos.getX(i); topSumZ += pos.getZ(i); topCount++;
        }
      }
      const botCentroid = { x: botCount ? botSumX / botCount : 0, z: botCount ? botSumZ / botCount : 0 };
      const topCentroid = { x: topCount ? topSumX / topCount : 0, z: topCount ? topSumZ / topCount : 0 };
      const centroidDrift = Math.hypot(topCentroid.x - botCentroid.x, topCentroid.z - botCentroid.z);

      return {
        ok: true,
        format,
        dims,
        vertexCount: pos.count,
        base64Data,
        measured: {
          centroidDrift,
          minX: bbox.min.x, maxX: bbox.max.x,
          minY: bbox.min.y, maxY: bbox.max.y,
          minZ: bbox.min.z, maxZ: bbox.max.z
        }
      };
    })()`);

    if (!result.ok) {
      console.log(`${RED}FAILED: ${result.error}${RESET}`);
      continue;
    }

    const fileExt = result.format === '3mf' ? '.3mf' : '.stl';
    const outFilename = `${rId}${fileExt}`;
    const outFilePath = path.join(RUNS_DIR, outFilename);
    const binaryBuf = Buffer.from(result.base64Data, 'base64');
    fs.writeFileSync(outFilePath, binaryBuf);

    // Capture screenshot
    const shotData = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(RUNS_DIR, `${rId}.png`);
    fs.writeFileSync(shotPath, Buffer.from(shotData.data, 'base64'));

    manifest.recipes[rId] = {
      name: recipe.name,
      format: result.format,
      file: outFilename,
      screenshot: `${rId}.png`,
      file_size_bytes: binaryBuf.length,
      vertex_count: result.vertexCount,
      dimensions_mm: result.dims,
      measured: result.measured
    };

    console.log(`${GREEN}DONE (${binaryBuf.length} B, ${result.vertexCount} verts)${RESET}`);
  }

  const manifestPath = path.join(RUNS_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[@eval-executor] Manifest saved to ${manifestPath}`);

  ws.close();
  chromeProc.kill('SIGTERM');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  server.close();
}

main().catch(err => {
  console.error(`${RED}[@eval-executor] Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
