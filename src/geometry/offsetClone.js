/**
 * SKETCH3D — Linked Concentric Offset Shell Clone
 * ================================================
 * Offsets 2D profiles along outward 2D profile normals (2–20mm, default 10mm)
 * and keeps linked concentric outer shells synchronized with their parent Bezier/poly profile.
 */

import { syncBezierToPoints } from './bezier2d.js';

function offsetRevolveHalfProfile(points, delta, isClosed) {
  const n = points.length;
  let minY = Infinity, maxY = -Infinity, maxX = 0, widestIdx = 0;
  for (let i = 0; i < n; i++) {
    const rx = Math.abs(points[i].x);
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].y > maxY) maxY = points[i].y;
    if (rx > maxX) { maxX = rx; widestIdx = i; }
  }
  const widestY = points[widestIdx].y;
  const ySpan = Math.max(1, maxY - minY);

  return points.map((pCur, i) => {
    const rx = Math.abs(pCur.x);
    const prevRx = i > 0 ? Math.abs(points[i - 1].x) : rx;
    const nextRx = i < n - 1 ? Math.abs(points[i + 1].x) : rx;
    const isEnd = i === 0 || i === n - 1;
    const nearAxis = rx <= 1.5 && maxX > 3.0;
    const isBaseCenter = nearAxis && isClosed && Math.abs(pCur.y - widestY) <= Math.max(1.0, ySpan * 0.15);
    const isAxisSpine = nearAxis && isClosed && (prevRx <= 0.6 || nextRx <= 0.6) && Math.abs(pCur.y - widestY) < ySpan * 0.85;
    const isApexTip = nearAxis && (isEnd || isClosed) && Math.abs(pCur.y - widestY) >= ySpan * 0.5 && (Math.abs(pCur.y - minY) < 0.5 || Math.abs(pCur.y - maxY) < 0.5);

    if (isBaseCenter || isAxisSpine) {
      return { x: Math.max(0.5, Math.round(rx * 1000) / 1000), y: Math.round(pCur.y * 1000) / 1000 };
    }
    if (isApexTip) {
      const dirY = pCur.y < widestY ? -1 : 1;
      return {
        x: Math.max(0.5, Math.round(rx * 1000) / 1000),
        y: Math.round((pCur.y + dirY * delta) * 1000) / 1000
      };
    }
    return {
      x: Math.max(0.5, Math.round((rx + delta) * 1000) / 1000),
      y: Math.round(pCur.y * 1000) / 1000
    };
  });
}

/**
 * Computes outward 2D profile normals and offsets points by deltaOffsetMm.
 * For revolved half-profiles (R >= 0), guarantees >= +deltaOffsetMm radial clearance
 * (+2*deltaOffsetMm OD) without horizontal-shelf self-intersections.
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

  if (isRevolve) {
    return offsetRevolveHalfProfile(points, delta, isClosed);
  }

  let areaSign = 1;
  if (isClosed && n >= 3) {
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      area2 += a.x * b.y - b.x * a.y;
    }
    areaSign = area2 >= 0 ? 1 : -1;
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const prevIdx = isClosed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const nextIdx = isClosed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const pPrev = points[prevIdx], pCur = points[i], pNext = points[nextIdx];
    const dx1 = pCur.x - pPrev.x, dy1 = pCur.y - pPrev.y, len1 = Math.hypot(dx1, dy1);
    const dx2 = pNext.x - pCur.x, dy2 = pNext.y - pCur.y, len2 = Math.hypot(dx2, dy2);

    const segNormals = [];
    if ((i > 0 || isClosed) && len1 > 1e-6) segNormals.push({ x: (dy1 / len1) * areaSign, y: (-dx1 / len1) * areaSign });
    if ((i < n - 1 || isClosed) && len2 > 1e-6) segNormals.push({ x: (dy2 / len2) * areaSign, y: (-dx2 / len2) * areaSign });

    let nx = 1, ny = 0, miterScale = 1;
    if (segNormals.length > 0) {
      nx = segNormals.reduce((s, v) => s + v.x, 0);
      ny = segNormals.reduce((s, v) => s + v.y, 0);
      const nLen = Math.hypot(nx, ny) || 1;
      nx /= nLen;
      ny /= nLen;
      if (segNormals.length === 2) {
        const dot = nx * segNormals[0].x + ny * segNormals[0].y;
        miterScale = dot > 0.45 ? Math.min(2.0, 1 / dot) : 1.0;
      }
    }

    out.push({
      x: Math.round((pCur.x + nx * delta * miterScale) * 1000) / 1000,
      y: Math.round((pCur.y + ny * delta * miterScale) * 1000) / 1000
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
    materialTag: 'clear',
    polymer: parentPart.polymer || 'PLA',
    amsSlot: 2,
    type: parentPart.type || 'revolve',
    intent: parentPart.intent || 'lampshade',
    openBottom: parentPart.openBottom ?? (parentPart.intent === 'lampshade'),
    floorThickness: parentPart.floorThickness ?? null,
    topVentMm: parentPart.topVentMm ?? 0,
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
    texturePattern: 'none',
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

/**
 * Proportionally scales a revolved part's 2D profile along its Z/Y height span
 * and propagates updates to any Bezier handles and linked offset clones (ISSUE-006).
 * @param {Object} part
 * @param {number} newHeightMm
 * @param {Array<Object>} [parts=[]]
 * @param {number} [maxHeightMm=256]
 */
export function scaleRevolveHeightMm(part, newHeightMm, parts = [], maxHeightMm = 256) {
  if (!part || part.type !== 'revolve' || !part.points || part.points.length < 2) return;
  const targetH = Math.max(1, Math.min(maxHeightMm - (part.baseZ || 0), Number(newHeightMm) || 8));
  let minY = Infinity, maxY = -Infinity;
  for (const pt of part.points) { minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }
  const curH = Math.max(1e-3, maxY - minY);
  const scale = targetH / curH;
  const anchorY = (minY < -0.01 && maxY >= -0.5) ? maxY : minY;
  part.points = part.points.map(pt => ({ x: pt.x, y: Number((anchorY + (pt.y - anchorY) * scale).toFixed(3)) }));
  if (part.profileType === 'bezier' && part.bezierNodes?.length >= 2) {
    part.bezierNodes.forEach(nd => {
      nd.y = Number((anchorY + (nd.y - anchorY) * scale).toFixed(3));
      if (nd.cpIn) nd.cpIn.y = Number((anchorY + (nd.cpIn.y - anchorY) * scale).toFixed(3));
      if (nd.cpOut) nd.cpOut.y = Number((anchorY + (nd.cpOut.y - anchorY) * scale).toFixed(3));
    });
    syncBezierToPoints(part, 0.5);
  }
  part.extrudeHeight = targetH;
  if (Array.isArray(parts) && parts.length > 0) syncLinkedClones(parts);
}
