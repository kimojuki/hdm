// Test de validation du rig TPS : cadrage écran + cohérence visée.
// Usage : node scripts/test-camera-rig.mjs
import * as THREE from 'three';
import { ThirdPersonCamera } from '../src/thirdPersonCamera.js';

let failures = 0;
function check(label, actual, expected, tol = 0.02) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual.toFixed(4)} (attendu ${expected})`);
}

const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
const rig = new ThirdPersonCamera({
  distance: 5.2,
  minDistance: 3,
  maxDistance: 8,
  pivotHeight: 1.4,
  initialPitch: THREE.MathUtils.degToRad(-12),
  screenAnchorX: 0.30,
  screenAnchorY: 0.60,
  maxLateralOffset: 100, // désactive le clamp pour le test de projection
});

const playerPos = new THREE.Vector3(3, 0.5, -7);

// Converge (dt=1 => snap des lissages)
rig.applyToCamera(camera, playerPos, 1);
rig.applyToCamera(camera, playerPos, 1);
camera.updateMatrixWorld(true);

// 1. Le pivot (épaules) doit se projeter à l'ancrage écran demandé.
const pivot = new THREE.Vector3(playerPos.x, playerPos.y + 1.4, playerPos.z);
const ndc = pivot.clone().project(camera);
check('NDC X du pivot (30% gauche => -0.4)', ndc.x, -0.4);
check('NDC Y du pivot (60% bas   => +0.2)', ndc.y, 0.2);

// 2. Le réticule (centre écran) doit correspondre exactement à getViewForward.
const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
const viewForward = rig.getViewForward(new THREE.Vector3());
check('forward.x caméra == visée', camForward.x, viewForward.x, 1e-6);
check('forward.y caméra == visée', camForward.y, viewForward.y, 1e-6);
check('forward.z caméra == visée', camForward.z, viewForward.z, 1e-6);

// 3. Pitch -12° => caméra AU-DESSUS du pivot (regard plongeant).
check('caméra au-dessus du pivot', camera.position.y > pivot.y ? 1 : 0, 1, 0);

// 4. Rig rigide après rotation : le pivot reste au même point écran.
rig.controller.targetYaw = 2.3;
rig.controller.targetPitch = THREE.MathUtils.degToRad(-30);
for (let i = 0; i < 300; i++) rig.applyToCamera(camera, playerPos, 1 / 60);
camera.updateMatrixWorld(true);
const ndc2 = pivot.clone().project(camera);
check('NDC X stable après rotation', ndc2.x, -0.4);
check('NDC Y stable après rotation', ndc2.y, 0.2);

// 5. Cadrage stable PENDANT une rotation rapide (rig rigide = pas de balayage).
rig.controller.targetYaw = -1.1;
let maxDriftX = 0;
let maxDriftY = 0;
for (let i = 0; i < 60; i++) {
  rig.applyToCamera(camera, playerPos, 1 / 60);
  camera.updateMatrixWorld(true);
  const n = pivot.clone().project(camera);
  maxDriftX = Math.max(maxDriftX, Math.abs(n.x - -0.4));
  maxDriftY = Math.max(maxDriftY, Math.abs(n.y - 0.2));
}
check('dérive écran X max pendant rotation', maxDriftX, 0, 0.01);
check('dérive écran Y max pendant rotation', maxDriftY, 0, 0.01);

// 6. Zoom visée : distance réduite de ~15 % quand actif.
rig.controller.setAimZoomActive(true, 0.85);
for (let i = 0; i < 300; i++) rig.applyToCamera(camera, playerPos, 1 / 60);
check('distance avec zoom visée', rig.controller.distance, 5.2 * 0.85, 0.03);
rig.controller.setAimZoomActive(false);
for (let i = 0; i < 300; i++) rig.applyToCamera(camera, playerPos, 1 / 60);
check('distance après relâche', rig.controller.distance, 5.2, 0.03);

// 7. Clamp pitch : jamais de retournement.
rig.applyDrag(0, 100000, false);
for (let i = 0; i < 120; i++) rig.applyToCamera(camera, playerPos, 1 / 60);
check('pitch clampé bas (-45°)', THREE.MathUtils.radToDeg(rig.getPitch()), -45, 0.5);
rig.applyDrag(0, -200000, false);
for (let i = 0; i < 120; i++) rig.applyToCamera(camera, playerPos, 1 / 60);
check('pitch clampé haut (+35°)', THREE.MathUtils.radToDeg(rig.getPitch()), 35, 0.5);

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
