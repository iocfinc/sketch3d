/**
 * SKETCH3D — On-Demand Toolpath Bead Preview
 * ===========================================
 * Renders compiled toolpath waypoints in Three.js with bridge-risk color coding:
 * - Green (#00E56D): Layer 0 / Brim anchor
 * - Cyan (#73E6F1): Standard extrusion wall
 * - Yellow (#FEFF00): Medium bridge / weave segment (>= 2.5mm)
 * - Pink (#FF66D9): High bridge risk (>= 4.5mm)
 */

/**
 * Builds a Three.js Group visualizing toolpath beads in SKETCH3D world coordinates
 * (centered at X=0, Z=0, Y=height).
 * @param {Array<Object>} waypoints
 * @returns {THREE.Group}
 */
export function buildToolpathPreviewGroup(waypoints) {
  const group = new THREE.Group();
  group.name = 'toolpathPreviewGroup';
  if (!waypoints || waypoints.length < 2) return group;

  const buckets = {
    brim: { color: 0x00e56d, pts: [] },
    wall: { color: 0x73e6f1, pts: [] },
    weave: { color: 0xfeff00, pts: [] },
    risk: { color: 0xff66d9, pts: [] }
  };

  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    if (b.isTravel) continue;

    // Map A1 bed (128, 128, Z) -> Three.js (X-128, Z, -(Y-128))
    const p1 = new THREE.Vector3(a.x - 128, a.z, -(a.y - 128));
    const p2 = new THREE.Vector3(b.x - 128, b.z, -(b.y - 128));

    let bucket = buckets.wall;
    if (b.kind === 'brim' || b.kind === 'layer0') bucket = buckets.brim;
    else if (b.bridgeSpanMm >= 4.5) bucket = buckets.risk;
    else if (b.kind === 'weave' || b.bridgeSpanMm >= 2.5) bucket = buckets.weave;

    bucket.pts.push(p1, p2);
  }

  Object.values(buckets).forEach(({ color, pts }) => {
    if (pts.length === 0) return;
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    group.add(new THREE.LineSegments(geom, mat));
  });

  return group;
}
