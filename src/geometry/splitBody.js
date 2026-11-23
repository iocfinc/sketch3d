/**
 * SKETCH3D — Parametric Split-Body Lip & Groove Tool
 * ===================================================
 * Manifold-3d powered split-body partitioning for 3D printed enclosures.
 * Enforces minimum 1.6mm wall thickness, automated male stepped lip generation,
 * and matching female groove subtraction with 0.2mm clearance.
 */

import { getCsg, CsgScope } from './csgKernel.js';

export const MIN_WALL_THICKNESS_MM = 1.6;
export const DEFAULT_LIP_HEIGHT_MM = 3.0;
export const DEFAULT_CLEARANCE_MM = 0.2;
export const DEFAULT_WALL_THICKNESS_MM = 2.4;

/**
 * Split a solid body at splitZMm and generate an interlocking lip and groove joint
 * @param {any} manifold Watertight base solid Manifold
 * @param {number} splitZMm Z-height coordinate of the split plane
 * @param {Object} [options]
 * @param {number} [options.wallThicknessMm=2.4] Wall thickness (must be >= 1.6mm)
 * @param {number} [options.lipHeightMm=3.0] Height of the interlocking lip
 * @param {number} [options.clearanceMm=0.2] Interlocking gap clearance
 * @param {'inner'|'outer'} [options.lipPosition='inner'] Whether lip sits on inner or outer wall half
 * @returns {{base: any, lid: any, lipHeight: number, clearance: number}}
 */
export function splitBodyWithLip(manifold, splitZMm, options = {}) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');
  if (!manifold || manifold.isEmpty()) throw new Error('Valid manifold required for split');

  const wallThicknessMm = Number(options.wallThicknessMm ?? DEFAULT_WALL_THICKNESS_MM);
  const lipHeightMm = Number(options.lipHeightMm ?? DEFAULT_LIP_HEIGHT_MM);
  const clearanceMm = Number(options.clearanceMm ?? DEFAULT_CLEARANCE_MM);
  const lipPosition = options.lipPosition || 'inner';

  // Strict FDM enclosure wall thickness audit
  if (wallThicknessMm < MIN_WALL_THICKNESS_MM) {
    throw new Error(
      `Wall thickness must be >= ${MIN_WALL_THICKNESS_MM}mm for interlocking lip/groove (got ${wallThicknessMm.toFixed(2)}mm)`
    );
  }

  const bbox = manifold.boundingBox();
  if (splitZMm <= bbox.min[2] || splitZMm >= bbox.max[2]) {
    throw new Error(
      `Split Z coordinate (${splitZMm}mm) must be strictly within model height bounds [${bbox.min[2].toFixed(1)}, ${bbox.max[2].toFixed(1)}]mm`
    );
  }

  const scope = new CsgScope();

  try {
    // 1. Slice horizontal cross-section at split plane
    const sliceCs = manifold.slice(splitZMm);
    if (sliceCs.isEmpty()) {
      sliceCs.delete();
      throw new Error(`No solid cross-section found at Z = ${splitZMm}mm`);
    }

    // 2. Derive wall perimeter and inner boundary
    const innerBoundary = sliceCs.offset(-wallThicknessMm);
    const step = wallThicknessMm / 2;

    let maleLipCs;
    let grooveCs;

    if (lipPosition === 'inner') {
      // Male lip on inner half of wall
      const lipOuter = sliceCs.offset(-step);
      maleLipCs = lipOuter.subtract(innerBoundary);
      lipOuter.delete();

      // Female groove dilated by clearance
      const grooveOuter = sliceCs.offset(-step + clearanceMm / 2);
      const grooveInner = innerBoundary.offset(-clearanceMm / 2);
      grooveCs = grooveOuter.subtract(grooveInner);
      grooveOuter.delete();
      grooveInner.delete();
    } else {
      // Male lip on outer half of wall
      const lipInner = sliceCs.offset(-step);
      maleLipCs = sliceCs.subtract(lipInner);
      lipInner.delete();

      // Female groove dilated by clearance
      const grooveOuter = sliceCs.offset(clearanceMm / 2);
      const grooveInner = sliceCs.offset(-step - clearanceMm / 2);
      grooveCs = grooveOuter.subtract(grooveInner);
      grooveOuter.delete();
      grooveInner.delete();
    }

    innerBoundary.delete();
    sliceCs.delete();

    // 3. Extrude male lip solid (from splitZ to splitZ + lipHeight)
    const maleLipSolid = scope.track(
      csg.Manifold.extrude(maleLipCs, lipHeightMm).translate([0, 0, splitZMm])
    );
    maleLipCs.delete();

    // 4. Extrude female groove cutter (slightly extended vertically for clean seating)
    const grooveHeight = lipHeightMm + 0.2;
    const femaleGrooveCutter = scope.track(
      csg.Manifold.extrude(grooveCs, grooveHeight).translate([0, 0, splitZMm - 0.05])
    );
    grooveCs.delete();

    // 5. Partition body at split plane
    // splitByPlane([0, 0, 1], splitZMm) returns [topPart (Z >= splitZ), bottomPart (Z <= splitZ)]
    const pair = manifold.splitByPlane([0, 0, 1], splitZMm);
    const rawLid = scope.track(pair[0]);
    const rawBase = scope.track(pair[1]);

    // 6. Assemble base with male lip and lid with female groove
    const baseWithLip = rawBase.add(maleLipSolid);
    const lidWithGroove = rawLid.subtract(femaleGrooveCutter);

    return {
      base: baseWithLip,
      lid: lidWithGroove,
      lipHeight: lipHeightMm,
      clearance: clearanceMm,
      wallThickness: wallThicknessMm,
      splitZ: splitZMm,
    };
  } finally {
    scope.dispose();
  }
}

/**
 * Audit whether two interlocking bodies collide (should have zero interference when assembled)
 * @param {any} base Interlocking base solid
 * @param {any} lid Interlocking lid solid
 * @returns {{isCollisionFree: boolean, interferenceVolumeMm3: number}}
 */
export function checkJointInterference(base, lid) {
  if (!base || !lid) return { isCollisionFree: true, interferenceVolumeMm3: 0 };
  const intersection = base.intersect(lid);
  const vol = intersection.isEmpty() ? 0 : intersection.getProperties().volume;
  intersection.delete();

  return {
    isCollisionFree: vol < 0.01,
    interferenceVolumeMm3: vol,
  };
}
