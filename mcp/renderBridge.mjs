/**
 * SKETCH3D — On-Demand Headless Chromium 4-Quadrant VLM Renderer
 * ==============================================================
 * Renders any Schema V2 project into a 1200x800 4-quadrant contact sheet
 * (Isometric, Top Cavity, Front Profile, Rear Seam) using Chrome CDP + WebGL.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

export function findChromeBinary() {
  const candidates = [
    process.env.SKETCH3D_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find(c => fs.existsSync(c)) || null;
}

function buildRenderScript(v2Project) {
  return `(async () => {
    if (!window.sketch3d) return { ok: false, error: 'window.sketch3d unavailable' };
    const { state, rebuild3DMesh, viewport3D, stageRouter, migrateProjectV1ToV2 } = window.sketch3d;
    const v2 = migrateProjectV1ToV2(${JSON.stringify(v2Project)});
    state.parts = v2.parts;
    state.activePartIndex = v2.activePartIndex || 0;
    state.scaleMode = v2.scaleMode || 'full';
    state.slicerTarget = v2.slicerTarget || 'bambu_studio';
    state.printerProfile = v2.printerProfile || 'bambu_a1';
    state.slicerProfile = v2.slicerProfile || 'standard';
    stageRouter?.setStage?.(2);
    rebuild3DMesh();
    viewport3D.resetView();
    viewport3D.updateCamera();
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 1200;
    offCanvas.height = 800;
    const ctx = offCanvas.getContext('2d');
    ctx.fillStyle = '#020203';
    ctx.fillRect(0, 0, 1200, 800);
    const views = [
      { name: 'ISOMETRIC (3/4 PERSPECTIVE)', theta: Math.PI / 4, phi: Math.PI / 3.2, x: 0, y: 0 },
      { name: 'TOP (CAVITY & OVERHANGS)', theta: 0, phi: 0.15, x: 600, y: 0 },
      { name: 'FRONT (PROFILE & TEXTURE)', theta: 0, phi: Math.PI / 2.05, x: 0, y: 400 },
      { name: 'REAR / BACK (SEAM INTEGRITY)', theta: Math.PI, phi: Math.PI / 2.05, x: 600, y: 400 }
    ];
    for (const v of views) {
      viewport3D.setCameraOrbit(v.theta, v.phi);
      viewport3D.renderer.render(viewport3D.scene, viewport3D.camera);
      ctx.drawImage(viewport3D.renderer.domElement, v.x, v.y, 600, 400);
      ctx.fillStyle = 'rgba(2, 2, 3, 0.78)';
      ctx.fillRect(v.x + 12, v.y + 12, 290, 26);
      ctx.strokeStyle = '#1e1e2a';
      ctx.strokeRect(v.x + 12, v.y + 12, 290, 26);
      ctx.fillStyle = '#FEFF00';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(v.name, v.x + 20, v.y + 29);
      ctx.strokeStyle = '#1e1e2a';
      ctx.strokeRect(v.x, v.y, 600, 400);
    }
    ctx.fillStyle = 'rgba(2, 2, 3, 0.90)';
    ctx.fillRect(0, 0, 1200, 42);
    ctx.fillStyle = '#FEFF00';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('SKETCH3D MCP 4-QUADRANT RENDER // ' + (v2.parts[0]?.name || 'MODEL').toUpperCase(), 20, 26);
    viewport3D.resetView();
    return { ok: true, dataUrl: offCanvas.toDataURL('image/png') };
  })()`;
}

export async function renderProjectMultiview(v2Project, outputImagePath, rootDir) {
  const chromePath = findChromeBinary();
  if (!chromePath) {
    return { ok: false, skipped: true, reason: 'Chrome/Chromium executable not found' };
  }
  const rootResolved = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let relPath;
    try { relPath = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, ''); } catch (_) { res.writeHead(400); res.end('Bad Request'); return; }
    const filePath = path.resolve(rootResolved, relPath || 'index.html');
    if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch3d-mcp-render-'));
  const chromeProc = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist', `--user-data-dir=${tempProfile}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let ws;
  try {
    const activePortFile = path.join(tempProfile, 'DevToolsActivePort');
    let cdpPort = null;
    for (let i = 0; i < 40 && !cdpPort; i++) {
      if (fs.existsSync(activePortFile)) cdpPort = parseInt(fs.readFileSync(activePortFile, 'utf-8').split('\n')[0], 10);
      else await new Promise(r => setTimeout(r, 100));
    }
    if (!cdpPort) return { ok: false, reason: 'CDP port failed to open' };
    const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    for (let i = 0; i < 40; i++) {
      const ready = await cdp('Runtime.evaluate', { expression: 'Boolean(window.sketch3d)', returnByValue: true });
      if (ready.result?.value) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const evalRes = await cdp('Runtime.evaluate', {
      expression: buildRenderScript(v2Project),
      returnByValue: true,
      awaitPromise: true
    });
    const val = evalRes.result?.value;
    if (!val?.ok || !val.dataUrl) return { ok: false, reason: val?.error || 'Render failed' };
    const outPath = outputImagePath || path.join(os.tmpdir(), `sketch3d_multiview_${Date.now()}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const pngBuf = Buffer.from(val.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(outPath, pngBuf);
    return { ok: true, path: outPath, bytes: pngBuf.length, width: 1200, height: 800 };
  } finally {
    try { ws?.close(); } catch (_) {}
    try { chromeProc.kill('SIGTERM'); } catch (_) {}
    try { server.close(); } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  }
}
