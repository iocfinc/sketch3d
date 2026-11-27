# SKETCH3D Local Stdio MCP Server (`sketch3d-mcp`)

Zero-dependency Node.js Model Context Protocol (MCP) server exposing SKETCH3D's 5-stage parametric CAD kernel (`src/geometry/**`), unified Bambu/Orca print profiles (`src/export/printerProfile.js`), and Schema V2 `.json` format (`src/utils/projectMigration.js`) with **1:1 human/agent parity**.

## Architecture
- `mcp/toolHandlers.mjs`: Transport-agnostic tool engine (`createMcpSession`, `executeMcpTool`), ready for stdio now and Streamable HTTP in Phase D.
- `mcp/toolSchemas.mjs`: Typed JSON Schemas and strict runtime argument validation.
- `mcp/renderBridge.mjs`: On-demand headless Chromium WebGL 4-quadrant VLM contact sheet renderer (`1200x800`).
- `mcp/sketch3d-mcp.mjs`: Stdio JSON-RPC 2.0 server (`initialize`, `tools/list`, `tools/call`).

## 6 Exposed Tools
1. `sketch_2d` — Create/update 2D Bezier, Poly, Rect, Circle, or Hex profiles on `XY`/`XZ`/`YZ` planes.
2. `generate_form` — Apply `extrude`, `revolve`, `loft`, or `offset_clone` (`+2..20mm`) and assign `opaque`/`clear` tags.
3. `apply_modifier` — Apply ordered Stage 3 modifiers (`shell`, `cornerRadius`, `bevelSize`, `twistDeg`, `fasteners`, `splitLipGroove`, `stackZ`).
4. `apply_texture_bands` — Configure Stage 4 textures (`coral`, `gyroid`, `flute`, `open-weave`, etc.) and Band Subdivision with Fidelity Contract enforcement.
5. `inspect_and_render` — Run deterministic manifold/volume/bed-contact/overhang checks + optional 4-quadrant Chromium render (`renderMultiview: true`).
6. `export_print_bundle` — Write interchangeable `.sketch3d.v2.json` + `.3mf` / `.stl` / `.gcode` / `.gcode.3mf` (`Bambu Studio` / `OrcaSlicer`) gated by manifold & 5-Layer G-Code Safety checks.

## Client Configuration (Node 22+)

### Claude Desktop / Cursor / Antigravity (`mcp_config.json`)
```json
{
  "mcpServers": {
    "sketch3d": {
      "command": "node",
      "args": ["<path-to-sketch3d>/mcp/sketch3d-mcp.mjs"]
    }
  }
}
```

### Verification
```sh
node tests/test_phase_c_mcp.mjs
```
