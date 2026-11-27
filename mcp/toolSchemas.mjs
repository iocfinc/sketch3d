/**
 * SKETCH3D — MCP Tool JSON Schemas & Strict Validator
 * ====================================================
 * Transport-agnostic typed tool schemas for the 6 SKETCH3D MCP tools
 * plus strict zero-dependency JSON Schema validation.
 */

const PT_SCHEMA = {
  type: 'object',
  required: ['x', 'y'],
  additionalProperties: false,
  properties: {
    x: { type: 'number', minimum: -256, maximum: 256 },
    y: { type: 'number', minimum: -256, maximum: 256 }
  }
};

const BEZIER_NODE_SCHEMA = {
  type: 'object',
  required: ['x', 'y'],
  additionalProperties: false,
  properties: {
    x: { type: 'number', minimum: -256, maximum: 256 },
    y: { type: 'number', minimum: -256, maximum: 256 },
    cpIn: PT_SCHEMA,
    cpOut: PT_SCHEMA
  }
};

const FASTENER_SCHEMA = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['hole', 'standoff', 'cutout_grid', 'nut_m3', 'nut_m4', 'nut_m5', 'csk_m3', 'csk_m4'] },
    x: { type: 'number', minimum: -128, maximum: 128 },
    y: { type: 'number', minimum: -128, maximum: 128 },
    r: { type: 'number', minimum: 0.3, maximum: 25 }
  }
};

export const TOOL_DEFINITIONS = [
  {
    name: 'sketch_2d',
    description: 'Stage 1: Create or update 2D Bezier, Poly, Rect, Circle, or Hex profiles on XY/XZ/YZ planes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['set_profile', 'rect', 'circle', 'hex', 'clear', 'add_part', 'select_part'] },
        profileType: { type: 'string', enum: ['poly', 'bezier', 'freehand'] },
        sketchPlane: { type: 'string', enum: ['XY', 'XZ', 'YZ'] },
        points: { type: 'array', minItems: 2, items: PT_SCHEMA },
        bezierNodes: { type: 'array', minItems: 2, items: BEZIER_NODE_SCHEMA },
        smoothness: { type: 'number', minimum: 0, maximum: 1 },
        resolutionMm: { type: 'number', minimum: 0.1, maximum: 5 },
        widthMm: { type: 'number', minimum: 1, maximum: 256 },
        heightMm: { type: 'number', minimum: 1, maximum: 256 },
        radiusMm: { type: 'number', minimum: 1, maximum: 128 },
        acrossFlatsMm: { type: 'number', minimum: 2, maximum: 256 },
        segments: { type: 'integer', minimum: 6, maximum: 128 },
        center: PT_SCHEMA,
        isClosed: { type: 'boolean' },
        revolveGuide: { type: 'boolean' },
        snapStep: { type: 'number', enum: [0, 1, 5, 10] },
        partIndex: { type: 'integer', minimum: 0 },
        partName: { type: 'string', minLength: 1 },
        project: { type: 'object' }
      }
    }
  },
  {
    name: 'generate_form',
    description: 'Stage 2: Apply Extrude, Revolve 360°, Loft, or Offset Clone (+mm) and assign Opaque/Clear tags.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['extrude', 'revolve', 'loft', 'offset_clone'] },
        heightZ: { type: 'number', minimum: 1, maximum: 256 },
        baseZ: { type: 'number', minimum: 0, maximum: 250 },
        materialTag: { type: 'string', enum: ['opaque', 'clear'] },
        color: { type: 'string', minLength: 4 },
        offsetMm: { type: 'number', minimum: 2, maximum: 20 },
        loftTopShape: { type: 'string', enum: ['circle', 'hex', 'scaled'] },
        loftTopScale: { type: 'number', minimum: 0.25, maximum: 1.8 },
        loftTwistDeg: { type: 'number', minimum: 0, maximum: 180 },
        loftTopPoints: { type: 'array', minItems: 3, items: PT_SCHEMA },
        partName: { type: 'string', minLength: 1 },
        partIndex: { type: 'integer', minimum: 0 },
        project: { type: 'object' }
      }
    }
  },
  {
    name: 'apply_modifier',
    description: 'Stage 3: Toggle ordered solid modifiers (Shell, Round, Bevel, Twist, Fasteners, Split Lip/Groove, Stack Z).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        partIndex: { type: 'integer', minimum: 0 },
        shellEnabled: { type: 'boolean' },
        shellMode: { type: 'string', enum: ['hollow', 'vase_proxy'] },
        shellThickness: { type: 'number', minimum: 0.4, maximum: 15 },
        intent: { type: 'string', enum: ['vessel', 'lampshade'] },
        cornerRadius: { type: 'number', minimum: 0, maximum: 20 },
        bevelSize: { type: 'number', minimum: 0, maximum: 4 },
        twistDeg: { type: 'number', minimum: 0, maximum: 180 },
        color: { type: 'string', minLength: 4 },
        fasteners: { type: 'array', items: FASTENER_SCHEMA },
        splitLipGroove: {
          type: 'object',
          additionalProperties: false,
          properties: {
            splitZMm: { type: 'number', minimum: 2, maximum: 250 },
            wallThicknessMm: { type: 'number', minimum: 1.6, maximum: 15 },
            lipHeightMm: { type: 'number', minimum: 1, maximum: 10 },
            clearanceMm: { type: 'number', minimum: 0.05, maximum: 1.0 }
          }
        },
        stackZ: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scaleXY: { type: 'number', minimum: 0.2, maximum: 1.5 },
            extrudeHeight: { type: 'number', minimum: 1, maximum: 256 }
          }
        },
        project: { type: 'object' }
      }
    }
  },
  {
    name: 'apply_texture_bands',
    description: 'Stage 4: Configure Coral, Gyroid, Flute, Open-Aperture Basket Weave, or Banded Weave/Flare/Twist with Fidelity Contract enforcement.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        partIndex: { type: 'integer', minimum: 0 },
        texturePattern: {
          type: 'string',
          enum: ['none', 'ripple', 'weave', 'wave', 'spiral', 'flute', 'gyroid', 'coral', 'strata', 'open-weave', 'perforated-weave', 'lfam-rib']
        },
        textureDepth: { type: 'number', minimum: 0, maximum: 3.0 },
        textureFreq: { type: 'number', minimum: 6, maximum: 64 },
        weaveBands: { type: 'number', minimum: 1.8, maximum: 6.0 },
        weaveGapMm: { type: 'number', minimum: 0.5, maximum: 1.5 },
        weavePillars: { type: 'integer', minimum: 8, maximum: 32 },
        weaveTwistDeg: { type: 'number', minimum: 0, maximum: 180 },
        wallThicknessMm: { type: 'number', minimum: 0.8, maximum: 8.0 },
        rimMarginMm: { type: 'number', minimum: 1.5, maximum: 15.0 },
        bandEnabled: { type: 'boolean' },
        bandCount: { type: 'integer', minimum: 2, maximum: 24 },
        bandMode: { type: 'string', enum: ['weave', 'flare', 'twist_flute'] },
        bandFreq: { type: 'integer', minimum: 4, maximum: 32 },
        bandPhaseDeg: { type: 'number', minimum: 0, maximum: 360 },
        bandDepth: { type: 'number', minimum: 0.1, maximum: 3.0 },
        bandFlareDeg: { type: 'number', minimum: 0, maximum: 22 },
        bandPivot: { type: 'string', enum: ['midpoint', 'endpoint'] },
        bandAltFlare: { type: 'boolean' },
        project: { type: 'object' }
      }
    }
  },
  {
    name: 'inspect_and_render',
    description: 'Stage 5 Inspect: Run deterministic geometry, manifold, volume, overhang, and optional headless Chromium 4-quadrant VLM contact sheet render.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        renderMultiview: { type: 'boolean' },
        outputImagePath: { type: 'string', minLength: 1 },
        printerProfile: { type: 'string', enum: ['bambu_a1', 'bambu_a1_mini', 'orca_generic'] },
        scaleMode: { type: 'string', enum: ['full', 'mini', 'swatch'] },
        project: { type: 'object' }
      }
    }
  },
  {
    name: 'export_print_bundle',
    description: 'Stage 5 Export: Save interchangeable v2 .json + print files (.3mf, .stl, .gcode, .gcode.3mf) with manifold & 5-layer safety gate audit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outputDir: { type: 'string', minLength: 1 },
        baseName: { type: 'string', minLength: 1 },
        formats: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ['3mf', 'stl', 'gcode', 'gcode.3mf'] }
        },
        slicerTarget: { type: 'string', enum: ['bambu_studio', 'orcaslicer'] },
        printerProfile: { type: 'string', enum: ['bambu_a1', 'bambu_a1_mini', 'orca_generic'] },
        slicerProfile: { type: 'string', enum: ['auto', 'standard', 'multi_perimeter', 'vase', 'basket_weave_arachne', 'clear_glass', 'lfam'] },
        scaleMode: { type: 'string', enum: ['full', 'mini', 'swatch'] },
        nozzleDiameter: { type: 'number', enum: [0.4, 0.6] },
        toolpathPrimitive: { type: 'string', enum: ['standard', 'thick', 'arc', 'wiggle'] },
        useDonor: { type: 'boolean' },
        project: { type: 'object' }
      }
    }
  }
];

function validateNode(schema, value, p, errs) {
  if (!schema) return;
  if (schema.type) {
    const isArr = Array.isArray(value);
    const okType =
      (schema.type === 'object' && value !== null && typeof value === 'object' && !isArr) ||
      (schema.type === 'array' && isArr) ||
      (schema.type === 'string' && typeof value === 'string') ||
      (schema.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (schema.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
      (schema.type === 'boolean' && typeof value === 'boolean');
    if (!okType) { errs.push(`${p}: expected ${schema.type}`); return; }
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${p}: must be one of [${schema.enum.join(', ')}]`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${p}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${p}: ${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errs.push(`${p}: length < minLength ${schema.minLength}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${p}: length < minItems ${schema.minItems}`);
    if (schema.items) value.forEach((item, idx) => validateNode(schema.items, item, `${p}[${idx}]`, errs));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const reqKey of schema.required || []) {
      if (value[reqKey] === undefined) errs.push(`${p}.${reqKey}: required`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (props[k]) validateNode(props[k], v, `${p}.${k}`, errs);
      else if (schema.additionalProperties === false) errs.push(`${p}.${k}: unexpected property`);
    }
  }
}

export function validateToolArgs(toolName, args) {
  const def = TOOL_DEFINITIONS.find(t => t.name === toolName);
  if (!def) return { valid: false, errors: [`Unknown tool: ${toolName}`], schema: null };
  const input = args === undefined ? {} : args;
  const errors = [];
  validateNode(def.inputSchema, input, '$', errors);
  return { valid: errors.length === 0, errors, schema: def.inputSchema };
}
