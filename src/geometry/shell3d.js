/**
 * SKETCH3D — 3D Shelling & Vase-Mode Geometry Kernel
 * ===================================================
 * 2D inward offset polygon calculations, true 3D hollow vessel shelling
 * (outer wall, inward-offset inner wall, solid floor, stitched top annular rim),
 * and Vase-Mode Solid Proxy generator.
 */

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
    const a1 = l1.y2 - l1.y1;
    const b1 = l1.x1 - l1.x2;
    const c1 = a1 * l1.x1 + b1 * l1.y1;
    const a2 = l2.y2 - l2.y1;
    const b2 = l2.x1 - l2.x2;
    const c2 = a2 * l2.x1 + b2 * l2.y1;
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
export function buildHollowExtrudeGeometry(outerPts, innerPts, height, floorThickness, twistDeg = 0, isLampshade = false, options = {}) {
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
      const o0 = outerPts[i];
      const o1 = outerPts[(i + 1) % n];
      const in0 = innerPts[i];
      const in1 = innerPts[(i + 1) % n];
      const dOx = o1.x - o0.x;
      const dOy = o1.y - o0.y;
      const dInX = in1.x - in0.x;
      const dInY = in1.y - in0.y;
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

  function twistPt(x, y, z) {
    if (twistDeg === 0) return [x, y, z];
    const angle = (Math.max(0, y) / H) * twistRad;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return [x * cosA - z * sinA, y, x * sinA + z * cosA];
  }

  function addQuad(p00, p10, p11, p01, maskVal = 0.0) {
    positions.push(...p00, ...p10, ...p11);
    positions.push(...p00, ...p11, ...p01);

    const cb1 = [p11[0] - p10[0], p11[1] - p10[1], p11[2] - p10[2]];
    const ab1 = [p00[0] - p10[0], p00[1] - p10[1], p00[2] - p10[2]];
    const n = [
      cb1[1] * ab1[2] - cb1[2] * ab1[1],
      cb1[2] * ab1[0] - cb1[0] * ab1[2],
      cb1[0] * ab1[1] - cb1[1] * ab1[0]
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / len;
    const ny = n[1] / len;
    const nz = n[2] / len;

    for (let k = 0; k < 6; k++) {
      normals.push(nx, ny, nz);
      masks.push(maskVal);
    }
  }

  function addTri(pA, pB, pC, maskVal = 0.0) {
    positions.push(...pA, ...pB, ...pC);
    const cb = [pC[0] - pB[0], pC[1] - pB[1], pC[2] - pB[2]];
    const ab = [pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]];
    const n = [
      cb[1] * ab[2] - cb[2] * ab[1],
      cb[2] * ab[0] - cb[0] * ab[2],
      cb[0] * ab[1] - cb[1] * ab[0]
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / len;
    const ny = n[1] / len;
    const nz = n[2] / len;
    for (let k = 0; k < 3; k++) {
      normals.push(nx, ny, nz);
      masks.push(maskVal);
    }
  }

  const nOut = curOuter.length;
  const nIn = curInner.length;
  const outerCCW = polyArea(curOuter) > 0;

  // 1. Bottom Floor Cap or Annular Rim at Y = 0
  if (isLampshade) {
    for (let i = 0; i < nOut; i++) {
      const outA = curOuter[i];
      const outB = curOuter[(i + 1) % nOut];
      const inA = curInner[i % nIn];
      const inB = curInner[(i + 1) % nIn];
      const pOutA = twistPt(outA.x, 0, -outA.y);
      const pOutB = twistPt(outB.x, 0, -outB.y);
      const pInA = twistPt(inA.x, 0, -inA.y);
      const pInB = twistPt(inB.x, 0, -inB.y);
      if (outerCCW) {
        addTri(pOutA, pInB, pOutB);
        addTri(pOutA, pInA, pInB);
      } else {
        addTri(pOutA, pOutB, pInB);
        addTri(pOutA, pInB, pInA);
      }
    }
  } else {
    const outerTris = triangulatePolygon2D(curOuter);
    outerTris.forEach(([i, j, k]) => {
      const pA = twistPt(curOuter[i].x, 0, -curOuter[i].y);
      const pB = twistPt(curOuter[j].x, 0, -curOuter[j].y);
      const pC = twistPt(curOuter[k].x, 0, -curOuter[k].y);
      if (outerCCW) addTri(pA, pC, pB);
      else addTri(pA, pB, pC);
    });
  }

  // 2. Outer Side Walls (Y = 0 to H) - mask = 1.0
  for (let s = 0; s < numSteps; s++) {
    const y0 = (s / numSteps) * H;
    const y1 = ((s + 1) / numSteps) * H;
    for (let i = 0; i < nOut; i++) {
      const a = curOuter[i];
      const b = curOuter[(i + 1) % nOut];
      const p00 = twistPt(a.x, y0, -a.y);
      const p10 = twistPt(b.x, y0, -b.y);
      const p11 = twistPt(b.x, y1, -b.y);
      const p01 = twistPt(a.x, y1, -a.y);
      if (outerCCW) addQuad(p00, p10, p11, p01, 1.0);
      else addQuad(p00, p01, p11, p10, 1.0);
    }
  }

  // 3. Top Rim Annular Cap at Y = H (Normal Up [0, 1, 0])
  for (let i = 0; i < nOut; i++) {
    const outA = curOuter[i];
    const outB = curOuter[(i + 1) % nOut];
    const inA = curInner[i % nIn];
    const inB = curInner[(i + 1) % nIn];
    const pOutA = twistPt(outA.x, H, -outA.y);
    const pOutB = twistPt(outB.x, H, -outB.y);
    const pInA = twistPt(inA.x, H, -inA.y);
    const pInB = twistPt(inB.x, H, -inB.y);
    if (outerCCW) {
      addTri(pOutA, pOutB, pInB);
      addTri(pOutA, pInB, pInA);
    } else {
      addTri(pOutA, pInB, pOutB);
      addTri(pOutA, pInA, pInB);
    }
  }

  // 4. Inner Side Walls (Y = H down to floorT / 0, Normals face inward)
  const bottomInnerY = isLampshade ? 0 : floorT;
  const innerSteps = twistDeg > 0 ? Math.max(8, Math.round((H - bottomInnerY) / 3)) : 1;
  for (let s = 0; s < innerSteps; s++) {
    const y0 = H - (s / innerSteps) * (H - bottomInnerY);
    const y1 = H - ((s + 1) / innerSteps) * (H - bottomInnerY);
    for (let i = 0; i < nIn; i++) {
      const a = curInner[i];
      const b = curInner[(i + 1) % nIn];
      const p00 = twistPt(a.x, y0, -a.y);
      const p10 = twistPt(b.x, y0, -b.y);
      const p11 = twistPt(b.x, y1, -b.y);
      const p01 = twistPt(a.x, y1, -a.y);
      if (outerCCW) addQuad(p00, p01, p11, p10);
      else addQuad(p00, p10, p11, p01);
    }
  }

  // 5. Interior Floor Cap at Y = floorT (Omitted for open lampshades)
  if (!isLampshade) {
    const innerTris = triangulatePolygon2D(curInner);
    innerTris.forEach(([i, j, k]) => {
      const pA = twistPt(curInner[i].x, floorT, -curInner[i].y);
      const pB = twistPt(curInner[j].x, floorT, -curInner[j].y);
      const pC = twistPt(curInner[k].x, floorT, -curInner[k].y);
      if (outerCCW) addTri(pA, pB, pC);
      else addTri(pA, pC, pB);
    });
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('aOuterWallMask', new THREE.Float32BufferAttribute(masks, 1));
  geom.computeBoundingBox();
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds profile points for THREE.LatheGeometry for hollow open-top revolve vessel or open lampshade.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} shellThickness
 * @param {boolean} [isLampshade=false]
 * @returns {Array<THREE.Vector2>}
 */
export function buildHollowLatheProfile(pts, shellThickness, isLampshade = false) {
  if (!pts || pts.length < 2) return [];
  const thickness = Math.max(0.4, shellThickness || 1.2);

  // Profile coordinates: radius r >= 0.5, height y >= 0
  const sorted = pts
    .map(pt => ({ r: Math.max(0.5, Math.abs(pt.x)), y: Math.max(0, -pt.y + 50) }))
    .sort((a, b) => a.y - b.y);

  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;
  const H = Math.max(1, maxY - minY);
  const floorT = Math.min(H * 0.9, Math.max(0.8, thickness));

  const latheProfile = [];

  if (isLampshade) {
    // Open tubular lampshade: outer bottom -> outer wall up -> top rim -> inner wall down -> bottom rim
    const bottomOuter = sorted[0];
    const topOuter = sorted[sorted.length - 1];
    const topInnerR = Math.max(0.5, topOuter.r - thickness);
    const bottomInnerR = Math.max(0.5, bottomOuter.r - thickness);

    // 1. Outer Profile going up from minY to maxY
    for (let i = 0; i < sorted.length; i++) {
      latheProfile.push(new THREE.Vector2(sorted[i].r, sorted[i].y));
    }

    // 2. Top Rim Step Inward
    latheProfile.push(new THREE.Vector2(topInnerR, topOuter.y));

    // 3. Inner Profile going all the way down to minY
    for (let i = sorted.length - 1; i >= 0; i--) {
      const cur = sorted[i];
      const inR = Math.max(0.5, cur.r - thickness);
      latheProfile.push(new THREE.Vector2(inR, cur.y));
    }

    // 4. Bottom Rim Step Outward back to outer bottom (closed 2D loop)
    latheProfile.push(new THREE.Vector2(bottomOuter.r, bottomOuter.y));
  } else {
    // 1. Bottom Center on Axis
    latheProfile.push(new THREE.Vector2(0.01, minY));

    // 2. Outer Profile going up from minY to maxY
    for (let i = 0; i < sorted.length; i++) {
      latheProfile.push(new THREE.Vector2(sorted[i].r, sorted[i].y));
    }

    // 3. Top Rim Step Inward
    const topOuter = sorted[sorted.length - 1];
    const topInnerR = Math.max(0.5, topOuter.r - thickness);
    latheProfile.push(new THREE.Vector2(topInnerR, topOuter.y));

    // 4. Inner Profile going down from maxY to (minY + floorT)
    for (let i = sorted.length - 1; i >= 0; i--) {
      const cur = sorted[i];
      const curY = Math.max(minY + floorT, cur.y);
      const inR = Math.max(0.5, cur.r - thickness);
      latheProfile.push(new THREE.Vector2(inR, curY));
    }

    // 5. Inner Floor to Center Axis
    latheProfile.push(new THREE.Vector2(0.01, minY + floorT));
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
