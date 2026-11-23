# SKETCH3D — Free iPad & Browser 3D Sketcher for Bambu Lab A1

> **Touch-first, zero-install parametric CAD in your browser.** Sketch 2D profiles on iPad with Apple Pencil or desktop mouse, apply real-time Grasshopper-style modifiers, add precision metric screw holes (M2/M3/M4/M5), and export slicer-ready binary `.STL` files directly for your **Bambu Lab A1**.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-iocfinc.github.io%2Fsketch3d-FEFF00?logo=github)](https://iocfinc.github.io/sketch3d/)
[![Hardware Target](https://img.shields.io/badge/Hardware-Bambu%20Lab%20A1%20(256%C3%97256%C3%97256mm)-00E56D)](https://bambulab.com/en/a1/tech-specs)
[![Platform Support](https://img.shields.io/badge/Platform-iPadOS%20%7C%20iOS%20%7C%20Desktop%20Web-73E6F1)](#)
[![Stack](https://img.shields.io/badge/Stack-Three.js%20r128%20%7C%20TailwindCSS-FF66D9)](#)
[![Zero Build](https://img.shields.io/badge/Compute-100%25%20Client--Side-white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

* **Live Demo:** [https://iocfinc.github.io/sketch3d/](https://iocfinc.github.io/sketch3d/)
* **Parametric Textures Lookbook:** [HTML Lookbook](catalog.html) · [Download PDF](assets/Textures_on_SKETCH3D_Catalog.pdf)
* **Brand & Design System Reference:** [Hydrogen Brand Kit v2.0](../hydrogen-brand-kit-v2/README.md) (W3C tokens, Obsidian Vice dark mode, 3D cyclorama cards, Bauhaus icons)
* **Fabrication Guide:** [Bambu Lab A1 Spiral Vase Slicer Guide](docs/VASE_MODE_AND_SLICER_GUIDE.md)
* **Target Printer Specs:** Bambu Lab A1 — $256 \times 256 \times 256\text{ mm}$ build volume, standard 0.4 mm nozzle, textured PEI plate.

---

## 🎬 Visual Walkthrough & Workflows

### 1. 2D Sketching to Parametric Extrusion & Binary STL Export
Draw custom closed profiles with 1mm/5mm/10mm grid snapping, insert concentric M2/M3/M4/M5 mounting holes, view live millimeter edge dimensions, adjust extrusion height with live PLA filament estimation, and export directly to `.stl`:

![2D Sketch to 3D Extrusion Demo](./assets/demo-2d-extrusion.gif)

### 2. Parametric Modifiers (Bevel, Twist, Wireframe & Filament Colors)
Modify complex shapes in real-time with Grasshopper-style procedural Bevel (`0–4 mm`) and Twist (`0–180°`) deformers, preview filament colors, and inspect wireframe geometry:

![Parametric Modifiers Demo](./assets/demo-parametric-modifiers.gif)

---

## ✨ Feature List

### Designed for 3D Printing Starters
* **Zero-Intimidation Quick Start:** 1-line guidance banner and starter templates (EDC Frame, Truss, Lamp Fin) so you can start sketching in seconds.
* **Printability Guardrail Badge:** Instant visual checks warning if your part exceeds the Bambu A1 bed ($> 256\text{ mm}$) or is too thin for reliable FDM printing ($< 1.2\text{ mm}$), showing a green `"Fits A1 Bed"` badge when print-ready.
* **Slicer Ready STL & Post-Export Guidance:** Direct export to binary `sketch3d_bambu_a1.stl` with Z-up printer coordinate orientation (`(X, -Z, Y)`), ready to drop straight into Bambu Studio or Bambu Handy.

### Engineered for Makers & Hobbyists
* **Precision Metric Screw Holes & Captive Nut Traps:** Pre-calibrated presets for `M2` ($2.2\text{ mm}\varnothing$), `M3` ($3.2\text{ mm}\varnothing$), `M4` ($4.2\text{ mm}\varnothing$), and `M5` ($5.2\text{ mm}\varnothing$), plus captive regular hex-nut traps (M3 5.7mm, M4 7.2mm flats) and 90° countersink bores with 45° support-free overhang slopes.
* **WASM CSG Kernel (Manifold-3D):** Zero-leak, watertight boolean operations for through-holes, blind pockets, captive fastener traps, and split-body partitioning.
* **Parametric Split-Body Lip & Groove:** Automated enclosure slicing with wall thickness enforcement ($\ge 1.6\text{ mm}$), 3.0mm interlocking male lip, and matching female groove with $+0.2\text{ mm}$ 3D print clearance.
* **Multi-Plane Datum Sketching:** Switch between Top (XY), Front (XZ), Right (YZ), and custom planar face coordinate frames with bidirectional 2D/3D transformations.
* **Auto-Arrange Plate Packing:** 2D bottom-left shelf bin-packing for multi-part assemblies, clamping parts to the Bambu Lab A1 bed ($256 \times 256\text{ mm}$) with $\ge 6\text{ mm}$ safety gaps and zero-collision verification.
* **Safe Math Expression Evaluator:** Recursive-descent dimension parser (`12 + 5 * 2`, `(10 + 2) * 3`) supporting dynamic variable bindings and circular reference detection without `eval()`.
* **Live Edge Dimensioning:** Real-time millimeter length labels rendered directly on polygon segments during sketching and vertex adjustments.
* **Multi-Step Grid Snapping:** Instant toggle between `Snap: 5mm` → `Snap: 1mm` → `Snap: 10mm` → `Snap: Off`.
* **Save & Load Project (`.json`):** Full project persistence to save and reload parametric profiles, holes, cutouts, extrusion parameters, and colors.
* **Procedural Modifiers:** Real-time vertex twist deformation around the build axis and multi-segment beveling.
* **Touch & Apple Pencil Native:** Optimized for iPad Safari with 20px hit targets, draggable vertices, edge-point splitting, and dedicated Split / 2D / 3D responsive views.
* **100% Client-Side ($0 Hosting):** Zero server backend, zero API latency, and complete privacy—runs entirely within client WebGL and Web Workers.

---

## 🚀 How to Run Locally

Run locally using Python's built-in static HTTP server or any static file server:

```bash
# Clone the repository
git clone https://github.com/iocfinc/sketch3d.git
cd sketch3d

# Start local server
python3 -m http.server 8088
```

Open `http://localhost:8088` in your browser (Safari on iPad, Chrome, Edge, or Firefox).

---

## 📐 Architecture & Print Pipeline

* **Procedural Modeling Kernel:** Client-side WebGL / Three.js parametric mesh generator with real-time vertex extrusion, twist deformers, and bevel operations.
* **Touch-First CAD UX:** Mobile-first Apple Pencil and touch interface with $20\text{px}$ hit targets, live millimeter edge dimensioning, and multi-mode snapping ($1\text{ mm}$, $5\text{ mm}$, $10\text{ mm}$).
* **FDM Slicer Guardrails:** Built-in validation verifying volume fits the Bambu Lab A1 build plate ($256 \times 256 \times 256\text{ mm}$) and wall thicknesses maintain structural printability ($> 1.2\text{ mm}$).
* **Direct Binary STL Export:** Zero-dependency binary `.stl` generation with Bambu-aligned printer coordinates ($Z$-up, origin grounded to PEI plate).

---

## 🏷️ Search Topics & Tags

`3d-printing` · `bambu-lab` · `bambu-a1` · `threejs` · `parametric-cad` · `rhino-grasshopper` · `ipad-cad` · `apple-pencil` · `stl-export` · `webgl` · `manifold-3d` · `3mf-export`

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
