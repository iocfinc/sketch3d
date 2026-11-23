/**
 * SKETCH3D — WASM CSG Kernel (manifold-3d Integration)
 * ====================================================
 * High-performance, watertight boolean operations, polygon extrusion,
 * plane slicing, and Three.js geometry bidirectional conversion.
 * Enforces explicit .delete() memory management to prevent WASM heap leaks.
 */

import Module from '../vendor/manifold.js';

let wasmModule = null;
let initPromise = null;

/**
 * Initialize the manifold-3d WASM runtime
 * @returns {Promise<any>}
 */
export async function initCsg() {
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  initPromise = Module({
    locateFile: (path, prefix) => {
      if (path.endsWith('.wasm')) {
        // Resolve relative to module location in browser or node
        return new URL('../vendor/' + path, import.meta.url).href;
      }
      return prefix + path;
    },
  }).then((m) => {
    m.setup();
    wasmModule = m;
    return m;
  });

  return initPromise;
}

/**
 * Synchronous accessor for initialized WASM module
 * @returns {any|null}
 */
export function getCsg() {
  return wasmModule;
}

/**
 * Resource tracker to ensure zero WASM memory leaks
 */
export class CsgScope {
  constructor() {
    this.instances = new Set();
  }

  /**
   * Track a Manifold or CrossSection instance for automated disposal
   * @template T
   * @param {T} instance
   * @returns {T}
   */
  track(instance) {
    if (instance && typeof instance.delete === 'function') {
      this.instances.add(instance);
    }
    return instance;
  }

  /**
   * Release an instance from tracking (e.g. When returning to caller)
   * @template T
   * @param {T} instance
   * @returns {T}
   */
  keep(instance) {
    if (instance) {
      this.instances.delete(instance);
    }
    return instance;
  }

  /**
   * Delete all tracked instances immediately
   */
  dispose() {
    for (const inst of this.instances) {
      try {
        if (!inst.isDeleted || !inst.isDeleted()) {
          inst.delete();
        }
      } catch (_) {
        // Ignore deletion errors on already freed pointers
      }
    }
    this.instances.clear();
  }
}

/**
 * Run a scoped operation that automatically disposes all untracked intermediates
 * @template R
 * @param {(scope: CsgScope, csg: any) => R} fn
 * @returns {Promise<R>}
 */
export async function withCsgScope(fn) {
  const csg = await initCsg();
  const scope = new CsgScope();
  try {
    return await fn(scope, csg);
  } finally {
    scope.dispose();
  }
}

/**
 * Synchronous scoped operation for when CSG module is already initialized
 * @template R
 * @param {(scope: CsgScope, csg: any) => R} fn
 * @returns {R}
 */
export function withCsgScopeSync(fn) {
  const csg = getCsg();
  if (!csg) {
    throw new Error('CSG kernel not initialized. Call await initCsg() first.');
  }
  const scope = new CsgScope();
  try {
    return fn(scope, csg);
  } finally {
    scope.dispose();
  }
}

/**
 * Create a 3D Manifold solid by extruding a 2D closed polygon
 * @param {Array<{x: number, y: number}>} points
 * @param {number} height
 * @param {CsgScope} [scope]
 * @returns {any} Manifold instance
 */
export function createExtrudedSolid(points, height, scope = null) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const polyArray = points.map((p) => [p.x, p.y]);
  const cs = csg.CrossSection.ofPolygons([polyArray]);
  const solid = csg.Manifold.extrude(cs, height);
  cs.delete();

  if (scope) scope.track(solid);
  return solid;
}

/**
 * Create a cylinder Manifold
 * @param {number} radius
 * @param {number} height
 * @param {number} [segments=32]
 * @param {CsgScope} [scope]
 * @returns {any} Manifold instance
 */
export function createCylinderSolid(radius, height, segments = 32, scope = null) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const cyl = csg.Manifold.cylinder(height, radius, radius, segments);
  if (scope) scope.track(cyl);
  return cyl;
}

/**
 * Create a captive regular hex-nut pocket solid
 * @param {number} cx
 * @param {number} cy
 * @param {number} acrossFlats
 * @param {number} depth
 * @param {CsgScope} [scope]
 * @returns {any} Manifold instance
 */
export function createHexNutSolid(cx, cy, acrossFlats, depth, scope = null) {
  const csg = getCsg();
  if (!csg) throw new Error('CSG kernel not initialized');

  const radius = acrossFlats / Math.sqrt(3);
  const hexPts = [];
  for (let i = 0; i < 6; i++) {
    const rad = ((30 + i * 60) * Math.PI) / 180;
    hexPts.push([cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]);
  }

  const cs = csg.CrossSection.ofPolygons([hexPts]);
  const solid = csg.Manifold.extrude(cs, depth);
  cs.delete();

  if (scope) scope.track(solid);
  return solid;
}

/**
 * Convert a Manifold instance into a Three.js BufferGeometry
 * @param {any} manifold
 * @param {any} [THREE]
 * @returns {any} THREE.BufferGeometry
 */
export function manifoldToThreeGeometry(manifold, THREE = globalThis.THREE) {
  if (!manifold || manifold.isEmpty()) {
    return new THREE.BufferGeometry();
  }

  const mesh = manifold.getMesh();
  const geometry = new THREE.BufferGeometry();

  // Position buffer from vertProperties
  // Mesh vertProperties is a flat array with mesh.numProp floats per vertex
  const numVerts = mesh.numVert;
  const numProp = mesh.numProp || 3;
  const positions = new Float32Array(numVerts * 3);

  for (let i = 0; i < numVerts; i++) {
    positions[i * 3 + 0] = mesh.vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Index buffer from triVerts (Uint32Array)
  if (mesh.triVerts && mesh.triVerts.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  }

  geometry.computeVertexNormals();
  return geometry;
}
