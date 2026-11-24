/**
 * SKETCH3D — Eval Archive & Disk Rotation Manager
 * =================================================
 * Manages evaluation run lifecycles, historical telemetry ledger, and disk hygiene:
 * - Rotates past evaluation runs into evals/runs/archive/ with strict retention bounds (<= 3 runs).
 * - Caps total eval disk storage below quota (default 40MB).
 * - Appends compact immutable telemetry lines to evals/history.jsonl.
 * - Synchronizes canonical golden visual benchmark contact sheets to evals/samples/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVALS_DIR = path.join(ROOT_DIR, 'evals');
const RUNS_DIR = path.join(EVALS_DIR, 'runs');
const LATEST_DIR = path.join(RUNS_DIR, 'latest');
const ARCHIVE_DIR = path.join(RUNS_DIR, 'archive');
const SAMPLES_DIR = path.join(EVALS_DIR, 'samples');
const HISTORY_FILE = path.join(EVALS_DIR, 'history.jsonl');

const CYAN = '\x1b[96m', GREEN = '\x1b[92m', YELLOW = '\x1b[93m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

/**
 * Recursively calculate total size in bytes of a directory
 */
export function getDirectorySizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let totalBytes = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalBytes += getDirectorySizeBytes(fullPath);
    } else if (entry.isFile()) {
      try {
        totalBytes += fs.statSync(fullPath).size;
      } catch {}
    }
  }
  return totalBytes;
}

/**
 * Format bytes into human-readable string
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Get current git commit hash (short)
 */
export function getGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Prepare latest run directory, archiving any existing previous run into archive/
 */
export function prepareRunDirectory() {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.mkdirSync(LATEST_DIR, { recursive: true });

  // If latest has existing files, archive it with timestamp
  const existingFiles = fs.readdirSync(LATEST_DIR);
  if (existingFiles.length > 0) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const archiveTarget = path.join(ARCHIVE_DIR, `run_${timestamp}`);
    fs.mkdirSync(archiveTarget, { recursive: true });

    for (const f of existingFiles) {
      const src = path.join(LATEST_DIR, f);
      const dst = path.join(archiveTarget, f);
      try {
        fs.renameSync(src, dst);
      } catch {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
      }
    }
  }
}

/**
 * Rotate archives: retain only maxArchives runs and ensure total disk stays under maxDiskBytes
 */
export function rotateArchives({ maxArchives = 3, maxDiskBytes = 40 * 1024 * 1024 } = {}) {
  if (!fs.existsSync(ARCHIVE_DIR)) return { prunedCount: 0, currentSize: getDirectorySizeBytes(RUNS_DIR) };

  const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('run_'))
    .sort((a, b) => a.name.localeCompare(b.name)); // oldest first

  let prunedCount = 0;

  // 1. Retention count enforcement
  while (entries.length > maxArchives) {
    const oldest = entries.shift();
    const target = path.join(ARCHIVE_DIR, oldest.name);
    fs.rmSync(target, { recursive: true, force: true });
    prunedCount++;
  }

  // 2. Storage quota enforcement
  let totalSize = getDirectorySizeBytes(RUNS_DIR);
  while (totalSize > maxDiskBytes && entries.length > 0) {
    const oldest = entries.shift();
    const target = path.join(ARCHIVE_DIR, oldest.name);
    fs.rmSync(target, { recursive: true, force: true });
    prunedCount++;
    totalSize = getDirectorySizeBytes(RUNS_DIR);
  }

  const formattedSize = formatBytes(totalSize);
  const formattedLimit = formatBytes(maxDiskBytes);
  console.log(`  ${CYAN}[archive-manager]${RESET} Disk hygiene audit: ${entries.length} archive runs kept, ${prunedCount} pruned. Disk usage: ${BOLD}${formattedSize}${RESET} / ${formattedLimit} quota.`);

  return { prunedCount, currentSize: totalSize };
}

/**
 * Append run summary to evals/history.jsonl
 */
export function recordRunHistory(runRecord) {
  fs.mkdirSync(EVALS_DIR, { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    git_commit: getGitCommit(),
    ...runRecord
  };
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  console.log(`  ${GREEN}✔${RESET} Run telemetry ledger appended to ${path.relative(ROOT_DIR, HISTORY_FILE)}`);
}

/**
 * Synchronize canonical golden benchmarks to evals/samples/
 */
export function syncGoldenSamples(archetypeVerdicts) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  const sampleMappings = [
    { src: 'vase_spiral_multiview.png', alt: 'vase_wave_multiview.png', dst: 'sample_vase_multiview.png' },
    { src: 'bauble_ornament_multiview.png', dst: 'sample_bauble_multiview.png' },
    { src: 'christmas_tree_multiview.png', dst: 'sample_tree_multiview.png' },
    { src: 'precision_cube_multiview.png', dst: 'sample_cube_multiview.png' }
  ];

  const copiedSamples = [];
  for (const m of sampleMappings) {
    let sourcePath = path.join(LATEST_DIR, m.src);
    if (!fs.existsSync(sourcePath) && m.alt) {
      sourcePath = path.join(LATEST_DIR, m.alt);
    }
    if (fs.existsSync(sourcePath)) {
      const destPath = path.join(SAMPLES_DIR, m.dst);
      fs.copyFileSync(sourcePath, destPath);
      copiedSamples.push(m.dst);
    }
  }

  // Write golden benchmarks metadata spec
  const goldenSpecPath = path.join(SAMPLES_DIR, 'golden_benchmarks.json');
  const goldenSpec = {
    version: '2.0.0',
    description: 'SKETCH3D Canonical Visual & Geometric Ground-Truth Benchmarks for VLM and Multi-Angle Orbit Verification',
    updated_at: new Date().toISOString(),
    git_commit: getGitCommit(),
    archetypes: {
      vase: {
        name: 'Minimalist Cylindrical Vase (Revolve 360° + Spiral Ribbon)',
        multiview_sample: 'sample_vase_multiview.png',
        key_geometry_checks: {
          subdivided_profile_resampling: true,
          min_vertex_count: 4000,
          max_inner_cavity_drift_mm: 0.01,
          texture_wrapping_theta_variance: '> 0.10',
          revolve_angle: 360
        },
        quadrant_inspection_rubric: {
          isometric: 'Continuous 360-degree cylindrical shell with uniform helical ribbon relief on outer surface.',
          top_cavity: 'Strictly concentric inner hollow cavity (circle r=23.4mm) with zero wall bleed or interior ripples.',
          front: 'Level horizontal base, vertical outer ribs rising uniformly without pinch or axis skew.',
          rear_back: 'Seamless 360-degree closure at theta=PI with zero seam cleft, facet gaps, or missing faces.'
        }
      },
      bauble: {
        name: 'Christmas Bauble Ornament (Spherical Revolve + Spiral Bulb)',
        multiview_sample: 'sample_bauble_multiview.png',
        key_geometry_checks: {
          expected_diameter_mm: 70.0,
          diameter_tolerance_mm: 2.0,
          expected_height_mm: 80.0,
          shell_thickness_mm: 1.6,
          max_filament_mass_grams: 35.0
        },
        quadrant_inspection_rubric: {
          isometric: 'Smooth bulbous spherical curvature with spiral ribbons tapering gracefully at both poles.',
          top_cavity: 'Open neck collar for ornament cap/hook attachment, clean rim without non-manifold singularities.',
          front: 'Symmetrical bulb silhouette with smooth overhang angle transitions suitable for support-free vase printing.',
          rear_back: 'Identical back curvature and ribbon alignment confirming axis symmetry.'
        }
      },
      tree: {
        name: 'Multi-Tiered Christmas Tree (Stepped Lathe Overhangs + Wave Needle Ridges)',
        multiview_sample: 'sample_tree_multiview.png',
        key_geometry_checks: {
          max_overhang_angle_deg: 55,
          overhang_warnings: 0,
          bambu_a1_bed_fit: true,
          max_bed_size_mm: 256
        },
        quadrant_inspection_rubric: {
          isometric: 'Conical tiered silhouette with distinct shelf steps and wave surface needle texture.',
          top_cavity: 'Centered apex needle tip terminating on revolve axis without vertex explosion.',
          front: 'Tiered steps clearly defined, overhang angles <= 55 degrees ensuring FDM printability.',
          rear_back: 'Complete 360-degree concentricity across all 4 branch tiers.'
        }
      },
      cube: {
        name: 'Precision Cube with Hardware Pocket & Bore (CSG Boolean Engine)',
        multiview_sample: 'sample_cube_multiview.png',
        key_geometry_checks: {
          base_extrude_dim_mm: [40, 40, 40],
          bore_diameter_mm: 4.5,
          hardware_preset: 'HEX_NUT_M4',
          is_2_manifold: true,
          watertight: true
        },
        quadrant_inspection_rubric: {
          isometric: 'Crisp 40mm cube with clearly cut central bore and recessed hex nut pocket.',
          top_cavity: 'Sharp hexagonal flat-to-flat pocket walls matching M4 hardware tolerance.',
          front: 'Cylindrical through-bore penetrating cleanly through bottom face without residual thin membranes.',
          rear_back: 'Solid flat rear and side faces free from degenerate triangles or self-intersections.'
        }
      }
    }
  };

  fs.writeFileSync(goldenSpecPath, JSON.stringify(goldenSpec, null, 2), 'utf-8');
  console.log(`  ${GREEN}✔${RESET} Golden visual benchmarks and spec updated in ${path.relative(ROOT_DIR, SAMPLES_DIR)} (${copiedSamples.length} contact sheets synchronized).`);
}

// Standalone execution helper
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`\n${BOLD}[eval-archive-manager] Running manual disk & archive audit...${RESET}`);
  rotateArchives();
}
