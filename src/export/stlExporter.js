/**
 * SKETCH3D — Binary STL Exporter & Filament Mass Estimator
 * =========================================================
 * Multi-part Z-up binary STL generation, non-degenerate triangle filtering,
 * half-edge manifold verification, and 1.24 g/cm³ PLA filament estimation.
 */

import { calculateVaseModeMass } from '../geometry/shell3d.js';

/**
 * Extracts valid triangles from an array of THREE.Mesh objects,
 * mapping Three.js Y-up (X, Y, Z) to 3D Slicer Z-up (X, -Z, Y) and grounding to Z=0.
 * @param {Array<THREE.Mesh>} meshes
 * @returns {{ triangles: Array<Object>, minZ: number }}
 */
export function extractPrintableTriangles(meshes) {
  const validTris = [];
  let minZ = Infinity;

  meshes.forEach(m => {
    if (!m.geometry) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const pos = g.attributes.position;

    for (let i = 0; i < pos.count; i += 3) {
      // Three.js Y-up (X, Y, Z) -> Slicer Z-up (X, -Z, Y)
      const ax = pos.getX(i), ay = -pos.getZ(i), az = pos.getY(i);
      const bx = pos.getX(i + 1), by = -pos.getZ(i + 1), bz = pos.getY(i + 1);
      const cx = pos.getX(i + 2), cy = -pos.getZ(i + 2), cz = pos.getY(i + 2);

      if (Number.isNaN(ax) || Number.isNaN(bx) || Number.isNaN(cx)) continue;

      const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
      const abx = ax - bx, aby = ay - by, abz = az - bz;
      const nx = cby * abz - cbz * aby;
      const ny = cbz * abx - cbx * abz;
      const nz = cbx * aby - cby * abx;
      const len = Math.hypot(nx, ny, nz);

      // Filter zero-area degenerate triangles
      if (len < 1e-6) continue;

      minZ = Math.min(minZ, az, bz, cz);
      validTris.push({
        a: { x: ax, y: ay, z: az },
        b: { x: bx, y: by, z: bz },
        c: { x: cx, y: cy, z: cz },
        n: { x: nx / len, y: ny / len, z: nz / len }
      });
    }

    g.dispose?.();
  });

  return { triangles: validTris, minZ: minZ === Infinity ? 0 : minZ };
}

/**
 * Performs half-edge manifold topology check on triangles.
 * Returns the count of open non-manifold edges (0 = fully watertight).
 * @param {Array<Object>} triangles
 * @returns {number} Open edge count
 */
export function checkManifoldEdges(triangles) {
  const edgeMap = new Map();
  const vk = v => `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`;

  triangles.forEach(t => {
    const pairs = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
    pairs.forEach(([u, w]) => {
      const k = vk(u) + '>' + vk(w);
      const rk = vk(w) + '>' + vk(u);
      if (edgeMap.has(rk) && edgeMap.get(rk) > 0) {
        edgeMap.set(rk, edgeMap.get(rk) - 1);
      } else {
        edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
      }
    });
  });

  let openEdges = 0;
  edgeMap.forEach(cnt => { openEdges += cnt; });
  return openEdges;
}

/**
 * Generates an ArrayBuffer containing a standard binary STL file.
 * @param {Array<Object>} triangles
 * @param {string} [headerText='SKETCH3D_VERIFIED_BAMBU_A1']
 * @returns {ArrayBuffer}
 */
export function buildBinarySTLBuffer(triangles, headerText = 'SKETCH3D_VERIFIED_BAMBU_A1') {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);

  // 80-byte ASCII Header
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < headerText.length ? headerText.charCodeAt(i) : 0);
  }

  // 4-byte unsigned int triangle count
  view.setUint32(80, triangles.length, true);

  // 50 bytes per triangle: Normal (3*float32) + Vertex1 (3*float32) + Vertex2 (3*float32) + Vertex3 (3*float32) + Attribute (uint16)
  let offset = 84;
  triangles.forEach(t => {
    view.setFloat32(offset, t.n.x, true); offset += 4;
    view.setFloat32(offset, t.n.y, true); offset += 4;
    view.setFloat32(offset, t.n.z, true); offset += 4;

    [t.a, t.b, t.c].forEach(v => {
      view.setFloat32(offset, v.x, true); offset += 4;
      view.setFloat32(offset, v.y, true); offset += 4;
      view.setFloat32(offset, v.z, true); offset += 4;
    });

    view.setUint16(offset, 0, true);
    offset += 2;
  });

  return buffer;
}

/**
 * Triggers a browser file download of the binary STL buffer.
 * @param {ArrayBuffer} buffer
 * @param {string} [filename='sketch3d_bambu_a1.stl']
 */
export function downloadSTL(buffer, filename = 'sketch3d_bambu_a1.stl') {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const MATERIAL_DENSITIES = { PLA: 1.24, PETG: 1.27, ABS: 1.04 };

/**
 * Computes exact signed volume (mm³) of a BufferGeometry from triangle indices without double-counting.
 * @param {THREE.BufferGeometry} geometry
 * @returns {number} Volume in mm³
 */
export function computeGeometrySignedVolumeMm3(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos || pos.count < 3) return 0;
  const idx = geometry.index ? geometry.index.array : null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
  let v6 = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    if (Number.isNaN(ax) || Number.isNaN(bx) || Number.isNaN(cx)) continue;
    v6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return Math.abs(v6) / 6;
}

function computeRevolveFrustumVolumeMm3(part) {
  const pts = part?.points;
  if (!pts || pts.length < 2) return { vol: 0, rawH: 0, rawMaxR: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of pts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const straddles = minX < -0.01 && maxX > 0.01;
  const prof = pts.map(pt => ({ r: Math.max(0.5, straddles ? pt.x - minX : Math.abs(pt.x)), y: -pt.y }));
  let vol = 0, rawMaxR = 0;
  for (let i = 0; i < prof.length; i++) rawMaxR = Math.max(rawMaxR, prof[i].r);
  for (let i = 0; i < prof.length - 1; i++) {
    const p0 = prof[i], p1 = prof[i + 1];
    const dy = p1.y - p0.y;
    vol += (Math.PI / 3) * dy * (p0.r * p0.r + p0.r * p1.r + p1.r * p1.r);
  }
  return { vol: Math.abs(vol), rawH: Math.max(1, maxY - minY), rawMaxR: Math.max(0.5, rawMaxR) };
}

/**
 * Analyzes flat-base contact area at Z = 0 (Three.js Y = minY) to flag low-adhesion prints.
 * @param {Array<THREE.Mesh>} meshes
 * @param {number} [zTolMm=0.25]
 * @returns {{ contactAreaMm2: number, footprintAreaMm2: number, contactRatio: number, isLowContact: boolean }}
 */
export function analyzeBedContact(meshes, zTolMm = 0.25) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
  const valid = (meshes || []).filter(m => m?.geometry?.attributes?.position?.count >= 3);
  if (valid.length === 0) return { contactAreaMm2: 0, footprintAreaMm2: 0, contactRatio: 0, isLowContact: false };
  valid.forEach(m => {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x);
    minY = Math.min(minY, b.min.y);
    minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
  });
  let contactAreaMm2 = 0;
  valid.forEach(m => {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index ? m.geometry.index.array : null;
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ay = pos.getY(i0), by = pos.getY(i1), cy = pos.getY(i2);
      if (Math.max(ay, by, cy) - minY <= zTolMm) {
        const ax = pos.getX(i0), az = pos.getZ(i0);
        const bx = pos.getX(i1), bz = pos.getZ(i1);
        const cx = pos.getX(i2), cz = pos.getZ(i2);
        contactAreaMm2 += 0.5 * Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      }
    }
  });
  const footprintAreaMm2 = Math.max(1, (maxX - minX) * (maxZ - minZ));
  const contactRatio = contactAreaMm2 / footprintAreaMm2;
  return {
    contactAreaMm2: +contactAreaMm2.toFixed(1),
    footprintAreaMm2: +footprintAreaMm2.toFixed(1),
    contactRatio: +contactRatio.toFixed(3),
    isLowContact: contactAreaMm2 < 100 || contactRatio < 0.08
  };
}

/**
 * Computes estimated filament mass using exact signed mesh volume (no double counting)
 * and consistent wall/solid density across Shell: On and Shell: Off.
 * @param {Array<Object>} parts
 * @param {Array<THREE.Mesh>} meshes
 * @param {{ material?: string, densityFactor?: number }} [options={}]
 * @returns {number} Filament mass in grams
 */
export function estimateFilamentMass(parts, meshes, options = {}) {
  const defaultKey = String(options.material || 'PLA').toUpperCase();
  const defaultDensity = MATERIAL_DENSITIES[defaultKey] || MATERIAL_DENSITIES.PLA;
  const fillFactor = Number.isFinite(options.densityFactor) ? Math.max(0.05, options.densityFactor) : 1.0;
  let totalMassGrams = 0;

  const hasTagged = (meshes || []).some(m => m?.userData?.partIndex !== undefined);

  (parts || []).forEach((part, idx) => {
    const mesh = hasTagged
      ? (meshes || []).find(m => m?.userData?.partIndex === idx)
      : meshes?.[idx];
    if (!mesh || !mesh.geometry) return;

    const pKey = String(part?.polymer || defaultKey).toUpperCase();
    const density = MATERIAL_DENSITIES[pKey] || defaultDensity;

    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    const h = b.max.y - b.min.y;

    if (part.shellEnabled && part.shellMode === 'vase_proxy') {
      const approxPerimeter = (w + d) * 2;
      const floorArea = w * d * 0.7;
      totalMassGrams += calculateVaseModeMass(approxPerimeter, h, floorArea) * (density / MATERIAL_DENSITIES.PLA);
      return;
    }

    let volMm3 = computeGeometrySignedVolumeMm3(mesh.geometry);
    const isSolidOpenLathe = part.type === 'revolve' && !(part.shellEnabled && part.shellMode === 'hollow') && !part.isClosed;
    if (isSolidOpenLathe) {
      const fr = computeRevolveFrustumVolumeMm3(part);
      if (fr.vol > 0) {
        const yScale = h / fr.rawH;
        const rScale = (w * 0.5) / fr.rawMaxR;
        volMm3 = fr.vol * yScale * rScale * rScale;
      }
    }

    if (volMm3 > 0) {
      totalMassGrams += (volMm3 / 1000) * density * fillFactor;
    }
  });

  return Math.max(0.1, totalMassGrams);
}
