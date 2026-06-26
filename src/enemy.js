import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { snapObjectBaseToSurface, sampleTerrainHeightAtFeet } from './terrain.js';

const MECHA01_BASE = '/ennemie/Package';
const TARGET_HEIGHT = 2.2;
const ENEMY_SPEED = 3.2;
export const ENEMY_COLLISION_RADIUS = 0.48;
const PATROL_RADIUS = 7;
const ARRIVE_DIST = 0.4;
const WAIT_MIN = 0.8;
const WAIT_MAX = 2.4;
const TURN_SPEED = 9;
const MOVE_ACCEL = 10;
/** Le mesh MagicaVoxel regarde +X local ; Three.js avance sur +Z */
const MODEL_YAW_OFFSET = -Math.PI / 2;
const LEG_HEIGHT_RATIO = 0.34;
const STRIDE = 0.28;
const LEG_LIFT = 0.14;

let mechaTemplate = null;

function prepareEnemyMeshes(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.roughness = 0.85;
      mat.metalness = 0.15;
    }
  });
}

function cloneMaterial(mat) {
  if (!mat) return new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.85 });
  return Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
}

function classifyLegSide(pos, ia, ib, ic) {
  let left = 0;
  let right = 0;
  let cx = 0;
  for (const vi of [ia, ib, ic]) {
    const x = pos.getX(vi);
    cx += x;
    if (x < -0.01) left++;
    else if (x > 0.01) right++;
  }
  cx /= 3;
  if (left >= 2) return 'L';
  if (right >= 2) return 'R';
  return cx <= 0 ? 'L' : 'R';
}

function extractSubmesh(mesh, testFace) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const norm = geom.attributes.normal;
  const uv = geom.attributes.uv;
  const idx = geom.index;

  const newPos = [];
  const newNorm = [];
  const newUv = [];
  const newIdx = [];
  const remap = new Map();

  const addVert = (vi) => {
    if (remap.has(vi)) return remap.get(vi);
    const ni = newPos.length / 3;
    newPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
    if (norm) newNorm.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
    if (uv) newUv.push(uv.getX(vi), uv.getY(vi));
    remap.set(vi, ni);
    return ni;
  };

  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const cx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3;
    const cy = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3;
    const cz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3;
    if (!testFace(cx, cy, cz, ia, ib, ic)) continue;
    newIdx.push(addVert(ia), addVert(ib), addVert(ic));
  }

  if (newIdx.length === 0) return null;

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  if (newNorm.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  if (newUv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
  out.setIndex(newIdx);
  out.computeVertexNormals();
  return new THREE.Mesh(out, cloneMaterial(mesh.material));
}

function buildMechaRig(sourceMesh) {
  const box = new THREE.Box3().setFromBufferAttribute(sourceMesh.geometry.attributes.position);
  const size = box.getSize(new THREE.Vector3());
  const legMaxY = box.min.y + size.y * LEG_HEIGHT_RATIO;
  const pos = sourceMesh.geometry.attributes.position;

  const bodyMesh = extractSubmesh(
    sourceMesh,
    (cx, cy, cz, ia, ib, ic) => cy >= legMaxY,
  );
  const legLMesh = extractSubmesh(
    sourceMesh,
    (cx, cy, _cz, ia, ib, ic) => cy < legMaxY && classifyLegSide(pos, ia, ib, ic) === 'L',
  );
  const legRMesh = extractSubmesh(
    sourceMesh,
    (cx, cy, _cz, ia, ib, ic) => cy < legMaxY && classifyLegSide(pos, ia, ib, ic) === 'R',
  );

  const rig = new THREE.Group();
  rig.name = 'mechaRig';
  rig.userData.legPivotY = legMaxY;

  const torso = new THREE.Group();
  torso.name = 'torso';
  if (bodyMesh) torso.add(bodyMesh);

  const legL = new THREE.Group();
  legL.name = 'legL';
  if (legLMesh) legL.add(legLMesh);

  const legR = new THREE.Group();
  legR.name = 'legR';
  if (legRMesh) legR.add(legRMesh);

  rig.add(torso, legL, legR);
  return rig;
}

function fitRigToHeight(rig, targetHeight) {
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / size.y;
  rig.scale.setScalar(scale);

  box.setFromObject(rig);
  rig.position.y = -box.min.y;
}

function lerpAngle(current, target, t) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

async function buildMecha01Template() {
  const mtlLoader = new MTLLoader();
  mtlLoader.setResourcePath(`${MECHA01_BASE}/`);
  const materials = await mtlLoader.loadAsync(`${MECHA01_BASE}/Mecha01.mtl`);
  materials.preload();

  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  const loaded = await objLoader.loadAsync(`${MECHA01_BASE}/Mecha01.obj`);

  const textureLoader = new THREE.TextureLoader();
  let palette = null;
  try {
    palette = await textureLoader.loadAsync(`${MECHA01_BASE}/Mecha01.png`);
    palette.colorSpace = THREE.SRGBColorSpace;
    palette.magFilter = THREE.NearestFilter;
    palette.minFilter = THREE.NearestFilter;
  } catch {
    palette = null;
  }

  let mesh = null;
  loaded.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh) throw new Error('Mecha01: aucun mesh');

  if (palette) {
    mesh.material = new THREE.MeshStandardMaterial({
      map: palette,
      roughness: 0.85,
      metalness: 0.1,
    });
  } else {
    prepareEnemyMeshes(loaded);
  }

  const rig = buildMechaRig(mesh);
  fitRigToHeight(rig, TARGET_HEIGHT);

  const root = new THREE.Group();
  root.add(rig);
  root.userData.type = 'mecha01';
  return root;
}

export async function loadMecha01() {
  if (!mechaTemplate) {
    mechaTemplate = await buildMecha01Template();
  }
  return mechaTemplate.clone(true);
}

function cacheAnimRefs(enemy) {
  const rig = enemy.getObjectByName('mechaRig');
  enemy.userData.torso = enemy.getObjectByName('torso');
  enemy.userData.legL = enemy.getObjectByName('legL');
  enemy.userData.legR = enemy.getObjectByName('legR');
  enemy.userData.legPivotY = rig?.userData.legPivotY ?? 0;
}

function pickPatrolTarget(enemy) {
  const ai = enemy.userData.ai;
  const angle = Math.random() * Math.PI * 2;
  const dist = 2 + Math.random() * (ai.patrolRadius - 2);
  ai.targetX = ai.homeX + Math.cos(angle) * dist;
  ai.targetZ = ai.homeZ + Math.sin(angle) * dist;
}

function initEnemyAI(enemy) {
  enemy.userData.ai = {
    homeX: enemy.position.x,
    homeZ: enemy.position.z,
    targetX: enemy.position.x,
    targetZ: enemy.position.z,
    waitTimer: WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN),
    speed: ENEMY_SPEED,
    patrolRadius: PATROL_RADIUS,
    isMoving: false,
    velX: 0,
    velZ: 0,
  };
  pickPatrolTarget(enemy);
}

export function initEnemy(enemy, x, z, rot, groundMesh) {
  enemy.position.set(x, 0, z);
  enemy.rotation.y = rot + MODEL_YAW_OFFSET;
  snapObjectBaseToSurface(enemy, [groundMesh]);

  cacheAnimRefs(enemy);
  enemy.userData.walkPhase = 0;
  enemy.userData.idleTime = 0;
  enemy.userData.moveWeight = 0;

  initEnemyAI(enemy);
}

/** @deprecated utiliser initEnemy */
export function placeEnemyOnGround(enemy, x, z, rot, groundMesh) {
  initEnemy(enemy, x, z, rot, groundMesh);
}

function resetLegPose(leg, dt) {
  if (!leg) return;
  leg.position.x = THREE.MathUtils.lerp(leg.position.x, 0, dt * 10);
  leg.position.y = THREE.MathUtils.lerp(leg.position.y, 0, dt * 10);
  leg.rotation.set(0, 0, 0);
}

function updateEnemyAnimation(enemy, dt, moveWeight, speedRatio) {
  const { torso, legL, legR } = enemy.userData;

  enemy.userData.moveWeight = THREE.MathUtils.lerp(
    enemy.userData.moveWeight,
    moveWeight,
    dt * (moveWeight > 0.5 ? 8 : 10),
  );
  const w = enemy.userData.moveWeight;

  if (w > 0.05 && legL && legR) {
    enemy.userData.walkPhase += dt * 10 * speedRatio;
    const sin = Math.sin(enemy.userData.walkPhase);
    const cos = Math.cos(enemy.userData.walkPhase);

    // Avance/recule le long de +X local (direction du modèle) — pas de rotation
    const stride = STRIDE * w;
    const lift = LEG_LIFT * w;

    legL.position.x = sin * stride;
    legL.position.y = Math.max(0, sin) * lift;
    legR.position.x = -sin * stride;
    legR.position.y = Math.max(0, -sin) * lift;

    if (torso) {
      torso.position.y = Math.abs(cos) * 0.025 * w;
      torso.position.x = -sin * stride * 0.15 * w;
    }
  } else {
    enemy.userData.idleTime += dt;
    resetLegPose(legL, dt);
    resetLegPose(legR, dt);
    if (torso) {
      torso.position.y = Math.sin(enemy.userData.idleTime * 1.5) * 0.008;
      torso.position.x = THREE.MathUtils.lerp(torso.position.x, 0, dt * 8);
    }
  }
}

export function updateEnemy(enemy, dt, terrainRoots, mapHalf, collisionWorld) {
  if (!enemy?.userData.ai) return;

  const ai = enemy.userData.ai;
  const dx = ai.targetX - enemy.position.x;
  const dz = ai.targetZ - enemy.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  let moveDx = 0;
  let moveDz = 0;

  if (dist < ARRIVE_DIST) {
    ai.waitTimer -= dt;
    ai.isMoving = false;
    if (ai.waitTimer <= 0) {
      pickPatrolTarget(enemy);
      ai.waitTimer = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
    }
  } else {
    const dirX = dx / dist;
    const dirZ = dz / dist;
    ai.velX += (dirX * ai.speed - ai.velX) * Math.min(1, MOVE_ACCEL * dt);
    ai.velZ += (dirZ * ai.speed - ai.velZ) * Math.min(1, MOVE_ACCEL * dt);
    ai.isMoving = true;
  }

  if (!ai.isMoving) {
    ai.velX *= Math.max(0, 1 - MOVE_ACCEL * dt);
    ai.velZ *= Math.max(0, 1 - MOVE_ACCEL * dt);
  }

  const speed = Math.sqrt(ai.velX * ai.velX + ai.velZ * ai.velZ);
  if (speed > 0.08) {
    const moveAngle = Math.atan2(ai.velX, ai.velZ) + MODEL_YAW_OFFSET;
    enemy.rotation.y = lerpAngle(enemy.rotation.y, moveAngle, Math.min(1, TURN_SPEED * dt));

    let turnDiff = moveAngle - enemy.rotation.y;
    while (turnDiff > Math.PI) turnDiff -= Math.PI * 2;
    while (turnDiff < -Math.PI) turnDiff += Math.PI * 2;
    const moveFactor = THREE.MathUtils.clamp(1 - Math.abs(turnDiff) / 1.2, 0.15, 1);

    moveDx = ai.velX * dt * moveFactor;
    moveDz = ai.velZ * dt * moveFactor;
  }

  if (collisionWorld && (moveDx !== 0 || moveDz !== 0)) {
    const resolved = collisionWorld.resolve(
      enemy.position.x,
      enemy.position.z,
      moveDx,
      moveDz,
      ENEMY_COLLISION_RADIUS,
      mapHalf,
      enemy.position.y,
      enemy,
    );
    enemy.position.x = resolved.x;
    enemy.position.z = resolved.z;
  } else if (moveDx !== 0 || moveDz !== 0) {
    enemy.position.x = THREE.MathUtils.clamp(enemy.position.x + moveDx, -mapHalf, mapHalf);
    enemy.position.z = THREE.MathUtils.clamp(enemy.position.z + moveDz, -mapHalf, mapHalf);
  }

  const groundY = sampleTerrainHeightAtFeet(
    enemy.position.x,
    enemy.position.y,
    enemy.position.z,
    terrainRoots,
  );
  enemy.position.y = groundY;

  const speedRatio = THREE.MathUtils.clamp(speed / ai.speed, 0, 1.2);
  updateEnemyAnimation(enemy, dt, ai.isMoving ? 1 : 0, speedRatio);
}
