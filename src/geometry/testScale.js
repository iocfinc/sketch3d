/**
 * SKETCH3D — Scaled Test-Print & Tactile Swatch Engine
 * ====================================================
 * Implements 3-tier fabrication verification:
 * 1. full (100%): Native 1:1 dimensions
 * 2. mini (40% Mini Proof): Outer X/Y/Z 0.40×, wave count N_theta * 0.6,
 *    amplitude decoupled & clamped A >= 0.65 mm for 0.4mm nozzle relief
 * 3. swatch (35mm Swatch): 35mm tall ring (Ø 60mm) at unscaled 1:1 texture amplitude
 */

export const SCALE_MODES = {
  FULL: 'full',
  MINI: 'mini',
  SWATCH: 'swatch'
};

/**
 * Returns decoupled texture parameters adjusted for test scale mode.
 * @param {Object} part
 * @param {string} scaleMode 'full' | 'mini' | 'swatch'
 * @returns {{ scaleFactor: number, textureDepth: number, textureFreq: number }}
 */
export function getTestScaleParameters(part, scaleMode = 'full') {
  const baseDepth = part.textureDepth ?? 0.8;
  const baseFreq = part.textureFreq ?? 24;

  if (scaleMode === 'mini') {
    return {
      scaleFactor: 0.40,
      // Decoupled tactile relief: never scale below 0.65 mm for a 0.4mm nozzle
      textureDepth: Math.max(0.65, baseDepth * 0.8),
      // Scale frequency by 0.6x to keep spatial wavelength >= 4.5 mm
      textureFreq: Math.max(8, Math.round(baseFreq * 0.6))
    };
  }

  if (scaleMode === 'swatch') {
    return {
      scaleFactor: 1.0,
      textureDepth: baseDepth,
      textureFreq: baseFreq
    };
  }

  return {
    scaleFactor: 1.0,
    textureDepth: baseDepth,
    textureFreq: baseFreq
  };
}

/**
 * Transforms or crops geometry for test-print proofing.
 * @param {THREE.BufferGeometry} geometry
 * @param {string} scaleMode 'full' | 'mini' | 'swatch'
 * @returns {THREE.BufferGeometry}
 */
export function applyScaleModeToGeometry(geometry, scaleMode = 'full') {
  if (!geometry || scaleMode === 'full') return geometry;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  const minY = bbox.min.y;
  const maxY = bbox.max.y;
  const height = maxY - minY;

  if (scaleMode === 'mini') {
    // 0.40x linear downscale grounded at Y = 0
    const cloned = geometry.clone();
    cloned.scale(0.40, 0.40, 0.40);
    cloned.computeBoundingBox();
    const newMinY = cloned.boundingBox.min.y;
    cloned.translate(0, -newMinY, 0);
    cloned.computeVertexNormals();
    cloned.computeBoundingBox();
    return cloned;
  }

  if (scaleMode === 'swatch') {
    // Crop a 35mm tall band centered on the model, or scale height if model is small
    const targetHeight = 35.0;
    const cloned = geometry.clone();

    if (height <= targetHeight) {
      cloned.translate(0, -minY, 0);
      cloned.computeBoundingBox();
      return cloned;
    }

    const midY = (minY + maxY) * 0.5;
    const sliceMinY = midY - targetHeight * 0.5;
    const sliceMaxY = midY + targetHeight * 0.5;

    const pos = cloned.attributes.position;
    const count = pos.count;

    // Soft-clamp vertices outside the 35mm slice onto the boundaries
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const clampedY = Math.max(sliceMinY, Math.min(sliceMaxY, y));
      pos.setY(i, clampedY - sliceMinY); // Shift to base at Y=0
    }

    pos.needsUpdate = true;
    cloned.computeVertexNormals();
    cloned.computeBoundingBox();
    return cloned;
  }

  return geometry;
}

/**
 * Returns export filename with proper test-print scale suffix.
 * @param {string} baseName
 * @param {string} scaleMode 'full' | 'mini' | 'swatch'
 * @returns {string}
 */
export function getExportFilename(baseName = 'sketch3d_bambu_a1', scaleMode = 'full') {
  const cleanBase = baseName.replace(/\.stl$/i, '');
  if (scaleMode === 'mini') {
    return `${cleanBase}-mini-proof.stl`;
  }
  if (scaleMode === 'swatch') {
    return `${cleanBase}-swatch.stl`;
  }
  return `${cleanBase}.stl`;
}
