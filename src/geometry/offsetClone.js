/**
 * SKETCH3D — Linked Concentric Offset Shell Clone
 * ================================================
 * Offsets 2D profiles along outward 2D profile normals (2–20mm, default 10mm)
 * and keeps linked concentric outer shells synchronized with their parent Bezier/poly profile.
 */

import { syncBezierToPoints } from './bezier2d.js';

/**
 * Computes outward 2D profile normals and offsets points by deltaOffsetMm.
 * @param {Array<{x:number,y:number}>} points
 * @param {number} [deltaOffsetMm=10]
 * @param {boolean} [isClosed=false]
 * @param {boolean} [isRevolve=false]
 * @returns {Array<{x:number,y:number}>}
 */
export function offsetProfile2D(points, deltaOffsetMm = 10, isClosed = false, isRevolve = false) {
  if (!points || points.length < 2) return (points || []).map(p => ({ ...p }));
  const n = points.length;
  const delta = Number(deltaOffsetMm) || 0;

  // Determine polygon winding for closed non-revolve shapes
  let areaSign = 1;
  if (isClosed && !isRevolve && n >= 3) {
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      area2 += a.x * b.y - b.x * a.y;
    }
    areaSign = area2 >= 0 ? 1 : -1;
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const prevIdx = isClosed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const nextIdx = isClosed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const pPrev = points[prevIdx];
    const pCur = points[i];
    const pNext = points[nextIdx];

    const dx1 = pCur.x - pPrev.x;
    const dy1 = pCur.y - pPrev.y;
    const len1 = Math.hypot(dx1, dy1);

    const dx2 = pNext.x - pCur.x;
    const dy2 = pNext.y - pCur.y;
    const len2 = Math.hypot(dx2, dy2);

    let nx = 0;
    let ny = 0;
    let count = 0;

    const addSegNormal = (dx, dy, len) => {
      if (len < 1e-6) return;
      // Right-hand normal (dy, -dx) vs left-hand (-dy, dx)
      let snx = (dy / len) * areaSign;
      let sny = (-dx / len) * areaSign;
      if (isRevolve && snx < 0) {
        snx = -snx;
        sny = -sny;
      }
      nx += snx;
      ny += sny;
      count++;
    };

    if (i > 0 || isClosed) addSegNormal(dx1, dy1, len1);
    if (i < n - 1 || isClosed) addSegNormal(dx2, dy2, len2);

    if (count === 0) {
      nx = 1;
      ny = 0;
    } else {
      const nLen = Math.hypot(nx, ny) || 1;
      nx /= nLen;
      ny /= nLen;
    }

    if (isRevolve && nx < 0) {
      nx = -nx;
      ny = -ny;
    }

    let ox = pCur.x + nx * delta;
    const oy = pCur.y + ny * delta;
    if (isRevolve) {
      ox = Math.max(0.5, ox);
    }

    out.push({
      x: Math.round(ox * 1000) / 1000,
      y: Math.round(oy * 1000) / 1000
    });
  }

  return out;
}

/**
 * Creates a linked concentric offset shell clone from a parent part.
 * @param {Object} parentPart
 * @param {number} [deltaOffsetMm=10]
 * @returns {Object}
 */
export function createLinkedOffsetClone(parentPart, deltaOffsetMm = 10) {
  if (parentPart.profileType === 'bezier' && parentPart.bezierNodes?.length >= 2) {
    syncBezierToPoints(parentPart, 0.5);
  }
  const offset = Math.max(2, Math.min(20, Number(deltaOffsetMm) || 10));
  const isRevolve = parentPart.type === 'revolve';
  const offsetPts = offsetProfile2D(parentPart.points, offset, !!parentPart.isClosed, isRevolve);

  return {
    id: 'p_clone_' + Math.random().toString(36).slice(2, 7),
    name: `${parentPart.name} (Outer +${offset}mm)`,
    linkedParentId: parentPart.id,
    offsetMm: offset,
    offsetDistance: offset,
    materialName: 'Clear PLA',
    type: parentPart.type || 'revolve',
    intent: parentPart.intent || 'lampshade',
    profileType: 'poly',
    points: offsetPts,
    isClosed: !!parentPart.isClosed,
    holes: [],
    standoffs: [],
    cutouts: [],
    baseZ: parentPart.baseZ || 0,
    extrudeHeight: parentPart.extrudeHeight || 8,
    cornerRadius: 0,
    shellEnabled: parentPart.shellEnabled ?? true,
    shellMode: parentPart.shellMode || 'hollow',
    shellThickness: parentPart.shellThickness || 1.2,
    bevelSize: parentPart.bevelSize ?? 0,
    twistDeg: parentPart.twistDeg || 0,
    sketchPlane: parentPart.sketchPlane || 'XZ',
    texturePattern: parentPart.texturePattern || 'none',
    textureDepth: parentPart.textureDepth ?? 0.8,
    textureFreq: parentPart.textureFreq ?? 24,
    bandEnabled: false,
    bandCount: 8,
    bandMode: 'weave',
    bandFreq: 10,
    bandPhaseDeg: 90,
    bandDepth: 1.0,
    bandFlareDeg: 10,
    bandPivot: 'midpoint',
    bandAltFlare: true,
    color: '#73E6F1'
  };
}

/**
 * Synchronizes all linked offset clones in state.parts from their parent parts.
 * @param {Array<Object>} parts
 */
export function syncLinkedClones(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return;
  const byId = new Map(parts.map(p => [p.id, p]));

  for (const part of parts) {
    if (!part.linkedParentId) continue;
    const parent = byId.get(part.linkedParentId);
    if (!parent) continue;

    if (parent.profileType === 'bezier' && parent.bezierNodes?.length >= 2) {
      syncBezierToPoints(parent, 0.5);
    }

    const offset = Math.max(2, Math.min(20, Number(part.offsetMm ?? part.offsetDistance ?? 10)));
    const isRevolve = parent.type === 'revolve';
    part.type = parent.type;
    part.sketchPlane = parent.sketchPlane;
    part.isClosed = !!parent.isClosed;
    part.baseZ = parent.baseZ || 0;
    part.extrudeHeight = parent.extrudeHeight || 8;
    part.points = offsetProfile2D(parent.points, offset, !!parent.isClosed, isRevolve);
  }
}
