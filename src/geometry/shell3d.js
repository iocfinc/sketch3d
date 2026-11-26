/**
 * SKETCH3D — 3D Shelling & Vase-Mode Geometry Kernel
 * ===================================================
 * 2D inward offset polygon calculations, true 3D hollow vessel shelling,
 * and Vase-Mode Solid Proxy generator.
 */

import { createCompatGeometry } from './openWeaveMesh.js';

/**
 * Calculates 2D polygon signed area. Positive = CCW, Negative = CW.
 * @param {Array<{x: number, y: number}>} pts
 * @returns {number}
 */
export function polyArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return a * 0.5;
}

/**
 * Computes an inward offset polygon at a specified wall thickness.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} thickness
 * @returns {Array<{x: number, y: number}>|null}
 */
export function computeShellInner(pts, thickness) {
  if (!pts || pts.length < 3 || thickness <= 0) return null;
  const area = polyArea(pts);
  if (Math.abs(area) < 4) return null;

  const ccw = area > 0;
  const n = pts.length;
  const lines = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return null;

    const nx = ccw ? -dy / len : dy / len;
    const ny = ccw ? dx / len : -dx / len;
    lines.push({
      x1: a.x + nx * thickness,
      y1: a.y + ny * thickness,
      x2: b.x + nx * thickness,
      y2: b.y + ny * thickness
    });
  }

  const inner = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const a1 = l1.y2 - l1.y1, b1 = l1.x1 - l1.x2, c1 = a1 * l1.x1 + b1 * l1.y1;
    const a2 = l2.y2 - l2.y1, b2 = l2.x1 - l2.x2, c2 = a2 * l2.x1 + b2 * l2.y1;
    const det = a1 * b2 - a2 * b1;

    if (Math.abs(det) < 1e-5) {
      inner.push({ x: l2.x1, y: l2.y1 });
    } else {
      let ix = (b2 * c1 - b1 * c2) / det;
      let iy = (a1 * c2 - a2 * c1) / det;
      const orig = pts[i];
      const dist = Math.hypot(ix - orig.x, iy - orig.y);
      if (dist > thickness * 2.2) {
        const s = (thickness * 2.2) / dist;
        ix = orig.x + (ix - orig.x) * s;
        iy = orig.y + (iy - orig.y) * s;
      }
      inner.push({ x: ix, y: iy });
    }
  }

  const innerArea = polyArea(inner);
  if (Math.abs(innerArea) < 4 || (innerArea > 0) !== ccw) return null;
  return inner;
}

/**
 * Triangulates a simple 2D polygon using ear-clipping.
 * Returns array of triangle index triples [i, j, k].
 * @param {Array<{x: number, y: number}>} pts
 * @returns {Array<[number, number, number]>}
 */
export function triangulatePolygon2D(pts) {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  const indices = [];
  for (let i = 0; i < n; i++) indices.push(i);

  const area = polyArea(pts);
  const isCCW = area > 0;
  const triangles = [];

  let count = n;
  let attempts = 0;
  const maxAttempts = count * 2 + 10;
  let curr = 0;

  function isEar(u, v, w) {
    const a = pts[u];
    const b = pts[v];
    const c = pts[w];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (isCCW ? cross <= 1e-7 : cross >= -1e-7) return false;

    // Check if any other point is inside triangle abc
    for (let k = 0; k < indices.length; k++) {
      const pIdx = indices[k];
      if (pIdx === u || pIdx === v || pIdx === w) continue;
      const p = pts[pIdx];
      if (pointInsideTriangle(p, a, b, c)) return false;
    }
    return true;
  }

  while (count > 2 && attempts < maxAttempts) {
    attempts++;
    const prev = (curr - 1 + count) % count;
    const next = (curr + 1) % count;

    const u = indices[prev];
    const v = indices[curr];
    const w = indices[next];

    if (isEar(u, v, w)) {
      triangles.push([u, v, w]);
      indices.splice(curr, 1);
      count--;
      curr = prev % count;
      attempts = 0;
    } else {
      curr = (curr + 1) % count;
    }
  }

  // Fallback fan if ear clipping stalled due to numerical jitter
  if (triangles.length < n - 2) {
    triangles.length = 0;
    for (let i = 1; i < n - 1; i++) {
      triangles.push([0, i, i + 1]);
    }
  }

  return triangles;
}

function pointInsideTriangle(p, a, b, c) {
  const c1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const c2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const c3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0);
}

/**
 * Computes 2D geometric centroid of polygon using signed area formula.
 * @param {Array<{x: number, y: number}>} pts
 * @returns {{x: number, y: number}}
 */
export function computePolygonCentroid2D(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  const n = pts.length;
  if (n === 1) return { x: pts[0].x, y: pts[0].y };
  if (n === 2) return { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
  let aFactor = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const cross = p0.x * p1.y - p1.x * p0.y;
    aFactor += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  const sArea = aFactor * 0.5;
  if (Math.abs(sArea) > 1e-4) {
    const inv6A = 1.0 / (6.0 * sArea);
    return { x: cx * inv6A, y: cy * inv6A };
  }
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += pts[i].x; sy += pts[i].y; }
  return { x: sx / n, y: sy / n };
}

/**
 * Normalizes 2D points into lathe profile coordinates (r, y).
 * If profile straddles X = 0 (minX < 0 && maxX > 0), shifts r = pt.x - minX
 * so inner edge aligns on r = 0 axis rather than self-intersecting / folding.
 * Otherwise uses r = Math.abs(pt.x).
 * @param {Array<{x: number, y: number}>} pts
 * @returns {Array<{r: number, y: number}>}
 */
export function normalizeLatheProfile2D(pts) {
  if (!pts || pts.length === 0) return [];
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].x > maxX) maxX = pts[i].x;
  }
  const straddlesAxis = minX < -0.01 && maxX > 0.01;
  return pts.map(pt => ({
    r: Math.max(0.5, straddlesAxis ? pt.x - minX : Math.abs(pt.x)),
    y: Math.max(0, -pt.y + 50)
  }));
}

/**
 * Subdivides polygon segments so that no edge exceeds maxStepMm.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} [maxStepMm=1.2]
 * @returns {Array<{x: number, y: number}>}
 */
export function subdividePolygon2D(pts, maxStepMm = 1.2) {
  if (!pts || pts.length < 3) return pts || [];
  const result = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    result.push({ x: p0.x, y: p0.y });
    if (len > maxStepMm) {
      const steps = Math.ceil(len / maxStepMm);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push({ x: p0.x + dx * t, y: p0.y + dy * t });
      }
    }
  }
  return result;
}

/**
 * Subdivides lathe profile points so that segment length <= maxStepMm.
 * @param {Array<{r: number, y: number, isOuter?: boolean}>} pts
 * @param {number} [maxStepMm=1.0]
 * @returns {Array<{r: number, y: number, isOuter?: boolean}>}
 */
export function subdivideLatheProfile2D(pts, maxStepMm = 1.0) {
  if (!pts || pts.length < 2) return pts || [];
  const result = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dr = p1.r - p0.r, dy = p1.y - p0.y;
    const len = Math.hypot(dr, dy);
    result.push({ ...p0 });
    if (len > maxStepMm) {
      const steps = Math.ceil(len / maxStepMm);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push({
          r: p0.r + dr * t,
          y: p0.y + dy * t,
          isOuter: p0.isOuter !== undefined ? (p0.isOuter && p1.isOuter) : true
        });
      }
    }
  }
  result.push({ ...pts[n - 1] });
  return result;
}

/**
 * Builds a 3D hollow extrude vessel (solid bottom floor, open top rim) or open lampshade.
 * @param {Array<{x: number, y: number}>} outerPts
 * @param {Array<{x: number, y: number}>} innerPts
 * @param {number} height
 * @param {number} floorThickness
 * @param {number} [twistDeg=0]
 * @param {boolean} [isLampshade=false]
 * @param {Object} [options={}]
 * @returns {THREE.BufferGeometry}
 */
export function buildHollowExtrudeGeometry(outerPts, innerPts, height, floorThickness, twistDeg = 0, isLampshade = false, options = {}, THREE = globalThis.THREE) {
  const { texturePattern = 'none', textureFreq = 24 } = options;
  const hasTex = texturePattern && texturePattern !== 'none';
  const H = Math.max(1, height);
  const floorT = isLampshade ? 0 : Math.min(H * 0.9, Math.max(0.8, floorThickness));
  const numSteps = (twistDeg > 0 || hasTex) ? Math.max(24, Math.round(H / 1.0)) : 1;
  const twistRad = (twistDeg * Math.PI) / 180;

  // Subdivide outer and inner perimeter edges synchronously for surface texturing
  let curOuter = outerPts;
  let curInner = innerPts;
  if (hasTex && outerPts && innerPts && outerPts.length === innerPts.length) {
    let perimeter = 0;
    const n = outerPts.length;
    for (let i = 0; i < n; i++) {
      perimeter += Math.hypot(outerPts[(i + 1) % n].x - outerPts[i].x, outerPts[(i + 1) % n].y - outerPts[i].y);
    }
    const maxStepMm = Math.max(0.4, Math.min(1.2, perimeter / Math.max(48, (textureFreq || 24) * 4)));
    const subOut = [];
    const subIn = [];
    for (let i = 0; i < n; i++) {
      const o0 = outerPts[i], o1 = outerPts[(i + 1) % n];
      const in0 = innerPts[i], in1 = innerPts[(i + 1) % n];
      const dOx = o1.x - o0.x, dOy = o1.y - o0.y;
      const dInX = in1.x - in0.x, dInY = in1.y - in0.y;
      const len = Math.hypot(dOx, dOy);
      const steps = Math.max(1, Math.ceil(len / maxStepMm));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        subOut.push({ x: o0.x + dOx * t, y: o0.y + dOy * t });
        subIn.push({ x: in0.x + dInX * t, y: in0.y + dInY * t });
      }
    }
    curOuter = subOut;
    curInner = subIn;
  }

  const positions = [];
  const normals = [];
  const masks = [];

  // Centroid-Anchored Twist: rotate relative to 2D polygon geometric centroid
  const centroid = computePolygonCentroid2D(curOuter);
  const cx3d = centroid.x;
  const cz3d = -centroid.y;

  function twistPt(x, y, z) {
    if (twistDeg === 0) return [x, y, z];
    const angle = (Math.max(0, y) / H) * twistRad;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rx = x - cx3d;
    const rz = z - cz3d;
    return [rx * cosA - rz * sinA + cx3d, y, rx * sinA + rz * cosA + cz3d];
  }

  function computeNormal(pA, pB, pC) {
    const cb = [pC[0] - pB[0], pC[1] - pB[1], pC[2] - pB[2]];
    const ab = [pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]];
    const n = [cb[1] * ab[2] - cb[2] * ab[1], cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  }

  function addQuad(p00, p10, p11, p01, maskVal = 0.0) {
    positions.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    const [nx, ny, nz] = computeNormal(p00, p10, p11);
    for (let k = 0; k < 6; k++) { normals.push(nx, ny, nz); masks.push(maskVal); }
  }

  function addTri(pA, pB, pC, maskVal = 0.0) {
    positions.push(...pA, ...pB, ...pC);
    const [nx, ny, nz] = computeNormal(pA, pB, pC);
    for (let k = 0; k < 3; k++) { normals.push(nx, ny, nz); masks.push(maskVal); }
  }

  const nOut = curOuter.length;
  const nIn = curInner.length;
  const outerCCW = polyArea(curOuter) > 0;

  // 1. Bottom Floor Cap or Annular Rim at Y = 0
  if (isLampshade) {
    for (let i = 0; i < nOut; i++) {
      const outA = curOuter[i], outB = curOuter[(i + 1) % nOut];
      const inA = curInner[i % nIn], inB = curInner[(i + 1) % nIn];
      const pOutA = twistPt(outA.x, 0, -outA.y), pOutB = twistPt(outB.x, 0, -outB.y);
      const pInA = twistPt(inA.x, 0, -inA.y), pInB = twistPt(inB.x, 0, -inB.y);
      if (outerCCW) { addTri(pOutA, pInB, pOutB); addTri(pOutA, pInA, pInB); }
      else { addTri(pOutA, pOutB, pInB); addTri(pOutA, pInB, pInA); }
    }
  } else {
    triangulatePolygon2D(curOuter).forEach(([i, j, k]) => {
      const pA = twistPt(curOuter[i].x, 0, -curOuter[i].y);
      const pB = twistPt(curOuter[j].x, 0, -curOuter[j].y);
      const pC = twistPt(curOuter[k].x, 0, -curOuter[k].y);
      if (outerCCW) addTri(pA, pC, pB); else addTri(pA, pB, pC);
    });
  }

  // 2. Outer Side Walls (Y = 0 to H) - mask = 1.0
  for (let s = 0; s < numSteps; s++) {
    const y0 = (s / numSteps) * H;
    const y1 = ((s + 1) / numSteps) * H;
    for (let i = 0; i < nOut; i++) {
      const a = curOuter[i], b = curOuter[(i + 1) % nOut];
      const p00 = twistPt(a.x, y0, -a.y), p10 = twistPt(b.x, y0, -b.y);
      const p11 = twistPt(b.x, y1, -b.y), p01 = twistPt(a.x, y1, -a.y);
      if (outerCCW) addQuad(p00, p10, p11, p01, 1.0);
      else addQuad(p00, p01, p11, p10, 1.0);
    }
  }

  // 3. Top Rim Annular Cap at Y = H (Normal Up [0, 1, 0])
  for (let i = 0; i < nOut; i++) {
    const outA = curOuter[i], outB = curOuter[(i + 1) % nOut];
    const inA = curInner[i % nIn], inB = curInner[(i + 1) % nIn];
    const pOutA = twistPt(outA.x, H, -outA.y), pOutB = twistPt(outB.x, H, -outB.y);
    const pInA = twistPt(inA.x, H, -inA.y), pInB = twistPt(inB.x, H, -inB.y);
    if (outerCCW) { addTri(pOutA, pOutB, pInB); addTri(pOutA, pInB, pInA); }
    else { addTri(pOutA, pInB, pOutB); addTri(pOutA, pInA, pInB); }
  }

  // 4. Inner Side Walls (Y = H down to floorT / 0, Normals face inward)
  const bottomInnerY = isLampshade ? 0 : floorT;
  const innerSteps = twistDeg > 0 ? Math.max(8, Math.round((H - bottomInnerY) / 3)) : 1;
  for (let s = 0; s < innerSteps; s++) {
    const y0 = H - (s / innerSteps) * (H - bottomInnerY);
    const y1 = H - ((s + 1) / innerSteps) * (H - bottomInnerY);
    for (let i = 0; i < nIn; i++) {
      const a = curInner[i], b = curInner[(i + 1) % nIn];
      const p00 = twistPt(a.x, y0, -a.y), p10 = twistPt(b.x, y0, -b.y);
      const p11 = twistPt(b.x, y1, -b.y), p01 = twistPt(a.x, y1, -a.y);
      if (outerCCW) addQuad(p00, p01, p11, p10);
      else addQuad(p00, p10, p11, p01);
    }
  }

  // 5. Interior Floor Cap at Y = floorT (Omitted for open lampshades)
  if (!isLampshade) {
    triangulatePolygon2D(curInner).forEach(([i, j, k]) => {
      const pA = twistPt(curInner[i].x, floorT, -curInner[i].y);
      const pB = twistPt(curInner[j].x, floorT, -curInner[j].y);
      const pC = twistPt(curInner[k].x, floorT, -curInner[k].y);
      if (outerCCW) addTri(pA, pB, pC); else addTri(pA, pC, pB);
    });
  }

  const geom = createCompatGeometry(positions, normals, null, masks, THREE);
  geom.computeVertexNormals();
  return geom;
}

/** Builds profile points for LatheGeometry for hollow open-top revolve vessel or open lampshade. */
export function buildHollowLatheProfile(pts, shellThickness, isLampshade = false, subdivideOuter = false, THREE = globalThis.THREE) {
  if (!pts || pts.length < 2) return [];
  const thickness = Math.max(0.4, shellThickness || 1.2);
  let sorted = normalizeLatheProfile2D(pts).sort((a, b) => a.y - b.y);
  if (subdivideOuter) {
    sorted = subdivideLatheProfile2D(sorted, 1.0);
  }

  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;
  const H = Math.max(1, maxY - minY);
  const floorT = Math.min(H * 0.9, Math.max(0.8, thickness));
  const latheProfile = [];

  const addPt = (r, y, isOuter = false) => {
    const v = THREE?.Vector2 ? new THREE.Vector2(r, y) : { x: r, y, clone() { return { x: this.x, y: this.y, isOuter: this.isOuter, clone: this.clone }; } };
    v.isOuter = isOuter;
    latheProfile.push(v);
  };

  if (isLampshade) {
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
 * Accurately calculates estimated filament mass for Spiral Vase mode.
 * Perimeter * height * 0.42mm wall width + floor mass.
 * @param {number} perimeterMm
 * @param {number} heightMm
 * @param {number} floorAreaMm2
 * @returns {number} filament mass in grams (PLA 1.24 g/cm3)
 */
export function calculateVaseModeMass(perimeterMm, heightMm, floorAreaMm2 = 0) {
  const wallVolMm3 = Math.max(0, perimeterMm) * Math.max(1, heightMm) * 0.42;
  const floorVolMm3 = Math.max(0, floorAreaMm2) * 0.8;
  const totalVolMm3 = wallVolMm3 + floorVolMm3;
  return (totalVolMm3 / 1000) * 1.24;
}
