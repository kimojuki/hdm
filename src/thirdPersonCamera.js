import * as THREE from 'three';
import { CameraController } from './cameraController.js';
import { CameraCollision } from './cameraCollision.js';

const _ideal = new THREE.Vector3();
const _resolved = new THREE.Vector3();
const _look = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _ndcCenter = new THREE.Vector2(0, 0);

/**
 * Caméra TPS over-the-shoulder — s'appuie sur CameraController (yaw/pitch/zoom).
 * Extensions futures : shoulderSide, adsZoom, shoulderSwap (non implémentées).
 */
export class ThirdPersonCamera {
  constructor(options = {}) {
    this.controller = new CameraController(options);
    this.collision = new CameraCollision(options.collision ?? {});

    /** Décalage horizontal épaule (m) — positif = épaule droite. */
    this.shoulderOffset = options.shoulderOffset ?? 0.42;
    /** 1 = épaule droite, -1 = gauche (changement d'épaule futur). */
    this.shoulderSide = options.shoulderSide ?? 1;

    this.smoothPosition = new THREE.Vector3();
    this.smoothLookAt = new THREE.Vector3();
    this._positionInitialized = false;

    this.positionSmoothing = options.positionSmoothing ?? 0.001;
    this.lookSmoothing = options.lookSmoothing ?? 0.001;
    this.lookAheadDistance = options.lookAheadDistance ?? 12;
  }

  getYaw() {
    return this.controller.getYaw();
  }

  getPitch() {
    return this.controller.pitch;
  }

  /** Direction horizontale de visée (normalisée XZ). */
  getFlatForward(out = _forward) {
    out.set(-Math.sin(this.controller.yaw), 0, -Math.cos(this.controller.yaw));
    return out;
  }

  /** Yaw cible pour orienter le personnage vers la caméra. */
  getCharacterYaw() {
    const f = this.getFlatForward();
    return Math.atan2(f.x, f.z);
  }

  applyDrag(dx, dy, isTouch = false) {
    this.controller.applyDrag(dx, dy, isTouch);
  }

  addZoomDelta(delta) {
    this.controller.addZoomDelta(delta);
  }

  setPinchDistance(dist) {
    this.controller.setPinchDistance(dist);
  }

  /** Point regardé par la caméra (centre écran / réticule). */
  getLookPoint(playerPos, out = _look) {
    const yaw = this.controller.yaw;
    const pitch = this.controller.pitch;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    _forward.set(
      -Math.sin(yaw) * cosP,
      sinP,
      -Math.cos(yaw) * cosP,
    );
    return out.set(
      playerPos.x + _forward.x * this.lookAheadDistance,
      playerPos.y + this.controller.lookHeight + _forward.y * this.lookAheadDistance,
      playerPos.z + _forward.z * this.lookAheadDistance,
    );
  }

  /** Position caméra idéale avec décalage over-the-shoulder. */
  getShoulderPosition(playerPos, out = _ideal) {
    const ctrl = this.controller;

    const cosP = Math.cos(ctrl.pitch);
    const sinP = Math.sin(ctrl.pitch);
    const hDist = ctrl.distance * cosP;
    const shoulder = this.shoulderOffset * this.shoulderSide;

    out.set(
      playerPos.x + Math.sin(ctrl.yaw) * hDist + Math.cos(ctrl.yaw) * shoulder,
      playerPos.y + ctrl.lookHeight + ctrl.distance * sinP,
      playerPos.z + Math.cos(ctrl.yaw) * hDist - Math.sin(ctrl.yaw) * shoulder,
    );
    return out;
  }

  getPivot(playerPos, out = _look) {
    return out.set(playerPos.x, playerPos.y + this.controller.lookHeight, playerPos.z);
  }

  /**
   * Met à jour la caméra Three.js (position lissée + regard lissé).
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Vector3} playerPos
   * @param {number} dt
   * @param {THREE.Object3D[]} [collisionTargets]
   */
  applyToCamera(camera, playerPos, dt, collisionTargets = null) {
    this.controller.update(dt);

    const pivot = this.getPivot(playerPos, _look);
    this.getShoulderPosition(playerPos, _ideal);
    this.collision.resolve(pivot, _ideal, collisionTargets, _resolved);

    const lookTarget = this.getLookPoint(playerPos, _look);

    if (!this._positionInitialized) {
      this.smoothPosition.copy(_resolved);
      this.smoothLookAt.copy(lookTarget);
      this._positionInitialized = true;
    }

    const posT = 1 - Math.pow(this.positionSmoothing, dt);
    const lookT = 1 - Math.pow(this.lookSmoothing, dt);
    this.smoothPosition.lerp(_resolved, posT);
    this.smoothLookAt.lerp(lookTarget, lookT);

    camera.position.copy(this.smoothPosition);
    camera.lookAt(this.smoothLookAt);
  }

  /** Raycast depuis le centre écran (NDC 0,0). */
  setCenterScreenRay(raycaster, camera) {
    raycaster.setFromCamera(_ndcCenter, camera);
  }
}
