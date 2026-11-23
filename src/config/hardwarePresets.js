/**
 * SKETCH3D — Captive Hardware Presets (Hex Nuts & Countersink Screws)
 * =================================================================
 * Calibrated FDM hardware cutouts for metric fasteners with +0.2mm clearance.
 * Used for generative pocket cuts and through-bores in structural parts.
 */

export const HARDWARE_PRESETS = {
  // Hex Nut Traps: acrossFlats nominal + 0.2mm clearance
  HEX_NUT_M3: {
    type: 'hex_nut',
    thread: 'M3',
    nominalFlats: 5.5,
    acrossFlats: 5.7,     // 5.5 + 0.2mm clearance
    depth: 2.6,           // 2.4mm nominal thickness + 0.2mm axial clearance
    throughBore: 3.2,     // 3.0mm nominal + 0.2mm hole clearance
    label: 'M3 Captive Hex Nut (5.7mm flats)',
  },
  HEX_NUT_M4: {
    type: 'hex_nut',
    thread: 'M4',
    nominalFlats: 7.0,
    acrossFlats: 7.2,     // 7.0 + 0.2mm clearance
    depth: 3.4,           // 3.2mm nominal thickness + 0.2mm axial clearance
    throughBore: 4.2,     // 4.0mm nominal + 0.2mm hole clearance
    label: 'M4 Captive Hex Nut (7.2mm flats)',
  },
  HEX_NUT_M5: {
    type: 'hex_nut',
    thread: 'M5',
    nominalFlats: 8.0,
    acrossFlats: 8.2,     // 8.0 + 0.2mm clearance
    depth: 4.2,           // 4.0mm nominal thickness + 0.2mm axial clearance
    throughBore: 5.2,     // 5.0mm nominal + 0.2mm hole clearance
    label: 'M5 Captive Hex Nut (8.2mm flats)',
  },

  // Countersink Wood Screws: 90° included angle (45° half-angle / support-free wall slope)
  CSK_WOOD_M3: {
    type: 'countersink',
    thread: 'M3',
    shankDiameter: 3.2,
    headDiameter: 6.0,
    headAngleDeg: 90.0,
    headSlopeDeg: 45.0,   // Support-free 45° overhang slope
    headDepth: 1.4,       // (headDiameter - shankDiameter) / 2 = (6.0 - 3.2)/2 = 1.4mm
    label: 'M3 Countersink (90° head, 6.0mm OD)',
  },
  CSK_WOOD_M4: {
    type: 'countersink',
    thread: 'M4',
    shankDiameter: 4.2,
    headDiameter: 8.0,
    headAngleDeg: 90.0,
    headSlopeDeg: 45.0,   // Support-free 45° overhang slope
    headDepth: 1.9,       // (headDiameter - shankDiameter) / 2 = (8.0 - 4.2)/2 = 1.9mm
    label: 'M4 Countersink (90° head, 8.0mm OD)',
  },
};

/**
 * Generate 2D regular hexagon polygon vertices centered at (cx, cy)
 * Oriented with top/bottom edges horizontal so distance between parallel flats is exact.
 * @param {number} cx Center X
 * @param {number} cy Center Y
 * @param {number} acrossFlats Distance across parallel flats in mm
 * @returns {Array<{x: number, y: number}>}
 */
export function generateHexagonVertices(cx, cy, acrossFlats) {
  // Distance across flats W = 2 * R * cos(30 deg) = R * sqrt(3)
  // R = W / sqrt(3)
  const radius = acrossFlats / Math.sqrt(3);
  const vertices = [];

  // Start at 30 degrees so that vertices at 30, 90, 150, 210, 270, 330 deg
  // produce horizontal edges at y = +W/2 and y = -W/2
  for (let i = 0; i < 6; i++) {
    const angleRad = ((30 + i * 60) * Math.PI) / 180;
    vertices.push({
      x: Number((cx + radius * Math.cos(angleRad)).toFixed(4)),
      y: Number((cy + radius * Math.sin(angleRad)).toFixed(4)),
    });
  }

  return vertices;
}

/**
 * Measure the flat-to-flat distance of a 6-sided regular polygon
 * @param {Array<{x: number, y: number}>} hexPts
 * @returns {number}
 */
export function measureHexagonAcrossFlats(hexPts) {
  if (!hexPts || hexPts.length < 6) return 0;
  // Calculate distance between opposing edges:
  // Edge 0 (between pt 0 and pt 1) has midpoint:
  const mid0x = (hexPts[0].x + hexPts[1].x) / 2;
  const mid0y = (hexPts[0].y + hexPts[1].y) / 2;
  // Opposing edge is Edge 3 (between pt 3 and pt 4):
  const mid3x = (hexPts[3].x + hexPts[4].x) / 2;
  const mid3y = (hexPts[3].y + hexPts[4].y) / 2;
  return Math.hypot(mid0x - mid3x, mid0y - mid3y);
}

/**
 * Compute the frustum chamfer angle for a countersink screw
 * @param {number} headDiameter
 * @param {number} shankDiameter
 * @param {number} headDepth
 * @returns {number} Chamfer angle relative to axis in degrees
 */
export function computeCountersinkChamferAngle(headDiameter, shankDiameter, headDepth) {
  const deltaR = (headDiameter - shankDiameter) / 2;
  // Angle relative to horizontal: atan2(headDepth, deltaR)
  // Angle relative to vertical axis (frustum slope): atan2(deltaR, headDepth)
  const slopeRad = Math.atan2(deltaR, headDepth);
  return Number(((slopeRad * 180) / Math.PI).toFixed(2));
}
