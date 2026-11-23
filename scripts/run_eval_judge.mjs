/**
 * SKETCH3D — @eval-judge Grader
 * ==============================
 * Adversarial metric grader verifying binary STL/.3MF bytes against golden baseline.
 * Emits verdict.json and exits non-zero if any tolerance check fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT_DIR, 'evals', 'runs', 'latest');

const CYAN = '\x1b[96m', GREEN = '\x1b[92m', RED = '\x1b[91m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

function parseBinarySTL(buf) {
  if (buf.length < 84) throw new Error('STL buffer too short (< 84 bytes)');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (buf.length < expectedSize) throw new Error(`STL size truncated: expected ${expectedSize}, got ${buf.length}`);

  let offset = 84;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let hasNaN = false;
  const vertices = [];

  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;

      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) hasNaN = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      vertices.push({ x, y, z });
    }
    offset += 2; // attribute byte count
  }

  return { triCount, vertexCount: vertices.length, bounds: { minX, maxX, minY, maxY, minZ, maxZ }, hasNaN, vertices };
}

function parse3MFZip(buf) {
  if (buf.length < 22) throw new Error('3MF buffer too short (< 22 bytes)');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = view.getUint32(0, true);
  if (sig !== 0x04034b50) throw new Error(`Invalid PKZIP signature: 0x${sig.toString(16)}`);

  // Scan for embedded config entries in the ZIP stream
  const textContent = buf.toString('latin1');
  const hasFanZero = textContent.includes('fan_max_speed') && textContent.includes('"0"');
  const hasAlignedRectilinear = textContent.includes('alignedrectilinear');
  const hasModel3D = textContent.includes('3D/3dmodel.model');

  return { isValidZip: true, hasFanZero, hasAlignedRectilinear, hasModel3D, size: buf.length };
}

async function main() {
  console.log(`\n${CYAN}${BOLD}[@eval-judge] Starting Adversarial Evaluation Grader...${RESET}`);

  const manifestPath = path.join(RUNS_DIR, 'manifest.json');
  const goldenPath = path.join(ROOT_DIR, 'evals', 'golden', 'baseline_metrics.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`${RED}[@eval-judge] manifest.json not found at ${manifestPath}${RESET}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
  const tolerances = golden.tolerances || {};

  const verdict = {
    judged_at: new Date().toISOString(),
    status: 'PASS',
    total_recipes: Object.keys(tolerances).length,
    passed_count: 0,
    failed_count: 0,
    details: {}
  };

  for (const [rId, tol] of Object.entries(tolerances)) {
    const entry = manifest.recipes?.[rId];
    if (!entry) {
      verdict.details[rId] = { status: 'FAIL', reason: `Recipe ${rId} missing from executor manifest` };
      verdict.failed_count++;
      console.log(`  ${RED}✖ [FAIL] ${rId}: Missing from manifest${RESET}`);
      continue;
    }

    const filePath = path.join(RUNS_DIR, entry.file);
    if (!fs.existsSync(filePath)) {
      verdict.details[rId] = { status: 'FAIL', reason: `Artifact file ${entry.file} missing on disk` };
      verdict.failed_count++;
      console.log(`  ${RED}✖ [FAIL] ${rId}: Missing file ${entry.file}${RESET}`);
      continue;
    }

    const fileBuf = fs.readFileSync(filePath);
    const checks = [];

    try {
      if (entry.format === '3mf') {
        const parsed = parse3MFZip(fileBuf);
        checks.push({ name: 'Valid PKZIP', pass: parsed.isValidZip });
        checks.push({ name: 'Contains 3D Model', pass: parsed.hasModel3D });
        if (tol.fan_max_speed) {
          checks.push({ name: '0% Fan Speed in Slicer Profile', pass: parsed.hasFanZero });
        }
        if (tol.sparse_infill_pattern) {
          checks.push({ name: 'Aligned Rectilinear Infill', pass: parsed.hasAlignedRectilinear });
        }
        if (tol.min_file_size_bytes) {
          checks.push({ name: 'File Size > 500B', pass: parsed.size >= tol.min_file_size_bytes });
        }
      } else {
        const parsed = parseBinarySTL(fileBuf);
        checks.push({ name: 'Zero NaN coordinates', pass: !parsed.hasNaN });
        checks.push({ name: 'Valid Triangles (>= 12)', pass: parsed.triCount >= 12 });

        if (tol.max_bottom_top_centroid_diff_mm !== undefined) {
          // Verify bottom vs top cross section centroid drift in STL horizontal plane (X, Y)
          let bX = 0, bY = 0, bN = 0;
          let tX = 0, tY = 0, tN = 0;
          const bMinZ = parsed.bounds.minZ, bMaxZ = parsed.bounds.maxZ;
          for (const v of parsed.vertices) {
            if (Math.abs(v.z - bMinZ) < 0.2) { bX += v.x; bY += v.y; bN++; }
            if (Math.abs(v.z - bMaxZ) < 0.2) { tX += v.x; tY += v.y; tN++; }
          }
          const drift = bN && tN ? Math.hypot((tX / tN) - (bX / bN), (tY / tN) - (bY / bN)) : 0;
          checks.push({
            name: `Centroid Drift <= ${tol.max_bottom_top_centroid_diff_mm}mm`,
            pass: drift <= tol.max_bottom_top_centroid_diff_mm,
            detail: `${drift.toFixed(4)}mm`
          });
        }

        if (tol.max_revolve_xz_asymmetry_mm !== undefined) {
          const asymmX = Math.abs(parsed.bounds.maxX + parsed.bounds.minX);
          const asymmY = Math.abs(parsed.bounds.maxY + parsed.bounds.minY);
          checks.push({
            name: `Revolve Symmetry < ${tol.max_revolve_xz_asymmetry_mm}mm`,
            pass: asymmX < tol.max_revolve_xz_asymmetry_mm && asymmY < tol.max_revolve_xz_asymmetry_mm,
            detail: `X: ${asymmX.toFixed(3)}mm, Y: ${asymmY.toFixed(3)}mm`
          });
        }

        if (tol.expected_height_mm !== undefined) {
          const height = parsed.bounds.maxZ - parsed.bounds.minZ;
          checks.push({
            name: `Height ~= ${tol.expected_height_mm}mm`,
            pass: Math.abs(height - tol.expected_height_mm) <= 1.5,
            detail: `${height.toFixed(2)}mm`
          });
        }

        if (tol.max_clamped_height_mm !== undefined) {
          const height = parsed.bounds.maxZ - parsed.bounds.minZ;
          checks.push({
            name: `Height clamped <= ${tol.max_clamped_height_mm}mm`,
            pass: height <= tol.max_clamped_height_mm + 0.1,
            detail: `${height.toFixed(2)}mm`
          });
        }
      }
    } catch (err) {
      checks.push({ name: 'Parse Execution', pass: false, detail: err.message });
    }

    const recipePass = checks.every(c => c.pass);
    verdict.details[rId] = {
      name: entry.name,
      status: recipePass ? 'PASS' : 'FAIL',
      checks
    };

    if (recipePass) {
      verdict.passed_count++;
      console.log(`  ${GREEN}✔ [PASS]${RESET} ${BOLD}${rId}: ${entry.name}${RESET}`);
    } else {
      verdict.failed_count++;
      console.log(`  ${RED}✖ [FAIL]${RESET} ${BOLD}${rId}: ${entry.name}${RESET}`);
      checks.filter(c => !c.pass).forEach(c => console.log(`      -> Failed: ${c.name} (${c.detail || 'violates tolerance'})`));
    }
  }

  if (verdict.failed_count > 0) {
    verdict.status = 'FAIL';
  }

  const verdictPath = path.join(RUNS_DIR, 'verdict.json');
  fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));

  console.log(`\n${BOLD}=== Dual-Agent Evaluation Verdict ===${RESET}`);
  console.log(`Passed:   ${GREEN}${verdict.passed_count}${RESET} / ${verdict.total_recipes}`);
  console.log(`Failed:   ${verdict.failed_count === 0 ? GREEN + '0' : RED + verdict.failed_count}${RESET}`);
  console.log(`Verdict:  ${verdict.status === 'PASS' ? GREEN + BOLD + 'PASS' : RED + BOLD + 'FAIL'}${RESET}`);
  console.log(`Report:   ${verdictPath}\n`);

  if (verdict.status !== 'PASS') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${RED}[@eval-judge] Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
