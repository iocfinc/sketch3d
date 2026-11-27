/**
 * SKETCH3D — Canvas2D Wireframe Fallback Renderer (ISSUE-017)
 * ===========================================================
 * Lightweight 3D-to-2D perspective wireframe & edge projection renderer
 * activated automatically when WebGL context creation fails or is lost.
 */

export function createCanvas2DFallback({ canvas, getOrbit, getPartsGroup, getBedSizeMm, getWireframe }) {
  const ctx = canvas.getContext('2d');
  let width = 320;
  let height = 240;

  function setSize(w, h) {
    width = Math.max(120, Math.floor(w || 320));
    height = Math.max(100, Math.floor(h || 240));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeProjector(orbit) {
    const sp = Math.sin(orbit.phi);
    const camX = orbit.radius * sp * Math.sin(orbit.theta);
    const camY = orbit.targetY + orbit.radius * Math.cos(orbit.phi);
    const camZ = orbit.radius * sp * Math.cos(orbit.theta);

    // Camera basis vectors looking at (0, targetY, 0)
    let fx = -camX, fy = orbit.targetY - camY, fz = -camZ;
    const fLen = Math.hypot(fx, fy, fz) || 1;
    fx /= fLen; fy /= fLen; fz /= fLen;

    // Right = forward x up(0,1,0)
    let rx = -fz, ry = 0, rz = fx;
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen; rz /= rLen;

    // Up = right x forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const focal = (height * 0.5) / Math.tan((45 * Math.PI) / 360);
    const cx = width * 0.5;
    const cy = height * 0.5;

    return (wx, wy, wz) => {
      const dx = wx - camX, dy = wy - camY, dz = wz - camZ;
      const px = dx * rx + dy * ry + dz * rz;
      const py = dx * ux + dy * uy + dz * uz;
      const pz = dx * fx + dy * fy + dz * fz;
      if (pz <= 1) return null;
      return {
        x: cx + (px * focal) / pz,
        y: cy - (py * focal) / pz,
        z: pz
      };
    };
  }

  function drawLine3D(proj, a, b, color, lineWidth = 1) {
    const pa = proj(a[0], a[1], a[2]);
    const pb = proj(b[0], b[1], b[2]);
    if (!pa || !pb) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  function render() {
    if (!ctx) return;
    ctx.fillStyle = '#020203';
    ctx.fillRect(0, 0, width, height);

    const orbit = getOrbit();
    const proj = makeProjector(orbit);
    const halfBed = (getBedSizeMm() || 256) * 0.5;

    // Draw Bambu bed grid
    const step = 32;
    for (let v = -halfBed; v <= halfBed; v += step) {
      const col = v === 0 ? 'rgba(115,230,241,0.35)' : 'rgba(255,255,255,0.08)';
      drawLine3D(proj, [v, 0, -halfBed], [v, 0, halfBed], col, 1);
      drawLine3D(proj, [-halfBed, 0, v], [halfBed, 0, v], col, 1);
    }
    drawLine3D(proj, [-halfBed, 0, -halfBed], [halfBed, 0, -halfBed], '#00E56D', 1.5);
    drawLine3D(proj, [halfBed, 0, -halfBed], [halfBed, 0, halfBed], '#00E56D', 1.5);
    drawLine3D(proj, [halfBed, 0, halfBed], [-halfBed, 0, halfBed], '#00E56D', 1.5);
    drawLine3D(proj, [-halfBed, 0, halfBed], [-halfBed, 0, -halfBed], '#00E56D', 1.5);

    const group = getPartsGroup();
    const wire = Boolean(getWireframe?.());
    if (group && group.children) {
      for (const child of group.children) {
        if (!child?.isMesh || !child.geometry?.attributes?.position) continue;
        const pos = child.geometry.attributes.position;
        const idx = child.geometry.index ? child.geometry.index.array : null;
        const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
        const stride = Math.max(1, Math.ceil(triCount / 750));
        const ox = child.position?.x || 0;
        const oy = child.position?.y || 0;
        const oz = child.position?.z || 0;
        const hex = child.material?.color?.getHexString ? `#${child.material.color.getHexString()}` : '#FF66D9';
        ctx.strokeStyle = wire ? '#73E6F1' : hex;
        ctx.lineWidth = wire ? 1.15 : 0.9;
        ctx.beginPath();
        for (let t = 0; t < triCount; t += stride) {
          const i0 = idx ? idx[t * 3] : t * 3;
          const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
          const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
          const p0 = proj(pos.getX(i0) + ox, pos.getY(i0) + oy, pos.getZ(i0) + oz);
          const p1 = proj(pos.getX(i1) + ox, pos.getY(i1) + oy, pos.getZ(i1) + oz);
          const p2 = proj(pos.getX(i2) + ox, pos.getY(i2) + oy, pos.getZ(i2) + oz);
          if (!p0 || !p1 || !p2) continue;
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p0.x, p0.y);
        }
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(11,11,16,0.85)';
    ctx.fillRect(10, height - 28, 178, 20);
    ctx.fillStyle = '#73E6F1';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('CANVAS2D WIREFRAME FALLBACK', 16, height - 15);
  }

  return { setSize, render };
}
