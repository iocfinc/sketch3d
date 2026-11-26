#!/usr/bin/env python3
"""
SKETCH3D — Standalone 5-Layer Bambu Lab A1 G-Code Validator
===========================================================
Mirrors src/export/gcodeSafetyGate.js for CI / merge-gate verification.
Supports raw .gcode files and .gcode.3mf ZIP archives.
"""

import math
import re
import sys
import zipfile
from pathlib import Path

FILAMENT_AREA_MM2 = math.pi * (1.75 * 0.5) ** 2


def parse_num(line: str, letter: str):
    m = re.search(rf"\b{letter}(-?\d+(?:\.\d+)?)", line)
    return float(m.group(1)) if m else None


def load_gcode_text(file_path: Path) -> str:
    if file_path.name.endswith(".gcode.3mf") or file_path.suffix == ".3mf":
        with zipfile.ZipFile(file_path, "r") as zf:
            for candidate in ("Metadata/plate_1.gcode", "plate_1.gcode"):
                if candidate in zf.namelist():
                    return zf.read(candidate).decode("utf-8", errors="replace")
            for name in zf.namelist():
                if name.endswith(".gcode"):
                    return zf.read(name).decode("utf-8", errors="replace")
        raise ValueError(f"No .gcode payload found inside {file_path}")
    return file_path.read_text(encoding="utf-8", errors="replace")


def validate_gcode(gcode_text: str, nozzle_diameter: float = 0.4):
    max_flow_limit = 20.0 if nozzle_diameter == 0.6 else 15.0
    max_bridge_limit = 8.0 if nozzle_diameter == 0.6 else 6.0
    max_z_gap_limit = 0.75 * nozzle_diameter
    errors = []

    def err(layer: int, line_no: int, msg: str):
        if len(errors) < 50:
            errors.append((layer, line_no, msg))

    lines = gcode_text.splitlines()
    has_audit = any("; SKETCH3D SAFETY AUDIT REPORT" in l for l in lines)
    has_sha = any("; Body-SHA256:" in l for l in lines)
    if not has_audit or not has_sha:
        err(5, 1, "Missing ; SKETCH3D SAFETY AUDIT REPORT or Body-SHA256 header")

    saw_g90 = saw_m83 = saw_g28 = saw_m109 = saw_body = False
    saw_cd_m104 = saw_cd_m140 = saw_cd_fan = saw_m84 = False
    saw_l0_slow = saw_fan_after_l1 = False
    cur_x, cur_y, cur_z, cur_f, cur_fan = 128.0, 128.0, 0.0, 1500.0, 0.0
    max_flow = max_bridge = 0.0

    for idx, raw_line in enumerate(lines, start=1):
        raw = raw_line.strip()
        if not raw:
            continue
        if re.search(r"\b(NaN|Infinity|-Infinity)\b", raw, re.IGNORECASE):
            err(3, idx, f"Invalid numeric token: {raw}")
            continue
        if "; SKETCH3D_BODY_START" in raw:
            saw_body = True
        code = raw.split(";", 1)[0].strip()
        if not code:
            continue
        cmd = code.split()[0]

        if cmd == "G90":
            saw_g90 = True
        elif cmd == "M83":
            saw_m83 = True
        elif cmd == "G28":
            saw_g28 = True
        elif cmd == "M84":
            saw_m84 = True
        elif cmd == "M82":
            err(2, idx, "Forbidden M82 detected; M83 required")
        elif cmd == "M112":
            err(2, idx, "Forbidden M112 emergency stop detected")
        elif cmd == "G91" and saw_body:
            err(2, idx, "Forbidden G91 inside toolpath body")
        elif cmd in ("M104", "M109"):
            s = parse_num(code, "S")
            if s is not None:
                if s == 0 and cmd == "M104":
                    saw_cd_m104 = True
                elif s > 0:
                    if s >= 300 or s < 190 or s > 230:
                        err(1, idx, f"Nozzle temp {s}C outside PLA-safe [190, 230]C")
                    if cmd == "M109" and s >= 175:
                        saw_m109 = True
        elif cmd in ("M140", "M190"):
            s = parse_num(code, "S")
            if s is not None:
                if s == 0 and cmd == "M140":
                    saw_cd_m140 = True
                elif s > 0 and (s >= 100 or s < 45 or s > 65):
                    err(1, idx, f"Bed temp {s}C outside PLA-safe [45, 65]C")
        elif cmd == "M106":
            s = parse_num(code, "S")
            if s is not None:
                cur_fan = s
                if s == 0:
                    saw_cd_fan = True
                if saw_body and cur_z > 0.25 and s >= 128:
                    saw_fan_after_l1 = True
        elif cmd == "M107":
            cur_fan = 0.0
            saw_cd_fan = True
        elif cmd in ("G0", "G1"):
            nx, ny, nz = parse_num(code, "X"), parse_num(code, "Y"), parse_num(code, "Z")
            ne, nf = parse_num(code, "E"), parse_num(code, "F")
            if nf is not None and nf > 0:
                cur_f = nf
            tx = nx if nx is not None else cur_x
            ty = ny if ny is not None else cur_y
            tz = nz if nz is not None else cur_z

            if not saw_g28 and (nx is not None or ny is not None or nz is not None or (ne is not None and ne > 0)):
                err(2, idx, f"Motion before G28: {code}")
            if ne is not None and ne > 0 and not saw_m109:
                err(1, idx, f"Extrusion before M109 >= 175C: {code}")

            if saw_body:
                if not (10.0 <= tx <= 246.0 and 10.0 <= ty <= 246.0):
                    err(2, idx, f"XY out of [10, 246] bounds: ({tx}, {ty})")
                if not (0.1 <= tz <= 250.0):
                    err(2, idx, f"Z out of [0.1, 250] bounds: {tz}")
                dx, dy, dz = tx - cur_x, ty - cur_y, tz - cur_z
                horiz = math.hypot(dx, dy)
                dist = math.hypot(horiz, dz)
                if ne is not None and ne > 0 and dist > 0.05:
                    if tz <= 0.25 and cur_f <= 1800:
                        saw_l0_slow = True
                    e_per_mm = ne / dist
                    if e_per_mm < 0.01 or e_per_mm > 0.35:
                        err(3, idx, f"E/dist={e_per_mm:.4f} outside [0.01, 0.35]")
                    flow = (ne * FILAMENT_AREA_MM2) / (dist / max(0.1, cur_f / 60.0))
                    max_flow = max(max_flow, flow)
                    if flow > max_flow_limit:
                        err(3, idx, f"Flow {flow:.2f} mm3/s > {max_flow_limit} mm3/s")
                    max_bridge = max(max_bridge, horiz)
                    if horiz > max_bridge_limit:
                        err(4, idx, f"Unsupported span {horiz:.2f}mm > {max_bridge_limit}mm")
                    if abs(dz) > max_z_gap_limit:
                        err(4, idx, f"Floating Z-gap {abs(dz):.3f}mm > {max_z_gap_limit:.3f}mm")
                    if horiz > 0.2 and abs(dz) > 0.01:
                        slope = math.degrees(math.atan2(abs(dz), horiz))
                        if slope > 22.5:
                            err(2, idx, f"Non-planar Z-slope {slope:.1f} deg > 22 deg")
                    if "; kind=weave" in raw and cur_fan < 255:
                        err(1, idx, f"Weave segment requires M106 P1 S255 (got S{cur_fan})")

            cur_x, cur_y, cur_z = tx, ty, tz

    if not saw_g90:
        err(2, 1, "Missing G90")
    if not saw_m83:
        err(2, 1, "Missing M83")
    if not saw_g28:
        err(2, 1, "Missing G28")
    if not saw_m109:
        err(1, 1, "Missing M109 >= 175C")
    if not (saw_cd_m104 and saw_cd_m140 and saw_cd_fan and saw_m84):
        err(1, len(lines), "Missing End G-code cooldown (M104 S0, M140 S0, M106 S0, M84)")
    if not saw_l0_slow:
        err(4, 1, "Missing slow Layer 0 Z=0.20mm anchor")
    if not saw_fan_after_l1:
        err(1, 1, "Part cooling fan not active after Layer 1")

    return len(errors) == 0, errors, {"max_flow": max_flow, "max_bridge": max_bridge, "lines": len(lines)}


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/gcode_validator.py <file.gcode|file.gcode.3mf> [nozzle_mm]")
        sys.exit(2)
    path = Path(sys.argv[1])
    nozzle = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4
    text = load_gcode_text(path)
    passed, errors, stats = validate_gcode(text, nozzle)
    if passed:
        print(f"PASS 5/5 Safety Layers | lines={stats['lines']} | maxFlow={stats['max_flow']:.2f} mm3/s | maxBridge={stats['max_bridge']:.2f} mm")
        sys.exit(0)
    for layer, line_no, msg in errors[:10]:
        print(f"FAIL [Layer {layer} line {line_no}]: {msg}")
    sys.exit(1)


if __name__ == "__main__":
    main()
