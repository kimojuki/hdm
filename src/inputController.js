import { InputManager } from './controls.js';

function isUiTarget(target) {
  return Boolean(
    target.closest('#joystick-zone')
    || target.closest('#jump-btn')
    || target.closest('#fire-btn')
    || target.closest('#loading')
    || target.closest('#admin-link')
    || target.closest('#location-menu')
    || target.closest('#map-editor'),
  );
}

function isMobileTouch() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Orchestration entrée (joystick gauche + doigt droit caméra + gestes zoom).
 * - Ne gère PAS la logique de zoom visée : celle-ci est du ressort de AimController.
 * - Transforme uniquement les inputs en états pour CameraController + mouvement joueur.
 */
export class InputController {
  constructor(canvas, cameraCtrl) {
    this.canvas = canvas;
    this.cameraCtrl = cameraCtrl;
    this.input = new InputManager(canvas);

    /** Finger droit actif (mobile touch uniquement, côté droit). */
    this.lookActive = false;

    this._setupCameraLookInput();
  }

  focus() {
    this.input.focus();
  }

  getMoveVector() {
    return this.input.getMoveVector();
  }

  consumeJump() {
    return this.input.consumeJump();
  }

  consumeFire() {
    return this.input.consumeFire();
  }

  isFireHeld() {
    return this.input.isFireHeld();
  }

  _setupCameraLookInput() {
    let dragPointer = null;
    let rightLookDragging = false;
    let lastX = 0;
    let lastY = 0;

    let pinchStartDist = 0;
    let pinchStartBase = 0;

    const isLocked = () => document.pointerLockElement === this.canvas;

    const onPointerDown = (e) => {
      if (isUiTarget(e.target)) return;

      // Desktop : pointer lock au clic (standard TPS — la souris pilote la
      // caméra sans maintenir le clic ; Échap pour libérer le curseur).
      if (e.pointerType === 'mouse' && !isMobileTouch()) {
        if (!isLocked()) {
          const p = this.canvas.requestPointerLock?.();
          p?.catch?.(() => { /* refusé (ex: sortie récente via Échap) */ });
        }
        // Fallback drag tant que le lock n'est pas actif.
      }

      // Touch mobile : la caméra ne se contrôle que depuis la moitié droite.
      if (e.pointerType === 'touch' && isMobileTouch()) {
        const split = window.innerWidth * 0.42;
        if (e.clientX < split) return;
        rightLookDragging = true;
        this.lookActive = true;
      }

      dragPointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Refusé si le pointeur n'est plus actif (ex: pointer lock engagé).
      }
    };

    const onPointerMove = (e) => {
      // Pointer lock actif : deltas relatifs, aucun clic nécessaire.
      if (isLocked()) {
        if (e.movementX !== 0 || e.movementY !== 0) {
          this.cameraCtrl.applyDrag(e.movementX, e.movementY, false);
        }
        return;
      }
      if (dragPointer !== e.pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (dx !== 0 || dy !== 0) {
        this.cameraCtrl.applyDrag(dx, dy, e.pointerType === 'touch');
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const endDrag = (e) => {
      if (dragPointer !== e.pointerId) return;
      dragPointer = null;

      if (rightLookDragging) {
        rightLookDragging = false;
        this.lookActive = false;
      }

      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    // Zoom desktop : molette.
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraCtrl.addZoomDelta(e.deltaY * 0.014);
    }, { passive: false });

    // Zoom mobile : pincement (2 doigts SUR LE CANVAS uniquement).
    // Important : e.touches liste TOUS les doigts à l'écran, y compris celui
    // du joystick — sans ce filtre, joystick + caméra déclenchait un faux zoom.
    let pinchA = null;
    let pinchB = null;
    const getCanvasTouchPair = (e) => {
      pinchA = null;
      pinchB = null;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.target !== this.canvas) continue;
        if (!pinchA) pinchA = t;
        else if (!pinchB) pinchB = t;
        else return false; // plus de 2 doigts sur le canvas : pas de pincement
      }
      return Boolean(pinchA && pinchB);
    };

    this.canvas.addEventListener('touchstart', (e) => {
      if (!getCanvasTouchPair(e)) return;
      pinchStartDist = Math.hypot(
        pinchA.clientX - pinchB.clientX,
        pinchA.clientY - pinchB.clientY,
      );
      pinchStartBase = this.cameraCtrl.baseTargetDistance;
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (pinchStartDist < 1 || !getCanvasTouchPair(e)) return;
      e.preventDefault();
      const dist = Math.hypot(
        pinchA.clientX - pinchB.clientX,
        pinchA.clientY - pinchB.clientY,
      );
      const ratio = pinchStartDist / dist;
      this.cameraCtrl.setPinchDistance(pinchStartBase * ratio);
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (!getCanvasTouchPair(e)) pinchStartDist = 0;
    });
  }
}

