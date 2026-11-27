/**
 * SKETCH3D — MCP Pure-JS Geometry Assembly & Modifier Helpers
 * ============================================================
 * Evaluates Schema V2 parts via pure-JS kernels (pipelineCache, meshBuilder,
 * csgKernel, splitBody, stlExporter) and computes assembly metrics.
 */

import { syncLinkedClones } from '../src/geometry/offsetClone.js';
import { createPipelineCache, evaluatePartWithCache } from '../src/geometry/pipelineCache.js';
import { buildPartGeometry } from '../src/geometry/meshBuilder.js';
import { createCompatGeometry, verifyManifoldTopology, hasPhysicalApertures } from '../src/geometry/openWeaveMesh.js';
import { polyArea } from '../src/geometry/shell3d.js';
import { applyScaleModeToGeometry } from '../src/geometry/testScale.js';
import { DATUM_PLANES } from '../src/canvas/planeSelector.js';
import { initCsg, CsgScope, createExtrudedSolid } from '../src/geometry/csgKernel.js';
import { cutThroughHole } from '../src/geometry/pocketCutter.js';
import { splitBodyWithLip, checkJointInterference } from '../src/geometry/splitBody.js';
import { HARDWARE_PRESETS, LIGHTING_PRESETS, generateHexagonVertices, generateCircleVertices } from '../src/config/hardwarePresets.js';
import { migrateProjectV1ToV2 } from '../src/utils/projectMigration.js';

export function makePrimitivePoints(action, args) {
  const cx = Number(args.center?.x || 0);
  const cy = Number(args.center?.y || 0);
  if (action === 'rect') {
    const hw = Math.max(0.5, Number(args.widthMm || 40) * 0.5);
    const hh = Math.max(0.5, Number(args.heightMm || 40) * 0.5);
    return [{ x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh }, { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh }];
  }
  if (action === 'circle') {
    const r = Math.max(1, Number(args.radiusMm || 25));
    const segs = Math.max(8, Number(args.segments || 36));
    return Array.from({ length: segs }, (_, i) => {
      const a = (i / segs) * Math.PI * 2;
      return { x: +(cx + Math.cos(a) * r).toFixed(3), y: +(cy + Math.sin(a) * r).toFixed(3) };
    });
  }
  if (action === 'hex') {
    const flats = args.acrossFlatsMm || (Number(args.radiusMm || 25) * Math.sqrt(3));
    return generateHexagonVertices(cx, cy, flats);
  }
  return [];
}

async function buildCsgExtrudeWithFeatures(part) {
  const height = Math.max(1, part.extrudeHeight || 8);
  const csg = await initCsg();
  const scope = new CsgScope();
  try {
    const outerCCW = polyArea(part.points) >= 0 ? part.points : [...part.points].reverse();
    let solid = scope.track(createExtrudedSolid(outerCCW, height));
    for (const h of part.holes || []) {
      solid = scope.track(cutThroughHole(solid, h.x, h.y, Math.max(0.2, h.r)));
    }
    for (const poly of part.cutouts || []) {
      if (!poly || poly.length < 3) continue;
      const cutCCW = polyArea(poly) >= 0 ? poly : [...poly].reverse();
      const cutter = scope.track(createExtrudedSolid(cutCCW, height + 1.0).translate([0, 0, -0.5]));
      solid = scope.track(solid.subtract(cutter));
    }
    for (const s of part.standoffs || []) {
      const outerC = scope.track(csg.Manifold.cylinder(height, 3.6, 3.6, 24).translate([s.x, s.y, 0]));
      const innerC = scope.track(csg.Manifold.cylinder(height + 1.0, 1.6, 1.6, 24).translate([s.x, s.y, -0.5]));
      const boss = scope.track(outerC.subtract(innerC));
      solid = scope.track(solid.add(boss));
    }
    if (part.baseZ) solid = scope.track(solid.translate([0, 0, part.baseZ]));
    const mesh = solid.getMesh();
    const numProp = mesh.numProp || 3;
    const pos = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) {
      pos[i * 3] = mesh.vertProperties[i * numProp];
      pos[i * 3 + 1] = mesh.vertProperties[i * numProp + 2];
      pos[i * 3 + 2] = -mesh.vertProperties[i * numProp + 1];
    }
    return createCompatGeometry(pos, null, new Uint32Array(mesh.triVerts), null, null);
  } finally {
    scope.dispose();
  }
}

export async function buildAssemblyMeshes(state, caches, scaleOverride = null) {
  syncLinkedClones(state.parts);
  const scaleMode = scaleOverride || state.scaleMode || 'full';
  const meshes = [];
  const perPart = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let idx = 0; idx < state.parts.length; idx++) {
    const part = state.parts[idx];
    if (!part.points || part.points.length < 2) continue;
    const hasCsgFeatures = part.type === 'extrude' && part.isClosed && !part.shellEnabled &&
      ((part.holes?.length || 0) + (part.cutouts?.length || 0) + (part.standoffs?.length || 0) > 0) &&
      (!part.texturePattern || part.texturePattern === 'none') && !(part.twistDeg > 0);
    let geom;
    if (part.cordSlot) await initCsg().catch(() => null);
    if (hasCsgFeatures) {
      geom = await buildCsgExtrudeWithFeatures(part);
    } else {
      let cache = caches.get(part.id);
      if (!cache) { cache = createPipelineCache(); caches.set(part.id, cache); }
      geom = evaluatePartWithCache(part, cache, {}, null).geometry || buildPartGeometry(part, null);
    }
    if (!geom) continue;
    if (part.type !== 'revolve' && part.sketchPlane && part.sketchPlane !== 'XY' && DATUM_PLANES[part.sketchPlane]) {
      geom.applyMatrix4?.({ elements: DATUM_PLANES[part.sketchPlane].matrix });
    }
    if (scaleMode !== 'full') geom = applyScaleModeToGeometry(geom, scaleMode);
    geom.computeBoundingBox?.();
    const b = geom.boundingBox;
    if (b) {
      minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x);
      minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y);
      minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
    }
    const topo = verifyManifoldTopology(geom);
    meshes.push({ geometry: geom, userData: { partIndex: idx } });
    perPart.push({
      partIndex: idx, id: part.id, name: part.name, type: part.type,
      texturePattern: part.texturePattern || 'none', ...topo,
      hasApertures: (part.texturePattern === 'open-weave' || part.texturePattern === 'perforated-weave')
        ? hasPhysicalApertures(geom, part)
        : undefined
    });
  }

  const dims = minX < Infinity
    ? { width: +(maxX - minX).toFixed(2), depth: +(maxZ - minZ).toFixed(2), height: +(maxY - minY).toFixed(2) }
    : { width: 0, depth: 0, height: 0 };
  return { meshes, perPart, dims };
}

export function auditRevolveProfileOverhangs(points = []) {
  const warnings = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dr = Math.abs(points[i + 1].x) - Math.abs(points[i].x);
    const dy = Math.abs(points[i + 1].y - points[i].y);
    if (dr > 0.25) {
      const ang = (Math.atan2(dr, Math.max(0.01, dy)) * 180) / Math.PI;
      if (ang > 55.5) warnings.push(`Segment ${i}->${i + 1} slope ${ang.toFixed(1)}° exceeds 55° support-free limit`);
    }
  }
  return warnings;
}

export function getActiveMaterial(state) {
  const active = state.parts[state.activePartIndex] || state.parts[0];
  if (active?.polymerManual && (active.polymer === 'PLA' || active.polymer === 'PETG' || active.polymer === 'ABS')) {
    return active.polymer;
  }
  if (state.slicerProfile === 'clear_glass') return 'PETG';
  if (active?.polymer === 'PETG' || active?.polymer === 'ABS') return active.polymer;
  return 'PLA';
}

export function applyFastenerList(part, fasteners = []) {
  for (const f of fasteners) {
    const x = f.x ?? 0, y = f.y ?? 0;
    if (f.kind === 'hole') part.holes.push({ x, y, r: f.r ?? 1.6 });
    else if (f.kind === 'standoff') part.standoffs.push({ x, y });
    else if (f.kind === 'cutout_grid') {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        part.cutouts.push([
          { x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 - 7 }, { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 - 7 },
          { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 + 7 }, { x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 + 7 }
        ]);
      }
    } else if (f.kind.startsWith('nut_')) {
      const spec = HARDWARE_PRESETS[`HEX_${f.kind.toUpperCase()}`];
      if (spec) { part.cutouts.push(generateHexagonVertices(x, y, spec.acrossFlats)); part.holes.push({ x, y, r: spec.throughBore / 2 }); }
    } else if (f.kind.startsWith('csk_')) {
      const spec = HARDWARE_PRESETS[`CSK_WOOD_${f.kind.slice(4).toUpperCase()}`];
      if (spec) part.holes.push({ x, y, r: spec.shankDiameter / 2 });
    } else if (f.kind === 'tealight_42' || f.kind === 'bambu_kit_001' || f.kind === 'e14_collar_29') {
      const map = { tealight_42: 'TEALIGHT_42', bambu_kit_001: 'BAMBU_KIT_001', e14_collar_29: 'E14_COLLAR_29' };
      const spec = LIGHTING_PRESETS[map[f.kind]];
      if (spec) {
        if (part.type === 'revolve') { part.baseMountDiameterMm = spec.diameterMm; part.openBottom = true; }
        else part.cutouts.push(generateCircleVertices(x, y, spec.diameterMm, 32));
      }
    } else if (f.kind === 'cord_slot_6x6') {
      part.cordSlot = { width: 6, height: 6 };
    }
  }
}

export async function applySplitAndStack(state, part, args) {
  if (args.splitLipGroove) {
    if (!part.points || part.points.length < 3 || !part.isClosed) throw new Error('Split Lip/Groove requires a closed profile.');
    const totalH = part.extrudeHeight || 8;
    const splitZ = args.splitLipGroove.splitZMm ?? Math.round(totalH / 2);
    const wallT = Math.max(1.6, args.splitLipGroove.wallThicknessMm ?? part.shellThickness ?? 2.4);
    const lipH = args.splitLipGroove.lipHeightMm ?? 3.0;
    const clearanceMm = args.splitLipGroove.clearanceMm ?? 0.2;
    const snapFit = Boolean(args.splitLipGroove.snapFit);
    await initCsg();
    const scope = new CsgScope();
    try {
      const baseSolid = scope.track(createExtrudedSolid(part.points, totalH));
      const res = splitBodyWithLip(baseSolid, splitZ, { wallThicknessMm: wallT, lipHeightMm: lipH, clearanceMm, snapFit });
      const inter = checkJointInterference(res.base, res.lid);
      res.base.delete(); res.lid.delete();
      if (!inter.isCollisionFree) throw new Error(`Split joint interference ${inter.interferenceVolumeMm3.toFixed(2)}mm³`);
      const basePart = { ...part, id: `${part.id}_base`, name: `${part.name} (Base Lip)`, extrudeHeight: splitZ + lipH, splitMeta: { role: 'base_lip', lipHeightMm: lipH, lipToleranceMm: clearanceMm, snapFit, wallThicknessMm: wallT, collisionFree: true }, amsSlot: 1, color: '#00E56D' };
      const lidPart = { ...part, id: `${part.id}_lid`, name: `${part.name} (Lid Groove)`, baseZ: (part.baseZ || 0) + splitZ, extrudeHeight: totalH - splitZ, splitMeta: { role: 'lid_groove', lipHeightMm: lipH, lipToleranceMm: clearanceMm, snapFit, wallThicknessMm: wallT, collisionFree: true }, amsSlot: 2, color: '#73E6F1' };
      state.parts.splice(state.activePartIndex, 1, basePart, lidPart);
    } finally {
      scope.dispose();
    }
  }
  if (args.stackZ) {
    const newBaseZ = (part.baseZ || 0) + (part.extrudeHeight || 8);
    const sc = args.stackZ.scaleXY ?? 0.7;
    const stacked = migrateProjectV1ToV2({
      parts: [{
        id: `p_stack_${state.parts.length + 1}`, name: `Part ${state.parts.length + 1}`,
        baseZ: newBaseZ, extrudeHeight: args.stackZ.extrudeHeight ?? Math.min(8, Math.max(1, 256 - newBaseZ)),
        points: part.points.map(pt => ({ x: Math.round(pt.x * sc), y: Math.round(pt.y * sc) })),
        isClosed: part.isClosed, color: '#73E6F1'
      }]
    }).parts[0];
    state.parts.push(stacked);
    state.activePartIndex = state.parts.length - 1;
  }
}
