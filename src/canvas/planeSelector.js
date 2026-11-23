/**
 * SKETCH3D — Multi-Plane Sketching Coordinate Frames & Plane Selector
 * ====================================================================
 * Manages standard datum planes (Top XY, Front XZ, Right YZ) and custom planar
 * face projections. Provides bidirectional 2D (u, v) <-> 3D (x, y, z) conversions,
 * raycast plane intersections, and column-major transformation matrices for Three.js
 * and Manifold-3D WASM solids.
 */

/**
 * Standard Datum Plane Definitions
 * Column-major 4x4 matrix layout matching Three.js Matrix4 and Manifold-3d
 */
export const DATUM_PLANES = {
  XY: {
    id: 'XY',
    label: 'Top (XY)',
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    normal: [0, 0, 1],
    // Column-major: Col0=U, Col1=V, Col2=N, Col3=O
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
  },
  XZ: {
    id: 'XZ',
    label: 'Front (XZ)',
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    normal: [0, -1, 0],
    // Col0=U([1,0,0]), Col1=V([0,0,1]), Col2=N([0,-1,0]), Col3=O([0,0,0])
    matrix: [
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ],
  },
  YZ: {
    id: 'YZ',
    label: 'Right (YZ)',
    origin: [0, 0, 0],
    uAxis: [0, 1, 0],
    vAxis: [0, 0, 1],
    normal: [1, 0, 0],
    // Col0=U([0,1,0]), Col1=V([0,0,1]), Col2=N([1,0,0]), Col3=O([0,0,0])
    matrix: [
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ],
  },
};

/**
 * Construct an orthonormal basis and 4x4 column-major matrix for a planar face
 * @param {number[]} origin [x, y, z] center of face
 * @param {number[]} normal [nx, ny, nz] outward unit normal
 * @param {number[]} [uHint] Optional hint vector for U axis alignment
 * @returns {Object} Plane definition object
 */
export function createCustomPlane(origin, normal, uHint = null) {
  // Normalize normal
  const nLen = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n = [normal[0] / nLen, normal[1] / nLen, normal[2] / nLen];

  // Pick reference vector for cross product
  let ref = uHint ? [...uHint] : [0, 0, 1];
  if (Math.abs(n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2]) > 0.95) {
    ref = [0, 1, 0];
    if (Math.abs(n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2]) > 0.95) {
      ref = [1, 0, 0];
    }
  }

  // U = normalize(ref x N)
  let u = [
    ref[1] * n[2] - ref[2] * n[1],
    ref[2] * n[0] - ref[0] * n[2],
    ref[0] * n[1] - ref[1] * n[0],
  ];
  const uLen = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / uLen, u[1] / uLen, u[2] / uLen];

  // V = N x U
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];

  // Column-major 4x4 matrix
  const matrix = [
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    n[0], n[1], n[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];

  return {
    id: 'CUSTOM',
    label: `Custom Face @ [${origin.map(v => Math.round(v)).join(',')}]`,
    origin: [...origin],
    uAxis: u,
    vAxis: v,
    normal: n,
    matrix,
  };
}

/**
 * Transform 2D plane coordinates (u, v) + optional offset (w) into 3D world coordinates
 * @param {number} u Plane U coordinate (mm)
 * @param {number} v Plane V coordinate (mm)
 * @param {Object} plane Plane definition object
 * @param {number} [w=0] Distance along plane normal (mm)
 * @returns {{x: number, y: number, z: number}}
 */
export function planeToWorld(u, v, plane, w = 0) {
  const o = plane.origin;
  const uA = plane.uAxis;
  const vA = plane.vAxis;
  const nA = plane.normal;

  return {
    x: o[0] + u * uA[0] + v * vA[0] + w * nA[0],
    y: o[1] + u * uA[1] + v * vA[1] + w * nA[1],
    z: o[2] + u * uA[2] + v * vA[2] + w * nA[2],
  };
}

/**
 * Project 3D world coordinates into the 2D coordinate frame of the plane
 * @param {number} x World X (mm)
 * @param {number} y World Y (mm)
 * @param {number} z World Z (mm)
 * @param {Object} plane Plane definition object
 * @returns {{u: number, v: number, w: number}}
 */
export function worldToPlane(x, y, z, plane) {
  const dx = x - plane.origin[0];
  const dy = y - plane.origin[1];
  const dz = z - plane.origin[2];

  const u = dx * plane.uAxis[0] + dy * plane.uAxis[1] + dz * plane.uAxis[2];
  const v = dx * plane.vAxis[0] + dy * plane.vAxis[1] + dz * plane.vAxis[2];
  const w = dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2];

  return { u, v, w };
}

/**
 * Raycast a 3D ray against a plane to find the intersection point
 * @param {number[]} rayOrigin [x, y, z]
 * @param {number[]} rayDir [dx, dy, dz] normalized ray direction
 * @param {Object} plane Plane definition object
 * @returns {{hit: boolean, pointWorld: {x: number, y: number, z: number}|null, pointPlane: {u: number, v: number}|null, t: number}}
 */
export function raycastPlane(rayOrigin, rayDir, plane) {
  const norm = plane.normal;
  const denom = rayDir[0] * norm[0] + rayDir[1] * norm[1] + rayDir[2] * norm[2];

  // If ray is virtually parallel to plane, no intersection
  if (Math.abs(denom) < 1e-6) {
    return { hit: false, pointWorld: null, pointPlane: null, t: Infinity };
  }

  const ox = plane.origin[0] - rayOrigin[0];
  const oy = plane.origin[1] - rayOrigin[1];
  const oz = plane.origin[2] - rayOrigin[2];

  const t = (ox * norm[0] + oy * norm[1] + oz * norm[2]) / denom;

  if (t < 0) {
    // Plane is behind the ray origin
    return { hit: false, pointWorld: null, pointPlane: null, t };
  }

  const worldX = rayOrigin[0] + t * rayDir[0];
  const worldY = rayOrigin[1] + t * rayDir[1];
  const worldZ = rayOrigin[2] + t * rayDir[2];

  const { u, v } = worldToPlane(worldX, worldY, worldZ, plane);

  return {
    hit: true,
    pointWorld: { x: worldX, y: worldY, z: worldZ },
    pointPlane: { u, v },
    t,
  };
}

/**
 * Transform a Manifold solid into the target plane coordinate system
 * @param {any} solid Manifold instance
 * @param {Object} plane Target plane
 * @returns {any} New transformed Manifold instance
 */
export function transformSolidToPlane(solid, plane) {
  if (!solid || !plane || !plane.matrix) return solid;
  return solid.transform(plane.matrix);
}

/**
 * Transform a Three.js BufferGeometry to match the target plane
 * @param {any} geometry Three.js BufferGeometry
 * @param {Object} plane Target plane
 * @param {any} [THREE] Global or passed THREE namespace
 */
export function transformGeometryToPlane(geometry, plane, THREE = globalThis.THREE) {
  if (!geometry || !plane || !plane.matrix || !THREE) return;
  const mat = new THREE.Matrix4();
  mat.fromArray(plane.matrix);
  geometry.applyMatrix4(mat);
}
