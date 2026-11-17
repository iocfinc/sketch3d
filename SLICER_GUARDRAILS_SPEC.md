# SKETCH3D — Bambu Lab A1 Hardware Integration & Printability Guardrails Specification

**Document Version:** 1.0.0  
**Status:** Approved for Implementation  
**Target Printer:** Bambu Lab A1 (Build Volume: 256 × 256 × 256 mm³, 0.4 mm Standard Hardened/Stainless Nozzle, Textured PEI Plate)  
**Host Application:** Sketch3D (100% Client-Side WebGL / Three.js / Web Workers / PWA)  
**Author:** `@slicer-guardrails`  
**Related Specs:** [HANDOVER_SPEC.md](./HANDOVER_SPEC.md), [UX_ARCHITECTURE_SPEC.md](./UX_ARCHITECTURE_SPEC.md)

---

## Executive Summary

This document establishes the hardware integration rules, real-time printability analysis algorithms, slicer configuration profiles, and mechanical tolerance standards for **Sketch3D**. Its primary purpose is to guarantee that every 2D/3D model authored within Sketch3D on an iPad, iPhone, or desktop web browser transitions seamlessly to a **Bambu Lab A1** 3D printer without geometry slicing failures, wall delaminations, collapsed overhangs, or dimensional fit errors.

---

## 1. Printability Guardrails & Real-Time Geometry Analysis

### 1.1 Minimum Wall Thickness Detection (< 0.8 mm Flagging)

#### 1.1.1 Physical & Slicing Rationale
The standard Bambu Lab A1 nozzle diameter is **$0.40\text{ mm}$**. In modern slicers (Bambu Studio / OrcaSlicer using the Arachne or Classic perimeter generator):
* Standard perimeter extrusion line width: **$0.42\text{ mm}$** (outer wall), **$0.45\text{ mm}$** (inner wall).
* Minimum reliable shell thickness: **2 perimeter passes ($2 \times 0.42\text{ mm} = 0.84\text{ mm}$)**.
* Any geometry with physical thickness below **$0.80\text{ mm}$**:
  1. Causes toolpath dropouts where the slicer refuses to generate G-code paths.
  2. Degrades into fragile, single-walled beads prone to inter-layer splitting and buckling under nominal loading.
  3. Fails water-tightness and structural integrity checks.

#### 1.1.2 Dual-Tier Analysis Architecture
To provide responsive visual feedback without freezing the WebKit 60/120 FPS rendering thread on mobile Safari, analysis is split into two complementary tiers:

```
+-----------------------------------------------------------------------------------+
| Tier 1: 2D Pre-Extrusion Segment Proximity (Main Thread / Continuous at 60 FPS)   |
|   - Point-to-segment Euclidean distance                                           |
|   - Segment-to-segment clearance check                                            |
|   - Outer perimeter to internal hole boundary margin (>= 1.2 mm)                  |
|   - Immediate pulsating warning line on canvas                                    |
+-----------------------------------------------------------------------------------+
                                          |
                                          v (User pauses sketch or modifies 3D parameters)
+-----------------------------------------------------------------------------------+
| Tier 2: 3D Raymarch / BVH Mesh Thickness Analysis (Web Worker / Transferable)     |
|   - Inward normal raycasting using three-mesh-bvh                                 |
|   - Opposite wall penetration distance calculation                                |
|   - Color-coded vertex attribute buffer (Red < 0.8 mm, Amber 0.8–1.2 mm, Safe)     |
+-----------------------------------------------------------------------------------+
```

#### 1.1.3 Tier 1 Algorithm: 2D Segment Proximity Verification
Let polygon vertices be $P = [p_0, p_1, \dots, p_{n-1}]$ and cutout polygons be $C_k = [c_{k,0}, c_{k,1}, \dots, c_{k,m-1}]$.
For each segment $S_a = (u_0, u_1)$ and non-adjacent segment $S_b = (v_0, v_1)$:
1. Parameterize segments:
   $$A(s) = u_0 + s(u_1 - u_0), \quad s \in [0, 1]$$
   $$B(t) = v_0 + t(v_1 - v_0), \quad t \in [0, 1]$$
2. Find minimum distance $\delta = \min_{s, t \in [0, 1]} \|A(s) - B(t)\|$.
3. If $\delta < 0.80\text{ mm}$:
   - Mark segment pair in the warning queue.
   - Render dynamic caution stroke (`#FF3344`, 2.5 px with pulsing alpha) over the sketch canvas.

For circular cutout holes (e.g. M3/M4 mounting holes with center $O_h$ and radius $R_h$):
1. Compute shortest distance from $O_h$ to all boundary segments $S_a$:
   $$d_{\text{edge}} = \text{dist}(O_h, S_a) - R_h$$
2. Enforce constraint:
   $$d_{\text{edge}} \ge 1.20\text{ mm} \quad (\text{Critical failure if } d_{\text{edge}} < 0.80\text{ mm})$$

#### 1.1.4 Tier 2 Algorithm: 3D Inward Normal Raycasting (BVH)
Implemented inside the geometry worker (`src/workers/printability.worker.ts`):
```typescript
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import * as THREE from 'three';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export function evaluateMeshThickness(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  minThresholdMm = 0.8,
  warnThresholdMm = 1.2
): Float32Array {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));

  const bvh = new MeshBVH(geom);
  const vertexCount = positions.length / 3;
  // Status buffer: 0.0 = Safe, 0.5 = Warning (0.8 - 1.2mm), 1.0 = Critical (< 0.8mm)
  const statusBuffer = new Float32Array(vertexCount);

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    origin.set(positions[idx], positions[idx + 1], positions[idx + 2]);
    // Cast inward along inverted surface normal
    dir.set(-normals[idx], -normals[idx + 1], -normals[idx + 2]).normalize();

    // Small bias along inverted normal to prevent self-intersection with source face
    origin.addScaledVector(dir, 0.01);
    raycaster.set(origin, dir);

    const hit = bvh.raycastFirst(raycaster.ray);
    if (hit) {
      const thickness = hit.distance + 0.01;
      if (thickness < minThresholdMm) {
        statusBuffer[i] = 1.0; // Critical
      } else if (thickness < warnThresholdMm) {
        statusBuffer[i] = 0.5; // Caution
      } else {
        statusBuffer[i] = 0.0; // Safe
      }
    } else {
      statusBuffer[i] = 0.0;
    }
  }

  return statusBuffer;
}
```

---

### 1.2 Overhang Angle Warning Shader (Three.js WebGL)

#### 1.2.1 FDM Kinematics & Cooling Physics
On the Bambu Lab A1:
* The toolhead is equipped with a high-RPM centrifugal part-cooling blower feeding dual directed air ducts on both sides of the nozzle.
* **Overhang Capabilities at 0.20 mm Layer Height:**
  * **$0^\circ - 45^\circ$ Overhang:** Completely self-supporting; pristine surface finish.
  * **$45^\circ - 60^\circ$ Overhang:** Printable with minor stepping artifacts; automatically slowed down by Bambu Studio overhang speed curves ($30 - 50\text{ mm/s}$).
  * **$> 60^\circ$ Overhang:** Molten filament droops due to gravity pulling beads into open air without adequate under-layer support. Requires **Tree (auto) / Slim supports** or design modification.
  * **$90^\circ$ Overhang (Horizontal Ceilings):** Printable as a straight bridge only if supported on both anchor sides across spans $< 50\text{ mm}$; completely fails if unsupported (cantilever).

#### 1.2.2 Normal Vector Coordinate Mapping
In Three.js, following `geometry.rotateX(-Math.PI / 2)`:
* Build plate surface = $XZ$ plane ($Y = 0$).
* Vertical print growth axis = $+Y$ ($Z_{\text{printer}}$).
* Downward gravity vector: $\mathbf{u}_{\text{down}} = (0, -1, 0)$.

Let unit world normal be $\mathbf{n} = (n_x, n_y, n_z)$:
* Upward faces: $n_y \ge 0$ (no overhang).
* Downward faces: $n_y < 0$.
* Overhang angle from vertical:
  $$\cos \theta_{\text{vert}} = -n_y = |\mathbf{n} \cdot \mathbf{u}_{\text{down}}|$$
* Angle from horizontal build plate:
  $$\alpha_{\text{plate}} = 90^\circ - \arccos(-n_y)$$
* Angle thresholds:
  * $\alpha_{\text{plate}} > 45^\circ \iff -n_y < \cos(45^\circ) \approx 0.7071$ (Safe / printable without support).
  * $30^\circ < \alpha_{\text{plate}} \le 45^\circ \iff 0.7071 \le -n_y < 0.8660$ (Caution / amber).
  * $\alpha_{\text{plate}} \le 30^\circ \iff -n_y \ge 0.8660$ (Critical / red / support mandatory).
  * $\alpha_{\text{plate}} \approx 0^\circ \iff -n_y \ge 0.98$ (Horizontal ceiling / deep crimson).

#### 1.2.3 Complete GLSL ShaderMaterial Implementation
```typescript
import * as THREE from 'three';

export function createOverhangInspectionMaterial(baseMeshColor = 0xFF66D9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor:   { value: new THREE.Color(baseMeshColor) },
      uSafeColor:   { value: new THREE.Color(0x00E56D) }, // Bambu Green
      uWarnColor:   { value: new THREE.Color(0xFEFF00) }, // Yellow
      uDangerColor: { value: new THREE.Color(0xFF3344) }, // Red
      uBridgeColor: { value: new THREE.Color(0x7A0010) }, // Crimson
      uLightDir:    { value: new THREE.Vector3(0.4, 0.9, 0.5).normalize() },
      uInspectorActive: { value: 1.0 }
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uBaseColor;
      uniform vec3 uSafeColor;
      uniform vec3 uWarnColor;
      uniform vec3 uDangerColor;
      uniform vec3 uBridgeColor;
      uniform vec3 uLightDir;
      uniform float uInspectorActive;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vWorldNormal);
        float diff = max(dot(N, uLightDir), 0.25);
        vec3 col = uBaseColor;

        if (uInspectorActive > 0.5) {
          float ny = N.y; // Y is build axis in Three.js rotated coordinate space
          if (ny < -0.01) {
            float cosDown = -ny; // 0.0 (vertical) to 1.0 (horizontal ceiling)
            if (cosDown >= 0.98) {
              // True horizontal ceiling
              col = uBridgeColor;
            } else if (cosDown >= 0.8660) {
              // Overhang angle > 60° (slope <= 30° from bed): Severe overhang
              col = uDangerColor;
            } else if (cosDown >= 0.7071) {
              // Overhang angle 45° to 60°: Warning zone
              float t = (cosDown - 0.7071) / (0.8660 - 0.7071);
              col = mix(uWarnColor, uDangerColor, t);
            } else {
              // Overhang 0° to 45°: Printable without support
              float t = cosDown / 0.7071;
              col = mix(uSafeColor, uWarnColor, t);
            }
          }
        }

        gl_FragColor = vec4(col * diff, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });
}
```

---

## 2. Bambu Lab Slicer Alignment

### 2.1 Bambu Studio & OrcaSlicer Process Profile Standards

Sketch3D generates 3MF packages and STL files tailored to the default Bambu Lab A1 configuration profiles:

```json
{
  "profile_name": "0.20mm Standard @Bambu A1",
  "printer_model": "Bambu Lab A1 0.4 nozzle",
  "print_settings": {
    "layer_height": 0.20,
    "first_layer_height": 0.20,
    "wall_loops": 3,
    "top_shell_layers": 5,
    "bottom_shell_layers": 4,
    "top_shell_thickness": 1.0,
    "bottom_shell_thickness": 0.8,
    "line_widths": {
      "default": 0.45,
      "outer_wall": 0.42,
      "inner_wall": 0.45,
      "top_surface": 0.42,
      "first_layer": 0.50,
      "sparse_infill": 0.45
    },
    "sparse_infill_pattern": "gyroid",
    "sparse_infill_density": "15%",
    "infill_combination": false,
    "speed": {
      "outer_wall": 150,
      "inner_wall": 250,
      "sparse_infill": 300,
      "travel": 500,
      "first_layer": 50,
      "first_layer_infill": 105
    },
    "acceleration": {
      "default": 10000,
      "outer_wall": 5000,
      "inner_wall": 10000,
      "travel": 10000
    }
  }
}
```

---

### 2.2 Volumetric Mass Calculation (Rigorous Sliced Model)

#### 2.2.1 Limitation of Legacy Heuristics
The initial prototype calculated weight as `volCm3 * 1.24 * 0.35`. This uniformly applied a 35% density factor across the entire geometry, resulting in:
* **Small / Thin Shells:** Mass underestimated by up to 40% because perimeters dominate total volume and are 100% dense.
* **Large Bulky Blocks:** Mass overestimated by up to 50% because the inner 15% infill core dominates.

#### 2.2.2 Decomposed Shell-Core Mathematical Formulation
1. **Total Watertight Solid Volume ($V_{\text{solid}}$):**
   Computed by summing signed tetrahedra formed by each mesh triangle with the origin:
   $$V_{\text{solid}} = \frac{1}{6} \left| \sum_{i=1}^{T} (\mathbf{v}_{i,1} \times \mathbf{v}_{i,2}) \cdot \mathbf{v}_{i,3} \right|$$

2. **Total Surface Area ($A_{\text{total}}$):**
   $$A_{\text{total}} = \frac{1}{2} \sum_{i=1}^{T} \| (\mathbf{v}_{i,2} - \mathbf{v}_{i,1}) \times (\mathbf{v}_{i,3} - \mathbf{v}_{i,1}) \|$$

3. **Area Partitioning:**
   - Horizontal Base & Roof Areas:
     $$A_{\text{caps}} = A_{\text{bottom}} + A_{\text{top}} \approx 2 \times A_{\text{2D\_cross\_section}}$$
   - Side Perimeter Surface Area:
     $$A_{\text{walls}} = \max(0, A_{\text{total}} - A_{\text{caps}})$$

4. **Extruded Volume Components:**
   - **Solid Perimeter Walls (100% Solid Extrusion):**
     $$V_{\text{walls}} = A_{\text{walls}} \times (N_{\text{loops}} \times W_{\text{outer}}) = A_{\text{walls}} \times (3 \times 0.42\text{ mm}) = 1.26 \cdot A_{\text{walls}}\text{ mm}^3$$
   - **Solid Top and Bottom Caps (100% Solid Extrusion):**
     $$V_{\text{caps}} = A_{\text{caps}} \times (N_{\text{top}} + N_{\text{bot}}) \times h_{\text{layer}} = A_{\text{caps}} \times (5 + 4) \times 0.20\text{ mm} = 1.80 \cdot A_{\text{caps}}\text{ mm}^3$$
   - **Sparse Infill Core:**
     $$V_{\text{core\_boundary}} = \max(0, V_{\text{solid}} - V_{\text{walls}} - V_{\text{caps}})$$
     $$V_{\text{infill\_extruded}} = V_{\text{core\_boundary}} \times \rho_{\text{infill\_ratio}} \quad (\text{default } \rho = 0.15)$$
   - **Total Extruded Material Volume:**
     $$V_{\text{total\_extruded}} = V_{\text{walls}} + V_{\text{caps}} + V_{\text{infill\_extruded}}$$

5. **Mass Calculation by Material Formulation:**
   $$M_{\text{grams}} = \frac{V_{\text{total\_extruded}}\ (\text{mm}^3) \times \rho_{\text{filament}}\ (\text{g/cm}^3)}{1000}$$

| Filament Family | Specific Density ($\rho$) | Recommended Nozzle Temp | Recommended Bed Temp (PEI) |
| :--- | :--- | :--- | :--- |
| **Bambu PLA Basic / Matte** | $1.24\text{ g/cm}^3$ | $220^\circ\text{C}$ | $65^\circ\text{C}$ |
| **Bambu PETG Basic / HF** | $1.27\text{ g/cm}^3$ | $255^\circ\text{C}$ | $75^\circ\text{C}$ |
| **Bambu ABS / ASA** | $1.05\text{ g/cm}^3$ | $260^\circ\text{C}$ | $90^\circ\text{C}$ (Enclosure needed) |
| **Bambu TPU 95A (Flexible)**| $1.20\text{ g/cm}^3$ | $230^\circ\text{C}$ | $35^\circ\text{C}$ |
| **Bambu PC (Polycarbonate)**| $1.20\text{ g/cm}^3$ | $270^\circ\text{C}$ | $100^\circ\text{C}$ |

---

### 2.3 Bambu Lab A1 Print Time Heuristic Function

The print time algorithm accounts for hardware kinematics, dynamic toolhead acceleration, thermal flow thresholds, and initial calibration sequences:

```typescript
export interface PrintEstimate {
  massGrams: number;
  printTimeMinutes: number;
  formattedTime: string;
  filamentType: string;
  numLayers: number;
}

export function calculatePrintEstimate(
  meshVolumeMm3: number,
  meshSurfaceAreaMm2: number,
  crossSectionAreaMm2: number,
  heightZMm: number,
  filamentType: 'PLA' | 'PETG' | 'TPU' = 'PLA',
  infillRatio = 0.15
): PrintEstimate {
  const densities = { PLA: 1.24, PETG: 1.27, TPU: 1.20 };
  const maxFlowRates = { PLA: 21.0, PETG: 15.0, TPU: 4.5 }; // mm³/s hotend flow limit
  const effectiveFlowRates = { PLA: 12.0, PETG: 9.5, TPU: 3.5 }; // accounting for cornering & travel

  const rho = densities[filamentType] || 1.24;
  const flowRate = effectiveFlowRates[filamentType] || 12.0;

  // 1. Shell & Cap decomposition
  const capArea = 2.0 * crossSectionAreaMm2;
  const wallArea = Math.max(0, meshSurfaceAreaMm2 - capArea);

  const vWalls = wallArea * (3 * 0.42);       // 3 loops @ 0.42mm width = 1.26mm
  const vCaps = capArea * (9 * 0.20);         // 5 top + 4 bottom = 1.8mm solid cap
  const vCore = Math.max(0, meshVolumeMm3 - vWalls - vCaps);
  const vInfill = vCore * infillRatio;

  const vExtruded = vWalls + vCaps + vInfill;
  const massGrams = (vExtruded * rho) / 1000.0;

  // 2. Hardware Kinematics & Timing (Bambu Lab A1)
  const layerHeight = 0.20;
  const numLayers = Math.max(1, Math.ceil(heightZMm / layerHeight));

  // Overhead 1: Startup sequence (vibration sweep, nozzle clean, bed leveling, purge line)
  const tStartupSec = 360; // 6.0 minutes

  // Overhead 2: Extrusion deposition time based on thermal flow limit
  const tExtrudeSec = vExtruded / flowRate;

  // Overhead 3: Z-hop, layer change, and non-print rapid travel (500 mm/s)
  const tLayerOverheadSec = numLayers * 1.8;

  const totalSeconds = tStartupSec + tExtrudeSec + tLayerOverheadSec;
  const totalMinutes = Math.ceil(totalSeconds / 60.0);

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const formattedTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    massGrams: Number(massGrams.toFixed(1)),
    printTimeMinutes: totalMinutes,
    formattedTime,
    filamentType,
    numLayers
  };
}
```

---

## 3. Mechanical Tolerance Presets for FDM

### 3.1 Dimensional Compensation & Thermal Shrinkage

#### 3.1.1 Thermal Contraction
As extruded polymer cools from its glass transition temperature ($T_g$) to ambient room temperature ($22^\circ\text{C}$), isotropic thermal contraction occurs:
* **PLA:** Shrinks by **$0.25\% - 0.35\%$**.
* **PETG:** Shrinks by **$0.50\% - 0.70\%$**.
* **Exporter Compensation:** When enabled, the exporter applies an expansion scale factor before slicing:
  $$S_{xy} = 1.0 + \sigma_{\text{shrink}} \quad (\text{PLA: } 1.003, \text{ PETG: } 1.006)$$

#### 3.1.2 Elephant's Foot Mitigation (Textured PEI Plate)
The Bambu Lab A1 textured PEI plate is heated to $65^\circ\text{C}$ (PLA) or $75^\circ\text{C}$ (PETG) to maintain adhesion. Under nozzle downward pressure, the first layer ($Z \le 0.40\text{ mm}$) squishes laterally outward by **$+0.15\text{ mm} \dots +0.25\text{ mm}$**.
* **Remedy 1: Chamfer Base Edge:** Automatic bottom-edge chamfer of **$45^\circ \times 0.60\text{ mm}$** on external contours and internal holes.
* **Remedy 2: Contour Offset:** Apply a **$-0.15\text{ mm}$** inward compensation offset to the first slice contour.

#### 3.1.3 FDM Circular Hole Undersizing Law
In FDM printing, molten polymer extruded along a circular radius is held under tensile spool tension as the print head turns. This causes the hot bead to take a chordal shortcut toward the inside of the curve, shrinking internal holes by **$0.15\text{ mm} \dots +0.25\text{ mm}$** compared to design dimensions.

---

### 3.2 Standard Mechanical Fastener & Clearance Presets

The following dimensions are calibrated specifically for the Bambu A1 with a 0.4 mm nozzle to produce drop-in mechanical fits:

| Hardware Fastener | Nominal OD | Fit Classification | CAD Hole Diameter | Radial Offset ($\Delta r$) | Assembly Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **M2.5 Bolt** | $2.50\text{ mm}$ | Close / Tap | **$\varnothing 2.65\text{ mm}$** | $+0.075\text{ mm}$ | Self-tapping directly into plastic |
| **M2.5 Bolt** | $2.50\text{ mm}$ | Free Clearance | **$\varnothing 2.85\text{ mm}$** | $+0.175\text{ mm}$ | Free through-hole pass |
| **M3 Bolt** | $3.00\text{ mm}$ | Close / Tap | **$\varnothing 3.20\text{ mm}$** | $+0.100\text{ mm}$ | Direct thread engagement |
| **M3 Bolt** | $3.00\text{ mm}$ | Free Clearance | **$\varnothing 3.40\text{ mm}$** | $+0.200\text{ mm}$ | Standard clearance bolt hole |
| **M3 Heat-Set Insert** | $4.20\text{ mm}$ OD | Standard Brass | **$\varnothing 4.00\text{ mm}$ (top)**<br>$\to$ **$\varnothing 3.85\text{ mm}$ (bottom)** | $-0.100\text{ mm}$ taper | Soldering iron thermal insertion; $8^\circ$ draft angle prevents pullout |
| **M4 Bolt** | $4.00\text{ mm}$ | Close / Tap | **$\varnothing 4.20\text{ mm}$** | $+0.100\text{ mm}$ | Heavy-duty bracket tapping |
| **M4 Bolt** | $4.00\text{ mm}$ | Free Clearance | **$\varnothing 4.40\text{ mm}$** | $+0.200\text{ mm}$ | Structural frame through-hole |
| **M5 Bolt** | $5.00\text{ mm}$ | Free Clearance | **$\varnothing 5.50\text{ mm}$** | $+0.250\text{ mm}$ | Modular extrusion / rig mounting |
| **Alignment Pin / Dowel** | $3.00\text{ mm}$ | Press Fit | **$\varnothing 3.10\text{ mm}$** | $+0.050\text{ mm}$ | Permanent interlocking alignment |
| **Card Slot / Rail** | Varies | Sliding Clearance | **Nominal $+ 0.40\text{ mm}$** | $+0.200\text{ mm}$ / side | Smooth sliding EDC card fit |
| **Snap-Fit Joint** | Cantilever | Latch Engagement | **Nominal $+ 0.35\text{ mm}$** | $+0.175\text{ mm}$ / side | Positive click retention |

---

### 3.3 Calibration & Validation Test Coupons

Sketch3D includes built-in generative presets for 3 specialized calibration coupons:

1. **Bambu Clearance Gauge (Print-in-Place Wheel):**
   * Central hub with 6 independent rotating cylinders with radial clearances:
     `0.10 mm`, `0.15 mm`, `0.20 mm`, `0.25 mm`, `0.30 mm`, `0.35 mm`.
   * Standard A1 benchmark: `0.20 mm` should spin freely off the build plate without post-processing.
2. **Fastener Boss & Wall Step Gauge:**
   * Step thicknesses: `0.4 mm`, `0.8 mm`, `1.2 mm`, `1.6 mm`, `2.0 mm`.
   * Hole bank: M3 tap, M3 clearance, M3 heat-set boss, M4 clearance.
   * Tests wall rigidity, surface ringing, and fastener engagement.
3. **Overhang Fin Strip:**
   * Cantilever test steps: `30°`, `40°`, `45°`, `50°`, `60°`, `70°`.
   * Directly validates the visual shader thresholds against physical printed parts on the user's specific filament spool.

---

## 4. Integration Contracts with Other Subsystems

* **To `@kernel-lead` (WASM Geometry Engine):**
  * Provide `MeshBVH` thickness query bindings.
  * Embed Bambu Studio slice metadata and AMS slot configurations in the `.3MF` manifest.
* **To `@ux-lead` (User Experience & Gestures):**
  * Expose real-time 2D segment distance warnings on the iPad canvas.
  * Provide UI presets for Fastener Tolerances (`M3 Close`, `M3 Free`, `Heat-Set`).
  * Add the 3D Overhang Visualizer toggle in the viewport header bar.
* **To `@roadmap-compiler`:**
  * Ready for synthesis into the Master Build Roadmap (`sketch3d/BUILD_ROADMAP.md`).
