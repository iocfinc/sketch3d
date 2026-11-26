# Elephant-Goldfish Model (EGM) Multi-Agent Swarm Workflow

> **Sprint Swarm Orchestration Specification for Gemini 3.8 Flash**  
> Specialized role boundaries, memory isolation, and convergence contracts for high-speed parallel development.

---

## 1. Architecture Overview: Elephant-Goldfish Topology

In the Elephant-Goldfish Model (EGM), a long-context coordinator maintains global state and architectural vision (the *Elephant*), while hyper-focused, short-horizon specialist agents execute scoped sub-tasks within strict module boundaries (the *Goldfish*).

```
                      +-------------------+
                      |   @elephant-lead  |
                      | (Architecture &   |
                      |   Integration)    |
                      +---------+---------+
                                |
        +-----------------------+-----------------------+-----------------------+
        |                       |                       |                       |
+-------v-------+       +-------v-------+       +-------v-------+       +-------v-------+
|@kernel-goldfish|      |@slicer-goldfish|      |  @qa-goldfish |      |  @eval-judge  |
|src/geometry/**|       |  src/export/**|       |verify_app.mjs |      |VLM & Visual   |
|<= 500 lines   |       |.stl & .3mf    |       |repo_audit.py  |      |Retained Judge |
+---------------+       +---------------+       +---------------+       +---------------+
```

---

## 2. Specialized Agent Rosters & Bounded Scopes

### 1. `@elephant-lead` (Coordinator / Architecture)
- **Ownership**: Global state orchestration, API contracts, cross-module wiring, UI assembly (`index.html`, `src/app.js`), release staging.
- **Constraints**:
  - Enforces `allow_chained_publish=False` (Stage & Preview Only; no remote publishing without explicit user instruction).
  - Maintains strict <= 500 line budget across all application files.
  - Zero `eval()`, zero `innerHTML`, zero machine paths.
  - Aligns all UI styling and marketing assets with the workspace brand kit at `../hydrogen-brand-kit-v2/` (`tokens/hydrogen-tokens.css`).

### 2. `@kernel-goldfish` (Parametric Geometry Specialist)
- **Ownership**: Math kernels, 3D shelling, Voronoi/TPMS lattices, and procedural textures (`src/geometry/**`).
- **Invariants**:
  - `buildHollowExtrudeGeometry` and `buildHollowLatheProfile` maintain manifold topology across both vessel (closed base) and lampshade (open aperture) modes.
  - Procedural displacements adhere to 4.0mm mounting rim smoothstep masking and 55° local overhang limits.
  - File ceiling: `<= 500` lines per geometry module.

### 3. `@slicer-goldfish` (Export & Slicer Interop Specialist)
- **Ownership**: Manufacturing artifacts, binary STL writers, multi-object `.3mf` ZIP packaging, and Bambu Lab profile embedding (`src/export/**`).
- **Invariants**:
  - Zero-dependency client-side ZIP generator with standard CRC32 table.
  - Centering all meshes at Bambu Lab A1 build plate origin ($X=128, Y=128, Z=0$).
  - Correct embedding of Bambu Studio process profiles (`Vase Mode`, `Clear Glass Look`, `LFAM Wide-Bead`).
  - Pre-print filament drying guidance advisory.
  - References `../hydrogen-brand-kit-v2/templates/product-cyclorama-card.html` for 3MF/STL packaging cards and color slot mapping.

### 4. `@qa-goldfish` (Adversarial Quality & Verification Specialist)
- **Ownership**: Automated browser testing (`tests/verify_app.mjs`) and repository hygiene audits (`scripts/repo_audit.py`).
- **Invariants**:
  - Runs headless Chrome DevTools protocol verification across all mobile/desktop viewports (375x812, 768x1024, 1280x800).
  - Asserts 100% test pass rate with 0 console errors, 0 NaN coordinates, and 0 lint warnings.
  - Verifies DOM ID uniqueness and Schema.org WebApplication JSON-LD compliance.

### 5. `@eval-judge` (Retained Visual & Geometry Judge — Mandatory Pre-Push Gate)
- **Ownership**: Visual contact-sheet inspection (`evals/runs/latest/`), dual-agent Executor-Judge grading (`scripts/run_eval_executor.mjs` + `scripts/run_eval_judge.mjs`), and multi-angle orbit stress sweeps (`scripts/adversarial_eval_agent.mjs`).
- **Invariants**:
  - Kept **on retainer** in every EGM swarm and triggered automatically in CI (`.github/workflows/audit.yml`) and `.git/hooks/pre-push` before any push or PR.
  - Captures and inspects 4-quadrant multi-angle orbit sheets (`Isometric`, `Top Cavity`, `Front`, `Rear/Back`) plus desktop (`1280×800`) and mobile (`375×812`) screenshots to catch visual regressions that DOM assertions miss.
  - Blocks convergence unless `run_eval_judge.mjs` (`10/10`) and `adversarial_eval_agent.mjs` (`all archetypes PASS`) exit `0`.

---

## 3. Convergence Contract & Merge Gate

Before any branch handoff, local commit, PR, or push:
1. `python3 scripts/repo_audit.py --path .` returns **0 Failures, 0 Warnings**.
2. `node tests/verify_app.mjs`, `node tests/test_sprints_11_16.mjs`, `node tests/test_adversarial_scenarios.mjs`, and `node tests/test_part2.mjs` run to **100% PASS**.
3. `@eval-judge` pre-push / CI visual gate passes: `node scripts/run_eval_executor.mjs && node scripts/run_eval_judge.mjs && node scripts/adversarial_eval_agent.mjs` (**10/10 recipes** + **all VLM archetypes PASS**).
4. All source files strictly verified `<= 500 lines` (hard ceiling `650 lines`).
5. Ticket marked `COMPLETED` and retirement/MR artifact generated.
