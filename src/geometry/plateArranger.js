/**
 * SKETCH3D — Multi-Part Assembly & Auto-Arrange Engine
 * ====================================================
 * Precision build-plate layout and pairwise collision auditing for 3D printed parts.
 * Uses 2D bottom-left shelf bin-packing clamped to the Bambu Lab A1 volume (256x256x256mm),
 * enforces >= 6mm edge margins and inter-part gaps, and aligns part bases flat to Z = 0.
 */

import { getCsg } from './csgKernel.js';

export const BED_SIZE_MM = 256;
export const BED_HEIGHT_MM = 256;
export const DEFAULT_BED_MARGIN_MM = 6.0;
export const DEFAULT_PART_GAP_MM = 6.0;

/**
 * Check if two 3D Axis-Aligned Bounding Boxes (AABB) overlap
 * @param {Object} bboxA { min: [x,y,z], max: [x,y,z] }
 * @param {Object} bboxB { min: [x,y,z], max: [x,y,z] }
 * @param {number} [tolerance=0.01]
 * @returns {boolean}
 */
export function checkAABBOverlap(bboxA, bboxB, tolerance = 0.01) {
  return (
    bboxA.min[0] <= bboxB.max[0] - tolerance &&
    bboxA.max[0] >= bboxB.min[0] + tolerance &&
    bboxA.min[1] <= bboxB.max[1] - tolerance &&
    bboxA.max[1] >= bboxB.min[1] + tolerance &&
    bboxA.min[2] <= bboxB.max[2] - tolerance &&
    bboxA.max[2] >= bboxB.min[2] + tolerance
  );
}

/**
 * Audit pairwise volumetric collisions between multiple Manifold solids
 * @param {any[]} parts Array of Manifold instances
 * @param {number} [minCollisionVolumeMm3=0.05] Minimum intersection volume to flag collision
 * @returns {{hasCollisions: boolean, collisions: Array<{indexA: number, indexB: number, overlapVolumeMm3: number}>}}
 */
export function checkPartIntersections(parts, minCollisionVolumeMm3 = 0.05) {
  const collisions = [];
  if (!parts || parts.length < 2) {
    return { hasCollisions: false, collisions };
  }

  const bboxes = parts.map((p) => (p && !p.isEmpty() ? p.boundingBox() : null));

  for (let i = 0; i < parts.length; i++) {
    if (!parts[i] || !bboxes[i]) continue;
    for (let j = i + 1; j < parts.length; j++) {
      if (!parts[j] || !bboxes[j]) continue;

      // 1. Fast AABB pre-filter
      if (!checkAABBOverlap(bboxes[i], bboxes[j])) continue;

      // 2. Exact CSG intersection
      const inter = parts[i].intersect(parts[j]);
      if (!inter.isEmpty()) {
        const vol = inter.getProperties().volume;
        if (vol >= minCollisionVolumeMm3) {
          collisions.push({
            indexA: i,
            indexB: j,
            overlapVolumeMm3: Number(vol.toFixed(3)),
          });
        }
      }
      inter.delete();
    }
  }

  return {
    hasCollisions: collisions.length > 0,
    collisions,
  };
}

/**
 * Auto-arrange multiple parts onto the 256x256mm build plate
 * Aligns bases to Z = 0 and packs using 2D bottom-left shelf packing.
 * @param {any[]} parts Array of Manifold instances or items with boundingBox()
 * @param {Object} [options]
 * @param {number} [options.bedWidth=256] Plate width in mm
 * @param {number} [options.bedDepth=256] Plate depth in mm
 * @param {number} [options.margin=6.0] Distance from plate perimeter
 * @param {number} [options.gap=6.0] Gap between adjacent parts
 * @param {boolean} [options.centerOnBed=true] Center the final packed cluster on the build plate
 * @returns {{arranged: Array<{partIndex: number, translation: number[], width: number, depth: number, height: number}>, fitsOnPlate: boolean, totalFootprint: {width: number, depth: number}}}
 */
export function autoArrangeParts(parts, options = {}) {
  const bedWidth = options.bedWidth ?? BED_SIZE_MM;
  const bedDepth = options.bedDepth ?? BED_SIZE_MM;
  const margin = options.margin ?? DEFAULT_BED_MARGIN_MM;
  const gap = options.gap ?? DEFAULT_PART_GAP_MM;
  const centerOnBed = options.centerOnBed !== false;

  const usableWidth = bedWidth - 2 * margin;
  const usableDepth = bedDepth - 2 * margin;

  if (!parts || parts.length === 0) {
    return { arranged: [], fitsOnPlate: true, totalFootprint: { width: 0, depth: 0 } };
  }

  // 1. Gather bounding boxes and compute dimensions
  const partItems = parts.map((part, index) => {
    const bbox = part.boundingBox();
    const w = bbox.max[0] - bbox.min[0];
    const d = bbox.max[1] - bbox.min[1];
    const h = bbox.max[2] - bbox.min[2];
    return {
      index,
      part,
      bbox,
      w,
      d,
      h,
      area: w * d,
    };
  });

  // 2. Sort parts by descending footprint area
  partItems.sort((a, b) => b.area - a.area);

  // 3. 2D Bottom-Left Shelf Bin Packing
  // Usable coordinate frame: [startX, startY] to [startX + usableWidth, startY + usableDepth]
  const startX = -bedWidth / 2 + margin;
  const startY = -bedDepth / 2 + margin;

  let currentX = startX;
  let currentY = startY;
  let rowHeight = 0;
  let fitsOnPlate = true;

  const placements = [];

  for (const item of partItems) {
    // If part doesn't fit in current row, wrap to new shelf
    if (currentX + item.w > startX + usableWidth + 1e-4) {
      currentX = startX;
      currentY += rowHeight + gap;
      rowHeight = 0;
    }

    // Check if new row exceeds usable depth
    if (currentY + item.d > startY + usableDepth + 1e-4) {
      fitsOnPlate = false;
    }

    // Translation required to position part's min corner at (currentX, currentY, 0)
    const targetX = currentX;
    const targetY = currentY;
    const targetZ = 0; // Flat to build plate bed

    const dx = targetX - item.bbox.min[0];
    const dy = targetY - item.bbox.min[1];
    const dz = targetZ - item.bbox.min[2];

    placements.push({
      partIndex: item.index,
      translation: [dx, dy, dz],
      placedMin: [targetX, targetY, 0],
      placedMax: [targetX + item.w, targetY + item.d, item.h],
      width: item.w,
      depth: item.d,
      height: item.h,
    });

    currentX += item.w + gap;
    rowHeight = Math.max(rowHeight, item.d);
  }

  // 4. Center packed assembly on the bed if requested and all parts fit
  if (centerOnBed && fitsOnPlate && placements.length > 0) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const p of placements) {
      minX = Math.min(minX, p.placedMin[0]);
      maxX = Math.max(maxX, p.placedMax[0]);
      minY = Math.min(minY, p.placedMin[1]);
      maxY = Math.max(maxY, p.placedMax[1]);
    }

    const clusterCenterX = (minX + maxX) / 2;
    const clusterCenterY = (minY + maxY) / 2;
    const shiftX = -clusterCenterX;
    const shiftY = -clusterCenterY;

    for (const p of placements) {
      p.translation[0] += shiftX;
      p.translation[1] += shiftY;
      p.placedMin[0] += shiftX;
      p.placedMax[0] += shiftX;
      p.placedMin[1] += shiftY;
      p.placedMax[1] += shiftY;
    }
  }

  // Re-sort placements by original partIndex
  placements.sort((a, b) => a.partIndex - b.partIndex);

  // Compute final overall footprint
  let finalMinX = Infinity, finalMaxX = -Infinity;
  let finalMinY = Infinity, finalMaxY = -Infinity;
  for (const p of placements) {
    finalMinX = Math.min(finalMinX, p.placedMin[0]);
    finalMaxX = Math.max(finalMaxX, p.placedMax[0]);
    finalMinY = Math.min(finalMinY, p.placedMin[1]);
    finalMaxY = Math.max(finalMaxY, p.placedMax[1]);
  }

  return {
    arranged: placements.map(({ partIndex, translation, width, depth, height }) => ({
      partIndex,
      translation,
      width,
      depth,
      height,
    })),
    fitsOnPlate,
    totalFootprint: {
      width: placements.length > 0 ? finalMaxX - finalMinX : 0,
      depth: placements.length > 0 ? finalMaxY - finalMinY : 0,
    },
  };
}
