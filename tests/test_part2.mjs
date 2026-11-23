/**
 * SKETCH3D — Part 2 Comprehensive Automated Test Suite
 * =====================================================
 * Rigorous test coverage for Labs 1–4:
 * TC-F1: Recursive-descent math expression parser & cycle detector
 * TC-F2: Concentric stepped lathe lathe revolve & 45° chamfer automation
 * TC-F3: Boolean pocket cutter, captive hex nut traps & countersink bores
 * TC-F4: Multi-plane coordinate frames & bidirectional projections
 * TC-F5: Parametric split-body lip & groove tool with wall thickness audit
 * TC-F6: Multi-part collision detection & Bambu A1 bed auto-arrange
 * TC-LAB: End-to-end multi-part assembly workflows
 */

import { evaluateExpression, evaluateMathExpression, validateExpression, MathParserError } from '../src/utils/mathParser.js';
import { HARDWARE_PRESETS, generateHexagonVertices, measureHexagonAcrossFlats } from '../src/config/hardwarePresets.js';
import { buildSteppedRevolveProfile, auditRevolveOverhangs } from '../src/geometry/revolveTool.js';
import { initCsg, CsgScope, createExtrudedSolid, createCylinderSolid, createHexNutSolid } from '../src/geometry/csgKernel.js';
import { cutThroughHole, cutBlindPocket, cutHexNutPocket, cutCountersinkHole, splitIslands } from '../src/geometry/pocketCutter.js';
import { DATUM_PLANES, createCustomPlane, planeToWorld, worldToPlane, raycastPlane, transformSolidToPlane } from '../src/canvas/planeSelector.js';
import { splitBodyWithLip, checkJointInterference, MIN_WALL_THICKNESS_MM } from '../src/geometry/splitBody.js';
import { checkPartIntersections, autoArrangeParts, BED_SIZE_MM } from '../src/geometry/plateArranger.js';

const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const CYAN = '\x1b[96m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function assert(cond, name, details = '') {
  if (cond) {
    passed++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${BOLD}${name}${RESET}${details ? ' — ' + details : ''}`);
  } else {
    failed++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${BOLD}${name}${RESET}${details ? ' — ' + details : ''}`);
  }
}

async function runPart2Tests() {
  console.log(`\n${CYAN}${BOLD}=== Running SKETCH3D Part 2 Feature Roadmap Test Suite ===${RESET}\n`);

  // =========================================================================
  // TC-F1: Math Expression Parser
  // =========================================================================
  console.log(`${BOLD}TC-F1: Math Expression Parser & Cycle Detector${RESET}`);
  assert(evaluateExpression('12 + 5 * 2') === 22, 'Operator precedence (12 + 5 * 2 = 22)');
  assert(evaluateExpression('(10 + 2) * 3') === 36, 'Parentheses override ((10 + 2) * 3 = 36)');
  assert(Math.abs(evaluateExpression('256 / 4 - 4') - 60) < 1e-6, 'Division & subtraction (256 / 4 - 4 = 60)');
  assert(evaluateExpression('-5 + 10') === 5, 'Unary minus (-5 + 10 = 5)');
  assert(evaluateExpression('width / 2 + 10', { width: 40 }) === 30, 'Variable substitution');

  // Division by zero
  let divZeroCaught = false;
  try {
    evaluateExpression('10 / 0');
  } catch (e) {
    divZeroCaught = e instanceof MathParserError;
  }
  assert(divZeroCaught, 'Division by zero rejected with MathParserError');

  // Circular variable references
  let cycleCaught = false;
  try {
    evaluateExpression('a + 1', { a: 'b + 1', b: 'a + 1' });
  } catch (e) {
    cycleCaught = e instanceof MathParserError;
  }
  assert(cycleCaught, 'Circular variable references detected & rejected');

  // =========================================================================
  // TC-F2: Concentric Stepped Lathe Revolve Tool
  // =========================================================================
  console.log(`\n${BOLD}TC-F2: Stepped Lathe Profile & Support-Free Chamfer Automation${RESET}`);
  const steppedSegments = [
    { od: 40, id: 10, height: 15, chamfer45: true },
    { od: 20, id: 10, height: 20 },
    { od: 30, id: 10, height: 10, chamfer45: true },
  ];
  const steppedProfile = buildSteppedRevolveProfile(steppedSegments, { autoChamfer: true });

  assert(steppedProfile.length >= 6, 'Generated stepped lathe profile points', `Points: ${steppedProfile.length}`);
  const auditRes = auditRevolveOverhangs(steppedSegments);
  assert(auditRes.isSupportFree, '45° chamfers ensure all outward steps are support-free', `Warnings: ${auditRes.warnings.length}`);

  // =========================================================================
  // Initialize WASM CSG Kernel
  // =========================================================================
  console.log(`\n${BOLD}Initializing WASM CSG Kernel (manifold-3d)...${RESET}`);
  const csg = await initCsg();
  assert(csg !== null && typeof csg.Manifold === 'function', 'manifold-3d WASM runtime initialized');

  // =========================================================================
  // TC-F3: Boolean Cutters & Fastener Pockets
  // =========================================================================
  console.log(`\n${BOLD}TC-F3: Boolean Cutters & Fastener Traps${RESET}`);
  const scope1 = new CsgScope();

  // Create 50x50x20mm base solid block
  const baseBlock = scope1.track(csg.Manifold.cube([50, 50, 20], true));
  const baseVol = baseBlock.getProperties().volume;

  // 1. Through Hole
  const throughHoleSolid = scope1.track(cutThroughHole(baseBlock, 0, 0, 4.0));
  const throughHoleVol = throughHoleSolid.getProperties().volume;
  const throughDiff = baseVol - throughHoleVol;
  assert(throughDiff > 990 && throughDiff < 1010, 'Through-hole bore cuts cleanly through entire body', `Removed: ${throughDiff.toFixed(1)}mm³`);

  // 2. Blind Pocket
  const blindSolid = scope1.track(cutBlindPocket(baseBlock, 0, 0, 5.0, 8.0));
  const blindVol = blindSolid.getProperties().volume;
  const blindDiff = baseVol - blindVol;
  assert(blindDiff > 620 && blindDiff < 640, 'Blind pocket respects exact depth limit', `Removed: ${blindDiff.toFixed(1)}mm³`);

  // 3. M4 Captive Hex Nut Trap
  const m4NutSolid = scope1.track(cutHexNutPocket(baseBlock, 0, 0, 'HEX_NUT_M4', 'axial'));
  const m4NutVol = m4NutSolid.getProperties().volume;
  const m4NutDiff = baseVol - m4NutVol;
  assert(m4NutDiff > 350 && m4NutDiff < 420, 'Captive M4 hex nut trap cuts hexagonal cavity + bolt through-bore');

  // 4. M4 Countersink Screw Bore (90° head, 45° slope)
  const cskSolid = scope1.track(cutCountersinkHole(baseBlock, 0, 0, 'CSK_WOOD_M4'));
  const cskVol = cskSolid.getProperties().volume;
  const cskDiff = baseVol - cskVol;
  assert(cskDiff > 280 && cskDiff < 340, 'M4 Countersink hole cuts conical 45° head recess + shank bore');

  // 5. Disjoint Island Audit
  const bisectCutter = scope1.track(csg.Manifold.cube([60, 4, 30], true));
  const severedBlock = scope1.track(baseBlock.subtract(bisectCutter));
  const islands = splitIslands(severedBlock);
  assert(islands.length === 2, 'Severed body accurately decomposes into 2 disjoint islands');
  islands.forEach(isl => isl.delete());

  scope1.dispose();

  // =========================================================================
  // TC-F4: Multi-Plane Coordinate Frames
  // =========================================================================
  console.log(`\n${BOLD}TC-F4: Multi-Plane Coordinate Frames & Projections${RESET}`);
  // Plane to World and World to Plane roundtrip on Top (XY)
  const xyWorld = planeToWorld(25, -15, DATUM_PLANES.XY, 8);
  const xyBack = worldToPlane(xyWorld.x, xyWorld.y, xyWorld.z, DATUM_PLANES.XY);
  assert(Math.abs(xyBack.u - 25) < 1e-4 && Math.abs(xyBack.v - (-15)) < 1e-4, 'XY Plane bidirectional roundtrip');

  // Front (XZ) plane
  const xzWorld = planeToWorld(10, 30, DATUM_PLANES.XZ, 5);
  const xzBack = worldToPlane(xzWorld.x, xzWorld.y, xzWorld.z, DATUM_PLANES.XZ);
  assert(Math.abs(xzBack.u - 10) < 1e-4 && Math.abs(xzBack.v - 30) < 1e-4, 'XZ Front Plane bidirectional roundtrip');

  // Custom Face Plane
  const customPlane = createCustomPlane([10, 20, 30], [0, 1, 0]);
  const cWorld = planeToWorld(5, 5, customPlane, 0);
  const cBack = worldToPlane(cWorld.x, cWorld.y, cWorld.z, customPlane);
  assert(Math.abs(cBack.u - 5) < 1e-4 && Math.abs(cBack.v - 5) < 1e-4, 'Custom Planar Face bidirectional roundtrip');

  // Raycast to Plane
  const rayHit = raycastPlane([0, 0, 50], [0, 0, -1], DATUM_PLANES.XY);
  assert(rayHit.hit && Math.abs(rayHit.t - 50) < 1e-4 && Math.abs(rayHit.pointWorld.z) < 1e-4, 'Raycast intersects plane at Z = 0');

  // =========================================================================
  // TC-F5: Parametric Split-Body Lip & Groove Tool
  // =========================================================================
  console.log(`\n${BOLD}TC-F5: Split-Body Lip & Groove Interlocking Joint${RESET}`);
  const scope2 = new CsgScope();
  const enclosureBlock = scope2.track(csg.Manifold.cube([50, 50, 30], false));

  // Reject thin wall thickness (< 1.6mm)
  let thinWallRejected = false;
  try {
    splitBodyWithLip(enclosureBlock, 15, { wallThicknessMm: 1.4 });
  } catch (err) {
    thinWallRejected = err.message.includes('>= 1.6mm');
  }
  assert(thinWallRejected, 'Rejects wall thickness < 1.6mm per FDM manufacturing guidelines');

  // Valid split at Z = 15mm with 2.4mm wall, 3mm lip, 0.2mm clearance
  const splitResult = splitBodyWithLip(enclosureBlock, 15, {
    wallThicknessMm: 2.4,
    lipHeightMm: 3.0,
    clearanceMm: 0.2,
  });

  const baseBBox = splitResult.base.boundingBox();
  const lidBBox = splitResult.lid.boundingBox();
  assert(Math.abs(baseBBox.max[2] - 18.0) < 0.1, 'Base includes 3mm male lip protruding to Z = 18mm', `Base max Z: ${baseBBox.max[2].toFixed(1)}mm`);
  assert(Math.abs(lidBBox.min[2] - 15.0) < 0.1, 'Lid includes recessed female groove starting at Z = 15mm');

  // Zero interference verification
  const interCheck = checkJointInterference(splitResult.base, splitResult.lid);
  assert(interCheck.isCollisionFree && interCheck.interferenceVolumeMm3 < 0.01, 'Zero volumetric interference between interlocking Base and Lid');

  splitResult.base.delete();
  splitResult.lid.delete();
  scope2.dispose();

  // =========================================================================
  // TC-F6: Multi-Part Assembly & Auto-Arrange Engine
  // =========================================================================
  console.log(`\n${BOLD}TC-F6: Multi-Part Assembly & Bambu A1 Bed Auto-Arrange${RESET}`);
  const scope3 = new CsgScope();

  // Two colliding parts and one disjoint part
  const pA = scope3.track(csg.Manifold.cube([30, 30, 15], false).translate([0, 0, 0]));
  const pB = scope3.track(csg.Manifold.cube([30, 30, 15], false).translate([15, 0, 0])); // Overlaps pA by 15mm
  const pC = scope3.track(csg.Manifold.cube([40, 40, 10], false).translate([80, 80, 0]));

  const preCollision = checkPartIntersections([pA, pB, pC]);
  assert(preCollision.hasCollisions && preCollision.collisions.length === 1, 'Pairwise collision detector flags overlapping solids', `Collisions: ${preCollision.collisions.length}`);

  // Auto-arrange onto Bambu Lab A1 build bed (256x256mm, >= 6mm gap)
  const arrangePlan = autoArrangeParts([pA, pB, pC], { margin: 6.0, gap: 6.0, centerOnBed: true });
  assert(arrangePlan.fitsOnPlate, '3 parts fit within 256×256mm Bambu Lab A1 build envelope');
  assert(arrangePlan.arranged.length === 3, 'All 3 parts assigned placement translations');

  // Apply translations and verify zero collisions after auto-arrange
  const movedA = scope3.track(pA.translate(arrangePlan.arranged[0].translation));
  const movedB = scope3.track(pB.translate(arrangePlan.arranged[1].translation));
  const movedC = scope3.track(pC.translate(arrangePlan.arranged[2].translation));

  const postCollision = checkPartIntersections([movedA, movedB, movedC]);
  assert(!postCollision.hasCollisions && postCollision.collisions.length === 0, 'Zero collisions after automated build-plate arrangement');

  // Verify bases sit flat on Z = 0
  const flatZ = [movedA, movedB, movedC].every(m => Math.abs(m.boundingBox().min[2]) < 1e-4);
  assert(flatZ, 'All part bases aligned flat to build plate at Z = 0');

  scope3.dispose();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n${BOLD}=== Part 2 Test Summary ===${RESET}`);
  console.log(`Passed:   ${passed}`);
  console.log(`Failed:   ${failed}`);

  if (failed > 0) {
    console.error(`\n${RED}Part 2 test suite FAILED with ${failed} error(s).${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}Part 2 test suite PASSED successfully! All ${passed} checks verified.${RESET}\n`);
  }
}

runPart2Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
