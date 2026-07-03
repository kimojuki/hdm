import * as THREE from 'three';
import { CameraController } from './cameraController.js';
import { CameraCollision } from './cameraCollision.js';

const _ideal = new THREE.Vector3();
const _resolved = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _orbitDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _ndcCenter = new THREE.Vector2(0, 0);

/**
 * Caméra TPS over-the-shoulder — rig orbitale rigidement attachée au joueur.
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

    /** Lissage uniquement pour le retrait collision (évite les saccades). */
    this.collisionSmoothing = options.collisionSmoothing ?? 0.0008;
    this._collisionDistance = null;

    this.lookAheadDistance = options.lookAheadDistance ?? 18;
    /** Hauteur du point visé (pieds joueur) — cadre le corps entier à l'écran. */
    this.lookTargetHeight = options.lookTargetHeight ?? options.lookHeight ?? 1.0;
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

  /** Direction de visée (axe avant caméra / réticule). */
  getViewForward(out = _forward) {
    const yaw = this.controller.yaw;
    const pitch = this.controller.pitch;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    return out.set(
      -Math.sin(yaw) * cosP,
      sinP,
      -Math.cos(yaw) * cosP,
    );
  }

  /** Vecteur droit horizontal (pour décalage épaule). */
  getViewRight(out = _forward) {
    const yaw = this.controller.yaw;
    return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  getPivot(playerPos, out = _pivot) {
    return out.set(playerPos.x, playerPos.y + this.controller.lookHeight, playerPos.z);
  }

  /**
   * Position caméra idéale : orbite derrière le pivot + décalage épaule.
   * Recalculée chaque frame depuis la position joueur → caméra toujours fixée.
   */
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

  /** Point regardé : horizontal devant le joueur, à hauteur torse (corps entier visible). */
  getLookTarget(playerPos, out = _lookTarget) {
    const forward = this.getViewForward(_forward);
    const hLen = Math.hypot(forward.x, forward.z);
    const scale = hLen > 1e-6 ? this.lookAheadDistance / hLen : this.lookAheadDistance;

    return out.set(
      playerPos.x + forward.x * scale,
      playerPos.y + this.lookTargetHeight,
      playerPos.z + forward.z * scale,
    );
  }

  /** Réinitialise le lissage collision (changement de map / téléport). */
  resetFollow() {
    this._collisionDistance = null;
  }

  /**
   * Met à jour la caméra Three.js — position et orientation liées au joueur sans décalage.
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Vector3} playerPos
   * @param {number} dt
   * @param {THREE.Object3D[]} [collisionTargets]
   */
  applyToCamera(camera, playerPos, dt, collisionTargets = null) {
    this.controller.update(dt);

    const pivot = this.getPivot(playerPos, _pivot);
    this.getShoulderPosition(playerPos, _ideal);
    this.collision.resolve(pivot, _ideal, collisionTargets, _resolved);

    const idealDist = pivot.distanceTo(_ideal);
    let useDist = pivot.distanceTo(_resolved);

    if (this._collisionDistance == null) {
      this._collisionDistance = useDist;
    } else if (useDist < idealDist - 0.02) {
      const t = 1 - Math.pow(this.collisionSmoothing, dt);
      this._collisionDistance += (useDist - this._collisionDistance) * t;
      useDist = this._collisionDistance;
    } else {
      this._collisionDistance = idealDist;
      useDist = idealDist;
    }

    if (Math.abs(useDist - idealDist) < 0.02) {
      camera.position.copy(_ideal);
    } else {
      _orbitDir.subVectors(_ideal, pivot);
      const orbitLen = _orbitDir.length();
      if (orbitLen > 1e-6) {
        _orbitDir.multiplyScalar(useDist / orbitLen);
        camera.position.copy(pivot).add(_orbitDir);
      } else {
        camera.position.copy(_ideal);
      }
    }

    this.getLookTarget(playerPos, _lookTarget);
    camera.lookAt(_lookTarget);
  }

  /** Raycast depuis le centre écran (NDC 0,0). */
  setCenterScreenRay(raycaster, camera) {
    raycaster.setFromCamera(_ndcCenter, camera);
  }
}
