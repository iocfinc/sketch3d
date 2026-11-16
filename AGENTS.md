# SKETCH3D — Project & Agent Guidelines

## Project Overview

`sketch3d` is a lightweight, beginner-friendly 3D sketch renderer inspired by Rhino/Grasshopper and SketchUp, built specifically for rapid 3D printing workflows on the **Bambu Lab A1** (`256 × 256 × 256 mm` build envelope, `0.4 mm` standard nozzle).

The runtime is 100% client-side compute (WebGL / Three.js + Tailwind CSS) running in Safari on iPad (touch & Apple Pencil), iPhone, and modern desktop browsers with zero backend dependencies.

## Repository Map

- `index.html`: Complete, self-contained single-file web application (2D canvas editor, 3D Three.js viewport, parametric modifiers, and binary STL generator).
- `HANDOVER_SPEC.md`: Comprehensive project handover specification, technical requirements, and multi-phase roadmap.
- `README.md`: Public project documentation, quickstart, and feature summary.

## Hardware & Engineering Guardrails

- **Build Envelope Limits:** Maximum X/Y: 256 mm (`-128` to `+128` mm from center origin). Maximum Z: 256 mm. Any extrusion height input must stay hard-clamped (`1 <= Z <= 256 mm`).
- **Coordinate Conventions:** Three.js uses Y-up (`X`, `Y`, `Z`), whereas slicers (Bambu Studio, OrcaSlicer, PrusaSlicer) expect Z-up. When exporting binary STL, coordinates must map to `(X, -Z, Y)` so prints sit flat on the build plate.
- **Touch & Mobile Optimization:** Keep hit targets >= 20px for vertices. Keep `touch-action: none` on canvases to prevent browser gesture conflicts.

## Development & Testing

- Phase 1 has zero build steps: launch locally with any static HTTP server (e.g., `python3 -m http.server 8000` or `npx serve .`).
- Keep all script and asset references relative (`./`) for seamless GitHub Pages deployment under `iocfinc.github.io/sketch3d/`.
