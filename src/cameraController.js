import * as THREE from 'three';

const TWO_PI = Math.PI * 2;

/**
 * État caméra TPS (yaw / pitch / distance / zoom visée) — aucun accès DOM.
 *
 * Convention pitch : radians, > 0 = regarder vers le haut, < 0 = vers le bas.
 * Les entrées écrivent `targetYaw` / `targetPitch` ; `update()` lisse ensuite
 * `yaw` / `pitch` vers la cible (inertie légère, aucun jitter). Le rig caméra
 * (`ThirdPersonCamera`) lit UNIQUEMENT les valeurs lissées : position et
 * orientation sont donc toujours calculées depuis la même source → rig rigide,
 * personnage verrouillé à l'écran même pendant les rotations rapides.
 */
export class CameraController {
  constructor({
    distance = 5.2,
    minDistance = 3,
    maxDistance = 8,
    minPitch = THREE.MathUtils.degToRad(-45),
    maxPitch = THREE.MathUtils.degToRad(35),
    initialYaw = 0,
    initialPitch = THREE.MathUtils.degToRad(-12),
    touchSensitivity = 0.0042,
    mouseSensitivity = 0.0028,
    /** Vitesse de convergence rotation (1/s) — grand = réactif, petit = mou. */
    rotationLambda = 22,
    /** Vitesse de convergence distance (1/s). */
    distanceLambda = 9,
    /** Vitesse de convergence zoom visée (1/s). */
    aimZoomLambda = 9,
  } = {}) {
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.targetYaw = initialYaw;
    this.targetPitch = THREE.MathUtils.clamp(initialPitch, minPitch, maxPitch);
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.rotationLambda = rotationLambda;

    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    /** Distance choisie par l'utilisateur (molette / pincement). */
    this.baseTargetDistance = THREE.MathUtils.clamp(distance, minDistance, maxDistance);
    /** Distance cible après application du zoom visée. */
    this.targetDistance = this.baseTargetDistance;
    /** Distance lissée effectivement utilisée par le rig. */
    this.distance = this.baseTargetDistance;
    this.distanceLambda = distanceLambda;

    this.touchSensitivity = touchSensitivity;
    this.mouseSensitivity = mouseSensitivity;

    /** Zoom visée : multiplicateur de distance lissé (1 = pas de zoom). */
    this.aimZoomFactor = 1;
    this.aimZoomTargetFactor = 1;
    this.aimZoomLambda = aimZoomLambda;
  }

  getYaw() {
    return this.yaw;
  }

  applyDrag(dx, dy, isTouch = false) {
    const s = isTouch ? this.touchSensitivity : this.mouseSensitivity;
    this.targetYaw -= dx * s;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch - dy * s,
      this.minPitch,
      this.maxPitch,
    );
  }

  addZoomDelta(delta) {
    this.baseTargetDistance = THREE.MathUtils.clamp(
      this.baseTargetDistance + delta,
      this.minDistance,
      this.maxDistance,
    );
  }

  setPinchDistance(dist) {
    this.baseTargetDistance = THREE.MathUtils.clamp(dist, this.minDistance, this.maxDistance);
  }

  /**
   * Active/désactive le zoom visée.
   * @param {boolean} active
   * @param {number} zoomFactor multiplicateur de distance (ex: 0.85 => -15 %)
   */
  setAimZoomActive(active, zoomFactor = 0.85) {
    this.aimZoomTargetFactor = active ? zoomFactor : 1;
  }

  /** Aligne instantanément l'état lissé sur la cible (téléport / changement de map). */
  snap() {
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.aimZoomFactor = this.aimZoomTargetFactor;
    this.targetDistance = THREE.MathUtils.clamp(
      this.baseTargetDistance * this.aimZoomFactor,
      this.minDistance,
      this.maxDistance,
    );
    this.distance = this.targetDistance;
  }

  update(dt) {
    // Rotation : convergence exponentielle vers la cible, wrap-aware sur le yaw
    // (le chemin le plus court est toujours pris, jamais de tour complet).
    const tRot = 1 - Math.exp(-dt * this.rotationLambda);
    const dYaw = Math.atan2(
      Math.sin(this.targetYaw - this.yaw),
      Math.cos(this.targetYaw - this.yaw),
    );
    this.yaw += dYaw * tRot;
    this.pitch += (this.targetPitch - this.pitch) * tRot;

    // Évite la dérive numérique du yaw sur les longues sessions.
    if (Math.abs(this.yaw) > TWO_PI * 2) {
      const wrap = Math.round(this.yaw / TWO_PI) * TWO_PI;
      this.yaw -= wrap;
      this.targetYaw -= wrap;
    }

    // Zoom visée lissé (aller ET retour progressifs).
    this.aimZoomFactor += (this.aimZoomTargetFactor - this.aimZoomFactor)
      * (1 - Math.exp(-dt * this.aimZoomLambda));

    this.targetDistance = THREE.MathUtils.clamp(
      this.baseTargetDistance * this.aimZoomFactor,
      this.minDistance,
      this.maxDistance,
    );

    this.distance += (this.targetDistance - this.distance)
      * (1 - Math.exp(-dt * this.distanceLambda));
  }
}

// Les bindings DOM (drag / pinch / molette) vivent dans `src/inputController.js`.
