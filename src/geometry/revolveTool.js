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

/**
 * Revolve an (R, Z) half-plane profile into a watertight 3D Three.js BufferGeometry
 * @param {Array<{r: number, z: number}>} rzPoints
 * @param {number} [radialSegments=48]
 * @returns {THREE.BufferGeometry}
 */
export function createRevolvedConcentricGeometry(rzPoints, radialSegments = 48) {
  if (!rzPoints || rzPoints.length < 3) {
    return new THREE.BufferGeometry();
  }

  // Convert (r, z) points into Three.js Vector2 points for LatheGeometry
  // LatheGeometry rotates Vector2(x, y) around Y axis where x = radius, y = height
  const points2D = rzPoints.map(p => new THREE.Vector2(Math.max(0.001, p.r), p.z));

  const latheGeom = new THREE.LatheGeometry(points2D, radialSegments, 0, Math.PI * 2);
  latheGeom.computeVertexNormals();

  return latheGeom;
}
