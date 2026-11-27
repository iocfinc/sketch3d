/**
 * SKETCH3D — Stage 4/5 Telemetry, Filament Material & Slicer Sync Helpers
 * ======================================================================
 * Keeps Stage 4 pitch readout, Stage 5 filament material unit labels,
 * Z=0 bed-contact safety banner, and auto-derived slicer profile in sync.
 */

import { analyzeBedContact } from '../export/stlExporter.js';
import { resolveAutoSlicerProfile } from '../export/threemfExporter.js';
import { getPrinterProfile, checkBoundsFitPrinter } from '../export/printerProfile.js';

export const PROFILE_SUMMARIES = {
  standard: 'spiral_mode: 0 · wall_loops: 3 · infill: 15% · layer: 0.20mm',
  multi_perimeter: 'spiral_mode: 0 · wall_loops: 4 · hollow_shell · layer: 0.20mm',
  vase: 'spiral_mode: 1 · wall: 0.65mm · layer: 0.20mm',
  basket_weave_arachne: 'wall_generator: arachne · loops: 2 · layer: 0.2 · overhang: 10mm/s · support: 0',
  clear_glass: 'fan: 0% · flow: 1.05 · alignedrectilinear · 25mm/s',
  lfam: 'nozzle: 0.8mm · wall: 1.20mm · layer: 0.40mm'
};

export function getActiveFilamentMaterial(state, part) {
  if (part?.polymerManual && (part.polymer === 'PLA' || part.polymer === 'PETG' || part.polymer === 'ABS')) {
    return part.polymer;
  }
  if (state?.slicerProfile === 'clear_glass') return 'PETG';
  if (part?.polymer === 'PETG' || part?.polymer === 'ABS') return part.polymer;
  return 'PLA';
}

export function getPartEffectiveHeightMm(part) {
  if (part?.type === 'revolve' && part.points?.length >= 2) {
    let minY = Infinity, maxY = -Infinity;
    for (const pt of part.points) {
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    return Math.max(1, maxY - minY);
  }
  return Math.max(1, part?.extrudeHeight || 8);
}

export function syncPitchReadout(state, part) {
  const el = document.getElementById('texturePitchVal');
  if (!el || !part) return;
  const h = getPartEffectiveHeightMm(part) * (state?.scaleMode === 'mini' ? 0.4 : 1);
  const w = Math.max(1, Number(part.textureFreq || 24));
  el.textContent = `Pitch: ${(h / w).toFixed(2)} mm (${h.toFixed(1)}/${w})`;
}

export function syncBedContactStatus(meshes, state = null) {
  const el = document.getElementById('bedContactWarning');
  if (!el) return;
  if (!meshes || meshes.length === 0) {
    el.textContent = 'Z=0 Bed Contact: --';
    el.className = 'text-[10px] font-mono px-2.5 py-1.5 rounded-lg border border-[#1e1e2a] bg-[#07070b] text-zinc-400';
    return;
  }
  const c = analyzeBedContact(meshes);
  const brimOn = Boolean(state?.brimEnabled);
  const brimW = Number(state?.brimWidthMm ?? 5);
  el.textContent = c.isLowContact
    ? (brimOn
      ? `✓ Low Z=0 Contact (${c.contactAreaMm2} mm²) · Outer Brim ${brimW}mm active`
      : `⚠ Low Z=0 Contact (${c.contactAreaMm2} mm²) · Add brim or flatten base`)
    : `✓ Flat Z=0 Contact (${c.contactAreaMm2} mm² · ${Math.round(c.contactRatio * 100)}%)${brimOn ? ` · Brim ${brimW}mm` : ''}`;
  el.className = c.isLowContact && !brimOn
    ? 'text-[10px] font-mono px-2.5 py-1.5 rounded-lg border border-[#FEFF00]/60 bg-[#FEFF00]/15 text-[#FEFF00]'
    : 'text-[10px] font-mono px-2.5 py-1.5 rounded-lg border border-[#00E56D]/40 bg-[#00E56D]/10 text-[#00E56D]';
}

export function syncAutoSlicerProfile(state, force = false) {
  if (!force && state.slicerProfileManual) return;
  state.slicerProfile = resolveAutoSlicerProfile(state.parts, 'auto');
  const sel = document.getElementById('slicerProfileSelect');
  const sum = document.getElementById('slicerProfileSummary');
  if (sel) sel.value = state.slicerProfile;
  if (sum) sum.textContent = PROFILE_SUMMARIES[state.slicerProfile] || '';
}

export function syncPrinterFitBadge(fitBadge, dims, printerId = 'bambu_a1') {
  if (!fitBadge) return true;
  const printer = getPrinterProfile(printerId);
  if (!dims) {
    fitBadge.textContent = `${printer.shortLabel} Max: ${printer.bedWidthMm}×${printer.bedDepthMm}×${printer.maxHeightMm} mm`;
    fitBadge.className = 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono';
    return true;
  }
  const fit = checkBoundsFitPrinter({ width: Number(dims.w), depth: Number(dims.d), height: Number(dims.h) }, printer.id);
  fitBadge.textContent = fit.fits
    ? `✓ Fits ${printer.shortLabel} Bed (${dims.w}×${dims.d}×${dims.h}mm)`
    : `⚠️ Exceeds ${printer.shortLabel} Bed (${dims.w}×${dims.d}×${dims.h}mm)`;
  fitBadge.className = fit.fits
    ? 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#00E56D]/15 text-[#00E56D] border border-[#00E56D]/40 font-mono'
    : 'text-[11px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-[#FEFF00]/15 text-[#FEFF00] border border-[#FEFF00]/60 font-mono';
  return fit.fits;
}
