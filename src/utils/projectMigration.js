/**
 * SKETCH3D — Project Schema Migration & V2 Serialization
 * Upgrades V1 single-part presets/objects and V1 multi-part saves to Schema V2.
 */
import { resolveAutoSlicerProfile } from '../export/threemfExporter.js';

export const PROJECT_SCHEMA_VERSION = 2;

const VALID_TYPES = new Set(['extrude', 'revolve', 'loft']);
const VALID_INTENTS = new Set(['vessel', 'lampshade']);
const VALID_MATERIALS = new Set(['opaque', 'clear']);
const VALID_POLYMERS = new Set(['PLA', 'PETG', 'ABS']);
const VALID_PROFILES = new Set(['poly', 'bezier', 'freehand']);
const VALID_PLANES = new Set(['XY', 'XZ', 'YZ']);
const VALID_SCALE_MODES = new Set(['full', 'mini', 'swatch']);
const VALID_SLICER_TARGETS = new Set(['bambu_studio', 'orcaslicer']);
const VALID_PRINTER_PROFILES = new Set(['bambu_a1', 'bambu_a1_mini', 'orca_generic']);

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
    if (v !== undefined && typeof v !== 'function') out[k] = cloneJson(v);
  }
  return out;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map(cloneJson) : [];
}

function inferMaterialTag(raw, shellMode, color) {
  if (VALID_MATERIALS.has(raw.materialTag)) return raw.materialTag;
  if (shellMode === 'vase_proxy' || String(color).toUpperCase() === '#73E6F1') return 'clear';
  return 'opaque';
}

function inferPolymer(raw) {
  const up = String(raw.polymer || '').toUpperCase();
  return VALID_POLYMERS.has(up) ? up : 'PLA';
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
    id, name, type, intent,
    materialTag: inferMaterialTag(p, shellMode, color),
    polymer: inferPolymer(p),
    polymerManual: Boolean(p.polymerManual),
    amsSlot: Math.round(clamp(p.amsSlot, 1, 4, Math.min(4, index + 1))),
    profileType: VALID_PROFILES.has(p.profileType) ? p.profileType : (bezierNodes.length > 0 ? 'bezier' : 'poly'),
    bezierNodes, points: cloneArray(p.points), isClosed: Boolean(p.isClosed),
    holes: cloneArray(p.holes), standoffs: cloneArray(p.standoffs), cutouts: cloneArray(p.cutouts),
    baseZ, extrudeHeight,
    cornerRadius: Math.max(0, finiteNum(p.cornerRadius, 0)),
    shellEnabled: Boolean(p.shellEnabled), shellMode,
    shellThickness: shellThicknessRaw > 0 ? shellThicknessRaw : 1.2,
    floorThickness: p.floorThickness > 0 ? clamp(p.floorThickness, 0.4, 25, 1.2) : null,
    openBottom: p.openBottom !== undefined ? Boolean(p.openBottom) : (intent === 'lampshade'),
    topVentMm: Math.max(0, finiteNum(p.topVentMm, 0)),
    baseMountDiameterMm: Math.max(0, finiteNum(p.baseMountDiameterMm, 0)),
    cordSlot: p.cordSlot && typeof p.cordSlot === 'object' ? cloneJson(p.cordSlot) : null,
    splitMeta: p.splitMeta && typeof p.splitMeta === 'object' ? cloneJson(p.splitMeta) : null,
    bevelSize: Math.max(0, finiteNum(p.bevelSize, 0)),
    twistDeg: finiteNum(p.twistDeg, 0),
    sketchPlane: VALID_PLANES.has(p.sketchPlane) ? p.sketchPlane : (type === 'revolve' ? 'XZ' : 'XY'),
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
    wallThicknessMm: p.wallThicknessMm !== undefined && p.wallThicknessMm !== null ? clamp(p.wallThicknessMm, 0.8, 8.0, 2.0) : undefined,
    rimMarginMm: p.rimMarginMm !== undefined && p.rimMarginMm !== null ? clamp(p.rimMarginMm, 1.5, 15.0, 4.0) : undefined,
    color
  };
}

function parseProjectInput(rawJson) {
  let parsed = rawJson;
  if (typeof rawJson === 'string') {
    const trimmed = rawJson.trim();
    if (!trimmed) throw new Error('Invalid project JSON: input string is empty.');
    try { parsed = JSON.parse(trimmed); } catch (err) { throw new Error(`Invalid project JSON: ${err.message}`); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid project data: expected a non-null JSON object.');
  }
  return parsed;
}

export function migrateProjectV1ToV2(rawJson) {
  const parsed = parseProjectInput(rawJson);
  const rawParts = Array.isArray(parsed.parts) ? (parsed.parts.length > 0 ? parsed.parts : [{}]) : [parsed];
  const parts = rawParts.map((part, idx) => normalizePart(part, idx));
  const activeStage = Math.round(clamp(parsed.activeStage, 1, 5, 1));
  const activePartIndex = Math.round(clamp(parsed.activePartIndex, 0, Math.max(0, parts.length - 1), 0));
  const snapEnabled = parsed.snapEnabled !== undefined ? Boolean(parsed.snapEnabled) : true;

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'SKETCH3D',
    activeStage,
    activePartIndex,
    scaleMode: VALID_SCALE_MODES.has(parsed.scaleMode) ? parsed.scaleMode : 'full',
    slicerTarget: VALID_SLICER_TARGETS.has(parsed.slicerTarget) ? parsed.slicerTarget : 'bambu_studio',
    printerProfile: VALID_PRINTER_PROFILES.has(parsed.printerProfile) ? parsed.printerProfile : 'bambu_a1',
    slicerProfile: typeof parsed.slicerProfile === 'string' && parsed.slicerProfile.trim() ? parsed.slicerProfile.trim() : resolveAutoSlicerProfile(parts, 'auto'),
    revolveGuide: Boolean(parsed.revolveGuide),
    snapEnabled,
    snapStep: Math.max(0, finiteNum(parsed.snapStep, snapEnabled ? 5 : 0)),
    wireframe: Boolean(parsed.wireframe),
    unnestShells: Boolean(parsed.unnestShells),
    brimEnabled: Boolean(parsed.brimEnabled),
    brimWidthMm: clamp(parsed.brimWidthMm, 2, 20, 5),
    thermalGuide: Boolean(parsed.thermalGuide),
    parts
  };
}

export function serializeProjectV2(state) {
  return migrateProjectV1ToV2(state);
}
