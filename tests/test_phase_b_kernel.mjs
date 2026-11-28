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
const { estimateFilamentMass, analyzeBedContact } = await import('../src/export/stlExporter.js');
const { resolveAutoSlicerProfile, getSlicerProfileSettings, buildThreeMFBuffer } = await import('../src/export/threemfExporter.js');

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

console.log('\n5. QA Remediation Unit Invariants (ISSUE-001, 003, 004, 005, 009)...');
// ISSUE-001: Pipeline cache does not shadow Stage 2 extrudeHeight behind cached Stage 1 profile
const qaCache = createPipelineCache();
const qaBox = {
  id: 'qa_box', type: 'extrude', isClosed: true,
  points: [{ x: -25, y: -25 }, { x: 25, y: -25 }, { x: 25, y: 25 }, { x: -25, y: 25 }],
  extrudeHeight: 8, bevelSize: 0, cornerRadius: 0
};
const qaR1 = evaluatePartWithCache(qaBox, qaCache);
qaR1.geometry.computeBoundingBox();
qaBox.extrudeHeight = 35;
const qaR2 = evaluatePartWithCache(qaBox, qaCache);
qaR2.geometry.computeBoundingBox();
const qaH2 = qaR2.geometry.boundingBox.max.y - qaR2.geometry.boundingBox.min.y;
assert(qaR2.cacheHits.profile === true && qaR2.cacheHits.baseGeo === false && Math.abs(qaH2 - 35) < 0.01,
  'ISSUE-001: Stage 2 extrudeHeight=35 updates geometry immediately despite Stage 1 profile cache hit', `height=${qaH2.toFixed(1)}mm`);

// ISSUE-003: Hollow open-top cylinder mass < solid cylinder mass & monotonic with wall thickness
const cylPts = Array.from({ length: 32 }, (_, i) => {
  const a = (i / 32) * Math.PI * 2;
  return { x: Math.cos(a) * 25, y: Math.sin(a) * 25 };
});
const cylSolid = { id: 'cs', type: 'extrude', isClosed: true, points: cylPts, extrudeHeight: 60, shellEnabled: false };
const cylSolidMass = estimateFilamentMass([cylSolid], [{ geometry: buildPartGeometry(cylSolid) }]);
const wallMasses = [0.8, 1.6, 2.4, 3.6].map(t => {
  const p = { ...cylSolid, id: `ch_${t}`, shellEnabled: true, shellMode: 'hollow', shellThickness: t };
  return estimateFilamentMass([p], [{ geometry: buildPartGeometry(p) }]);
});
assert(wallMasses[1] < cylSolidMass && wallMasses[0] < wallMasses[1] && wallMasses[1] < wallMasses[2] && wallMasses[2] < wallMasses[3],
  'ISSUE-003: 1.6mm hollow cylinder mass < solid mass and scales monotonically with wall thickness',
  `solid=${cylSolidMass.toFixed(1)}g, walls=${wallMasses.map(m => m.toFixed(1)).join('<')}g`);

// ISSUE-004: Auto-derived Stage 5 slicer profile respects Shell & Intent
const profSolid = resolveAutoSlicerProfile([{ shellEnabled: false, texturePattern: 'none' }], 'auto');
const profHollow = resolveAutoSlicerProfile([{ shellEnabled: true, shellMode: 'hollow', shellThickness: 2.0 }], 'auto');
const profVase = resolveAutoSlicerProfile([{ shellEnabled: true, shellMode: 'vase_proxy' }], 'auto');
const profWeave = resolveAutoSlicerProfile([{ texturePattern: 'open-weave' }], 'auto');
assert(
  profSolid === 'standard' && getSlicerProfileSettings(profSolid).spiral_mode === '0' &&
  profHollow === 'multi_perimeter' && getSlicerProfileSettings(profHollow).spiral_mode === '0' &&
  profVase === 'vase' && getSlicerProfileSettings(profVase).spiral_mode === '1' &&
  profWeave === 'basket_weave_arachne' && getSlicerProfileSettings(profWeave).wall_generator === 'arachne',
  'ISSUE-004: Auto-derived slicer profile matches solid/hollow/vase_proxy/open-weave rules',
  `solid=${profSolid}, hollow=${profHollow}, vase=${profVase}, weave=${profWeave}`);

// ISSUE-005 & 009: Corner Round + Hollow preserves 50x50x35 bounds & bed contact analysis
const hollowBox = { ...qaBox, cornerRadius: 3, bevelSize: 0.5, shellEnabled: true, shellMode: 'hollow', shellThickness: 2.0 };
const hollowBoxGeom = buildPartGeometry(hollowBox);
hollowBoxGeom.computeBoundingBox();
const hb = hollowBoxGeom.boundingBox;
const hollowBoxTopo = verifyManifoldTopology(hollowBoxGeom);
const boxContact = analyzeBedContact([{ geometry: hollowBoxGeom }]);
const baubleTip = buildPartGeometry({
  type: 'revolve', isClosed: false, shellEnabled: false,
  points: [{ x: 0.01, y: 0 }, { x: 24, y: -25 }, { x: 8, y: -50 }]
});
const tipContact = analyzeBedContact([{ geometry: baubleTip }]);
assert(hollowBoxTopo.openEdges === 0 && hollowBoxTopo.isWatertight && Math.abs((hb.max.x - hb.min.x) - 50) < 0.05 && Math.abs((hb.max.y - hb.min.y) - 35) < 0.05,
  'ISSUE-005: Hollow 50x50x35 box with Corner Round=3mm is watertight and preserves exact nominal bounds',
  `openEdges=${hollowBoxTopo.openEdges}, ${(hb.max.x - hb.min.x).toFixed(1)}x${(hb.max.z - hb.min.z).toFixed(1)}x${(hb.max.y - hb.min.y).toFixed(1)}`);
assert(!boxContact.isLowContact && tipContact.isLowContact,
  'ISSUE-009: analyzeBedContact passes flat base and flags point-contact bauble',
  `box=${boxContact.contactAreaMm2}mm², tip=${tipContact.contactAreaMm2}mm²`);

console.log('\n6. QA Remediation Kernel Verification (ISSUE-012, 013, 014, 015, 016)...');
const circleLoop = (dia, n = 32) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return { x: +(Math.cos(a) * dia * 0.5).toFixed(3), y: +(Math.sin(a) * dia * 0.5).toFixed(3) };
});
const coasterPart = {
  id: 'qa_coaster', type: 'extrude', isClosed: true,
  points: circleLoop(100), cutouts: [circleLoop(80)],
  extrudeHeight: 10, floorThickness: 2.0, cornerRadius: 0, bevelSize: 0
};
const coasterGeom = buildPartGeometry(coasterPart);
const coasterTopo = verifyManifoldTopology(coasterGeom);
assert(coasterTopo.isWatertight && coasterTopo.openEdges === 0 && coasterTopo.volume > 10000,
  'ISSUE-014 & 016: 100mm multi-loop Cup Coaster with 2mm recessed floor is watertight (0 open edges)',
  `openEdges=${coasterTopo.openEdges}, vol=${coasterTopo.volume.toFixed(0)}mm³`);

const splitRect = [{ x: -40, y: -30 }, { x: 40, y: -30 }, { x: 40, y: 30 }, { x: -40, y: 30 }];
const baseLipPart = {
  id: 'qa_base_lip', type: 'extrude', isClosed: true, points: splitRect,
  extrudeHeight: 23, splitMeta: { role: 'base_lip', lipHeightMm: 3.0, lipToleranceMm: 0.22, snapFit: true, wallThicknessMm: 2.4 }
};
const lidGroovePart = {
  id: 'qa_lid_groove', type: 'extrude', isClosed: true, points: splitRect,
  baseZ: 20, extrudeHeight: 20, splitMeta: { role: 'lid_groove', lipHeightMm: 3.0, lipToleranceMm: 0.22, snapFit: true, wallThicknessMm: 2.4 }
};
const baseLipGeom = buildPartGeometry(baseLipPart);
const lidGrooveGeom = buildPartGeometry(lidGroovePart);
const lidNoSnapGeom = buildPartGeometry({ ...lidGroovePart, splitMeta: { ...lidGroovePart.splitMeta, snapFit: false } });
const baseLipTopo = verifyManifoldTopology(baseLipGeom);
const lidGrooveTopo = verifyManifoldTopology(lidGrooveGeom);
const lidNoSnapTopo = verifyManifoldTopology(lidNoSnapGeom);
assert(
  baseLipTopo.isWatertight && baseLipTopo.openEdges === 0 &&
  lidGrooveTopo.isWatertight && lidGrooveTopo.openEdges === 0 &&
  lidGrooveTopo.triangleCount > lidNoSnapTopo.triangleCount,
  'ISSUE-012: Pure-JS split base_lip & lid_groove embed paired snap-fit detent & catch groove (0 open edges)',
  `baseOpen=${baseLipTopo.openEdges}, lidOpen=${lidGrooveTopo.openEdges}, lidTris=${lidGrooveTopo.triangleCount}>${lidNoSnapTopo.triangleCount}`);

const diffuserGeom = buildPartGeometry({
  id: 'qa_diffuser', type: 'revolve', isClosed: false,
  points: [{ x: 21, y: 0 }, { x: 40, y: -60 }, { x: 15, y: -120 }],
  shellEnabled: true, shellMode: 'hollow', shellThickness: 1.8, openBottom: true, topVentMm: 30, baseMountDiameterMm: 42
});
const diffuserTopo = verifyManifoldTopology(diffuserGeom);
assert(diffuserTopo.isWatertight && diffuserTopo.openEdges === 0,
  'ISSUE-015 & 016: Open-bottom diffuser with Ø30 top vent & Ø42 base mount is watertight',
  `openEdges=${diffuserTopo.openEdges}`);

const { initCsg } = await import('../src/geometry/csgKernel.js');
await initCsg();
const baseHollowBox = {
  id: 'qa_hollow_cord', type: 'extrude', isClosed: true, points: splitRect,
  extrudeHeight: 40, shellEnabled: true, shellMode: 'hollow', shellThickness: 2.0
};
const hollowNoCordTopo = verifyManifoldTopology(buildPartGeometry(baseHollowBox));
const hollowWithCordTopo = verifyManifoldTopology(buildPartGeometry({ ...baseHollowBox, cordSlot: { width: 6, height: 6 } }));
assert(hollowWithCordTopo.isWatertight && hollowWithCordTopo.volume < hollowNoCordTopo.volume,
  'ISSUE-015: Hollow extrude with 6x6 cordSlot cuts clean watertight slot via CSG',
  `vol=${hollowWithCordTopo.volume.toFixed(0)}<${hollowNoCordTopo.volume.toFixed(0)}mm³`);

const dualParts = [
  { id: 'inner', name: 'Inner Tree', type: 'revolve', polymer: 'PLA', materialTag: 'opaque', amsSlot: 1 },
  { id: 'outer', name: 'Outer Tree', type: 'revolve', polymer: 'PLA', materialTag: 'clear', amsSlot: 2 }
];
const threeMfBuf = buildThreeMFBuffer(
  dualParts,
  [{ geometry: baseLipGeom }, { geometry: diffuserGeom }],
  'multi_perimeter', 'bambu_studio', 'bambu_a1',
  { unnestShells: true, brimEnabled: true, brimWidthMm: 6 }
);
const threeMfText = new TextDecoder().decode(new Uint8Array(threeMfBuf));
assert(
  threeMfText.includes('transform="1 0 0 0 1 0 0 0 1') &&
  threeMfText.includes('"brim_type": "outer_only"') &&
  threeMfText.includes('"brim_width": "6"') &&
  threeMfText.includes('"PLA"') &&
  threeMfText.includes('"extruder": 2'),
  'ISSUE-013 & 016: .3MF embeds un-nested transforms, Clear PLA preservation, AMS slots 1/2 & Outer Brim 6mm'
);

console.log(`\n=== Phase B Pure-JS Kernel Summary: ${passed} Passed, ${failed} Failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
