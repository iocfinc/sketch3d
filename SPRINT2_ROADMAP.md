# SKETCH3D — Sprint 2 Roadmap: 3D Modeller Basics, Specs & Verification Tests

**Target Model:** Antigravity (Gemini Flash)  
**Sprint Goal:** Implement the core 2D/3D modeller basics—mode separation, 2D primitives, corner rounds/fillets, Offset/Shell wall thickness, Smart Inferencing (Ortho + Midpoint OSNAP), Revolve (Lathe), and Smart Connect Z-stacking—while strictly obeying `DESIGN_GUARDRAILS.md`.

> **Mandatory Guardrails:** Keep `#panel2D` toolbar to **<= 6 visible controls**. Group primitives inside `Shapes ▾`, file I/O inside `Project ▾`, and multi-part actions inside `Parts ▾` click-to-expand popovers. Preserve `100dvh` single-screen fit on desktop/iPad landscape and `<= 375px` mobile parity.

---

## 1. Persona Usability Walkthroughs (Why These Basics Matter)

1. **3D Printing Starter (iPad + Apple Pencil):** Tries to draw freehand or drop a circle/rounded rectangle, gets stuck when tapping inserts random vertices. Needs `Freehand` / `Poly` / `Select` separation, `Shapes ▾`, and `Corner Radius`.
2. **EDC & Hardware Hobbyist (Bambu Lab A1):** Builds rib-cage wallets, cyberdeck bezels, and brackets. Needs `Offset / Shell` (instant uniform wall thickness without drawing inner polygons by hand), `Ortho + Midpoint` inferencing, and `Stack on Top / Smart Connect` for multi-level parts.
3. **Architectural & Lamp Explorer:** Needs `Revolve 360°` (`THREE.LatheGeometry`) to spin a 2D profile into cylindrical lamp bases, knobs, or shades, alongside `Corner Radius` and `Twist`.

---

## 2. Feature Specifications & Deterministic Test Cases

### F1: Explicit Mode Separation (`Freehand`, `Poly`, `Select / Edit`)
* **UI:** 3 compact icon+label buttons on the left of `#panel2D` toolbar: `Freehand`, `Poly`, `Edit`.
* **Behavior:**
  * `Freehand`: `pointerdown`/`touchstart` starts a raw stroke (`#FEFF00` dashed preview); `pointermove` appends points; `pointerup`/`touchend` runs Ramer-Douglas-Peucker (`RDP`, `epsilon = 2.5 mm`) simplification, auto-closes if start-to-end `< 15 mm`, and switches to `Edit`.
  * `Poly`: Tap to place crisp vertices; tap green start dot (`< 20px`) or `Close` to close, then auto-switch to `Edit`.
  * `Edit` (`Select / Edit`): Drag any vertex (`20px` hit radius), drag inside closed shape to translate all vertices/holes/cutouts together, or double-tap a vertex to delete it (`min 3` vertices). **Tapping empty space or an edge NEVER inserts a vertex in `Edit` mode.**
* **Tests:**
  * `T1.1`: Load `EDC Frame`, switch to `Edit`, tap `4px` off an edge -> `points.length` stays `7`.
  * `T1.2`: In `Freehand`, drag a closed loop -> `points.length >= 4`, `isClosed === true`, `extrudedMesh !== null`.
  * `T1.3`: In `Edit`, drag center of shape `+20 mm` X -> all `points`, `holes`, `cutouts` shift `+20 mm` X (clamped to `±128 mm`).

---

### F2: Basic 2D Shape Primitives (`Shapes ▾` Popover)
* **UI:** Click-to-expand `Shapes ▾` button in `#panel2D` toolbar opening a popover with `Rectangle`, `Circle`, `Hexagon`.
* **Behavior:**
  * Selecting a primitive enters placement mode: drag corner-to-corner (`Rectangle`) or center-to-radius (`Circle` = 32 pts, `Hexagon` = 6 pts) on `#sketchCanvas` with live `W × H mm` or `Ø mm` readout, then auto-switches to `Edit`.
  * Popover closes automatically on selection or outside click.
* **Tests:**
  * `T2.1`: Select `Circle`, drag `30 mm` radius -> `dimOverlay` reads `~60.0 × 60.0 × 8.0 mm`.
  * `T2.2`: Select `Rectangle`, drag `40 × 20 mm` -> `points.length === 4`, `isClosed === true`.

---

### F3: 2D Corner Rounds / Fillets (`Round` Control)
* **State & UI:** Add `cornerRadius` (`0–20 mm`, step `0.5 mm`, default `0`) to part state. Add compact `Round` slider in `#panel3D` control bar.
* **Geometry Logic:**
  * For each corner `B` between `A` and `C`: compute incoming/outgoing unit vectors, clamp `d = Math.min(cornerRadius, 0.45 * lenAB, 0.45 * lenBC)` to prevent self-intersection, compute tangent points `pIn` and `pOut`, and render `quadraticCurveTo(B.x, B.y, pOut.x, pOut.y)` on both `#sketchCanvas` and `THREE.Shape`.
* **Tests:**
  * `T3.1`: Set `cornerRadius = 20 mm` on a `10 × 10 mm` square -> clamps safely to `4.5 mm`, zero `NaN` vertices, valid `.STL` export (`triCount > 0`).
  * `T3.2`: Changing `Round` slider updates both 2D canvas corners and 3D mesh live.

---

### F4: Offset Edge / Shell Mode (`Shell` Wall Thickness)
* **Why:** Turns any closed polygon into a hollow frame, gasket, or rib-cage bezel in one tap (like Shapr3D's `Shell` / `Offset Edge`).
* **State & UI:** Add `shellEnabled: false` and `shellThickness: 2.4` (`1.2–15 mm`, step `0.4 mm`, matching `0.4 mm` nozzle multiples!) in `#panel3D` (compact toggle pill `Shell` + numeric `mm` input when active).
* **Geometry Logic:**
  * Compute the inward-offset polygon by shifting each edge inward along its unit normal by `shellThickness` and intersecting adjacent offset lines (miter-clamped to `<= 2 × shellThickness` at sharp corners).
  * If the resulting inner loop has positive area (`> 4 mm²`) and does not self-intersect, push it into `shape.holes` automatically (and draw it as a dashed `#73E6F1` inner wall on `#sketchCanvas`).
* **Tests:**
  * `T4.1`: Enable `Shell` (`2.4 mm`) on a `60 × 40 mm` rectangle -> 3D mesh renders a hollow frame with `2.4 mm` walls and `dimOverlay` outer dimensions stay `60 × 40 mm`.
  * `T4.2`: Set `shellThickness = 15 mm` on a `20 × 20 mm` square -> inner loop collapses safely without inverting faces or crashing WebGL.

---

### F5: Smart Inferencing & OSNAP (`90° Ortho` + `Midpoint`)
* **Why:** Brings SketchUp/Rhino precision to touch sketching without needing a keyboard.
* **Behavior (Active in `Poly` & `Edit`):**
  * **90° Ortho Snap:** When placing or dragging a point, if the angle from the previous point is within `±5°` of `0°`, `90°`, `180°`, or `270°`, snap `x` or `y` to match the previous point and draw a `#73E6F1` dashed guide line across the canvas.
  * **Midpoint & Vertex OSNAP:** If the pointer comes within `8px` of any existing edge midpoint or another vertex, snap to it and show a small `#00E56D` diamond/square marker.
* **Tests:**
  * `T5.1`: In `Poly` mode, place `(0, 0)`, then tap `(40, 2)` -> `90° Ortho` snaps second point to `(40, 0)`.
  * `T5.2`: Dragging a vertex near the midpoint of an opposite edge snaps to exact midpoint coordinates and clears guide lines on `pointerup`.

---

### F6: Revolve (Lathe 360°) & Smart Connect Z-Stacking (`parts[]`)
* **Multi-Part State Refactor:**
  * Migrate single-shape state to `state.parts = [ { id, name, type: 'extrude'|'revolve', points, holes, cutouts, baseZ, extrudeHeight, cornerRadius, shellEnabled, shellThickness, bevelSize, twistDeg, color } ]` + `activePartIndex`.
  * Add a compact `Parts ▾` popover in `#panel2D` with: `+ New Part`, `Stack on Top` (`baseZ = active.baseZ + active.extrudeHeight`, clamped so `baseZ + extrudeHeight <= 256 mm`), and `Mode: Extrude / Revolve`.
* **Revolve (`THREE.LatheGeometry`):**
  * When `part.type === 'revolve'`, map the 2D points' `x` (clamped `>= 0` radius from center axis `x = 0`) and `-y` (height) into `THREE.LatheGeometry(lathePoints, 48)`—instantly generating cylindrical lamp bases, knobs, and shades.
* **Smart Snap & Combined STL Export:**
  * In `Edit` mode, dragging a part within `5 mm` of another part's bounding-box edge snaps it flush with `0.2 mm` overlap for watertight slicing.
  * `exportBinarySTL()` merges all `state.parts` geometries (with `baseZ` and X/Z translations applied) into one Z-up binary `.stl`.
* **Tests:**
  * `T6.1 (A1 Height Budget)`: Part 1 (`baseZ: 0, height: 200 mm`) + `Stack on Top` Part 2 -> Part 2 `extrudeHeight` clamps to `<= 56 mm`.
  * `T6.2 (Revolve)`: Switch `Lamp Fin` or a half-profile to `Revolve` -> `THREE.LatheGeometry` renders a 360° solid centered on `(0, 0)` fitting within `256 × 256 × 256 mm`.
  * `T6.3 (Multi-Part STL)`: Export `.stl` with 2 stacked parts -> binary STL contains triangles from both parts (`triCount === part1Tris + part2Tris`).
  * `T6.4 (Legacy JSON)`: Loading a v1 `.json` file (no `parts[]`) wraps cleanly into `state.parts = [ legacyPart ]`.

---

## 3. Sprint Acceptance Checklist
- [ ] All tests `T1.1`–`T6.4` pass with `0` console errors.
- [ ] `100dvh` single-screen fit holds at `1280×800` and `1024×768`; `scrollWidth <= innerWidth` at `375×812`.
- [ ] `#panel2D` toolbar has `<= 6` visible controls (`Shapes ▾`, `Project ▾`, `Parts ▾` popovers close on outside click).
- [ ] `#fitBadge` remains visible on `375px` mobile.
