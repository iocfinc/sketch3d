/**
 * SKETCH3D — Boolean Cutters & Hardware Pocket Operations
 * =======================================================
 * Manifold-3d powered CSG operations for through-holes, blind pockets,
 * captive hex-nut traps, countersink screw cavities, and disjoint island auditing.
 * Enforces watertight geometry and explicit memory disposal.
 */

import { getCsg, CsgScope, createHexNutSolid } from './csgKernel.js';
import { HARDWARE_PRESETS } from '../config/hardwarePresets.js';

/**
 * Cut a circular through-hole through a solid
 * @param {any} baseManifold
 * @param {number} x Hole center X
 * @param {number} y Hole center Y
 * @param {number} radius Hole radius in mm
 * @param {number} [depthMm] Optional depth; if omitted cuts through entire bounding box
 * @param {number} [zStart] Optional Z coordinate; if omitted starts from bbox min
 * @param {number} [segments=32]
 * @returns {any} Resulting Manifold solid
 */
export function cutThroughHole(baseManifold, x, y, radius, depthMm = null, zStart = null, segments = 32) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const bbox = baseManifold.boundingBox();
  const margin = 0.5; // Avoid coplanar boundary artifacts

  const zMin = zStart !== null ? zStart - margin : bbox.min[2] - margin;
  const totalDepth = depthMm !== null ? depthMm + 2 * margin : (bbox.max[2] - bbox.min[2]) + 2 * margin;

  const cutter = csg.Manifold.cylinder(totalDepth, radius, radius, segments).translate([x, y, zMin]);
  const result = baseManifold.subtract(cutter);
  cutter.delete();

  return result;
}

/**
 * Cut a blind cylindrical pocket from the top face downwards
 * @param {any} baseManifold
 * @param {number} x Pocket center X
 * @param {number} y Pocket center Y
 * @param {number} radius Pocket radius in mm
 * @param {number} depthMm Pocket depth in mm
 * @param {number|null} [zTop=null] Top face Z coordinate (defaults to bbox.max[2])
 * @param {number} [segments=32]
 * @param {number} [entryOffset=0.1] Slight protrusion above face to ensure clean entry
 * @returns {any} Resulting Manifold solid
 */
export function cutBlindPocket(baseManifold, x, y, radius, depthMm, zTop = null, segments = 32, entryOffset = 0.1) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const top = zTop !== null ? zTop : baseManifold.boundingBox().max[2];
  const cutterHeight = depthMm + entryOffset;
  const zBottom = top - depthMm;

  const cutter = csg.Manifold.cylinder(cutterHeight, radius, radius, segments).translate([x, y, zBottom]);
  const result = baseManifold.subtract(cutter);
  cutter.delete();

  return result;
}

/**
 * Cut a captive hex-nut pocket (axial or side-insertion slot)
 * @param {any} baseManifold
 * @param {number} cx Nut center X
 * @param {number} cy Nut center Y
 * @param {string} presetKey Key in HARDWARE_PRESETS (e.g. 'HEX_NUT_M3', 'HEX_NUT_M4')
 * @param {'axial'|'side'} [mode='axial'] Axial insertion or side slot insertion
 * @param {Object} [options] Additional pocket configurations
 * @param {number|null} [options.zFace=null] Reference Z face (top face if null)
 * @param {boolean} [options.includeThroughBore=true] Cut clearance hole for bolt shank
 * @param {number[]} [options.slotDir=[-1, 0]] Normalized 2D direction for side slot
 * @param {number} [options.slotLength=25.0] Length of side slot to part boundary
 * @returns {any} Resulting Manifold solid
 */
export function cutHexNutPocket(baseManifold, cx, cy, presetKey, mode = 'axial', options = {}) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const preset = HARDWARE_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown hardware preset: ${presetKey}`);

  const bbox = baseManifold.boundingBox();
  const zFace = options.zFace !== undefined && options.zFace !== null ? options.zFace : bbox.max[2];
  const entryOffset = 0.1;

  const scope = new CsgScope();

  try {
    let cutter;
    if (mode === 'axial') {
      // Axial nut trap recessed from reference face
      const nutHeight = preset.depth + entryOffset;
      const zNut = zFace - preset.depth;

      const hexSolid = scope.track(createHexNutSolid(cx, cy, preset.acrossFlats, nutHeight));
      let combined = scope.track(hexSolid.translate([0, 0, zNut]));

      // Optional through-bore for screw shank
      if (options.includeThroughBore !== false) {
        const boreRadius = preset.throughBore / 2;
        const totalHeight = (bbox.max[2] - bbox.min[2]) + 1.0;
        const boreCyl = scope.track(
          csg.Manifold.cylinder(totalHeight, boreRadius, boreRadius, 32).translate([cx, cy, bbox.min[2] - 0.5])
        );
        combined = scope.track(combined.add(boreCyl));
      }
      cutter = combined;
    } else {
      // Side slot nut trap (horizontal insertion channel)
      const nutThickness = preset.depth;
      const zMid = options.zCenter !== undefined ? options.zCenter : (bbox.min[2] + bbox.max[2]) / 2;
      const zBottom = zMid - nutThickness / 2;

      // Hex nut cavity at center
      const hexCavity = scope.track(
        createHexNutSolid(cx, cy, preset.acrossFlats, nutThickness).translate([0, 0, zBottom])
      );

      // Channel extending out in direction slotDir
      const dir = options.slotDir || [-1, 0];
      const slotLen = options.slotLength || 25.0;
      const slotWidth = preset.acrossFlats;

      // 2D box for slot cross-section
      const norm = Math.hypot(dir[0], dir[1]) || 1;
      const dx = (dir[0] / norm) * slotLen;
      const dy = (dir[1] / norm) * slotLen;
      const perpX = (-dir[1] / norm) * (slotWidth / 2);
      const perpY = (dir[0] / norm) * (slotWidth / 2);

      const slotPts = [
        [cx - perpX, cy - perpY],
        [cx + perpX, cy + perpY],
        [cx + dx + perpX, cy + dy + perpY],
        [cx + dx - perpX, cy + dy - perpY],
      ];

      const cs = scope.track(csg.CrossSection.ofPolygons([slotPts]));
      const slotSolid = scope.track(csg.Manifold.extrude(cs, nutThickness).translate([0, 0, zBottom]));

      let combined = scope.track(hexCavity.add(slotSolid));

      // Through-bore along Z for bolt shank
      if (options.includeThroughBore !== false) {
        const boreRadius = preset.throughBore / 2;
        const totalHeight = (bbox.max[2] - bbox.min[2]) + 1.0;
        const boreCyl = scope.track(
          csg.Manifold.cylinder(totalHeight, boreRadius, boreRadius, 32).translate([cx, cy, bbox.min[2] - 0.5])
        );
        combined = scope.track(combined.add(boreCyl));
      }
      cutter = combined;
    }

    const result = baseManifold.subtract(cutter);
    return result;
  } finally {
    scope.dispose();
  }
}

/**
 * Cut a 90° countersink screw hole with 45° overhang slope and shank bore
 * @param {any} baseManifold
 * @param {number} cx Hole center X
 * @param {number} cy Hole center Y
 * @param {string} presetKey Key in HARDWARE_PRESETS (e.g. 'CSK_WOOD_M3', 'CSK_WOOD_M4')
 * @param {Object} [options]
 * @param {number|null} [options.zTop=null] Top reference face
 * @param {number} [segments=32]
 * @returns {any} Resulting Manifold solid
 */
export function cutCountersinkHole(baseManifold, cx, cy, presetKey, options = {}, segments = 32) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const preset = HARDWARE_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown countersink preset: ${presetKey}`);

  const bbox = baseManifold.boundingBox();
  const zTop = options.zTop !== undefined && options.zTop !== null ? options.zTop : bbox.max[2];
  const shankRadius = preset.shankDiameter / 2;
  const headRadius = preset.headDiameter / 2;
  const headDepth = preset.headDepth;

  const scope = new CsgScope();

  try {
    const entryOffset = 0.1;
    // Conical head: radius increases from shankRadius at bottom to headRadius + offset at top
    // cylinder(height, radiusLow, radiusHigh, segments)
    const coneHeight = headDepth + entryOffset;
    const topRadius = headRadius + entryOffset; // 45 degree slope: dx = dz
    const zConeBottom = zTop - headDepth;

    const cone = scope.track(
      csg.Manifold.cylinder(coneHeight, shankRadius, topRadius, segments).translate([cx, cy, zConeBottom])
    );

    // Through shank bore passing through the rest of the body
    const shankLength = (zTop - bbox.min[2]) + 0.5;
    const shankCyl = scope.track(
      csg.Manifold.cylinder(shankLength, shankRadius, shankRadius, segments).translate([cx, cy, bbox.min[2] - 0.5])
    );

    const cutter = scope.track(cone.add(shankCyl));
    const result = baseManifold.subtract(cutter);
    return result;
  } finally {
    scope.dispose();
  }
}

/**
 * Split a manifold into disconnected disjoint solid islands
 * Useful to detect if a cut operation severed a body into multiple disconnected pieces.
 * @param {any} manifold
 * @returns {any[]} Array of Manifold instances
 */
export function splitIslands(manifold) {
  if (!manifold || manifold.isEmpty()) return [];
  return manifold.decompose();
}
