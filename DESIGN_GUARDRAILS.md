# SKETCH3D — UI Design & Engineering Guardrails

## PART 1: LOGGED MISTAKES & REMEDIATIONS

1. **Mistake — Toolbar & Header Bloat:** `#panel2D` had 10 buttons in one row (`Draw / Edit`, `Hole`, `Cutout`, `Snap`, `Undo`, `Close`, `Clear`, `Save`, `Load`), and `<header>` + `<footer>` wrapped onto multiple rows, pushing the 3D `Extrude Z / Bevel / Twist` sliders below the fold on iPad/laptop screens.
   - **Remediation:** Move `Save .JSON` and `Load .JSON` into a single **click-to-expand `Project ▾` popover** and group the 3 starter presets into a **`Starter ▾` dropdown/popover** on narrow screens. Keep each panel toolbar to **one clean row** and enforce a `100dvh` viewport budget on desktop/iPad landscape.
2. **Mistake — Printability Guardrail Hidden on Mobile:** `#fitBadge` used `hidden sm:block`, hiding `⚠️ Exceeds Bed` and `⚠️ Too Thin` warnings from iPhone/mobile users.
   - **Remediation:** Remove `hidden sm:block` and place `#fitBadge` inside `#threeContainer` (top-left below `#dimOverlay` at `top-11 left-3`) so mobile and desktop users alike always see real-time printability status.
3. **Mistake — Edge Length Label Clutter on Curves:** Drawing `XX mm` boxes on every edge obscured dense shapes like the 24-vertex `Lamp Fin` preset.
   - **Remediation:** Only draw edge length labels when `state.points.length <= 12` AND the edge's screen length is `>= 28px`.
4. **Mistake — Broken / Raw File Links:** Footer `<a href="BUILD_ROADMAP.md">` and `<a href="LICENSE">` pointed to raw local files, and `og:image` pointed to `assets/sketch3d-preview.png` without verifying it exists.
   - **Remediation:** Point footer links to full GitHub URLs (`https://github.com/iocfinc/sketch3d/blob/main/LICENSE` and `https://github.com/iocfinc/sketch3d/blob/main/BUILD_ROADMAP.md`), and only keep `og:image` if `assets/sketch3d-preview.png` exists in the repo.

---

## PART 2: SYSTEM UI LAYOUT & IMPLEMENTATION RULES

1. **Viewport Budget (`100dvh` Single-Screen Fit):**
   - On desktop and iPad landscape (`lg:`): `<main>` must fit within `min-h-0 flex-1` inside a `min-h-screen lg:h-dvh lg:overflow-hidden flex flex-col bg-[#020203] text-white` body so the 2D canvas, 3D canvas, and bottom parametric sliders (`Extrude Z`, `Bevel`, `Twist`) are **all visible without page scrolling**.
   - On mobile (`< lg`): Default to the `Split` / `2D` / `3D` view switcher in `<header>`, keeping controls reachable without horizontal scroll (`scrollWidth <= innerWidth`).
2. **Toolbar & Button Architecture (Icon + Click-to-Expand, Never Multi-Row Bloat):**
   - **Max 6 visible controls per toolbar:** Never pack 8–10 buttons into a single toolbar.
   - **Primary Mode Buttons (`Draw`, `Hole`, `Cutout`):** Use crisp inline `14×14` SVG icons + short 1-word labels (`Draw`, `M3 Hole`, `Cutout`). On `<420px` screens, hide secondary text or use compact `px-2 py-1.5` sizing (`min-h-[36px]`) so buttons stay on one line.
   - **Click-to-Expand Popovers for Secondary Actions:** Group file actions (`Save .JSON`, `Load .JSON`) inside a single `Project ▾` button that toggles an absolute-positioned popover menu (`z-30`, `#0b0b10` bg, `#2a2a3c` border). Close the popover automatically when clicking outside or selecting an item.
3. **Measurement & Numeric Input Rules:**
   - **Compact Inline Inputs:** Every numeric measurement field (`Extrude Z`, future `Edge Length`, `Hole ⌀`) uses `type="number"`, `inputmode="decimal"`, `font-mono-code`, `text-right`, `w-16`, `#14141d` background, `#FEFF00` text, and a `mm` suffix outside the input.
   - **JS Clamping:** Every numeric input must pass through a clamping helper (`Math.max(min, Math.min(max, val))`) on `change` and `input`.
   - **2D Canvas Edge Labels:** Render `#73E6F1` monospace `XX mm` pills only when `state.points.length <= 12` AND `pxDist >= 28`. Never clutter circular/high-vertex shapes (`Lamp Fin`).
   - **Future Exact Edge-Length Editing (Rule for Next Step):** Do not add permanent input bars above the canvas; instead, tapping an edge label pill opens a tiny floating `mm` input popover next to that edge.
4. **Immutable Brand Palette:**
   - Dark `#020203`, Panel `#0b0b10`, Header/Footer `#07070b`, Border `#1e1e2a`, Yellow `#FEFF00`, Pink `#FF66D9`, Green `#00E56D`, Cyan `#73E6F1`.
