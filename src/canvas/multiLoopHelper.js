/**
 * SKETCH3D — Multi-Loop Concentric 2D Sketch Helper (ISSUE-014)
 * ===============================================================
 * Detects concentric inner/outer loop containment so drawing a second circle/hex/rect
 * inside an existing closed loop creates a multi-loop sketch instead of erasing it.
 */

export function pointInPolygon2D(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function isPolyInsidePoly(innerPts, outerPts) {
  if (!innerPts || innerPts.length < 3 || !outerPts || outerPts.length < 3) return false;
  let insideCount = 0;
  for (const pt of innerPts) {
    if (pointInPolygon2D(pt.x, pt.y, outerPts)) insideCount += 1;
  }
  return insideCount >= Math.ceil(innerPts.length * 0.85);
}

/**
 * Applies a newly finished closed primitive contour to a part:
 * - Adds as inner loop (`part.cutouts`) if strictly inside `part.points`
 * - Wraps `part.points` into `part.cutouts` if strictly enclosing `part.points`
 * - Otherwise replaces `part.points`
 * @returns {'added_inner'|'wrapped_outer'|'replaced'}
 */
export function applyPrimitiveLoop(part, newPts, multiLoopEnabled = true) {
  if (!part || !newPts || newPts.length < 3) return 'replaced';
  const copyNew = newPts.map(p => ({ x: p.x, y: p.y }));
  if (multiLoopEnabled && part.isClosed && part.points && part.points.length >= 3) {
    if (isPolyInsidePoly(copyNew, part.points)) {
      part.cutouts = part.cutouts || [];
      part.cutouts.push(copyNew);
      return 'added_inner';
    }
    if (isPolyInsidePoly(part.points, copyNew)) {
      part.cutouts = part.cutouts || [];
      part.cutouts.push(part.points.map(p => ({ x: p.x, y: p.y })));
      part.points = copyNew;
      part.profileType = 'poly';
      part.bezierNodes = [];
      return 'wrapped_outer';
    }
  }
  part.profileType = 'poly';
  part.bezierNodes = [];
  part.points = copyNew;
  part.isClosed = true;
  return 'replaced';
}
