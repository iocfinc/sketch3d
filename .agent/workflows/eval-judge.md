# Dual-Agent Evaluation Workflow: @eval-executor → @eval-judge

## Overview
The Executor-Judge pipeline decouples model creation from verification. An execution worker (`@eval-executor`) drives the user interface and produces binary manufacturing artifacts, while an adversarial critic (`@eval-judge`) inspects the output bytes against locked baseline metrics.

```
       +-----------------------+
       | evals/sanity_recipes  |
       +-----------+-----------+
                   |
       +-----------v-----------+
       |    @eval-executor     |
       | (Headless Chromium    |
       |   & Live DOM Driver)  |
       +-----------+-----------+
                   | Emits .stl, .3mf, screenshots, manifest.json
       +-----------v-----------+
       |   evals/runs/latest/  |
       +-----------+-----------+
                   |
       +-----------v-----------+
       |      @eval-judge      | <--- evals/golden/baseline_metrics.json
       | (Binary STL/3MF Parser|
       |   & Tolerance Grader) |
       +-----------+-----------+
                   |
       +-----------v-----------+
       |      verdict.json     |
       |     (PASS / FAIL)     |
       +-----------------------+
```

## Recipe Coverage
1. **R01**: Off-Center Twisted Rectangle Centroid Alignment ($|C_{top} - C_{bot}| \le 0.05\text{ mm}$)
2. **R02**: Twisted Square Lampshade 60° Open Shell (Annular bottom rim, no solid floor cap)
3. **R04**: Shelled Rectangle Basket Weave Outer Relief ($> 0.35\text{ mm}$ outer, $< 0.01\text{ mm}$ inner drift)
4. **R04**: Vase Proxy Helical Ripple *Aura* (Manifold solid proxy, non-NaN bounds)
5. **R05**: Vase Proxy Turing Coral Revolve Symmetry ($|maxX + minX| < 0.1\text{ mm}$)
6. **R06**: Gyroid / Flute / Strata Editions (Full mathematical texture coverage)
7. **R07**: Perforated Basket Weave Open Lampshade (Pendant optical lattice)
8. **R08**: 40% Mini & 35mm Swatch Decoupled Relief ($\ge 0.65\text{ mm}$)
9. **R09**: Clear Glass Look Translucent .3MF Slicer Profile (`fan_max_speed: ["0"]`)
10. **R10**: Bambu Lab A1 256mm Envelope & Negative Input Guard ($\le 256\text{ mm}$)
