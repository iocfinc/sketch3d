# SKETCH3D — Agent Operating System & Brand Identity

> **Brand Ethos:** Observation as Craft. Surgical precision, zero-waste CAD engineering, and uncompromising visual thoroughness.  
> **Workspace Context:** Browser-native and iPad-first parametric 3D modeler for the Bambu Lab A1 ecosystem ($256 \times 256 \times 256\text{ mm}$).

---

## 1. Brand Identity & Design System Alignment

`sketch3d` embodies the **Hydrogen Design System v2.0** (`../hydrogen-brand-kit-v2/`):
- **Obsidian Vice Dark Mode:** The canvas and split-pane interface map directly to `[data-theme="obsidian-vice"]` using `--bg-dark: #020203` and elevated panel surfaces (`#0b0b10` / `#07070b`).
- **High-Visibility Accent Matrix:**
  - `--brand-yellow` (`#FEFF00`): Primary active tool state, slider thumbs, Z-height readout, telemetry badges.
  - `--brand-pink` (`#FF66D9`): Default 3D mesh surface, M-hole markers, twist/clear accents.
  - `--brand-green` (`#00E56D`): Bambu Lab A1 bed boundary, closed-path state, export `.STL` CTA.
  - `--brand-cyan` (`#73E6F1`): Wireframe edges, dimension overlays, CSG boolean cutouts.
- **Accessibility & Contrast:** All text/background pairs maintain strict WCAG 2.1 AA compliance ($\ge 4.5:1$ for body, $\ge 3:1$ for large display readouts).
- **Zero-Bundler Philosophy:** Vanilla ES Modules with zero Webpack, Vite, or Babel bloat. Fast loading, instant debugging, zero build lag.

---

## 2. Adversarial Verification ("Elephant Goldfish" Testing)

We do not test only the "happy path." We execute **Elephant Goldfish** stress testing: probing the paradoxical boundary where massive mechanical constraints collide with microscopic, delicate features.

Every feature, geometry kernel iteration, or texture generator must pass verification against the **4 Canonical Product Archetypes**:

1. **Minimalist Cylindrical Vase (Revolve 360° + Wave/Spiral/Flute Wrapping):**
   - *Stress Vector:* Revolve coordinate normalization, profile arc resampling, and texture decoupling.
   - *Requirement:* Outer wall must displace along $\theta$ for spiral/flute and $Y$ for wave, while the inner cavity wall remains strictly concentric with drift $< 0.01\text{ mm}$.
2. **Christmas Bauble Ornament (Spherical Lathe Revolve + Spiral Bulb):**
   - *Stress Vector:* Teardrop profile curvature, polar singularity handling, and hollow vase-mode shelling.
   - *Requirement:* Outer diameter $70 \pm 2\text{ mm}$, height $80\text{ mm}$, shell thickness $1.6\text{ mm}$, estimated mass $< 35\text{ g}$.
3. **Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave Needle Ridges):**
   - *Stress Vector:* Lathe overhang angles across 4 tiered shelf steps.
   - *Requirement:* Overhang slope must not exceed $55^\circ$ (support-free FDM printing), with zero overhang warnings and strict Bambu A1 bed envelope fit ($\le 256\text{ mm}$).
4. **Precision Cube with Fastener Hardware (Extrude + Bevel + CSG Boolean Engine):**
   - *Stress Vector:* Manifold-3D WASM boolean operations, through-bore cutting, and captive hex nut pocket milling.
   - *Requirement:* Clean $4.5\text{ mm}$ cylindrical bore and M4 hex pocket ($a/f = 7.0\text{ mm}$) forming a watertight 2-manifold solid.

---

## 3. Multi-Angle Orbit Visual Inspection Standard (VLM Evaluation)

A single 2D projection is blind. An agent or Visual Language Model (VLM) judge must never declare a 3D model valid from a single static viewport screenshot. 

All automated evals generate a **4-Quadrant Multi-Angle Orbit Contact Sheet** ($1200 \times 800\text{ px}$, 2x2 grid):

```
+------------------------------------+------------------------------------+
|   ISOMETRIC (3/4 PERSPECTIVE)      |     TOP (CAVITY & OVERHANGS)       |
|   θ = π/4, φ = π/3.2               |     θ = 0, φ = 0.15                |
+------------------------------------+------------------------------------+
|   FRONT (PROFILE & TEXTURE)        |     REAR / BACK (SEAM INTEGRITY)   |
|   θ = 0, φ = π/2.05                |     θ = π, φ = π/2.05              |
+------------------------------------+------------------------------------+
```

### VLM Review Rubrics
- **Quadrant 1 (Isometric):** Confirms overall 3D volume, perspective proportions, surface texture relief depth, and lighting interaction.
- **Quadrant 2 (Top Cavity):** Confirms hollow wall concentricity, interior hollow cavity clearance, and absence of interior surface bleed.
- **Quadrant 3 (Front Profile):** Confirms base flatness, vertical profile alignment, step transitions, and overhang slopes.
- **Quadrant 4 (Rear / Back):** Sweeps $180^\circ$ around the Z-axis to verify full $360^\circ$ seam closure, ensuring no unrendered back faces, gaps, or mesh inversion.

---

## 4. Disk Hygiene & Archive Rotation Policy

Because adversarial evals run frequently in local development and CI, disk space must be rigorously governed:

- **`evals/runs/latest/`**: Houses the freshest evaluation run artifacts (screenshots, multiview contact sheets, and `adversarial_verdict.json`). Ignored by Git.
- **`evals/runs/archive/`**: Timestamped archive of past runs (`run_YYYYMMDD_HHMMSS/`). Managed by `scripts/eval_archive_manager.mjs`.
  - **Retention Limit:** Maximum **3 past runs** retained in archive.
  - **Storage Quota:** Total storage in `evals/runs/` is capped at **40 MB**. Older runs are automatically purged.
- **`evals/history.jsonl`**: Immutable, append-only JSON Lines ledger tracking run timestamp, commit hash, verdict, pass/fail counts, and artifact disk footprints. Tracked in Git.
- **`evals/samples/`**: Canonical golden reference benchmarks (`sample_*_multiview.png` + `golden_benchmarks.json`) committed to Git as ground truth for future evaluators.

---

## 5. Architectural Guardrails & Budgets

Adhere strictly to `DESIGN_GUARDRAILS.md`:
1. **File Budget:** Every file must remain $\le 500$ lines. Specifically, `src/app.js` is capped at **500 lines**. Refactor helper logic into modular domain files under `src/geometry/`, `src/view/`, or `src/config/`.
2. **Preserve Interactive DOM IDs:** Never remove or alter interactive element IDs (`sketchCanvas`, `threeContainer`, `extrudeSlider`, `extrudeInput`, `bevelSlider`, `twistSlider`, `exportStlBtn`, etc.).
3. **Touch & Pointer Parity:** Mobile touch (`touchstart`, `touchmove`, `touch-action: none`) and desktop pointer events must maintain full functional parity. Hit-target radius $\ge 20\text{ px}$.
4. **Hardware Envelope:** Clamping logic strictly enforces `BED_SIZE_MM = 256` and `MAX_HEIGHT_MM = 256`.

---

## 6. Verification Commands

Run the full verification suite before pushing any changes:

```sh
# 1. Autonomous Multi-Angle Adversarial Stress Suite & Archive Rotation
node scripts/adversarial_eval_agent.mjs

# 2. Adversarial Scenario & Tolerance Verification
node tests/test_adversarial_scenarios.mjs

# 3. Headless UI & DOM Guardrails Check
node tests/verify_app.mjs

# 4. Repository Hygiene, Path Leakage & File Budget Audit
python3 scripts/repo_audit.py --path .
```

---

## 7. Mandatory Product Map & Anti-Bloat Gate

All future UI, geometry, and export features must adhere to `PRODUCT_MAP.md`:
1. **Top-Bar Ceiling (`<= 6` Controls):** `<header id="appHeader">` must never exceed 6 visible top-level control groups. No sprint may add a standalone top-level header button or global toolbar row.
2. **Stage Registration:** Every new interactive control must declare `data-stage="1..5"` (or live inside `[data-stage-panel="1..5"]`) and `data-tool="<registered-name>"`, and render inside its parent inspector card in `PRODUCT_MAP.md`.
3. **Strict File & Security Ceilings:** Every source module under `src/` must stay `<= 500` lines (`src/ui/stageRouter.js <= 350L`, `src/utils/projectMigration.js <= 200L`), with zero `eval()`, zero `innerHTML`, and zero machine-specific paths.

---

## 8. Mandatory Visual Checker & Retained Judge Gate (Pre-Push & CI)

Every EGM sprint keeps `@eval-judge` **on retainer**. No push or PR may bypass the visual & geometry judge pipeline:
```sh
node scripts/run_eval_executor.mjs && node scripts/run_eval_judge.mjs && node scripts/adversarial_eval_agent.mjs
```
This gate is enforced automatically in `.github/workflows/audit.yml` and `.git/hooks/pre-push` alongside `repo_audit.py` and the Playwright/CDP suites.
