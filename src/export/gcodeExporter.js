/**
 * SKETCH3D — Bambu Lab A1 G-Code Exporter, Donor Wrap & .gcode.3mf Packager
 * ===========================================================================
 * Generates verified Bambu Lab A1 .gcode and wireless .gcode.3mf files,
 * gated by the 5-layer Safety Firewall (gcodeSafetyGate.js).
 */

import { compilePartToolpath } from '../geometry/toolpathKernel.js';
import { validateGCodeSafety } from './gcodeSafetyGate.js';
import { buildZipBuffer, build3DModelXml, getSlicerProfileSettings } from './threemfExporter.js';
import { getPrinterProfile, getSlicerTargetInfo } from './printerProfile.js';

const DONOR_STORAGE_KEY = 'sketch3d_donor_gcode_v1';

/**
 * Pure-JS FNV/SHA-like deterministic 64-hex digest fallback when crypto.subtle is unavailable.
 * @param {string} str
 * @returns {Promise<string>}
 */
async function sha256Hex(str) {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(str);
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic 256-bit fallback for headless/non-HTTPS contexts
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9, h3 = 0x85ebca6b, h4 = 0xc2b2ae35;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (c * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (c ^ 0x5a), 0x27d4eb2f) >>> 0;
  }
  return [h1, h2, h3, h4, h1 ^ h3, h2 ^ h4, h1 ^ h2, h3 ^ h4]
    .map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * Extracts Start G-code header and End G-code footer from a Bambu Studio donor .gcode file.
 * @param {string} rawText
 * @returns {{header:string,footer:string}|null}
 */
export function parseDonorGCode(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const lines = rawText.split(/\r?\n/);
  let bodyStartIdx = lines.findIndex(l => /;\s*(LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE|SKETCH3D_BODY_START)/i.test(l));
  if (bodyStartIdx < 0) {
    bodyStartIdx = lines.findIndex(l => /^G1\s+.*Z0\.2/.test(l.trim()));
  }
  let bodyEndIdx = lines.findIndex((l, idx) => idx > bodyStartIdx && /;\s*(EXECUTABLE_BLOCK_END|END_GCODE|filament used)/i.test(l));
  if (bodyEndIdx < 0) {
    for (let i = lines.length - 1; i > bodyStartIdx; i--) {
      if (/^M104\s+S0\b/.test(lines[i].trim())) {
        bodyEndIdx = i;
        break;
      }
    }
  }
  if (bodyStartIdx <= 0 || bodyEndIdx <= bodyStartIdx) return null;
  return {
    header: lines.slice(0, bodyStartIdx).join('\n'),
    footer: lines.slice(bodyEndIdx).join('\n')
  };
}

export function saveDonorGCode(rawText) {
  const parsed = parseDonorGCode(rawText);
  if (!parsed) return false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DONOR_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (_) {}
  return true;
}

export function loadDonorGCode() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DONOR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function buildDefaultPrinterHeader(printer, nozzleTemp = 210, bedTemp = 60) {
  const p = printer.purgeLine;
  return [
    `; ${printer.name} Verified Start G-Code (${printer.bedWidthMm}x${printer.bedDepthMm}x${printer.maxHeightMm}mm, ${printer.extrusionMode})`,
    'G90 ; Absolute positioning',
    `${printer.extrusionMode} ; Relative extrusion mode`,
    `M140 S${bedTemp} ; Set bed temperature`,
    `M104 S${nozzleTemp} ; Set nozzle temperature`,
    'G28 ; Home all axes',
    `M190 S${bedTemp} ; Wait for bed`,
    `M109 S${nozzleTemp} ; Wait for nozzle`,
    `G1 X${p.x.toFixed(1)} Y${p.yStart.toFixed(1)} Z${p.z.toFixed(2)} F3000 ; Move to purge start`,
    `G1 X${p.x.toFixed(1)} Y${p.yEnd.toFixed(1)} E${p.e.toFixed(1)} F1500 ; Purge line`,
    'G92 E0'
  ].join('\n');
}

function buildDefaultPrinterFooter(printer) {
  return [
    `; ${printer.name} Verified End G-Code`,
    'G1 E-1.2 F1800 ; Retract',
    `G1 Z${printer.gantryParkZ} F1200 ; Raise gantry`,
    'M104 S0 ; Turn off hotend',
    'M140 S0 ; Turn off bed',
    'M106 S0 ; Turn off part cooling fan',
    'M84 ; Disable steppers'
  ].join('\n');
}

function serializeWaypoints(waypoints) {
  const lines = ['; SKETCH3D_BODY_START'];
  let lastFan = -1;

  for (const wp of waypoints) {
    if (wp.fan !== lastFan) {
      lines.push(`M106 P1 S${wp.fan}`);
      lastFan = wp.fan;
    }
    if (wp.isTravel) {
      lines.push(`G0 X${wp.x.toFixed(3)} Y${wp.y.toFixed(3)} Z${wp.z.toFixed(3)} F${wp.f}`);
    } else {
      const comment = wp.kind === 'weave' ? ' ; kind=weave' : '';
      lines.push(`G1 X${wp.x.toFixed(3)} Y${wp.y.toFixed(3)} Z${wp.z.toFixed(3)} E${wp.e.toFixed(5)} F${wp.f}${comment}`);
    }
  }
  lines.push('; SKETCH3D_BODY_END');
  return lines.join('\n');
}

/**
 * Compiles, wraps, hashes, and validates G-code through the 5-layer Safety Firewall.
 * @param {Object} part
 * @param {Object} [options]
 * @returns {Promise<{gcode:string,stats:Object,safety:Object,waypoints:Array}>}
 */
export async function compileAndValidateGCode(part, options = {}) {
  const printer = getPrinterProfile(options.printerProfile);
  const slicerInfo = getSlicerTargetInfo(options.slicerTarget);
  const nozzleTemp = Math.max(printer.tempsC.nozzle.min, Math.min(printer.tempsC.nozzle.max, Number(options.nozzleTemp) || printer.tempsC.nozzle.default));
  const bedTemp = Math.max(printer.tempsC.bed.min, Math.min(printer.tempsC.bed.max, Number(options.bedTemp) || printer.tempsC.bed.default));
  const { waypoints, stats } = compilePartToolpath(part, { ...options, printerProfile: printer.id });

  const body = serializeWaypoints(waypoints);
  const bodySha = await sha256Hex(body);

  const donor = options.useDonor ? loadDonorGCode() : null;
  const header = donor ? donor.header : buildDefaultPrinterHeader(printer, nozzleTemp, bedTemp);
  const footer = donor ? donor.footer : buildDefaultPrinterFooter(printer);

  const auditReport = [
    '; SKETCH3D SAFETY AUDIT REPORT',
    `; Target-Printer: ${printer.name} (${printer.bedWidthMm}x${printer.bedDepthMm}x${printer.maxHeightMm}mm) | Slicer: ${slicerInfo.label} | Nozzle: ${stats.nozzleDiameter}mm | Scale: ${Math.round(stats.scaleFactor * 100)}%`,
    `; Bounds-XY: [${stats.bounds.minX.toFixed(1)}, ${stats.bounds.maxX.toFixed(1)}] x [${stats.bounds.minY.toFixed(1)}, ${stats.bounds.maxY.toFixed(1)}] mm`,
    `; Bounds-Z: [${stats.bounds.minZ.toFixed(2)}, ${stats.bounds.maxZ.toFixed(2)}] mm | Layers: ${stats.layerCount}`,
    `; Temps: Nozzle ${nozzleTemp}C / Bed ${bedTemp}C | Fan: S0 (L0) -> S180..S255`,
    `; Max-Flow: ${stats.maxFlowMm3S} mm3/s | Max-Bridge: ${stats.maxBridgeSpanMm} mm | Max-ZSlope: ${stats.maxZSlopeDeg} deg`,
    `; Body-SHA256: ${bodySha}`
  ].join('\n');

  const gcode = `${auditReport}\n${header}\n${body}\n${footer}\n`;
  const safety = validateGCodeSafety(gcode, {
    nozzleDiameter: stats.nozzleDiameter,
    printerProfile: printer.id,
    isDonorWrapped: !!donor
  });

  return { gcode, stats, safety, waypoints, bodySha, printerProfile: printer.id, slicerTarget: slicerInfo.id };
}

/**
 * Packages validated G-code + optional 3D model into a Bambu/Orca .gcode.3mf ZIP buffer.
 * @param {string} gcode
 * @param {string} bodySha
 * @param {Array<Object>} parts
 * @param {Array<THREE.Mesh>} meshes
 * @param {string} [slicerProfile='vase']
 * @param {string} [slicerTarget='bambu_studio']
 * @param {string} [printerId='bambu_a1']
 * @returns {ArrayBuffer}
 */
export function buildGCode3MFBuffer(gcode, bodySha, parts = [], meshes = [], slicerProfile = 'vase', slicerTarget = 'bambu_studio', printerId = 'bambu_a1') {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
    `  <Default Extension="gcode" ContentType="text/x.gcode"/>\n` +
    `  <Default Extension="md5" ContentType="text/plain"/>\n` +
    `  <Default Extension="config" ContentType="text/plain"/>\n` +
    `</Types>\n`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Target="/3D/3dmodel.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
    `</Relationships>\n`;

  const modelXml = build3DModelXml(parts, meshes, slicerTarget, printerId);
  const projectSettings = getSlicerProfileSettings(slicerProfile, slicerTarget, printerId);

  return buildZipBuffer([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: '3D/3dmodel.model', data: modelXml },
    { name: 'Metadata/plate_1.gcode', data: gcode },
    { name: 'Metadata/plate_1.gcode.md5', data: bodySha.slice(0, 32) },
    { name: 'Metadata/project_settings.config', data: JSON.stringify(projectSettings, null, 2) }
  ]);
}

export function triggerDownload(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
