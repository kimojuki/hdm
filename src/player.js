import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadWithTimeout } from './loadUtils.js';
import { equipAk47, updateHeldItemGrip } from './weapons.js';
import { createPlayerAnimationController } from './playerAnimations.js';

const TARGET_HEIGHT = 1.8;

function prepareMeshes(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    if (Array.isArray(child.material)) {
      child.material = child.material.map((mat) => mat.clone());
    } else if (child.material) {
      child.material = child.material.clone();
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.roughness = mat.roughness ?? 0.7;
      mat.metalness = mat.metalness ?? 0.2;
    }
  });
}

function fitToGround(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = TARGET_HEIGHT / size.y;
  object.scale.setScalar(scale);

  box.setFromObject(object);
  object.position.y = -box.min.y;
}

function findSkinnedMesh(root) {
  let mesh = null;
  root.traverse((child) => {
    if (child.isSkinnedMesh && child.skeleton) mesh = child;
  });
  return mesh;
}

function findBone(skinnedMesh, name) {
  return skinnedMesh?.skeleton?.bones?.find((bone) => bone.name === name) ?? null;
}

export async function loadPlayer() {
  const loader = new FBXLoader();
  const fbx = await loadWithTimeout(
    loader.loadAsync('/personnage.fbx'),
    90000,
    'personnage.fbx',
  );

  prepareMeshes(fbx);

  const player = new THREE.Group();
  const modelPivot = new THREE.Group();
  modelPivot.add(fbx);
  player.add(modelPivot);
  fitToGround(modelPivot);

  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.01;
  player.add(shadowDisc);

  const skinnedMesh = findSkinnedMesh(fbx);
  const handBone = findBone(skinnedMesh, 'handR');
  const supportHandBone = findBone(skinnedMesh, 'handL');

  player.userData.skinnedMesh = skinnedMesh;
  player.userData.handBone = handBone;
  player.userData.supportHandBone = supportHandBone;
  player.userData.modelRoot = fbx;
  player.userData.animController = await createPlayerAnimationController(fbx);

  await equipAk47(player, handBone);

  return player;
}

export function updatePlayerAnimation(player, dt, {
  moveInput = { x: 0, y: 0 },
  isMoving = false,
  onGround = true,
  isAiming = false,
} = {}) {
  player.userData.animController?.update(dt, {
    moveInput, isMoving, onGround, isAiming,
  });
  updateHeldItemGrip(player);
}

export function triggerPlayerFire(player) {
  return player.userData.animController?.triggerFire() ?? false;
}
