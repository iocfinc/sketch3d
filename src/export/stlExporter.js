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

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  meshes.forEach(m => {
    if (!m.geometry) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const pos = g.attributes.position;

    for (let i = 0; i < pos.count; i += 3) {
      // Three.js Y-up (X, Y, Z) -> Slicer Z-up (X, -Z, Y)
      vA.set(pos.getX(i), -pos.getZ(i), pos.getY(i));
      vB.set(pos.getX(i + 1), -pos.getZ(i + 1), pos.getY(i + 1));
      vC.set(pos.getX(i + 2), -pos.getZ(i + 2), pos.getY(i + 2));

      if (Number.isNaN(vA.x) || Number.isNaN(vB.x) || Number.isNaN(vC.x)) continue;

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      cb.cross(ab);

      // Filter zero-area degenerate triangles
      if (cb.length() < 1e-6) continue;

      cb.normalize();
      minZ = Math.min(minZ, vA.z, vB.z, vC.z);
      validTris.push({
        a: vA.clone(),
        b: vB.clone(),
        c: vC.clone(),
        n: cb.clone()
      });
    }

    g.dispose();
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

/**
 * Computes estimated PLA filament mass (1.24 g/cm³), accounting for solid, hollow, and vase-mode parts.
 * @param {Array<Object>} parts
 * @param {Array<THREE.Mesh>} meshes
 * @returns {number} Filament mass in grams
 */
export function estimateFilamentMass(parts, meshes) {
  let totalMassGrams = 0;

  parts.forEach((part, idx) => {
    const mesh = meshes[idx];
    if (!mesh || !mesh.geometry) return;

    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    const h = b.max.y - b.min.y;

    if (part.shellEnabled && part.shellMode === 'vase_proxy') {
      // Vase Mode: Single perimeter (0.42mm)
      const approxPerimeter = (w + d) * 2;
      const floorArea = w * d * 0.7;
      totalMassGrams += calculateVaseModeMass(approxPerimeter, h, floorArea);
    } else if (part.shellEnabled && part.shellMode === 'hollow') {
      // Hollow Open-Top: Shell wall thickness + floor
      const t = part.shellThickness || 1.2;
      const outerVol = w * d * h;
      const innerW = Math.max(0, w - t * 2);
      const innerD = Math.max(0, d - t * 2);
      const innerH = Math.max(0, h - Math.max(0.8, t));
      const innerVol = innerW * innerD * innerH;
      const shellVolCm3 = Math.max(0.2, (outerVol - innerVol) / 1000);
      totalMassGrams += shellVolCm3 * 1.24 * 0.9; // ~90% solid wall density
    } else {
      // Standard Solid Extrude/Revolve: ~15-20% infill + 3 solid perimeters
      const boxVolCm3 = (w * d * h) / 1000;
      totalMassGrams += Math.max(0.5, boxVolCm3 * 0.45 * 1.24 * 0.35);
    }
  });

  return Math.max(0.5, totalMassGrams);
}
