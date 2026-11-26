/**
 * SKETCH3D — Direct Helical Toolpath Compiler
 * ============================================
 * Compiles revolved/banded profiles directly into continuous helical toolpath waypoints
 * (x, y, z, e, f, fan, kind, bridgeSpanMm, flowMm3S, lineWidth) for Bambu Lab A1.
 */

import { normalizeLatheProfile2D } from './shell3d.js';
import { syncBezierToPoints } from './bezier2d.js';
import { evaluateComposableTexture } from './bandEngine.js';

const FILAMENT_DIAMETER_MM = 1.75;
const FILAMENT_AREA_MM2 = Math.PI * (FILAMENT_DIAMETER_MM * 0.5) ** 2;
const BED_CENTER_X = 128;
const BED_CENTER_Y = 128;

/**
 * Interpolates radius r(y) along a normalized lathe profile (sorted by y ascending).
 * @param {Array<{r:number,y:number}>} sortedProfile
 * @param {number} y
 * @returns {number}
 */
function sampleProfileRadiusAtY(sortedProfile, y) {
  if (sortedProfile.length === 0) return 20;
  if (y <= sortedProfile[0].y) return sortedProfile[0].r;
  const last = sortedProfile[sortedProfile.length - 1];
  if (y >= last.y) return last.r;

  for (let i = 0; i < sortedProfile.length - 1; i++) {
    const a = sortedProfile[i];
    const b = sortedProfile[i + 1];
    if (y >= a.y && y <= b.y) {
      const span = b.y - a.y;
      const t = span > 1e-6 ? (y - a.y) / span : 0;
      return a.r + (b.r - a.r) * t;
    }
  }
  return last.r;
}

/**
 * Evaluates variable line-width modulation (Thick, Arc, Wiggle, Standard).
 * @param {string} primitive
 * @param {number} baseWidth
 * @param {number} theta
 * @param {number} z
 * @returns {number}
 */
function evaluateLineWidth(primitive, baseWidth, theta, z) {
  switch (primitive) {
    case 'thick':
      return baseWidth * (1.0 + 0.35 * Math.abs(Math.sin(theta * 8)));
    case 'arc':
      return baseWidth * (0.9 + 0.35 * Math.cos(theta * 4));
    case 'wiggle':
      return baseWidth * (0.95 + 0.3 * Math.sin(theta * 12 + z * 0.5));
    default:
      return baseWidth;
  }
}

/**
 * Compiles a SKETCH3D part into continuous helical toolpath waypoints.
 * @param {Object} part
 * @param {Object} [options]
 * @returns {{waypoints:Array<Object>, stats:Object}}
 */
export function compilePartToolpath(part, options = {}) {
  if (!part) throw new Error('No active part to compile.');
  if (part.profileType === 'bezier' && part.bezierNodes?.length >= 2) {
    syncBezierToPoints(part, 0.5);
  }
  if (!part.points || part.points.length < 2) {
    throw new Error('Part profile requires at least 2 points.');
  }

  const nozzleDiameter = Number(options.nozzleDiameter) === 0.6 ? 0.6 : 0.4;
  const layerHeight = Math.max(0.16, Math.min(0.32, Number(options.layerHeight) || 0.20));
  const baseLineWidth = Math.max(nozzleDiameter * 0.9, Math.min(nozzleDiameter * 1.6, Number(options.lineWidth) || nozzleDiameter * 1.125));
  const scaleFactor = Number(options.scaleFactor) === 0.5 ? 0.5 : 1.0;
  const primitive = options.primitive || 'standard';
  const requestedZWave = Math.max(0, Math.min(0.6, Number(options.zWaveAmpMm) || 0));
  const requestedSpeed = Math.max(15, Math.min(80, Number(options.printSpeedMmS) || 45));

  const maxAllowedFlow = nozzleDiameter === 0.6 ? 18.0 : 13.5;
  const maxAllowedBridge = nozzleDiameter === 0.6 ? 7.5 : 5.5;

  // Normalize lathe profile into (r >= 0.5, y >= 0) scaled by scaleFactor
  const rawProfile = normalizeLatheProfile2D(part.points);
  let minRawY = Infinity;
  let maxRawY = -Infinity;
  for (const pt of rawProfile) {
    if (pt.y < minRawY) minRawY = pt.y;
    if (pt.y > maxRawY) maxRawY = pt.y;
  }
  const profile = rawProfile
    .map(pt => ({
      r: Math.max(1.0, pt.r * scaleFactor),
      y: (pt.y - minRawY) * scaleFactor
    }))
    .sort((a, b) => a.y - b.y);

  const totalHeight = Math.max(2.0, Math.min(248, (maxRawY - minRawY) * scaleFactor));
  const stepsPerRev = 120;
  const waypoints = [];

  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let totalLengthMm = 0;
  let totalFilamentMm = 0;
  let maxFlowMm3S = 0;
  let maxBridgeSpanMm = 0;
  let maxZSlopeDeg = 0;

  let prevX = null;
  let prevY = null;
  let prevZ = null;

  const pushWaypoint = (x, y, z, speedMmS, fan, kind, lineWidth, isTravel = false) => {
    const cx = Math.max(10, Math.min(246, x));
    const cy = Math.max(10, Math.min(246, y));
    const cz = Math.max(0.20, Math.min(250, z));

    let dist = 0;
    let bridgeSpanMm = 0;
    let zSlopeDeg = 0;
    if (prevX !== null) {
      const dx = cx - prevX;
      const dy = cy - prevY;
      const dz = cz - prevZ;
      const horiz = Math.hypot(dx, dy);
      dist = Math.hypot(horiz, dz);
      bridgeSpanMm = isTravel ? 0 : horiz;
      if (horiz > 1e-4) {
        zSlopeDeg = (Math.atan2(Math.abs(dz), horiz) * 180) / Math.PI;
      }
    }

    // Clamp speed so volumetric flow Q stays safely under nozzle cap
    const maxSpeedForFlow = maxAllowedFlow / Math.max(0.01, lineWidth * layerHeight);
    const effSpeed = Math.min(speedMmS, maxSpeedForFlow);
    const flowMm3S = isTravel ? 0 : lineWidth * layerHeight * effSpeed;
    const e = (isTravel || dist < 1e-5) ? 0 : (dist * lineWidth * layerHeight) / FILAMENT_AREA_MM2;

    bounds.minX = Math.min(bounds.minX, cx);
    bounds.maxX = Math.max(bounds.maxX, cx);
    bounds.minY = Math.min(bounds.minY, cy);
    bounds.maxY = Math.max(bounds.maxY, cy);
    bounds.minZ = Math.min(bounds.minZ, cz);
    bounds.maxZ = Math.max(bounds.maxZ, cz);

    if (!isTravel) {
      totalLengthMm += dist;
      totalFilamentMm += e;
      maxFlowMm3S = Math.max(maxFlowMm3S, flowMm3S);
      maxBridgeSpanMm = Math.max(maxBridgeSpanMm, bridgeSpanMm);
      maxZSlopeDeg = Math.max(maxZSlopeDeg, zSlopeDeg);
    }

    waypoints.push({
      x: Number(cx.toFixed(3)),
      y: Number(cy.toFixed(3)),
      z: Number(cz.toFixed(3)),
      e: Number(e.toFixed(5)),
      f: Math.round(effSpeed * 60),
      fan,
      kind,
      isTravel,
      bridgeSpanMm: Number(bridgeSpanMm.toFixed(3)),
      flowMm3S: Number(flowMm3S.toFixed(3)),
      lineWidth: Number(lineWidth.toFixed(3))
    });

    prevX = cx;
    prevY = cy;
    prevZ = cz;
  };

  // 1. Layer 0 Anchor: 2-loop Brim/Skirt at Z = 0.20mm, slow 25mm/s, fan OFF
  const r0 = sampleProfileRadiusAtY(profile, 0);
  const brimRadii = [r0 + 2.4, r0 + 1.2];
  for (const br of brimRadii) {
    for (let s = 0; s <= 72; s++) {
      const th = (s / 72) * Math.PI * 2;
      pushWaypoint(
        BED_CENTER_X + br * Math.cos(th),
        BED_CENTER_Y + br * Math.sin(th),
        0.20,
        25,
        0,
        'brim',
        baseLineWidth,
        s === 0
      );
    }
  }

  // Layer 0 base perimeter ring at Z = 0.20mm
  for (let s = 0; s <= stepsPerRev; s++) {
    const th = (s / stepsPerRev) * Math.PI * 2;
    pushWaypoint(
      BED_CENTER_X + r0 * Math.cos(th),
      BED_CENTER_Y + r0 * Math.sin(th),
      0.20,
      25,
      0,
      'layer0',
      baseLineWidth,
      s === 0
    );
  }

  // 2. Continuous Helical Body (Z = 0.20 + layerHeight/steps -> totalHeight)
  const layerCount = Math.max(2, Math.floor((totalHeight - 0.20) / layerHeight));
  const rimMargin = Math.min(4.0, totalHeight * 0.18);
  const maxTan22 = Math.tan((22 * Math.PI) / 180);

  for (let layer = 0; layer < layerCount; layer++) {
    for (let s = 0; s < stepsPerRev; s++) {
      const frac = (s + 1) / stepsPerRev;
      const th = frac * Math.PI * 2;
      const baseZ = 0.20 + (layer + frac) * layerHeight;
      if (baseZ > totalHeight) break;

      const baseR = sampleProfileRadiusAtY(profile, baseZ);
      const disp = evaluateComposableTexture({
        theta: th,
        y: baseZ,
        r: baseR,
        minY: 0,
        maxY: totalHeight,
        options: {
          pattern: part.texturePattern || 'none',
          depth: (part.textureDepth ?? 0.8) * scaleFactor,
          freq: part.textureFreq ?? 24,
          rimMargin,
          bandEnabled: !!part.bandEnabled,
          bandCount: part.bandCount ?? 8,
          bandMode: part.bandMode || 'weave',
          bandFreq: part.bandFreq ?? 10,
          bandPhaseDeg: part.bandPhaseDeg ?? 90,
          bandDepth: (part.bandDepth ?? 1.0) * scaleFactor,
          bandFlareDeg: part.bandFlareDeg ?? 10,
          bandPivot: part.bandPivot || 'midpoint',
          bandAltFlare: part.bandAltFlare ?? true
        }
      });

      let effR = Math.max(1.0, baseR + disp);
      // Conical apex / bridge span safety clamp
      const chordEst = (2 * Math.PI * effR) / stepsPerRev;
      if (chordEst > maxAllowedBridge) {
        effR = (maxAllowedBridge * stepsPerRev) / (2 * Math.PI);
      }

      const x = BED_CENTER_X + effR * Math.cos(th);
      const y = BED_CENTER_Y + effR * Math.sin(th);

      // Non-planar Z-wave modulation clamped to <= 22° slope & <= 1.2mm peak-to-valley
      let z = baseZ;
      if (requestedZWave > 0 && baseZ > rimMargin) {
        const waveFreq = Math.max(6, Math.min(16, part.bandFreq ?? 10));
        const maxSlopeDz = chordEst * maxTan22 * 0.85;
        const safeAmp = Math.min(requestedZWave, 0.55, maxSlopeDz);
        z = Math.max(0.20 + layerHeight, baseZ + safeAmp * Math.sin(waveFreq * th));
      }

      const lw = evaluateLineWidth(primitive, baseLineWidth, th, z);
      const isWeaveBridge = baseZ > rimMargin && !!part.bandEnabled && part.bandMode === 'weave';
      const fan = layer === 0 ? 0 : (isWeaveBridge ? 255 : 220);
      const kind = layer === 0 ? 'layer0' : (isWeaveBridge ? 'weave' : 'wall');
      const isStartJump = layer === 0 && s === 0 && prevX !== null && Math.hypot(x - prevX, y - prevY) > 2.5;

      pushWaypoint(x, y, z, requestedSpeed, fan, kind, lw, isStartJump);
    }
  }

  const estimatedGrams = (totalFilamentMm * FILAMENT_AREA_MM2 * 1.24) / 1000;

  return {
    waypoints,
    stats: {
      layerCount,
      totalLengthMm: Number(totalLengthMm.toFixed(1)),
      totalFilamentMm: Number(totalFilamentMm.toFixed(1)),
      estimatedGrams: Number(estimatedGrams.toFixed(2)),
      maxFlowMm3S: Number(maxFlowMm3S.toFixed(2)),
      maxBridgeSpanMm: Number(maxBridgeSpanMm.toFixed(2)),
      maxZSlopeDeg: Number(maxZSlopeDeg.toFixed(1)),
      nozzleDiameter,
      layerHeight,
      scaleFactor,
      bounds
    }
  };
}
