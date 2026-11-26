/**
 * SKETCH3D — Concentric Revolve & Stepped Flange Tool (Lab 2 Hubs & Pulleys)
 * =========================================================================
 * Generates concentric revolved half-plane profiles from stepped segments.
 * Features automated 45° support-free chamfer insertion and overhang auditing.
 */

/**
 * Audit stepped segments for 3D printing overhang risks (angles > 45° from vertical)
 * @param {Array<{od: number, id?: number, height: number, chamfer45?: boolean}>} segments
 * @returns {{ isSupportFree: boolean, warnings: Array<string> }}
 */
export function auditRevolveOverhangs(segments) {
  const warnings = [];
  let isSupportFree = true;

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    const currentR = current.od / 2;
    const nextR = next.od / 2;

    // Overhang occurs when a higher segment expands outward without a chamfer
    if (nextR > currentR) {
      if (!current.chamfer45 && !next.chamfer45) {
        isSupportFree = false;
        warnings.push(
          `Step ${i} -> ${i + 1}: diameter expands ${current.od}mm -> ${next.od}mm without 45° support chamfer (overhang requires supports).`
        );
      }
    }
  }

  return { isSupportFree, warnings };
}

/**
 * Build 2D (R, Z) cross-section half-plane points for stepped concentric revolve
 * @param {Array<{od: number, id?: number, height: number, chamfer45?: boolean}>} segments
 * @param {object} [options]
 * @param {boolean} [options.autoChamfer=true] Auto-insert 45° chamfers on upward steps
 * @returns {Array<{r: number, z: number}>}
 */
export function buildSteppedRevolveProfile(segments, options = {}) {
  const autoChamfer = options.autoChamfer ?? true;
  if (!segments || segments.length === 0) return [];

  const outerPoints = [];
  const innerPoints = [];
  let currentZ = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const rOuter = Math.max(0.5, seg.od / 2);
    const rInner = Math.max(0, (seg.id || 0) / 2);
    const segH = Math.max(0.1, seg.height);

    // If starting or continuing outer wall
    if (i > 0) {
      const prevOuter = outerPoints[outerPoints.length - 1].r;
      const deltaR = rOuter - prevOuter;

      if (deltaR > 0.01) {
        // Stepping outward (potential overhang)
        if (autoChamfer || seg.chamfer45) {
          // 45° transition: deltaZ = deltaR
          const chamferZ = deltaR;
          outerPoints.push({ r: prevOuter, z: currentZ });
          outerPoints.push({ r: rOuter, z: currentZ + chamferZ });
          currentZ += chamferZ;
        } else {
          // 90° horizontal ledge
          outerPoints.push({ r: prevOuter, z: currentZ });
          outerPoints.push({ r: rOuter, z: currentZ });
        }
      } else if (deltaR < -0.01) {
        // Stepping inward (top ledge)
        outerPoints.push({ r: prevOuter, z: currentZ });
        outerPoints.push({ r: rOuter, z: currentZ });
      }
    } else {
      outerPoints.push({ r: rOuter, z: currentZ });
    }

    currentZ += segH;
    outerPoints.push({ r: rOuter, z: currentZ });

    // Track inner profile (going up, will be reversed later)
    innerPoints.push({ r: rInner, z: currentZ - segH });
    innerPoints.push({ r: rInner, z: currentZ });
  }

  // Combine outer points (bottom to top) with inner points reversed (top to bottom)
  // to form a continuous closed loop in the (R, Z) plane.
  const closedLoop = [...outerPoints];

  for (let j = innerPoints.length - 1; j >= 0; j--) {
    const pt = innerPoints[j];
    // Avoid duplicate point if inner radius is 0
    closedLoop.push({ r: pt.r, z: pt.z });
  }

  return closedLoop;
}

import { createCompatGeometry } from './openWeaveMesh.js';

/**
 * Revolve an (R, Z) half-plane profile into a watertight 3D BufferGeometry
 * @param {Array<{r: number, z: number}>} rzPoints
 * @param {number} [radialSegments=48]
 * @param {any} [THREE]
 * @returns {any}
 */
export function createRevolvedConcentricGeometry(rzPoints, radialSegments = 48, THREE = globalThis.THREE) {
  if (!rzPoints || rzPoints.length < 3) {
    return createCompatGeometry([], null, null, null, THREE);
  }

  if (THREE?.LatheGeometry && THREE?.Vector2) {
    const points2D = rzPoints.map(p => new THREE.Vector2(Math.max(0.001, p.r), p.z));
    const latheGeom = new THREE.LatheGeometry(points2D, radialSegments, 0, Math.PI * 2);
    latheGeom.computeVertexNormals();
    return latheGeom;
  }

  const segs = Math.max(12, Math.round(radialSegments));
  const nPts = rzPoints.length;
  const positions = [];
  const indices = [];
  for (let s = 0; s <= segs; s++) {
    const th = (s / segs) * Math.PI * 2;
    const sinT = Math.sin(th), cosT = Math.cos(th);
    for (let i = 0; i < nPts; i++) {
      const r = Math.max(0.001, rzPoints[i].r);
      positions.push(r * sinT, rzPoints[i].z, r * cosT);
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < nPts - 1; i++) {
      const a = s * nPts + i, b = (s + 1) * nPts + i;
      const c = (s + 1) * nPts + i + 1, d = s * nPts + i + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  return createCompatGeometry(positions, null, indices, null, THREE);
}

/**
 * Builds stepped concentric revolve geometry from segment descriptors.
 */
export function buildSteppedRevolveGeometry(segments, options = {}, THREE = globalThis.THREE) {
  const rzPoints = buildSteppedRevolveProfile(segments, options);
  return createRevolvedConcentricGeometry(rzPoints, options.radialSegments || 48, THREE);
}
