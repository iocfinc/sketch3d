/**
 * SKETCH3D — Multi-Object .3MF Bed Layout & AMS Slot Resolver
 * ============================================================
 * Computes non-overlapping side-by-side / multi-plate 3MF item transforms
 * when un-nesting concentric shells, plus per-part AMS extruder metadata.
 */

/**
 * Computes per-part bounding widths/depths in slicer XY coordinates (X, -Z) and
 * returns either centered concentric placement or non-overlapping un-nested placements.
 * @param {Array<{width:number,depth:number,minX:number,maxX:number,minY:number,maxY:number}>} boxes
 * @param {Object} printer
 * @param {boolean} [unnestShells=false]
 * @returns {Array<{tx:number,ty:number,tz:number,plateIndex:number,viewOffsetX:number,viewOffsetZ:number}>}
 */
export function computeThreeMFItemPlacements(boxes, printer, unnestShells = false) {
  const cx = printer?.bedCenter?.x ?? 128;
  const cy = printer?.bedCenter?.y ?? 128;
  const bedW = printer?.bedWidthMm ?? 256;
  const bedD = printer?.bedDepthMm ?? 256;
  const gap = printer?.gapMm ?? 6;
  const margin = printer?.marginMm ?? 6;

  if (!boxes || boxes.length === 0) return [];
  if (!unnestShells || boxes.length === 1) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    }
    const midX = minX < Infinity ? (minX + maxX) * 0.5 : 0;
    const midY = minY < Infinity ? (minY + maxY) * 0.5 : 0;
    return boxes.map(() => ({
      tx: +(cx - midX).toFixed(3),
      ty: +(cy - midY).toFixed(3),
      tz: 0,
      plateIndex: 0,
      viewOffsetX: 0,
      viewOffsetZ: 0
    }));
  }

  // Side-by-side non-overlapping row/plate bin placement
  const usableW = bedW - margin * 2;
  const usableD = bedD - margin * 2;
  let plateIdx = 0;
  let curX = margin;
  let curY = margin;
  let rowD = 0;
  const raw = [];

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const w = Math.max(2, b.maxX - b.minX);
    const d = Math.max(2, b.maxY - b.minY);
    if (curX + w > margin + usableW + 1e-4 && curX > margin) {
      curX = margin;
      curY += rowD + gap;
      rowD = 0;
    }
    if (curY + d > margin + usableD + 1e-4 && (curX > margin || curY > margin)) {
      plateIdx += 1;
      curX = margin;
      curY = margin;
      rowD = 0;
    }
    const targetMinX = plateIdx * (bedW + 24) + curX;
    const targetMinY = curY;
    raw.push({
      b,
      w,
      d,
      plateIndex: plateIdx,
      targetCenterX: targetMinX + w * 0.5,
      targetCenterY: targetMinY + d * 0.5
    });
    curX += w + gap;
    rowD = Math.max(rowD, d);
  }

  // Center single-plate cluster around bed center for clean print bed positioning
  const plate0 = raw.filter(r => r.plateIndex === 0);
  let shiftX = 0, shiftY = 0;
  if (plate0.length > 0) {
    const pMinX = Math.min(...plate0.map(r => r.targetCenterX - r.w * 0.5));
    const pMaxX = Math.max(...plate0.map(r => r.targetCenterX + r.w * 0.5));
    const pMinY = Math.min(...plate0.map(r => r.targetCenterY - r.d * 0.5));
    const pMaxY = Math.max(...plate0.map(r => r.targetCenterY + r.d * 0.5));
    shiftX = cx - (pMinX + pMaxX) * 0.5;
    shiftY = cy - (pMinY + pMaxY) * 0.5;
  }

  return raw.map(r => {
    const bMidX = (r.b.minX + r.b.maxX) * 0.5;
    const bMidY = (r.b.minY + r.b.maxY) * 0.5;
    const px = r.targetCenterX + shiftX;
    const py = r.targetCenterY + shiftY;
    return {
      tx: +(px - bMidX).toFixed(3),
      ty: +(py - bMidY).toFixed(3),
      tz: 0,
      plateIndex: r.plateIndex,
      viewOffsetX: +(px - cx - bMidX).toFixed(3),
      viewOffsetZ: +(-(py - cy - bMidY)).toFixed(3)
    };
  });
}

/**
 * Resolves up to 4 AMS filament slot polymers for Bambu Studio / OrcaSlicer metadata.
 */
export function buildAmsFilamentTypes(parts = []) {
  const slots = ['PLA', 'PLA', 'PLA', 'PLA'];
  (parts || []).forEach((p, idx) => {
    const slot = Math.max(1, Math.min(4, Math.round(Number(p?.amsSlot ?? (idx + 1)))));
    const poly = String(p?.polymer || 'PLA').toUpperCase();
    slots[slot - 1] = (poly === 'PETG' || poly === 'ABS') ? poly : 'PLA';
  });
  return slots;
}
