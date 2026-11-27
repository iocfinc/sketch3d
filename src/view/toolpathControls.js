/**
 * SKETCH3D — Band Subdivision, Linked Clone & Prosumer Toolpath UI Controller
 * ===========================================================================
 * Connects Offset Shell Clone, Vertical Band Subdivision, Prosumer Toolpath Mode
 * acknowledgment modal, Donor G-code wrap, 3D bead preview, and Safety Firewall export.
 */

import { createLinkedOffsetClone } from '../geometry/offsetClone.js';
import { compilePartToolpath } from '../geometry/toolpathKernel.js';
import {
  compileAndValidateGCode,
  buildGCode3MFBuffer,
  saveDonorGCode,
  loadDonorGCode,
  triggerDownload
} from '../export/gcodeExporter.js';
import { buildToolpathPreviewGroup } from './toolpathPreview.js';

const PROSUMER_ACK_KEY = 'sketch3d_prosumer_ack_v1';

export function initToolpathControls(ctx) {
  const {
    state,
    sketch2D,
    viewport3D,
    rebuild3DMesh,
    showToast,
    syncControlsFromActivePart,
    updateCameraTarget
  } = ctx;

  const activePart = () => state.parts[state.activePartIndex] || state.parts[0];
  let previewGroup = null;
  let prosumerUnlocked = false;
  try {
    prosumerUnlocked = typeof localStorage !== 'undefined' && localStorage.getItem(PROSUMER_ACK_KEY) === '1';
  } catch (_) {}

  // 1. Offset Shell Clone (+2..20mm, default 10mm)
  const offsetCloneBtn = document.getElementById('offsetCloneBtn');
  const offsetCloneInput = document.getElementById('offsetCloneInput');
  if (offsetCloneBtn) {
    offsetCloneBtn.addEventListener('click', () => {
      const parent = activePart();
      if (!parent || parent.points.length < 2) {
        showToast('Draw a profile first before cloning!');
        return;
      }
      const delta = Math.max(2, Math.min(20, Number(offsetCloneInput?.value) || 10));
      const clone = createLinkedOffsetClone(parent, delta);
      state.parts.push(clone);
      state.activePartIndex = state.parts.length - 1;
      document.getElementById('partsMenu')?.classList.add('hidden');
      syncControlsFromActivePart();
      sketch2D.draw();
      rebuild3DMesh();
      updateCameraTarget();
      showToast(`Created linked +${delta}mm concentric shell`);
    });
  }

  // 2. Bands & Toolpath Drawer Toggle
  const drawerBtn = document.getElementById('toolpathDrawerBtn');
  const drawer = document.getElementById('toolpathDrawer');
  const drawerClose = document.getElementById('toolpathDrawerClose');
  if (drawerBtn && drawer) {
    drawerBtn.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
      syncBandControls();
    });
  }
  if (drawerClose && drawer) {
    drawerClose.addEventListener('click', () => drawer.classList.add('hidden'));
  }

  // 3. Vertical Band Subdivision & Composable Texture Controls
  const bandEnabledBtn = document.getElementById('bandEnabledBtn');
  const bandCountInput = document.getElementById('bandCountInput');
  const bandModeSelect = document.getElementById('bandModeSelect');
  const bandFreqInput = document.getElementById('bandFreqInput');
  const bandPhaseSelect = document.getElementById('bandPhaseSelect');
  const bandDepthInput = document.getElementById('bandDepthInput');

  function syncBandControls() {
    const p = activePart();
    if (!p) return;
    if (bandEnabledBtn) {
      bandEnabledBtn.textContent = p.bandEnabled ? 'Bands: On' : 'Bands: Off';
      bandEnabledBtn.className = p.bandEnabled
        ? 'text-xs font-bold px-2.5 py-1 rounded-lg bg-[#FEFF00] text-[#020203]'
        : 'text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-300';
    }
    if (bandCountInput) bandCountInput.value = p.bandCount ?? 8;
    if (bandModeSelect) bandModeSelect.value = p.bandMode || 'weave';
    if (bandFreqInput) bandFreqInput.value = p.bandFreq ?? 10;
    if (bandPhaseSelect) bandPhaseSelect.value = String(p.bandPhaseDeg ?? 90);
    if (bandDepthInput) bandDepthInput.value = p.bandDepth ?? 1.0;
  }

  if (bandEnabledBtn) {
    bandEnabledBtn.addEventListener('click', () => {
      const p = activePart();
      p.bandEnabled = !p.bandEnabled;
      syncBandControls();
      rebuild3DMesh();
    });
  }
  if (bandCountInput) {
    bandCountInput.addEventListener('change', (e) => {
      activePart().bandCount = Math.max(2, Math.min(24, Math.round(Number(e.target.value) || 8)));
      rebuild3DMesh();
    });
  }
  if (bandModeSelect) {
    bandModeSelect.addEventListener('change', (e) => {
      activePart().bandMode = e.target.value;
      rebuild3DMesh();
    });
  }
  if (bandFreqInput) {
    bandFreqInput.addEventListener('change', (e) => {
      activePart().bandFreq = Math.max(4, Math.min(32, Math.round(Number(e.target.value) || 10)));
      rebuild3DMesh();
    });
  }
  if (bandPhaseSelect) {
    bandPhaseSelect.addEventListener('change', (e) => {
      activePart().bandPhaseDeg = Number(e.target.value) || 90;
      rebuild3DMesh();
    });
  }
  if (bandDepthInput) {
    bandDepthInput.addEventListener('change', (e) => {
      activePart().bandDepth = Math.max(0.1, Math.min(3.0, Number(e.target.value) || 1.0));
      rebuild3DMesh();
    });
  }

  // 4. Prosumer Toolpath Mode & One-Time Acknowledgment Modal
  const prosumerToggle = document.getElementById('prosumerToolpathBtn');
  const prosumerPanel = document.getElementById('prosumerToolpathPanel');
  const ackModal = document.getElementById('prosumerAckModal');
  const ackBtn = document.getElementById('prosumerAckBtn');
  const cancelBtn = document.getElementById('prosumerCancelBtn');
  const statusText = document.getElementById('toolpathStatusText');

  function setProsumerVisible(visible) {
    if (prosumerPanel) prosumerPanel.classList.toggle('hidden', !visible);
    if (prosumerToggle) {
      prosumerToggle.textContent = visible ? 'Prosumer Toolpath: Unlocked' : 'Unlock Prosumer Toolpath';
    }
  }
  setProsumerVisible(prosumerUnlocked);

  if (prosumerToggle) {
    prosumerToggle.addEventListener('click', () => {
      if (prosumerUnlocked) {
        prosumerPanel?.classList.toggle('hidden');
      } else {
        ackModal?.classList.remove('hidden');
      }
    });
  }
  if (ackBtn) {
    ackBtn.addEventListener('click', () => {
      prosumerUnlocked = true;
      try { localStorage.setItem(PROSUMER_ACK_KEY, '1'); } catch (_) {}
      ackModal?.classList.add('hidden');
      setProsumerVisible(true);
      showToast('Prosumer Toolpath Mode enabled');
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => ackModal?.classList.add('hidden'));
  }

  function getToolpathOptions() {
    const nozzle = Number(document.getElementById('toolpathNozzleSelect')?.value) || 0.4;
    const primitive = document.getElementById('toolpathPrimitiveSelect')?.value || 'standard';
    const scale50 = !!document.getElementById('toolpathScale50Chk')?.checked;
    const useDonor = !!document.getElementById('toolpathUseDonorChk')?.checked;
    return {
      nozzleDiameter: nozzle,
      primitive,
      scaleFactor: scale50 ? 0.5 : 1.0,
      useDonor
    };
  }

  // 5. Donor G-Code Wrap File Input
  const donorInput = document.getElementById('donorGcodeInput');
  if (donorInput) {
    donorInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ok = saveDonorGCode(text);
      if (statusText) {
        statusText.textContent = ok
          ? `Donor header/footer cached from ${file.name}`
          : `Could not parse Start/End G-code in ${file.name}`;
      }
      showToast(ok ? 'Bambu Studio donor wrap saved!' : 'Invalid donor .gcode');
    });
  }

  // 6. 3D Toolpath Bead Preview Toggle
  const previewBtn = document.getElementById('toolpathPreviewBtn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (previewGroup) {
        viewport3D.scene.remove(previewGroup);
        previewGroup = null;
        previewBtn.textContent = 'Preview Beads';
        return;
      }
      try {
        const { waypoints, stats } = compilePartToolpath(activePart(), getToolpathOptions());
        previewGroup = buildToolpathPreviewGroup(waypoints);
        viewport3D.scene.add(previewGroup);
        previewBtn.textContent = 'Hide Beads';
        if (statusText) {
          statusText.textContent = `Preview: ${stats.layerCount}L · ${stats.estimatedGrams}g · MaxFlow ${stats.maxFlowMm3S} mm³/s`;
        }
      } catch (err) {
        showToast(err.message || 'Toolpath preview failed');
      }
    });
  }

  // 7. Export .gcode & .gcode.3mf Gated by 5-Layer Safety Firewall
  async function handleGCodeExport(as3mf) {
    try {
      const opts = getToolpathOptions();
      const res = await compileAndValidateGCode(activePart(), opts);
      if (!res.safety.passed) {
        const first = res.safety.errors[0];
        const msg = `SAFETY BLOCKED (L${first.layer} line ${first.line}): ${first.message}`;
        if (statusText) statusText.textContent = msg;
        showToast(msg);
        return;
      }
      const suffix = opts.scaleFactor === 0.5 ? '_50pct' : '';
      if (as3mf) {
        const meshes = viewport3D.partsGroup.children.filter(c => c.isMesh);
        const fname = `sketch3d_a1${suffix}.gcode.3mf`;
        const buf = buildGCode3MFBuffer(res.gcode, res.bodySha, state.parts, meshes, state.slicerProfile);
        triggerDownload(buf, fname, 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
        showToast(`Exported ${fname} (${res.stats.layerCount} layers)`);
      } else {
        const fname = `sketch3d_a1${suffix}.gcode`;
        triggerDownload(res.gcode, fname, 'text/plain');
        showToast(`Exported ${fname} (${res.stats.layerCount} layers)`);
      }
      if (statusText) {
        statusText.textContent = `PASS 5/5 Safety · ${res.stats.layerCount}L · Flow ${res.stats.maxFlowMm3S}mm³/s · Bridge ${res.stats.maxBridgeSpanMm}mm`;
      }
    } catch (err) {
      showToast(err.message || 'G-Code export failed');
    }
  }

  document.getElementById('exportGcodeBtn')?.addEventListener('click', () => handleGCodeExport(false));
  document.getElementById('exportGcode3mfBtn')?.addEventListener('click', () => handleGCodeExport(true));

  if (statusText && loadDonorGCode()) {
    statusText.textContent = 'Donor A1 header/footer cached in localStorage.';
  }
}
