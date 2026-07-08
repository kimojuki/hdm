export class AimController {
  constructor({
    aimSystem,
    cameraCtrl,
    aimZoomFactor = 0.85,
  }) {
    this.aimSystem = aimSystem;
    this.cameraCtrl = cameraCtrl;
    this.aimZoomFactor = aimZoomFactor;
  }

  setLookActive(lookActive) {
    this.cameraCtrl.setAimZoomActive(!!lookActive, this.aimZoomFactor);
  }

  update(camera, { targets, excludeRoot = null, lookActive = false } = {}) {
    // Zoom visée : léger dolly-in quand on contrôle la caméra via le doigt droit.
    this.setLookActive(lookActive);
    this.aimSystem.update(camera, targets, excludeRoot);
    return this.aimSystem.aimPoint;
  }
}

