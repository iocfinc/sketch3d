/**
 * SKETCH3D — Unified Printer & Slicer Profile Registry
 * ====================================================
 * Canonical pure-JS registry unifying Bambu Studio and OrcaSlicer targets
 * across Bambu Lab A1 (256^3), Bambu Lab A1 Mini (180^3), and Generic Orca (250^3).
 * Zero DOM dependencies: shared 1:1 by the web UI, exporters, and sketch3d-mcp.
 */

export const DEFAULT_PRINTER_ID = 'bambu_a1';
export const DEFAULT_SLICER_TARGET = 'bambu_studio';

export const SLICER_TARGETS = Object.freeze({
  bambu_studio: Object.freeze({ id: 'bambu_studio', label: 'Bambu Studio', application: 'BambuStudio' }),
  orcaslicer: Object.freeze({ id: 'orcaslicer', label: 'OrcaSlicer', application: 'OrcaSlicer' })
});

const SHARED_NOZZLE_LIMITS = Object.freeze({
  0.4: Object.freeze({ maxFlowMm3S: 15.0, maxBridgeMm: 6.0, maxZGapMm: 0.30, lineWidthMm: 0.45 }),
  0.6: Object.freeze({ maxFlowMm3S: 20.0, maxBridgeMm: 8.0, maxZGapMm: 0.45, lineWidthMm: 0.675 }),
  0.8: Object.freeze({ maxFlowMm3S: 24.0, maxBridgeMm: 10.0, maxZGapMm: 0.60, lineWidthMm: 1.20 })
});

const SHARED_COOLING = Object.freeze({ layer0Fan: 0, wallFan: 220, weaveBridgeFan: 255, clearGlassFan: 0 });
const SHARED_TEMPS_C = Object.freeze({
  nozzle: Object.freeze({ min: 190, max: 230, default: 210, petg: 245 }),
  bed: Object.freeze({ min: 45, max: 65, default: 60, petg: 65 })
});

function makePrinter(cfg) {
  const half = cfg.bedMm / 2;
  return Object.freeze({
    id: cfg.id,
    name: cfg.name,
    shortLabel: cfg.shortLabel,
    defaultSlicer: cfg.defaultSlicer,
    supportedSlicers: cfg.supportedSlicers,
    bedSizeMm: cfg.bedMm,
    bedWidthMm: cfg.bedMm,
    bedDepthMm: cfg.bedMm,
    maxHeightMm: cfg.bedMm,
    bedCenter: Object.freeze({ x: half, y: half }),
    safeBoundsXY: Object.freeze({ min: 10, max: cfg.bedMm - 10 }),
    safeBoundsZ: Object.freeze({ min: 0.1, max: cfg.maxSafeZ }),
    marginMm: 6.0,
    gapMm: 6.0,
    extrusionMode: 'M83',
    supportedNozzlesMm: [0.4, 0.6, 0.8],
    defaultNozzleMm: 0.4,
    nozzleLimits: SHARED_NOZZLE_LIMITS,
    cooling: SHARED_COOLING,
    tempsC: SHARED_TEMPS_C,
    purgeLine: Object.freeze({ x: 12.0, yStart: 12.0, yEnd: cfg.purgeYEnd, z: 0.28, e: cfg.purgeE }),
    gantryParkZ: cfg.gantryParkZ,
    exportFilePrefix: cfg.exportFilePrefix,
    slicerMetadata: Object.freeze(cfg.slicerMetadata)
  });
}

export const PRINTER_PROFILES = Object.freeze({
  bambu_a1: makePrinter({
    id: 'bambu_a1', name: 'Bambu Lab A1', shortLabel: 'A1', defaultSlicer: 'bambu_studio',
    supportedSlicers: ['bambu_studio', 'orcaslicer'], bedMm: 256, maxSafeZ: 250,
    purgeYEnd: 112.0, purgeE: 6.0, gantryParkZ: 245, exportFilePrefix: 'sketch3d_bambu_a1',
    slicerMetadata: { printer_model: 'Bambu Lab A1', printer_settings_id: 'Bambu Lab A1 0.4 nozzle', curr_bed_type: 'Textured PEI Plate', gcode_flavor: 'marlin' }
  }),
  bambu_a1_mini: makePrinter({
    id: 'bambu_a1_mini', name: 'Bambu Lab A1 Mini', shortLabel: 'A1 Mini', defaultSlicer: 'bambu_studio',
    supportedSlicers: ['bambu_studio', 'orcaslicer'], bedMm: 180, maxSafeZ: 174,
    purgeYEnd: 92.0, purgeE: 5.0, gantryParkZ: 170, exportFilePrefix: 'sketch3d_bambu_a1_mini',
    slicerMetadata: { printer_model: 'Bambu Lab A1 mini', printer_settings_id: 'Bambu Lab A1 mini 0.4 nozzle', curr_bed_type: 'Textured PEI Plate', gcode_flavor: 'marlin' }
  }),
  orca_generic: makePrinter({
    id: 'orca_generic', name: 'Generic Orca (250³)', shortLabel: 'Orca 250', defaultSlicer: 'orcaslicer',
    supportedSlicers: ['orcaslicer', 'bambu_studio'], bedMm: 250, maxSafeZ: 244,
    purgeYEnd: 112.0, purgeE: 6.0, gantryParkZ: 240, exportFilePrefix: 'sketch3d_orca_250',
    slicerMetadata: { printer_model: 'Generic Orca Klipper/Marlin 250', printer_settings_id: 'Generic OrcaSlicer 0.4 nozzle', curr_bed_type: 'Textured PEI Plate', gcode_flavor: 'klipper' }
  })
});

export const SLICER_PROFILE_PRESETS = Object.freeze({
  standard: {
    profile_name: 'Standard / Solid (PLA)', spiral_mode: '0', wall_loops: '3',
    sparse_infill_density: '15%', sparse_infill_pattern: 'gyroid', layer_height: '0.20',
    outer_wall_line_width: '0.42', nozzle_diameter: ['0.4'], nozzle_temperature: ['210'],
    bed_temperature: ['60'], filament_flow_ratio: ['0.98'], fan_min_speed: ['100'], fan_max_speed: ['100']
  },
  multi_perimeter: {
    profile_name: 'Multi-Perimeter (Hollow)', spiral_mode: '0', wall_loops: '4',
    sparse_infill_density: '0%', layer_height: '0.20', outer_wall_line_width: '0.45',
    nozzle_diameter: ['0.4'], nozzle_temperature: ['210'], bed_temperature: ['60'],
    filament_flow_ratio: ['0.98'], fan_min_speed: ['100'], fan_max_speed: ['100']
  },
  basket_weave_arachne: {
    profile_name: 'Basket-Weave Arachne (Open-Aperture)', spiral_mode: '0', wall_generator: 'arachne',
    wall_loops: '2', layer_height: '0.2', line_width: '0.42', outer_wall_line_width: '0.42',
    detect_overhang_wall: '1', bridge_speed: '50', overhang_4_4_speed: '10', enable_support: '0',
    nozzle_diameter: ['0.4'], nozzle_temperature: ['210'], bed_temperature: ['60'],
    filament_flow_ratio: ['0.98'], fan_min_speed: ['100'], fan_max_speed: ['100']
  },
  clear_glass: {
    profile_name: 'Clear Glass Look (Translucent PETG / PLA)', spiral_mode: '0',
    fan_min_speed: ['0'], fan_max_speed: ['0'], outer_wall_speed: '25', inner_wall_speed: '25',
    sparse_infill_speed: '25', filament_flow_ratio: ['1.05'], sparse_infill_pattern: 'alignedrectilinear',
    sparse_infill_density: '100%', outer_wall_line_width: '0.45', layer_height: '0.20',
    nozzle_diameter: ['0.4'], nozzle_temperature: ['245'], bed_temperature: ['65']
  },
  lfam: {
    profile_name: 'LFAM Wide-Bead (0.8 mm Nozzle)', spiral_mode: '0', outer_wall_line_width: '1.20',
    layer_height: '0.40', outer_wall_speed: '35', inner_wall_speed: '35',
    nozzle_diameter: ['0.8'], nozzle_temperature: ['215'], bed_temperature: ['60'],
    filament_flow_ratio: ['1.00'], fan_min_speed: ['80'], fan_max_speed: ['100']
  },
  vase: {
    profile_name: 'Vase Mode (PLA)', spiral_mode: '1', outer_wall_line_width: '0.65',
    layer_height: '0.20', outer_wall_speed: '60', nozzle_diameter: ['0.4'],
    nozzle_temperature: ['210'], bed_temperature: ['60'], filament_flow_ratio: ['0.98'],
    fan_min_speed: ['100'], fan_max_speed: ['100']
  }
});

export function normalizePrinterId(printerId = DEFAULT_PRINTER_ID) {
  return Object.prototype.hasOwnProperty.call(PRINTER_PROFILES, printerId) ? printerId : DEFAULT_PRINTER_ID;
}

export function normalizeSlicerTarget(slicerTarget = DEFAULT_SLICER_TARGET) {
  return slicerTarget === 'orcaslicer' ? 'orcaslicer' : 'bambu_studio';
}

export function getPrinterProfile(printerId = DEFAULT_PRINTER_ID) {
  return PRINTER_PROFILES[normalizePrinterId(printerId)];
}

export function listPrinterProfiles() {
  return Object.values(PRINTER_PROFILES);
}

export function getSlicerTargetInfo(slicerTarget = DEFAULT_SLICER_TARGET) {
  return SLICER_TARGETS[normalizeSlicerTarget(slicerTarget)];
}

export function getNozzleSafetyLimits(printerId = DEFAULT_PRINTER_ID, nozzleDiameter = 0.4) {
  const printer = getPrinterProfile(printerId);
  const key = Number(nozzleDiameter) === 0.8 ? 0.8 : (Number(nozzleDiameter) === 0.6 ? 0.6 : 0.4);
  const lim = printer.nozzleLimits[key] || printer.nozzleLimits[0.4];
  return {
    nozzleDiameter: key,
    ...lim,
    safeBoundsXY: { ...printer.safeBoundsXY },
    safeBoundsZ: { ...printer.safeBoundsZ }
  };
}

export function checkBoundsFitPrinter(dims, printerId = DEFAULT_PRINTER_ID) {
  const printer = getPrinterProfile(printerId);
  const w = Number(dims?.width ?? dims?.w ?? 0);
  const d = Number(dims?.depth ?? dims?.d ?? 0);
  const h = Number(dims?.height ?? dims?.h ?? 0);
  const widthOk = w <= printer.bedWidthMm + 1e-4;
  const depthOk = d <= printer.bedDepthMm + 1e-4;
  const heightOk = h <= printer.maxHeightMm + 1e-4;
  return {
    fits: widthOk && depthOk && heightOk,
    widthOk,
    depthOk,
    heightOk,
    printerId: printer.id,
    printerName: printer.name,
    shortLabel: printer.shortLabel,
    envelopeMm: [printer.bedWidthMm, printer.bedDepthMm, printer.maxHeightMm]
  };
}

export function buildSlicerProjectSettings(profile = 'standard', slicerTarget = DEFAULT_SLICER_TARGET, printerId = DEFAULT_PRINTER_ID, options = {}) {
  const targetInfo = getSlicerTargetInfo(slicerTarget);
  const printer = getPrinterProfile(printerId);
  const preset = SLICER_PROFILE_PRESETS[profile] || SLICER_PROFILE_PRESETS.standard;
  const w = printer.bedWidthMm;
  const d = printer.bedDepthMm;
  const brimEnabled = Boolean(options?.brimEnabled);
  const brimWidth = brimEnabled ? Math.max(2, Math.min(20, Number(options?.brimWidthMm ?? 5))) : 0;
  const filamentTypes = Array.isArray(options?.filamentTypes) && options.filamentTypes.length > 0
    ? options.filamentTypes
    : undefined;
  return {
    ...preset,
    nozzle_diameter: [...preset.nozzle_diameter],
    nozzle_temperature: [...preset.nozzle_temperature],
    bed_temperature: [...preset.bed_temperature],
    filament_flow_ratio: [...preset.filament_flow_ratio],
    fan_min_speed: [...preset.fan_min_speed],
    fan_max_speed: [...preset.fan_max_speed],
    brim_type: brimEnabled ? 'outer_only' : 'no_brim',
    brim_width: String(brimWidth),
    brim_object_gap: brimEnabled ? '0.1' : '0',
    ...(filamentTypes ? { filament_type: filamentTypes } : {}),
    extrusion_mode: printer.extrusionMode,
    printer_profile: printer.id,
    printer_model: printer.slicerMetadata.printer_model,
    printer_settings_id: printer.slicerMetadata.printer_settings_id,
    curr_bed_type: printer.slicerMetadata.curr_bed_type,
    gcode_flavor: targetInfo.id === 'orcaslicer' && printer.id === 'orca_generic' ? 'klipper' : printer.slicerMetadata.gcode_flavor,
    printable_area: [`0x0`, `${w}x0`, `${w}x${d}`, `0x${d}`],
    printable_height: String(printer.maxHeightMm),
    slicer_target: targetInfo.id,
    slicer_application: targetInfo.application
  };
}
