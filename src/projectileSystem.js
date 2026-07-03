import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

/**
 * Projectiles tirés depuis le canon réel vers le point visé.
 */
export class ProjectileSystem {
  constructor(scene, {
    poolSize = 24,
    speed = 95,
    maxLife = 2.4,
    radius = 0.06,
  } = {}) {
    this.scene = scene;
    this.speed = speed;
    this.maxLife = maxLife;
    this.pool = [];
    this.active = [];

    const geometry = new THREE.SphereGeometry(radius, 6, 6);
    const material = new THREE.MeshBasicMaterial({ color: 0xffdd66 });

    for (let i = 0; i < poolSize; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, velocity: new THREE.Vector3() });
    }
  }

  fire(muzzleObject, aimPoint) {
    if (!muzzleObject) return false;

    muzzleObject.getWorldPosition(_muzzle);
    _dir.subVectors(aimPoint, _muzzle);
    if (_dir.lengthSq() < 1e-6) return false;
    _dir.normalize();

    const slot = this.pool.pop();
    if (!slot) return false;

    slot.mesh.position.copy(_muzzle);
    slot.velocity.copy(_dir).multiplyScalar(this.speed);
    slot.life = this.maxLife;
    slot.mesh.visible = true;
    this.active.push(slot);
    return true;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.mesh.position.addScaledVector(p.velocity, dt);
    }
  }
}
