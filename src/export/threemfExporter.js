/**
 * SKETCH3D — Unified Bambu Studio & OrcaSlicer Multi-Object .3MF Exporter
 * =========================================================================
 * Client-side uncompressed ZIP writer with embedded Bambu Studio / OrcaSlicer print profiles:
 * 1. Vase Mode (PLA): 0.65mm outer wall, 0.20mm layer, spiral vase, 100% fan, 60mm/s
 * 2. Basket-Weave Arachne (Open-Aperture): Arachne wall generator, 2 loops, 0.42mm width, overhang speed control
 * 3. Clear Glass Look (Translucent PETG / PLA): 0% fan, 25mm/s speed, 1.05 flow, 100% aligned rectilinear
 * 4. LFAM Wide-Bead (0.8mm Nozzle): 1.20mm outer wall, 0.40mm layer, 35mm/s speed
 *
 * Centers all meshes at Bambu Lab A1 build plate center (X=128, Y=128, Z=0).
 */

import { getExportFilename } from '../geometry/testScale.js';
import {
  normalizePrinterId,
  normalizeSlicerTarget,
  getPrinterProfile,
  getSlicerTargetInfo,
  buildSlicerProjectSettings
} from './printerProfile.js';
import { computeThreeMFItemPlacements, buildAmsFilamentTypes } from './threemfLayout.js';

export const DRYING_NOTIFICATION =
  'Dry Translucent PETG 65°C / 6–8h or Clear PLA 55°C / 4–6h before printing to prevent moisture frosting';

// Precomputed CRC32 Lookup Table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

export function computeCRC32(bytes) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Builds a valid uncompressed PKZIP ArrayBuffer from an array of file entries.
 * @param {Array<{name: string, data: string|Uint8Array}>} files
 * @returns {ArrayBuffer}
 */
export function buildZipBuffer(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => {
    const nameBytes = enc.encode(f.name);
    const dataBytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = computeCRC32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localSize = 0;
  entries.forEach(e => { localSize += 30 + e.nameBytes.length + e.dataBytes.length; });

  let cdSize = 0;
  entries.forEach(e => { cdSize += 46 + e.nameBytes.length; });

  const totalSize = localSize + cdSize + 22;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let offset = 0;
  const localOffsets = [];

  // Local File Headers + File Data
  entries.forEach(e => {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true); // UTF-8
    view.setUint16(offset + 8, 0, true);      // Stored (no compression)
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint32(offset + 14, e.crc, true);
    view.setUint32(offset + 18, e.dataBytes.length, true);
    view.setUint32(offset + 22, e.dataBytes.length, true);
    view.setUint16(offset + 26, e.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;

    u8.set(e.nameBytes, offset);
    offset += e.nameBytes.length;

    u8.set(e.dataBytes, offset);
    offset += e.dataBytes.length;
  });

  const cdOffset = offset;

  // Central Directory File Headers
  entries.forEach((e, idx) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.dataBytes.length, true);
    view.setUint32(offset + 24, e.dataBytes.length, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[idx], true);
    offset += 46;

    u8.set(e.nameBytes, offset);
    offset += e.nameBytes.length;
  });

  // End of Central Directory (EOCD)
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, cdSize, true);
  view.setUint32(offset + 16, cdOffset, true);
  view.setUint16(offset + 20, 0, true);

  return buffer;
}

function getSlicerApplication(slicerTarget = 'bambu_studio') {
  return getSlicerTargetInfo(slicerTarget).application;
}

function resolveMaterialTag(part) {
  if (part?.materialTag === 'clear' || part?.materialTag === 'opaque') {
    return part.materialTag;
  }
  return part?.shellMode === 'vase_proxy' || part?.color === '#73E6F1' ? 'clear' : 'opaque';
}

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TEXTURE_FIDELITY_MAP = {
  'open-weave': {
    mode: 'mesh_and_toolpath',
    label: 'Mesh + Toolpath',
    recommendedProfile: 'basket_weave_arachne'
  },
  'perforated-weave': {
    mode: 'mesh_and_toolpath',
    label: 'Mesh + Toolpath',
    recommendedProfile: 'basket_weave_arachne'
  },
  'lfam-rib': {
    mode: 'toolpath_only',
    label: 'Toolpath-Only',
    recommendedProfile: 'lfam'
  },
  none: {
    mode: 'base',
    label: 'Base Geometry',
    recommendedProfile: 'vase'
  }
};

/**
 * Returns Stage 4 texture execution fidelity metadata and recommended slicer profile.
 * @param {string} [pattern='none']
 * @returns {{ mode: 'mesh_and_toolpath'|'toolpath_only'|'base', label: string, recommendedProfile: 'basket_weave_arachne'|'vase'|'lfam' }}
 */
export function getTextureFidelityMetadata(pattern = 'none') {
  const key = pattern || 'none';
  if (TEXTURE_FIDELITY_MAP[key]) {
    return { ...TEXTURE_FIDELITY_MAP[key] };
  }
  return {
    mode: 'mesh_and_toolpath',
    label: 'Mesh + Toolpath',
    recommendedProfile: 'vase'
  };
}

/**
 * Resolves effective slicer profile, upgrading default 'vase'/'auto' to 'basket_weave_arachne'
 * when any part uses an open-aperture weave texture.
 * @param {Array<Object>} parts
 * @param {string} [requestedProfile='vase']
 * @returns {string}
 */
export function resolveAutoSlicerProfile(parts, requestedProfile = 'auto') {
  const list = Array.isArray(parts) ? parts : [];
  const hasOpenWeave = list.some(
    p => p?.texturePattern === 'open-weave' || p?.texturePattern === 'perforated-weave'
  );
  if (requestedProfile && requestedProfile !== 'auto') {
    if (hasOpenWeave && requestedProfile === 'vase') return 'basket_weave_arachne';
    return requestedProfile;
  }
  if (hasOpenWeave) return 'basket_weave_arachne';
  if (list.some(p => p?.texturePattern === 'lfam-rib')) return 'lfam';
  if (list.some(p => p?.shellEnabled && p?.shellMode === 'vase_proxy')) return 'vase';
  const hasHollow = list.some(p => p?.shellEnabled && p?.shellMode !== 'vase_proxy');
  if (hasHollow) {
    const multiWall = list.some(p => p?.shellEnabled && (Number(p.shellThickness || 1.2) > 1.0 || p.intent === 'lampshade'));
    return multiWall ? 'multi_perimeter' : 'vase';
  }
  return 'standard';
}

/**
 * Returns slicer profile configuration for Bambu Studio or OrcaSlicer.
 * @param {string} [profile='standard']
 * @param {string} [slicerTarget='bambu_studio']
 * @param {string} [printerId='bambu_a1']
 * @returns {Object}
 */
export function getSlicerProfileSettings(profile = 'standard', slicerTarget = 'bambu_studio', printerId = 'bambu_a1', options = {}) {
  return buildSlicerProjectSettings(profile, slicerTarget, printerId, options);
}

/**
 * Builds 3MF model XML and centered or un-nested mesh coordinates at active printer bed (Z=0).
 * @param {Array<Object>} parts
 * @param {Array<THREE.Mesh>} meshes
 * @param {string} [slicerTarget='bambu_studio']
 * @param {string} [printerId='bambu_a1']
 * @param {Object} [options]
 * @returns {string} XML content for 3D/3dmodel.model
 */
export function build3DModelXml(parts, meshes, slicerTarget = 'bambu_studio', printerId = 'bambu_a1', options = {}) {
  const slicerApp = getSlicerApplication(slicerTarget);
  const printer = getPrinterProfile(printerId);
  const unnestShells = Boolean(options?.unnestShells);

  let minZ = Infinity;
  const meshData = [];

  (meshes || []).forEach((m, idx) => {
    if (!m.geometry) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const pos = g.attributes.position;
    const count = pos.count;
    const tris = [];
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity, bMinZ = Infinity;

    for (let i = 0; i < count; i += 3) {
      const p1 = { x: pos.getX(i), y: -pos.getZ(i), z: pos.getY(i) };
      const p2 = { x: pos.getX(i + 1), y: -pos.getZ(i + 1), z: pos.getY(i + 1) };
      const p3 = { x: pos.getX(i + 2), y: -pos.getZ(i + 2), z: pos.getY(i + 2) };
      if (Number.isNaN(p1.x) || Number.isNaN(p2.x) || Number.isNaN(p3.x)) continue;

      bMinX = Math.min(bMinX, p1.x, p2.x, p3.x); bMaxX = Math.max(bMaxX, p1.x, p2.x, p3.x);
      bMinY = Math.min(bMinY, p1.y, p2.y, p3.y); bMaxY = Math.max(bMaxY, p1.y, p2.y, p3.y);
      bMinZ = Math.min(bMinZ, p1.z, p2.z, p3.z);
      minZ = Math.min(minZ, p1.z, p2.z, p3.z);
      tris.push([p1, p2, p3]);
    }

    g.dispose();
    const pIdx = m?.userData?.partIndex ?? idx;
    meshData.push({
      id: idx + 1,
      name: parts?.[pIdx]?.name || parts?.[idx]?.name || `Part ${idx + 1}`,
      tris,
      minZ: bMinZ < Infinity ? bMinZ : 0,
      bounds: { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY }
    });
  });

  const groundZ = minZ !== Infinity ? minZ : 0;
  const placements = computeThreeMFItemPlacements(meshData.map(d => d.bounds), printer, unnestShells);

  let objectsXml = '';
  let buildItemsXml = '';

  meshData.forEach((item, idx) => {
    let verticesXml = '';
    let trianglesXml = '';
    let vIdx = 0;
    const pl = placements[idx] || { tx: printer.bedCenter.x, ty: printer.bedCenter.y, tz: 0 };
    const zBase = unnestShells ? item.minZ : groundZ;

    item.tris.forEach(([p1, p2, p3]) => {
      const c1 = { x: p1.x.toFixed(3), y: p1.y.toFixed(3), z: (p1.z - zBase).toFixed(3) };
      const c2 = { x: p2.x.toFixed(3), y: p2.y.toFixed(3), z: (p2.z - zBase).toFixed(3) };
      const c3 = { x: p3.x.toFixed(3), y: p3.y.toFixed(3), z: (p3.z - zBase).toFixed(3) };

      verticesXml += `        <vertex x="${c1.x}" y="${c1.y}" z="${c1.z}"/>\n`;
      verticesXml += `        <vertex x="${c2.x}" y="${c2.y}" z="${c2.z}"/>\n`;
      verticesXml += `        <vertex x="${c3.x}" y="${c3.y}" z="${c3.z}"/>\n`;

      trianglesXml += `        <triangle v1="${vIdx}" v2="${vIdx + 1}" v3="${vIdx + 2}"/>\n`;
      vIdx += 3;
    });

    objectsXml += `    <object id="${item.id}" type="model" name="${escapeXmlAttr(item.name)}">\n` +
      `      <mesh>\n` +
      `        <vertices>\n${verticesXml}        </vertices>\n` +
      `        <triangles>\n${trianglesXml}        </triangles>\n` +
      `      </mesh>\n` +
      `    </object>\n`;

    const xf = `1 0 0 0 1 0 0 0 1 ${pl.tx.toFixed(3)} ${pl.ty.toFixed(3)} 0.000`;
    buildItemsXml += `    <item objectid="${item.id}" transform="${xf}"/>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
    `  <metadata name="Application">SKETCH3D A1 Studio</metadata>\n` +
    `  <metadata name="SlicerTarget">${slicerApp}</metadata>\n` +
    `  <metadata name="PrinterProfile">${escapeXmlAttr(printer.id)}</metadata>\n` +
    `  <metadata name="PrinterModel">${escapeXmlAttr(printer.name)}</metadata>\n` +
    `  <resources>\n${objectsXml}  </resources>\n` +
    `  <build>\n${buildItemsXml}  </build>\n` +
    `</model>\n`;
}

/**
 * Generates binary .3mf archive buffer.
 * @param {Array<Object>} parts
 * @param {Array<THREE.Mesh>} meshes
 * @param {string} [slicerProfile='vase'] 'vase' | 'basket_weave_arachne' | 'clear_glass' | 'lfam'
 * @param {string} [slicerTarget='bambu_studio'] 'bambu_studio' | 'orcaslicer'
 * @param {string} [printerId='bambu_a1']
 * @param {Object} [options={}]
 * @returns {ArrayBuffer}
 */
export function buildThreeMFBuffer(parts, meshes, slicerProfile = 'vase', slicerTarget = 'bambu_studio', printerId = 'bambu_a1', options = {}) {
  const target = normalizeSlicerTarget(slicerTarget);
  const slicerApplication = getSlicerApplication(target);
  const printer = getPrinterProfile(printerId);

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
    `  <Default Extension="config" ContentType="text/plain"/>\n` +
    `</Types>\n`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Target="/3D/3dmodel.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
    `</Relationships>\n`;

  const effectiveProfile = resolveAutoSlicerProfile(parts, slicerProfile);
  const modelXml = build3DModelXml(parts, meshes, target, printer.id, options);
  const filamentTypes = buildAmsFilamentTypes(parts);
  const projectSettings = getSlicerProfileSettings(effectiveProfile, target, printer.id, {
    brimEnabled: options?.brimEnabled,
    brimWidthMm: options?.brimWidthMm,
    filamentTypes
  });
  const modelSettings = {
    version: '1.0.0',
    slicerTarget: target,
    slicerApplication,
    printerProfile: printer.id,
    printerModel: printer.name,
    unnestShells: Boolean(options?.unnestShells),
    objects: (parts || []).map((p, i) => ({
      id: i + 1,
      name: p?.name || `Part ${i + 1}`,
      materialTag: resolveMaterialTag(p),
      polymer: String(p?.polymer || 'PLA').toUpperCase(),
      extruder: Math.max(1, Math.min(4, Math.round(Number(p?.amsSlot ?? (i + 1)))))
    }))
  };

  const files = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: '3D/3dmodel.model', data: modelXml },
    { name: 'Metadata/project_settings.config', data: JSON.stringify(projectSettings, null, 2) },
    { name: 'Metadata/model_settings.config', data: JSON.stringify(modelSettings, null, 2) }
  ];

  return buildZipBuffer(files);
}

/**
 * Triggers client-side browser download for a .3mf file.
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 */
export function downloadThreeMF(buffer, filename = 'sketch3d_bambu_a1.3mf') {
  const blob = new Blob([buffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * High-level .3MF export action coordinator with drying advisory toast.
 * @param {Array<Object>} parts
 * @param {THREE.Group} partsGroup
 * @param {string} [slicerProfile='vase']
 * @param {string} [scaleMode='full']
 * @param {Function} [showToast=console.log]
 * @param {string} [slicerTarget='bambu_studio']
 * @param {string} [printerId='bambu_a1']
 */
export function exportThreeMFFile(
  parts,
  partsGroup,
  slicerProfile = 'vase',
  scaleMode = 'full',
  showToast = console.log,
  slicerTarget = 'bambu_studio',
  printerId = 'bambu_a1',
  options = {}
) {
  const meshes = partsGroup.children.filter(c => c.isMesh && !c.userData?.isThermalGuide);
  if (meshes.length === 0) {
    showToast('Draw a closed shape first!');
    return;
  }

  const target = normalizeSlicerTarget(slicerTarget);
  const targetLabel = getSlicerTargetInfo(target).label;
  const printer = getPrinterProfile(printerId);
  const effectiveProfile = resolveAutoSlicerProfile(parts, slicerProfile);
  const buffer = buildThreeMFBuffer(parts, meshes, effectiveProfile, target, printer.id, options);
  let baseFilename = getExportFilename(printer.exportFilePrefix, scaleMode);
  if (baseFilename.endsWith('.stl')) {
    baseFilename = baseFilename.slice(0, -4);
  }
  const filename = `${baseFilename}.3mf`;

  downloadThreeMF(buffer, filename);

  if (effectiveProfile === 'clear_glass') {
    showToast(`Exported ${filename} (${targetLabel} · ${printer.shortLabel})! ${DRYING_NOTIFICATION}`);
  } else {
    showToast(`Exported ${filename} (${targetLabel} · ${printer.shortLabel}): ${meshes.length} object${meshes.length > 1 ? 's' : ''} (${effectiveProfile.toUpperCase()})`);
  }
}
