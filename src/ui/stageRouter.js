/**
 * SKETCH3D — 5-Stage Progressive Router & Contextual Inspector Controller
 * =====================================================================
 * Manages Stage 1..5 navigation, full-screen 2D <-> 3D viewport flipping,
 * collapsible Stage 1 3D mini-preview, Revolve Axis Guide overlay,
 * ordered toggleable modifier cards, and Stage 1..5 DOM hooks.
 */

export const STAGES = [
  { id: 1, key: 'sketch', label: '1. Sketch', viewport: '2d' },
  { id: 2, key: 'form', label: '2. 3D Form', viewport: '3d' },
  { id: 3, key: 'adjust', label: '3. Adjust', viewport: '3d' },
  { id: 4, key: 'texture', label: '4. Texture', viewport: '3d' },
  { id: 5, key: 'print', label: '5. Print', viewport: '3d' }
];

const EXEC_META = {
  none: { badge: 'Base Geometry', note: 'Standard solid mesh export (.3MF / .STL).', cls: 'bg-[#14141d] text-zinc-400 border-[#2a2a3c]' },
  'open-weave': { badge: 'Mesh + Toolpath', note: 'Physical open-aperture lattice · Auto-selects Basket-Weave Arachne .3MF.', cls: 'bg-[#00E56D]/15 text-[#00E56D] border-[#00E56D]/40' },
  'perforated-weave': { badge: 'Mesh + Toolpath', note: 'Physical open-aperture lattice · Auto-selects Basket-Weave Arachne .3MF.', cls: 'bg-[#00E56D]/15 text-[#00E56D] border-[#00E56D]/40' },
  'lfam-rib': { badge: 'Toolpath-Only', note: 'Heavy-gauge bead / toolpath profile · Export via Prosumer .gcode.3mf or LFAM.', cls: 'bg-[#FEFF00]/15 text-[#FEFF00] border-[#FEFF00]/50' }
};

export function initStageRouter({ state, sketch2D, viewport3D, onStageChange } = {}) {
  let activeStage = Math.max(1, Math.min(5, Number(state?.activeStage) || 1));
  let miniPreviewCollapsed = false;
  let mobileViewOverride = null; // null | 'split' | '2d' | '3d'
  const manualCards = new Map();

  const panel2D = document.getElementById('panel2D');
  const panel3D = document.getElementById('panel3D');
  const stageTabs = Array.from(document.querySelectorAll('[data-stage]'));
  const stagePanels = Array.from(document.querySelectorAll('[data-stage-panel]'));
  const revolveOverlay = document.getElementById('revolveAxisOverlay');
  const revolveGuideBtn = document.getElementById('revolveGuideBtn');
  const toggleMiniBtn = document.getElementById('toggleMiniPreviewBtn');
  const cameraPill = document.getElementById('cameraPill');

  function resizeCanvases() {
    setTimeout(() => {
      sketch2D?.resize?.();
      viewport3D?.resize?.();
    }, 24);
  }

  function applyViewportLayout(stage) {
    if (!panel2D || !panel3D) return;
    const isStage1 = stage === 1;
    const showSplit = mobileViewOverride === 'split';
    const force2D = mobileViewOverride === '2d';
    const force3D = mobileViewOverride === '3d';

    if (showSplit) {
      panel2D.classList.remove('hidden');
      panel3D.classList.remove('hidden', 'stage1-mini-preview', 'is-collapsed');
      panel2D.classList.add('lg:w-1/2');
      panel3D.classList.add('lg:w-1/2');
      if (cameraPill) cameraPill.classList.remove('hidden');
      if (toggleMiniBtn) toggleMiniBtn.classList.add('hidden');
    } else if ((isStage1 && !force3D) || force2D) {
      panel2D.classList.remove('hidden', 'lg:w-1/2');
      panel3D.classList.remove('hidden', 'lg:w-1/2');
      panel3D.classList.add('stage1-mini-preview');
      panel3D.classList.toggle('is-collapsed', miniPreviewCollapsed);
      if (cameraPill) cameraPill.classList.add('hidden');
      if (toggleMiniBtn) {
        toggleMiniBtn.classList.remove('hidden');
        toggleMiniBtn.textContent = miniPreviewCollapsed ? '3D Preview ▴' : '3D Preview ▾';
      }
    } else {
      panel2D.classList.add('hidden');
      panel2D.classList.remove('lg:w-1/2');
      panel3D.classList.remove('hidden', 'stage1-mini-preview', 'is-collapsed', 'lg:w-1/2');
      if (cameraPill) cameraPill.classList.remove('hidden');
      if (toggleMiniBtn) toggleMiniBtn.classList.add('hidden');
    }
    resizeCanvases();
  }

  function syncRevolveGuide(part) {
    const active = Boolean(state?.revolveGuide || part?.type === 'revolve');
    if (revolveOverlay) revolveOverlay.classList.toggle('hidden', !active);
    if (revolveGuideBtn) {
      revolveGuideBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      revolveGuideBtn.className = active
        ? 'brand-btn text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#FF66D9] text-[#020203]'
        : 'brand-btn text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#14141d] border border-[#2a2a3c] text-[#FF66D9]';
    }
  }

  function setCardOpen(card, isOpen) {
    const body = card.querySelector('[data-modifier-body]');
    const chevron = card.querySelector('[data-modifier-chevron]');
    const toggle = card.querySelector('[data-modifier-toggle]');
    if (body) body.classList.toggle('hidden', !isOpen);
    if (chevron) chevron.textContent = isOpen ? '▾' : '▸';
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    card.dataset.open = isOpen ? 'true' : 'false';
  }

  function syncModifierCards(part) {
    if (!part) return;
    const activeMap = {
      shell: Boolean(part.shellEnabled),
      round: (part.cornerRadius || 0) > 0,
      bevel: (part.bevelSize ?? 0) > 0,
      twist: (part.twistDeg || 0) > 0,
      fasteners: Boolean((part.holes?.length || 0) + (part.standoffs?.length || 0) + (part.cutouts?.length || 0) > 0),
      split: false,
      color: false,
      bands: Boolean(part.bandEnabled)
    };
    document.querySelectorAll('[data-modifier]').forEach((card) => {
      const key = card.dataset.modifier;
      const open = manualCards.has(key) ? manualCards.get(key) : Boolean(activeMap[key]);
      setCardOpen(card, open);
    });

    const texBadge = document.getElementById('textureExecBadge');
    const texNote = document.getElementById('textureFidelityNote');
    const pat = part.texturePattern || 'none';
    const meta = EXEC_META[pat] || (pat === 'none'
      ? EXEC_META.none
      : { badge: 'Mesh + Toolpath', note: 'Watertight displaced mesh (.3MF / .STL) + helical toolpath.', cls: 'bg-[#00E56D]/15 text-[#00E56D] border-[#00E56D]/40' });
    if (texBadge) {
      texBadge.textContent = meta.badge;
      texBadge.className = `text-[10px] font-bold px-2 py-0.5 rounded-md border ${meta.cls}`;
    }
    if (texNote) texNote.textContent = meta.note;
    document.getElementById('loftControlsWrap')?.classList.toggle('hidden', part.type !== 'loft');
    document.getElementById('openWeaveControlsWrap')?.classList.toggle('hidden', pat !== 'open-weave' && pat !== 'perforated-weave');
  }

  function syncStageUI() {
    document.body.dataset.activeStage = String(activeStage);
    stageTabs.forEach((tab) => {
      const s = Number(tab.dataset.stage);
      const isCur = s === activeStage;
      tab.setAttribute('aria-selected', isCur ? 'true' : 'false');
      tab.className = isCur
        ? 'stage-tab text-[10px] sm:text-xs font-extrabold px-2 sm:px-2.5 py-1 rounded-lg bg-[#FEFF00] text-[#020203] transition-colors whitespace-nowrap'
        : 'stage-tab text-[10px] sm:text-xs font-semibold px-2 sm:px-2.5 py-1 rounded-lg text-zinc-300 hover:text-white hover:bg-[#14141d] transition-colors whitespace-nowrap';
    });
    stagePanels.forEach((panel) => {
      const s = Number(panel.dataset.stagePanel);
      panel.classList.toggle('hidden', s !== activeStage);
    });
    applyViewportLayout(activeStage);
    const curPart = state?.parts?.[state?.activePartIndex] || state?.parts?.[0];
    syncRevolveGuide(curPart);
    syncModifierCards(curPart);
  }

  function setStage(nextStage) {
    const target = Math.max(1, Math.min(5, Number(nextStage) || 1));
    const prevStage = activeStage;
    activeStage = target;
    mobileViewOverride = null;
    if (state) state.activeStage = target;
    syncStageUI();
    const meta = STAGES.find((s) => s.id === target) || STAGES[0];
    if (typeof onStageChange === 'function') {
      onStageChange({ stage: target, prevStage, viewportMode: meta.viewport });
    }
    window.dispatchEvent(new CustomEvent('sketch3d:stagechange', {
      detail: { stage: target, prevStage, viewportMode: meta.viewport }
    }));
    return activeStage;
  }

  function toggleMiniPreview(forceCollapsed) {
    miniPreviewCollapsed = typeof forceCollapsed === 'boolean' ? forceCollapsed : !miniPreviewCollapsed;
    applyViewportLayout(activeStage);
    return !miniPreviewCollapsed;
  }

  function setMobileView(mode) {
    if (mode === '2d') {
      mobileViewOverride = null;
      return setStage(1);
    }
    if (mode === '3d') {
      mobileViewOverride = null;
      return setStage(activeStage === 1 ? 2 : activeStage);
    }
    mobileViewOverride = mode === 'split' ? 'split' : null;
    applyViewportLayout(activeStage);
    return activeStage;
  }

  stageTabs.forEach((tab) => {
    tab.addEventListener('click', () => setStage(Number(tab.dataset.stage)));
  });

  document.querySelectorAll('[data-stage-next]').forEach((btn) => {
    btn.addEventListener('click', () => setStage(Number(btn.dataset.stageNext)));
  });

  document.getElementById('editSketchBtn')?.addEventListener('click', () => setStage(1));
  toggleMiniBtn?.addEventListener('click', () => toggleMiniPreview());

  revolveGuideBtn?.addEventListener('click', () => {
    if (!state) return;
    state.revolveGuide = !state.revolveGuide;
    const curPart = state.parts?.[state.activePartIndex] || state.parts?.[0];
    syncRevolveGuide(curPart);
    sketch2D?.draw?.();
  });

  document.querySelectorAll('[data-modifier-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-modifier]');
      if (!card) return;
      const key = card.dataset.modifier;
      const next = card.dataset.open !== 'true';
      manualCards.set(key, next);
      setCardOpen(card, next);
    });
  });

  syncStageUI();

  return {
    setStage,
    getStage: () => activeStage,
    toggleMiniPreview,
    setMobileView,
    syncModifierCards,
    syncRevolveGuide,
    syncStageUI
  };
}
