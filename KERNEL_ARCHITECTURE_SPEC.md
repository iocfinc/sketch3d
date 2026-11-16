# Technical Specification: Geometry Kernel & Computation Pipeline (Phases 2 & 3)

**Host Application:** Sketch3D (100% Client-Side WebGL / Three.js / Web Workers)  
**Target Platform:** iPad (Safari WebKit / Apple Pencil & Touch), iPhone, Desktop  
**Target 3D Printer:** Bambu Lab A1 (`256 × 256 × 256 mm` build envelope, `0.4 mm` standard nozzle)  
**Assigned Owner:** @kernel-lead

---

## 1. Executive Summary & Core Requirements

This blueprint specifies the high-performance client-side geometry kernel for Sketch3D Phase 2 (NURBS Lofting, Watertight WASM Booleans, and Multi-color .3MF Export) and Phase 3 (Procedural Surface Textures, Voronoi Lattices, and Mesh Displacement).

All computation runs strictly client-side within the browser:
- Zero backend servers, zero API latency, zero ongoing hosting costs ($0 deployment on GitHub Pages).
- Main-thread responsiveness on iPad Safari (60–120 fps) maintained via dedicated Web Worker offloading.
- Guaranteed watertight, 2-manifold STL and 3MF output ready for slicing in Bambu Studio or OrcaSlicer.

---

## 2. Watertight Booleans & WASM Integration

### 2.1 Web Worker Isolation & Zero-Copy Architecture
Mobile Safari imposes strict single-threaded UI constraints and thermal/memory limits. Executing Constructive Solid Geometry (CSG) directly on the main thread leads to visible frame drops, input latency, and WebKit watchdog terminations.

To eliminate main-thread blocking, [`manifold-3d`](https://www.npmjs.com/package/manifold-3d) (the high-performance C++ manifold boolean library compiled to WebAssembly via Emscripten) runs inside a dedicated Web Worker (`manifold.worker.ts`). Communication between the Three.js viewport and the worker utilizes Transferable ArrayBuffers (`Float32Array` positions/normals and `Uint32Array` triangle index buffers), achieving zero-copy transfers across thread boundaries.

```
+-------------------------------------------------------------+
| Main Thread (Safari UI / Three.js Render Loop / 60-120 fps) |
+-------------------------------------------------------------+
        |                                            ^
        | postMessage(req, [buffers])               | postMessage(res, [buffers])
        v                                            |
+-------------------------------------------------------------+
| Web Worker (manifold.worker.ts)                             |
|  - Manifold-3D WebAssembly Instance (Emscripten / C++)      |
|  - Mesh serialization / deserialization                     |
|  - Fast CSG: Union, Difference, Intersection                |
|  - Polygon triangulation & manifold verification            |
+-------------------------------------------------------------+
```

### 2.2 Worker RPC Message Schema
```typescript
export type ManifoldOpType = 'UNION' | 'DIFFERENCE' | 'INTERSECT' | 'EXTRUDE' | 'LOFT_BOOLEAN';

export interface SerializedMesh {
  vertProperties: Float32Array; // Stride = 6: [x, y, z, nx, ny, nz, ...]
  triVerts: Uint32Array;        // Triangle vertex index triplets [v0, v1, v2, ...]
  numProp: number;              // 6
}

export interface WorkerRequest {
  id: string;
  type: 'BOOLEAN';
  op: ManifoldOpType;
  primary: SerializedMesh;
  secondaries: SerializedMesh[]; // Cutouts, mounting holes, or intersecting bodies
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  resultMesh?: SerializedMesh;
  stats?: {
    numTriangles: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    isManifold: boolean;
    genus: number;
    computeTimeMs: number;
  };
  error?: string;
}
```

### 2.3 WASM Module Initialization & Memory Management
```typescript
import Module from 'manifold-3d';

let wasmManifold: any = null;

export async function initManifold(): Promise<any> {
  if (wasmManifold) return wasmManifold;
  wasmManifold = await Module({
    locateFile: (path: string) => `./wasm/${path}`
  });
  wasmManifold.setup();
  return wasmManifold;
}

// Memory Safety on Mobile WebKit:
// Every intermediate C++ Manifold object must be explicitly deallocated using .delete()
// to prevent memory growth and Safari tab eviction:
export function executeDifference(primaryMesh: any, cutoutMesh: any): any {
  const m1 = new wasmManifold.Manifold(primaryMesh);
  const m2 = new wasmManifold.Manifold(cutoutMesh);
  const result = wasmManifold.difference(m1, m2);
  m1.delete();
  m2.delete();
  return result;
}
```

---

## 3. Multi-Section NURBS Lofting

### 3.1 Mathematical Pipeline
Given $K \ge 2$ closed planar cross-sections $C_0(u), C_1(u), \dots, C_{K-1}(u)$ positioned at elevations $z_0 < z_1 < \dots < z_{K-1}$ (or along an arbitrary 3D guide spine):

#### 1. Uniform Arc-Length Reparameterization
Users sketch polygons with arbitrary vertex counts and uneven edge lengths. To construct a consistent control net, each cross-section is resampled to $N = 128$ points spaced uniformly by cumulative arc length:
$$s_i = \sum_{j=1}^i \|P_j - P_{j-1}\|, \quad u_i = \frac{s_i}{s_{\text{total}}}$$

#### 2. Topological Phase Alignment (Anti-Twist Optimization)
Lofting between rotated or dissimilar profiles (e.g., rounded rectangle to star) causes severe self-intersecting twist if the starting vertices ($u=0$) are misaligned. The optimal cyclic index shift $m^*$ minimizes total squared chord distance:
$$\min_{0 \le m < N} \sum_{i=0}^{N-1} \|C_k(u_{(i+m) \pmod N}) - C_{k-1}(u_i)\|^2$$
Cyclically permuting the vertex array by $m^*$ aligns seam lines smoothly across all layers.

#### 3. Tensor-Product B-Spline Surface Interpolation
Using `verb-nurbs` (`verb.geom.NurbsSurface.byLofting`):
- **$u$-direction (Around section perimeter):** Periodic closed cubic B-spline of degree $p = 3$.
- **$v$-direction (Along vertical loft axis):** Open clamped B-spline of degree $q = 3$ (or linear $q=1$ for ruled facets) passing through section elevations $z_k$.
- The evaluated surface points are:
  $$S(u, v) = \frac{\sum_{i=0}^n \sum_{j=0}^m N_{i,p}(u) N_{j,q}(v) w_{i,j} P_{i,j}}{\sum_{i=0}^n \sum_{j=0}^m N_{i,p}(u) N_{j,q}(v) w_{i,j}}$$

#### 4. Watertight Solid Capping & Topology Validation
- **Bottom cap ($v=0$):** Ear-clipping triangulation (via `earcut`) with reversed face winding.
- **Top cap ($v=1$):** Ear-clipping triangulation with standard counter-clockwise winding.
- **Index welding:** Cap perimeter vertices directly reuse boundary vertices of the lofted tubular surface.
- Passing the combined mesh to `manifold-3d` verifies the Euler characteristic:
  $$\chi = V - E + F = 2(1 - g) = 2 \quad (\text{for genus-0 solid})$$

---

## 4. 3MF File Export & Bambu AMS Lite Multi-Color Architecture

### 4.1 Advantages of 3MF over Binary STL
- **Binary STL:** Unindexed face soup (3 floating-point vertices repeated per triangle, $50\text{ bytes/triangle}$), no units defined, no color/material metadata, zero topology verification.
- **3MF (3D Manufacturing Format):** OPC/ZIP container containing structured XML. Preserves exact indexed vertex topology (shared vertices), explicitly declares `unit="millimeter"`, and supports multi-material color assignment natively recognized by Bambu Studio and OrcaSlicer.

### 4.2 3MF Package File Structure
```
[Content_Types].xml
_rels/.rels
3D/
  3dmodel.model
Metadata/
  model_settings.config (Bambu Studio preset flags)
```

### 4.3 Bambu AMS Lite 4-Color Grouping Specification (`3dmodel.model`)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" 
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
       xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <resources>
    <!-- Map to Bambu AMS Lite Slots 1-4 matching Sketch3D brand palette -->
    <m:colorgroup id="1">
      <m:color color="#FEFF00" /> <!-- Slot 1: Brand Yellow (Main Body / Plate) -->
      <m:color color="#FF66D9" /> <!-- Slot 2: Brand Pink (Holes / Stand-offs) -->
      <m:color color="#73E6F1" /> <!-- Slot 3: Brand Cyan (Internal Cutouts / Ribs) -->
      <m:color color="#00E56D" /> <!-- Slot 4: Brand Green (Snap-Fit Joints / Base) -->
    </m:colorgroup>
    <object id="2" type="model">
      <mesh>
        <vertices>
          <!-- Coordinate transform: Three.js Y-up (x, y, z) -> 3MF Z-up (x, -z, y) -->
          <vertex x="10.0" y="-5.0" z="0.0" />
          <vertex x="20.0" y="-5.0" z="0.0" />
          <vertex x="20.0" y="15.0" z="0.0" />
          <vertex x="10.0" y="15.0" z="0.0" />
        </vertices>
        <triangles>
          <!-- pid="1" links to colorgroup 1; p1 assigns filament color slot -->
          <triangle v1="0" v2="1" v3="2" pid="1" p1="0" />
          <triangle v1="2" v2="3" v3="0" pid="1" p1="2" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>
```

### 4.4 In-Memory Fast Streaming Compression (`fflate`)
```typescript
import { zipSync, strToU8 } from 'fflate';

export function create3MFBuffer(modelXml: string, contentTypesXml: string, relsXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(relsXml),
    '3D/3dmodel.model': strToU8(modelXml)
  });
}
```

---

## 5. Procedural Surface Textures (Phase 3)

### 5.1 Conformal Normal Displacement Pipeline
For any parametric or lofted surface $S(u, v)$, compute tangent vectors and unit surface normal:
$$\mathbf{T}_u = \frac{\partial S}{\partial u}, \quad \mathbf{T}_v = \frac{\partial S}{\partial v}, \quad \mathbf{n}(u, v) = \frac{\mathbf{T}_u \times \mathbf{T}_v}{\|\mathbf{T}_u \times \mathbf{T}_v\|}$$

Vertices are displaced along the normal field:
$$\mathbf{P}'(u, v) = \mathbf{P}(u, v) + d(u, v) \cdot \mathbf{n}(u, v)$$

### 5.2 Procedural Texture Implementations

#### 1. Diamond Knurling (EDC Grips, Knobs, Tool Handles)
$$d_{\text{diamond}}(u, v) = A \cdot \left| \sin\left(\frac{2\pi u}{\lambda_u} + \frac{2\pi v}{\lambda_v}\right) \cdot \sin\left(\frac{2\pi u}{\lambda_u} - \frac{2\pi v}{\lambda_v}\right) \right|$$
- **Amplitude:** $0.4 \le A \le 1.2\text{ mm}$ (enforces minimum printable depth).
- **Pitch / Wavelength:** $\lambda_u, \lambda_v \ge 2.5\text{ mm}$ (guarantees resolving clean pyramids on standard $0.4\text{ mm}$ nozzle).

#### 2. Ribbed / Fin Knurling (Architectural Lamp Shades, Heatsinks)
$$d_{\text{rib}}(u, v) = \frac{A}{2} \cdot \left(1 + \cos\left(\frac{2\pi u}{\lambda_u}\right)\right)$$
- Produces smooth vertical fluting suitable for vase-mode or single-perimeter printing.

#### 3. Conformal Voronoi Lattices (Weight-Reduction & Organic Lamps)
1. **Sampling:** Poisson disk sampling of seed points $(u_i, v_i) \in [0, 1]^2$ with periodic boundary condition along $u$.
2. **Metric Compensation:** Compensate parameter-space distances by the surface metric tensor $g_{ij} = \mathbf{T}_i \cdot \mathbf{T}_j$ to maintain isotropic cell size across tapered surfaces.
3. **Cell Insetting:** Inset Voronoi polygons by strut width $w \ge 1.2\text{ mm}$.
4. **Solid Subtraction:** Convert 2D cells to 3D prism cutters and execute difference via `manifold-3d` worker.

---

## 6. Dependency Manifest & Performance Budget

| Dependency | Version | Gzip Bundle Impact | Execution Context | Role |
| :--- | :--- | :--- | :--- | :--- |
| `manifold-3d` | `^3.0.1` | ~380 KB (WASM) | Web Worker | Guaranteed watertight booleans & mesh verification |
| `verb-nurbs` | `^0.2.1` | ~45 KB | Web Worker / Main | Mathematical NURBS curves & lofted surface evaluation |
| `fflate` | `^0.8.2` | ~8 KB | Main / Exporter | Ultra-fast synchronous/worker ZIP packaging for `.3MF` |
| `earcut` | `^2.2.4` | ~3 KB | Web Worker | Planar polygon triangulation for loft end-caps |

**Performance Guardrails on iPadOS Safari:**
- Peak worker memory budget $\le 128\text{ MB}$.
- CSG boolean computation time $\le 450\text{ ms}$ for typical geometries ($< 25,000$ triangles).
- 3MF export packaging time $\le 250\text{ ms}$.
- Main thread frame rate maintained at $60\text{ fps}$ continuous during worker computation.
