/**
 * SKETCH3D — Vase-Mode RippleMesh & Procedural Surface Displacement
 * =================================================================
 * Implements 7 parametric vase-mode surface archetypes:
 * 1. none: Smooth untextured surface
 * 2. ripple: Helical ripple wave (Lunfardo "Victoria" / "Aura")
 * 3. weave: RippleMesh weave (Lunfardo "Mona")
 * 4. wave: Stacked circumferential sinusoidal wave rings
 * 5. spiral: Continuous diagonal helical ribbon wrap
 * 6. flute: Vintage Flute architectural vertical columns
 * 7. gyroid: Gyroid Shell 2.5D surface-projected TPMS
 * 8. coral: Turing Coral domain-warped reaction-diffusion labyrinth
 * 9. strata: Strata Weave phase-alternating textile ribs
 *
 * Guarantees:
 * - 4.0mm mounting rim smoothstep mask (flat circular E27 / bed bases)
 * - 55° maximum local overhang slope guard for support-free continuous FDM printing
 */

import { evaluateLatticeDisplacement } from './lattices.js';

/**
 * Evaluates radial displacement Delta_r at cylindrical coordinates (theta, y, r).
 * @param {string} pattern 'none' | 'ripple' | 'weave' | 'wave' | 'flute' | 'gyroid' | 'coral' | 'strata'
 * @param {number} amplitude Depth in mm (0.0 to 3.0)
 * @param {number} freq Number of circumferential waves (6 to 64)
 * @param {number} theta Angle in radians (-PI to PI)
 * @param {number} y Height in mm
 * @param {number} [r=30] Current radial distance in mm (for spatial wavelength clamping)
 * @returns {number} Radial displacement in mm
 */
export function evaluateDisplacement(pattern, amplitude, freq, theta, y, r = 30) {
  if (pattern === 'none' || amplitude <= 0) return 0;

  const N_theta = freq || 24;
  const tau = (2 * Math.PI) / 36; // Helical pitch wave (36 mm vertical cycle)
  const N_z = (2 * Math.PI) / 18; // Vertical weave cycle (18 mm vertical cycle)

  switch (pattern) {
    case 'ripple':
      // Victoria / Aura: Helical ripple wave
      // Delta r = A * sin(N_theta * theta + tau * y) * cos(N_z * y)
      return amplitude * Math.sin(N_theta * theta + tau * y) * Math.cos(N_z * y);

    case 'weave':
      // Mona: RippleMesh Weave
      // Delta r = A * sin(N_theta * theta) * sin(N_z * y)
      return amplitude * Math.sin(N_theta * theta) * Math.sin(N_z * y);

    case 'wave': {
      // Wave Ribs: Stacked circumferential horizontal wave rings
      // Delta r = A * sin(k_z * y)
      const wavePitch = Math.max(4, 72 / ((freq || 24) / 6));
      const k_z = (2 * Math.PI) / wavePitch;
      return amplitude * Math.sin(k_z * y);
    }

    case 'spiral':
      // Spiral Ribbon: Continuous diagonal helical ribbon wrapping around circumference
      // Delta r = A * sin(N_theta * theta + tau * y)
      return amplitude * Math.sin(N_theta * theta + tau * y);

    case 'flute':
      // Vintage Flute: Pure vertical architectural fluting / column pleats
      // Delta r = A * sin(N_theta * theta)
      return amplitude * Math.sin(N_theta * theta);

    case 'gyroid': {
      // Gyroid Shell: 2.5D Surface-Projected Triply Periodic Minimal Surface (TPMS)
      // Mapped to cylindrical coordinates (u, v, w) for continuous spiral perimeter:
      // Delta r = A * (1 / 1.5) * [sin(u)*cos(v) + sin(v)*cos(w) + sin(w)*cos(u)]
      const u = N_theta * theta;
      const v = N_z * y;
      const w = u - v;
      const tpms = Math.sin(u) * Math.cos(v) + Math.sin(v) * Math.cos(w) + Math.sin(w) * Math.cos(u);
      return amplitude * (tpms / 1.5);
    }

    case 'coral': {
      // Turing Coral: Domain-warped reaction-diffusion labyrinth approximation
      // Delta r = A * sin(N_theta * theta + beta * sin(N_z * y) + gamma * cos(0.5 * N_theta * theta - N_z * y))
      const beta = 1.25;
      const gamma = 0.85;
      const warp = beta * Math.sin(N_z * y) + gamma * Math.cos(0.5 * N_theta * theta - N_z * y);
      const raw = amplitude * Math.sin(N_theta * theta + warp);

      // Clamp spatial wavelength >= 2.5 mm for clean 0.4mm nozzle tracking
      const spatialWavelength = (2 * Math.PI * Math.max(1, r)) / Math.max(1, N_theta);
      const wavelengthScale = spatialWavelength < 2.5 ? Math.max(0.25, spatialWavelength / 2.5) : 1.0;
      return raw * wavelengthScale;
    }

    case 'strata': {
      // Strata Weave: Phase-alternating textile ribs with diagonal interlocking bands
      // Delta r = A * sin(N_theta * theta + (PI / 2) * sin(N_z * y))
      const phase = (Math.PI / 2) * Math.sin(N_z * y);
      return amplitude * Math.sin(N_theta * theta + phase);
    }

    case 'perforated-weave':
    case 'perforated_weave':
    case 'lfam-rib':
    case 'lfam_rib':
      return evaluateLatticeDisplacement(pattern, amplitude, freq, theta, y, r);

    default:
      return 0;
  }
}

/**
 * Smoothly tapers displacement amplitude to 0 over the bottom and top rim margins
 * so bed adhesion bases and lamp/socket fittings remain flat and circular.
 * @param {number} y Current Y coordinate
 * @param {number} minY Minimum Y of model
 * @param {number} maxY Maximum Y of model
 * @param {number} rimMargin Margin in mm (default 4.0 mm)
 * @returns {number} Factor in [0.0, 1.0]
 */
export function computeRimMask(y, minY, maxY, rimMargin = 4.0) {
  const distBottom = y - minY;
  const distTop = maxY - y;
  const margin = Math.max(0.5, rimMargin);

  let factor = 1.0;
  if (distBottom < margin) {
    const t = Math.max(0, distBottom / margin);
    factor = Math.min(factor, t * t * (3 - 2 * t)); // Smoothstep
  }
  if (distTop < margin) {
    const t = Math.max(0, distTop / margin);
    factor = Math.min(factor, t * t * (3 - 2 * t)); // Smoothstep
  }
  return factor;
}

/**
 * Clamps radial displacement to guarantee local overhang slope <= 55° (no support needed).
 * tan(55°) = ~1.42814
 * @param {number} deltaR
 * @param {number} prevDeltaR
 * @param {number} deltaY
 * @param {number} maxSlopeAngleDeg Default 55°
 * @returns {number}
 */
export function clampOverhang(deltaR, prevDeltaR, deltaY, maxSlopeAngleDeg = 55) {
  if (deltaY <= 0) return deltaR;
  const maxSlope = Math.tan((maxSlopeAngleDeg * Math.PI) / 180);
  const maxAllowedDelta = Math.abs(deltaY) * maxSlope;
  const diff = deltaR - prevDeltaR;
  if (Math.abs(diff) > maxAllowedDelta) {
    return prevDeltaR + Math.sign(diff) * maxAllowedDelta;
  }
  return deltaR;
}

/**
 * Applies procedural surface displacement to a THREE.BufferGeometry.
 * Modifies position attribute in-place along radial normals and recomputes vertex normals.
 * @param {THREE.BufferGeometry} geometry
 * @param {Object} options
 * @param {string} options.pattern
 * @param {number} options.depth Amplitude in mm (0.0 to 3.0)
 * @param {number} options.freq Circumferential wave count (6 to 64)
 * @param {number} [options.rimMargin=4.0]
 * @param {number} [options.maxSlopeAngle=55]
 * @returns {THREE.BufferGeometry}
 */
export function applySurfaceTexture(geometry, options = {}) {
  const {
    pattern = 'none',
    depth = 0.8,
    freq = 24,
    rimMargin = 4.0,
    maxSlopeAngle = 55
  } = options;

  if (pattern === 'none' || depth <= 0 || !geometry) return geometry;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  const minY = bbox.min.y;
  const maxY = bbox.max.y;
  const height = maxY - minY;
  if (height < 1.0) return geometry;

  const effRimMargin = Math.min(rimMargin, height * 0.18);
  const centerX = (bbox.min.x + bbox.max.x) * 0.5;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;

  const pos = geometry.attributes.position;
  const normAttr = geometry.attributes.normal;
  const maskAttr = geometry.attributes.aOuterWallMask;
  const count = pos.count;

  // Track vertical layer displacement for overhang clamping per angular column
  const layerDisplacements = new Map();

  for (let i = 0; i < count; i++) {
    // If geometry has an outer wall mask, only displace outer side walls
    const outerMask = maskAttr ? maskAttr.getX(i) : 1.0;
    if (outerMask <= 0.001) continue;

    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Compute cylindrical coordinates relative to center axis
    const dx = x - centerX;
    const dz = z - centerZ;
    const r = Math.hypot(dx, dz);
    if (r < 0.2) continue; // Skip core axis vertices

    const theta = Math.atan2(dz, dx);
    const rawDisp = evaluateDisplacement(pattern, depth, freq, theta, y, r);
    const mask = computeRimMask(y, minY, maxY, effRimMargin);
    let disp = rawDisp * mask * outerMask;

    // Apply Overhang Protection
    const angleBin = Math.round(theta * 12);
    const yStep = Math.round(y * 2) * 0.5;
    const layerKey = `${angleBin}_${yStep}`;
    const prevKey = `${angleBin}_${yStep - 0.5}`;
    if (layerDisplacements.has(prevKey)) {
      const prevDisp = layerDisplacements.get(prevKey);
      disp = clampOverhang(disp, prevDisp, 0.5, maxSlopeAngle);
    }
    layerDisplacements.set(layerKey, disp);

    // Displace outward along surface normal if horizontal component is significant
    let nx = dx / r;
    let nz = dz / r;
    if (normAttr) {
      const fnx = normAttr.getX(i);
      const fnz = normAttr.getZ(i);
      const fnLen = Math.hypot(fnx, fnz);
      if (fnLen > 0.1) {
        nx = fnx / fnLen;
        nz = fnz / fnLen;
      }
    }

    pos.setX(i, x + nx * disp);
    pos.setZ(i, z + nz * disp);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
