import * as THREE from 'three';
import { CameraController } from './cameraController.js';
import { CameraCollision } from './cameraCollision.js';

const _pivot = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upCam = new THREE.Vector3();
const _shoulderAnchor = new THREE.Vector3();
const _ideal = new THREE.Vector3();
const _resolved = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _ndcCenter = new THREE.Vector2(0, 0);

/**
 * Caméra TPS over-the-shoulder — rig RIGIDE ancré sur le personnage.
 *
 * Principes (style Helldivers 2 / TPS moderne) :
 * - Pivot au niveau des épaules ; XZ rigide, Y légèrement lissé (marches).
 * - Position ET orientation calculées depuis les MÊMES yaw/pitch lissés
 *   (`CameraController`) → le personnage reste verrouillé à l'écran, même
 *   pendant les rotations rapides (aucun "balayage" du personnage).
 * - Orientation exacte depuis yaw/pitch (pas de lookAt indirect) → le réticule
 *   au centre de l'écran EST la direction de visée, pitch direct et précis.
 * - Cadrage écran garanti : le pivot est projeté à (screenAnchorX,
 *   screenAnchorY) — ex. 30 % depuis la gauche, 60 % depuis le bas — quel que
 *   soit le FOV / l'aspect. Le côté droit reste dégagé.
 * - Collision : raccourcit uniquement la distance de recul (jamais le
 *   décalage latéral) ; rentrée rapide (anti-clip), sortie progressive.
 */
export class ThirdPersonCamera {
  constructor(options = {}) {
    this.controller = new CameraController(options);
    this.collision = new CameraCollision(options.collision ?? {});

    /** Hauteur du pivot épaules au-dessus des pieds (m). */
    this.pivotHeight = options.pivotHeight ?? options.lookHeight ?? 1.4;

    /** Position écran du pivot : fraction depuis la gauche / depuis le bas. */
    this.screenAnchorX = options.screenAnchorX ?? 0.30;
    this.screenAnchorY = options.screenAnchorY ?? 0.60;
    /** Garde-fou sur écrans très larges (offset latéral en mètres). */
    this.maxLateralOffset = options.maxLateralOffset ?? 1.4;

    /** Lissage vertical du pivot (1/s) — absorbe marches et bosses. */
    this.pivotYLambda = options.pivotYLambda ?? 14;
    /** Collision : rentrée rapide (anti-clip) / sortie douce (1/s). */
    this.collisionInLambda = options.collisionInLambda ?? 30;
    this.collisionOutLambda = options.collisionOutLambda ?? 5;

    this._pivotY = null;
    this._collisionDistance = null;
  }

  getYaw() {
    return this.controller.yaw;
  }

  getPitch() {
    return this.controller.pitch;
  }

  /** Direction horizontale de visée (normalisée XZ). */
  getFlatForward(out = _forward) {
    out.set(-Math.sin(this.controller.yaw), 0, -Math.cos(this.controller.yaw));
    return out;
  }

  /** Yaw cible pour orienter le personnage dans la direction de la caméra. */
  getCharacterYaw() {
    const f = this.getFlatForward();
    return Math.atan2(f.x, f.z);
  }

  /** Direction de visée exacte (axe avant caméra / réticule). */
  getViewForward(out = _forward) {
    const { yaw, pitch } = this.controller;
    const cosP = Math.cos(pitch);
    return out.set(
      -Math.sin(yaw) * cosP,
      Math.sin(pitch),
      -Math.cos(yaw) * cosP,
    );
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

  /** Réinitialise tous les lissages (changement de map / téléport). */
  resetFollow() {
    this._pivotY = null;
    this._collisionDistance = null;
    this.controller.snap();
  }

  /**
   * Met à jour position + orientation de la caméra Three.js.
   * Aucune allocation : uniquement les caches module.
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Vector3} playerPos position des pieds du joueur
   * @param {number} dt
   * @param {THREE.Object3D[]} [collisionTargets]
   */
  applyToCamera(camera, playerPos, dt, collisionTargets = null) {
    const ctrl = this.controller;
    ctrl.update(dt);

    // Pivot épaules : XZ rigide (accroché), Y lissé (absorbe les marches).
    const targetPivotY = playerPos.y + this.pivotHeight;
    if (this._pivotY == null || Math.abs(targetPivotY - this._pivotY) > 2.5) {
      this._pivotY = targetPivotY;
    } else {
      this._pivotY += (targetPivotY - this._pivotY) * (1 - Math.exp(-dt * this.pivotYLambda));
    }
    _pivot.set(playerPos.x, this._pivotY, playerPos.z);

    // Base orthonormée caméra depuis les yaw/pitch lissés.
    const { yaw, pitch } = ctrl;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    _forward.set(-Math.sin(yaw) * cosP, sinP, -Math.cos(yaw) * cosP);
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _upCam.crossVectors(_right, _forward);

    // Cadrage écran exact : offsets caméra-espace pour projeter le pivot à
    // (screenAnchorX, screenAnchorY). ndc = anchor*2-1 ; offset = -ndc·d·tan.
    const d = ctrl.distance;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const ndcX = this.screenAnchorX * 2 - 1;
    const ndcY = this.screenAnchorY * 2 - 1;
    const ox = THREE.MathUtils.clamp(
      -ndcX * d * tanV * camera.aspect,
      -this.maxLateralOffset,
      this.maxLateralOffset,
    );
    const oy = -ndcY * d * tanV;

    _shoulderAnchor.copy(_pivot)
      .addScaledVector(_right, ox)
      .addScaledVector(_upCam, oy);

    // Position idéale : recul le long de l'axe de visée uniquement.
    _ideal.copy(_shoulderAnchor).addScaledVector(_forward, -d);

    // Collision : ne raccourcit QUE la composante de recul (cadrage stable).
    this.collision.resolve(_shoulderAnchor, _ideal, collisionTargets, _resolved);
    const rawDist = _resolved.distanceTo(_shoulderAnchor);

    if (this._collisionDistance == null) {
      this._collisionDistance = rawDist;
    } else {
      const lambda = rawDist < this._collisionDistance
        ? this.collisionInLambda
        : this.collisionOutLambda;
      this._collisionDistance += (rawDist - this._collisionDistance)
        * (1 - Math.exp(-dt * lambda));
    }
    // Clamp anti-clip : jamais au-delà de la distance libre du frame courant.
    const useDist = Math.min(this._collisionDistance, rawDist);

    camera.position.copy(_shoulderAnchor).addScaledVector(_forward, -useDist);

    // Orientation exacte depuis yaw/pitch lissés — rig rigide, réticule exact.
    _euler.set(pitch, yaw, 0);
    camera.quaternion.setFromEuler(_euler);
  }

  /** Raycast depuis le centre écran (NDC 0,0). */
  setCenterScreenRay(raycaster, camera) {
    raycaster.setFromCamera(_ndcCenter, camera);
  }
}
