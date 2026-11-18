# SKETCH3D — Design Rules, UI Guardrails & Anti-Regression Policy

**Purpose:** Mandatory rules for any AI coding agent (Antigravity / Gemini Flash) or contributor modifying `iocfinc/sketch3d`.  
**Core Principle:** Never break existing user workflows or rewrite the UI layout during feature iterations.

---

## 1. Immutable Design System & Brand Tokens

Do **not** change the color palette, typography, or core split-pane layout unless explicitly instructed by the product owner.

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--bg-dark` | `#020203` | App background, 2D/3D canvas backdrop |
| Surface Panel | `#0b0b10` / `#07070b` | Cards, header, control bars (`border: #1e1e2a`) |
| `--brand-yellow` | `#FEFF00` | Primary active mode, slider thumbs, Z-height readout, warnings |
| `--brand-pink` | `#FF66D9` | Default 3D mesh color, M-hole markers, Clear/Twist accents |
| `--brand-green` | `#00E56D` | Bambu Lab A1 bed border, closed-shape state, Export `.STL` CTA |
| `--brand-cyan` | `#73E6F1` | Wireframe edges, dimension overlays, cutout polygons |

* **Typography:** `Inter` (sans-serif) for UI, `monospace` for millimeter/gram readouts.
* **Layout Architecture:**
  * Desktop / iPad Landscape (`lg:`): 2-column grid (`grid-cols-1 lg:grid-cols-2`) with **2D Sketch Pad** on the left and **3D Viewport + Sliders** on the right.
  * Mobile / Portrait (`< lg`): `Split` / `2D` / `3D` view switcher in the header so canvases never get squished below `240px`.

---

## 2. Surgical Edit Rules for AI Agents (Antigravity)

1. **Patch, Never Rewrite:** When adding a feature, modify only the targeted HTML/CSS/JS blocks. **Never** regenerate the entire `index.html` from scratch or swap frameworks (e.g., do not introduce React, Vue, or build-step bundlers unless a phase explicitly requires it).
2. **Preserve Existing Contracts & IDs:** Never rename or delete existing interactive element IDs or state keys (`sketchCanvas`, `threeContainer`, `extrudeSlider`, `extrudeInput`, `bevelSlider`, `twistSlider`, `exportStlBtn`, `presetCardBtn`, `presetHexBtn`, `presetLampBtn`) without updating all listeners and tests.
3. **Touch & Pointer Parity:** Every canvas interaction must support both mobile touch (`touchstart`, `touchmove`, `touchend` with `passive: false` + `touch-action: none`) and desktop pointer/mouse events (`pointerdown`, `pointermove`, `pointerup`). Minimum vertex hit radius: `20px`.
4. **Hardware Constraints:** Keep `BED_SIZE_MM = 256` and `MAX_HEIGHT_MM = 256` (Bambu Lab A1) enforced in JavaScript clamping logic.
5. **No Dead Controls:** Every visible button, tab, slider, or input must mutate state and trigger `drawSketch()` / `rebuild3DMesh()`.

---

## 3. Mandatory Pre-Commit / CI Functionality Checks

Before committing or deploying any iteration to `https://iocfinc.github.io/sketch3d/`, run these checks (via Playwright or headless browser in CI):

1. **Zero Runtime Errors:** Page loads with `0` `console.error` and `0` uncaught `pageerror` events.
2. **Responsive Overflow Check:** At `375×812` (iPhone), `768×1024` (iPad), and `1280×800` (Desktop), verify `document.documentElement.scrollWidth <= window.innerWidth` (zero horizontal scrolling).
3. **2D Canvas Interaction Check:**
   * Clicking/tapping `Clear` resets `state.points` to `0`.
   * Tapping 3+ points on `#sketchCanvas` and tapping `Close` produces a valid 3D mesh (`extrudedMesh !== null`).
   * Dragging a vertex updates `#dimOverlay` live.
4. **3D & Parametric Controls Check:**
   * Changing `#extrudeSlider` or `#extrudeInput` to `300` clamps to `256 mm`.
   * Adjusting `#bevelSlider` and `#twistSlider` updates the 3D geometry without throwing WebGL errors.
5. **STL Export Check:** Clicking `#exportStlBtn` triggers a non-empty binary `.stl` download (`> 84 bytes`).

---

## 4. Antigravity Recovery Prompt (If UI Was Broken)

Paste this into Antigravity if an iteration broke the UI:

> "Read `DESIGN_GUARDRAILS.md` first. Our UI regressed in the last edit. Restore the original split-pane `#020203` / `#FEFF00` / `#FF66D9` / `#00E56D` / `#73E6F1` layout and all existing controls from the last working commit (`git log -n 5`), then re-apply ONLY the requested feature using minimal, surgical edits. Verify every item in Section 3 of `DESIGN_GUARDRAILS.md` before finishing."
