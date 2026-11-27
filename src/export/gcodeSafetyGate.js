/**
 * SKETCH3D — 5-Layer Non-Bypassable Bambu Lab A1 G-Code Safety Firewall
 * ======================================================================
 * Blocks export and reports exact failing lines if any of the 5 safety layers fail:
 * 1. Thermal & Fan Integrity
 * 2. Mechanical & Non-Planar Clearance
 * 3. Volumetric Flow & Anti-Blob Math
 * 4. Printability & Zero-Waste Preflight
 * 5. Provenance & Audit Report Header
 */

import { getPrinterProfile, getNozzleSafetyLimits } from './printerProfile.js';

const FILAMENT_AREA_MM2 = Math.PI * (1.75 * 0.5) ** 2;

function parseNum(line, letter) {
  const m = line.match(new RegExp(`\\b${letter}(-?\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : null;
}

/**
 * Validates G-code text against all 5 Bambu Lab A1 safety layers.
 * @param {string} gcodeText
 * @param {Object} [options]
 * @param {number} [options.nozzleDiameter=0.4]
 * @param {boolean} [options.isDonorWrapped=false]
 * @returns {{passed:boolean,errors:Array<{layer:number,line:number,message:string}>,summary:Object}}
 */
export function validateGCodeSafety(gcodeText, options = {}) {
  const printer = getPrinterProfile(options.printerProfile);
  const limits = getNozzleSafetyLimits(printer.id, options.nozzleDiameter);
  const nozzleDiameter = limits.nozzleDiameter;
  const maxFlowLimit = limits.maxFlowMm3S;
  const maxBridgeLimit = limits.maxBridgeMm;
  const maxZGapLimit = limits.maxZGapMm;
  const minXY = printer.safeBoundsXY.min;
  const maxXY = printer.safeBoundsXY.max;
  const minZ = printer.safeBoundsZ.min;
  const maxZ = printer.safeBoundsZ.max;
  const tempLimits = printer.tempsC;

  const errors = [];
  const pushErr = (layer, line, message) => {
    if (errors.length < 50) errors.push({ layer, line, message });
  };

  if (!gcodeText || typeof gcodeText !== 'string') {
    pushErr(5, 1, 'Empty G-code payload');
    return { passed: false, errors, summary: {} };
  }

  const lines = gcodeText.split(/\r?\n/);

  // Layer 5: Provenance header check
  const hasAuditHeader = lines.some(l => l.includes('; SKETCH3D SAFETY AUDIT REPORT'));
  const hasSha256 = lines.some(l => l.includes('; Body-SHA256:'));
  if (!hasAuditHeader || !hasSha256) {
    pushErr(5, 1, 'Missing ; SKETCH3D SAFETY AUDIT REPORT or Body-SHA256 provenance header');
  }

  let sawG90 = false;
  let sawM83 = false;
  let sawG28 = false;
  let sawM109Valid = false;
  let sawBodyStart = false;
  let sawCooldownM104 = false;
  let sawCooldownM140 = false;
  let sawCooldownFan = false;
  let sawM84 = false;
  let sawLayer0Slow = false;
  let sawFanAfterLayer1 = false;

  let curX = printer.bedCenter.x;
  let curY = printer.bedCenter.y;
  let curZ = 0;
  let curF = 1500;
  let curFan = 0;
  let maxFlowSeen = 0;
  let maxBridgeSeen = 0;
  let minTempSeen = Infinity;
  let maxTempSeen = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i].trim();
    if (!raw) continue;

    if (/\b(NaN|Infinity|-Infinity)\b/i.test(raw)) {
      pushErr(3, lineNo, `Invalid numeric token (NaN/Infinity): ${raw}`);
      continue;
    }

    if (raw.includes('; SKETCH3D_BODY_START')) sawBodyStart = true;

    const codeOnly = raw.split(';')[0].trim();
    if (!codeOnly) continue;

    const tokens = codeOnly.split(/\s+/);
    const cmd = tokens[0];

    if (cmd === 'G90') sawG90 = true;
    if (cmd === 'M83') sawM83 = true;
    if (cmd === 'G28') sawG28 = true;
    if (cmd === 'M84') sawM84 = true;

    if (cmd === 'M82') pushErr(2, lineNo, 'Forbidden M82 (absolute extrusion) detected; M83 required');
    if (cmd === 'M112') pushErr(2, lineNo, 'Forbidden M112 (emergency stop) detected');
    if (cmd === 'G91' && sawBodyStart) pushErr(2, lineNo, 'Forbidden G91 relative positioning inside toolpath body');

    if (cmd === 'M104' || cmd === 'M109') {
      const s = parseNum(codeOnly, 'S');
      if (s !== null) {
        if (s === 0 && cmd === 'M104') sawCooldownM104 = true;
        else if (s > 0) {
          minTempSeen = Math.min(minTempSeen, s);
          maxTempSeen = Math.max(maxTempSeen, s);
          if (s >= 300 || s < tempLimits.nozzle.min || s > tempLimits.nozzle.max) {
            pushErr(1, lineNo, `Nozzle temperature ${s}°C outside PLA-safe [${tempLimits.nozzle.min}, ${tempLimits.nozzle.max}]°C`);
          }
          if (cmd === 'M109' && s >= 175) sawM109Valid = true;
        }
      }
    }

    if (cmd === 'M140' || cmd === 'M190') {
      const s = parseNum(codeOnly, 'S');
      if (s !== null) {
        if (s === 0 && cmd === 'M140') sawCooldownM140 = true;
        else if (s > 0 && (s >= 100 || s < tempLimits.bed.min || s > tempLimits.bed.max)) {
          pushErr(1, lineNo, `Bed temperature ${s}°C outside PLA-safe [${tempLimits.bed.min}, ${tempLimits.bed.max}]°C`);
        }
      }
    }

    if (cmd === 'M106') {
      const s = parseNum(codeOnly, 'S');
      if (s !== null) {
        curFan = s;
        if (s === 0) sawCooldownFan = true;
        if (sawBodyStart && curZ > 0.25 && s >= 128) sawFanAfterLayer1 = true;
      }
    }
    if (cmd === 'M107') {
      curFan = 0;
      sawCooldownFan = true;
    }

    if (cmd === 'G0' || cmd === 'G1') {
      const nx = parseNum(codeOnly, 'X');
      const ny = parseNum(codeOnly, 'Y');
      const nz = parseNum(codeOnly, 'Z');
      const ne = parseNum(codeOnly, 'E');
      const nf = parseNum(codeOnly, 'F');
      if (nf !== null && nf > 0) curF = nf;

      const targetX = nx !== null ? nx : curX;
      const targetY = ny !== null ? ny : curY;
      const targetZ = nz !== null ? nz : curZ;

      if (!sawG28 && (nx !== null || ny !== null || nz !== null || (ne !== null && ne > 0))) {
        pushErr(2, lineNo, `Motion command before G28 homing: ${codeOnly}`);
      }

      if (ne !== null && ne > 0 && !sawM109Valid) {
        pushErr(1, lineNo, `Extrusion move before M109 >= 175°C: ${codeOnly}`);
      }

      if (sawBodyStart) {
        if (targetX < minXY || targetX > maxXY || targetY < minXY || targetY > maxXY) {
          pushErr(2, lineNo, `XY out of safe ${printer.shortLabel} bounds [${minXY}, ${maxXY}]: (${targetX}, ${targetY})`);
        }
        if (targetZ < minZ || targetZ > maxZ) {
          pushErr(2, lineNo, `Z out of safe ${printer.shortLabel} bounds [${minZ}, ${maxZ}]: ${targetZ}`);
        }

        const dx = targetX - curX;
        const dy = targetY - curY;
        const dz = targetZ - curZ;
        const horiz = Math.hypot(dx, dy);
        const dist = Math.hypot(horiz, dz);

        if (ne !== null && ne > 0 && dist > 0.05) {
          if (targetZ <= 0.25 && curF <= 1800) sawLayer0Slow = true;

          const ePerMm = ne / dist;
          if (ePerMm < 0.01 || ePerMm > 0.35) {
            pushErr(3, lineNo, `Anomalous E/dist=${ePerMm.toFixed(4)} outside [0.01, 0.35]`);
          }

          const speedMmS = curF / 60;
          const flow = (ne * FILAMENT_AREA_MM2) / (dist / Math.max(0.1, speedMmS));
          maxFlowSeen = Math.max(maxFlowSeen, flow);
          if (flow > maxFlowLimit) {
            pushErr(3, lineNo, `Volumetric flow ${flow.toFixed(2)} mm³/s exceeds ${maxFlowLimit} mm³/s`);
          }

          maxBridgeSeen = Math.max(maxBridgeSeen, horiz);
          if (horiz > maxBridgeLimit) {
            pushErr(4, lineNo, `Unsupported span ${horiz.toFixed(2)} mm exceeds ${maxBridgeLimit} mm`);
          }

          if (Math.abs(dz) > maxZGapLimit) {
            pushErr(4, lineNo, `Floating Z-gap ${Math.abs(dz).toFixed(3)} mm exceeds ${maxZGapLimit.toFixed(3)} mm`);
          }

          if (horiz > 0.2 && Math.abs(dz) > 0.01) {
            const slopeDeg = (Math.atan2(Math.abs(dz), horiz) * 180) / Math.PI;
            if (slopeDeg > 22.5) {
              pushErr(2, lineNo, `Non-planar Z-slope ${slopeDeg.toFixed(1)}° exceeds 22° limit`);
            }
          }

          if (raw.includes('; kind=weave') && curFan < 255) {
            pushErr(1, lineNo, `Weave bridge segment requires M106 P1 S255 (found S${curFan})`);
          }
        }
      }

      curX = targetX;
      curY = targetY;
      curZ = targetZ;
    }
  }

  if (!sawG90) pushErr(2, 1, 'Missing G90 absolute positioning');
  if (!sawM83) pushErr(2, 1, 'Missing M83 relative extrusion');
  if (!sawG28) pushErr(2, 1, 'Missing G28 homing');
  if (!sawM109Valid) pushErr(1, 1, 'Missing M109 >= 175°C before extrusion');
  if (!sawCooldownM104 || !sawCooldownM140 || !sawCooldownFan || !sawM84) {
    pushErr(1, lines.length, 'Missing End G-code cooldown sequence (M104 S0, M140 S0, M106 S0, M84)');
  }
  if (!sawLayer0Slow) {
    pushErr(4, 1, 'Missing slow (<= 30 mm/s) Layer 0 Z=0.20mm anchor');
  }
  if (!sawFanAfterLayer1) {
    pushErr(1, 1, 'Part-cooling fan (M106 P1 S128-S255) not activated after Layer 1');
  }

  return {
    passed: errors.length === 0,
    errors,
    summary: {
      maxFlowMm3S: Number(maxFlowSeen.toFixed(2)),
      maxBridgeSpanMm: Number(maxBridgeSeen.toFixed(2)),
      minTempC: minTempSeen === Infinity ? null : minTempSeen,
      maxTempC: maxTempSeen || null,
      lineCount: lines.length
    }
  };
}
