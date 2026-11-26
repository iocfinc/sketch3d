/**
 * SKETCH3D — Pure-JS Compat BufferGeometry & Physical Open-Aperture Basket-Weave Kernel
 * ====================================================================================
 * Watertight 2-manifold open-aperture basket-weave mesh builder, manifold topology
 * verifier, radial aperture raytracer, and pure-JS BufferGeometry compatibility layer.
 */

export const OPEN_WEAVE_DEFAULTS = {
  weaveBands: 2.5,
  weaveGapMm: 0.8,
  weavePillars: 16,
  weaveTwistDeg: 0,
  wallThicknessMm: 2.0,
  rimMarginMm: 4.0
};

class CompatBufferAttribute {
  constructor(array, itemSize = 3) {
    this.array = array instanceof Float32Array || array instanceof Uint32Array || array instanceof Uint16Array
      ? array : new Float32Array(array || 0);
    this.itemSize = itemSize;
    this.count = Math.floor(this.array.length / itemSize);
    this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setX(i, v) { this.array[i * this.itemSize] = v; }
  setY(i, v) { this.array[i * this.itemSize + 1] = v; }
  setZ(i, v) { this.array[i * this.itemSize + 2] = v; }
  clone() { return new CompatBufferAttribute(new this.array.constructor(this.array), this.itemSize); }
}

class CompatBufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.boundingBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(idx) {
    this.index = Array.isArray(idx) ? new CompatBufferAttribute(new Uint32Array(idx), 1) : idx;
    return this;
  }
  computeBoundingBox() {
    const pos = this.attributes.position;
    if (!pos || pos.count === 0) {
      this.boundingBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
      return this.boundingBox;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.boundingBox = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    return this.boundingBox;
  }
  computeVertexNormals() {
    const pos = this.attributes.position;
    if (!pos || pos.count === 0) return;
    const norms = new Float32Array(pos.count * 3);
    const idx = this.index ? this.index.array : null;
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
      const cbx = cx - bx, cby = cy - by, cbz = cz - bz, abx = ax - bx, aby = ay - by, abz = az - bz;
      const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
      for (const vi of [i0, i1, i2]) { norms[vi * 3] += nx; norms[vi * 3 + 1] += ny; norms[vi * 3 + 2] += nz; }
    }
    for (let i = 0; i < pos.count; i++) {
      const x = norms[i * 3], y = norms[i * 3 + 1], z = norms[i * 3 + 2], len = Math.hypot(x, y, z) || 1;
      norms[i * 3] = x / len; norms[i * 3 + 1] = y / len; norms[i * 3 + 2] = z / len;
    }
    this.setAttribute('normal', new CompatBufferAttribute(norms, 3));
  }
  translate(dx, dy, dz) {
    const pos = this.attributes.position;
    if (!pos) return this;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + dx); pos.setY(i, pos.getY(i) + dy); pos.setZ(i, pos.getZ(i) + dz);
    }
    pos.needsUpdate = true; this.computeBoundingBox();
    return this;
  }
  scale(sx, sy, sz) {
    const pos = this.attributes.position;
    if (!pos) return this;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) * sx); pos.setY(i, pos.getY(i) * sy); pos.setZ(i, pos.getZ(i) * sz);
    }
    pos.needsUpdate = true; this.computeBoundingBox();
    return this;
  }
  rotateX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle), pos = this.attributes.position;
    if (!pos) return this;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      pos.setY(i, y * c - z * s); pos.setZ(i, y * s + z * c);
    }
    pos.needsUpdate = true; this.computeVertexNormals(); this.computeBoundingBox();
    return this;
  }
  applyMatrix4(mat) {
    const m = mat?.elements || mat?.matrix || mat, pos = this.attributes.position;
    if (!m || m.length < 16 || !pos) return this;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15] || 1);
      pos.setX(i, (m[0] * x + m[4] * y + m[8] * z + m[12]) * w);
      pos.setY(i, (m[1] * x + m[5] * y + m[9] * z + m[13]) * w);
      pos.setZ(i, (m[2] * x + m[6] * y + m[10] * z + m[14]) * w);
    }
    pos.needsUpdate = true; this.computeVertexNormals(); this.computeBoundingBox();
    return this;
  }
  toNonIndexed() {
    if (!this.index) return this.clone();
    const pos = this.attributes.position, idx = this.index.array, out = new Float32Array(idx.length * 3);
    for (let i = 0; i < idx.length; i++) {
      const vi = idx[i];
      out[i * 3] = pos.getX(vi); out[i * 3 + 1] = pos.getY(vi); out[i * 3 + 2] = pos.getZ(vi);
    }
    const g = new CompatBufferGeometry();
    g.setAttribute('position', new CompatBufferAttribute(out, 3));
    g.computeVertexNormals(); g.computeBoundingBox();
    return g;
  }
  clone() {
    const g = new CompatBufferGeometry();
    for (const [k, v] of Object.entries(this.attributes)) g.setAttribute(k, v.clone());
    if (this.index) g.setIndex(this.index.clone());
    g.computeBoundingBox();
    return g;
  }
  dispose() {}
}

/**
 * Pure-JS / Three.js BufferGeometry factory. Works identically in Node (no THREE) or browser.
 */
export function createCompatGeometry(positions, normals = null, indices = null, outerMasks = null, THREE = globalThis.THREE) {
  const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions || 0);
  if (THREE?.BufferGeometry && THREE?.Float32BufferAttribute) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    if (normals && normals.length === posArr.length) {
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals instanceof Float32Array ? normals : new Float32Array(normals), 3));
    }
    if (indices && indices.length > 0) {
      geom.setIndex(new THREE.BufferAttribute(indices instanceof Uint32Array ? indices : new Uint32Array(indices), 1));
    }
    if (outerMasks && outerMasks.length > 0) {
      geom.setAttribute('aOuterWallMask', new THREE.Float32BufferAttribute(outerMasks instanceof Float32Array ? outerMasks : new Float32Array(outerMasks), 1));
    }
    if (!normals) geom.computeVertexNormals();
    geom.computeBoundingBox();
    return geom;
  }
  const geom = new CompatBufferGeometry();
  geom.setAttribute('position', new CompatBufferAttribute(posArr, 3));
  if (normals && normals.length === posArr.length) geom.setAttribute('normal', new CompatBufferAttribute(new Float32Array(normals), 3));
  if (indices && indices.length > 0) geom.setIndex(new CompatBufferAttribute(new Uint32Array(indices), 1));
  if (outerMasks && outerMasks.length > 0) geom.setAttribute('aOuterWallMask', new CompatBufferAttribute(new Float32Array(outerMasks), 1));
  if (!normals) geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}

function buildRadiusEvaluator(points, targetHeight) {
  const pts = (points && points.length >= 2) ? points : [{ x: 32, y: 0 }, { x: 32, y: -targetHeight }];
  let minX = Infinity, maxX = -Infinity;
  for (const pt of pts) { if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x; }
  const straddles = minX < -0.01 && maxX > 0.01;
  const raw = pts.map(pt => ({ r: Math.max(4.0, straddles ? pt.x - minX : Math.abs(pt.x)), y: -pt.y })).sort((a, b) => a.y - b.y);
  const minY = raw[0].y, spanY = Math.max(1, raw[raw.length - 1].y - minY);
  const H = Math.max(8, targetHeight || spanY);
  const norm = raw.map(p => ({ r: p.r, y: ((p.y - minY) / spanY) * H }));
  return {
    height: H,
    radiusAt(y) {
      const yc = Math.max(0, Math.min(H, y));
      for (let i = 0; i < norm.length - 1; i++) {
        const a = norm[i], b = norm[i + 1];
        if (yc <= b.y + 1e-6) {
          const t = Math.abs(b.y - a.y) < 1e-6 ? 0 : (yc - a.y) / (b.y - a.y);
          return a.r + (b.r - a.r) * Math.max(0, Math.min(1, t));
        }
      }
      return norm[norm.length - 1].r;
    }
  };
}

function pushTri(positions, indices, a, b, c) {
  const base = positions.length / 3;
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  indices.push(base, base + 1, base + 2);
}

function appendClosedAnnularRing(positions, indices, y0, y1, rIn0, rOut0, rIn1, rOut1, segs, amp = 0, lobes = 8, phase = 0) {
  const verts = [];
  for (let j = 0; j < segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    const wave = amp !== 0 ? amp * Math.cos(lobes * (th - phase)) : 0;
    const c = Math.cos(th), s = -Math.sin(th);
    const ri0 = Math.max(1.0, rIn0 + wave), ro0 = Math.max(ri0 + 0.6, rOut0 + wave);
    const ri1 = Math.max(1.0, rIn1 + wave), ro1 = Math.max(ri1 + 0.6, rOut1 + wave);
    verts.push([[ri0 * c, y0, ri0 * s], [ro0 * c, y0, ro0 * s], [ro1 * c, y1, ro1 * s], [ri1 * c, y1, ri1 * s]]);
  }
  for (let j = 0; j < segs; j++) {
    const cur = verts[j], nxt = verts[(j + 1) % segs];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      pushTri(positions, indices, cur[k], nxt[k], nxt[k2]);
      pushTri(positions, indices, cur[k], nxt[k2], cur[k2]);
    }
  }
}

function appendClosedWarpPillar(positions, indices, radiusAt, yStart, yEnd, wallT, baseTheta, twistRad, widthRad, steps, H) {
  const loops = [];
  for (let s = 0; s <= steps; s++) {
    const y = yStart + (yEnd - yStart) * (s / steps);
    const rOut = radiusAt(y), rIn = Math.max(1.0, rOut - wallT);
    const thC = baseTheta + (y / H) * twistRad, thA = thC - widthRad * 0.5, thB = thC + widthRad * 0.5;
    loops.push([
      [rIn * Math.cos(thA), y, -rIn * Math.sin(thA)],
      [rOut * Math.cos(thA), y, -rOut * Math.sin(thA)],
      [rOut * Math.cos(thB), y, -rOut * Math.sin(thB)],
      [rIn * Math.cos(thB), y, -rIn * Math.sin(thB)]
    ]);
  }
  for (let s = 0; s < steps; s++) {
    const cur = loops[s], nxt = loops[s + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      pushTri(positions, indices, cur[k], nxt[k2], nxt[k]);
      pushTri(positions, indices, cur[k], cur[k2], nxt[k2]);
    }
  }
  // Caps oriented opposite to side boundary edges (bot faces -Y, top faces +Y)
  const bot = loops[0], top = loops[steps];
  pushTri(positions, indices, bot[0], bot[2], bot[1]);
  pushTri(positions, indices, bot[0], bot[3], bot[2]);
  pushTri(positions, indices, top[0], top[1], top[2]);
  pushTri(positions, indices, top[0], top[2], top[3]);
}

/**
 * Builds a watertight 2-manifold physical open-aperture basket-weave shell.
 */
export function buildOpenWeaveMesh(part = {}, THREE = globalThis.THREE) {
  const weaveBands = Math.max(1.2, Number(part.weaveBands ?? OPEN_WEAVE_DEFAULTS.weaveBands));
  const weaveGapMm = Math.max(0.3, Number(part.weaveGapMm ?? OPEN_WEAVE_DEFAULTS.weaveGapMm));
  const weavePillars = Math.max(4, Math.round(Number(part.weavePillars ?? OPEN_WEAVE_DEFAULTS.weavePillars)));
  const weaveTwistDeg = Number(part.weaveTwistDeg ?? OPEN_WEAVE_DEFAULTS.weaveTwistDeg);
  const wallT = Math.max(0.8, Number(part.wallThicknessMm ?? part.shellThickness ?? OPEN_WEAVE_DEFAULTS.wallThicknessMm));
  const { height: H, radiusAt } = buildRadiusEvaluator(part.points, part.extrudeHeight || 110);
  const rimH = Math.min(H * 0.22, Math.max(1.5, Number(part.rimMarginMm ?? OPEN_WEAVE_DEFAULTS.rimMarginMm)));

  const positions = [], indices = [];
  const radialSegs = Math.max(48, weavePillars * 3);

  appendClosedAnnularRing(positions, indices, 0, rimH, Math.max(1, radiusAt(0) - wallT), radiusAt(0), Math.max(1, radiusAt(rimH) - wallT), radiusAt(rimH), radialSegs);
  appendClosedAnnularRing(positions, indices, H - rimH, H, Math.max(1, radiusAt(H - rimH) - wallT), radiusAt(H - rimH), Math.max(1, radiusAt(H) - wallT), radiusAt(H), radialSegs);

  const midStart = rimH + weaveGapMm, midEnd = H - rimH - weaveGapMm;
  const pitch = Math.max(weaveBands, weaveGapMm + 0.8), bandH = Math.max(0.7, pitch - weaveGapMm);
  const twistRad = (weaveTwistDeg * Math.PI) / 180;
  let bandIdx = 0;
  for (let y0 = midStart; y0 + bandH <= midEnd + 1e-4; y0 += pitch) {
    const y1 = Math.min(midEnd, y0 + bandH);
    const amp = (bandIdx % 2 === 0 ? 1 : -1) * Math.min(0.45, wallT * 0.22);
    appendClosedAnnularRing(
      positions, indices, y0, y1,
      Math.max(1, radiusAt(y0) - wallT), radiusAt(y0),
      Math.max(1, radiusAt(y1) - wallT), radiusAt(y1),
      radialSegs, amp, Math.max(2, Math.floor(weavePillars / 2)), (((y0 + y1) * 0.5) / H) * twistRad
    );
    bandIdx++;
  }

  const pillarSteps = Math.max(12, Math.round(H / 5));
  const widthRad = Math.min((Math.PI * 2) / (weavePillars * 3.2), 2.4 / Math.max(8, radiusAt(H * 0.5)));
  for (let p = 0; p < weavePillars; p++) {
    appendClosedWarpPillar(positions, indices, radiusAt, rimH * 0.5, H - rimH * 0.5, wallT, (p / weavePillars) * Math.PI * 2, twistRad, widthRad, pillarSteps, H);
  }

  const baseZ = Number(part.baseZ || 0);
  if (baseZ !== 0) for (let i = 1; i < positions.length; i += 3) positions[i] += baseZ;
  return createCompatGeometry(positions, null, indices, new Float32Array(positions.length / 3).fill(1.0), THREE);
}

/**
 * Verifies half-edge watertightness and signed volume of any BufferGeometry.
 */
export function verifyManifoldTopology(geom) {
  const pos = geom?.attributes?.position;
  if (!pos || pos.count === 0) return { openEdges: 0, nonManifoldEdges: 0, triangleCount: 0, vertexCount: 0, volume: 0, isWatertight: false };
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
  const edgeMap = new Map();
  const vk = (i) => `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`;
  let volume = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0;
    const k0 = vk(i0), k1 = vk(i1), k2 = vk(i2);
    for (const [u, w] of [[k0, k1], [k1, k2], [k2, k0]]) {
      if (u === w) continue;
      const fwd = `${u}>${w}`, rev = `${w}>${u}`;
      if (edgeMap.get(rev) > 0) edgeMap.set(rev, edgeMap.get(rev) - 1);
      else edgeMap.set(fwd, (edgeMap.get(fwd) || 0) + 1);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0;
  for (const cnt of edgeMap.values()) {
    if (cnt > 0) openEdges += cnt;
    if (cnt > 1) nonManifoldEdges += cnt - 1;
  }
  return { openEdges, nonManifoldEdges, triangleCount: triCount, vertexCount: pos.count, volume: +volume.toFixed(3), isWatertight: openEdges === 0 && triCount > 0 && volume > 0 };
}

/**
 * Confirms radial rays in the middle band zone pass cleanly through physical openings.
 */
export function hasPhysicalApertures(geom, part = {}) {
  const pos = geom?.attributes?.position;
  if (!pos || pos.count === 0) return false;
  geom.computeBoundingBox?.();
  const bbox = geom.boundingBox, minY = bbox.min.y, maxY = bbox.max.y, H = maxY - minY;
  if (H < 4) return false;

  const cx = (bbox.min.x + bbox.max.x) * 0.5, cz = (bbox.min.z + bbox.max.z) * 0.5;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
  const zMid0 = minY + H * 0.35, zMid1 = minY + H * 0.65;

  const midTris = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const y0 = pos.getY(i0), y1 = pos.getY(i1), y2 = pos.getY(i2);
    const tMinY = Math.min(y0, y1, y2), tMaxY = Math.max(y0, y1, y2);
    if (tMaxY < zMid0 || tMinY > zMid1) continue;
    midTris.push([pos.getX(i0), y0, pos.getZ(i0), pos.getX(i1), y1, pos.getZ(i1), pos.getX(i2), y2, pos.getZ(i2), tMinY, tMaxY]);
  }
  if (midTris.length === 0) return false;

  const ySamples = 40, thetaSamples = Math.max(12, Math.min(24, Number(part.weavePillars || 16)));
  let escapedRays = 0, hitRays = 0;
  for (let yi = 0; yi < ySamples; yi++) {
    const ry = zMid0 + ((yi + 0.5) / ySamples) * Math.min(20, zMid1 - zMid0);
    for (let ti = 0; ti < thetaSamples; ti++) {
      const th = ((ti + 0.37) / thetaSamples) * Math.PI * 2, dx = Math.cos(th), dz = Math.sin(th);
      let hit = false;
      for (let k = 0; k < midTris.length; k++) {
        const tr = midTris[k];
        if (ry < tr[9] - 1e-5 || ry > tr[10] + 1e-5) continue;
        const e1x = tr[3] - tr[0], e1y = tr[4] - tr[1], e1z = tr[5] - tr[2];
        const e2x = tr[6] - tr[0], e2y = tr[7] - tr[1], e2z = tr[8] - tr[2];
        const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-7) continue;
        const invDet = 1 / det, tx = cx - tr[0], ty = ry - tr[1], tz = cz - tr[2];
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dz * qz) * invDet;
        if (v < 0 || u + v > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) * invDet > 0.5) { hit = true; break; }
      }
      if (hit) hitRays++; else escapedRays++;
    }
  }
  return escapedRays > 0 && hitRays > 0;
}
