/**
 * SKETCH3D — Main Application Controller (5-Stage Progressive Shell)
 */

import { initSketch2D, BED_SIZE_MM } from './canvas/sketch2d.js';
import { initViewport3D } from './view/viewport3d.js';
import { buildPartGeometry, buildStandoffMeshes } from './geometry/meshBuilder.js';
import { createPipelineCache, evaluatePartWithCache } from './geometry/pipelineCache.js';
import { DATUM_PLANES, transformGeometryToPlane } from './canvas/planeSelector.js';
import { PRESETS } from './config/presets.js';
import { applyScaleModeToGeometry, getExportFilename } from './geometry/testScale.js';
import { extractPrintableTriangles, checkManifoldEdges, buildBinarySTLBuffer, downloadSTL, estimateFilamentMass } from './export/stlExporter.js';
import { exportThreeMFFile, DRYING_NOTIFICATION, resolveAutoSlicerProfile } from './export/threemfExporter.js';
import { initPart2Controls } from './view/part2Controls.js';
import { syncLinkedClones } from './geometry/offsetClone.js';
import { initToolpathControls } from './view/toolpathControls.js';
import { initStageRouter } from './ui/stageRouter.js';
import { PROFILE_SUMMARIES, getActiveFilamentMaterial, getPartEffectiveHeightMm, syncPitchReadout, syncBedContactStatus, syncAutoSlicerProfile } from './ui/stageTelemetry.js';
import { migrateProjectV1ToV2, serializeProjectV2 } from './utils/projectMigration.js';

const MAX_HEIGHT_MM = 256;
const SNAP_CYCLE = [
  { enabled: true, step: 5, label: 'Snap: 5mm' },
  { enabled: true, step: 1, label: 'Snap: 1mm' },
  { enabled: true, step: 10, label: 'Snap: 10mm' },
  { enabled: false, step: 0, label: 'Snap: Off' }
];
const HINTS = {
  freehand: 'Draw: Drag finger or Apple Pencil to sketch a closed shape',
  poly: 'Poly: Tap to place points (90° Ortho + Midpoint snap) · Tap green dot to close',
  bezier: 'Bezier: Tap anchor points for smooth cubic curves · Tap green dot to close',
  edit: 'Edit: Drag dots or center · Double-tap dot to delete',
  rect: 'Rectangle: Drag corner-to-corner on canvas',
  circle: 'Circle: Drag center-to-radius on canvas',
  hex: 'Hexagon: Drag center-to-radius on canvas',
  hole: 'Tap inside shape to drop an M3 hole',
  standoff: 'Tap inside shape to drop an M3 standoff boss',
  cutout: 'Tap points inside shape · Tap green dot to cut'
};
let snapIdx = 0;
let stageRouter = null;

function createPart(o = {}) {
  return {
    id: o.id || 'p_' + Math.random().toString(36).slice(2, 7),
    name: o.name || 'Part 1', type: o.type || 'extrude', intent: o.intent || 'vessel',
    materialTag: o.materialTag || (o.shellMode === 'vase_proxy' ? 'clear' : 'opaque'),
    profileType: o.profileType || 'poly', bezierNodes: o.bezierNodes || [], points: o.points || [],
    isClosed: o.isClosed ?? false, holes: o.holes || [], standoffs: o.standoffs || [], cutouts: o.cutouts || [],
    baseZ: o.baseZ || 0, extrudeHeight: o.extrudeHeight || 8, cornerRadius: o.cornerRadius || 0,
    shellEnabled: o.shellEnabled || false, shellMode: o.shellMode || 'hollow', shellThickness: o.shellThickness || 1.2,
    bevelSize: o.bevelSize ?? 0, twistDeg: o.twistDeg || 0, sketchPlane: o.sketchPlane || (o.type === 'revolve' ? 'XZ' : 'XY'),
    texturePattern: o.texturePattern || 'none', textureDepth: o.textureDepth ?? 0.8, textureFreq: o.textureFreq ?? 24,
    bandEnabled: o.bandEnabled || false, bandCount: o.bandCount ?? 8, bandMode: o.bandMode || 'weave',
    bandFreq: o.bandFreq ?? 10, bandPhaseDeg: o.bandPhaseDeg ?? 90, bandDepth: o.bandDepth ?? 1.0,
    linkedParentId: o.linkedParentId || null, offsetMm: o.offsetMm || 0,
    loftTopShape: o.loftTopShape || 'circle', loftTopScale: o.loftTopScale ?? 0.7,
    loftTwistDeg: o.loftTwistDeg || 0, loftTopPoints: o.loftTopPoints || [],
    weaveBands: o.weaveBands ?? 2.5, weaveGapMm: o.weaveGapMm ?? 0.8,
    weavePillars: o.weavePillars ?? 16, weaveTwistDeg: o.weaveTwistDeg ?? 0,
    color: o.color || '#FF66D9'
  };
}

const state = {
  activeStage: 1, parts: [createPart({ name: 'Part 1' })], activePartIndex: 0,
  activeCutout: [], freehandStroke: [], primitiveDrag: null, inferGuide: null,
  mode: 'edit', snapEnabled: true, snapStep: 5, revolveGuide: false, wireframe: false,
  scaleMode: 'full', slicerTarget: 'bambu_studio', slicerProfile: 'standard', slicerProfileManual: false,
  draggingVertex: null, lastTapTime: 0, lastTapIndex: -1
};
const activePart = () => state.parts[state.activePartIndex] || state.parts[0];
const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const t = $('toastMsg');
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2400);
}

const [threeContainer, dimOverlay, estimateOverlay, fitBadge] = ['threeContainer', 'dimOverlay', 'estimateOverlay', 'fitBadge'].map($);
const viewport3D = initViewport3D({ container: threeContainer, bedSizeMm: BED_SIZE_MM, maxHeightMm: MAX_HEIGHT_MM });

const partCaches = new Map();

function rebuild3DMesh() {
  syncLinkedClones(state.parts);
  const partsGroup = viewport3D.partsGroup;
  while (partsGroup.children.length > 0) {
    const c = partsGroup.children[0];
    partsGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
  const fullBox = new THREE.Box3();
  const meshes = [];
  state.parts.forEach((p, idx) => {
    if (!p.points || p.points.length < 2) return;
    let cache = partCaches.get(p.id);
    if (!cache) { cache = createPipelineCache(); partCaches.set(p.id, cache); }
    let geom = evaluatePartWithCache(p, cache, {}, THREE).geometry;
    if (!geom) geom = buildPartGeometry(p, THREE);
    if (!geom) return;
    if (p.type !== 'revolve' && p.sketchPlane && p.sketchPlane !== 'XY' && DATUM_PLANES[p.sketchPlane]) {
      transformGeometryToPlane(geom, DATUM_PLANES[p.sketchPlane], THREE);
    }
    if (state.scaleMode !== 'full') geom = applyScaleModeToGeometry(geom, state.scaleMode);
    const isClear = p.materialTag === 'clear' || (p.shellEnabled && p.shellMode === 'vase_proxy');
    const mat = new THREE.MeshStandardMaterial({
      color: p.color, roughness: isClear ? 0.15 : 0.35, metalness: isClear ? 0.05 : 0.15,
      wireframe: state.wireframe, opacity: isClear ? 0.72 : (idx === state.activePartIndex ? 1.0 : 0.85),
      transparent: isClear || idx !== state.activePartIndex
    });
    const mainMesh = new THREE.Mesh(geom, mat);
    mainMesh.userData.partIndex = idx;
    partsGroup.add(mainMesh);
    meshes.push(mainMesh);
    buildStandoffMeshes(p, mat).forEach(sm => partsGroup.add(sm));
    if (p.twistDeg === 0 && p.type === 'extrude' && (!p.texturePattern || p.texturePattern === 'none')) {
      partsGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: idx === state.activePartIndex ? 0x73E6F1 : 0x3b4252, transparent: true, opacity: 0.45 })));
    }
    geom.computeBoundingBox();
    fullBox.union(geom.boundingBox);
  });

  const matLabel = getActiveFilamentMaterial(state, activePart());
  if (meshes.length === 0) {
    dimOverlay.textContent = 'Size: -- × -- × -- mm';
    estimateOverlay.textContent = `~-- g ${matLabel}`;
    fitBadge.textContent = `A1 Max: ${BED_SIZE_MM}×${BED_SIZE_MM}×${MAX_HEIGHT_MM} mm`;
    fitBadge.className = 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono';
    syncPitchReadout(state, activePart()); syncBedContactStatus([]); viewport3D.renderNow?.();
    return;
  }
  const w = (fullBox.max.x - fullBox.min.x).toFixed(1), d = (fullBox.max.z - fullBox.min.z).toFixed(1), h = (fullBox.max.y - fullBox.min.y).toFixed(1);
  dimOverlay.textContent = `Size: ${w} × ${d} × ${h} mm`;
  estimateOverlay.textContent = `~${estimateFilamentMass(state.parts, meshes, { material: matLabel }).toFixed(1)} g ${matLabel}`;
  const fits = Number(w) <= BED_SIZE_MM && Number(d) <= BED_SIZE_MM && Number(h) <= MAX_HEIGHT_MM;
  fitBadge.textContent = fits ? `✓ Fits A1 Bed (${w}×${d}×${h}mm)` : `⚠️ Exceeds A1 Bed (${w}×${d}×${h}mm)`;
  fitBadge.className = fits
    ? 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono'
    : 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#FEFF00]/15 text-[#FEFF00] border border-[#FEFF00]/60 font-mono';
  syncPitchReadout(state, activePart()); syncBedContactStatus(meshes); viewport3D.renderNow?.();
}

const updateCameraTarget = () => viewport3D.updateCamera(Math.min((activePart().baseZ || 0) + getPartEffectiveHeightMm(activePart()) * 0.45, 115));
const [sketchCanvas, sketchContainer, sketchHintText, pointCountBadge] = ['sketchCanvas', 'sketchContainer', 'sketchHintText', 'pointCountBadge'].map($);
const sketch2D = initSketch2D({
  canvas: sketchCanvas, container: sketchContainer, state,
  onModelChange: () => { pointCountBadge.textContent = `${activePart().points.length} pts · ${state.parts.length} part${state.parts.length > 1 ? 's' : ''}`; if (activePart()?.type === 'revolve') syncControlsFromActivePart(); rebuild3DMesh(); },
  onModeChange: (m) => setMode(m)
});

const [extrudeSlider, extrudeInput, roundSlider, roundVal, bevelSlider, bevelVal, twistSlider, twistVal,
  shellToggleBtn, shellModeSelect, shellInputWrap, shellInput,
  texturePatternSelect, textureControlsWrap, textureDepthSlider, textureDepthVal, textureFreqSlider, textureFreqVal] = [
  'extrudeSlider', 'extrudeInput', 'roundSlider', 'roundVal', 'bevelSlider', 'bevelVal', 'twistSlider', 'twistVal',
  'shellToggleBtn', 'shellModeSelect', 'shellInputWrap', 'shellInput',
  'texturePatternSelect', 'textureControlsWrap', 'textureDepthSlider', 'textureDepthVal', 'textureFreqSlider', 'textureFreqVal'].map($);

function syncControlsFromActivePart() {
  const p = activePart(), maxH = Math.max(1, MAX_HEIGHT_MM - (p.baseZ || 0));
  const isRevolve = p.type === 'revolve';
  $('baseZInput').value = p.baseZ || 0;
  extrudeSlider.max = maxH;
  p.extrudeHeight = Math.min(maxH, p.extrudeHeight || 8);
  const dispH = isRevolve ? Math.round(getPartEffectiveHeightMm(p) * 10) / 10 : p.extrudeHeight;
  extrudeSlider.value = Math.min(maxH, dispH); extrudeInput.value = dispH;
  extrudeSlider.disabled = isRevolve; extrudeInput.disabled = isRevolve;
  const lockTip = isRevolve ? 'Driven by 2D profile Y-span' : '';
  extrudeSlider.title = lockTip; extrudeInput.title = lockTip;
  extrudeInput.classList.toggle('opacity-60', isRevolve);
  $('heightZLockHint')?.classList.toggle('hidden', !isRevolve);
  roundSlider.value = p.cornerRadius || 0; roundVal.textContent = (p.cornerRadius || 0) + 'mm';
  bevelSlider.value = p.bevelSize ?? 0; bevelVal.textContent = (p.bevelSize ?? 0) + 'mm';
  twistSlider.value = p.twistDeg || 0; twistVal.textContent = (p.twistDeg || 0) + '°';

  shellToggleBtn.textContent = p.shellEnabled ? 'Shell: On' : 'Shell: Off';
  shellToggleBtn.className = `brand-btn text-xs font-${p.shellEnabled ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2.5 py-1 rounded-lg`;
  shellModeSelect.classList.toggle('hidden', !p.shellEnabled);
  shellModeSelect.value = p.shellMode || 'hollow';
  shellInputWrap.classList.toggle('hidden', !p.shellEnabled);
  shellInput.value = p.shellThickness || 1.2;

  texturePatternSelect.value = p.texturePattern || 'none';
  const isWeave = p.texturePattern === 'open-weave' || p.texturePattern === 'perforated-weave';
  textureControlsWrap.classList.toggle('hidden', !(p.texturePattern && p.texturePattern !== 'none') || isWeave);
  textureDepthSlider.value = p.textureDepth ?? 0.8; textureDepthVal.textContent = (p.textureDepth ?? 0.8) + 'mm';
  textureFreqSlider.value = p.textureFreq ?? 24; textureFreqVal.textContent = (p.textureFreq ?? 24) + 'w';
  $('loftTopShapeSelect').value = p.loftTopShape || 'circle';
  $('loftTopScaleSlider').value = p.loftTopScale ?? 0.7; $('loftTopScaleVal').textContent = (p.loftTopScale ?? 0.7).toFixed(2) + '×';
  $('loftTwistSlider').value = p.loftTwistDeg || 0; $('loftTwistVal').textContent = (p.loftTwistDeg || 0) + '°';
  $('weaveBandsSlider').value = p.weaveBands ?? 2.5; $('weaveBandsVal').textContent = (p.weaveBands ?? 2.5) + 'mm';
  $('weaveGapSlider').value = p.weaveGapMm ?? 0.8; $('weaveGapVal').textContent = (p.weaveGapMm ?? 0.8) + 'mm';
  $('weavePillarsSlider').value = p.weavePillars ?? 16; $('weavePillarsVal').textContent = String(p.weavePillars ?? 16);
  $('weaveTwistSlider').value = p.weaveTwistDeg ?? 0; $('weaveTwistVal').textContent = (p.weaveTwistDeg ?? 0) + '°';

  $('typeExtrudeBtn').className = `brand-btn text-xs font-${p.type === 'extrude' ? 'bold bg-[#FF66D9] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2 py-2 rounded-lg`;
  $('typeRevolveBtn').className = `brand-btn text-xs font-${p.type === 'revolve' ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2 py-2 rounded-lg`;
  $('typeLoftBtn').className = `brand-btn text-xs font-${p.type === 'loft' ? 'bold bg-[#00E56D] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2 py-2 rounded-lg`;
  const isLampshade = p.intent === 'lampshade', isClear = p.materialTag === 'clear';
  $('intentVesselBtn').className = !isLampshade ? 'text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] font-semibold px-2 py-0.5 rounded-md text-zinc-300';
  $('intentLampshadeBtn').className = isLampshade ? 'text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] font-semibold px-2 py-0.5 rounded-md text-zinc-300';
  $('partIntentSelect').value = p.intent || 'vessel';
  $('planeSelect').value = p.sketchPlane || 'XY';
  $('materialOpaqueBtn').className = !isClear ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-[#FEFF00] text-[#020203]' : 'text-[10px] font-semibold px-2 py-0.5 rounded text-zinc-300';
  $('materialClearBtn').className = isClear ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-[#73E6F1] text-[#020203]' : 'text-[10px] font-semibold px-2 py-0.5 rounded text-zinc-300';

  document.querySelectorAll('.color-swatch').forEach(b => {
    b.style.borderColor = b.dataset.color.toLowerCase() === p.color.toLowerCase() ? '#ffffff' : 'transparent';
  });
  pointCountBadge.textContent = `${p.points.length} pts · ${state.parts.length} part${state.parts.length > 1 ? 's' : ''}`;
  renderPartsMenu();
  syncPitchReadout(state, p);
  stageRouter?.syncModifierCards(p);
  stageRouter?.syncRevolveGuide(p);
}

function renderPartsMenu() {
  const list = $('partsList');
  list.textContent = '';
  state.parts.forEach((pt, idx) => {
    const b = document.createElement('button');
    b.className = (idx === state.activePartIndex ? 'text-xs font-bold px-2 py-1 rounded-lg bg-[#FEFF00]/15 text-[#FEFF00]' : 'text-xs font-medium px-2 py-1 rounded-lg hover:bg-[#14141d] text-zinc-300') + ' text-left flex justify-between';
    const n = document.createElement('span'); n.textContent = pt.name;
    const z = document.createElement('span'); z.className = 'font-mono text-[10px]'; z.textContent = `${pt.materialTag === 'clear' ? 'CLR' : 'OPQ'}·Z${pt.baseZ || 0}`;
    b.append(n, z);
    b.addEventListener('click', () => { state.activePartIndex = idx; syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
    list.appendChild(b);
  });
}

function setMode(mode) {
  state.mode = mode;
  const off = 'brand-btn text-xs font-semibold px-2.5 py-2 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-200';
  const on = 'brand-btn text-xs font-bold px-2.5 py-2 rounded-lg bg-[#FEFF00] text-[#020203]';
  [['modeFreehandBtn', 'freehand'], ['modePolyBtn', 'poly'], ['modeBezierBtn', 'bezier'], ['modeEditBtn', 'edit']]
    .forEach(([id, m]) => { $(id).className = mode === m ? on : off; });
  sketchHintText.textContent = HINTS[mode] || '';
}

function applyMigratedProject(v2, isPreset = false) {
  state.parts = v2.parts.map(pt => createPart(pt));
  state.activePartIndex = Math.max(0, Math.min(state.parts.length - 1, v2.activePartIndex || 0));
  state.scaleMode = v2.scaleMode || 'full';
  state.slicerTarget = v2.slicerTarget || 'bambu_studio';
  state.slicerProfileManual = false;
  state.slicerProfile = isPreset ? resolveAutoSlicerProfile(state.parts, 'auto') : (v2.slicerProfile || resolveAutoSlicerProfile(state.parts, 'auto'));
  state.revolveGuide = Boolean(v2.revolveGuide);
  state.activeCutout = [];
  $('slicerTargetSelect').value = state.slicerTarget;
  $('slicerProfileSelect').value = state.slicerProfile;
  $('slicerProfileSummary').textContent = PROFILE_SUMMARIES[state.slicerProfile] || '';
  setMode('edit'); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget();
}

function loadPreset(name) {
  if (!PRESETS[name]) return;
  applyMigratedProject(migrateProjectV1ToV2(PRESETS[name]), true);
  $('templatesMenu')?.classList.add('hidden');
}

function setProofScaleMode(mode) {
  state.scaleMode = mode;
  $('proofScaleSelect').value = mode;
  [['scaleFullBtn', 'full'], ['scaleMiniBtn', 'mini'], ['scaleSwatchBtn', 'swatch']].forEach(([id, m]) => {
    $(id).className = mode === m ? 'text-[10px] font-bold px-2 py-1 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] font-semibold px-2 py-1 rounded-md text-zinc-300';
  });
  rebuild3DMesh(); updateCameraTarget();
  showToast(mode === 'mini' ? '40% Mini Proof (Decoupled Relief)' : mode === 'swatch' ? '35mm Swatch (1:1 Ring)' : '100% Full Scale');
}

function exportSTLFile() {
  const meshes = viewport3D.partsGroup.children.filter(c => c.isMesh);
  if (meshes.length === 0) { showToast('Draw a closed shape first!'); return; }
  const { triangles, minZ } = extractPrintableTriangles(meshes);
  if (triangles.length === 0) { showToast('No printable triangles!'); return; }
  triangles.forEach(t => { t.a.z -= minZ; t.b.z -= minZ; t.c.z -= minZ; });
  const openEdges = checkManifoldEdges(triangles);
  const filename = getExportFilename('sketch3d_bambu_a1', state.scaleMode);
  downloadSTL(buildBinarySTLBuffer(triangles), filename);
  showToast(`Exported ${filename}: ${triangles.length} tris · ${openEdges === 0 ? 'Watertight' : `${openEdges} open edges`}`);
}

const templatesMenu = $('templatesMenu'), projectMenu = $('projectMenu');
$('templatesMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); projectMenu.classList.add('hidden'); templatesMenu.classList.toggle('hidden'); });
$('projectMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); templatesMenu.classList.add('hidden'); projectMenu.classList.toggle('hidden'); });
document.addEventListener('click', (e) => {
  if (!templatesMenu.contains(e.target)) templatesMenu.classList.add('hidden');
  if (!projectMenu.contains(e.target)) projectMenu.classList.add('hidden');
});

$('saveProjectBtn').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(serializeProjectV2(state), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'sketch3d_project_v2.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  projectMenu.classList.add('hidden'); showToast('Saved Project v2 (.json)');
});

const loadInput = $('loadProjectInput');
$('loadProjectBtn').addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const v2 = migrateProjectV1ToV2(await file.text());
    applyMigratedProject(v2);
    stageRouter?.setStage(v2.activeStage || 1);
    showToast(`Loaded ${file.name} (v2 schema)`);
  } catch (err) { showToast(err.message || 'Invalid project JSON'); }
  loadInput.value = ''; projectMenu.classList.add('hidden');
});

[['presetCardBtn', 'card'], ['presetHexBtn', 'hex'], ['presetLampBtn', 'lamp'], ['presetVaseBtn', 'vase']]
  .forEach(([id, name]) => $(id).addEventListener('click', () => loadPreset(name)));
$('studioPresetsSelect').addEventListener('change', (e) => { if (e.target.value) { loadPreset(e.target.value); e.target.value = ''; } });
$('exportStlBtn').addEventListener('click', exportSTLFile);
$('export3mfBtn').addEventListener('click', () => exportThreeMFFile(state.parts, viewport3D.partsGroup, state.slicerProfile, state.scaleMode, showToast, state.slicerTarget));

[['modeFreehandBtn', 'freehand'], ['modePolyBtn', 'poly'], ['modeBezierBtn', 'bezier'], ['modeEditBtn', 'edit'],
  ['shapeRectBtn', 'rect'], ['shapeCircleBtn', 'circle'], ['shapeHexBtn', 'hex'], ['modeHoleBtn', 'hole'], ['modeStandoffBtn', 'standoff'], ['modeCutoutBtn', 'cutout']]
  .forEach(([id, m]) => $(id).addEventListener('click', () => setMode(m)));

$('gridArrayBtn').addEventListener('click', () => {
  const p = activePart();
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) p.cutouts.push([{ x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 - 7 }, { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 - 7 }, { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 + 7 }, { x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 + 7 }]);
  sketch2D.draw(); rebuild3DMesh(); showToast('Added 3×2 cutout grid (14×14 mm)');
});
$('snapToggleBtn').addEventListener('click', (e) => {
  snapIdx = (snapIdx + 1) % SNAP_CYCLE.length;
  const cfg = SNAP_CYCLE[snapIdx];
  state.snapEnabled = cfg.enabled; state.snapStep = cfg.step; e.currentTarget.textContent = cfg.label;
  e.currentTarget.className = state.snapEnabled ? 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/50' : 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] text-zinc-400 border border-[#2a2a3c]';
});
$('undoBtn').addEventListener('click', () => {
  const p = activePart();
  if (state.mode === 'hole' && p.holes.length > 0) p.holes.pop();
  else if (state.mode === 'cutout' && state.activeCutout.length > 0) state.activeCutout.pop();
  else if (state.mode === 'cutout' && p.cutouts.length > 0) p.cutouts.pop();
  else if (p.isClosed) p.isClosed = false;
  else if (p.points.length > 0) p.points.pop();
  sketch2D.draw(); rebuild3DMesh();
});
$('closeShapeBtn').addEventListener('click', () => {
  const p = activePart();
  if (state.mode === 'cutout' && state.activeCutout.length >= 3) { p.cutouts.push([...state.activeCutout]); state.activeCutout = []; }
  else if (p.points.length >= 3) { p.isClosed = true; setMode('edit'); }
  sketch2D.draw(); rebuild3DMesh();
});
$('clearBtn').addEventListener('click', () => {
  state.parts = [createPart({ name: 'Part 1' })];
  state.activePartIndex = 0; state.activeCutout = []; state.freehandStroke = [];
  state.primitiveDrag = null; state.draggingVertex = null; state.inferGuide = null;
  state.slicerProfileManual = false;
  syncAutoSlicerProfile(state, true);
  syncControlsFromActivePart(); setMode('poly'); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget(); showToast('Cleared entire board');
});

$('typeExtrudeBtn').addEventListener('click', () => { activePart().type = 'extrude'; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
$('typeRevolveBtn').addEventListener('click', () => { const p = activePart(); p.type = 'revolve'; if (!p.sketchPlane || p.sketchPlane === 'XY') p.sketchPlane = 'XZ'; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
$('typeLoftBtn').addEventListener('click', () => { activePart().type = 'loft'; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
$('loftTopShapeSelect').addEventListener('change', (e) => { activePart().loftTopShape = e.target.value; rebuild3DMesh(); });
$('loftTopScaleSlider').addEventListener('input', (e) => { activePart().loftTopScale = Number(e.target.value); $('loftTopScaleVal').textContent = Number(e.target.value).toFixed(2) + '×'; rebuild3DMesh(); });
$('loftTwistSlider').addEventListener('input', (e) => { activePart().loftTwistDeg = Number(e.target.value); $('loftTwistVal').textContent = e.target.value + '°'; rebuild3DMesh(); });
$('materialOpaqueBtn').addEventListener('click', () => { activePart().materialTag = 'opaque'; syncControlsFromActivePart(); rebuild3DMesh(); });
$('materialClearBtn').addEventListener('click', () => { activePart().materialTag = 'clear'; syncControlsFromActivePart(); rebuild3DMesh(); });

$('stackPartBtn').addEventListener('click', () => {
  const cur = activePart();
  if (cur.points.length < 3 || !cur.isClosed) { showToast('Close current part before stacking!'); return; }
  const newBaseZ = (cur.baseZ || 0) + cur.extrudeHeight;
  if (newBaseZ >= MAX_HEIGHT_MM) { showToast('Already at 256 mm A1 ceiling!'); return; }
  state.parts.push(createPart({ name: `Part ${state.parts.length + 1}`, baseZ: newBaseZ, extrudeHeight: Math.min(8, MAX_HEIGHT_MM - newBaseZ), points: cur.points.map(pt => ({ x: Math.round(pt.x * 0.7), y: Math.round(pt.y * 0.7) })), isClosed: cur.isClosed, color: '#73E6F1' }));
  state.activePartIndex = state.parts.length - 1;
  syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget();
});
$('newPartBtn').addEventListener('click', () => {
  state.parts.push(createPart({ name: `Part ${state.parts.length + 1}`, points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }], isClosed: true, color: '#FEFF00' }));
  state.activePartIndex = state.parts.length - 1; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh();
});
$('deletePartBtn').addEventListener('click', () => {
  if (state.parts.length <= 1) { showToast('Keep at least 1 part'); return; }
  state.parts.splice(state.activePartIndex, 1); state.activePartIndex = Math.max(0, state.activePartIndex - 1);
  syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh();
});

const onExtrudeSliderEvt = (e) => {
  const p = activePart(), maxH = Math.max(1, MAX_HEIGHT_MM - (p.baseZ || 0));
  if (p.type === 'revolve') return;
  p.extrudeHeight = Math.max(1, Math.min(maxH, Math.round(Number(e.target.value) || 8)));
  extrudeInput.value = p.extrudeHeight; rebuild3DMesh(); updateCameraTarget();
};
extrudeSlider.addEventListener('input', onExtrudeSliderEvt);
extrudeSlider.addEventListener('change', onExtrudeSliderEvt);
roundSlider.addEventListener('input', (e) => { activePart().cornerRadius = Number(e.target.value); roundVal.textContent = e.target.value + 'mm'; sketch2D.draw(); rebuild3DMesh(); });
bevelSlider.addEventListener('input', (e) => { activePart().bevelSize = Number(e.target.value); bevelVal.textContent = e.target.value + 'mm'; rebuild3DMesh(); });
twistSlider.addEventListener('input', (e) => { activePart().twistDeg = Number(e.target.value); twistVal.textContent = e.target.value + '°'; rebuild3DMesh(); });
shellToggleBtn.addEventListener('click', () => { activePart().shellEnabled = !activePart().shellEnabled; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
shellModeSelect.addEventListener('change', (e) => { activePart().shellMode = e.target.value; syncAutoSlicerProfile(state); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
shellInput.addEventListener('change', (e) => { activePart().shellThickness = Math.max(0.4, Math.min(15, Number(e.target.value) || 1.2)); shellInput.value = activePart().shellThickness; syncAutoSlicerProfile(state); sketch2D.draw(); rebuild3DMesh(); });
[['intentVesselBtn', 'vessel'], ['intentLampshadeBtn', 'lampshade']].forEach(([id, it]) => $(id).addEventListener('click', () => { activePart().intent = it; syncAutoSlicerProfile(state); syncControlsFromActivePart(); rebuild3DMesh(); }));
$('partIntentSelect').addEventListener('change', (e) => { activePart().intent = e.target.value; syncAutoSlicerProfile(state); syncControlsFromActivePart(); rebuild3DMesh(); });
texturePatternSelect.addEventListener('change', (e) => {
  activePart().texturePattern = e.target.value;
  syncAutoSlicerProfile(state);
  syncControlsFromActivePart(); rebuild3DMesh();
});
$('weaveBandsSlider').addEventListener('input', (e) => { activePart().weaveBands = Number(e.target.value); $('weaveBandsVal').textContent = e.target.value + 'mm'; rebuild3DMesh(); });
$('weaveGapSlider').addEventListener('input', (e) => { activePart().weaveGapMm = Number(e.target.value); $('weaveGapVal').textContent = e.target.value + 'mm'; rebuild3DMesh(); });
$('weavePillarsSlider').addEventListener('input', (e) => { activePart().weavePillars = Number(e.target.value); $('weavePillarsVal').textContent = e.target.value; rebuild3DMesh(); });
$('weaveTwistSlider').addEventListener('input', (e) => { activePart().weaveTwistDeg = Number(e.target.value); $('weaveTwistVal').textContent = e.target.value + '°'; rebuild3DMesh(); });
textureDepthSlider.addEventListener('input', (e) => { activePart().textureDepth = Number(e.target.value); textureDepthVal.textContent = e.target.value + 'mm'; rebuild3DMesh(); });
textureFreqSlider.addEventListener('input', (e) => { activePart().textureFreq = Number(e.target.value); textureFreqVal.textContent = e.target.value + 'w'; syncPitchReadout(state, activePart()); rebuild3DMesh(); });
document.querySelectorAll('.color-swatch').forEach(btn => btn.addEventListener('click', () => { activePart().color = btn.dataset.color; syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); }));

$('slicerTargetSelect').addEventListener('change', (e) => { state.slicerTarget = e.target.value; });
$('slicerProfileSelect').addEventListener('change', (e) => {
  state.slicerProfile = e.target.value;
  state.slicerProfileManual = true;
  $('slicerProfileSummary').textContent = PROFILE_SUMMARIES[state.slicerProfile] || '';
  rebuild3DMesh();
  if (state.slicerProfile === 'clear_glass') showToast(DRYING_NOTIFICATION);
});
[['scaleFullBtn', 'full'], ['scaleMiniBtn', 'mini'], ['scaleSwatchBtn', 'swatch']].forEach(([id, m]) => $(id).addEventListener('click', () => setProofScaleMode(m)));
$('proofScaleSelect').addEventListener('change', (e) => setProofScaleMode(e.target.value));

$('wireframeBtn').addEventListener('click', (e) => {
  state.wireframe = !state.wireframe;
  e.currentTarget.className = `brand-btn text-[11px] font-${state.wireframe ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-[#73E6F1]'} px-2 py-1 rounded-lg`;
  rebuild3DMesh();
});
$('autoSpinBtn').addEventListener('click', (e) => {
  const isSpin = viewport3D.toggleAutoSpin();
  e.currentTarget.className = `brand-btn text-[11px] font-${isSpin ? 'bold bg-[#FEFF00] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2 py-1 rounded-lg`;
});
[['zoomInBtn', () => viewport3D.zoomIn()], ['zoomOutBtn', () => viewport3D.zoomOut()], ['resetViewBtn', () => viewport3D.resetView()]].forEach(([id, fn]) => $(id).addEventListener('click', fn));
[['viewSplitBtn', 'split'], ['view2DBtn', '2d'], ['view3DBtn', '3d']].forEach(([id, v]) => {
  $(id).addEventListener('click', () => {
    ['viewSplitBtn', 'view2DBtn', 'view3DBtn'].forEach(bid => {
      $(bid).className = bid === id ? 'text-[11px] font-bold px-2 py-1 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[11px] font-semibold px-2 py-1 rounded-md text-zinc-300';
    });
    stageRouter?.setMobileView(v);
  });
});

window.addEventListener('resize', () => { sketch2D.resize(); viewport3D.resize(); });
window.onload = () => {
  stageRouter = initStageRouter({ state, sketch2D, viewport3D, onStageChange: () => syncControlsFromActivePart() });
  loadPreset('card');
  initPart2Controls({ state, sketch2D, viewport3D, rebuild3DMesh, showToast, syncControlsFromActivePart, updateCameraTarget });
  initToolpathControls({ state, sketch2D, viewport3D, rebuild3DMesh, showToast, syncControlsFromActivePart, updateCameraTarget });
  window.sketch3d = { state, viewport3D, rebuild3DMesh, loadPreset, stageRouter, migrateProjectV1ToV2 };
  sketch2D.resize(); viewport3D.resize(); viewport3D.animate();
};
