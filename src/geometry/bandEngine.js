/**
 * SKETCH3D — Vertical Band Subdivision & Composable Texture Stack
 * =================================================================
 * Splits [minY + rimMargin, maxY - rimMargin] into B horizontal bands (2–24, default 8)
 * and composes base surface textures with per-band operators:
 * 1. Alternating Banded Weave (90°/180° phase shift per band)
 * 2. Slice & Flare (endpoint or midpoint hinge pivot, optional alternating direction)
 * 3. Per-Band Twist & Fluted Waves
 */

import { evaluateDisplacement, computeRimMask } from './textures.js';

/**
 * Computes band index and local normalized height u in [0, 1] for a given Y.
 * @param {number} y
 * @param {number} minY
 * @param {number} maxY
 * @param {number} [rimMargin=4.0]
 * @param {number} [bandCount=8]
 * @returns {{inBand:boolean,bandIndex:number,u:number,bandHeight:number}}
 */
export function getBandCoordinates(y, minY, maxY, rimMargin = 4.0, bandCount = 8) {
  const B = Math.max(2, Math.min(24, Math.round(bandCount || 8)));
  const yStart = minY + rimMargin;
  const yEnd = maxY - rimMargin;
  const span = yEnd - yStart;
  if (span <= 0.5 || y < yStart || y > yEnd) {
    return { inBand: false, bandIndex: 0, u: 0, bandHeight: 0 };
  }
  const bandHeight = span / B;
  const rawIdx = Math.floor((y - yStart) / bandHeight);
  const bandIndex = Math.max(0, Math.min(B - 1, rawIdx));
  const u = Math.max(0, Math.min(1, (y - (yStart + bandIndex * bandHeight)) / bandHeight));
  return { inBand: true, bandIndex, u, bandHeight };
}

/**
 * Evaluates the per-band operator displacement in mm.
 * @param {Object} bandInfo Result from getBandCoordinates
 * @param {number} theta Angle in radians
 * @param {number} r Current radius in mm
 * @param {Object} opts Band options
 * @returns {number} Displacement in mm
 */
export function evaluateBandOperator(bandInfo, theta, r, opts = {}) {
  if (!bandInfo.inBand) return 0;
  const {
    bandMode = 'weave',
    bandFreq = 10,
    bandPhaseDeg = 90,
    bandDepth = 1.0,
    bandFlareDeg = 10,
    bandPivot = 'midpoint',
    bandAltFlare = true
  } = opts;

  const { bandIndex, u, bandHeight } = bandInfo;

  // Conical apex spatial wavelength clamp (>= 2.5mm)
  const N_theta = Math.max(4, Math.min(32, Math.round(bandFreq || 10)));
  const spatialLambda = (2 * Math.PI * Math.max(1, r)) / N_theta;
  const lambdaScale = spatialLambda < 2.5 ? Math.max(0.2, spatialLambda / 2.5) : 1.0;

  if (bandMode === 'weave') {
    const phaseRad = ((bandPhaseDeg ?? 90) * Math.PI) / 180;
    const envelope = Math.sin(Math.PI * u);
    const wave = Math.sin(N_theta * theta + bandIndex * phaseRad);
    return bandDepth * wave * envelope * lambdaScale;
  }

  if (bandMode === 'flare') {
    const alphaRad = ((bandFlareDeg ?? 10) * Math.PI) / 180;
    const dir = bandAltFlare && (bandIndex % 2 === 1) ? -1 : 1;
    const pivot = bandPivot === 'endpoint' ? u : (u - 0.5);
    return dir * bandHeight * Math.tan(alphaRad) * pivot;
  }

  if (bandMode === 'twist_flute') {
    const twistCount = bandIndex % 2 === 0 ? 2 : 3;
    const fluteWave = Math.sin(N_theta * theta + twistCount * Math.PI * 2 * u);
    const envelope = 0.25 + 0.75 * Math.sin(Math.PI * u);
    return bandDepth * fluteWave * envelope * lambdaScale;
  }

  return 0;
}

/**
 * Composes base surface texture + vertical band operator displacement.
 * @param {Object} params
 * @param {number} params.theta
 * @param {number} params.y
 * @param {number} params.r
 * @param {number} params.minY
 * @param {number} params.maxY
 * @param {Object} [params.options]
 * @returns {number} Combined radial displacement in mm
 */
export function evaluateComposableTexture({ theta, y, r, minY, maxY, options = {} }) {
  const {
    pattern = 'none',
    depth = 0.8,
    freq = 24,
    rimMargin = 4.0,
    bandEnabled = false,
    bandCount = 8,
    bandMode = 'weave',
    bandFreq = 10,
    bandPhaseDeg = 90,
    bandDepth = 1.0,
    bandFlareDeg = 10,
    bandPivot = 'midpoint',
    bandAltFlare = true
  } = options;

  const height = maxY - minY;
  const effRimMargin = Math.min(rimMargin, height * 0.18);
  const mask = computeRimMask(y, minY, maxY, effRimMargin);
  if (mask <= 0.0001) return 0;

  let disp = 0;
  if (pattern && pattern !== 'none' && depth > 0) {
    disp += evaluateDisplacement(pattern, depth, freq, theta, y, r);
  }

  if (bandEnabled) {
    const bandInfo = getBandCoordinates(y, minY, maxY, effRimMargin, bandCount);
    disp += evaluateBandOperator(bandInfo, theta, r, {
      bandMode,
      bandFreq,
      bandPhaseDeg,
      bandDepth,
      bandFlareDeg,
      bandPivot,
      bandAltFlare
    });
  }

  return disp * mask;
}
