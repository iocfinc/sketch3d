/**
 * SKETCH3D — Part 2 Interactive UI Controls
 * ===========================================
 * Connects plane selection, hardware pockets, split-body lip/groove,
 * build-plate auto-arrange, and math expression dimension parsing.
 */

import { evaluateMathExpression } from '../utils/mathParser.js';
import { HARDWARE_PRESETS, generateHexagonVertices } from '../config/hardwarePresets.js';
import { DATUM_PLANES } from '../canvas/planeSelector.js';
import { splitBodyWithLip, checkJointInterference } from '../geometry/splitBody.js';
import { autoArrangeParts } from '../geometry/plateArranger.js';
import { getPrinterProfile } from '../export/printerProfile.js';
import { initCsg, CsgScope, createExtrudedSolid, manifoldToThreeGeometry } from '../geometry/csgKernel.js';

/**
 * Initialize Part 2 UI controls and event listeners
 * @param {Object} ctx Application context
 */
export function initPart2Controls(ctx) {
  const {
    state,
    sketch2D,
    viewport3D,
    rebuild3DMesh,
    showToast,
    syncControlsFromActivePart,
    updateCameraTarget,
  } = ctx;

  const activePart = () => state.parts[state.activePartIndex] || state.parts[0];

  // 1. Math Parser Integration for Dimension Inputs
  function bindMathInput(elementId, setter) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const commitValue = (live) => {
      if (el.disabled) return;
      const rawText = String(el.value).trim();
      if (!rawText) return;
      try {
        const num = evaluateMathExpression(rawText);
        if (Number.isFinite(num)) {
          setter(num, { live });
          return;
        }
      } catch (_) {}
      if (!live) {
        showToast('Invalid math expression');
        syncControlsFromActivePart();
      }
    };

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitValue(false);
        el.blur();
      }
    });

    el.addEventListener('input', () => commitValue(true));
    el.addEventListener('change', () => commitValue(false));
    el.addEventListener('blur', () => commitValue(false));
  }

  // Bind Height Z and Base Z to math parser
  bindMathInput('extrudeInput', (val, opts = {}) => {
    const p = activePart();
    const maxH = Math.max(1, 256 - (p.baseZ || 0));
    const clamped = Math.max(1, Math.min(maxH, Math.round(val * 10) / 10));
    if (p.type === 'revolve' && typeof ctx.scaleRevolveHeightMm === 'function') {
      ctx.scaleRevolveHeightMm(p, clamped);
    } else {
      p.extrudeHeight = clamped;
    }
    const slider = document.getElementById('extrudeSlider');
    if (slider) slider.value = clamped;
    const input = document.getElementById('extrudeInput');
    if (input && !opts.live) input.value = clamped;
    rebuild3DMesh();
    updateCameraTarget();
  });

  bindMathInput('baseZInput', (val, opts = {}) => {
    const p = activePart();
    p.baseZ = Math.max(0, Math.min(250, Math.round(val * 10) / 10));
    if (!opts.live) syncControlsFromActivePart();
    rebuild3DMesh();
    updateCameraTarget();
  });

  // 2. Datum Plane Selector
  const planeSelect = document.getElementById('planeSelect');
  if (planeSelect) {
    planeSelect.addEventListener('change', (e) => {
      const planeKey = e.target.value;
      const p = activePart();
      p.sketchPlane = planeKey;
      showToast(`Sketch Plane: ${DATUM_PLANES[planeKey]?.label || planeKey}`);
      sketch2D.draw();
      rebuild3DMesh();
    });
  }

  // 3. Hardware Pocket Preset Triggers (Hex Nut Traps & Countersinks)
  const hardwareModes = [
    { id: 'modeNutM3Btn', preset: 'HEX_NUT_M3', label: 'M3 Hex Nut Trap (5.7mm)' },
    { id: 'modeNutM4Btn', preset: 'HEX_NUT_M4', label: 'M4 Hex Nut Trap (7.2mm)' },
    { id: 'modeCskM3Btn', preset: 'CSK_WOOD_M3', label: 'M3 Countersink (6.0mm OD)' },
    { id: 'modeCskM4Btn', preset: 'CSK_WOOD_M4', label: 'M4 Countersink (8.0mm OD)' },
  ];

  hardwareModes.forEach(({ id, preset, label }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const targets = (state.targetScope === 'all' && state.parts.length > 1) ? state.parts : [activePart()];
      const spec = HARDWARE_PRESETS[preset];
      if (!spec) return;

      targets.forEach((p) => {
        if (spec.type === 'hex_nut') {
          const hexPts = generateHexagonVertices(0, 0, spec.acrossFlats);
          p.cutouts = p.cutouts || [];
          p.cutouts.push(hexPts);
          p.holes = p.holes || [];
          p.holes.push({ x: 0, y: 0, r: spec.throughBore / 2 });
        } else if (spec.type === 'countersink') {
          p.holes = p.holes || [];
          p.holes.push({ x: 0, y: 0, r: spec.shankDiameter / 2 });
        }
      });
      showToast(`Added ${label}`);

      document.getElementById('shapesMenu')?.classList.add('hidden');
      sketch2D.draw();
      rebuild3DMesh();
    });
  });

  // 4. Split-Body Lip & Groove Tool (ISSUE-012: Lip Tolerance + Snap-Fit + Confirmation)
  const splitBtn = document.getElementById('splitJointBtn');
  const lipTolSlider = document.getElementById('lipToleranceSlider');
  const lipTolVal = document.getElementById('lipToleranceVal');
  const snapFitChk = document.getElementById('snapFitCatchChk');
  const splitConfirmEl = document.getElementById('splitConfirmText');

  if (lipTolSlider && lipTolVal) {
    lipTolSlider.addEventListener('input', () => {
      lipTolVal.textContent = `${Number(lipTolSlider.value).toFixed(2)}mm`;
    });
  }

  if (splitBtn) {
    splitBtn.addEventListener('click', async () => {
      const p = activePart();
      if (!p || p.points.length < 3 || !p.isClosed) {
        showToast('Active part must be a closed shape');
        return;
      }

      const totalH = p.extrudeHeight || 8;
      if (totalH < 6) {
        showToast('Part height must be >= 6mm to split');
        return;
      }

      const splitZ = Math.round(totalH / 2);
      const wallT = Math.max(1.6, p.shellThickness || 2.4);
      const lipToleranceMm = Math.max(0.15, Math.min(0.30, Number(lipTolSlider?.value ?? 0.20)));
      const snapFit = Boolean(snapFitChk?.checked);

      try {
        const csg = await initCsg();
        const scope = new CsgScope();

        const baseSolid = scope.track(createExtrudedSolid(p.points, totalH));
        const splitRes = splitBodyWithLip(baseSolid, splitZ, {
          wallThicknessMm: wallT,
          lipHeightMm: 3.0,
          clearanceMm: lipToleranceMm,
          snapFit
        });

        const inter = checkJointInterference(splitRes.base, splitRes.lid);
        if (!inter.isCollisionFree) {
          splitRes.base.delete();
          splitRes.lid.delete();
          scope.dispose();
          showToast(`Joint interference detected (${inter.interferenceVolumeMm3.toFixed(2)}mm³); increase lip gap`);
          return;
        }

        const basePart = {
          ...p,
          id: 'p_base_' + Date.now().toString(36),
          name: `${p.name} (Base Lip)`,
          extrudeHeight: splitZ + 3.0,
          splitMeta: { role: 'base_lip', lipHeightMm: 3.0, lipToleranceMm, snapFit, wallThicknessMm: wallT, collisionFree: true },
          amsSlot: 1,
          color: '#00E56D'
        };

        const lidPart = {
          ...p,
          id: 'p_lid_' + Date.now().toString(36),
          name: `${p.name} (Lid Groove)`,
          baseZ: (p.baseZ || 0) + splitZ,
          extrudeHeight: totalH - splitZ,
          splitMeta: { role: 'lid_groove', lipHeightMm: 3.0, lipToleranceMm, snapFit, wallThicknessMm: wallT, collisionFree: true },
          amsSlot: 2,
          color: '#73E6F1'
        };

        splitRes.base.delete();
        splitRes.lid.delete();
        scope.dispose();

        state.parts.splice(state.activePartIndex, 1, basePart, lidPart);
        syncControlsFromActivePart();
        sketch2D.draw();
        rebuild3DMesh();
        const msg = `Split into Base & Lid (${state.parts.length} parts · ${lipToleranceMm.toFixed(2)}mm gap${snapFit ? ' · Snap-Fit' : ''})`;
        if (splitConfirmEl) {
          splitConfirmEl.textContent = msg;
          splitConfirmEl.classList.remove('hidden');
        }
        showToast(msg);
      } catch (err) {
        showToast(err.message || 'Split joint failed');
      }
    });
  }

  // 5. Build-Plate Auto-Arrange Engine
  const arrangeBtn = document.getElementById('autoArrangeBtn');
  if (arrangeBtn) {
    arrangeBtn.addEventListener('click', async () => {
      if (state.parts.length === 0) return;
      if (state.parts.some(p => p.type === 'revolve')) {
        state.unnestShells = true;
        syncControlsFromActivePart();
        rebuild3DMesh();
        showToast(`Un-nested ${state.parts.length} revolved parts side-by-side on bed`);
        return;
      }

      try {
        const csg = await initCsg();
        const scope = new CsgScope();

        // Build temporary solids for all closed parts to compute accurate 3D footprints
        const solids = state.parts.map((p) => {
          if (p.points && p.points.length >= 3 && p.isClosed) {
            return scope.track(createExtrudedSolid(p.points, p.extrudeHeight || 8));
          }
          // Fallback box for empty or open shapes
          return scope.track(csg.Manifold.cube([20, 20, p.extrudeHeight || 8], true));
        });

        const printer = getPrinterProfile(state.printerProfile);
        const halfBedX = printer.bedWidthMm / 2;
        const halfBedY = printer.bedDepthMm / 2;
        const result = autoArrangeParts(solids, {
          bedWidth: printer.bedWidthMm,
          bedDepth: printer.bedDepthMm,
          margin: printer.marginMm,
          gap: printer.gapMm,
          centerOnBed: true,
        });

        scope.dispose();

        if (!result.fitsOnPlate) {
          showToast(`⚠️ Warning: Parts exceed ${printer.bedWidthMm}×${printer.bedDepthMm}mm ${printer.shortLabel} plate`);
        } else {
          // Apply computed 2D translation offsets to part sketch points
          result.arranged.forEach(({ partIndex, translation }) => {
            const pt = state.parts[partIndex];
            if (!pt) return;
            const dx = Math.round(translation[0] * 10) / 10;
            const dy = Math.round(translation[1] * 10) / 10;

            pt.points = pt.points.map((p) => ({
              x: Math.max(-halfBedX, Math.min(halfBedX, Math.round((p.x + dx) * 10) / 10)),
              y: Math.max(-halfBedY, Math.min(halfBedY, Math.round((p.y + dy) * 10) / 10)),
            }));

            if (pt.holes) {
              pt.holes.forEach((h) => {
                h.x = Math.max(-halfBedX, Math.min(halfBedX, Math.round((h.x + dx) * 10) / 10));
                h.y = Math.max(-halfBedY, Math.min(halfBedY, Math.round((h.y + dy) * 10) / 10));
              });
            }

            if (pt.cutouts) {
              pt.cutouts.forEach((c) => {
                c.forEach((cp) => {
                  cp.x += dx;
                  cp.y += dy;
                });
              });
            }
          });

          document.getElementById('partsMenu')?.classList.add('hidden');
          sketch2D.draw();
          rebuild3DMesh();
          showToast(`Arranged ${state.parts.length} parts on ${printer.name} bed (≥${printer.gapMm}mm gap)`);
        }
      } catch (err) {
        showToast(err.message || 'Auto-arrange failed');
      }
    });
  }
}
