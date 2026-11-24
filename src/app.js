/**
 * SKETCH3D — Main Application Controller
 * ========================================
 * Coordinates 2D sketch canvas, Three.js 3D viewport, Bambu Lab A1 build bounds,
 * parametric modifiers (extrude, round, bevel, twist, 3D shelling, surface textures),
 * scaled test-print proofs (40% mini proof & 35mm swatch), and binary STL export.
 */

import { initSketch2D, BED_SIZE_MM } from './canvas/sketch2d.js';
import { initViewport3D } from './view/viewport3d.js';
import { buildPartGeometry, buildStandoffMeshes } from './geometry/meshBuilder.js';
import { PRESETS } from './config/presets.js';
import { applyScaleModeToGeometry, getExportFilename } from './geometry/testScale.js';
import {
  extractPrintableTriangles,
  checkManifoldEdges,
  buildBinarySTLBuffer,
  downloadSTL,
  estimateFilamentMass
} from './export/stlExporter.js';
import { exportThreeMFFile, DRYING_NOTIFICATION } from './export/threemfExporter.js';
import { initPart2Controls } from './view/part2Controls.js';

const MAX_HEIGHT_MM = 256;
const SNAP_CYCLE = [
  { enabled: true, step: 5, label: 'Snap: 5mm' },
  { enabled: true, step: 1, label: 'Snap: 1mm' },
  { enabled: true, step: 10, label: 'Snap: 10mm' },
  { enabled: false, step: 0, label: 'Snap: Off' }
];
let snapIdx = 0;

function createPart(o = {}) {
  return {
    id: 'p_' + Math.random().toString(36).slice(2, 7),
    name: o.name || 'Part 1', type: o.type || 'extrude', intent: o.intent || 'vessel', points: o.points || [],
    isClosed: o.isClosed ?? false, holes: o.holes || [], standoffs: o.standoffs || [], cutouts: o.cutouts || [],
    baseZ: o.baseZ || 0, extrudeHeight: o.extrudeHeight || 8, cornerRadius: o.cornerRadius || 0,
    shellEnabled: o.shellEnabled || false, shellMode: o.shellMode || 'hollow', shellThickness: o.shellThickness || 1.2,
    bevelSize: o.bevelSize ?? 0.5, twistDeg: o.twistDeg || 0, sketchPlane: o.sketchPlane || 'XY',
    texturePattern: o.texturePattern || 'none', textureDepth: o.textureDepth ?? 0.8, textureFreq: o.textureFreq ?? 24,
    color: o.color || '#FF66D9'
  };
}

const state = {
  parts: [createPart({ name: 'Part 1' })],
  activePartIndex: 0,
  activeCutout: [],
  freehandStroke: [],
  primitiveDrag: null,
  inferGuide: null,
  mode: 'edit',
  snapEnabled: true,
  snapStep: 5,
  wireframe: false,
  scaleMode: 'full',
  slicerProfile: 'vase',
  draggingVertex: null,
  lastTapTime: 0,
  lastTapIndex: -1
};

const activePart = () => state.parts[state.activePartIndex] || state.parts[0];

function showToast(msg) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2400);
}

// 3D Viewport Initialization
const [threeContainer, dimOverlay, estimateOverlay, fitBadge] =
  ['threeContainer', 'dimOverlay', 'estimateOverlay', 'fitBadge'].map(id => document.getElementById(id));

const viewport3D = initViewport3D({
  container: threeContainer,
  bedSizeMm: BED_SIZE_MM,
  maxHeightMm: MAX_HEIGHT_MM
});

function rebuild3DMesh() {
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
    let geom = buildPartGeometry(p);
    if (!geom) return;

    if (state.scaleMode !== 'full') {
      geom = applyScaleModeToGeometry(geom, state.scaleMode);
    }

    const isVaseProxy = p.shellEnabled && p.shellMode === 'vase_proxy';
    const mat = new THREE.MeshStandardMaterial({
      color: p.color,
      roughness: 0.35,
      metalness: 0.15,
      wireframe: state.wireframe,
      opacity: isVaseProxy ? 0.82 : (idx === state.activePartIndex ? 1.0 : 0.85),
      transparent: isVaseProxy || idx !== state.activePartIndex
    });

    const mainMesh = new THREE.Mesh(geom, mat);
    partsGroup.add(mainMesh);
    meshes.push(mainMesh);

    const standoffMeshes = buildStandoffMeshes(p, mat);
    standoffMeshes.forEach(sm => partsGroup.add(sm));

    if (p.twistDeg === 0 && p.type === 'extrude' && (!p.texturePattern || p.texturePattern === 'none')) {
      partsGroup.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: idx === state.activePartIndex ? 0x73E6F1 : 0x3b4252, transparent: true, opacity: 0.45 })
      ));
    }

    geom.computeBoundingBox();
    fullBox.union(geom.boundingBox);
  });

  if (meshes.length === 0) {
    dimOverlay.textContent = 'Size: -- × -- × -- mm';
    estimateOverlay.textContent = '~-- g PLA';
    fitBadge.textContent = `A1 Max: ${BED_SIZE_MM}×${BED_SIZE_MM}×${MAX_HEIGHT_MM} mm`;
    fitBadge.className = 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono';
    return;
  }
  const w = (fullBox.max.x - fullBox.min.x).toFixed(1);
  const d = (fullBox.max.z - fullBox.min.z).toFixed(1);
  const h = (fullBox.max.y - fullBox.min.y).toFixed(1);
  dimOverlay.textContent = `Size: ${w} × ${d} × ${h} mm`;
  estimateOverlay.textContent = `~${estimateFilamentMass(state.parts, meshes).toFixed(1)} g PLA`;

  const fits = Number(w) <= BED_SIZE_MM && Number(d) <= BED_SIZE_MM && Number(h) <= MAX_HEIGHT_MM;
  fitBadge.textContent = fits ? `✓ Fits A1 Bed (${w}×${d}×${h}mm)` : `⚠️ Exceeds A1 Bed (${w}×${d}×${h}mm)`;
  fitBadge.className = fits
    ? 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono'
    : 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#FEFF00]/15 text-[#FEFF00] border border-[#FEFF00]/60 font-mono';
}

function updateCameraTarget() {
  const p = activePart();
  const targetY = Math.min((p.baseZ || 0) + (p.extrudeHeight || 8) * 0.45, 115);
  viewport3D.updateCamera(targetY);
}

// 2D Sketch Init
const [sketchCanvas, sketchContainer, sketchHintText, pointCountBadge] =
  ['sketchCanvas', 'sketchContainer', 'sketchHintText', 'pointCountBadge'].map(id => document.getElementById(id));

const sketch2D = initSketch2D({
  canvas: sketchCanvas,
  container: sketchContainer,
  state,
  onModelChange: () => {
    const ap = activePart();
    pointCountBadge.textContent = `${ap.points.length} pts · ${state.parts.length} part${state.parts.length > 1 ? 's' : ''}`;
    rebuild3DMesh();
  },
  onModeChange: (m) => setMode(m)
});

// UI Controls
const [extrudeSlider, extrudeInput, roundSlider, roundVal, bevelSlider, bevelVal, twistSlider, twistVal,
  shellToggleBtn, shellModeSelect, shellInputWrap, shellInput,
  texturePatternSelect, textureControlsWrap, textureDepthSlider, textureDepthVal,
  textureFreqSlider, textureFreqVal] = [
  'extrudeSlider', 'extrudeInput', 'roundSlider', 'roundVal', 'bevelSlider', 'bevelVal', 'twistSlider', 'twistVal',
  'shellToggleBtn', 'shellModeSelect', 'shellInputWrap', 'shellInput',
  'texturePatternSelect', 'textureControlsWrap', 'textureDepthSlider', 'textureDepthVal',
  'textureFreqSlider', 'textureFreqVal'].map(id => document.getElementById(id));

function syncControlsFromActivePart() {
  const p = activePart();
  const maxH = Math.max(1, MAX_HEIGHT_MM - (p.baseZ || 0));
  const bz = document.getElementById('baseZInput');
  if (bz) bz.value = p.baseZ || 0;

  extrudeSlider.max = maxH; extrudeInput.max = maxH;
  p.extrudeHeight = Math.min(maxH, p.extrudeHeight || 8);
  extrudeSlider.value = p.extrudeHeight; extrudeInput.value = p.extrudeHeight;
  roundSlider.value = p.cornerRadius || 0; roundVal.textContent = (p.cornerRadius || 0) + 'mm';
  bevelSlider.value = p.bevelSize ?? 0.5; bevelVal.textContent = (p.bevelSize ?? 0.5) + 'mm';
  twistSlider.value = p.twistDeg || 0; twistVal.textContent = (p.twistDeg || 0) + '°';

  shellToggleBtn.textContent = p.shellEnabled ? 'Shell: On' : 'Shell: Off';
  shellToggleBtn.className = `brand-btn text-xs font-${p.shellEnabled ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2.5 py-1 rounded-lg`;
  shellModeSelect.classList.toggle('hidden', !p.shellEnabled);
  shellModeSelect.value = p.shellMode || 'hollow';
  shellInputWrap.classList.toggle('hidden', !p.shellEnabled);
  shellInput.value = p.shellThickness || 1.2;

  texturePatternSelect.value = p.texturePattern || 'none';
  const hasTex = p.texturePattern && p.texturePattern !== 'none';
  textureControlsWrap.classList.toggle('hidden', !hasTex);
  textureDepthSlider.value = p.textureDepth ?? 0.8;
  textureDepthVal.textContent = (p.textureDepth ?? 0.8) + 'mm';
  textureFreqSlider.value = p.textureFreq ?? 24;
  textureFreqVal.textContent = (p.textureFreq ?? 24) + 'w';

  document.getElementById('typeExtrudeBtn').className = `brand-btn text-xs font-${p.type === 'extrude' ? 'bold bg-[#FF66D9] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2.5 py-1 rounded-lg`;
  document.getElementById('typeRevolveBtn').className = `brand-btn text-xs font-${p.type === 'revolve' ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2.5 py-1 rounded-lg`;

  const isLampshade = p.intent === 'lampshade';
  const vBtn = document.getElementById('intentVesselBtn');
  const lBtn = document.getElementById('intentLampshadeBtn');
  const piSel = document.getElementById('partIntentSelect');
  if (vBtn && lBtn) {
    vBtn.className = !isLampshade ? 'text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md text-zinc-300 hover:text-white';
    lBtn.className = isLampshade ? 'text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md text-zinc-300 hover:text-white';
  }
  if (piSel) piSel.value = p.intent || 'vessel';
  const plSel = document.getElementById('planeSelect');
  if (plSel) plSel.value = p.sketchPlane || 'XY';

  document.querySelectorAll('.color-swatch').forEach(b => {
    b.style.borderColor = b.dataset.color.toLowerCase() === p.color.toLowerCase() ? '#ffffff' : 'transparent';
  });
  renderPartsMenu();
}

function renderPartsMenu() {
  document.getElementById('partsMenuBtn').textContent = `Parts (${state.parts.length}) ▾`;
  const list = document.getElementById('partsList');
  list.textContent = '';
  state.parts.forEach((pt, idx) => {
    const b = document.createElement('button');
    b.className = (idx === state.activePartIndex ? 'text-xs font-bold px-2 py-1 rounded-lg bg-[#FEFF00]/15 text-[#FEFF00]' : 'text-xs font-medium px-2 py-1 rounded-lg hover:bg-[#14141d] text-zinc-300') + ' text-left flex justify-between';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = pt.name;
    const zSpan = document.createElement('span');
    zSpan.className = 'font-mono text-[10px]';
    zSpan.textContent = `Z:${pt.baseZ || 0}`;
    b.append(nameSpan, zSpan);
    b.addEventListener('click', () => {
      state.activePartIndex = idx;
      syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh();
      document.getElementById('partsMenu').classList.add('hidden');
    });
    list.appendChild(b);
  });
}

function setExtrudeHeight(rawVal) {
  const parsed = Number(rawVal), p = activePart();
  if (Number.isNaN(parsed)) return;
  const maxH = Math.max(1, MAX_HEIGHT_MM - (p.baseZ || 0));
  const clamped = Math.max(1, Math.min(maxH, Math.round(parsed)));
  p.extrudeHeight = clamped;
  extrudeSlider.value = clamped; extrudeInput.value = clamped;
  rebuild3DMesh(); updateCameraTarget();
}

function setMode(mode) {
  state.mode = mode;
  const off = 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-200';
  const on = 'brand-btn text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#FEFF00] text-[#020203]';
  document.getElementById('modeFreehandBtn').className = mode === 'freehand' ? on : off;
  document.getElementById('modePolyBtn').className = mode === 'poly' ? on : off;
  document.getElementById('modeEditBtn').className = mode === 'edit' ? on : off;
  const shapesBtn = document.getElementById('shapesMenuBtn');
  const isShape = ['rect', 'circle', 'hex', 'hole', 'standoff', 'cutout'].includes(mode);
  shapesBtn.className = isShape
    ? 'brand-btn text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#73E6F1] text-[#020203]'
    : 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-[#73E6F1]';

  const hints = {
    freehand: 'Draw: Drag finger or Apple Pencil to sketch a closed shape',
    poly: 'Poly: Tap to place points (90° Ortho + Midpoint snap) · Tap green dot to close',
    edit: 'Edit: Drag dots or center · Double-tap dot to delete',
    rect: 'Rectangle: Drag corner-to-corner on canvas', circle: 'Circle: Drag center-to-radius on canvas',
    hex: 'Hexagon: Drag center-to-radius on canvas', hole: 'Tap inside shape to drop an M3 hole',
    standoff: 'Tap inside shape to drop an M3 standoff boss', cutout: 'Tap points inside shape · Tap green dot to cut'
  };
  sketchHintText.textContent = hints[mode] || '';
}

function loadPreset(name) {
  const pr = PRESETS[name];
  if (!pr) return;
  state.parts = [createPart({
    ...pr,
    points: pr.points.map(pt => ({ ...pt })),
    holes: (pr.holes || []).map(h => ({ ...h })),
    cutouts: (pr.cutouts || []).map(c => c.map(pt => ({ ...pt })))
  })];
  state.activePartIndex = 0; state.activeCutout = [];
  setMode('edit'); syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget();
}

function setProofScaleMode(mode) {
  state.scaleMode = mode;
  const sel = document.getElementById('proofScaleSelect');
  if (sel) sel.value = mode;
  ['scaleFullBtn', 'scaleMiniBtn', 'scaleSwatchBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    const active = (id === 'scaleFullBtn' && mode === 'full') || (id === 'scaleMiniBtn' && mode === 'mini') || (id === 'scaleSwatchBtn' && mode === 'swatch');
    b.className = active ? 'text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]' : 'text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md text-zinc-300 hover:text-white';
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
  const buffer = buildBinarySTLBuffer(triangles);
  downloadSTL(buffer, getExportFilename('sketch3d_bambu_a1', state.scaleMode));
  showToast(`STL Ready: ${triangles.length} tris · ${openEdges === 0 ? 'Watertight' : `${openEdges} open edges`}`);
}

function setPartIntent(intent) {
  const p = activePart();
  p.intent = intent;
  syncControlsFromActivePart();
  rebuild3DMesh();
}

// Event Bindings
[['presetCardBtn', 'card'], ['presetHexBtn', 'hex'], ['presetLampBtn', 'lamp'], ['presetVaseBtn', 'vase']]
  .forEach(([id, name]) => document.getElementById(id).addEventListener('click', () => loadPreset(name)));

const studioSelect = document.getElementById('studioPresetsSelect');
if (studioSelect) studioSelect.addEventListener('change', (e) => { if (e.target.value) { loadPreset(e.target.value); studioSelect.value = ''; } });

document.getElementById('exportStlBtn').addEventListener('click', exportSTLFile);
const exp3mf = document.getElementById('export3mfBtn');
if (exp3mf) exp3mf.addEventListener('click', () => exportThreeMFFile(state.parts, viewport3D.partsGroup, state.slicerProfile, state.scaleMode, showToast));

[['intentVesselBtn', 'vessel'], ['intentLampshadeBtn', 'lampshade']].forEach(([id, it]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => setPartIntent(it));
});
const piSel = document.getElementById('partIntentSelect');
if (piSel) piSel.addEventListener('change', (e) => setPartIntent(e.target.value));

const slSel = document.getElementById('slicerProfileSelect');
if (slSel) slSel.addEventListener('change', (e) => {
  state.slicerProfile = e.target.value;
  if (state.slicerProfile === 'clear_glass') showToast(DRYING_NOTIFICATION);
});

[['scaleFullBtn', 'full'], ['scaleMiniBtn', 'mini'], ['scaleSwatchBtn', 'swatch']].forEach(([id, m]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => setProofScaleMode(m));
});
const proofScaleSel = document.getElementById('proofScaleSelect');
if (proofScaleSel) proofScaleSel.addEventListener('change', (e) => setProofScaleMode(e.target.value));

const shapesMenu = document.getElementById('shapesMenu'), partsMenu = document.getElementById('partsMenu');
document.getElementById('shapesMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); partsMenu.classList.add('hidden'); shapesMenu.classList.toggle('hidden'); });
document.getElementById('partsMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); shapesMenu.classList.add('hidden'); partsMenu.classList.toggle('hidden'); });
document.addEventListener('click', () => { shapesMenu.classList.add('hidden'); partsMenu.classList.add('hidden'); });

[
  ['modeFreehandBtn', 'freehand'], ['modePolyBtn', 'poly'], ['modeEditBtn', 'edit'],
  ['shapeRectBtn', 'rect'], ['shapeCircleBtn', 'circle'], ['shapeHexBtn', 'hex'],
  ['modeHoleBtn', 'hole'], ['modeStandoffBtn', 'standoff'], ['modeCutoutBtn', 'cutout']
].forEach(([id, m]) => document.getElementById(id).addEventListener('click', () => setMode(m)));

document.getElementById('gridArrayBtn').addEventListener('click', () => {
  const p = activePart();
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      p.cutouts.push([{ x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 - 7 }, { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 - 7 }, { x: (c - 1) * 18 + 7, y: (r - 0.5) * 18 + 7 }, { x: (c - 1) * 18 - 7, y: (r - 0.5) * 18 + 7 }]);
    }
  }
  sketch2D.draw(); rebuild3DMesh(); showToast('Added 3×2 cutout grid (14×14 mm)');
});

document.getElementById('stackPartBtn').addEventListener('click', () => {
  const cur = activePart();
  if (cur.points.length < 3 || !cur.isClosed) { showToast('Close current part before stacking!'); return; }
  const newBaseZ = (cur.baseZ || 0) + cur.extrudeHeight;
  if (newBaseZ >= MAX_HEIGHT_MM) { showToast('Already at 256 mm A1 ceiling!'); return; }
  state.parts.push(createPart({
    name: `Part ${state.parts.length + 1}`, baseZ: newBaseZ, extrudeHeight: Math.min(8, MAX_HEIGHT_MM - newBaseZ),
    points: cur.points.map(pt => ({ x: Math.round(pt.x * 0.7), y: Math.round(pt.y * 0.7) })),
    isClosed: cur.isClosed, color: '#73E6F1'
  }));
  state.activePartIndex = state.parts.length - 1;
  syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget();
});

document.getElementById('newPartBtn').addEventListener('click', () => {
  state.parts.push(createPart({ name: `Part ${state.parts.length + 1}`, points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }], isClosed: true, color: '#FEFF00' }));
  state.activePartIndex = state.parts.length - 1;
  syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh();
});
document.getElementById('deletePartBtn').addEventListener('click', () => {
  if (state.parts.length <= 1) { showToast('Keep at least 1 part'); return; }
  state.parts.splice(state.activePartIndex, 1); state.activePartIndex = Math.max(0, state.activePartIndex - 1);
  syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh();
});

const baseZInput = document.getElementById('baseZInput');
if (baseZInput) baseZInput.addEventListener('change', (e) => { activePart().baseZ = Math.max(0, Math.min(250, Math.round(Number(e.target.value) || 0))); syncControlsFromActivePart(); rebuild3DMesh(); updateCameraTarget(); });

const snapBtn = document.getElementById('snapToggleBtn');
snapBtn.addEventListener('click', () => {
  snapIdx = (snapIdx + 1) % SNAP_CYCLE.length;
  const cfg = SNAP_CYCLE[snapIdx];
  state.snapEnabled = cfg.enabled; state.snapStep = cfg.step; snapBtn.textContent = cfg.label;
  snapBtn.className = state.snapEnabled ? 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/50' : 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] text-zinc-400 border border-[#2a2a3c]';
});

document.getElementById('undoBtn').addEventListener('click', () => {
  const p = activePart();
  if (state.mode === 'hole' && p.holes.length > 0) p.holes.pop();
  else if (state.mode === 'cutout' && state.activeCutout.length > 0) state.activeCutout.pop();
  else if (state.mode === 'cutout' && p.cutouts.length > 0) p.cutouts.pop();
  else if (p.isClosed) p.isClosed = false;
  else if (p.points.length > 0) p.points.pop();
  sketch2D.draw(); rebuild3DMesh();
});

document.getElementById('closeShapeBtn').addEventListener('click', () => {
  const p = activePart();
  if (state.mode === 'cutout' && state.activeCutout.length >= 3) { p.cutouts.push([...state.activeCutout]); state.activeCutout = []; }
  else if (p.points.length >= 3) { p.isClosed = true; setMode('edit'); }
  sketch2D.draw(); rebuild3DMesh();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  state.parts = [createPart({ name: 'Part 1' })];
  state.activePartIndex = 0; state.activeCutout = []; state.freehandStroke = [];
  state.primitiveDrag = null; state.draggingVertex = null; state.inferGuide = null;
  syncControlsFromActivePart(); setMode('poly'); sketch2D.draw(); rebuild3DMesh(); updateCameraTarget();
  showToast('Cleared entire board');
});

extrudeSlider.addEventListener('input', (e) => setExtrudeHeight(e.target.value));
['input', 'change'].forEach(ev => extrudeInput.addEventListener(ev, (e) => setExtrudeHeight(e.target.value)));
roundSlider.addEventListener('input', (e) => { activePart().cornerRadius = Number(e.target.value); roundVal.textContent = e.target.value + 'mm'; sketch2D.draw(); rebuild3DMesh(); });
bevelSlider.addEventListener('input', (e) => { activePart().bevelSize = Number(e.target.value); bevelVal.textContent = e.target.value + 'mm'; rebuild3DMesh(); });
twistSlider.addEventListener('input', (e) => { activePart().twistDeg = Number(e.target.value); twistVal.textContent = e.target.value + '°'; rebuild3DMesh(); });

document.getElementById('typeExtrudeBtn').addEventListener('click', () => { activePart().type = 'extrude'; syncControlsFromActivePart(); rebuild3DMesh(); });
document.getElementById('typeRevolveBtn').addEventListener('click', () => { activePart().type = 'revolve'; syncControlsFromActivePart(); rebuild3DMesh(); });
shellToggleBtn.addEventListener('click', () => { activePart().shellEnabled = !activePart().shellEnabled; syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
shellModeSelect.addEventListener('change', (e) => { activePart().shellMode = e.target.value; syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
shellInput.addEventListener('change', (e) => { activePart().shellThickness = Math.max(0.4, Math.min(15, Number(e.target.value) || 1.2)); shellInput.value = activePart().shellThickness; sketch2D.draw(); rebuild3DMesh(); });
texturePatternSelect.addEventListener('change', (e) => { activePart().texturePattern = e.target.value; syncControlsFromActivePart(); rebuild3DMesh(); });
textureDepthSlider.addEventListener('input', (e) => { activePart().textureDepth = Number(e.target.value); textureDepthVal.textContent = e.target.value + 'mm'; rebuild3DMesh(); });
textureFreqSlider.addEventListener('input', (e) => { activePart().textureFreq = Number(e.target.value); textureFreqVal.textContent = e.target.value + 'w'; rebuild3DMesh(); });

const wireframeBtn = document.getElementById('wireframeBtn');
wireframeBtn.addEventListener('click', () => {
  state.wireframe = !state.wireframe;
  wireframeBtn.className = `brand-btn text-xs font-${state.wireframe ? 'bold bg-[#73E6F1] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-[#73E6F1]'} px-2.5 py-1.5 rounded-lg`;
  rebuild3DMesh();
});

const autoSpinBtn = document.getElementById('autoSpinBtn');
autoSpinBtn.addEventListener('click', () => {
  const isSpin = viewport3D.toggleAutoSpin();
  autoSpinBtn.className = `brand-btn text-xs font-${isSpin ? 'bold bg-[#FEFF00] text-[#020203]' : 'semibold bg-[#14141d] border border-[#2a2a3c] text-zinc-300'} px-2.5 py-1.5 rounded-lg`;
});

[['zoomInBtn', () => viewport3D.zoomIn()], ['zoomOutBtn', () => viewport3D.zoomOut()], ['resetViewBtn', () => viewport3D.resetView()]].forEach(([id, fn]) => document.getElementById(id).addEventListener('click', fn));

document.querySelectorAll('.color-swatch').forEach(btn => {
  btn.addEventListener('click', () => { activePart().color = btn.dataset.color; syncControlsFromActivePart(); sketch2D.draw(); rebuild3DMesh(); });
});

const panel2D = document.getElementById('panel2D'), panel3D = document.getElementById('panel3D');
function setMobileView(v) {
  const btns = { split: document.getElementById('viewSplitBtn'), d2: document.getElementById('view2DBtn'), d3: document.getElementById('view3DBtn') };
  Object.values(btns).forEach(b => b.className = 'text-[11px] font-semibold px-2.5 py-1 rounded-md text-zinc-300');
  if (v === 'split') { btns.split.className = 'text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#FEFF00] text-[#020203]'; panel2D.classList.remove('hidden'); panel3D.classList.remove('hidden'); }
  else if (v === '2d') { btns.d2.className = 'text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#FEFF00] text-[#020203]'; panel2D.classList.remove('hidden'); panel3D.classList.add('hidden'); }
  else { btns.d3.className = 'text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#FEFF00] text-[#020203]'; panel2D.classList.add('hidden'); panel3D.classList.remove('hidden'); }
  setTimeout(() => { sketch2D.resize(); viewport3D.resize(); }, 20);
}
[['viewSplitBtn', 'split'], ['view2DBtn', '2d'], ['view3DBtn', '3d']].forEach(([id, v]) => document.getElementById(id).addEventListener('click', () => setMobileView(v)));

window.addEventListener('resize', () => { sketch2D.resize(); viewport3D.resize(); });
window.onload = () => {
  sketch2D.resize();
  viewport3D.resize();
  loadPreset('card');
  initPart2Controls({ state, sketch2D, viewport3D, rebuild3DMesh, showToast, syncControlsFromActivePart, updateCameraTarget });
  window.sketch3d = { state, viewport3D, rebuild3DMesh, loadPreset };
  viewport3D.animate();
};
