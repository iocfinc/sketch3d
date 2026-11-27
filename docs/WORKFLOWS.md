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
- **Revolve `Height Z` Proportional Z-Span Scaling:** In `Revolve 360°` mode, `#extrudeInput` and `#extrudeSlider` remain enabled (`"Scales revolved profile Z-span"`) and proportionally scale the revolved profile's vertical coordinates (and linked offset clones) around the base anchor, keeping `Size Z` and mass live-synced.
- **True Radial Offset on Revolved Linked Clones (`src/geometry/offsetClone.js`):** Revolved half-profile (`R >= 0`) offsets expand outer wall radii strictly by `+offsetMm` (`>= +2 * offsetMm` OD) without shelf folding or self-intersections, while pointed apexes (`R <= 1.5`) extend vertically by `+offsetMm`.
- **Stage 1 Numeric Vertex Inputs, Multi-Loop & Full Undo:** `#vertexCoordWrap` exposes live `(R, Z)` / `(X, Y)` numeric inputs, concentric circle diameter insertion, automatic concentric inner/outer loop detection (`src/canvas/multiLoopHelper.js`), and a deep snapshot `undoStack` restoring replaced primitives and deleted contours completely.

---

## 3. Stage 3 Modifier Composition & Inward Bevel (`src/geometry/meshBuilder.js`)

- **Deterministic Order:** `Corner Round` -> `Edge Bevel` -> `Shell` -> `Twist` -> `Surface Texture`.
- **Per-Part Target Scoping (`ISSUE-010`):** Stage 3 (`#stage3TargetSelect`/`#stage3TargetPills`) and Stage 4 (`#stage4TargetSelect`/`#stage4TargetPills`) target a specific part (`Inner` / `Outer`) or intentionally apply across `All` parts, ensuring smooth inner diffusers and textured outer shells stay isolated.
- **Independent Floor, Open Bottom, Top Vent & Coaster Wells (`src/geometry/extrudeMods.js`):** `floorThickness`, `openBottom`, and `topVentMm` operate independently from wall `shellThickness`. Multi-loop concentric extrusions with `floorThickness > 0` build solid floors under recessed wells (coasters).
- **Split Lip Tolerance & Snap-Fit Catch (`src/geometry/splitBody.js`, `src/geometry/splitGeometry.js`):** Stage 3 `6. Split Lip / Groove` exposes `Lip Tolerance (mm)` (`0.15–0.30 mm`, default `0.20 mm`) and `Snap-Fit Nub / Catch`, emitting watertight stepped Base/Lid parts with toast + part-count confirmation.
- **Lighting & Base Cutouts (`src/config/hardwarePresets.js`):** Provides `Tealight Ø42`, `Bambu Kit 001 Ø60`, `E14 Collar Ø29`, `Cord Slot 6×6`, and a non-exportable translucent `PLA Thermal Guide`.
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
- **Dynamic Material Unit, Clear/Polymer Decoupling & Toast Filenames:** `#partPolymerSelect` (`PLA`/`PETG`/`ABS`) is decoupled from optical finish (`Opaque`/`Clear`), so `Clear PLA` preserves `PLA` (`1.24 g/cm³`) density and readouts. `#estimateOverlay` switches accurately by polymer (and `clear_glass` defaults to `PETG` unless overridden).
- **Stage 5 AMS Slot Mapping, Un-nest Shells & Outer Brim (`src/export/threemfLayout.js`):** Each part maps to an AMS extruder slot (`1..4`) in `Metadata/model_settings.config`, `Un-nest Concentric Shells` computes non-overlapping `.3MF` `<item transform="..."/>` placements, and `Outer Brim (mm)` embeds `brim_type: 'outer_only'` + `brim_width` in `Metadata/project_settings.config`.
- **WebGL Safeguards & Canvas2D Wireframe Fallback (`src/view/viewport3d.js`, `src/view/canvas2dFallback.js`):** Initializes `preserveDrawingBuffer: true`, `setClearColor(0x020203, 1)`, `ResizeObserver`, `webglcontextlost`/`webglcontextrestored`, and activates a Canvas2D projected wireframe fallback whenever WebGL context creation fails so `Wire`, `Spin`, and `Reset` remain interactive.

---

## 6. Unified Printer Profiles & Local Stdio `sketch3d-mcp` Parity (`Phase C`)

- **Canonical Printer Registry (`src/export/printerProfile.js`):** Defines `bambu_a1` (`256×256×256`, `M83`, `[10, 246]` safe XY), `bambu_a1_mini` (`180×180×180`, `M83`, `[10, 170]` safe XY), and `orca_generic` (`250×250×250`, `M83`, `[10, 240]` safe XY) with unified nozzle/bed/cooling/flow settings across `Bambu Studio` and `OrcaSlicer`.
- **Stage 5 Synchronization:** Changing `#printerProfileSelect` or `#slicerTargetSelect` dynamically updates `#fitBadge`, `#autoArrangeBtn` plate dimensions, `#printerBadgeLabel`, `viewport3D.setBedDimensions()`, `.3MF` metadata/centering, and `gcodeSafetyGate.js` safe envelopes without adding any top-header controls.
- **Transport-Agnostic `sketch3d-mcp` (`mcp/toolHandlers.mjs`, `mcp/sketch3d-mcp.mjs`):** Exposes 6 strict-schema JSON-RPC tools (`sketch_2d`, `generate_form`, `apply_modifier`, `apply_texture_bands`, `inspect_and_render`, `export_print_bundle`) running directly over `src/geometry/**` and Schema V2 `.json` (`migrateProjectV1ToV2` / `serializeProjectV2`) for 1:1 human/agent round-trip parity.
