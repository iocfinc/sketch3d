/**
 * SKETCH3D — Open Lampshade & LFAM Lattice Kernel
 * ================================================
 * Generative surface lattices and heavy-gauge bead texturing:
 * 1. perforated-weave: Diamond/rectangular light apertures with >= 1.6mm ribs
 *    and self-supporting <= 45° overhang bridging for support-free shade illumination.
 * 2. lfam-rib: Large Format Additive Manufacturing (LFAM) heavy-gauge bead profiles
 *    (1.2-2.4mm relief) inspired by industrial architectural extrusions.
 */

import { computeRimMask, clampOverhang } from './textures.js';

/**
 * Evaluates radial displacement Delta_r for open lattice and LFAM patterns.
 * @param {string} pattern 'perforated-weave' | 'perforated_weave' | 'lfam-rib' | 'lfam_rib'
 * @param {number} amplitude Depth in mm (0.5 to 3.0)
 * @param {number} freq Circumferential count (6 to 64)
 * @param {number} theta Angle in radians (-PI to PI)
 * @param {number} y Height in mm
 * @param {number} [r=30] Radius in mm for spatial wavelength clamping
 * @returns {number}
 */
export function evaluateLatticeDisplacement(pattern, amplitude, freq, theta, y, r = 30) {
  if (amplitude <= 0) return 0;
  const N_theta = freq || 20;
  const normPattern = pattern.replace(/_/g, '-');

  if (normPattern === 'perforated-weave') {
    // Diamond lattice with self-supporting <= 45° bridging
    // Periodicity: circumferential wave + 20mm vertical pitch
    const N_z = (2 * Math.PI) / 20.0;
    const u = N_theta * theta;
    const v = N_z * y;

    // Diamond cell modulation: sin(u)*sin(v) forms alternating aperture pockets
    // Second harmonic adds crisp structural fillet along rib joints
    const cell = Math.sin(u) * Math.sin(v) - 0.28 * Math.cos(2 * u) * Math.cos(2 * v);

    // Spatial rib width guarantee: clamp minimum strut thickness >= 1.6 mm
    const circumference = 2 * Math.PI * Math.max(5, r);
    const strutWidthMm = circumference / (N_theta * 2);
    const widthScale = strutWidthMm < 1.6 ? Math.max(0.3, strutWidthMm / 1.6) : 1.0;

    // Tanh transfer function creates distinct structural ribs and recessed aperture windows
    return amplitude * Math.tanh(2.6 * cell) * widthScale;
  }

  if (normPattern === 'lfam-rib') {
    // Large Format Additive Manufacturing (LFAM) heavy-gauge bead profile
    // 10mm tall rounded extruded beads with subtle circumferential flute
    const N_z = (2 * Math.PI) / 10.0;
    const v = N_z * y;
    const u = N_theta * theta;

    // Convex bead profile with rounded shelf
    const bead = Math.cos(v) + 0.35 * Math.cos(2 * v);
    const flute = 0.3 * Math.sin(u);

    return amplitude * (bead * 0.75 + flute);
  }

  return 0;
}

/**
 * Applies lattice or LFAM surface displacement to a THREE.BufferGeometry.
 * Modifies vertex positions along cylindrical normals and recomputes vertex normals.
 * @param {THREE.BufferGeometry} geometry
 * @param {Object} options
 * @param {string} options.pattern 'perforated-weave' | 'lfam-rib'
 * @param {number} options.depth Amplitude in mm (0.0 to 3.0)
 * @param {number} options.freq Circumferential wave count
 * @param {number} [options.rimMargin=4.0]
 * @param {number} [options.maxSlopeAngle=55]
 * @returns {THREE.BufferGeometry}
 */
export function applyLatticeTexture(geometry, options = {}) {
  const {
    pattern = 'perforated-weave',
    depth = 1.6,
    freq = 20,
    rimMargin = 4.0,
    maxSlopeAngle = 55
  } = options;

  if (!geometry || depth <= 0) return geometry;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  const minY = bbox.min.y;
  const maxY = bbox.max.y;
  const height = maxY - minY;
  if (height < 1.0) return geometry;

  const centerX = (bbox.min.x + bbox.max.x) * 0.5;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;
  const pos = geometry.attributes.position;
  const count = pos.count;
  const layerDisplacements = new Map();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const dx = x - centerX;
    const dz = z - centerZ;
    const r = Math.hypot(dx, dz);
    if (r < 0.2) continue;

    const theta = Math.atan2(dz, dx);
    const rawDisp = evaluateLatticeDisplacement(pattern, depth, freq, theta, y, r);
    const mask = computeRimMask(y, minY, maxY, rimMargin);
    let disp = rawDisp * mask;

    // Local Overhang Guard
    const layerKey = Math.round(y * 2) * 0.5;
    const prevKey = layerKey - 0.5;
    if (layerDisplacements.has(prevKey)) {
      const prevDisp = layerDisplacements.get(prevKey);
      disp = clampOverhang(disp, prevDisp, 0.5, maxSlopeAngle);
    }
    layerDisplacements.set(layerKey, disp);

    const nx = dx / r;
    const nz = dz / r;
    pos.setX(i, x + nx * disp);
    pos.setZ(i, z + nz * disp);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
