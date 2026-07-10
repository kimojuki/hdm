import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HELD_ITEM_DEFS } from './heldItemConfig.js';

const AK47_PATH = '/guns/01/Normal%20version%20Color%20and%20NormalMap/GLB/ak47.glb';

const gltfLoader = new GLTFLoader();
const _handLWorld = new THREE.Vector3();
const _handLLocal = new THREE.Vector3();
const _barrelDir = new THREE.Vector3();
const _anchorPos = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _yAxis = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _worldDown = new THREE.Vector3(0, -1, 0);
const _downProj = new THREE.Vector3();
const _magLocal = new THREE.Vector3();
const _magDir = new THREE.Vector3();
const _rollCross = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();
const _barrelAxis = new THREE.Vector3(1, 0, 0);

function prepareWeaponMeshes(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.roughness = mat.roughness ?? 0.55;
      mat.metalness = mat.metalness ?? 0.35;
    }
  });
}

/** Crosse à x=0, canon vers +X. */
function normalizeWeaponMesh(weapon, targetLength) {
  const box = new THREE.Box3().setFromObject(weapon);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z);
  const baseScale = targetLength / length;
  weapon.scale.setScalar(baseScale);

  box.setFromObject(weapon);
  const min = box.min;
  const scaled = box.getSize(new THREE.Vector3());

  if (scaled.x >= scaled.y && scaled.x >= scaled.z) {
    weapon.position.x -= min.x;
  } else if (scaled.y >= scaled.z) {
    weapon.rotation.z = Math.PI / 2;
    box.setFromObject(weapon);
    weapon.position.y -= box.min.y;
  } else {
    weapon.rotation.y = Math.PI / 2;
    box.setFromObject(weapon);
    weapon.position.z -= box.min.z;
  }

  box.setFromObject(weapon);
  weapon.userData.barrelLength = box.max.x - box.min.x;
  weapon.userData.baseScale = baseScale;
  weapon.userData.heldItemId = 'ak47';
  weapon.updateMatrix();
}

function ensureGripAnchor(handBone, itemId) {
  const name = `grip-${itemId}`;
  let anchor = handBone.getObjectByName(name);
  if (!anchor) {
    anchor = new THREE.Object3D();
    anchor.name = name;
    handBone.add(anchor);
  }
  return anchor;
}

function migrateHeldItemAnchors(player) {
  const handBone = player.userData.handBone;
  const items = player.userData.heldItems;
  if (!handBone || !items) return;

  if (!player.userData.heldItemAnchors) player.userData.heldItemAnchors = {};

  for (const [id, mesh] of Object.entries(items)) {
    let anchor = player.userData.heldItemAnchors[id];
    if (!anchor) {
      anchor = ensureGripAnchor(handBone, id);
      player.userData.heldItemAnchors[id] = anchor;
    }
    if (mesh.parent !== anchor) anchor.add(mesh);
  }
}

/** Tourne l'arme autour du canon pour que le chargeur pointe vers le bas. */
function applyMagazineDownRoll(anchor, barrelDir, itemDef) {
  const mag = itemDef.magazineLocalDir ?? { x: 0, y: -1, z: 0 };
  _magLocal.set(mag.x, mag.y, mag.z);

  _downProj.copy(_worldDown).addScaledVector(barrelDir, -_worldDown.dot(barrelDir));
  if (_downProj.lengthSq() < 1e-8) return;
  _downProj.normalize();

  _magDir.copy(_magLocal).applyQuaternion(anchor.quaternion);
  _magDir.addScaledVector(barrelDir, -_magDir.dot(barrelDir));
  if (_magDir.lengthSq() < 1e-8) return;
  _magDir.normalize();

  _rollCross.crossVectors(_magDir, _downProj);
  const sin = barrelDir.dot(_rollCross);
  const cos = _magDir.dot(_downProj);
  let angle = Math.atan2(sin, cos);

  if (itemDef.barrelRollOffsetDeg) {
    angle += THREE.MathUtils.degToRad(itemDef.barrelRollOffsetDeg);
  }

  _rollQuat.setFromAxisAngle(_barrelAxis, angle);
  anchor.quaternion.multiply(_rollQuat);
}

/**
 * Aligne l'arme entre handR (poignée) et handL (garde-main) dans l'espace local de la main droite.
 */
export function applyTwoHandGrip(anchor, weapon, handR, handL, itemDef) {
  if (!anchor || !weapon || !handR || !handL || !itemDef) return;

  handR.updateMatrixWorld(true);
  handL.updateMatrixWorld(true);

  handL.getWorldPosition(_handLWorld);
  handR.worldToLocal(_handLLocal.copy(_handLWorld));

  const span = _handLLocal.length();
  if (span < 0.03) return;

  _barrelDir.copy(_handLLocal).normalize();

  const barrelLength = weapon.userData.barrelLength || itemDef.meshLength;
  const gripRatio = itemDef.gripRatio ?? 0.15;
  const forestockRatio = itemDef.forestockRatio ?? 0.82;
  const gripAlong = barrelLength * gripRatio;
  const forestockAlong = barrelLength * forestockRatio;
  const gripSpan = Math.max(forestockAlong - gripAlong, 0.05);
  const scaleFactor = span / gripSpan;

  _yAxis.set(0, 1, 0);
  _zAxis.crossVectors(_barrelDir, _yAxis);
  if (_zAxis.lengthSq() < 1e-5) _zAxis.set(0, 0, 1);
  _zAxis.normalize();
  _yAxis.crossVectors(_zAxis, _barrelDir).normalize();
  _basis.makeBasis(_barrelDir, _yAxis, _zAxis);

  anchor.quaternion.setFromRotationMatrix(_basis);
  applyMagazineDownRoll(anchor, _barrelDir, itemDef);
  anchor.scale.setScalar(scaleFactor);

  _anchorPos.copy(_barrelDir).multiplyScalar(-gripAlong * scaleFactor);
  anchor.position.copy(_anchorPos);
  weapon.scale.setScalar(weapon.userData.baseScale || 1);
  anchor.updateMatrix();
  anchor.updateMatrixWorld(true);
}

export async function loadAk47() {
  const def = HELD_ITEM_DEFS.ak47;
  const gltf = await gltfLoader.loadAsync(AK47_PATH);
  const weapon = gltf.scene;
  weapon.name = 'ak47';
  weapon.visible = true;
  prepareWeaponMeshes(weapon);
  normalizeWeaponMesh(weapon, def.meshLength);
  return weapon;
}

export function attachHeldItem(player, mesh, handBone, itemId = 'ak47') {
  if (!player.userData.heldItems) player.userData.heldItems = {};
  if (!player.userData.heldItemAnchors) player.userData.heldItemAnchors = {};

  if (handBone) {
    const anchor = ensureGripAnchor(handBone, itemId);
    anchor.add(mesh);
    player.userData.heldItemAnchors[itemId] = anchor;
  } else {
    mesh.rotation.set(0, Math.PI / 2, 0);
    mesh.position.set(0.12, 1.1, 0.15);
    player.add(mesh);
    player.userData.heldItemAnchors[itemId] = mesh;
  }

  player.userData.heldItems[itemId] = mesh;
  player.userData.activeHeldItemId = itemId;

  if (itemId === 'ak47') {
    player.userData.weapon = mesh;
    ensureMuzzle(mesh);
  }

  updateHeldItemGrip(player, itemId);
}

export function updateHeldItemGrip(player, itemId) {
  if (!player) return;

  migrateHeldItemAnchors(player);

  const handR = player.userData.handBone;
  const handL = player.userData.supportHandBone;
  const activeId = itemId || player.userData.activeHeldItemId || 'ak47';
  const items = player.userData.heldItems || {};
  const anchors = player.userData.heldItemAnchors || {};

  for (const [id, mesh] of Object.entries(items)) {
    mesh.visible = id === activeId;
    const anchor = anchors[id];
    const def = HELD_ITEM_DEFS[id];
    if (anchor && handR && handL && def) {
      applyTwoHandGrip(anchor, mesh, handR, handL, def);
    }
  }
}

export function ensureMuzzle(weapon) {
  if (weapon.userData.muzzle) return weapon.userData.muzzle;

  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  const barrel = weapon.userData.barrelLength || HELD_ITEM_DEFS.ak47.meshLength;
  muzzle.position.set(barrel * 0.97, 0, 0);
  weapon.add(muzzle);
  weapon.userData.muzzle = muzzle;
  return muzzle;
}

export function getMuzzle(weapon) {
  return weapon?.userData?.muzzle ?? null;
}

export async function equipAk47(player, handR) {
  const weapon = await loadAk47();
  attachHeldItem(player, weapon, handR, 'ak47');
  return weapon;
}

/** @deprecated Utiliser updateHeldItemGrip */
export function updateWeaponGrip(weapon, handR, handL, player) {
  if (player) updateHeldItemGrip(player);
}
