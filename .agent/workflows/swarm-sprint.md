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
        +-----------------------+-----------------------+
        |                       |                       |
+-------v-------+       +-------v-------+       +-------v-------+
|@kernel-goldfish|      |@slicer-goldfish|      |  @qa-goldfish |
|src/geometry/**|       |  src/export/**|       |verify_app.mjs |
|<= 500 lines   |       |.stl & .3mf    |       |repo_audit.py  |
+---------------+       +---------------+       +---------------+
```

---

## 2. Specialized Agent Rosters & Bounded Scopes

### 1. `@elephant-lead` (Coordinator / Architecture)
- **Ownership**: Global state orchestration, API contracts, cross-module wiring, UI assembly (`index.html`, `src/app.js`), release staging.
- **Constraints**:
  - Enforces `allow_chained_publish=False` (Stage & Preview Only; no remote publishing without explicit user instruction).
  - Maintains strict <= 500 line budget across all application files.
  - Zero `eval()`, zero `innerHTML`, zero machine paths.

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

### 4. `@qa-goldfish` (Adversarial Quality & Verification Specialist)
- **Ownership**: Automated browser testing (`tests/verify_app.mjs`) and repository hygiene audits (`scripts/repo_audit.py`).
- **Invariants**:
  - Runs headless Chrome DevTools protocol verification across all mobile/desktop viewports (375x812, 768x1024, 1280x800).
  - Asserts 100% test pass rate with 0 console errors, 0 NaN coordinates, and 0 lint warnings.
  - Verifies DOM ID uniqueness (70+ IDs) and Schema.org WebApplication JSON-LD compliance.

---

## 3. Convergence Contract & Merge Gate

Before any branch handoff or local commit:
1. `repo_audit.py` returns **0 Failures, 0 Warnings**.
2. `node tests/verify_app.mjs` runs headless browser automation to **100% PASS**.
3. All source files strictly verified `<= 500 lines` (hard ceiling `650 lines`).
4. Ticket marked `COMPLETED` and retirement artifact generated.
