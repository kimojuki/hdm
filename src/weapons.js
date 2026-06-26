import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const AK47_PATH = '/guns/01/Normal%20version%20Color%20and%20NormalMap/GLB/ak47.glb';
const TARGET_WEAPON_LENGTH = 0.82;

const gltfLoader = new GLTFLoader();

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

function fitWeaponLength(weapon, targetLength) {
  const box = new THREE.Box3().setFromObject(weapon);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z);
  weapon.scale.setScalar(targetLength / length);
}

export async function loadAk47() {
  const gltf = await gltfLoader.loadAsync(AK47_PATH);
  const weapon = gltf.scene;
  weapon.name = 'ak47';
  prepareWeaponMeshes(weapon);
  fitWeaponLength(weapon, TARGET_WEAPON_LENGTH);
  return weapon;
}

export function attachWeaponToPlayer(player, weapon, modelPivot) {
  weapon.rotation.set(0, Math.PI / 2, 0);
  weapon.position.set(0.12, 1.1, 0.15);
  modelPivot.add(weapon);
  player.userData.weapon = weapon;
}

export async function equipAk47(player, modelPivot) {
  const weapon = await loadAk47();
  attachWeaponToPlayer(player, weapon, modelPivot);
  return weapon;
}
