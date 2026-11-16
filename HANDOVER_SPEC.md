# SKETCH3D — Project Handover & Architecture Specification

**Target Platform:** iPad (Safari / Touch & Apple Pencil), iPhone, & Desktop Web  
**Target Printer:** [Bambu Lab A1](https://bambulab.com/en/a1/tech-specs) (`256 × 256 × 256 mm` build volume, `0.4 mm` standard nozzle)  
**Current MVP Stack:** Single-file HTML5 + Tailwind CSS (`3.4.17`) + Three.js (`r128`)

---

## 1. User Inputs & Design Requirements (Captured During Session)

1. **Core Concept:** A simple, beginner-friendly 3D sketch renderer inspired by Rhino/Grasshopper and SketchUp, focused on rapid 3D printing workflows.
2. **Primary Hardware Workflow:** Quick sketching on an iPad (or phone/desktop), translating 2D/parametric sketches into watertight 3D printable objects for a **Bambu Lab A1** printer.
3. **Brand UI Color Palette** (from `IMG_1227.jpeg`):
   * **Dark Background:** `#020203`
   * **Yellow (Primary Action / Active):** `#FEFF00`
   * **Pink (3D Mesh / Secondary):** `#FF66D9`
   * **Green (Grid / Bed / Ready / Export):** `#00E56D`
   * **Cyan (Wireframe / Dimensions / Cutouts):** `#73E6F1`
4. **Reference Design Archetypes** (from uploaded inspiration images):
   * **Skeletonized EDC Cardholders & Frames** (`IMG_1266.jpeg`, `IMG_0726.jpeg`): Angled cutouts, chamfered corners, M3/M4 screw holes.
   * **Flat-Lay Keychains & Sprue Tags** (`IMG_1271.jpeg`, `IMG_1272.jpeg`): Crisp 2.5D extruded silhouettes.
   * **Cyberdeck / Handheld Enclosures** (`IMG_1256.jpeg`): Layered faceplates, mounting bosses, cutouts.
   * **Parametric Textured Lampshades** (`IMG_0730.jpeg`): Twisted/finned cylindrical profiles.
   * **Modular Truss Frames & Case Inserts** (`IMG_0910.jpeg`, `IMG_1020.png`): Structural brackets sized to equipment/printer bounds.
5. **Hard Constraints & UX Fixes:**
   * **Z-Height Limit:** Extrusion height clamped in JavaScript (`MAX_HEIGHT_MM = 256`) to match the Bambu Lab A1 maximum print height.
   * **Mobile / iPad Touch Support:** Full `touchstart`/`touchmove`/`touchend` + `pointer` handling with generous hit targets (`20px`) for dragging vertices, inserting points on edges, and switching between `Split`, `2D`, and `3D` views on narrow screens.

---

## 2. Included Files

* `index.html` — Complete, self-contained v1 web application (no build step or backend required).
* `HANDOVER_SPEC.md` — This specification, expansion roadmap, and deployment architecture document.

---

## 3. Current Implemented Features (v1 — MVP)

* **2D Sketch Pad (`<canvas>`):**
  * Scaled to `256 × 256 mm` with 10 mm / 50 mm gridlines and toggleable `5 mm` snap.
  * Three modes: `Draw / Edit` (place points, drag vertices, tap edges to insert points), `+ M3 Hole` (drop circular mounting holes), and `+ Cutout` (draw polygonal internal cutouts).
  * Three starter presets: `EDC Frame`, `Truss`, and `Lamp Fin`.
* **3D Viewport (Three.js):**
  * Live `THREE.ExtrudeGeometry` with `1–256 mm` Z-height clamping.
  * Parametric Grasshopper-style modifiers: **Bevel (`0–4 mm`)** and **Twist (`0–180°`)**.
  * `256 × 256 × 256 mm` Bambu Lab A1 build volume cage, wireframe toggle, auto-spin, and touch orbit/pinch zoom.
* **3D Printing Utilities:**
  * Live bounding-box dimensions (`W × D × H mm`) and rough PLA filament weight estimate (`g`).
  * **Binary `.STL` Exporter** (`exportBinarySTL()`) converting Three.js Y-up coordinates to slicer-ready Z-up coordinates (`sketch3d_bambu_a1.stl`).

---

## 4. Product Expansion Roadmap (Phases 1 → 3)

### Phase 1: Cubic, Skeletal & Mechanical (Current MVP + Immediate Polish)
* **Focus:** Trusses, beams, rib-cage wallets, M3/M4 screw-hole brackets, and layered cyberdeck faceplates.
* **Immediate Next Increments:**
  * Multi-layer Z-stacking (stack multiple 2D sketches at different Z heights).
  * Snap-fit / screw-hole tolerance presets (`0.2 mm` clearance for M3/M4).
  * `.json` project save/load so sketches can be reopened and iterated.

### Phase 2: Lofting, NURBS & Organic Volumes (Zaha Hadid / Lamp Shades / Coral)
* **Focus:** Graduating from flat 2.5D extrusions to fluid, multi-section organic surfaces, parametric curves, and sculptural lamp shades.
* **Geometry & Kernel Upgrade:**
  * **Multi-Section Lofting & Curves:** Allow sketching 2+ cross-sections at different Z elevations (or along a 3D spine curve) and lofting smoothly between them using [Three.js `NURBSCurve` / `NURBSSurface`](https://threejs.org/docs/pages/NURBSSurface.html) or [`verb-nurbs`](https://github.com/pboyer/verb).
  * **Watertight Booleans (WASM):** Integrate [`manifold-3d`](https://www.npmjs.com/package/manifold-3d) (WebAssembly) inside a Web Worker (`@bitbybit-dev/manifold-worker` pattern) so organic lofted shells, coral-like branches, and boolean cutouts always produce guaranteed watertight, slicer-ready solids without crashing the mobile UI thread.
  * **3MF Export:** Upgrade from `.STL` to `.3MF` (as recommended by [Manifold-3D](https://www.npmjs.com/package/manifold-3d)) to preserve exact manifold topology and support multi-color AMS Lite material groups.

### Phase 3: Printable 3D Surface Textures (Basket Weave, Chain Links, Lattices)
* **Focus:** Replacing smooth, soft surfaces with real, physical 3D-printable surface geometry (not shader-only bump maps).
* **Procedural Texture Pipeline:**
  * **UV-Mapped Mesh Displacement & Shelling:** Subdivide lofted/extruded surfaces and displace vertices along surface normals using procedural heightfields (knurling, ribbed fins, sinusoidal ripples).
  * **Interlocking & Woven Geometry:** Procedural generators for **basket weave** (alternating over/under spline tubes) and **chain-link / Voronoi lattices** conformed to base NURBS surfaces.
  * **Printability Guardrails:** Enforce minimum feature thickness (`>= 0.8 mm` for a `0.4 mm` nozzle) and overhang-angle warnings (`> 45°`) before export.

---

## 5. Microsite & Deployment Architecture (`iocfinc.github.io`)

### Client-Side Microsite Design (iPad, iPhone, Desktop)
* **100% Client-Side Compute:** All 2D sketching, NURBS/lofting math, WASM Boolean operations, and `.STL`/`.3MF` file generation run locally on the user's device via WebGL + WebAssembly + Web Workers. Zero backend servers, zero API latency, and **$0 hosting cost**.
* **Progressive Web App (PWA):** Add a `manifest.json` and Service Worker in Phase 2 so the microsite can be added to the iPad Home Screen ("Add to Home Screen") and run full-screen offline.
* **Responsive Viewport Architecture:** Maintain the adaptive `Split` (desktop/iPad landscape) and `2D / 3D` tab switcher (iPhone/iPad portrait) with `touch-action: none` on canvases.

### Long-Term Hosting on GitHub Pages
* **Recommended Structure:**
  1. Create a dedicated repository `iocfinc/sketch3d` on GitHub.
  2. Enable **GitHub Pages** (Deploy from `main` branch or GitHub Actions), which automatically publishes the microsite at `https://iocfinc.github.io/sketch3d/`—cleanly nested under your `iocfinc.github.io` landing page (or mapped to a custom domain via `CNAME` if using `iocf.inc`).
  3. **Relative Path Discipline:** Keep all script, WASM, and asset references relative (`./`) so the app runs identically in local preview, Canvas, and GitHub Pages subpath URLs.
  4. **Build Evolution:** Keep Phase 1 as zero-build `index.html` for instant iteration; in Phase 2 (when adding `manifold-3d` WASM + `verb-nurbs`), introduce a lightweight **Vite + TypeScript** build with a GitHub Actions workflow that compiles and deploys `dist/` to GitHub Pages on every push.