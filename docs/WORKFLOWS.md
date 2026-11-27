# SKETCH3D — Stage 1–5 Workflows & Geometry Contracts

> Canonical operational rules for the 5-stage parametric pipeline (`Sketch -> 3D Form -> Adjust -> Texture -> Print`), geometry caching, slicer profile derivation, and bed-adhesion checks.

---

## 1. 4-Stage Geometry Pipeline Cache (`src/geometry/pipelineCache.js`)

- **Hierarchical Stages:** `profile` (Stage 1 2D curve/fillet/plane) -> `baseGeo` (Stage 2 Extrude / Revolve / Loft + `extrudeHeight` + `baseZ`) -> `solidGeo` (Stage 3 Shell + Bevel + Twist) -> `texGeo` (Stage 4 Surface Texture + Band Subdivision + Open-Weave).
- **Strict Isolation Rule:** `defaultBuildProfile` caches only Stage 1 2D curve geometry (`profileType`, `points`, `bezierNodes`). Downstream Stage 2–4 properties (`extrudeHeight`, `baseZ`, `shellEnabled`, `bevelSize`, `twistDeg`, `texturePattern`) must never be overwritten by cached Stage 1 snapshots.
- **Stage 2 `Height Z` Dispatch:** `#extrudeInput` binds `input`, `change`, and `blur` (and `#extrudeSlider` binds `input` and `change`) directly to `rebuild3DMesh()` + `updateCameraTarget()` with zero debounce gating.

---

## 2. Revolve 360° Controls & Plane Sync

- **Sketch Plane Synchronization:** Revolve half-profiles (`R >= 0` vs vertical height) reside on `Front (XZ)`. Loading a Revolve preset (`vase`, `flute`, `gyroid`, `coral`, `strata`, `bauble`, `tree`) or switching a part from `XY` to `Revolve 360°` syncs `#planeSelect` to `XZ` (`Front (XZ)`). Lathe generation stays upright around the vertical Y-axis (`Z-up` in slicer export) and skips `transformGeometryToPlane`.
- **Revolve `Height Z` Lock:** In `Revolve 360°` mode, `#extrudeInput` and `#extrudeSlider` lock/disable with tooltip `"Driven by 2D profile Y-span"` and display the live profile Y-span.

---

## 3. Stage 3 Modifier Composition & Inward Bevel (`src/geometry/meshBuilder.js`)

- **Deterministic Order:** `Corner Round` -> `Edge Bevel` -> `Shell` -> `Twist` -> `Surface Texture`.
- **Nominal Bounds Preservation:**
  - `Edge Bevel` defaults to `0.0 mm`.
  - When `bevelSize > 0` on closed extrusions, `Corner Round` is sampled into explicit polygon points first, then inset inward by `effBevel` (`computeShellInner`) and extruded with `depth = height - 2 * effBevel` + `bevelSize = bevelThickness = effBevel` translated `+effBevel` along Y so nominal `XY × Z` bounds remain exact (e.g. `50.0 × 50.0 × 35.0 mm` with `Corner Round = 3 mm` and `Edge Bevel = 0.5 mm`).
  - Hollow extrusions (`Shell: On`, `hollow`) apply `Corner Round` fillets cleanly before inward shell offsetting.

---

## 4. Volumetric Filament Mass & Bed Contact (`src/export/stlExporter.js`)

- **Signed-Volume Estimation:** `estimateFilamentMass(parts, meshes, { material })` computes exact signed triangle mesh volume (using triangle indices without double-counting) so `Shell: On` (`hollow`) accurately evaluates `outer_volume - inner_cavity_volume`, strictly less than the equivalent `Shell: Off` solid volume using consistent filament density (`PLA = 1.24 g/cm³`, `PETG = 1.27 g/cm³`, `ABS = 1.04 g/cm³`).
- **`Z = 0` Flat-Base Contact Check:** `analyzeBedContact(meshes)` sums XZ-projected area of triangles resting within `0.25 mm` of `minY` (`Z = 0`) and flags low-contact models (e.g. point-base `Christmas Bauble`) in Stage 5 `#bedContactWarning`.

---

## 5. Stage 4/5 Readouts, Slicer Auto-Profile & WebGL Diagnostics

- **Stage 4 Pitch Readout:** `#texturePitchVal` displays `Height / Waves` (`mm`) next to the `Waves` slider.
- **Stage 5 Slicer Auto-Derivation (`src/export/threemfExporter.js`):**
  - `open-weave` / `perforated-weave` -> `basket_weave_arachne` (`spiral_mode: "0"`, `wall_generator: "arachne"`)
  - `lfam-rib` -> `lfam` (`spiral_mode: "0"`)
  - `Shell: On` + `vase_proxy` (or single-wall `<= 1.0 mm`) -> `vase` (`spiral_mode: "1"`)
  - `Shell: On` + `hollow` (`> 1.0 mm` or `lampshade` intent) -> `multi_perimeter` (`spiral_mode: "0"`)
  - `Shell: Off` -> `standard` (`spiral_mode: "0"`)
  - Manual selection in `#slicerProfileSelect` persists (`state.slicerProfileManual = true`) until a new preset or board clear resets auto-derivation.
- **Dynamic Material Unit & Toast Filenames:** `#estimateOverlay` switches between `PLA` and `PETG` (`clear_glass` profile or clear non-vase material), and all Stage 5 export toasts include the downloaded filename.
- **WebGL Viewport Safeguards (`src/view/viewport3d.js`):** Initializes `preserveDrawingBuffer: true`, `setClearColor(0x020203, 1)`, initial `updateCamera()`, `ResizeObserver`, `webglcontextlost`/`webglcontextrestored` handling, and `#webglFallbackBanner` diagnostics.
