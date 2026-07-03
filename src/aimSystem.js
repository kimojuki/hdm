import * as THREE from 'three';

const _ndcCenter = new THREE.Vector2(0, 0);
const _ray = new THREE.Raycaster();
const _farPoint = new THREE.Vector3();

/**
 * Visée TPS — raycast depuis le centre écran (réticule).
 */
export class AimSystem {
  constructor({ maxDistance = 220 } = {}) {
    this.maxDistance = maxDistance;
    this.aimPoint = new THREE.Vector3();
    this.lastHit = false;
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D[]} targets — meshes du monde (hors joueur / projectiles)
   * @param {THREE.Object3D|null} excludeRoot — racine à ignorer (joueur)
   */
  update(camera, targets, excludeRoot = null) {
    _ray.setFromCamera(_ndcCenter, camera);
    _ray.far = this.maxDistance;

    const hits = targets?.length
      ? _ray.intersectObjects(targets, true)
      : [];

    for (const hit of hits) {
      if (excludeRoot && isDescendantOf(hit.object, excludeRoot)) continue;
      this.aimPoint.copy(hit.point);
      this.lastHit = true;
      return this.aimPoint;
    }

    _ray.ray.at(this.maxDistance, _farPoint);
    this.aimPoint.copy(_farPoint);
    this.lastHit = false;
    return this.aimPoint;
  }

  /** Direction normalisée canon → point visé. */
  getShotDirection(muzzleWorld, out = _farPoint) {
    return out.subVectors(this.aimPoint, muzzleWorld).normalize();
  }
}

function isDescendantOf(object, ancestor) {
  let node = object;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
}
