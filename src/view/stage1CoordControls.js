/**
 * SKETCH3D — Stage 1 Numeric Vertex Coordinate Inputs & Full Undo Stack (ISSUE-014)
 * ==================================================================================
 * Provides live (R, Z) / (X, Y) numeric coordinate readouts and click-to-type inputs,
 * concentric circle diameter helpers, and deep snapshot Undo restoration.
 */

import { syncBezierToPoints } from '../geometry/bezier2d.js';
import { generateCircleVertices } from '../config/hardwarePresets.js';
import { applyPrimitiveLoop } from '../canvas/multiLoopHelper.js';

const MAX_UNDO_DEPTH = 40;

export function initStage1CoordControls(ctx) {
  const { state, sketch2D, rebuild3DMesh, showToast, syncControlsFromActivePart, updateCameraTarget } = ctx;
  const activePart = () => state.parts[state.activePartIndex] || state.parts[0];
  state.undoStack = state.undoStack || [];
  state.selectedVertexIndex = state.selectedVertexIndex ?? 0;
  state.multiLoopEnabled = state.multiLoopEnabled ?? true;

  const $ = id => document.getElementById(id);
  const coordXLabel = $('coordXLabel');
  const coordYLabel = $('coordYLabel');
  const coordXInput = $('coordXInput');
  const coordYInput = $('coordYInput');
  const vertexIdxBadge = $('vertexIdxBadge');
  const multiLoopBtn = $('multiLoopToggleBtn');
  const circleDiaInput = $('primitiveDiaInput');
  const addCircleDiaBtn = $('addCircleDiaBtn');

  function pushUndoSnapshot() {
    const snap = JSON.stringify({
      parts: state.parts,
      activePartIndex: state.activePartIndex,
      activeCutout: state.activeCutout,
      selectedVertexIndex: state.selectedVertexIndex,
      mode: state.mode
    });
    const last = state.undoStack[state.undoStack.length - 1];
    if (last === snap) return;
    state.undoStack.push(snap);
    if (state.undoStack.length > MAX_UNDO_DEPTH) state.undoStack.shift();
  }

  function restoreUndoSnapshot() {
    if (state.undoStack && state.undoStack.length > 0) {
      const snap = JSON.parse(state.undoStack.pop());
      state.parts = snap.parts;
      state.activePartIndex = Math.max(0, Math.min(state.parts.length - 1, snap.activePartIndex || 0));
      state.activeCutout = snap.activeCutout || [];
      state.selectedVertexIndex = snap.selectedVertexIndex ?? 0;
      syncControlsFromActivePart();
      sketch2D.draw();
      rebuild3DMesh();
      updateCameraTarget?.();
      showToast('Undid last edit');
      return true;
    }
    return false;
  }

  function getActiveVertices(p) {
    if (p.profileType === 'bezier' && p.bezierNodes?.length > 0) return p.bezierNodes;
    return p.points || [];
  }

  function syncVertexCoordInputs() {
    const p = activePart();
    if (!p) return;
    const isRev = p.type === 'revolve' || Boolean(state.revolveGuide);
    if (coordXLabel) coordXLabel.textContent = isRev ? 'R' : 'X';
    if (coordYLabel) coordYLabel.textContent = isRev ? 'Z' : 'Y';
    const verts = getActiveVertices(p);
    const loopCount = (p.points?.length >= 3 ? 1 : 0) + (p.cutouts?.length || 0);
    if (verts.length === 0) {
      state.selectedVertexIndex = 0;
      if (vertexIdxBadge) vertexIdxBadge.textContent = `Pt 0/0 · ${loopCount}L`;
      if (coordXInput) coordXInput.value = '';
      if (coordYInput) coordYInput.value = '';
      return;
    }
    state.selectedVertexIndex = Math.max(0, Math.min(verts.length - 1, state.selectedVertexIndex || 0));
    const pt = verts[state.selectedVertexIndex];
    if (vertexIdxBadge) vertexIdxBadge.textContent = `Pt ${state.selectedVertexIndex + 1}/${verts.length} · ${loopCount}L`;
    if (coordXInput) coordXInput.value = String(Number(pt.x.toFixed(2)));
    if (coordYInput) coordYInput.value = String(Number((isRev ? -pt.y : pt.y).toFixed(2)));
    if (multiLoopBtn) {
      multiLoopBtn.textContent = state.multiLoopEnabled ? 'Loops: Concentric' : 'Loops: Replace';
    }
  }

  function commitVertexCoords() {
    const p = activePart();
    const verts = getActiveVertices(p);
    if (!p || verts.length === 0) return;
    const isRev = p.type === 'revolve' || Boolean(state.revolveGuide);
    const rawA = Number(coordXInput?.value);
    const rawB = Number(coordYInput?.value);
    if (!Number.isFinite(rawA) || !Number.isFinite(rawB)) return;

    pushUndoSnapshot();
    const idx = Math.max(0, Math.min(verts.length - 1, state.selectedVertexIndex || 0));
    const newX = isRev ? Math.max(0, Math.min(128, rawA)) : Math.max(-128, Math.min(128, rawA));
    const newY = isRev ? Math.max(-128, Math.min(128, -rawB)) : Math.max(-128, Math.min(128, rawB));
    const old = verts[idx];
    const dx = newX - old.x, dy = newY - old.y;
    old.x = Number(newX.toFixed(3));
    old.y = Number(newY.toFixed(3));
    if (p.profileType === 'bezier' && p.bezierNodes?.[idx]) {
      if (old.cpIn) { old.cpIn.x += dx; old.cpIn.y += dy; }
      if (old.cpOut) { old.cpOut.x += dx; old.cpOut.y += dy; }
      syncBezierToPoints(p, 0.5);
    }
    syncVertexCoordInputs();
    sketch2D.draw();
    rebuild3DMesh();
  }

  $('prevVertexBtn')?.addEventListener('click', () => {
    const verts = getActiveVertices(activePart());
    if (verts.length === 0) return;
    state.selectedVertexIndex = ((state.selectedVertexIndex || 0) - 1 + verts.length) % verts.length;
    syncVertexCoordInputs();
    sketch2D.draw();
  });
  $('nextVertexBtn')?.addEventListener('click', () => {
    const verts = getActiveVertices(activePart());
    if (verts.length === 0) return;
    state.selectedVertexIndex = ((state.selectedVertexIndex || 0) + 1) % verts.length;
    syncVertexCoordInputs();
    sketch2D.draw();
  });
  coordXInput?.addEventListener('change', commitVertexCoords);
  coordYInput?.addEventListener('change', commitVertexCoords);
  [coordXInput, coordYInput].forEach(el => el?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commitVertexCoords(); el.blur(); }
  }));

  multiLoopBtn?.addEventListener('click', () => {
    state.multiLoopEnabled = !state.multiLoopEnabled;
    syncVertexCoordInputs();
    showToast(state.multiLoopEnabled ? 'Concentric multi-loop sketching enabled' : 'Primitive replace mode enabled');
  });

  addCircleDiaBtn?.addEventListener('click', () => {
    const dia = Math.max(4, Math.min(250, Number(circleDiaInput?.value) || 100));
    const p = activePart();
    pushUndoSnapshot();
    const circlePts = generateCircleVertices(0, 0, dia, 32);
    const outcome = applyPrimitiveLoop(p, circlePts, state.multiLoopEnabled !== false);
    state.selectedVertexIndex = 0;
    syncControlsFromActivePart();
    sketch2D.draw();
    rebuild3DMesh();
    showToast(outcome === 'replaced' ? `Set Ø${dia}mm circle` : `Added concentric Ø${dia}mm loop`);
  });

  return { pushUndoSnapshot, restoreUndoSnapshot, syncVertexCoordInputs };
}
