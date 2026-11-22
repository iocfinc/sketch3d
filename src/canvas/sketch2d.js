/**
 * SKETCH3D — 2D Touch & Pointer Canvas Editor
 * ===========================================
 * Touch-first 2D profile editor with RDP simplification, 90° ortho / midpoint inference,
 * 1mm/5mm/10mm grid snapping, M3/M4 hole placement, and Bambu Lab A1 build plate limits.
 */

import { computeShellInner } from '../geometry/shell3d.js';
import { buildFilletedSegments } from '../geometry/meshBuilder.js';

export const BED_SIZE_MM = 256;

/**
 * Simplifies a 2D polyline using Ramer-Douglas-Peucker algorithm.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} eps
 * @returns {Array<{x: number, y: number}>}
 */
export function rdpSimplify(pts, eps) {
  if (!pts || pts.length <= 2) return pts || [];
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;

  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d > maxD) { maxD = d; idx = i; }
  }

  if (maxD > eps) {
    return rdpSimplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdpSimplify(pts.slice(idx), eps));
  }
  return [a, b];
}

/**
 * Ray-casting point-in-polygon test.
 * @param {number} x
 * @param {number} y
 * @param {Array<{x: number, y: number}>} pts
 * @returns {boolean}
 */
export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

/**
 * Initializes the 2D sketch controller.
 * @param {Object} options
 * @returns {Object} Sketch controller API
 */
export function initSketch2D({ canvas, container, state, onModelChange, onModeChange }) {
  const ctx = canvas.getContext('2d');
  let canvasSize = 360, isTouchActive = false;

  const mmToPx = mm => ((mm + BED_SIZE_MM / 2) / BED_SIZE_MM) * canvasSize;
  const pxToMmRaw = px => Math.max(-128, Math.min(128, (px / canvasSize) * BED_SIZE_MM - 128));
  const snapMm = mm => (state.snapEnabled && state.snapStep > 0)
    ? Math.round(mm / state.snapStep) * state.snapStep
    : Math.round(mm * 10) / 10;
  const activePart = () => state.parts[state.activePartIndex] || state.parts[0];

  function applyInference(rawX, rawY, refPt) {
    state.inferGuide = null;
    const p = activePart();
    let x = snapMm(rawX), y = snapMm(rawY);

    if (p.points.length >= 2) {
      const px = mmToPx(rawX), py = mmToPx(rawY);
      const count = p.isClosed ? p.points.length : p.points.length - 1;
      for (let i = 0; i < count; i++) {
        const a = p.points[i], b = p.points[(i + 1) % p.points.length];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (Math.hypot(px - mmToPx(mx), py - mmToPx(my)) < 9) {
          state.inferGuide = { type: 'mid', mx, my };
          return { x: Math.round(mx * 10) / 10, y: Math.round(my * 10) / 10 };
        }
      }
    }

    if (refPt) {
      const dx = rawX - refPt.x, dy = rawY - refPt.y;
      if (Math.hypot(dx, dy) > 4) {
        const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
        if (ang < 5 || ang > 175) { y = refPt.y; state.inferGuide = { type: 'ortho', x1: refPt.x, y1: refPt.y, x2: x, y2: y }; }
        else if (Math.abs(ang - 90) < 5) { x = refPt.x; state.inferGuide = { type: 'ortho', x1: refPt.x, y1: refPt.y, x2: x, y2: y }; }
      }
    }
    return { x: Math.max(-128, Math.min(128, x)), y: Math.max(-128, Math.min(128, y)) };
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvasSize = Math.max(240, Math.floor(Math.min(rect.width - 16, rect.height - 16)));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';
    canvas.width = Math.floor(canvasSize * dpr);
    canvas.height = Math.floor(canvasSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawPart(p, isActive) {
    if (p.points.length > 0) {
      ctx.beginPath();
      const segs = buildFilletedSegments(p.points, p.cornerRadius, p.isClosed);
      if (segs && segs.length >= 3) {
        ctx.moveTo(mmToPx(segs[0].pIn.x), mmToPx(segs[0].pIn.y));
        segs.forEach((s, i) => {
          ctx.quadraticCurveTo(mmToPx(s.ctrl.x), mmToPx(s.ctrl.y), mmToPx(s.pOut.x), mmToPx(s.pOut.y));
          const next = segs[(i + 1) % segs.length];
          ctx.lineTo(mmToPx(next.pIn.x), mmToPx(next.pIn.y));
        });
        ctx.closePath();
      } else {
        p.points.forEach((pt, idx) => idx === 0 ? ctx.moveTo(mmToPx(pt.x), mmToPx(pt.y)) : ctx.lineTo(mmToPx(pt.x), mmToPx(pt.y)));
        if (p.isClosed && p.points.length >= 3) ctx.closePath();
      }

      if (p.isClosed && p.points.length >= 3) {
        ctx.fillStyle = p.color + (isActive ? '33' : '15');
        ctx.fill();
      }
      ctx.strokeStyle = isActive ? (p.isClosed ? '#00E56D' : '#FEFF00') : '#52526b';
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.stroke();

      if (isActive && p.shellEnabled && p.isClosed) {
        const inner = computeShellInner(p.points, p.shellThickness || 1.2);
        if (inner) {
          ctx.save(); ctx.setLineDash([4, 4]); ctx.beginPath();
          inner.forEach((pt, idx) => idx === 0 ? ctx.moveTo(mmToPx(pt.x), mmToPx(pt.y)) : ctx.lineTo(mmToPx(pt.x), mmToPx(pt.y)));
          ctx.closePath(); ctx.strokeStyle = '#73E6F1'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
        }
      }

      if (isActive) {
        p.points.forEach((pt, idx) => {
          ctx.beginPath();
          ctx.arc(mmToPx(pt.x), mmToPx(pt.y), idx === 0 ? 7.5 : 6, 0, Math.PI * 2);
          ctx.fillStyle = idx === 0 ? '#00E56D' : '#FEFF00';
          ctx.fill(); ctx.strokeStyle = '#020203'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }
    }

    (p.cutouts || []).forEach(poly => {
      if (poly.length < 3) return;
      ctx.beginPath();
      poly.forEach((pt, idx) => idx === 0 ? ctx.moveTo(mmToPx(pt.x), mmToPx(pt.y)) : ctx.lineTo(mmToPx(pt.x), mmToPx(pt.y)));
      ctx.closePath(); ctx.fillStyle = '#020203cc'; ctx.fill(); ctx.strokeStyle = '#73E6F1'; ctx.lineWidth = 2; ctx.stroke();
    });

    (p.holes || []).forEach(h => {
      const x = mmToPx(h.x), y = mmToPx(h.y), rPx = Math.max(4, (h.r / BED_SIZE_MM) * canvasSize);
      ctx.beginPath(); ctx.arc(x, y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = '#020203'; ctx.fill(); ctx.strokeStyle = '#FF66D9'; ctx.lineWidth = 2; ctx.stroke();
    });

    (p.standoffs || []).forEach(s => {
      const x = mmToPx(s.x), y = mmToPx(s.y);
      const rOut = Math.max(6, (3.6 / BED_SIZE_MM) * canvasSize);
      const rIn = Math.max(3, (1.6 / BED_SIZE_MM) * canvasSize);
      ctx.beginPath(); ctx.arc(x, y, rOut, 0, Math.PI * 2);
      ctx.fillStyle = '#FEFF0033'; ctx.fill(); ctx.strokeStyle = '#FEFF00'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, rIn, 0, Math.PI * 2);
      ctx.fillStyle = '#020203'; ctx.fill(); ctx.strokeStyle = '#FF66D9'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = '#050508'; ctx.fillRect(0, 0, canvasSize, canvasSize);

    for (let mm = -120; mm <= 120; mm += 10) {
      const p = mmToPx(mm);
      ctx.strokeStyle = mm === 0 ? 'rgba(115, 230, 241, 0.35)' : (mm % 50 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)');
      ctx.lineWidth = mm === 0 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, canvasSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(canvasSize, p); ctx.stroke();
    }
    ctx.strokeStyle = '#00E56D'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, canvasSize - 2, canvasSize - 2);

    state.parts.forEach((p, idx) => { if (idx !== state.activePartIndex) drawPart(p, false); });
    drawPart(activePart(), true);

    if (state.activeCutout && state.activeCutout.length > 0) {
      ctx.beginPath();
      state.activeCutout.forEach((pt, idx) => idx === 0 ? ctx.moveTo(mmToPx(pt.x), mmToPx(pt.y)) : ctx.lineTo(mmToPx(pt.x), mmToPx(pt.y)));
      ctx.strokeStyle = '#73E6F1'; ctx.lineWidth = 2; ctx.stroke();
      state.activeCutout.forEach((pt, idx) => {
        ctx.beginPath(); ctx.arc(mmToPx(pt.x), mmToPx(pt.y), idx === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? '#00E56D' : '#73E6F1'; ctx.fill();
      });
    }

    if (state.freehandStroke && state.freehandStroke.length > 1) {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.beginPath();
      state.freehandStroke.forEach((pt, i) => i === 0 ? ctx.moveTo(mmToPx(pt.x), mmToPx(pt.y)) : ctx.lineTo(mmToPx(pt.x), mmToPx(pt.y)));
      ctx.strokeStyle = '#FEFF00'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
    }

    if (state.inferGuide) {
      ctx.save();
      if (state.inferGuide.type === 'ortho') {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#73E6F1'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mmToPx(state.inferGuide.x1), mmToPx(state.inferGuide.y1));
        ctx.lineTo(mmToPx(state.inferGuide.x2), mmToPx(state.inferGuide.y2)); ctx.stroke();
      } else if (state.inferGuide.type === 'mid') {
        ctx.fillStyle = '#00E56D'; ctx.fillRect(mmToPx(state.inferGuide.mx) - 4, mmToPx(state.inferGuide.my) - 4, 8, 8);
      }
      ctx.restore();
    }
  }

  function getCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    return { px, py, rawX: pxToMmRaw(px), rawY: pxToMmRaw(py) };
  }

  function onStart(cx, cy) {
    const { px, py, rawX, rawY } = getCoords(cx, cy);
    const p = activePart();

    if (state.mode === 'freehand') { state.freehandStroke = [{ x: rawX, y: rawY }]; draw(); return; }
    if (['rect', 'circle', 'hex'].includes(state.mode)) {
      const sx = snapMm(rawX), sy = snapMm(rawY);
      state.primitiveDrag = { startX: sx, startY: sy, curX: sx, curY: sy }; return;
    }
    if (state.mode === 'hole') { p.holes.push({ x: snapMm(rawX), y: snapMm(rawY), r: 1.6 }); draw(); onModelChange(); return; }
    if (state.mode === 'standoff') { p.standoffs.push({ x: snapMm(rawX), y: snapMm(rawY) }); draw(); onModelChange(); return; }
    if (state.mode === 'cutout') {
      if (state.activeCutout.length >= 3 && Math.hypot(px - mmToPx(state.activeCutout[0].x), py - mmToPx(state.activeCutout[0].y)) < 20) {
        p.cutouts.push([...state.activeCutout]); state.activeCutout = []; draw(); onModelChange(); return;
      }
      state.activeCutout.push({ x: snapMm(rawX), y: snapMm(rawY) }); draw(); return;
    }
    if (state.mode === 'poly') {
      if (p.isClosed) { p.points = []; p.isClosed = false; }
      if (p.points.length >= 3 && Math.hypot(px - mmToPx(p.points[0].x), py - mmToPx(p.points[0].y)) < 20) {
        p.isClosed = true; onModeChange('edit'); draw(); onModelChange(); return;
      }
      const ref = p.points.length > 0 ? p.points[p.points.length - 1] : null;
      p.points.push(applyInference(rawX, rawY, ref));
      draw(); if (p.points.length >= 3) onModelChange(); return;
    }

    const hitR = 20;
    for (let i = 0; i < p.points.length; i++) {
      if (Math.hypot(px - mmToPx(p.points[i].x), py - mmToPx(p.points[i].y)) < hitR) {
        const now = Date.now();
        if (now - state.lastTapTime < 300 && state.lastTapIndex === i && p.points.length > 3) {
          p.points.splice(i, 1); state.lastTapTime = 0; draw(); onModelChange(); return;
        }
        state.lastTapTime = now; state.lastTapIndex = i;
        state.draggingVertex = { type: 'outer', index: i }; return;
      }
    }
    for (let i = 0; i < p.holes.length; i++) {
      if (Math.hypot(px - mmToPx(p.holes[i].x), py - mmToPx(p.holes[i].y)) < hitR) {
        state.draggingVertex = { type: 'hole', index: i }; return;
      }
    }
    for (let c = 0; c < p.cutouts.length; c++) {
      for (let i = 0; i < p.cutouts[c].length; i++) {
        if (Math.hypot(px - mmToPx(p.cutouts[c][i].x), py - mmToPx(p.cutouts[c][i].y)) < hitR) {
          state.draggingVertex = { type: 'cutout', index: c, subIndex: i }; return;
        }
      }
    }
    if (p.isClosed && p.points.length >= 3 && pointInPoly(rawX, rawY, p.points)) {
      state.draggingVertex = { type: 'translate', lastX: snapMm(rawX), lastY: snapMm(rawY) };
    }
  }

  function onMove(cx, cy) {
    const { px, py, rawX, rawY } = getCoords(cx, cy);
    const p = activePart();

    if (state.mode === 'freehand' && state.freehandStroke.length > 0) {
      const last = state.freehandStroke[state.freehandStroke.length - 1];
      if (Math.hypot(rawX - last.x, rawY - last.y) > 1.5) { state.freehandStroke.push({ x: rawX, y: rawY }); draw(); }
      return;
    }
    if (state.primitiveDrag) {
      const sx = snapMm(rawX), sy = snapMm(rawY), { startX, startY } = state.primitiveDrag;
      if (state.mode === 'rect') {
        p.points = [{ x: startX, y: startY }, { x: sx, y: startY }, { x: sx, y: sy }, { x: startX, y: sy }]; p.isClosed = true;
      } else {
        const r = Math.max(4, Math.hypot(sx - startX, sy - startY)), sides = state.mode === 'circle' ? 32 : 6;
        p.points = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          p.points.push({ x: Math.round((startX + Math.cos(a) * r) * 10) / 10, y: Math.round((startY + Math.sin(a) * r) * 10) / 10 });
        }
        p.isClosed = true;
      }
      draw(); onModelChange(); return;
    }
    if (!state.draggingVertex) return;
    const d = state.draggingVertex;
    if (d.type === 'outer') {
      const prev = p.points[(d.index - 1 + p.points.length) % p.points.length];
      p.points[d.index] = applyInference(rawX, rawY, prev);
    } else if (d.type === 'hole') {
      p.holes[d.index].x = snapMm(rawX); p.holes[d.index].y = snapMm(rawY);
    } else if (d.type === 'cutout') {
      p.cutouts[d.index][d.subIndex].x = snapMm(rawX); p.cutouts[d.index][d.subIndex].y = snapMm(rawY);
    } else if (d.type === 'translate') {
      const curX = snapMm(rawX), curY = snapMm(rawY), dx = curX - d.lastX, dy = curY - d.lastY;
      if (dx !== 0 || dy !== 0) {
        p.points.forEach(pt => { pt.x = Math.max(-128, Math.min(128, pt.x + dx)); pt.y = Math.max(-128, Math.min(128, pt.y + dy)); });
        p.holes.forEach(h => { h.x = Math.max(-128, Math.min(128, h.x + dx)); h.y = Math.max(-128, Math.min(128, h.y + dy)); });
        p.cutouts.forEach(c => c.forEach(pt => { pt.x += dx; pt.y += dy; }));
        d.lastX = curX; d.lastY = curY;
      }
    }
    draw(); onModelChange();
  }

  function onEnd() {
    const p = activePart();
    if (state.mode === 'freehand' && state.freehandStroke.length > 3) {
      const simplified = rdpSimplify(state.freehandStroke, 2.5);
      if (simplified.length >= 3) {
        p.points = simplified.map(pt => ({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 }));
        p.isClosed = true; onModeChange('edit'); onModelChange();
      }
      state.freehandStroke = [];
    }
    if (state.primitiveDrag) { state.primitiveDrag = null; onModeChange('edit'); }
    state.draggingVertex = null; state.inferGuide = null; draw();
  }

  // Mobile Touch Listeners (passive: false, touch-action: none)
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); isTouchActive = true;
    if (e.touches[0]) onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault(); onEnd();
    setTimeout(() => { isTouchActive = false; }, 300);
  }, { passive: false });

  // Desktop Pointer Listeners
  canvas.addEventListener('pointerdown', (e) => {
    if (isTouchActive) return;
    canvas.setPointerCapture(e.pointerId); onStart(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (isTouchActive) return;
    onMove(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (isTouchActive) return;
    onEnd(); try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  return { resize, draw, mmToPx, pxToMmRaw, snapMm };
}
