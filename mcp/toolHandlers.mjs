/**
 * SKETCH3D — Transport-Agnostic MCP Tool Handlers (1:1 Schema V2 Parity)
 * =======================================================================
 * Pure-JS core executing the 5 SKETCH3D Product Map stages over src/geometry/**,
 * src/export/**, and src/utils/projectMigration.js with zero transport coupling.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_DEFINITIONS, validateToolArgs } from './toolSchemas.mjs';
import { renderProjectMultiview } from './renderBridge.mjs';
import {
  makePrimitivePoints, buildAssemblyMeshes, auditRevolveProfileOverhangs,
  getActiveMaterial, applyFastenerList, applySplitAndStack
} from './geometrySession.mjs';
import { migrateProjectV1ToV2, serializeProjectV2 } from '../src/utils/projectMigration.js';
import { computeAutoTangents, syncBezierToPoints, getProfileBoundsMm } from '../src/geometry/bezier2d.js';
import { createLinkedOffsetClone } from '../src/geometry/offsetClone.js';
import { getExportFilename } from '../src/geometry/testScale.js';
import {
  extractPrintableTriangles, checkManifoldEdges, buildBinarySTLBuffer,
  estimateFilamentMass, analyzeBedContact
} from '../src/export/stlExporter.js';
import { buildThreeMFBuffer, getTextureFidelityMetadata, resolveAutoSlicerProfile } from '../src/export/threemfExporter.js';
import { compileAndValidateGCode, buildGCode3MFBuffer } from '../src/export/gcodeExporter.js';
import { getPrinterProfile, getSlicerTargetInfo, checkBoundsFitPrinter } from '../src/export/printerProfile.js';

export { TOOL_DEFINITIONS, validateToolArgs };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

export function createMcpSession(options = {}) {
  return {
    rootDir: options.rootDir || DEFAULT_ROOT_DIR,
    defaultOutputDir: options.outputDir || path.join(os.tmpdir(), 'sketch3d-mcp-exports'),
    caches: new Map(),
    state: migrateProjectV1ToV2({
      activeStage: 1, activePartIndex: 0, scaleMode: 'full',
      slicerTarget: 'bambu_studio', printerProfile: 'bambu_a1',
      parts: [{ id: 'p_1', name: 'Part 1', type: 'extrude', points: [], isClosed: false }]
    })
  };
}

function hydrateProjectIfProvided(session, args) {
  if (args?.project) {
    session.state = migrateProjectV1ToV2(args.project);
    session.caches.clear();
  }
  if (args?.partIndex !== undefined) {
    if (!Number.isInteger(args.partIndex) || args.partIndex < 0 || args.partIndex >= session.state.parts.length) {
      throw new Error(`Invalid partIndex ${args.partIndex} (parts=${session.state.parts.length})`);
    }
    session.state.activePartIndex = args.partIndex;
  }
  return session.state.parts[session.state.activePartIndex] || session.state.parts[0];
}

function handleSketch2D(session, args) {
  const action = args.action || 'set_profile';
  if (action === 'clear') {
    session.state = migrateProjectV1ToV2({
      activeStage: 1, activePartIndex: 0, slicerTarget: session.state.slicerTarget,
      printerProfile: session.state.printerProfile, parts: [{ id: 'p_1', name: 'Part 1', points: [], isClosed: false }]
    });
    session.caches.clear();
    return { ok: true, stage: 1, action, project: serializeProjectV2(session.state) };
  }
  if (args?.project) {
    session.state = migrateProjectV1ToV2(args.project);
    session.caches.clear();
  }
  if (action === 'add_part') {
    const idx = session.state.parts.length;
    session.state.parts.push(migrateProjectV1ToV2({
      parts: [{ id: `p_${idx + 1}`, name: args.partName || `Part ${idx + 1}`, points: args.points || [], isClosed: Boolean(args.isClosed) }]
    }).parts[0]);
    session.state.activePartIndex = idx;
  }
  const part = hydrateProjectIfProvided(session, { ...args, project: undefined });
  if (args.partName) part.name = args.partName;
  if (args.sketchPlane) part.sketchPlane = args.sketchPlane;
  if (args.revolveGuide !== undefined) session.state.revolveGuide = Boolean(args.revolveGuide);
  if (args.snapStep !== undefined) { session.state.snapStep = args.snapStep; session.state.snapEnabled = args.snapStep > 0; }

  if (action === 'rect' || action === 'circle' || action === 'hex') {
    part.profileType = 'poly';
    part.bezierNodes = [];
    part.points = makePrimitivePoints(action, args);
    part.isClosed = args.isClosed ?? true;
  } else if (Array.isArray(args.bezierNodes) && args.bezierNodes.length >= 2) {
    const closed = Boolean(args.isClosed);
    const hasHandles = args.bezierNodes.every(n => n.cpIn && n.cpOut);
    part.profileType = 'bezier';
    part.isClosed = closed;
    part.bezierNodes = hasHandles
      ? args.bezierNodes.map(n => ({ ...n, cpIn: { ...n.cpIn }, cpOut: { ...n.cpOut } }))
      : computeAutoTangents(args.bezierNodes, args.smoothness ?? 0.35, closed);
    syncBezierToPoints(part, args.resolutionMm ?? 0.5);
  } else if (Array.isArray(args.points) && args.points.length >= 2) {
    part.profileType = args.profileType || 'poly';
    part.bezierNodes = [];
    part.points = args.points.map(p => ({ x: p.x, y: p.y }));
    part.isClosed = args.isClosed ?? (part.points.length >= 3);
  }

  session.state.activeStage = 1;
  return {
    ok: true, stage: 1, activePartIndex: session.state.activePartIndex, partId: part.id,
    pointCount: part.points.length, profileBoundsMm: getProfileBoundsMm(part.points),
    project: serializeProjectV2(session.state)
  };
}

async function handleGenerateForm(session, args) {
  const parent = hydrateProjectIfProvided(session, args);
  const mode = args.mode || parent.type || 'extrude';
  let target = parent;

  if (mode === 'offset_clone') {
    const clone = createLinkedOffsetClone(parent, args.offsetMm ?? 10);
    if (args.partName) clone.name = args.partName;
    clone.materialTag = args.materialTag || 'clear';
    if (args.color) clone.color = args.color;
    session.state.parts.push(clone);
    session.state.activePartIndex = session.state.parts.length - 1;
    target = clone;
  } else {
    target.type = mode;
    if (args.materialTag) target.materialTag = args.materialTag;
    if (args.color) target.color = args.color;
    if (args.baseZ !== undefined) target.baseZ = Math.max(0, Math.min(250, Number(args.baseZ)));
    if (mode === 'revolve') {
      if (!target.sketchPlane || target.sketchPlane === 'XY') target.sketchPlane = 'XZ';
      session.state.revolveGuide = true;
      const b = getProfileBoundsMm(target.points);
      target.extrudeHeight = Math.max(1, Number(args.heightZ ?? (Math.round(b.height * 10) / 10 || target.extrudeHeight || 8)));
    } else if (args.heightZ !== undefined) {
      target.extrudeHeight = Math.max(1, Math.min(256 - (target.baseZ || 0), Number(args.heightZ)));
    }
    if (mode === 'loft') {
      if (args.loftTopShape) target.loftTopShape = args.loftTopShape;
      if (args.loftTopScale !== undefined) target.loftTopScale = args.loftTopScale;
      if (args.loftTwistDeg !== undefined) target.loftTwistDeg = args.loftTwistDeg;
      if (Array.isArray(args.loftTopPoints)) target.loftTopPoints = args.loftTopPoints.map(p => ({ x: p.x, y: p.y }));
    }
  }

  session.state.activeStage = 2;
  session.state.slicerProfile = resolveAutoSlicerProfile(session.state.parts, 'auto');
  const assembly = await buildAssemblyMeshes(session.state, session.caches);
  return {
    ok: true, stage: 2, activePartIndex: session.state.activePartIndex, partId: target.id,
    mode, boundingBoxMm: assembly.dims, slicerProfile: session.state.slicerProfile,
    project: serializeProjectV2(session.state)
  };
}

async function handleApplyModifier(session, args) {
  const part = hydrateProjectIfProvided(session, args);
  for (const k of ['shellEnabled', 'shellMode', 'shellThickness', 'intent', 'cornerRadius', 'bevelSize', 'twistDeg', 'color']) {
    if (args[k] !== undefined) part[k] = args[k];
  }
  if (args.fasteners) applyFastenerList(part, args.fasteners);
  await applySplitAndStack(session.state, part, args);

  session.state.activeStage = 3;
  session.state.slicerProfile = resolveAutoSlicerProfile(session.state.parts, 'auto');
  const assembly = await buildAssemblyMeshes(session.state, session.caches);
  return {
    ok: true, stage: 3, partsCount: session.state.parts.length,
    slicerProfile: session.state.slicerProfile, boundingBoxMm: assembly.dims,
    project: serializeProjectV2(session.state)
  };
}

async function handleApplyTextureBands(session, args) {
  const part = hydrateProjectIfProvided(session, args);
  const fields = [
    'texturePattern', 'textureDepth', 'textureFreq', 'weaveBands', 'weaveGapMm',
    'weavePillars', 'weaveTwistDeg', 'wallThicknessMm', 'rimMarginMm',
    'bandEnabled', 'bandCount', 'bandMode', 'bandFreq', 'bandPhaseDeg',
    'bandDepth', 'bandFlareDeg', 'bandPivot', 'bandAltFlare'
  ];
  for (const k of fields) {
    if (args[k] !== undefined) part[k] = args[k];
  }
  session.state.activeStage = 4;
  session.state.slicerProfile = resolveAutoSlicerProfile(session.state.parts, 'auto');
  const fidelity = getTextureFidelityMetadata(part.texturePattern || 'none');
  const assembly = await buildAssemblyMeshes(session.state, session.caches);
  return {
    ok: true, stage: 4, activePartIndex: session.state.activePartIndex,
    fidelityContract: fidelity, slicerProfile: session.state.slicerProfile,
    boundingBoxMm: assembly.dims,
    partMetrics: assembly.perPart[session.state.activePartIndex] || assembly.perPart[0] || null,
    project: serializeProjectV2(session.state)
  };
}

async function handleInspectAndRender(session, args) {
  hydrateProjectIfProvided(session, args);
  const printer = getPrinterProfile(args.printerProfile || session.state.printerProfile);
  const scaleMode = args.scaleMode || session.state.scaleMode || 'full';
  if (args.printerProfile) session.state.printerProfile = printer.id;
  if (args.scaleMode) session.state.scaleMode = scaleMode;

  const { meshes, perPart, dims } = await buildAssemblyMeshes(session.state, session.caches, scaleMode);
  const { triangles } = extractPrintableTriangles(meshes);
  const combinedOpenEdges = checkManifoldEdges(triangles);
  const nonManifoldEdges = perPart.reduce((acc, p) => acc + (p.nonManifoldEdges || 0), 0);
  const totalVolumeMm3 = +perPart.reduce((acc, p) => acc + (p.volume || 0), 0).toFixed(2);
  const material = getActiveMaterial(session.state);
  const massGrams = meshes.length > 0 ? +estimateFilamentMass(session.state.parts, meshes, { material }).toFixed(2) : 0;
  const bedContact = analyzeBedContact(meshes);
  const fit = checkBoundsFitPrinter(dims, printer.id);
  const overhangWarnings = session.state.parts.flatMap(p => p.type === 'revolve' ? auditRevolveProfileOverhangs(p.points) : []);
  const v2 = serializeProjectV2(session.state);

  const multiviewRender = args.renderMultiview
    ? await renderProjectMultiview(v2, args.outputImagePath, session.rootDir)
    : null;
  return {
    ok: true, printerProfile: printer.id, scaleMode,
    boundingBoxMm: { ...dims, fitsPrinterBed: fit.fits, envelopeMm: fit.envelopeMm },
    estimatedMassGrams: massGrams, filamentMaterial: material,
    manifoldReport: {
      openEdges: combinedOpenEdges, nonManifoldEdges,
      isWatertight: combinedOpenEdges === 0 && nonManifoldEdges === 0 && triangles.length > 0,
      triangleCount: triangles.length, volumeMm3: totalVolumeMm3, parts: perPart
    },
    bedContactReport: bedContact, overhangWarnings, multiviewRender, project: v2
  };
}

async function writeBundleExports(session, args, ctx) {
  const { meshes, triangles, printer, slicerInfo, effectiveProfile, scaleMode, outDir, baseName } = ctx;
  const formats = args.formats || ['3mf'];
  const exportedFiles = [];
  let safetyReport = { gate: 'manifold_preflight', passed: ctx.nonManifoldEdges === 0 && ctx.fit.fits, errors: [] };

  for (const fmt of formats) {
    if (fmt === '3mf') {
      const buf = Buffer.from(buildThreeMFBuffer(session.state.parts, meshes, effectiveProfile, slicerInfo.id, printer.id));
      const fPath = path.join(outDir, getExportFilename(baseName, scaleMode).replace(/\.stl$/i, '') + '.3mf');
      fs.writeFileSync(fPath, buf);
      exportedFiles.push({ format: '3mf', path: fPath, bytes: buf.length });
    } else if (fmt === 'stl') {
      const buf = Buffer.from(buildBinarySTLBuffer(triangles, `SKETCH3D_VERIFIED_${printer.id.toUpperCase()}`));
      const fPath = path.join(outDir, getExportFilename(baseName, scaleMode));
      fs.writeFileSync(fPath, buf);
      exportedFiles.push({ format: 'stl', path: fPath, bytes: buf.length });
    } else if (fmt === 'gcode' || fmt === 'gcode.3mf') {
      const activePart = session.state.parts[session.state.activePartIndex] || session.state.parts[0];
      const gRes = await compileAndValidateGCode(activePart, {
        nozzleDiameter: args.nozzleDiameter ?? 0.4,
        primitive: args.toolpathPrimitive || 'standard',
        scaleFactor: scaleMode === 'mini' ? 0.5 : 1.0,
        useDonor: Boolean(args.useDonor),
        printerProfile: printer.id,
        slicerTarget: slicerInfo.id
      });
      safetyReport = { gate: '5_layer_gcode_firewall', ...gRes.safety, stats: gRes.stats };
      if (!gRes.safety.passed) return { blocked: true, exportedFiles, safetyReport };
      if (fmt === 'gcode') {
        const fPath = path.join(outDir, `${baseName}.gcode`);
        fs.writeFileSync(fPath, gRes.gcode, 'utf-8');
        exportedFiles.push({ format: 'gcode', path: fPath, bytes: Buffer.byteLength(gRes.gcode) });
      } else {
        const buf = Buffer.from(buildGCode3MFBuffer(gRes.gcode, gRes.bodySha, session.state.parts, meshes, effectiveProfile, slicerInfo.id, printer.id));
        const fPath = path.join(outDir, `${baseName}.gcode.3mf`);
        fs.writeFileSync(fPath, buf);
        exportedFiles.push({ format: 'gcode.3mf', path: fPath, bytes: buf.length });
      }
    }
  }
  return { blocked: false, exportedFiles, safetyReport };
}

async function handleExportPrintBundle(session, args) {
  hydrateProjectIfProvided(session, args);
  const printer = getPrinterProfile(args.printerProfile || session.state.printerProfile);
  const slicerInfo = getSlicerTargetInfo(args.slicerTarget || session.state.slicerTarget);
  const scaleMode = args.scaleMode || session.state.scaleMode || 'full';
  const effectiveProfile = resolveAutoSlicerProfile(session.state.parts, args.slicerProfile || session.state.slicerProfile || 'auto');
  Object.assign(session.state, {
    printerProfile: printer.id, slicerTarget: slicerInfo.id,
    slicerProfile: effectiveProfile, scaleMode, activeStage: 5
  });

  const outDir = path.resolve(args.outputDir || session.defaultOutputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = (args.baseName || printer.exportFilePrefix).replace(/[^A-Za-z0-9._-]/g, '_');
  const v2 = serializeProjectV2(session.state);
  const projectJsonPath = path.join(outDir, `${baseName}.sketch3d.v2.json`);
  fs.writeFileSync(projectJsonPath, JSON.stringify(v2, null, 2), 'utf-8');

  const { meshes, perPart, dims } = await buildAssemblyMeshes(session.state, session.caches, scaleMode);
  const { triangles, minZ } = extractPrintableTriangles(meshes);
  triangles.forEach(t => { t.a.z -= minZ; t.b.z -= minZ; t.c.z -= minZ; });
  const openEdges = checkManifoldEdges(triangles);
  const nonManifoldEdges = perPart.reduce((acc, p) => acc + (p.nonManifoldEdges || 0), 0);
  const fit = checkBoundsFitPrinter(dims, printer.id);
  const material = getActiveMaterial(session.state);
  const estimatedMassGrams = meshes.length > 0 ? +estimateFilamentMass(session.state.parts, meshes, { material }).toFixed(2) : 0;

  const res = await writeBundleExports(session, args, {
    meshes, triangles, printer, slicerInfo, effectiveProfile, scaleMode, outDir, baseName, nonManifoldEdges, fit
  });
  if (res.blocked) {
    return {
      ok: false, error: 'Safety gate blocked G-code export', projectJsonPath,
      exportedFiles: res.exportedFiles, safetyReport: res.safetyReport,
      boundingBoxMm: { ...dims, fitsPrinterBed: fit.fits }
    };
  }
  return {
    ok: true, stage: 5, projectJsonPath, exportedFiles: res.exportedFiles,
    slicerTarget: slicerInfo.id, slicerApplication: slicerInfo.application,
    printerProfile: printer.id, slicerProfile: effectiveProfile,
    boundingBoxMm: { ...dims, fitsPrinterBed: fit.fits, envelopeMm: fit.envelopeMm },
    estimatedMassGrams, filamentMaterial: material,
    manifoldReport: {
      openEdges, nonManifoldEdges,
      isWatertight: openEdges === 0 && nonManifoldEdges === 0 && triangles.length > 0,
      triangleCount: triangles.length, parts: perPart
    },
    bedContactReport: analyzeBedContact(meshes),
    safetyReport: res.safetyReport,
    project: v2
  };
}

const HANDLERS = {
  sketch_2d: handleSketch2D,
  generate_form: handleGenerateForm,
  apply_modifier: handleApplyModifier,
  apply_texture_bands: handleApplyTextureBands,
  inspect_and_render: handleInspectAndRender,
  export_print_bundle: handleExportPrintBundle
};

export async function executeMcpTool(toolName, args = {}, session = createMcpSession()) {
  const validation = validateToolArgs(toolName, args);
  if (!validation.valid) {
    return { ok: false, error: 'SCHEMA_VALIDATION_ERROR', details: validation.errors };
  }
  return await HANDLERS[toolName](session, args || {});
}
