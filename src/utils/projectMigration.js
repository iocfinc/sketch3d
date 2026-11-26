/**
 * SKETCH3D — Project Schema Migration & V2 Serialization
 * ======================================================
 * Upgrades V1 single-part presets/objects and V1 multi-part saves to
 * the canonical Schema V2 envelope, and normalizes V2 saves idempotently.
 */

export const PROJECT_SCHEMA_VERSION = 2;

const VALID_TYPES = new Set(['extrude', 'revolve', 'loft']);
const VALID_INTENTS = new Set(['vessel', 'lampshade']);
const VALID_MATERIALS = new Set(['opaque', 'clear']);
const VALID_PROFILES = new Set(['poly', 'bezier', 'freehand']);
const VALID_PLANES = new Set(['XY', 'XZ', 'YZ']);
const VALID_SCALE_MODES = new Set(['full', 'mini', 'swatch']);
const VALID_SLICER_TARGETS = new Set(['bambu_studio', 'orcaslicer']);

function finiteNum(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max, fallback) {
  const num = finiteNum(value, fallback);
  return Math.max(min, Math.min(max, num));
}

function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined && typeof v !== 'function') {
      out[k] = cloneJson(v);
    }
  }
  return out;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map(cloneJson) : [];
}

function inferMaterialTag(raw, shellMode, color) {
  if (VALID_MATERIALS.has(raw.materialTag)) return raw.materialTag;
  if (shellMode === 'vase_proxy' || String(color).toUpperCase() === '#73E6F1') {
    return 'clear';
  }
  return 'opaque';
}

function inferProfileType(raw, bezierNodes) {
  if (VALID_PROFILES.has(raw.profileType)) return raw.profileType;
  return bezierNodes.length > 0 ? 'bezier' : 'poly';
}

function normalizePart(rawPart, index) {
  const p = rawPart && typeof rawPart === 'object' && !Array.isArray(rawPart) ? rawPart : {};
  const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `p_${index + 1}`;
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Part ${index + 1}`;
  const type = VALID_TYPES.has(p.type) ? p.type : 'extrude';
  const intent = VALID_INTENTS.has(p.intent) ? p.intent : 'vessel';
  const shellMode = typeof p.shellMode === 'string' && p.shellMode.trim() ? p.shellMode.trim() : 'hollow';
  const color = typeof p.color === 'string' && p.color.trim() ? p.color.trim() : '#FF66D9';
  const bezierNodes = cloneArray(p.bezierNodes);
  const baseZ = clamp(p.baseZ, 0, 250, 0);
  const maxHeight = Math.max(1, 256 - baseZ);
  const extrudeHeight = clamp(p.extrudeHeight, 1, maxHeight, 8);
  const shellThicknessRaw = finiteNum(p.shellThickness, 1.2);
  const bandCountRaw = Math.round(finiteNum(p.bandCount, 8));

  return {
    id,
    name,
    type,
    intent,
    materialTag: inferMaterialTag(p, shellMode, color),
    profileType: inferProfileType(p, bezierNodes),
    bezierNodes,
    points: cloneArray(p.points),
    isClosed: Boolean(p.isClosed),
    holes: cloneArray(p.holes),
    standoffs: cloneArray(p.standoffs),
    cutouts: cloneArray(p.cutouts),
    baseZ,
    extrudeHeight,
    cornerRadius: Math.max(0, finiteNum(p.cornerRadius, 0)),
    shellEnabled: Boolean(p.shellEnabled),
    shellMode,
    shellThickness: shellThicknessRaw > 0 ? shellThicknessRaw : 1.2,
    bevelSize: Math.max(0, finiteNum(p.bevelSize, 0.5)),
    twistDeg: finiteNum(p.twistDeg, 0),
    sketchPlane: VALID_PLANES.has(p.sketchPlane) ? p.sketchPlane : 'XY',
    texturePattern: typeof p.texturePattern === 'string' && p.texturePattern.trim() ? p.texturePattern.trim() : 'none',
    textureDepth: finiteNum(p.textureDepth, 0.8),
    textureFreq: finiteNum(p.textureFreq, 24),
    bandEnabled: Boolean(p.bandEnabled),
    bandCount: Math.max(1, bandCountRaw),
    bandMode: typeof p.bandMode === 'string' && p.bandMode.trim() ? p.bandMode.trim() : 'weave',
    bandFreq: finiteNum(p.bandFreq, 10),
    bandPhaseDeg: finiteNum(p.bandPhaseDeg, 90),
    bandDepth: finiteNum(p.bandDepth, 1.0),
    bandFlareDeg: finiteNum(p.bandFlareDeg, 10),
    bandPivot: p.bandPivot === 'endpoint' ? 'endpoint' : 'midpoint',
    bandAltFlare: p.bandAltFlare ?? true,
    linkedParentId: typeof p.linkedParentId === 'string' && p.linkedParentId.trim() ? p.linkedParentId.trim() : null,
    offsetMm: finiteNum(p.offsetMm ?? p.offsetDistance, 0),
    loftTopShape: ['circle', 'hex', 'scaled'].includes(p.loftTopShape) ? p.loftTopShape : 'circle',
    loftTopScale: clamp(p.loftTopScale, 0.25, 1.8, 0.7),
    loftTwistDeg: finiteNum(p.loftTwistDeg, 0),
    loftTopPoints: cloneArray(p.loftTopPoints),
    weaveBands: clamp(p.weaveBands, 1.8, 6.0, 2.5),
    weaveGapMm: clamp(p.weaveGapMm, 0.5, 1.5, 0.8),
    weavePillars: Math.round(clamp(p.weavePillars, 8, 32, 16)),
    weaveTwistDeg: clamp(p.weaveTwistDeg, 0, 180, 0),
    color
  };
}

function parseProjectInput(rawJson) {
  let parsed = rawJson;
  if (typeof rawJson === 'string') {
    const trimmed = rawJson.trim();
    if (!trimmed) {
      throw new Error('Invalid project JSON: input string is empty.');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Invalid project JSON: ${err.message}`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid project data: expected a non-null JSON object.');
  }
  return parsed;
}

/**
 * Migrates any V1 flat preset/part, V1 multi-part save, or V2 save into a
 * normalized Schema V2 project envelope.
 * @param {string|Object} rawJson
 * @returns {Object}
 */
export function migrateProjectV1ToV2(rawJson) {
  const parsed = parseProjectInput(rawJson);
  const rawParts = Array.isArray(parsed.parts)
    ? (parsed.parts.length > 0 ? parsed.parts : [{}])
    : [parsed];

  const parts = rawParts.map((part, idx) => normalizePart(part, idx));
  const activeStage = Math.round(clamp(parsed.activeStage, 1, 5, 1));
  const activePartIndex = Math.round(clamp(parsed.activePartIndex, 0, Math.max(0, parts.length - 1), 0));
  const scaleMode = VALID_SCALE_MODES.has(parsed.scaleMode) ? parsed.scaleMode : 'full';
  const slicerTarget = VALID_SLICER_TARGETS.has(parsed.slicerTarget) ? parsed.slicerTarget : 'bambu_studio';
  const slicerProfile = typeof parsed.slicerProfile === 'string' && parsed.slicerProfile.trim()
    ? parsed.slicerProfile.trim()
    : 'vase';
  const snapEnabled = parsed.snapEnabled !== undefined ? Boolean(parsed.snapEnabled) : true;
  const snapStep = Math.max(0, finiteNum(parsed.snapStep, snapEnabled ? 5 : 0));

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'SKETCH3D',
    activeStage,
    activePartIndex,
    scaleMode,
    slicerTarget,
    slicerProfile,
    revolveGuide: Boolean(parsed.revolveGuide),
    snapEnabled,
    snapStep,
    wireframe: Boolean(parsed.wireframe),
    parts
  };
}

/**
 * Serializes live application state into a clean Schema V2 object ready for
 * JSON.stringify(obj, null, 2).
 * @param {Object} state
 * @returns {Object}
 */
export function serializeProjectV2(state) {
  return migrateProjectV1ToV2(state);
}
