import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();

/**
 * Raccourcit la position caméra si un obstacle se trouve entre le joueur et la caméra.
 * Prévu pour extension (layers, smooth pull-in).
 */
export class CameraCollision {
  constructor({ probePadding = 0.35, minDistance = 1.2 } = {}) {
    this.probePadding = probePadding;
    this.minDistance = minDistance;
  }

  /**
   * @param {THREE.Vector3} pivot — point de rotation (torse)
   * @param {THREE.Vector3} idealPos — position caméra souhaitée
   * @param {THREE.Object3D[]} targets — meshes à tester
   * @param {THREE.Vector3} out
   */
  resolve(pivot, idealPos, targets, out) {
    out.copy(idealPos);

    if (!targets?.length) return out;

    _dir.subVectors(idealPos, pivot);
    const dist = _dir.length();
    if (dist < 1e-4) return out;

    _dir.divideScalar(dist);
    _ray.set(pivot, _dir);
    _ray.far = dist;
    _ray.near = this.minDistance;

    const hits = _ray.intersectObjects(targets, true);
    if (hits.length === 0) return out;

    const hitDist = Math.max(this.minDistance, hits[0].distance - this.probePadding);
    out.copy(pivot).addScaledVector(_dir, hitDist);
    return out;
  }
}
