/**
 * SKETCH3D — 4-Stage Geometry Pipeline Cache
 * ===========================================
 * Dirty-flag stage hashes and caching across Stage 1 (profile), Stage 2 (baseGeo),
 * Stage 3 (solidGeo), and Stage 4 (texGeo) so texture/band edits skip Stage 2/3 rebuilds.
 */

import { syncBezierToPoints } from './bezier2d.js';
import { buildRevolveGeometry, buildExtrudeGeometry } from './meshBuilder.js';
import { buildLoftGeometry } from './loftBuilder.js';
import { buildOpenWeaveMesh } from './openWeaveMesh.js';
import { applySurfaceTexture } from './textures.js';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableHash(obj) {
  return fnv1a(JSON.stringify(obj));
}

/**
 * Computes hierarchical stage hashes: profile -> baseGeo -> solidGeo -> texGeo.
 * @param {Object} part
 * @returns {{ profile: string, baseGeo: string, solidGeo: string, texGeo: string }}
 */
export function computeStageHashes(part = {}) {
  const profile = stableHash({
    profileType: part.profileType || 'poly',
    bezierNodes: part.bezierNodes || [],
    points: part.points || [],
    isClosed: !!part.isClosed,
    holes: part.holes || [],
    standoffs: part.standoffs || [],
    cutouts: part.cutouts || [],
    cornerRadius: Number(part.cornerRadius || 0),
    sketchPlane: part.sketchPlane || 'XY'
  });

  const baseGeo = stableHash({
    profile,
    type: part.type || 'extrude',
    extrudeHeight: Number(part.extrudeHeight || 8),
    baseZ: Number(part.baseZ || 0),
    baseMountDiameterMm: Number(part.baseMountDiameterMm || 0),
    topVentMm: Number(part.topVentMm || 0),
    loftTopPoints: part.loftTopPoints || null,
    loftTopShape: part.loftTopShape || 'scaled',
    loftTopScale: part.loftTopScale ?? 0.7,
    loftTwistDeg: Number(part.loftTwistDeg ?? 0)
  });

  const solidGeo = stableHash({
    baseGeo,
    intent: part.intent || 'vessel',
    openBottom: part.openBottom ?? null,
    shellEnabled: !!part.shellEnabled,
    shellMode: part.shellMode || 'hollow',
    shellThickness: Number(part.shellThickness ?? 1.2),
    floorThickness: Number(part.floorThickness || 0),
    bevelSize: Number(part.bevelSize ?? 0),
    twistDeg: Number(part.twistDeg || 0),
    splitMeta: part.splitMeta || null,
    cordSlot: part.cordSlot || null
  });

  const texGeo = stableHash({
    solidGeo,
    texturePattern: part.texturePattern || 'none',
    textureDepth: Number(part.textureDepth ?? 0.8),
    textureFreq: Number(part.textureFreq ?? 24),
    bandEnabled: !!part.bandEnabled,
    bandCount: Number(part.bandCount ?? 8),
    bandMode: part.bandMode || 'weave',
    bandFreq: Number(part.bandFreq ?? 10),
    bandPhaseDeg: Number(part.bandPhaseDeg ?? 90),
    bandDepth: Number(part.bandDepth ?? 1.0),
    bandFlareDeg: Number(part.bandFlareDeg ?? 10),
    bandPivot: part.bandPivot || 'midpoint',
    bandAltFlare: part.bandAltFlare ?? true,
    weaveBands: part.weaveBands ?? 2.5,
    weaveGapMm: part.weaveGapMm ?? 0.8,
    weavePillars: part.weavePillars ?? 16,
    weaveTwistDeg: part.weaveTwistDeg ?? 0,
    wallThicknessMm: part.wallThicknessMm ?? null,
    rimMarginMm: part.rimMarginMm ?? null
  });

  return { profile, baseGeo, solidGeo, texGeo };
}

/**
 * Creates a fresh dirty-flag pipeline cache container.
 */
export function createPipelineCache() {
  return {
    hashes: { profile: null, baseGeo: null, solidGeo: null, texGeo: null },
    profile: null,
    baseGeo: null,
    solidGeo: null,
    texGeo: null,
    stats: { evaluations: 0, lastMs: 0 }
  };
}

function cloneGeom(geom) {
  return geom && typeof geom.clone === 'function' ? geom.clone() : geom;
}

function defaultBuildProfile(part) {
  const copy = {
    profileType: part.profileType || 'poly',
    points: (part.points || []).map(p => ({ x: p.x, y: p.y })),
    bezierNodes: (part.bezierNodes || []).map(n => ({ ...n }))
  };
  if (copy.profileType === 'bezier' && copy.bezierNodes.length >= 2) {
    syncBezierToPoints(copy, 0.5);
  }
  return copy;
}

function resolvePartWithProfile(part, profile) {
  if (Array.isArray(profile)) return { ...part, points: profile };
  if (profile && typeof profile === 'object' && Array.isArray(profile.points)) {
    return {
      ...part,
      points: profile.points,
      bezierNodes: Array.isArray(profile.bezierNodes) ? profile.bezierNodes : part.bezierNodes,
      profileType: profile.profileType || part.profileType
    };
  }
  return part;
}

function defaultBuildBase(part, profile, THREE) {
  const clean = {
    ...resolvePartWithProfile(part, profile),
    shellEnabled: false,
    floorThickness: 0,
    splitMeta: null,
    cordSlot: null,
    bevelSize: 0,
    twistDeg: 0,
    texturePattern: 'ripple',
    textureDepth: 0,
    bandEnabled: false
  };
  if (clean.type === 'loft') return buildLoftGeometry(clean, THREE);
  if (clean.type === 'revolve') return buildRevolveGeometry(clean, THREE);
  return buildExtrudeGeometry(clean, THREE);
}

function defaultBuildSolid(part, baseGeo, profile, THREE) {
  const hasSolidMod = Boolean(
    part.shellEnabled ||
    Number(part.bevelSize || 0) > 0 ||
    Number(part.twistDeg || 0) !== 0 ||
    part.splitMeta ||
    Number(part.floorThickness || 0) > 0 ||
    part.openBottom !== undefined ||
    Number(part.topVentMm || 0) > 0 ||
    Number(part.baseMountDiameterMm || 0) > 0 ||
    part.cordSlot
  );
  if (!hasSolidMod && baseGeo) return cloneGeom(baseGeo);
  const preTex = {
    ...resolvePartWithProfile(part, profile),
    texturePattern: 'ripple',
    textureDepth: 0,
    bandEnabled: false
  };
  if (preTex.type === 'loft') return buildLoftGeometry(preTex, THREE);
  if (preTex.type === 'revolve') return buildRevolveGeometry(preTex, THREE);
  return buildExtrudeGeometry(preTex, THREE);
}

function defaultApplyTexture(part, solidGeo, THREE) {
  if (part.texturePattern === 'open-weave' || part.texturePattern === 'perforated-weave') {
    return buildOpenWeaveMesh(part, THREE);
  }
  const cloned = cloneGeom(solidGeo);
  const hasTex = (part.texturePattern && part.texturePattern !== 'none') || !!part.bandEnabled;
  if (!hasTex || !cloned) return cloned;
  return applySurfaceTexture(cloned, {
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

/**
 * Evaluates a part through the 4-stage pipeline cache.
 * Clones cached `solidGeo` before applying Stage 4 displacement so Stage 2/3 stay intact.
 */
export function evaluatePartWithCache(part, cache = createPipelineCache(), evaluators = {}, THREE = globalThis.THREE) {
  const tStart = Date.now();
  const hashes = computeStageHashes(part);
  const buildProfile = evaluators.buildProfile || evaluators.profile || defaultBuildProfile;
  const buildBase = evaluators.buildBase || evaluators.baseGeo || defaultBuildBase;
  const buildSolid = evaluators.buildSolid || evaluators.solidGeo || defaultBuildSolid;
  const applyTex = evaluators.applyTexture || evaluators.texGeo || defaultApplyTexture;

  const hitProfile = cache.hashes.profile === hashes.profile && cache.profile !== null;
  if (!hitProfile) {
    cache.profile = buildProfile(part, THREE);
    cache.hashes.profile = hashes.profile;
  }

  const hitBase = hitProfile && cache.hashes.baseGeo === hashes.baseGeo && cache.baseGeo !== null;
  if (!hitBase) {
    cache.baseGeo = buildBase(part, cache.profile, THREE);
    cache.hashes.baseGeo = hashes.baseGeo;
  }

  const hitSolid = hitBase && cache.hashes.solidGeo === hashes.solidGeo && cache.solidGeo !== null;
  if (!hitSolid) {
    cache.solidGeo = buildSolid(part, cache.baseGeo, cache.profile, THREE);
    cache.hashes.solidGeo = hashes.solidGeo;
  }

  const hitTex = hitSolid && cache.hashes.texGeo === hashes.texGeo && cache.texGeo !== null;
  if (!hitTex) {
    const solidClone = cloneGeom(cache.solidGeo);
    cache.texGeo = applyTex(part, solidClone, THREE);
    cache.hashes.texGeo = hashes.texGeo;
  }

  cache.stats.evaluations += 1;
  cache.stats.lastMs = Date.now() - tStart;

  return {
    geometry: cloneGeom(cache.texGeo),
    cacheHits: {
      profile: hitProfile,
      baseGeo: hitBase,
      solidGeo: hitSolid,
      texGeo: hitTex
    },
    stats: {
      evaluations: cache.stats.evaluations,
      lastMs: cache.stats.lastMs,
      hashes
    }
  };
}
