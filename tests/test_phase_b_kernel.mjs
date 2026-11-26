#!/usr/bin/env node
/**
 * SKETCH3D — Phase B Pure-JS Geometry Kernel Verification
 * ========================================================
 * Runs in pure Node.js (zero browser, zero DOM, zero CDN):
 * 1. Verifies all src/geometry/** modules import & execute without window/document
 * 2. Verifies pipelineCache.js dirty-flag Stage 4 caching (baseGeo & solidGeo hits)
 * 3. Verifies loftBuilder.js Square-to-Circle watertight 2-manifold geometry
 * 4. Verifies openWeaveMesh.js open-aperture basket weave (0 open edges, physical holes)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GEOM_DIR = path.join(ROOT, 'src', 'geometry');

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

console.log('\n1. Pure-JS Kernel Boundary (Zero Browser / Zero DOM)...');
assert(typeof globalThis.window === 'undefined' && typeof globalThis.document === 'undefined',
  'Running in pure Node.js without window or document');

const geomFiles = fs.readdirSync(GEOM_DIR)
  .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
  .sort();

let domLeakFiles = [];
for (const file of geomFiles) {
  const fullPath = path.join(GEOM_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  if (/\b(?:window|document)\./.test(stripped)) {
    domLeakFiles.push(file);
  }
  await import(pathToFileURL(fullPath).href);
}
assert(geomFiles.length >= 10, 'Discovered and imported all src/geometry/** modules in Node', `${geomFiles.length} modules`);
assert(domLeakFiles.length === 0, 'Zero window./document. references in src/geometry/**', domLeakFiles.join(', '));

const { buildPartGeometry } = await import('../src/geometry/meshBuilder.js');
const { createPipelineCache, computeStageHashes, evaluatePartWithCache } = await import('../src/geometry/pipelineCache.js');
const { resampleClosedLoop2D, buildLoftGeometry } = await import('../src/geometry/loftBuilder.js');
const { OPEN_WEAVE_DEFAULTS, buildOpenWeaveMesh, verifyManifoldTopology, hasPhysicalApertures } = await import('../src/geometry/openWeaveMesh.js');

const compatExtrude = buildPartGeometry({
  id: 'compat_box',
  type: 'extrude',
  points: [{ x: -15, y: -15 }, { x: 15, y: -15 }, { x: 15, y: 15 }, { x: -15, y: 15 }],
  isClosed: true,
  extrudeHeight: 20
});
assert(compatExtrude?.attributes?.position?.count > 0, 'buildPartGeometry executes cleanly in Node without THREE global');

console.log('\n2. Pipeline Dirty-Flag Cache (src/geometry/pipelineCache.js)...');
const cache = createPipelineCache();
let baseCalls = 0;
let solidCalls = 0;
let texCalls = 0;

const evaluators = {
  buildProfile: (part) => part.points.map(p => ({ ...p })),
  buildBase: (part) => {
    baseCalls++;
    return buildPartGeometry({ ...part, texturePattern: 'none', bevelSize: 0, twistDeg: 0, shellEnabled: false });
  },
  buildSolid: (part, baseGeo) => {
    solidCalls++;
    return baseGeo.clone ? baseGeo.clone() : baseGeo;
  },
  applyTexture: (part, solidGeo) => {
    texCalls++;
    const cloned = solidGeo.clone ? solidGeo.clone() : solidGeo;
    const pos = cloned.attributes?.position;
    if (pos && part.texturePattern && part.texturePattern !== 'none') {
      const d = Number(part.textureDepth) || 0.8;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) + d * 0.1);
      }
    }
    return cloned;
  }
};

const basePart = {
  id: 'cache_vase',
  type: 'revolve',
  points: [{ x: 20, y: 0 }, { x: 35, y: -35 }, { x: 25, y: -70 }],
  isClosed: false,
  extrudeHeight: 70,
  shellEnabled: true,
  shellThickness: 1.6,
  texturePattern: 'none',
  textureDepth: 0.8,
  textureFreq: 24
};

const h1 = computeStageHashes(basePart);
assert(Boolean(h1 && h1.profile && h1.baseGeo && h1.solidGeo && h1.texGeo), 'computeStageHashes produces hashes for all 4 pipeline stages');

const resCold = evaluatePartWithCache(basePart, cache, evaluators);
assert(!resCold.cacheHits.baseGeo && !resCold.cacheHits.solidGeo && baseCalls === 1 && solidCalls === 1 && texCalls === 1,
  'Cold cache evaluation invokes Stage 2, 3, and 4 once');

const resWarm = evaluatePartWithCache({ ...basePart }, cache, evaluators);
assert(resWarm.cacheHits.profile && resWarm.cacheHits.baseGeo && resWarm.cacheHits.solidGeo && resWarm.cacheHits.texGeo,
  'Identical part hits all 4 cache stages');
assert(baseCalls === 1 && solidCalls === 1 && texCalls === 1, 'Warm cache skips re-evaluating builders');

const resTexEdit = evaluatePartWithCache(
  { ...basePart, texturePattern: 'wave', textureDepth: 1.4, bandEnabled: true, bandCount: 6 },
  cache,
  evaluators
);
assert(
  resTexEdit.cacheHits.profile === true &&
  resTexEdit.cacheHits.baseGeo === true &&
  resTexEdit.cacheHits.solidGeo === true &&
  resTexEdit.cacheHits.texGeo === false,
  'Stage 4 texture edit hits profile, baseGeo & solidGeo caches and only invalidates texGeo'
);
assert(baseCalls === 1 && solidCalls === 1 && texCalls === 2,
  'Stage 4 texture edit does NOT re-invoke Stage 2/3 evaluators',
  `calls=(${baseCalls}, ${solidCalls}, ${texCalls})`);

console.log('\n3. Loft Builder Manifold Verification (src/geometry/loftBuilder.js)...');
const squarePts = [
  { x: -20, y: -20 },
  { x: 20, y: -20 },
  { x: 20, y: 20 },
  { x: -20, y: 20 }
];
const resampledLoop = resampleClosedLoop2D(squarePts, 48);
assert(resampledLoop.length === 48, 'resampleClosedLoop2D resamples square to 48 perimeter points', `count=${resampledLoop.length}`);

const loftSolid = buildLoftGeometry({
  id: 'loft_solid',
  type: 'loft',
  points: squarePts,
  isClosed: true,
  extrudeHeight: 60,
  loftTopShape: 'circle',
  loftTopScale: 0.7,
  loftTwistDeg: 30,
  shellEnabled: false
});
const loftSolidTopo = verifyManifoldTopology(loftSolid);
assert(
  loftSolidTopo.openEdges === 0 && loftSolidTopo.volume > 0 && loftSolidTopo.triangleCount > 100,
  'Solid Square-to-Circle loft produces watertight 2-manifold mesh',
  `openEdges=${loftSolidTopo.openEdges}, vol=${loftSolidTopo.volume.toFixed(1)}mm³`
);

const loftHollow = buildLoftGeometry({
  id: 'loft_hollow',
  type: 'loft',
  points: squarePts,
  isClosed: true,
  extrudeHeight: 60,
  loftTopShape: 'circle',
  loftTopScale: 0.75,
  loftTwistDeg: 20,
  shellEnabled: true,
  shellThickness: 2.0,
  intent: 'lampshade'
});
const loftHollowTopo = verifyManifoldTopology(loftHollow);
assert(
  loftHollowTopo.openEdges === 0 && loftHollowTopo.volume > 0,
  'Hollow Square-to-Circle loft produces watertight 2-manifold mesh',
  `openEdges=${loftHollowTopo.openEdges}, vol=${loftHollowTopo.volume.toFixed(1)}mm³`
);

console.log('\n4. Open-Aperture Basket Weave Verification (src/geometry/openWeaveMesh.js)...');
assert(OPEN_WEAVE_DEFAULTS && OPEN_WEAVE_DEFAULTS.weaveBands === 2.5, 'OPEN_WEAVE_DEFAULTS exported with canonical defaults');

const weavePart = {
  id: 'open_basket_lamp',
  type: 'revolve',
  texturePattern: 'open-weave',
  weaveBands: 2.5,
  weaveGapMm: 0.8,
  weavePillars: 16,
  weaveTwistDeg: 45,
  extrudeHeight: 110,
  points: [{ x: 32, y: 0 }, { x: 40, y: -55 }, { x: 34, y: -110 }],
  isClosed: false
};
const weaveGeom = buildOpenWeaveMesh(weavePart);
const weaveTopo = verifyManifoldTopology(weaveGeom);
const apertureRes = hasPhysicalApertures(weaveGeom, weavePart);
const hasApertures = apertureRes === true || apertureRes?.hasApertures === true;

assert(weaveGeom?.attributes?.position?.count > 1000, 'Open-aperture basket weave generates high-detail geometry', `verts=${weaveGeom?.attributes?.position?.count}`);
assert(weaveTopo.openEdges === 0, 'Open-aperture basket weave is watertight (0 open edges)', `openEdges=${weaveTopo.openEdges}`);
assert(weaveTopo.volume > 0, 'Open-aperture basket weave has positive enclosed volume', `vol=${weaveTopo.volume.toFixed(1)}mm³`);
assert(hasApertures, 'hasPhysicalApertures confirms radial light rays pass cleanly through physical weave gaps');

const routedWeave = buildPartGeometry(weavePart);
const routedTopo = verifyManifoldTopology(routedWeave);
assert(routedTopo.openEdges === 0 && routedTopo.volume > 0, 'meshBuilder routes open-weave cleanly through buildOpenWeaveMesh');

console.log(`\n=== Phase B Pure-JS Kernel Summary: ${passed} Passed, ${failed} Failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
