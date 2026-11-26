/**
 * SKETCH3D — 2D-to-2D Loft Mesh Builder
 * ======================================
 * Uniform arc-length closed-loop resampling and watertight solid/hollow
 * loft geometry between a bottom polygon and top profile (scaled, circle, hex, or custom).
 */

import { polyArea, computeShellInner, triangulatePolygon2D, computePolygonCentroid2D } from './shell3d.js';
import { createCompatGeometry } from './openWeaveMesh.js';
import { applySurfaceTexture } from './textures.js';

/**
 * Resamples a closed 2D polygon loop uniformly by arc length into `targetCount` points.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} [targetCount=48]
 * @returns {Array<{x: number, y: number}>}
 */
export function resampleClosedLoop2D(pts, targetCount = 48) {
  if (!pts || pts.length < 3) return (pts || []).map(p => ({ x: p.x, y: p.y }));
  const count = Math.max(6, Math.round(targetCount));
  const n = pts.length;
  const cumLen = [0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cumLen.push(total);
  }
  if (total < 1e-6) return pts.map(p => ({ x: p.x, y: p.y }));

  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (seg < n - 1 && cumLen[seg + 1] < target) seg++;
    const segStart = cumLen[seg];
    const segLen = Math.max(1e-8, cumLen[seg + 1] - segStart);
    const t = Math.max(0, Math.min(1, (target - segStart) / segLen));
    const a = pts[seg], b = pts[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function ensureCCW(pts) {
  return polyArea(pts) >= 0 ? pts.map(p => ({ x: p.x, y: p.y })) : [...pts].reverse().map(p => ({ x: p.x, y: p.y }));
}

function alignLoopStart(loop, refPt) {
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = Math.hypot(loop[i].x - refPt.x, loop[i].y - refPt.y);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx === 0) return loop;
  return [...loop.slice(bestIdx), ...loop.slice(0, bestIdx)];
}

function buildTopProfile(botCCW, part) {
  if (Array.isArray(part.loftTopPoints) && part.loftTopPoints.length >= 3) {
    return ensureCCW(part.loftTopPoints);
  }
  const c = computePolygonCentroid2D(botCCW);
  const scale = Math.max(0.1, Number(part.loftTopScale ?? 0.7));
  const shape = part.loftTopShape || 'scaled';
  if (shape === 'circle' || shape === 'hex') {
    let rSum = 0;
    for (const p of botCCW) rSum += Math.hypot(p.x - c.x, p.y - c.y);
    const r = Math.max(2, (rSum / botCCW.length) * scale);
    const sides = shape === 'hex' ? 6 : Math.max(32, botCCW.length);
    const a0 = Math.atan2(botCCW[0].y - c.y, botCCW[0].x - c.x);
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i / sides) * Math.PI * 2;
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return ensureCCW(pts);
  }
  return botCCW.map(p => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}

function emitTri(positions, indices, a, b, c) {
  const base = positions.length / 3;
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  indices.push(base, base + 1, base + 2);
}

function emitWallBand(positions, masks, indices, ringA, ringB, maskVal, outward) {
  const n = ringA.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const p00 = ringA[i], p10 = ringA[i2], p11 = ringB[i2], p01 = ringB[i];
    const base = positions.length / 3;
    positions.push(...p00, ...p10, ...p11, ...p01);
    for (let k = 0; k < 4; k++) masks.push(maskVal);
    if (outward) {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
}

function interpolateRings(botPts, topPts, yStart, yEnd, steps, centroid, twistRad) {
  const rings = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const y = yStart + (yEnd - yStart) * t;
    const ang = t * twistRad;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ring = [];
    for (let i = 0; i < botPts.length; i++) {
      const lx = botPts[i].x + (topPts[i].x - botPts[i].x) * t;
      const ly = botPts[i].y + (topPts[i].y - botPts[i].y) * t;
      const rx = lx - centroid.x, ry = ly - centroid.y;
      const wx = rx * ca - ry * sa + centroid.x;
      const wy = rx * sa + ry * ca + centroid.y;
      ring.push([wx, y, -wy]);
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * Builds watertight solid or hollow loft BufferGeometry from bottom and top 2D profiles.
 */
export function buildLoftGeometry(part, THREE = globalThis.THREE) {
  if (!part?.points || part.points.length < 3) return null;
  const H = Math.max(1, Number(part.extrudeHeight || 40));
  const twistDeg = Number(part.loftTwistDeg ?? part.twistDeg ?? 0);
  const twistRad = (twistDeg * Math.PI) / 180;
  const hasTex = (part.texturePattern && part.texturePattern !== 'none') || !!part.bandEnabled;

  const botRaw = ensureCCW(part.points);
  const topRaw = buildTopProfile(botRaw, part);
  const targetCount = Math.max(48, botRaw.length, topRaw.length);
  const botOuter = resampleClosedLoop2D(botRaw, targetCount);
  const topOuter = alignLoopStart(resampleClosedLoop2D(topRaw, targetCount), botOuter[0]);
  const centroid = computePolygonCentroid2D(botOuter);
  const steps = (twistDeg !== 0 || hasTex) ? Math.max(20, Math.round(H / 1.5)) : 8;

  const isHollow = Boolean(part.shellEnabled || part.intent === 'lampshade');
  const isLampshade = part.intent === 'lampshade';
  const thickness = Math.max(0.6, Number(part.shellThickness || 1.2));
  const botInner = isHollow ? computeShellInner(botOuter, thickness) : null;
  const topInner = isHollow ? computeShellInner(topOuter, thickness) : null;

  const positions = [];
  const masks = [];
  const indices = [];

  const outerRings = interpolateRings(botOuter, topOuter, 0, H, steps, centroid, twistRad);
  for (let s = 0; s < steps; s++) {
    emitWallBand(positions, masks, indices, outerRings[s], outerRings[s + 1], 1.0, true);
  }

  if (isHollow && botInner && topInner && botInner.length === targetCount && topInner.length === targetCount) {
    const floorT = isLampshade ? 0 : Math.min(H * 0.9, Math.max(0.8, thickness));
    const tFloor = floorT / H;
    const innerBotPts = botInner.map((b, i) => ({
      x: b.x + (topInner[i].x - b.x) * tFloor,
      y: b.y + (topInner[i].y - b.y) * tFloor
    }));
    const innerRings = interpolateRings(innerBotPts, topInner, floorT, H, steps, centroid, twistRad);
    for (let s = 0; s < steps; s++) {
      emitWallBand(positions, masks, indices, innerRings[s], innerRings[s + 1], 0.0, false);
    }
    // Top annular rim (outward=+Y)
    emitWallBand(positions, masks, indices, outerRings[steps], innerRings[steps], 0.0, true);
    if (isLampshade) {
      emitWallBand(positions, masks, indices, outerRings[0], innerRings[0], 0.0, false);
    } else {
      const botTris = triangulatePolygon2D(botOuter);
      for (const [i, j, k] of botTris) {
        emitTri(positions, indices, outerRings[0][i], outerRings[0][k], outerRings[0][j]);
        masks.push(0, 0, 0);
      }
      const inTris = triangulatePolygon2D(innerBotPts);
      for (const [i, j, k] of inTris) {
        emitTri(positions, indices, innerRings[0][i], innerRings[0][j], innerRings[0][k]);
        masks.push(0, 0, 0);
      }
    }
  } else {
    const botTris = triangulatePolygon2D(botOuter);
    for (const [i, j, k] of botTris) {
      emitTri(positions, indices, outerRings[0][i], outerRings[0][k], outerRings[0][j]);
      masks.push(0, 0, 0);
    }
    const topTris = triangulatePolygon2D(topOuter);
    for (const [i, j, k] of topTris) {
      emitTri(positions, indices, outerRings[steps][i], outerRings[steps][j], outerRings[steps][k]);
      masks.push(0, 0, 0);
    }
  }

  const baseZ = Number(part.baseZ || 0);
  if (baseZ !== 0) {
    for (let i = 1; i < positions.length; i += 3) positions[i] += baseZ;
  }

  const geom = createCompatGeometry(positions, null, indices, masks, THREE);
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
