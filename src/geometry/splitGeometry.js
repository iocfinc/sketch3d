/**
 * SKETCH3D — Pure-JS Split-Body Lip/Groove & Snap-Fit Mesh Builder
 * =================================================================
 * Generates watertight 2-manifold stepped Base (male lip + optional snap-fit nubs)
 * and matching Lid (recessed female groove + optional snap catch detents) from splitMeta.
 */

import { polyArea, computeShellInner, triangulatePolygon2D } from './shell3d.js';
import { createCompatGeometry } from './openWeaveMesh.js';

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

function addWallRing(pos, norm, mask, loopA, loopB, yA, yB, outward, ccw, m = 0) {
  const n = loopA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p00 = [loopA[i].x, yA, -loopA[i].y];
    const p10 = [loopA[j].x, yA, -loopA[j].y];
    const p11 = [loopB[j].x, yB, -loopB[j].y];
    const p01 = [loopB[i].x, yB, -loopB[i].y];
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

function addAnnularCap(pos, norm, mask, outerLoop, innerLoop, y, faceUp, ccw) {
  const n = outerLoop.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const oA = [outerLoop[i].x, y, -outerLoop[i].y];
    const oB = [outerLoop[j].x, y, -outerLoop[j].y];
    const iA = [innerLoop[i].x, y, -innerLoop[i].y];
    const iB = [innerLoop[j].x, y, -innerLoop[j].y];
    const sameOrder = faceUp ? ccw : !ccw;
    if (sameOrder) {
      addTri(pos, norm, mask, oA, oB, iB);
      addTri(pos, norm, mask, oA, iB, iA);
    } else {
      addTri(pos, norm, mask, oA, iB, oB);
      addTri(pos, norm, mask, oA, iA, iB);
    }
  }
}

function addFlatCap(pos, norm, mask, loop, y, faceUp, ccw) {
  const tris = triangulatePolygon2D(loop);
  for (const [i, j, k] of tris) {
    const a = [loop[i].x, y, -loop[i].y];
    const b = [loop[j].x, y, -loop[j].y];
    const c = [loop[k].x, y, -loop[k].y];
    const sameOrder = faceUp ? ccw : !ccw;
    if (sameOrder) addTri(pos, norm, mask, a, b, c);
    else addTri(pos, norm, mask, a, c, b);
  }
}

/**
 * Builds watertight Base Lip or Lid Groove geometry from part.splitMeta.
 * When snapFit is enabled, embeds a concentric stepped detent bead on base_lip
 * paired with an aligned recessed catch groove on lid_groove.
 * @param {Object} part
 * @param {Array<{x:number,y:number}>} outerPts
 * @param {any} [THREE]
 * @returns {any|null}
 */
export function buildSplitPartGeometry(part, outerPts, THREE = globalThis.THREE) {
  const meta = part?.splitMeta;
  if (!meta || !outerPts || outerPts.length < 3) return null;

  const H = Math.max(2, Number(part.extrudeHeight || 20));
  const wallT = Math.max(1.6, Number(meta.wallThicknessMm || part.shellThickness || 2.4));
  const clearance = Math.max(0.05, Math.min(1.0, Number(meta.lipToleranceMm ?? 0.20)));
  const lipH = Math.min(H * 0.45, Math.max(1.0, Number(meta.lipHeightMm || 3.0)));
  const step = wallT * 0.5;
  const floorT = Math.min(H * 0.3, Math.max(0.8, Number(part.floorThickness || wallT)));

  const innerPts = computeShellInner(outerPts, wallT);
  if (!innerPts || innerPts.length !== outerPts.length) return null;

  const pos = [];
  const norm = [];
  const mask = [];
  const ccw = polyArea(outerPts) > 0;
  const snapZ0 = lipH * 0.35;
  const snapZ1 = lipH * 0.72;

  if (meta.role === 'base_lip') {
    const splitY = Math.max(floorT + 0.5, H - lipH);
    const lipOuterPts = computeShellInner(outerPts, step + clearance * 0.5);
    if (!lipOuterPts || lipOuterPts.length !== outerPts.length) return null;
    const beadOut = Math.min(0.12, clearance * 0.6);
    const lipBeadPts = meta.snapFit ? computeShellInner(outerPts, Math.max(0.4, step + clearance * 0.5 - beadOut)) : null;

    addFlatCap(pos, norm, mask, outerPts, 0, false, ccw);
    addWallRing(pos, norm, mask, outerPts, outerPts, 0, splitY, true, ccw, 1.0);
    addAnnularCap(pos, norm, mask, outerPts, lipOuterPts, splitY, true, ccw);
    if (lipBeadPts && lipBeadPts.length === outerPts.length) {
      const bz0 = splitY + snapZ0;
      const bz1 = splitY + snapZ1;
      addWallRing(pos, norm, mask, lipOuterPts, lipOuterPts, splitY, bz0, true, ccw, 0.0);
      addAnnularCap(pos, norm, mask, lipBeadPts, lipOuterPts, bz0, false, ccw);
      addWallRing(pos, norm, mask, lipBeadPts, lipBeadPts, bz0, bz1, true, ccw, 0.0);
      addAnnularCap(pos, norm, mask, lipBeadPts, lipOuterPts, bz1, true, ccw);
      addWallRing(pos, norm, mask, lipOuterPts, lipOuterPts, bz1, H, true, ccw, 0.0);
    } else {
      addWallRing(pos, norm, mask, lipOuterPts, lipOuterPts, splitY, H, true, ccw, 0.0);
    }
    addAnnularCap(pos, norm, mask, lipOuterPts, innerPts, H, true, ccw);
    addWallRing(pos, norm, mask, innerPts, innerPts, floorT, H, false, ccw, 0.0);
    addFlatCap(pos, norm, mask, innerPts, floorT, true, ccw);
  } else if (meta.role === 'lid_groove') {
    const grooveInnerPts = computeShellInner(outerPts, step - clearance * 0.5);
    if (!grooveInnerPts || grooveInnerPts.length !== outerPts.length) return null;
    const roofBottomY = Math.max(lipH + 0.8, H - floorT);
    const catchExtra = Math.min(0.25, step * 0.35);
    const grooveCatchPts = meta.snapFit
      ? computeShellInner(outerPts, Math.max(0.35, step - clearance * 0.5 - catchExtra))
      : null;

    addAnnularCap(pos, norm, mask, outerPts, grooveInnerPts, 0, false, ccw);
    addWallRing(pos, norm, mask, outerPts, outerPts, 0, H, true, ccw, 1.0);
    addFlatCap(pos, norm, mask, outerPts, H, true, ccw);
    if (grooveCatchPts && grooveCatchPts.length === outerPts.length) {
      const cz0 = Math.max(0.3, snapZ0 - 0.08);
      const cz1 = Math.min(lipH - 0.25, snapZ1 + 0.08);
      addWallRing(pos, norm, mask, grooveInnerPts, grooveInnerPts, 0, cz0, false, ccw, 0.0);
      addAnnularCap(pos, norm, mask, grooveCatchPts, grooveInnerPts, cz0, true, ccw);
      addWallRing(pos, norm, mask, grooveCatchPts, grooveCatchPts, cz0, cz1, false, ccw, 0.0);
      addAnnularCap(pos, norm, mask, grooveCatchPts, grooveInnerPts, cz1, false, ccw);
      addWallRing(pos, norm, mask, grooveInnerPts, grooveInnerPts, cz1, lipH, false, ccw, 0.0);
    } else {
      addWallRing(pos, norm, mask, grooveInnerPts, grooveInnerPts, 0, lipH, false, ccw, 0.0);
    }
    addAnnularCap(pos, norm, mask, grooveInnerPts, innerPts, lipH, false, ccw);
    addWallRing(pos, norm, mask, innerPts, innerPts, lipH, roofBottomY, false, ccw, 0.0);
    addFlatCap(pos, norm, mask, innerPts, roofBottomY, false, ccw);
  } else {
    return null;
  }

  const geom = createCompatGeometry(pos, norm, null, mask, THREE);
  if (part.baseZ > 0) geom.translate(0, part.baseZ, 0);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
