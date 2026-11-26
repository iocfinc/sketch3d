/**
 * SKETCH3D — Unified Parametric Mesh Builder
 * ===========================================
 * Integrates Round (fillets), Bevel, Twist, 3D Shelling (Hollow / Vase Proxy),
 * Standoffs, and Procedural Surface Textures across Extrude & Revolve modes.
 */

import { computeShellInner, buildHollowExtrudeGeometry, buildHollowLatheProfile, subdividePolygon2D, subdivideLatheProfile2D, computePolygonCentroid2D, normalizeLatheProfile2D, triangulatePolygon2D, polyArea } from './shell3d.js';
import { applySurfaceTexture } from './textures.js';
import { syncBezierToPoints } from './bezier2d.js';
import { DATUM_PLANES, transformGeometryToPlane } from '../canvas/planeSelector.js';
import { createCompatGeometry, buildOpenWeaveMesh } from './openWeaveMesh.js';
import { buildLoftGeometry } from './loftBuilder.js';

export { createCompatGeometry };

/**
 * Builds filleted 2D segments for polygon corners.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} radius
 * @param {boolean} closed
 * @returns {Array<Object>|null}
 */
export function buildFilletedSegments(pts, radius, closed) {
  if (!pts || pts.length < 3 || !radius || radius <= 0 || !closed) return null;
  const segs = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 0.01 || l2 < 0.01) continue;

    const d = Math.min(radius, 0.45 * l1, 0.45 * l2);
    segs.push({
      pIn: { x: curr.x + (v1x / l1) * d, y: curr.y + (v1y / l1) * d },
      ctrl: curr,
      pOut: { x: curr.x + (v2x / l2) * d, y: curr.y + (v2y / l2) * d }
    });
  }
  return segs.length >= 3 ? segs : null;
}

/**
 * Creates a THREE.Shape from polygon points, corner fillets, cutouts, and holes.
 * @param {Object} part
 * @returns {THREE.Shape}
 */
export function createPartShape(part, THREE = globalThis.THREE) {
  if (!THREE?.Shape) return null;
  const shape = new THREE.Shape();
  const segs = buildFilletedSegments(part.points, part.cornerRadius, part.isClosed);

  if (segs && segs.length >= 3) {
    shape.moveTo(segs[0].pIn.x, -segs[0].pIn.y);
    segs.forEach((s, i) => {
      shape.quadraticCurveTo(s.ctrl.x, -s.ctrl.y, s.pOut.x, -s.pOut.y);
      const next = segs[(i + 1) % segs.length];
      shape.lineTo(next.pIn.x, -next.pIn.y);
    });
    shape.closePath();
  } else {
    part.points.forEach((pt, idx) => {
      if (idx === 0) shape.moveTo(pt.x, -pt.y);
      else shape.lineTo(pt.x, -pt.y);
    });
    shape.closePath();
  }

  // Add Screw Holes
  (part.holes || []).forEach(h => {
    const hp = new THREE.Path();
    hp.absarc(h.x, -h.y, h.r, 0, Math.PI * 2, true);
    shape.holes.push(hp);
  });

  // Add Cutout Polygons
  (part.cutouts || []).forEach(poly => {
    if (poly.length < 3) return;
    const cp = new THREE.Path();
    poly.forEach((pt, idx) => {
      if (idx === 0) cp.moveTo(pt.x, -pt.y);
      else cp.lineTo(pt.x, -pt.y);
    });
    cp.closePath();
    shape.holes.push(cp);
  });

  return shape;
}

/**
 * Builds 3D mesh geometry for Revolve 360° (Lathe).
 * @param {Object} part
 * @returns {THREE.BufferGeometry|null}
 */
export function buildRevolveGeometry(part, THREE = globalThis.THREE) {
  if (part.profileType === 'bezier' && part.bezierNodes && part.bezierNodes.length >= 2) {
    syncBezierToPoints(part, 0.5);
  }
  if (!part.points || part.points.length < 2) return null;

  // Adaptive circumferential subdivision to prevent wave facet aliasing
  const freq = part.textureFreq || 24;
  const latheSegments = Math.max(48, freq * 4);

  let geom = null;
  let lathePts = null;
  const isHollow = part.shellEnabled && part.shellMode === 'hollow';
  const isLampshade = part.intent === 'lampshade';
  const hasTex = (part.texturePattern && part.texturePattern !== 'none') || !!part.bandEnabled;

  if (isHollow) {
    lathePts = buildHollowLatheProfile(part.points, part.shellThickness, isLampshade, hasTex, THREE);
  } else {
    const profile = normalizeLatheProfile2D(part.points);
    const subProfile = hasTex ? subdivideLatheProfile2D(profile, 1.0) : profile;
    lathePts = subProfile.map(p => {
      const v = THREE?.Vector2 ? new THREE.Vector2(p.r, p.y) : { x: p.r, y: p.y, clone() { return { x: this.x, y: this.y, isOuter: this.isOuter, clone: this.clone }; } };
      v.isOuter = true;
      return v;
    });
    if (part.isClosed && lathePts.length > 0) {
      const vClose = lathePts[0].clone();
      vClose.isOuter = true;
      lathePts.push(vClose);
    }
  }

  if (lathePts && lathePts.length >= 2) {
    if (THREE?.LatheGeometry) {
      geom = new THREE.LatheGeometry(lathePts, latheSegments);
      const pos = geom.attributes.position;
      const numPts = lathePts.length;
      const outerMasks = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        outerMasks[i] = (lathePts[i % numPts]?.isOuter) ? 1.0 : 0.0;
      }
      geom.setAttribute('aOuterWallMask', new THREE.Float32BufferAttribute(outerMasks, 1));
    } else {
      const positions = [], indices = [], outerMasks = [];
      const nPts = lathePts.length;
      for (let s = 0; s <= latheSegments; s++) {
        const th = (s / latheSegments) * Math.PI * 2;
        const sinT = Math.sin(th), cosT = Math.cos(th);
        for (let i = 0; i < nPts; i++) {
          positions.push(lathePts[i].x * sinT, lathePts[i].y, lathePts[i].x * cosT);
          outerMasks.push(lathePts[i].isOuter ? 1.0 : 0.0);
        }
      }
      for (let s = 0; s < latheSegments; s++) {
        for (let i = 0; i < nPts - 1; i++) {
          const a = s * nPts + i, b = (s + 1) * nPts + i, c = (s + 1) * nPts + i + 1, d = s * nPts + i + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
      geom = createCompatGeometry(positions, null, indices, outerMasks, THREE);
    }
  }
  if (!geom) return null;

  geom.computeBoundingBox();
  geom.translate(0, -geom.boundingBox.min.y + (part.baseZ || 0), 0);

  // Apply Surface Texture
  if (hasTex) {
    applySurfaceTexture(geom, {
      pattern: part.texturePattern || 'none',
      depth: part.textureDepth ?? 0.8,
      freq: part.textureFreq ?? 24,
      bandEnabled: !!part.bandEnabled,
      bandCount: part.bandCount ?? 8,
      bandMode: part.bandMode || 'weave',
      bandFreq: part.bandFreq ?? 10,
      bandPhaseDeg: part.bandPhaseDeg ?? 90,
      bandDepth: part.bandDepth ?? 1.0,
      bandFlareDeg: part.bandFlareDeg ?? 10,
      bandPivot: part.bandPivot || 'midpoint',
      bandAltFlare: part.bandAltFlare ?? true
    });
  }

  return geom;
}

/**
 * Builds 3D mesh geometry for Extrude.
 * @param {Object} part
 * @returns {THREE.BufferGeometry|null}
 */
export function buildExtrudeGeometry(part, THREE = globalThis.THREE) {
  if (!part.points || part.points.length < 3) return null;

  const height = Math.max(1, part.extrudeHeight || 8);
  const twistDeg = part.twistDeg || 0;
  const isHollow = part.shellEnabled && part.shellMode === 'hollow';
  const isLampshade = part.intent === 'lampshade';

  let geom = null;

  if (isHollow && part.isClosed) {
    const innerPts = computeShellInner(part.points, part.shellThickness || 1.2);
    if (innerPts && innerPts.length >= 3) {
      const floorT = Math.max(0.8, part.shellThickness || 1.2);
      geom = buildHollowExtrudeGeometry(part.points, innerPts, height, floorT, twistDeg, isLampshade, {
        texturePattern: part.texturePattern || 'none',
        textureFreq: part.textureFreq || 24
      }, THREE);
    }
  }

  if (!geom) {
    // Solid Extrude or Vase Proxy Manifold
    const hasTex = part.texturePattern && part.texturePattern !== 'none';
    let solidPts = part.points;
    if (hasTex && !(part.cornerRadius > 0)) {
      let perimeter = 0;
      for (let i = 0; i < solidPts.length; i++) {
        perimeter += Math.hypot(solidPts[(i + 1) % solidPts.length].x - solidPts[i].x, solidPts[(i + 1) % solidPts.length].y - solidPts[i].y);
      }
      const maxStepMm = Math.max(0.4, Math.min(1.2, perimeter / Math.max(48, (part.textureFreq || 24) * 4)));
      solidPts = subdividePolygon2D(solidPts, maxStepMm);
    }
    const steps = (twistDeg > 0 || hasTex) ? Math.max(24, Math.round(height / 1.0)) : 1;

    if (THREE?.ExtrudeGeometry) {
      const shape = createPartShape({ ...part, points: solidPts }, THREE);
      geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        steps,
        bevelEnabled: (part.bevelSize || 0) > 0,
        bevelThickness: part.bevelSize || 0.5,
        bevelSize: part.bevelSize || 0.5,
        bevelSegments: 2
      });
      geom.rotateX(-Math.PI / 2);
    } else {
      const positions = [], indices = [], masks = [];
      const outerCCW = polyArea(solidPts) > 0;
      const n = solidPts.length;
      for (let s = 0; s < steps; s++) {
        const y0 = (s / steps) * height, y1 = ((s + 1) / steps) * height;
        for (let i = 0; i < n; i++) {
          const a = solidPts[i], b = solidPts[(i + 1) % n];
          const base = positions.length / 3;
          positions.push(a.x, y0, -a.y, b.x, y0, -b.y, b.x, y1, -b.y, a.x, y1, -a.y);
          masks.push(1, 1, 1, 1);
          if (outerCCW) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
      const tris = triangulatePolygon2D(solidPts);
      for (const [i, j, k] of tris) {
        const b0 = positions.length / 3;
        positions.push(solidPts[i].x, 0, -solidPts[i].y, solidPts[j].x, 0, -solidPts[j].y, solidPts[k].x, 0, -solidPts[k].y);
        masks.push(0, 0, 0);
        if (outerCCW) indices.push(b0, b0 + 2, b0 + 1); else indices.push(b0, b0 + 1, b0 + 2);
        const b1 = positions.length / 3;
        positions.push(solidPts[i].x, height, -solidPts[i].y, solidPts[j].x, height, -solidPts[j].y, solidPts[k].x, height, -solidPts[k].y);
        masks.push(0, 0, 0);
        if (outerCCW) indices.push(b1, b1 + 1, b1 + 2); else indices.push(b1, b1 + 2, b1 + 1);
      }
      geom = createCompatGeometry(positions, null, indices, masks, THREE);
    }

    if (twistDeg > 0) {
      const centroid = computePolygonCentroid2D(part.points);
      const cx3d = centroid.x;
      const cz3d = centroid.y;
      const pos = geom.attributes.position;
      const maxRad = (twistDeg * Math.PI) / 180;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const angle = (Math.max(0, y) / height) * maxRad;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const rx = x - cx3d;
        const rz = z - cz3d;
        pos.setX(i, rx * cosA - rz * sinA + cx3d);
        pos.setZ(i, rx * sinA + rz * cosA + cz3d);
      }
      geom.computeVertexNormals();
    }
  }

  if (part.baseZ > 0) {
    geom.translate(0, part.baseZ, 0);
  }

  // Apply Surface Texture
  if (part.texturePattern && part.texturePattern !== 'none') {
    applySurfaceTexture(geom, {
      pattern: part.texturePattern,
      depth: part.textureDepth ?? 0.8,
      freq: part.textureFreq ?? 24
    });
  }

  return geom;
}

/**
 * Builds standoff bosses geometry for M3/M4 screws.
 * @param {Object} part
 * @returns {Array<THREE.Mesh>}
 */
export function buildStandoffMeshes(part, material, THREE = globalThis.THREE) {
  if (!part.standoffs || part.standoffs.length === 0 || !THREE?.Shape) return [];
  const meshes = [];
  const height = Math.max(1, part.extrudeHeight || 8);

  part.standoffs.forEach(s => {
    const bossShape = new THREE.Shape();
    bossShape.absarc(s.x, -s.y, 3.6, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(s.x, -s.y, 1.6, 0, Math.PI * 2, true);
    bossShape.holes.push(holePath);

    const bGeom = new THREE.ExtrudeGeometry(bossShape, { depth: height, bevelEnabled: false });
    bGeom.rotateX(-Math.PI / 2);
    if (part.baseZ > 0) bGeom.translate(0, part.baseZ, 0);

    const m = new THREE.Mesh(bGeom, material?.clone ? material.clone() : material);
    meshes.push(m);
  });

  return meshes;
}

/**
 * Unified geometry builder entry point.
 * @param {Object} part
 * @param {any} [THREE]
 * @returns {any}
 */
export function buildPartGeometry(part, THREE = globalThis.THREE) {
  if (!part || !part.points || part.points.length < 2) return null;
  let geom;
  if (part.texturePattern === 'open-weave' || part.texturePattern === 'perforated-weave') {
    geom = buildOpenWeaveMesh(part, THREE);
  } else if (part.type === 'loft') {
    geom = buildLoftGeometry(part, THREE);
  } else {
    geom = part.type === 'revolve' ? buildRevolveGeometry(part, THREE) : buildExtrudeGeometry(part, THREE);
  }
  if (geom && part.sketchPlane && part.sketchPlane !== 'XY' && DATUM_PLANES[part.sketchPlane]) {
    if (THREE) transformGeometryToPlane(geom, DATUM_PLANES[part.sketchPlane], THREE);
    else geom.applyMatrix4?.({ elements: DATUM_PLANES[part.sketchPlane].matrix });
  }
  return geom;
}
