/**
 * SKETCH3D — Stage 3/4/5 Target Scoping, Polymer/AMS, Floor/Vent/Brim & Lighting Presets
 * ======================================================================================
 * Handles ISSUE-010 (Inner/Outer/All target selector), ISSUE-013 (Clear/Polymer decoupling,
 * Stage 5 AMS mapping, Un-nest Concentric Shells), ISSUE-015 (Lighting & Base cutouts + Thermal Guide),
 * and ISSUE-016 (Floor Thickness, Open Bottom, Top Vent Ø, Stage 5 Outer Brim).
 */

import { LIGHTING_PRESETS, generateCircleVertices } from '../config/hardwarePresets.js';
import { initCsg } from '../geometry/csgKernel.js';

export function initStage345Controls(ctx) {
  const { state, sketch2D, rebuild3DMesh, showToast, syncControlsFromActivePart, pushUndo } = ctx;
  const activePart = () => state.parts[state.activePartIndex] || state.parts[0];
  const $ = id => document.getElementById(id);

  state.targetScope = state.targetScope || 'single';
  state.unnestShells = Boolean(state.unnestShells);
  state.brimEnabled = Boolean(state.brimEnabled);
  state.brimWidthMm = state.brimWidthMm ?? 5;
  state.thermalGuide = Boolean(state.thermalGuide);

  function getTargetParts() {
    if (state.targetScope === 'all' && state.parts.length > 1) return state.parts;
    const p = activePart();
    return p ? [p] : [];
  }

  function formatPartShortLabel(pt, idx) {
    if (state.parts.length === 2 && state.parts[1]?.linkedParentId) {
      return idx === 0 ? 'Inner' : 'Outer';
    }
    return pt.name.length > 14 ? pt.name.slice(0, 14) + '…' : pt.name;
  }

  function renderTargetWidget(selectId, pillsId) {
    const sel = $(selectId);
    const pills = $(pillsId);
    if (sel) {
      sel.textContent = '';
      state.parts.forEach((pt, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${idx + 1}. ${pt.name}`;
        sel.appendChild(opt);
      });
      if (state.parts.length > 1) {
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = `All Parts (${state.parts.length})`;
        sel.appendChild(allOpt);
      }
      sel.value = (state.targetScope === 'all' && state.parts.length > 1) ? 'all' : String(state.activePartIndex);
    }
    if (pills) {
      pills.textContent = '';
      const entries = state.parts.map((pt, idx) => ({ val: String(idx), label: formatPartShortLabel(pt, idx) }));
      if (state.parts.length > 1) entries.push({ val: 'all', label: 'All' });
      const cur = (state.targetScope === 'all' && state.parts.length > 1) ? 'all' : String(state.activePartIndex);
      entries.forEach(({ val, label }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.targetVal = val;
        const on = val === cur;
        b.className = on
          ? 'text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FEFF00] text-[#020203]'
          : 'text-[10px] font-semibold px-2 py-0.5 rounded-md text-zinc-300 hover:text-white';
        b.textContent = label;
        b.addEventListener('click', () => applyTargetSelection(val));
        pills.appendChild(b);
      });
    }
  }

  function applyTargetSelection(val) {
    if (val === 'all' && state.parts.length > 1) {
      state.targetScope = 'all';
      syncStage345UI();
    } else {
      state.targetScope = 'single';
      const idx = Math.max(0, Math.min(state.parts.length - 1, Number(val) || 0));
      state.activePartIndex = idx;
      syncControlsFromActivePart();
      sketch2D.draw();
      rebuild3DMesh();
    }
  }

  function renderAmsMapping() {
    const list = $('amsMappingList');
    if (!list) return;
    list.textContent = '';
    state.parts.forEach((pt, idx) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 text-[11px] bg-[#14141d] border border-[#2a2a3c] rounded-lg px-2 py-1';
      const lbl = document.createElement('span');
      lbl.className = 'truncate text-zinc-200 font-medium';
      const fin = pt.materialTag === 'clear' ? 'Clear' : 'Opaque';
      lbl.textContent = `${pt.name} (${fin} ${pt.polymer || 'PLA'})`;
      const sel = document.createElement('select');
      sel.dataset.amsPartIndex = String(idx);
      sel.className = 'bg-[#0b0b10] border border-[#2a2a3c] rounded px-1.5 py-0.5 text-[10px] font-mono text-[#73E6F1] outline-none';
      for (let s = 1; s <= 4; s++) {
        const o = document.createElement('option');
        o.value = String(s);
        o.textContent = `AMS ${s}`;
        sel.appendChild(o);
      }
      sel.value = String(Math.max(1, Math.min(4, Number(pt.amsSlot ?? (idx + 1)))));
      sel.addEventListener('change', (e) => {
        pt.amsSlot = Math.max(1, Math.min(4, Number(e.target.value) || 1));
        showToast(`${pt.name} mapped to AMS Slot ${pt.amsSlot}`);
      });
      row.append(lbl, sel);
      list.appendChild(row);
    });
  }

  function syncStage345UI() {
    renderTargetWidget('stage3TargetSelect', 'stage3TargetPills');
    renderTargetWidget('stage4TargetSelect', 'stage4TargetPills');
    renderAmsMapping();
    const p = activePart();
    if (!p) return;

    const polySel = $('partPolymerSelect');
    if (polySel) polySel.value = p.polymer || 'PLA';

    const floorIn = $('floorThicknessInput');
    if (floorIn) floorIn.value = p.floorThickness > 0 ? String(p.floorThickness) : '';

    const openBtn = $('openBottomBtn');
    const isOpen = Boolean(p.openBottom ?? (p.intent === 'lampshade'));
    if (openBtn) {
      openBtn.textContent = isOpen ? 'Open Bottom: On' : 'Open Bottom: Off';
      openBtn.className = isOpen
        ? 'brand-btn text-[11px] font-bold px-2 py-1 rounded-lg bg-[#73E6F1] text-[#020203]'
        : 'brand-btn text-[11px] font-semibold px-2 py-1 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-300';
    }

    const ventIn = $('topVentInput');
    if (ventIn) ventIn.value = String(p.topVentMm || 0);

    const unnestBtn = $('unnestShellsBtn');
    if (unnestBtn) {
      unnestBtn.textContent = state.unnestShells ? '◫ Un-nest Concentric Shells: On' : '◫ Un-nest Concentric Shells: Off';
      unnestBtn.className = state.unnestShells
        ? 'w-full brand-btn text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#00E56D] text-[#020203]'
        : 'w-full brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-200';
    }

    const brimBtn = $('brimToggleBtn');
    if (brimBtn) {
      brimBtn.textContent = state.brimEnabled ? 'Outer Brim: On' : 'Outer Brim: Off';
      brimBtn.className = state.brimEnabled
        ? 'brand-btn text-xs font-bold px-2.5 py-1 rounded-lg bg-[#FEFF00] text-[#020203]'
        : 'brand-btn text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-zinc-300';
    }
    const brimW = $('brimWidthInput');
    if (brimW) brimW.value = String(state.brimWidthMm ?? 5);

    const thBtn = $('thermalGuideBtn');
    if (thBtn) {
      thBtn.className = state.thermalGuide
        ? 'text-[11px] font-bold px-2 py-1.5 rounded-lg bg-[#FEFF00] text-[#020203] text-left col-span-2'
        : 'text-[11px] font-medium px-2 py-1.5 rounded-lg bg-[#14141d] border border-[#FEFF00]/40 text-[#FEFF00] text-left col-span-2';
    }
  }

  $('stage3TargetSelect')?.addEventListener('change', e => applyTargetSelection(e.target.value));
  $('stage4TargetSelect')?.addEventListener('change', e => applyTargetSelection(e.target.value));

  $('partPolymerSelect')?.addEventListener('change', (e) => {
    const val = e.target.value;
    getTargetParts().forEach(pt => { pt.polymer = val; pt.polymerManual = true; });
    syncControlsFromActivePart();
    rebuild3DMesh();
    showToast(`Polymer: ${activePart().materialTag === 'clear' ? 'Clear' : 'Opaque'} ${val}`);
  });

  const onFloorChange = (e) => {
    const raw = String(e.target.value).trim();
    const val = raw === '' ? null : Math.max(0.4, Math.min(25, Number(raw) || 1.2));
    getTargetParts().forEach(pt => { pt.floorThickness = val; });
    rebuild3DMesh();
  };
  $('floorThicknessInput')?.addEventListener('input', onFloorChange);
  $('floorThicknessInput')?.addEventListener('change', onFloorChange);

  $('openBottomBtn')?.addEventListener('click', () => {
    const next = !Boolean(activePart().openBottom ?? (activePart().intent === 'lampshade'));
    getTargetParts().forEach(pt => { pt.openBottom = next; });
    syncControlsFromActivePart();
    rebuild3DMesh();
  });

  const onVentChange = (e) => {
    const val = Math.max(0, Math.min(120, Number(e.target.value) || 0));
    getTargetParts().forEach(pt => { pt.topVentMm = val; });
    rebuild3DMesh();
  };
  $('topVentInput')?.addEventListener('input', onVentChange);
  $('topVentInput')?.addEventListener('change', onVentChange);

  const lightingButtons = [
    ['presetTealightBtn', 'TEALIGHT_42'],
    ['presetBambuKitBtn', 'BAMBU_KIT_001'],
    ['presetE14Btn', 'E14_COLLAR_29']
  ];
  lightingButtons.forEach(([id, key]) => {
    $(id)?.addEventListener('click', () => {
      const spec = LIGHTING_PRESETS[key];
      if (!spec) return;
      pushUndo?.();
      getTargetParts().forEach(pt => {
        if (pt.type === 'revolve') {
          pt.baseMountDiameterMm = spec.diameterMm;
          pt.openBottom = true;
        } else {
          pt.cutouts = pt.cutouts || [];
          pt.cutouts.push(generateCircleVertices(0, 0, spec.diameterMm, 32));
        }
      });
      syncControlsFromActivePart();
      sketch2D.draw();
      rebuild3DMesh();
      showToast(`Added ${spec.label}`);
    });
  });

  $('presetCordSlotBtn')?.addEventListener('click', async () => {
    pushUndo?.();
    const spec = LIGHTING_PRESETS.CORD_SLOT_6X6;
    await initCsg().catch(() => null);
    getTargetParts().forEach(pt => {
      pt.cordSlot = { width: spec.widthMm, height: spec.heightMm };
    });
    sketch2D.draw();
    rebuild3DMesh();
    showToast(`Added ${spec.label}`);
  });

  $('thermalGuideBtn')?.addEventListener('click', () => {
    state.thermalGuide = !state.thermalGuide;
    syncStage345UI();
    rebuild3DMesh();
    showToast(state.thermalGuide ? 'PLA Thermal Guide active (LED-only +10mm radial clearance)' : 'Thermal Guide hidden');
  });

  $('unnestShellsBtn')?.addEventListener('click', () => {
    state.unnestShells = !state.unnestShells;
    syncStage345UI();
    rebuild3DMesh();
    showToast(state.unnestShells ? 'Concentric shells un-nested for side-by-side .3MF' : 'Concentric shells nested');
  });

  $('brimToggleBtn')?.addEventListener('click', () => {
    state.brimEnabled = !state.brimEnabled;
    syncStage345UI();
    rebuild3DMesh();
  });
  $('brimWidthInput')?.addEventListener('change', (e) => {
    state.brimWidthMm = Math.max(2, Math.min(20, Number(e.target.value) || 5));
    if (!state.brimEnabled) state.brimEnabled = true;
    syncStage345UI();
    rebuild3DMesh();
  });

  function syncThermalGuideMesh(partsGroup) {
    if (!state.thermalGuide || !globalThis.THREE) return;
    const spec = LIGHTING_PRESETS.THERMAL_GUIDE_PLA;
    const r = spec.guideDiameterMm * 0.5;
    const h = spec.guideHeightMm;
    const g = new THREE.CylinderGeometry(r, r, h, 32, 1, true);
    g.translate(0, h * 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFEFF00, wireframe: true, transparent: true, opacity: 0.35 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData.isThermalGuide = true;
    partsGroup.add(mesh);
  }

  return { getTargetParts, syncStage345UI, syncThermalGuideMesh };
}
