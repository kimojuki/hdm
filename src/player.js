import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadWithTimeout } from './loadUtils.js';
import { equipAk47 } from './weapons.js';

const TARGET_HEIGHT = 1.8;

const BONE_NAMES = [
  'spine', 'spine001', 'spine002',
  'shoulderL', 'shoulderR',
  'upper_armL', 'upper_armR',
  'forearmL', 'forearmR',
  'thighL', 'thighR',
  'shinL', 'shinR',
  'footL', 'footR',
];

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

function collectBones(skinnedMesh) {
  const bones = {};
  const wanted = new Set(BONE_NAMES);
  for (const bone of skinnedMesh.skeleton.bones) {
    if (wanted.has(bone.name)) bones[bone.name] = bone;
  }
  return bones;
}

function saveBindPose(bones) {
  const pose = {};
  for (const [name, bone] of Object.entries(bones)) {
    pose[name] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
  }
  return pose;
}

function resetPose(bones, basePose) {
  for (const [name, bone] of Object.entries(bones)) {
    const b = basePose[name];
    if (b) bone.rotation.set(b.x, b.y, b.z);
  }
}

function refreshSkeleton(skinnedMesh) {
  let root = skinnedMesh.skeleton.bones[0];
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  skinnedMesh.skeleton.update();
}

function getIdleOffsets(time) {
  const breath = Math.sin(time * 1.8) * 0.02;
  return {
    thighL: { x: 0.1, z: 0.15 },
    thighR: { x: 0.1, z: -0.15 },
    shinL: { x: 0.22 },
    shinR: { x: 0.22 },
    upper_armL: { x: -0.5, z: 0.22 },
    upper_armR: { x: -0.5, z: -0.22 },
    forearmL: { x: 0.75 },
    forearmR: { x: 0.75 },
    shoulderL: { z: 0.06 },
    shoulderR: { z: -0.06 },
    spine: { x: 0.08 + breath },
    spine001: { x: 0.05 + breath * 0.5 },
    spine002: { x: 0.02 },
  };
}

function getWalkOffsets(phase) {
  const sin = Math.sin(phase);
  const absSin = Math.abs(sin);
  const kneeL = Math.max(0, -sin);
  const kneeR = Math.max(0, sin);

  return {
    thighL: { x: sin * 0.85 },
    thighR: { x: -sin * 0.85 },
    shinL: { x: 0.12 + kneeL * 1.05 },
    shinR: { x: 0.12 + kneeR * 1.05 },
    footL: { x: -kneeL * 0.45 },
    footR: { x: -kneeR * 0.45 },
    upper_armL: { x: -sin * 0.15 },
    upper_armR: { x: sin * 0.15 },
    forearmL: { x: 0.3 + absSin * 0.25 },
    forearmR: { x: 0.3 + absSin * 0.25 },
    shoulderL: { x: -sin * 0.55 },
    shoulderR: { x: sin * 0.55 },
    spine: { x: 0.05 + absSin * 0.05 },
    spine001: { y: sin * 0.04 },
    spine002: { y: -sin * 0.03 },
  };
}

function applyOffsets(bones, basePose, offsets) {
  resetPose(bones, basePose);
  for (const [name, axes] of Object.entries(offsets)) {
    const bone = bones[name];
    const base = basePose[name];
    if (!bone || !base) continue;
    if (axes.x) bone.rotation.x += axes.x;
    if (axes.y) bone.rotation.y += axes.y;
    if (axes.z) bone.rotation.z += axes.z;
  }
}

function blendOffsets(idle, walk, walkWeight) {
  const names = new Set([...Object.keys(idle), ...Object.keys(walk)]);
  const out = {};
  for (const name of names) {
    out[name] = {};
    for (const axis of ['x', 'y', 'z']) {
      const a = idle[name]?.[axis] ?? 0;
      const b = walk[name]?.[axis] ?? 0;
      const v = a * (1 - walkWeight) + b * walkWeight;
      if (Math.abs(v) > 0.0001) out[name][axis] = v;
    }
  }
  return out;
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
  const bones = skinnedMesh ? collectBones(skinnedMesh) : null;
  const basePose = bones ? saveBindPose(bones) : null;

  if (bones && basePose) {
    applyOffsets(bones, basePose, getIdleOffsets(0));
    refreshSkeleton(skinnedMesh);
  }

  player.userData.skinnedMesh = skinnedMesh;
  player.userData.bones = bones;
  player.userData.basePose = basePose;
  player.userData.walkPhase = 0;
  player.userData.walkWeight = 0;
  player.userData.idleTime = 0;

  await equipAk47(player, modelPivot);

  return player;
}

export function updatePlayerAnimation(player, dt, isMoving, speedRatio = 1) {
  const { bones, basePose, skinnedMesh } = player.userData;
  if (!bones || !basePose || !skinnedMesh) return;

  const target = isMoving ? 1 : 0;
  player.userData.walkWeight = THREE.MathUtils.lerp(
    player.userData.walkWeight,
    target,
    dt * (isMoving ? 7 : 9),
  );

  if (isMoving) {
    player.userData.walkPhase += dt * 11 * speedRatio;
  } else {
    player.userData.idleTime += dt;
  }

  const w = player.userData.walkWeight;
  const idle = getIdleOffsets(player.userData.idleTime);
  const walk = getWalkOffsets(player.userData.walkPhase);
  const offsets = blendOffsets(idle, walk, w);

  applyOffsets(bones, basePose, offsets);
  refreshSkeleton(skinnedMesh);
}
