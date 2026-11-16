# SKETCH3D — Parametric 3D Sketcher for Bambu Lab A1

> A fast, beginner-friendly 3D sketch tool inspired by Rhino/Grasshopper and SketchUp, purpose-built for rapid 3D printing workflows on the **Bambu Lab A1**.

[![Target Hardware](https://img.shields.io/badge/Hardware-Bambu%20Lab%20A1-00E56D)](https://bambulab.com/en/a1/tech-specs)
[![Platform](https://img.shields.io/badge/Platform-iPad%20%7C%20iPhone%20%7C%20Desktop-73E6F1)](#)
[![Stack](https://img.shields.io/badge/Stack-Three.js%20%7C%20TailwindCSS%20%7C%20HTML5-FEFF00)](#)
[![Zero Build](https://img.shields.io/badge/Architecture-100%25%20Client--Side-FF66D9)](#)

---

## Highlights

- **Touch-First Parametric Sketching:** Designed specifically for iPad (touch and Apple Pencil), iPhone, and desktop browsers. Includes generous 20px hit targets, draggable vertices, edge point insertion, and dedicated Split / 2D / 3D responsive layouts.
- **Bambu Lab A1 Optimized:** Direct build envelope bounding box (`256 × 256 × 256 mm`), 5mm snap grid, 0.4mm nozzle tolerance awareness, and hard-clamped extrusion limits (`1–256 mm`).
- **Grasshopper-Style Modifiers:** Real-time parametric Bevel (`0–4 mm`) and Twist (`0–180°`) sliders directly altering vertex attributes.
- **Watertight Binary STL Export:** Slicer-ready binary `.stl` exporter that transforms Three.js Y-up coordinates to 3D printer Z-up coordinates (`(x, -z, y)`).
- **Zero-Dependency Architecture:** Self-contained client-side single file application with $0 hosting requirements, deployable directly on GitHub Pages.

---

## Quickstart

Because v1 is completely self-contained, no build tools or package managers are required:

```bash
# Clone the repository
git clone https://github.com/iocfinc/sketch3d.git
cd sketch3d

# Run local preview
python3 -m http.server 8080
# Open http://localhost:8080 in your browser
```

---

## Architecture & Roadmap

Refer to [`HANDOVER_SPEC.md`](./HANDOVER_SPEC.md) for full architecture notes, color palettes, and product roadmap across:
- **Phase 1 (Current):** Cubic, skeletal, and mechanical extrusions, M3/M4 mounting holes, and presets.
- **Phase 2:** Multi-section curve lofting, `manifold-3d` WASM Booleans inside Web Workers, and 3MF export.
- **Phase 3:** Conformal surface textures (knurling, basket weave, lattices) and printability guardrails.

---

## License

MIT License.
