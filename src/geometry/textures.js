/**
 * SKETCH3D — Vase-Mode RippleMesh & Procedural Surface Displacement
 * =================================================================
 * Implements Lunfardo "Victoria" (Helical Ripple) and "Mona" (RippleMesh Weave)
 * surface textures with mounting rim masks and 55° FDM overhang protection.
 */

/**
 * Evaluates radial displacement Delta_r at a given cylindrical coordinate (theta, y).
 * @param {string} pattern 'none' | 'ripple' | 'weave' | 'wave'
 * @param {number} amplitude Depth in mm (0.0 to 3.0)
 * @param {number} freq Number of circumferential waves (6 to 64)
 * @param {number} theta Angle in radians (-PI to PI)
 * @param {number} y Height in mm
 * @returns {number}
 */
export function evaluateDisplacement(pattern, amplitude, freq, theta, y) {
  if (pattern === 'none' || amplitude <= 0) return 0;

  const N_theta = freq || 24;
  const tau = (2 * Math.PI) / 36; // Helical pitch wave (36 mm vertical cycle)
  const N_z = (2 * Math.PI) / 18; // Vertical weave frequency (18 mm vertical cycle)

  switch (pattern) {
    case 'ripple':
      // Victoria style: Helical ripple wave
      // Delta r = A * sin(N_theta * theta + tau * y) * cos(N_z * y)
      return amplitude * Math.sin(N_theta * theta + tau * y) * Math.cos(N_z * y);

    case 'weave':
      // Mona style: RippleMesh Weave
      // Delta r = A * sin(N_theta * theta) * sin(N_z * y)
      return amplitude * Math.sin(N_theta * theta) * Math.sin(N_z * y);

    case 'wave':
      // Wave Ribs (pure circumferential sinusoidal ridges)
      // Delta r = A * sin(N_theta * theta)
      return amplitude * Math.sin(N_theta * theta);

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
 * @param {string} options.pattern 'none' | 'ripple' | 'weave' | 'wave'
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

  const centerX = (bbox.min.x + bbox.max.x) * 0.5;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;

  const pos = geometry.attributes.position;
  const count = pos.count;

  // Track vertical layer displacement for overhang clamping
  const layerDisplacements = new Map();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Compute cylindrical coordinates relative to center axis
    const dx = x - centerX;
    const dz = z - centerZ;
    const r = Math.hypot(dx, dz);
    if (r < 0.2) continue; // Skip core axis vertices

    const theta = Math.atan2(dz, dx);
    const rawDisp = evaluateDisplacement(pattern, depth, freq, theta, y);
    const mask = computeRimMask(y, minY, maxY, rimMargin);
    let disp = rawDisp * mask;

    // Apply Overhang Protection
    const layerKey = Math.round(y * 2) * 0.5;
    const prevKey = layerKey - 0.5;
    if (layerDisplacements.has(prevKey)) {
      const prevDisp = layerDisplacements.get(prevKey);
      disp = clampOverhang(disp, prevDisp, 0.5, maxSlopeAngle);
    }
    layerDisplacements.set(layerKey, disp);

    // Displace outward along cylindrical radial normal
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
