# SKETCH3D — Sketching Interaction & Application Architecture Specification
**Phase 1 & Phase 2 Technical Blueprint**  
**Role:** UX & Application Architecture Lead (`@ux-lead`)  
**Target Hardware:** Apple iPad (Safari, Apple Pencil & Touch), iPhone & Desktop Web  
**Target Manufacturing Platform:** Bambu Lab A1 (`256 × 256 × 256 mm`, 0.4 mm standard nozzle)  
**Status:** Approved Technical Architecture Blueprint

---

## Executive Summary & Design System

Sketch3D bridges parametric CAD (Rhino/Grasshopper) and direct-manipulation sketching (Procreate/SketchUp) into a unified, zero-latency browser studio designed specifically for the **Bambu Lab A1** ecosystem.

### Brand UI Theme Tokens
* **Dark Background Canvas:** `#020203`
* **Surface / Panel Background:** `#0B0B10`
* **Border & Dividers:** `#1E1E2A` / `#2A2A3C`
* **Yellow (Primary Action / Active Selection):** `#FEFF00`
* **Pink (3D Mesh Geometry / Secondary Accent):** `#FF66D9`
* **Green (Bed Boundary / Valid Print / Slicer Ready):** `#00E56D`
* **Cyan (Wireframe / Cutouts / Z-Layer Dimensions):** `#73E6F1`
* **Amber / Orange (Printability & Clearance Warning):** `#FF9900`

---

## 1. Multi-Layer Z-Stacking UX Specification

### 1.1 Mental Model & Workflow
Currently, Sketch3D extrudes a single 2D polygon profile uniformly along the Z-axis. Multi-Layer Z-Stacking expands the parametric workspace to support multiple independent sketch planes situated at discrete Z elevations ($0 \le Z \le 256\text{ mm}$).

This unlocks two distinct mechanical & sculptural fabrication archetypes:
1. **Stepped Mechanical Assemblies (Phase 1):** Layered faceplates, battery trays, and cyberdeck enclosures where each layer represents a discrete solid plate with its own thickness, internal cutouts, and fastener standoffs.
2. **Multi-Section Continuous Lofting (Phase 2):** Sculptural lampshades, aerodynamic ducts, and organic hulls where 2 to 8 cross-section planes are blended continuously along a Z-axis spine.

```
Elevation (Z)
▲
│   ┌───────────────────────────┐  Layer 3: Top Cap (Z=45.0mm, t=3.0mm)
│   │   [L3: 6 Cutouts, M3]     │  (Twist: 45°, Bevel: 1.0mm)
│   └───────────────────────────┘
│                 ▲
│                 │ (Loft or Spacer Gap = 25.0mm)
│                 ▼
│   ┌───────────────────────────┐  Layer 2: Internal Rib (Z=20.0mm, t=4.0mm)
│   │   [L2: Truss Lattice]     │  (Onion skin visible in 2D canvas)
│   └───────────────────────────┘
│                 ▲
│                 │ (Loft or Solid Extrude = 20.0mm)
│                 ▼
│   ┌───────────────────────────┐  Layer 1: Base Plate (Z=0.0mm, t=6.0mm)
│   │   [L1: Outer Perimeter]   │  (4x M3 Corner Heat-Set Inserts)
│───┴───────────────────────────┴──────────────────────────► X/Y Plane (Bed)
    Bambu A1 Build Plate (256 × 256 mm)
```

### 1.2 UI & Component Architecture

#### A. Vertical Z-Stack Tray (Collapsible Left/Right Drawer)
* **Z-Ruler Bar:** A vertical graduated scale calibrated from $0\text{ mm}$ (bed level) to $256\text{ mm}$ (Bambu A1 max height).
* **Layer Cards / Chips:**
  * **Header:** Layer index tag (`L0`, `L1`, etc.) + editable label (e.g., `Base Plate`, `Aft Bulkhead`).
  * **Elevation Value:** Numeric badge with direct touch input (`Z: 12.0 mm`) and `+`/`-` micro-steppers (0.5 mm / 1.0 mm increments).
  * **Layer Mode Selector:** Toggle between `Solid Extrude` (discrete block) vs. `Loft Target` (section in NURBS skin).
  * **Visibility & Onion-Skin State:**
    * 👁 **Active:** Full contrast editing (`#FEFF00` vertices, solid fill).
    * 🧅 **Onion-Skin:** Translucent projection (`#73E6F1` for layer below, `#FF66D9` for layer above).
    * 🚫 **Hidden:** Suppressed from 2D canvas, remains in 3D scene.
  * **Actions:** Duplicate Layer (with Z offset +5mm), Delete Layer, Lock Layer.
  * **Drag-to-Reorder:** Long-press drag handle (`≡`) to re-sequence layer elevations. Reordering auto-sorts Z values or prompts for elevation realignment.

#### B. 3D Viewport Dynamic Cutting & Sketch Plane Gizmo
* In the Three.js viewport, the active layer is visualized as a semi-transparent luminous grid plane (`#73E6F1` grid at 20% opacity) slice through the 3D geometry.
* A vertical translation arrow (Z-axis handle) allows grabbing in 3D and scrubbing the elevation continuously with live numerical readout.
* **Double-tap on any 3D mesh section:** Immediately switches the active editing context of the 2D canvas to that layer.

#### C. Cross-Layer Onion Skinning & Magnetic Snapping
* When editing Layer $N$, geometry from Layer $N-1$ is projected onto the 2D canvas as a dashed `#73E6F1` (cyan) silhouette, and Layer $N+1$ as a dashed `#FF66D9` (pink) silhouette.
* The snapping engine treats vertices, circle centers, and edge midpoints of the onion-skinned layers as primary magnetic snap targets. This guarantees exact concentricity for M3/M4 screw holes passing through multiple stacked plates.

### 1.3 TypeScript Data Interfaces

```typescript
export type LayerExtrudeMode = 'extrude_discrete' | 'loft_section' | 'cutout_mask';

export interface SketchPoint2D {
  x: number; // In millimeters (-128.0 to +128.0)
  y: number; // In millimeters (-128.0 to +128.0)
  radius?: number; // Optional corner fillet radius
  isSmooth?: boolean; // Bezier/NURBS knot continuity
}

export interface FastenerHole {
  id: string;
  x: number;
  y: number;
  diameter: number; // Final manufactured diameter (including clearance)
  standard: 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5';
  fitType: 'close' | 'loose' | 'self_tap' | 'heat_set_insert';
  counterbore?: {
    diameter: number;
    depth: number;
  };
}

export interface SketchLayer {
  id: string;
  name: string;
  zElevation: number; // mm from print bed (0 to 256)
  thickness: number; // mm extrusion height for discrete mode
  mode: LayerExtrudeMode;
  isClosed: boolean;
  points: SketchPoint2D[];
  holes: FastenerHole[];
  cutouts: SketchPoint2D[][];
  modifiers: {
    bevelSize: number; // 0 to 4 mm
    twistDeg: number;  // 0 to 180 degrees
    taperScale: number; // Scale factor relative to base
  };
  uiState: {
    visible: boolean;
    locked: boolean;
    onionSkin: boolean;
    color: string;
  };
}
```

---

## 2. Apple Pencil & Touch Gestures Specification

### 2.1 Unified Pointer Event Pipeline
Mobile Safari handles both stylus and multi-touch through the W3C `PointerEvent` specification. Sketch3D implements a strict discriminator pipeline ensuring stylus drawing never conflicts with navigation gestures.

```
                    ┌───────────────────────────────┐
                    │      PointerDown Event        │
                    └──────────────┬────────────────┘
                                   │
                     Is pointerType == 'pen'?
                      ├── YES ──► Apple Pencil Pipeline (Drawing / Sculpting)
                      │            * Check pressure > 0.05
                      │            * Suppress palm touch events within 350ms window
                      │            * Apply fine hit-radius (10px)
                      │
                      └── NO ───► Touch / Finger Pipeline (Navigation & Gestures)
                                   * Is 1-Finger Touch on existing Vertex (radius 22px)?
                                   │   ├── YES ──► Vertex Drag & Edge Reshape
                                   │   └── NO ───► Pan 2D Canvas (if zoomed) or Orbit 3D
                                   * Are 2 Fingers Active?
                                   │   ├── Pinch ──► Continuous Canvas Zoom
                                   │   ├── Drag  ──► Two-finger Canvas Pan
                                   │   └── Tap   ──► Instant UNDO
                                   * Are 3 Fingers Active?
                                       └── Tap   ──► Instant REDO
```

### 2.2 Apple Pencil Features

1. **Pressure Sensitivity (`event.pressure` [0.0 ... 1.0]):**
   * **Polyline Mode:** Light pressure previews candidate point; firm press ($> 0.35$) confirms vertex drop with haptic pulse.
   * **Freehand Spline Mode:** Pressure maps directly to profile spline weight or adaptive vertex density filter (Ramer-Douglas-Peucker tolerance dynamically adjusted by stylus velocity and pressure).
2. **Stylus Tilt (`event.tiltX`, `event.tiltY`):**
   * When tilt angle exceeds $45^\circ$ from the screen normal, the active vertex tool automatically triggers **Corner Fillet / Chamfer Scrubbing**. Swiping along the angle increases/decreases the corner radius interactively.
3. **Double-Tap Stylus Action (`ApplePencil.onDoubleTap`):**
   * Cycles mode between:
     1. `Draw / Add Point`
     2. `Select / Vertex Transform`
     3. `Eraser / Cutout Punch`
4. **Hardware Palm Rejection:**
   * When `pointerType === 'pen'`, any simultaneous `pointerType === 'touch'` events where contact area $r > 20\text{px}$ are discarded.
   * CSS `touch-action: none` applied across all active canvases prevents Safari navigation page swipes and pull-to-refresh interference.

### 2.3 Snapping Engine & Boundary Physics

* **Multi-Tier Magnetic Snap Hierarchy:**
  1. **Tier 1 (Highest Priority):** Existing Vertex & Arc Center ($R_{\text{snap}} = 12\text{px}$ for Pen, $24\text{px}$ for Touch).
  2. **Tier 2:** Onion-Skin Projected Vertex (Z-axis vertical alignment across layers).
  3. **Tier 3:** Segment Midpoint & 0.4 mm Perpendicular Orthogonal Snap.
  4. **Tier 4:** Polar Angle Constraints ($0^\circ, 45^\circ, 90^\circ, 135^\circ, 180^\circ$ relative to previous segment).
  5. **Tier 5:** Base Coordinate Grid ($1.0\text{ mm}$ fine, $5.0\text{ mm}$ standard, $10.0\text{ mm}$ coarse).
* **Haptic Snap Confirmation:**
  * Triggered via Web Haptics / Vibration API (`navigator.vibrate([10])` on supported devices) the exact instant a magnetic snap point locks into place.
* **Canvas Pan vs. Pinch Zoom Boundaries:**
  * Canvas zoom clamped strictly between $0.5\times$ and $4.0\times$ magnification.
  * Over-scroll dampening physics: rubber-band resistance when dragging beyond the $256\text{ mm}$ Bambu A1 bed perimeter boundary.

---

## 3. Mechanical Clearance Presets & Fasteners

### 3.1 3D Printing / FDM Dimensional Clearance Physics
Thermoplastic extrusion on FDM printers (Bambu Lab A1 with $0.4\text{ mm}$ standard nozzle) incurs dimensional variations due to:
* **Melt Over-Extrusion & Inner Hole Necking:** The nozzle drags plastic along an internal circular chord, pulling material inward toward the center and shrinking hole diameters by roughly $0.1$ to $0.25\text{ mm}$.
* **Polymer Thermal Shrinkage:** High-crystallinity filaments (PETG/PLA) shrink by $0.2\% - 0.4\%$ upon cooling on the textured PEI plate.

### 3.2 Mechanical Fastener Reference Table

| Fastener | Nominal OD | Close Fit (+0.2 mm)<br>*(Through-hole / Slicing Standard)* | Loose Fit (+0.4 mm)<br>*(Multi-layer Stackup)* | Self-Tapping (-0.15 mm)<br>*(Thread Bite into Plastic)* | Brass Heat-Set Insert<br>*(Standard Cone Geometry)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **M2.0** | $2.00\text{ mm}$ | **Ø $2.20\text{ mm}$** | **Ø $2.40\text{ mm}$** | **Ø $1.85\text{ mm}$** | Ø $3.20\text{ mm}$ top / $3.00\text{ mm}$ bot (depth $3.5\text{ mm}$) |
| **M2.5** | $2.50\text{ mm}$ | **Ø $2.70\text{ mm}$** | **Ø $2.90\text{ mm}$** | **Ø $2.35\text{ mm}$** | Ø $3.60\text{ mm}$ top / $3.40\text{ mm}$ bot (depth $4.0\text{ mm}$) |
| **M3.0** | $3.00\text{ mm}$ | **Ø $3.20\text{ mm}$** *(Default)* | **Ø $3.40\text{ mm}$** | **Ø $2.85\text{ mm}$** | Ø $4.00\text{ mm}$ top / $3.80\text{ mm}$ bot (depth $4.0-5.7\text{ mm}$) |
| **M4.0** | $4.00\text{ mm}$ | **Ø $4.20\text{ mm}$** | **Ø $4.50\text{ mm}$** | **Ø $3.80\text{ mm}$** | Ø $5.60\text{ mm}$ top / $5.30\text{ mm}$ bot (depth $5.8\text{ mm}$) |
| **M5.0** | $5.00\text{ mm}$ | **Ø $5.20\text{ mm}$** | **Ø $5.50\text{ mm}$** | **Ø $4.80\text{ mm}$** | Ø $6.80\text{ mm}$ top / $6.40\text{ mm}$ bot (depth $7.0\text{ mm}$) |

#### Socket Head Cap Screw (SHCS) Counterbores:
* **M3 SHCS:** Counterbore Pocket Diameter = **Ø $5.90\text{ mm}$** (5.5mm head + 0.4mm clearance), Counterbore Depth = **$3.30\text{ mm}$** (3.0mm head + 0.3mm clearance).
* **M4 SHCS:** Counterbore Pocket Diameter = **Ø $7.50\text{ mm}$**, Counterbore Depth = **$4.40\text{ mm}$**.

### 3.3 Fast Clearance Selector UI
* One-touch tool shelf selector:
  ```
  [ ⊙ Fastener Tool ] ──► Popover Matrix:
    [ Size: M2.5 | M3 | M4 | M5 ]
    [ Fit:  Close (+0.2) | Loose (+0.4) | Self-Tap (-0.15) | Heat-Set Insert ]
    [ Head: None | Counterbore (SHCS) | Countersunk (Flat) ]
  ```
* **Corner Auto-Placement Assist:** Tapping a polygon corner vertex offers a 1-tap option: `"Inset M3 Boss"` which places the hole exactly along the corner's internal angle bisector, offset by $2 \times \text{hole radius} + 1.2\text{ mm}$ minimum wall thickness.

### 3.4 Snap-Fit Cantilever Joint Generator
Snap-fits in 3D printing must account for layer orientation and allowable strain ($\epsilon_0$) to prevent layer delamination or permanent yielding:
* Allowable design strain for PLA: $\epsilon \le 1.5\% = 0.015$
* Allowable design strain for PETG: $\epsilon \le 2.5\% = 0.025$

#### Beam Deflection Formula (Uniform Rectangular Cantilever):
$$y = \frac{\epsilon \cdot L^2}{1.5 \cdot t}$$
Where:
* $L$ = Length of the cantilever arm (recommended: $12.0\text{ mm} - 20.0\text{ mm}$)
* $t$ = Thickness of beam (recommended: $1.6\text{ mm} - 2.4\text{ mm}$, exactly 4 to 6 nozzle perimeters)
* $y$ = Maximum allowable undercut / latch engagement depth (typically $0.8\text{ mm} - 1.2\text{ mm}$)

#### Parametric Generator Profile
The snap-fit tool generates a pre-calculated 2D cutout / tab profile with:
1. $30^\circ$ lead-in insertion chamfer (low push force).
2. $85^\circ$ retention lock angle (firm engagement).
3. Built-in $0.35\text{ mm}$ lateral clearance gap between mating tongue and groove.
4. $0.8\text{ mm}$ internal fillet radius at the cantilever root to eliminate stress concentration notches.

---

## 4. Project Serialization (`.json`) Specification

### 4.1 Complete JSON Schema (`sketch3d-project-v1.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Sketch3DProject",
  "type": "object",
  "required": ["schemaVersion", "metadata", "hardwareBounds", "layers"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": ["1.0.0", "1.1.0", "1.2.0"]
    },
    "metadata": {
      "type": "object",
      "required": ["id", "title", "createdAt", "modifiedAt", "units"],
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "title": { "type": "string" },
        "author": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" },
        "modifiedAt": { "type": "string", "format": "date-time" },
        "units": { "type": "string", "enum": ["mm"] }
      }
    },
    "hardwareBounds": {
      "type": "object",
      "required": ["printerModel", "bedX", "bedY", "maxZ", "nozzleDiameterMm"],
      "properties": {
        "printerModel": { "type": "string", "default": "Bambu Lab A1" },
        "bedX": { "type": "number", "default": 256 },
        "bedY": { "type": "number", "default": 256 },
        "maxZ": { "type": "number", "default": 256 },
        "nozzleDiameterMm": { "type": "number", "default": 0.4 }
      }
    },
    "globalModifiers": {
      "type": "object",
      "properties": {
        "globalTwistDeg": { "type": "number", "minimum": 0, "maximum": 180 },
        "globalBevelMm": { "type": "number", "minimum": 0, "maximum": 4.0 },
        "loftAlgorithm": { "type": "string", "enum": ["nurbs_cubic", "catmull_rom", "linear_stepped"] },
        "activeFilament": {
          "type": "object",
          "properties": {
            "type": { "type": "string", "enum": ["PLA", "PETG", "TPU", "ABS"] },
            "colorHex": { "type": "string" },
            "densityGramsCm3": { "type": "number", "default": 1.24 }
          }
        }
      }
    },
    "layers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "zElevation", "thickness", "mode", "points"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "zElevation": { "type": "number", "minimum": 0, "maximum": 256 },
          "thickness": { "type": "number", "minimum": 0.2, "maximum": 256 },
          "mode": { "type": "string", "enum": ["extrude_discrete", "loft_section", "cutout_mask"] },
          "isClosed": { "type": "boolean" },
          "points": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["x", "y"],
              "properties": {
                "x": { "type": "number", "minimum": -128, "maximum": 128 },
                "y": { "type": "number", "minimum": -128, "maximum": 128 },
                "radius": { "type": "number" },
                "isSmooth": { "type": "boolean" }
              }
            }
          },
          "holes": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "x", "y", "diameter", "standard", "fitType"],
              "properties": {
                "id": { "type": "string" },
                "x": { "type": "number" },
                "y": { "type": "number" },
                "diameter": { "type": "number" },
                "standard": { "type": "string", "enum": ["M2", "M2.5", "M3", "M4", "M5"] },
                "fitType": { "type": "string", "enum": ["close", "loose", "self_tap", "heat_set_insert"] }
              }
            }
          },
          "cutouts": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {
                  "x": { "type": "number" },
                  "y": { "type": "number" }
                }
              }
            }
          }
        }
      }
    },
    "viewportState": {
      "type": "object",
      "properties": {
        "viewMode": { "type": "string", "enum": ["split", "2d", "3d"] },
        "cameraPosition": {
          "type": "object",
          "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "z": { "type": "number" } }
        },
        "cameraTarget": {
          "type": "object",
          "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "z": { "type": "number" } }
        }
      }
    }
  }
}
```

### 4.2 Save, Load & Drag-and-Drop Restoration Engine

1. **Window Drag-and-Drop Catchment:**
   * Browser window binds `dragenter`, `dragover`, and `drop` events on document body.
   * Dragging any `.json` or `.sketch3d` file over the window triggers a high-visibility dropzone backdrop (`#00E56D` dashed border with "Drop Sketch3D Project to Open").
2. **Schema Validator & Backward Compatibility Adapter:**
   * Incoming JSON passes through a version router:
     * **v1.0.0 (Legacy single-layer):** Automatically migrated into a multi-layer schema as `layers[0]` with `zElevation: 0` and `thickness: extrudeHeight`.
     * **v1.2.0 (Current):** Validates all coordinates fall within $[-128, +128]\text{ mm}$ and elevations within $[0, 256]\text{ mm}$.
3. **Autosave Recovery Pipeline:**
   * State is continuously mirrored to `localStorage.getItem('sketch3d_autosave_v1')` debounced at 1500 ms.
   * If a user refreshes or experiences browser eviction on iOS, a non-blocking toast prompts: `"Restore previous unsaved session? [Restore] [Dismiss]"`.

---

## 5. PWA & Responsive Migration Specification

### 5.1 Progressive Web App (PWA) Architecture

#### A. Web App Manifest (`public/manifest.json`)
```json
{
  "name": "Sketch3D — Parametric CAD for Bambu A1",
  "short_name": "Sketch3D",
  "description": "Direct touch-to-print parametric 3D sketch studio optimized for iPad and Bambu Lab A1.",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#020203",
  "theme_color": "#020203",
  "orientation": "any",
  "icons": [
    {
      "src": "./icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "./icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "categories": ["productivity", "utilities", "design"]
}
```

#### B. iOS Standalone Web App Meta Headers
```html
<!-- iOS Safari PWA Fullscreen Meta Tags -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Sketch3D" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
```

#### C. Service Worker Caching Strategy (`public/sw.js`)
* **Core Philosophy:** Sketch3D has **zero server-side compute**. All 2D mathematics, Three.js mesh generation, Manifold-3D WASM operations, and STL/3MF file binary generation happen entirely inside the browser client. The application is natively capable of 100% offline operation.
* **Cache Architecture:**
  * **Static App Shell (Cache-First):** `index.html`, compiled JS bundles, WASM binaries (`manifold.wasm`), and typography (`Inter`).
  * **Network-First with Fallback:** Dynamic documentation or presets.
  * **Cache Versioning & Invalidation:** Automated version stamp `const CACHE_NAME = 'sketch3d-cache-v1.2.0'`. During service worker `activate` phase, all obsolete caches are pruned.

### 5.2 Responsive Layout Adaptation (Breakpoints)

| Viewport Profile | Layout Grid | 2D / 3D Display Mode | Navigation Drawer |
| :--- | :--- | :--- | :--- |
| **iPad Pro / Desktop Landscape** ($\ge 1024\text{px}$) | 2-Column Split (`grid-cols-2`) | Side-by-side simultaneous live updates | Pinned vertical Z-stack sidebar on left edge |
| **iPad Portrait** ($768\text{px} - 1023\text{px}$) | Flexible Split or Tabbed | Segmented control `[Split \| 2D \| 3D]` | Slide-over drawer toggled via floating pill |
| **iPhone / Mobile Device** ($< 768\text{px}$) | Single Column Tabbed | Fullscreen tabs: `[2D Canvas]` $\leftrightarrow$ `[3D Model]` | Bottom sheet modal with swipe gesture dismiss |

---

## 6. Vite + TypeScript Migration Blueprint

To support the heavy computation of Phase 2 (Manifold-3D WebAssembly, Web Workers, and multi-section NURBS curves) without degrading client performance, the project will transition cleanly from the single-file `index.html` prototype to a modular **Vite + TypeScript** architecture.

### 6.1 Target Directory Tree Structure

```
sketch3d/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Pages auto-build & deploy
├── public/
│   ├── manifest.json               # PWA Web App Manifest
│   ├── sw.js                       # Service Worker for offline PWA
│   ├── icons/                      # 192px, 512px, Apple touch icons
│   └── wasm/
│       └── manifold.wasm           # Manifold-3D WASM binary
├── src/
│   ├── app/
│   │   ├── state/
│   │   │   ├── projectStore.ts     # Reactive state store (Z-layers, selection, history)
│   │   │   └── historyManager.ts   # Multi-tier Undo/Redo stack manager
│   │   ├── serialization/
│   │   │   ├── projectSchema.ts    # JSON schema validator
│   │   │   ├── exporter.ts         # .sketch3d.json & STL/3MF downloaders
│   │   │   └── importer.ts         # Drag & Drop file reader + migration
│   │   └── gestures/
│   │       ├── pointerDispatcher.ts# Pen vs. Touch discriminator
│   │       ├── touchGestures.ts    # 2-finger undo, pinch zoom, pan
│   │       └── pencilHandler.ts    # Pressure, tilt, double-tap listeners
│   ├── canvas2d/
│   │   ├── Canvas2DEngine.ts       # Retained 2D sketch canvas renderer
│   │   ├── SnappingEngine.ts       # Magnetic grid, vertex, and polar snap
│   │   ├── LayersManager.ts        # Multi-layer Z-stack manager & onion skin
│   │   └── presets/
│   │       ├── FastenerPresets.ts  # M2.5 - M5 clearance hole definitions
│   │       └── SnapFitGenerator.ts # Cantilever snap-fit math & profile builder
│   ├── viewport3d/
│   │   ├── ThreeScene.ts           # Three.js WebGL scene, lighting, camera
│   │   ├── BuildEnvelope.ts        # Bambu Lab A1 256x256x256mm cage & bed grid
│   │   ├── SliceGizmo.ts           # Interactive 3D layer elevation dragger
│   │   └── MeshBuilder.ts          # Extrude, Bevel, Twist geometry generators
│   ├── workers/
│   │   ├── kernelWorkerBridge.ts   # PostMessage interface to geometry worker
│   │   └── geometry.worker.ts      # Dedicated Web Worker for Manifold-3D WASM
│   ├── styles/
│   │   └── main.css                # Tailwind base & custom brand utilities
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces (Layer, Point, Fastener)
│   └── main.ts                     # Application entry point & DOM binder
├── index.html                      # Clean HTML5 root
├── package.json                    # Dependencies & build scripts
├── tsconfig.json                   # Strict TypeScript compiler configuration
└── vite.config.ts                  # Vite config (WASM plugin, relative base paths)
```

### 6.2 Key Configuration Files

#### `package.json`
```json
{
  "name": "sketch3d",
  "version": "1.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest"
  },
  "dependencies": {
    "three": "^0.165.0",
    "manifold-3d": "^3.0.0"
  },
  "devDependencies": {
    "@types/three": "^0.165.0",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "vite-plugin-wasm": "^3.3.0",
    "vite-plugin-top-level-await": "^1.4.1",
    "tailwindcss": "^3.4.4",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38"
  }
}
```

#### `vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  // Crucial: Relative base ensures deployment works on iocfinc.github.io/sketch3d/
  base: './',
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()]
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true
  },
  server: {
    port: 3000,
    open: true
  }
});
```

---

## 7. Delivery Milestones & Work Breakdown

| Milestone | Epic / Feature Deliverable | Target Timeline | Success Criteria |
| :--- | :--- | :--- | :--- |
| **M1.1** | **Multi-Layer Z-Stack UI & State** | Sprint 1 (Days 1–3) | User can add 2+ layers at discrete Z heights ($0-256\text{ mm}$), reorder via drag handle, and see onion skin of adjacent layer in 2D canvas. |
| **M1.2** | **Mechanical Fastener & Clearance Presets** | Sprint 1 (Days 4–5) | 1-tap drop of M3/M4/M5 holes with $+0.2\text{ mm}$ close fit clearance, heat-set insert dimensions, and auto-corner standoff alignment. |
| **M1.3** | **JSON Project Serialization & D&D** | Sprint 1 (Days 6–7) | Full save/load of `.sketch3d.json`, drag-and-drop file restore, backward compatibility migration from v1.0.0, and localStorage autosave. |
| **M2.1** | **Apple Pencil & Touch Gesture Pipeline** | Sprint 2 (Days 8–10) | Smooth discrimination between Apple Pencil drawing, two-finger undo, pinch zoom, palm rejection, and haptic snap feedback. |
| **M2.2** | **Vite + TypeScript Migration** | Sprint 2 (Days 11–13) | Codebase cleanly partitioned into `src/` modules, Web Worker bridge ready for `manifold-3d`, zero build errors, passes test suite. |
| **M2.3** | **PWA & Offline Packaging** | Sprint 2 (Days 14–15) | Installable via iPad Safari "Add to Home Screen", runs full-screen offline with active Service Worker caching. |

---

*Authored by:* **UX & Application Architecture Lead (`@ux-lead`)**  
*Coordinated with:* `@coordinator`, `@kernel-lead`, `@slicer-guardrails`, `@roadmap-compiler`
