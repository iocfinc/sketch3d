/**
 * SKETCH3D — Coaster Multi-Loop, Independent Floor, Open Bottom, Top Vent & Cord Slot Helpers
 * =========================================================================================
 * Pure-JS watertight geometry helpers for recessed multi-loop extrusions (coasters),
 * independent floor thickness, open-bottom toggles, and top vent / cord slot openings.
 */

import { polyArea, computeShellInner, triangulatePolygon2D, normalizeLatheProfile2D, subdivideLatheProfile2D } from './shell3d.js';
import { createCompatGeometry } from './openWeaveMesh.js';
import { getCsg, CsgScope } from './csgKernel.js';

function computeNormal(a, b, c) {
  const cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const n = [cb[1] * ab[2] - cb[2] * ab[1], cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function addTri(pos, norm, mask, a, b, c, m = 0) {
  pos.push(...a, ...b, ...c);
  const [nx, ny, nz] = computeNormal(a, b, c);
  for (let k = 0; k < 3; k++) { norm.push(nx, ny, nz); mask.push(m); }
}

function addWallRing(pos, norm, mask, loop, y0, y1, outward, ccw, m = 0) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p00 = [loop[i].x, y0, -loop[i].y];
    const p10 = [loop[j].x, y0, -loop[j].y];
    const p11 = [loop[j].x, y1, -loop[j].y];
    const p01 = [loop[i].x, y1, -loop[i].y];
    const flip = outward ? ccw : !ccw;
    if (flip) {
      addTri(pos, norm, mask, p00, p10, p11, m);
      addTri(pos, norm, mask, p00, p11, p01, m);
    } else {
      addTri(pos, norm, mask, p00, p11, p10, m);
      addTri(pos, norm, mask, p00, p01, p11, m);
    }
  }
}

function addFlatCap(pos, norm, mask, loop, y, faceUp, ccw) {
  const tris = triangulatePolygon2D(loop);
  for (const [i, j, k] of tris) {
    const a = [loop[i].x, y, -loop[i].y];
    const b = [loop[j].x, y, -loop[j].y];
    const c = [loop[k].x, y, -loop[k].y];
    if (faceUp ? ccw : !ccw) addTri(pos, norm, mask, a, b, c);
    else addTri(pos, norm, mask, a, c, b);
  }
}

function bridgeOuterAndHole(outerCCW, holeCW) {
  let maxHx = -Infinity, hIdx = 0;
  for (let i = 0; i < holeCW.length; i++) {
    if (holeCW[i].x > maxHx) { maxHx = holeCW[i].x; hIdx = i; }
  }
  const hp = holeCW[hIdx];
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < outerCCW.length; i++) {
    if (outerCCW[i].x >= hp.x - 1e-4) {
      const d = Math.hypot(outerCCW[i].x - hp.x, outerCCW[i].y - hp.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
  }
  const merged = [];
  for (let i = 0; i <= bestIdx; i++) merged.push(outerCCW[i]);
  for (let k = 0; k <= holeCW.length; k++) merged.push(holeCW[(hIdx + k) % holeCW.length]);
  for (let i = bestIdx; i < outerCCW.length; i++) merged.push(outerCCW[i]);
  return merged;
}

/**
 * Builds watertight recessed coaster / multi-loop solid with independent floorThickness.
 */
export function buildMultiLoopRecessedExtrude(outerPts, innerLoops, height, floorThickness, THREE = globalThis.THREE) {
  if (!outerPts || outerPts.length < 3 || !innerLoops || innerLoops.length === 0) return null;
  const validLoops = innerLoops.filter(l => Array.isArray(l) && l.length >= 3);
  if (validLoops.length === 0) return null;

  const H = Math.max(1.5, Number(height) || 8);
  const floorT = Math.min(H - 0.5, Math.max(0.4, Number(floorThickness) || 1.6));
  const outerCCW = polyArea(outerPts) >= 0 ? outerPts.map(p => ({ ...p })) : [...outerPts].reverse().map(p => ({ ...p }));

  const pos = [], norm = [], mask = [];
  addFlatCap(pos, norm, mask, outerCCW, 0, false, true);
  addWallRing(pos, norm, mask, outerCCW, 0, H, true, true, 1.0);

  let bridged = outerCCW;
  const sortedHoles = validLoops
    .map(l => (polyArea(l) <= 0 ? l.map(p => ({ ...p })) : [...l].reverse().map(p => ({ ...p }))))
    .sort((a, b) => Math.max(...b.map(p => p.x)) - Math.max(...a.map(p => p.x)));

  for (const holeCW of sortedHoles) {
    bridged = bridgeOuterAndHole(bridged, holeCW);
    const holeCCW = [...holeCW].reverse();
    addFlatCap(pos, norm, mask, holeCCW, floorT, true, true);
    addWallRing(pos, norm, mask, holeCCW, floorT, H, false, true, 0.0);
  }

  const rimTris = triangulatePolygon2D(bridged);
  for (const [i, j, k] of rimTris) {
    addTri(pos, norm, mask, [bridged[i].x, H, -bridged[i].y], [bridged[j].x, H, -bridged[j].y], [bridged[k].x, H, -bridged[k].y], 0.0);
  }

  const geom = createCompatGeometry(pos, norm, null, mask, THREE);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Applies topVentMm and baseMountDiameterMm adjustments to a revolved profile.
 */
export function prepareRevolvePoints(part) {
  let pts = (part.points || []).map(p => ({ x: p.x, y: p.y }));
  if (pts.length < 2) return pts;

  const baseApertureR = Number(part.baseMountDiameterMm || 0) * 0.5;
  if (baseApertureR > 0.5) {
    // Identify bottom endpoint (max y in canvas coords where y = -Z)
    let botIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y > pts[botIdx].y) botIdx = i;
    }
    if (Math.abs(pts[botIdx].x) < baseApertureR) {
      pts[botIdx] = { ...pts[botIdx], x: baseApertureR };
    }
  }

  const topVentR = Number(part.topVentMm || 0) * 0.5;
  if (topVentR > 0.5) {
    let topIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y < pts[topIdx].y) topIdx = i;
    }
    if (Math.abs(pts[topIdx].x) < topVentR) {
      pts[topIdx] = { ...pts[topIdx], x: topVentR };
    }
  }
  return pts;
}

/**
 * Builds hollow lathe profile respecting independent openBottom and floorThickness.
 */
export function buildHollowLatheProfileEx(pts, shellThickness, options = {}, THREE = globalThis.THREE) {
  if (!pts || pts.length < 2) return [];
  const thickness = Math.max(0.4, Number(shellThickness) || 1.2);
  const openBottom = Boolean(options.openBottom);
  const subdivideOuter = Boolean(options.subdivideOuter);
  let sorted = normalizeLatheProfile2D(pts).sort((a, b) => a.y - b.y);
  if (subdivideOuter) sorted = subdivideLatheProfile2D(sorted, 1.0);

  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;
  const H = Math.max(1, maxY - minY);
  const rawFloor = options.floorThickness > 0 ? Number(options.floorThickness) : thickness;
  const floorT = Math.min(H * 0.9, Math.max(0.8, rawFloor));
  const latheProfile = [];

  const addPt = (r, y, isOuter = false) => {
    const v = THREE?.Vector2
      ? new THREE.Vector2(r, y)
      : { x: r, y, clone() { return { x: this.x, y: this.y, isOuter: this.isOuter, clone: this.clone }; } };
    v.isOuter = isOuter;
    latheProfile.push(v);
  };

  if (openBottom) {
    const bottomOuter = sorted[0], topOuter = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length; i++) addPt(sorted[i].r, sorted[i].y, true);
    addPt(Math.max(0.8, topOuter.r - thickness), topOuter.y, false);
    for (let i = sorted.length - 1; i >= 0; i--) addPt(Math.max(0.8, sorted[i].r - thickness), sorted[i].y, false);
    addPt(bottomOuter.r, bottomOuter.y, false);
  } else {
    addPt(0.01, minY, false);
    for (let i = 0; i < sorted.length; i++) addPt(sorted[i].r, sorted[i].y, true);
    const topOuter = sorted[sorted.length - 1];
    addPt(Math.max(0.8, topOuter.r - thickness), topOuter.y, false);
    for (let i = sorted.length - 1; i >= 0; i--) {
      addPt(Math.max(0.8, sorted[i].r - thickness), Math.max(minY + floorT, sorted[i].y), false);
    }
    addPt(0.01, minY + floorT, false);
  }
  return latheProfile;
}

/**
 * Computes a 6x6mm cord exit slot polygon along the outer bottom edge of a 2D shape.
 */
export function buildCordSlotCutout(points, widthMm = 6, heightMm = 6) {
  if (!points || points.length < 3) return null;
  let maxX = -Infinity, sumY = 0;
  for (const p of points) { if (p.x > maxX) maxX = p.x; sumY += p.y; }
  const cy = sumY / points.length;
  const hh = heightMm * 0.5;
  return [
    { x: maxX - widthMm, y: cy - hh },
    { x: maxX + 1, y: cy - hh },
    { x: maxX + 1, y: cy + hh },
    { x: maxX - widthMm, y: cy + hh }
  ];
}

/**
 * Cuts a rectangular cord-exit slot at the bottom rim of an existing BufferGeometry using Manifold CSG.
 */
export function cutCordSlotOnGeometry(geom, cordSlot, THREE = globalThis.THREE) {
  const csg = getCsg();
  if (!csg || !geom || !cordSlot) return geom;
  const w = Math.max(2, Number(cordSlot.width || 6));
  const h = Math.max(2, Number(cordSlot.height || 6));
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes?.position;
  if (!pos || pos.count < 3) return geom;

  geom.computeBoundingBox?.();
  const b = geom.boundingBox;
  const minY = b ? b.min.y : 0;
  const maxX = b ? b.max.x : 40;
  const spanX = Math.max(12, maxX * 0.75);

  const vertMap = new Map();
  const verts = [];
  const triVerts = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Map SKETCH3D Y-up (x, y, z) -> Manifold Z-up (x, -z, y)
    const mx = x, my = -z, mz = y;
    const key = `${Math.round(mx * 1000)},${Math.round(my * 1000)},${Math.round(mz * 1000)}`;
    let idx = vertMap.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      vertMap.set(key, idx);
      verts.push(mx, my, mz);
    }
    triVerts[i] = idx;
  }

  const scope = new CsgScope();
  try {
    const mesh = new csg.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts });
    mesh.merge?.();
    const solid = scope.track(new csg.Manifold(mesh));
    const cutter = scope.track(
      csg.Manifold.cube([spanX, w, h + 0.5], false).translate([maxX - spanX + 2, -w * 0.5, minY - 0.5])
    );
    const cut = scope.track(solid.subtract(cutter));
    const outMesh = cut.getMesh();
    const numProp = outMesh.numProp || 3;
    const outPos = new Float32Array(outMesh.numVert * 3);
    for (let i = 0; i < outMesh.numVert; i++) {
      outPos[i * 3] = outMesh.vertProperties[i * numProp];
      outPos[i * 3 + 1] = outMesh.vertProperties[i * numProp + 2];
      outPos[i * 3 + 2] = -outMesh.vertProperties[i * numProp + 1];
    }
    const res = createCompatGeometry(outPos, null, new Uint32Array(outMesh.triVerts), null, THREE);
    res.computeVertexNormals?.();
    res.computeBoundingBox?.();
    return res;
  } catch (_) {
    return geom;
  } finally {
    if (g !== geom) g.dispose?.();
    scope.dispose();
  }
}
