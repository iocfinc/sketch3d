# SKETCH3D — Canonical 5-Layer Product Map & Shared Contracts

> **Governance Rule:** Every UI control, parameter, geometry kernel, and export pipeline in SKETCH3D belongs to exactly one of the 5 progressive workflow stages below. No new top-level header buttons or unmapped toolbar rows are permitted.

---

## 1. The 5-Layer Product Map

| Stage | Layer Name | Viewport Mode | Parent Tools (`data-tool`) | Owned Sub-Parameters & DOM IDs | Future `sketch3d-mcp` Tool |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Sketch** | **1. 2D Primitives** | Full-Screen 2D (`#panel2D`) + Collapsible 3D Mini-Preview | `draw-freehand`, `draw-poly`, `draw-bezier`, `draw-edit`, `primitive-rect`, `primitive-circle`, `primitive-hex`, `sketch-plane`, `snap-grid`, `revolve-guide`, `sketch-undo`, `sketch-close`, `sketch-clear` | `modeFreehandBtn`, `modePolyBtn`, `modeBezierBtn`, `modeEditBtn`, `shapeRectBtn`, `shapeCircleBtn`, `shapeHexBtn`, `planeSelect` (`XY`/`XZ`/`YZ`), `snapToggleBtn` (`1`/`5`/`10`/`Off`), `revolveGuideBtn`, `undoBtn`, `closeShapeBtn`, `clearBtn`, `sketchCanvas`, `pointCountBadge` | `sketch_2d` |
| **2. 3D Form** | **2. 3D Generators** | Full-Screen 3D (`#panel3D`) + Floating Camera Pill | `gen-extrude`, `gen-revolve`, `loft`, `height-z`, `base-z`, `offset-clone`, `part-new`, `part-stack`, `part-delete`, `part-material` | `typeExtrudeBtn`, `typeRevolveBtn`, `typeLoftBtn` (`loftTopShapeSelect`, `loftTopScaleSlider`, `loftTwistSlider`), `extrudeSlider`, `extrudeInput`, `baseZInput`, `offsetCloneBtn`, `offsetCloneInput`, `partsList`, `newPartBtn`, `stackPartBtn`, `deletePartBtn`, `materialOpaqueBtn`, `materialClearBtn` | `generate_form` |
| **3. Adjust** | **3. Solid Modifiers** | Full-Screen 3D (`#panel3D`) + Ordered Toggleable Modifier Cards | `mod-shell`, `mod-round`, `mod-bevel`, `mod-twist`, `mod-hole`, `mod-standoff`, `mod-cutout`, `mod-cutout-grid`, `mod-nut-m3`, `mod-nut-m4`, `mod-csk-m3`, `mod-csk-m4`, `mod-split-joint`, `mod-color` | Ordered cards (`data-modifier`): `shell` (`shellToggleBtn`, `intentVesselBtn`, `intentLampshadeBtn`, `partIntentSelect`, `shellModeSelect`, `shellInput`), `round` (`roundSlider`, `roundVal`), `bevel` (`bevelSlider`, `bevelVal`), `twist` (`twistSlider`, `twistVal`), `fasteners` (`modeHoleBtn`, `modeStandoffBtn`, `modeCutoutBtn`, `gridArrayBtn`, `modeNutM3Btn`, `modeNutM4Btn`, `modeCskM3Btn`, `modeCskM4Btn`), `split` (`splitJointBtn`), `color` (`.color-swatch`) | `apply_modifier` |
| **4. Texture** | **4. Surface & Toolpath Modifiers** | Full-Screen 3D (`#panel3D`) + Unified Texture Studio | `tex-pattern`, `tex-depth`, `tex-freq`, `tex-open-weave`, `tex-bands`, `tex-band-mode`, `tex-bead-preview` | `texturePatternSelect` (`none`, `ripple`, `weave`, `wave`, `spiral`, `flute`, `gyroid`, `coral`, `strata`, `open-weave`, `perforated-weave`, `lfam-rib`), `textureDepthSlider`, `textureFreqSlider`, `weaveBandsSlider`, `weaveGapSlider`, `weavePillarsSlider`, `weaveTwistSlider`, `textureExecBadge` (`Mesh + Toolpath` / `Toolpath-Only`), `bandEnabledBtn`, `bandCountInput`, `bandModeSelect`, `bandFreqInput`, `bandPhaseSelect`, `bandDepthInput`, `toolpathPreviewBtn` | `apply_texture_bands` |
| **5. Print** | **5. Print & Safety Services** | Full-Screen 3D (`#panel3D`) + Print Readiness Panel | `print-slicer-target`, `print-auto-arrange`, `print-proof-scale`, `print-slicer-profile`, `export-3mf`, `export-stl`, `prosumer-unlock`, `export-gcode`, `export-gcode-3mf` | `slicerTargetSelect` (`bambu_studio` / `orcaslicer`), `autoArrangeBtn`, `scaleFullBtn`, `scaleMiniBtn`, `scaleSwatchBtn`, `proofScaleSelect`, `slicerProfileSelect` (`vase`, `basket_weave_arachne`, `clear_glass`, `lfam`), `slicerProfileSummary`, `export3mfBtn`, `exportStlBtn`, `prosumerToolpathBtn`, `prosumerToolpathPanel`, `toolpathNozzleSelect`, `toolpathPrimitiveSelect`, `toolpathScale50Chk`, `toolpathUseDonorChk`, `donorGcodeInput`, `exportGcodeBtn`, `exportGcode3mfBtn`, `toolpathStatusText` | `export_print_bundle` |

---

## 2. Minimal Top Header Contract (`<= 6` Visible Controls)

Top header (`<header id="appHeader">`) must never exceed **6 visible top-level control groups** on desktop (`1280×800`) and iPad (`768×1024`):
1. **Brand Lockup**: `SKETCH3D A1 STUDIO`
2. **Templates Popover** (`#templatesMenuBtn`, `data-tool="templates-menu"`): Consolidates quick presets (`EDC Frame`, `Truss`, `Lamp Fin`, `Vase Shade`) and all 7 Studio Presets (`flute`, `gyroid`, `coral`, `strata`, `bauble`, `tree`, `cube`).
3. **5-Stage Progress Rail** (`#stageRail`): `#stageTab1`..`#stageTab5` with `data-stage="1..5"`.
4. **Project Popover** (`#projectMenuBtn`, `data-tool="project-menu"`): Save `.json` (`#saveProjectBtn`) and Load `.json` (`#loadProjectBtn` / `#loadProjectInput` routed through `migrateProjectV1ToV2()`).
5. **Bed Fit Status Pill** (`#fitBadge`, `data-tool="bed-status"`).
6. *(Mobile `< lg` only)* View Switcher (`#mobileViewToggle` with `#viewSplitBtn`, `#view2DBtn`, `#view3DBtn`).

---

## 3. Shared Module Contracts

### 3.1 `src/ui/stageRouter.js` (`<= 350` lines)
- **Exports:** `STAGES`, `initStageRouter({ state, sketch2D, viewport3D, onStageChange })`
- **Returned API:** `{ setStage(stageNum), getStage(), toggleMiniPreview(force?), syncModifierCards(part), syncStageUI() }`
- **DOM Hooks:**
  - Stage tabs: `[data-stage="1..5"]` (`aria-selected="true|false"`)
  - Stage inspector panels: `[data-stage-panel="1..5"]`
  - Modifier cards: `[data-modifier="..."]` with `[data-modifier-toggle]` and `[data-modifier-body]`
  - Body attribute: `document.body.dataset.activeStage = "1".."5"`
- **Event:** Dispatches `CustomEvent('sketch3d:stagechange', { detail: { stage, prevStage, viewportMode } })` on `window`.

### 3.2 `src/utils/projectMigration.js` (`<= 200` lines)
- **Exports:** `PROJECT_SCHEMA_VERSION = 2`, `migrateProjectV1ToV2(rawJson)`, `serializeProjectV2(state)`
- **Schema v2 Envelope:**
  - `schemaVersion: 2`, `app: 'SKETCH3D'`, `activeStage` (`1..5`), `activePartIndex`, `scaleMode` (`'full'|'mini'|'swatch'`), `slicerTarget` (`'bambu_studio'|'orcaslicer'`), `slicerProfile`, `revolveGuide`, `snapEnabled`, `snapStep`, `wireframe`, `parts[]`.
  - Upgrades v1 single-part preset objects or v1 `{ parts: [...] }` saves cleanly, preserving all geometry points, `bezierNodes`, `holes`, `standoffs`, `cutouts`, `texturePattern`/`textureDepth`/`textureFreq`, `bandEnabled`/`bandCount`/`bandMode`/`bandFreq`/`bandPhaseDeg`/`bandDepth`, `linkedParentId`, `offsetMm`, and `materialTag` (`'opaque'|'clear'`).

### 3.3 `src/export/threemfExporter.js` Stage 5 Slicer Profiles
- Unified `Bambu Studio` & `OrcaSlicer` profile metadata via `getSlicerProfileSettings(profile, slicerTarget)`.
- Verified **Basket-Weave Arachne** preset (`basket_weave_arachne`):
  - `wall_generator: 'arachne'`
  - `wall_loops: '2'`
  - `layer_height: '0.2'`
  - `line_width: '0.42'`
  - `detect_overhang_wall: '1'`
  - `bridge_speed: '50'`
  - `overhang_4_4_speed: '10'`
  - `enable_support: '0'`
