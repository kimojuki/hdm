import * as THREE from 'three';

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraController {
  constructor({
    distance = 8.6,
    minDistance = 4.5,
    maxDistance = 16,
    minPitch = 0.25,
    maxPitch = 1.15,
    lookHeight = 1.3,
    touchSensitivity = 0.0042,
    mouseSensitivity = 0.0028,
  } = {}) {
    this.yaw = 0;
    this.pitch = 0.62;
    this.distance = distance;
    this.targetDistance = distance;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.lookHeight = lookHeight;
    this.touchSensitivity = touchSensitivity;
    this.mouseSensitivity = mouseSensitivity;
  }

  getYaw() {
    return this.yaw;
  }

  applyDrag(dx, dy, isTouch = false) {
    const s = isTouch ? this.touchSensitivity : this.mouseSensitivity;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, this.minPitch, this.maxPitch);
  }

  addZoomDelta(delta) {
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + delta,
      this.minDistance,
      this.maxDistance,
    );
  }

  setPinchDistance(dist) {
    this.targetDistance = THREE.MathUtils.clamp(dist, this.minDistance, this.maxDistance);
  }

  update(dt) {
    this.distance = THREE.MathUtils.lerp(
      this.distance,
      this.targetDistance,
      1 - Math.pow(0.0001, dt),
    );
  }

  getIdealPosition(playerPos) {
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const hDist = this.distance * cosP;

    _pos.set(
      playerPos.x + Math.sin(this.yaw) * hDist,
      playerPos.y + this.lookHeight + this.distance * sinP,
      playerPos.z + Math.cos(this.yaw) * hDist,
    );
    return _pos;
  }

  getLookTarget(playerPos) {
    return _look.set(playerPos.x, playerPos.y + this.lookHeight, playerPos.z);
  }

  applyToCamera(camera, playerPos, dt) {
    this.update(dt);
    const ideal = this.getIdealPosition(playerPos);
    camera.position.lerp(ideal, 1 - Math.pow(0.001, dt));
    camera.lookAt(this.getLookTarget(playerPos));
  }
}

function isUiTarget(target) {
  return Boolean(
    target.closest('#joystick-zone')
    || target.closest('#jump-btn')
    || target.closest('#loading')
    || target.closest('#admin-link'),
  );
}

function isMobileTouch() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Glisser pour tourner la vue ; molette / pincement pour zoom (mobile prioritaire). */
export function bindCameraInput(canvas, cameraCtrl) {
  let dragPointer = null;
  let lastX = 0;
  let lastY = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = cameraCtrl.targetDistance;

  const onPointerDown = (e) => {
    if (isUiTarget(e.target)) return;
    if (e.pointerType === 'touch' && isMobileTouch()) {
      const split = window.innerWidth * 0.42;
      if (e.clientX < split) return;
    }

    dragPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (dragPointer !== e.pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (dx !== 0 || dy !== 0) {
      cameraCtrl.applyDrag(dx, dy, e.pointerType === 'touch');
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const endDrag = (e) => {
    if (dragPointer !== e.pointerId) return;
    dragPointer = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraCtrl.addZoomDelta(e.deltaY * 0.014);
  }, { passive: false });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || isUiTarget(e.target)) return;
    const [a, b] = e.touches;
    pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchStartZoom = cameraCtrl.targetDistance;
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || pinchStartDist < 1) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = pinchStartDist / dist;
    cameraCtrl.setPinchDistance(pinchStartZoom * ratio);
  }, { passive: false });
}

/** Convertit l'entrée écran (joystick/clavier) en direction monde selon la caméra. */
export function getCameraRelativeMove(move, cameraYaw) {
  const { x, y } = move;
  if (x === 0 && y === 0) return { x: 0, z: 0 };

  const inputForward = -y;
  const inputStrafe = x;

  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  // Direction « avant » de la caméra projetée au sol (de la caméra vers le joueur)
  const fx = -sin;
  const fz = -cos;
  // Droite de la caméra au sol : forward × up
  const rx = cos;
  const rz = -sin;

  let mx = fx * inputForward + rx * inputStrafe;
  let mz = fz * inputForward + rz * inputStrafe;
  const len = Math.hypot(mx, mz);
  if (len < 1e-6) return { x: 0, z: 0 };

  return { x: mx / len, z: mz / len };
}
