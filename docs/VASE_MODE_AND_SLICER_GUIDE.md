# Bambu Lab A1 Spiral Vase Mode & Slicer Tuning Guide

> **SKETCH3D Fabrication Specification**  
> Optimal slicer parameters for Bambu Studio & OrcaSlicer when printing procedural surface textures on the Bambu Lab A1 (256 × 256 × 256 mm).

---

## 1. Watertight Solid vs. Hollow Open-Top Rationale

When exporting 3D vessels and lampshades from SKETCH3D for single-wall fabrication, **always export as a solid watertight manifold** (`Shell: Off`) rather than boolean hollow walls (`Shell: On`).

### Why Solid Export is Superior for Spiral Vase
- **Zero Retractions**: Slicing software (Bambu Studio, OrcaSlicer, PrusaSlicer) requires a solid cylinder/form to compute a single continuous spiral perimeter (*Spiral Vase* or *Vase Mode*).
- **Zero Seam Scars**: In continuous spiral mode, the Z-axis rises continuously at a constant helical rate, eliminating the vertical start/stop seam line.
- **50%–75% Material Reduction**: Solid objects printed in vase mode use only 1 perimeter (~30–45 g PLA for a 150mm lamp), compared to 110–160 g for multi-wall hollow prints.
- **Translucent Optics**: Single-perimeter walls allow light from internal E27 bulbs or LED rings to diffuse evenly through translucent or semi-opaque filaments without internal rib shadows.

---

## 2. Bambu Lab A1 / 0.4mm Nozzle Calibration Table

Standard 0.4mm nozzles can comfortably extrude wide, structural single perimeters without nozzle swapping. Use these calibrated settings in **Bambu Studio** or **OrcaSlicer**:

| Slicer Parameter | Standard Profile | Optimized Vase Profile | Rationale |
| :--- | :--- | :--- | :--- |
| **Spiral Vase Mode** | Off | **Enabled** (`Special Mode > Spiral Vase`) | Continuous Z helical climb |
| **Outer Wall Line Width** | 0.42 mm | **0.70 mm** (0.65 – 0.75 mm) | 170% width produces rigid, self-supporting walls |
| **Layer Height** | 0.20 mm | **0.24 – 0.28 mm** | Higher aspect ratio provides structural bond strength |
| **Bottom Shell Layers** | 3 layers | **4 – 5 solid layers** | Ensures a rigid, flat, watertight base plate |
| **Flow Ratio** | 0.98 | **1.04 (104%)** | Guarantees zero layer delamination during steep ripples |
| **Printing Speed (Outer Wall)**| 120 mm/s | **65 – 80 mm/s** | Permits adequate molten cooling on intricate wave peaks |
| **Nozzle Temperature** | 215 °C | **225 °C (PLA) / 245 °C (PETG)** | Higher melt temp ensures inter-layer thermal welding |
| **Cooling Fan** | 100% | **80% – 100%** | Prevents localized curling on overhang crests |

---

## 3. Surface Texture Overhang & Rim Safeguards

SKETCH3D's procedural kernel applies automated manufacturing constraints:
1. **4.0 mm Mounting Rim Mask**: The top and bottom 4.0 mm of every textured model automatically tapers displacement to zero. This ensures E27 threaded lamp collars and bed adhesion bases remain perfectly flat and circular.
2. **55° Local Overhang Guard**: Radial displacement gradients $\Delta r / \Delta z$ are clamped so the steepest tangent angle never exceeds 55° from vertical, eliminating the need for support structures.
3. **2.5 mm Spatial Wavelength Floor**: For intricate labyrinth textures (`coral`), the spatial wavelength is dynamically clamped $\ge 2.5\text{ mm}$ to ensure standard 0.4mm nozzles track every ridge without corner rounding.

---

## 4. 3-Tier Proofing & Tactile Scale Matrix

Before committing to a multi-hour full-scale print, use SKETCH3D's built-in **Proof Scale Mode** toggle:

| Tier | Scale Mode | Dimensions (Typical) | Filament | Print Time | Verification Purpose |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **1** | **35mm Swatch** | Ø 60 × 35 mm | ~4.5 g | ~20 min | Instant tactile check of 1:1 unscaled wave relief and nozzle finish. |
| **2** | **40% Mini Proof** | Ø 42 × 60 mm | ~9.0 g | ~35 min | Proportions, silhouette, and translucent light diffusion check. Decoupled amplitude ($A \ge 0.65\text{ mm}$) preserves tactile ridges. |
| **3** | **100% Full Scale**| Ø 105 × 150 mm | ~36.0 g | ~1h 45m | Production luminaire or vessel ready for E27 socket hardware. |

---

## 5. Step-by-Step Slicing Instructions (Bambu Studio)

1. **Export from SKETCH3D**: Click `⬇ Export .STL`. The file `sketch3d_bambu_a1.stl` (or `-mini-proof.stl` / `-swatch.stl`) will download.
2. **Import into Bambu Studio**: Drag the `.stl` file onto the virtual Bambu Lab A1 build plate.
3. **Enable Spiral Vase**:
   - In the left sidebar, navigate to `Process > Global > Others > Special Mode`.
   - Check the **Spiral Vase** box. A dialog will prompt: *"Spiral vase mode requires only 1 wall and 0% infill"*. Click **Yes**.
4. **Tune Extrusion Width**:
   - Navigate to `Quality > Line width > Outer wall`. Set to `0.70 mm`.
5. **Adjust Bottom Layers**:
   - Navigate to `Strength > Top/bottom shells > Bottom shell layers`. Set to `4`.
6. **Slice & Inspect Preview**:
   - Click **Slice Plate**. Use the vertical layer slider to confirm a continuous single line spirals smoothly from base to rim.
7. **Send to Printer**: Click **Print Plate**.
