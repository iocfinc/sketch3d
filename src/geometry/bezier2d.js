/**
 * SKETCH3D — Cubic Bezier 2D Profile Engine
 * ==========================================
 * Interactive Cubic Bezier curve math, smooth Catmull-Rom tangent generation,
 * uniform arc-length resampling (0.5mm default), and 2D canvas overlay rendering.
 */

/**
 * Evaluates a single cubic Bezier segment at parameter t in [0, 1].
 * @param {{x:number,y:number}} p0
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {{x:number,y:number}} p3
 * @param {number} t
 * @returns {{x:number,y:number}}
 */
export function evalCubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  };
}

/**
 * Evaluates first derivative (tangent vector) of a cubic Bezier at t in [0, 1].
 * @param {{x:number,y:number}} p0
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {{x:number,y:number}} p3
 * @param {number} t
 * @returns {{x:number,y:number}}
 */
export function evalCubicBezierTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y)
  };
}

/**
 * Computes smooth Catmull-Rom-inspired cubic Bezier handles (cpIn, cpOut)
 * for an array of anchor points.
 * @param {Array<{x:number,y:number,cpIn?:{x:number,y:number},cpOut?:{x:number,y:number}}>} anchors
 * @param {number} [smoothness=0.35]
 * @param {boolean} [isClosed=false]
 * @returns {Array<{x:number,y:number,cpIn:{x:number,y:number},cpOut:{x:number,y:number}}>}
 */
export function computeAutoTangents(anchors, smoothness = 0.35, isClosed = false) {
  const n = anchors.length;
  if (n === 0) return [];
  return anchors.map((pt, i) => {
    const prev = isClosed
      ? anchors[(i - 1 + n) % n]
      : anchors[Math.max(0, i - 1)];
    const next = isClosed
      ? anchors[(i + 1) % n]
      : anchors[Math.min(n - 1, i + 1)];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dPrev = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    const dNext = Math.hypot(next.x - pt.x, next.y - pt.y);
    const chord = Math.hypot(dx, dy) || 1;
    const ux = dx / chord;
    const uy = dy / chord;

    const lenIn = (i === 0 && !isClosed) ? 0 : dPrev * smoothness;
    const lenOut = (i === n - 1 && !isClosed) ? 0 : dNext * smoothness;

    return {
      x: pt.x,
      y: pt.y,
      cpIn: { x: pt.x - ux * lenIn, y: pt.y - uy * lenIn },
      cpOut: { x: pt.x + ux * lenOut, y: pt.y + uy * lenOut }
    };
  });
}

/**
 * Converts a polyline into smooth Bezier anchor nodes.
 * @param {Array<{x:number,y:number}>} points
 * @param {number} [smoothness=0.35]
 * @param {boolean} [isClosed=false]
 * @returns {Array<{x:number,y:number,cpIn:{x:number,y:number},cpOut:{x:number,y:number}}>}
 */
export function polyToBezierNodes(points, smoothness = 0.35, isClosed = false) {
  if (!points || points.length === 0) return [];
  return computeAutoTangents(points, smoothness, isClosed);
}

/**
 * Uniformly resamples a piecewise cubic Bezier curve by arc length.
 * @param {Array<{x:number,y:number,cpIn?:{x:number,y:number},cpOut?:{x:number,y:number}}>} nodes
 * @param {number} [resolutionMm=0.5]
 * @param {boolean} [isClosed=false]
 * @returns {Array<{x:number,y:number}>}
 */
export function sampleBezierCurve(nodes, resolutionMm = 0.5, isClosed = false) {
  if (!nodes || nodes.length < 2) {
    return (nodes || []).map(n => ({ x: n.x, y: n.y }));
  }

  const stepMm = Math.max(0.1, resolutionMm);
  const segCount = isClosed ? nodes.length : nodes.length - 1;
  const finePts = [];
  const cumLen = [0];
  const SUBDIV = 32;

  for (let s = 0; s < segCount; s++) {
    const a = nodes[s];
    const b = nodes[(s + 1) % nodes.length];
    const p0 = { x: a.x, y: a.y };
    const p1 = a.cpOut ? { x: a.cpOut.x, y: a.cpOut.y } : p0;
    const p3 = { x: b.x, y: b.y };
    const p2 = b.cpIn ? { x: b.cpIn.x, y: b.cpIn.y } : p3;

    const startK = s === 0 ? 0 : 1;
    for (let k = startK; k <= SUBDIV; k++) {
      const pt = evalCubicBezier(p0, p1, p2, p3, k / SUBDIV);
      if (finePts.length > 0) {
        const prev = finePts[finePts.length - 1];
        cumLen.push(cumLen[cumLen.length - 1] + Math.hypot(pt.x - prev.x, pt.y - prev.y));
      }
      finePts.push(pt);
    }
  }

  const totalLen = cumLen[cumLen.length - 1];
  if (totalLen < 1e-4) return [{ x: nodes[0].x, y: nodes[0].y }];

  const numSamples = Math.max(2, Math.round(totalLen / stepMm));
  const out = [];
  let fineIdx = 0;

  for (let i = 0; i <= numSamples; i++) {
    const target = (i / numSamples) * totalLen;
    while (fineIdx < cumLen.length - 2 && cumLen[fineIdx + 1] < target) {
      fineIdx++;
    }
    const l0 = cumLen[fineIdx];
    const l1 = cumLen[fineIdx + 1];
    const span = l1 - l0;
    const alpha = span > 1e-6 ? (target - l0) / span : 0;
    const a = finePts[fineIdx];
    const b = finePts[fineIdx + 1];
    out.push({
      x: Math.round((a.x + (b.x - a.x) * alpha) * 1000) / 1000,
      y: Math.round((a.y + (b.y - a.y) * alpha) * 1000) / 1000
    });
  }

  // Avoid duplicate closing point if closed
  if (isClosed && out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < stepMm * 0.5) {
      out.pop();
    }
  }
  return out;
}

/**
 * Synchronizes part.points from part.bezierNodes when profileType === 'bezier'.
 * @param {Object} part
 * @param {number} [resolutionMm=0.5]
 */
export function syncBezierToPoints(part, resolutionMm = 0.5) {
  if (!part || part.profileType !== 'bezier') return;
  if (!part.bezierNodes || part.bezierNodes.length < 2) {
    part.points = (part.bezierNodes || []).map(n => ({ x: n.x, y: n.y }));
    return;
  }
  part.points = sampleBezierCurve(part.bezierNodes, resolutionMm, !!part.isClosed);
}

/**
 * Computes live millimeter profile bounding readout (height & max radius).
 * @param {Array<{x:number,y:number}>} points
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,width:number,height:number,maxRadius:number}}
 */
export function getProfileBoundsMm(points) {
  if (!points || points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, maxRadius: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxRadius = 0;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
    maxRadius = Math.max(maxRadius, Math.abs(pt.x));
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.round((maxX - minX) * 10) / 10,
    height: Math.round((maxY - minY) * 10) / 10,
    maxRadius: Math.round(maxRadius * 10) / 10
  };
}

/**
 * Draws Bezier anchor points and tangent control handles onto a 2D canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} part
 * @param {Function} mmToPx
 * @param {boolean} isActive
 */
export function drawBezierHandles(ctx, part, mmToPx, isActive) {
  if (!isActive || part.profileType !== 'bezier' || !part.bezierNodes) return;
  ctx.save();
  part.bezierNodes.forEach((node, idx) => {
    const ax = mmToPx(node.x);
    const ay = mmToPx(node.y);
    [node.cpIn, node.cpOut].forEach((cp) => {
      if (!cp) return;
      const cx = mmToPx(cp.x);
      const cy = mmToPx(cp.y);
      if (Math.hypot(cx - ax, cy - ay) < 2) return;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = 'rgba(115, 230, 241, 0.65)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FF66D9';
      ctx.fill();
      ctx.strokeStyle = '#020203';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(ax, ay, idx === 0 ? 7.5 : 6, 0, Math.PI * 2);
    ctx.fillStyle = idx === 0 ? '#00E56D' : '#FEFF00';
    ctx.fill();
    ctx.strokeStyle = '#020203';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  ctx.restore();
}
