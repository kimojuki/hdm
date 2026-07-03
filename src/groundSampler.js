import {
  analyticalGroundHeight,
  sampleWalkableSurface,
  MAX_STEP_HEIGHT,
} from './terrain.js';

const CACHE_EPS_XZ = 0.1;
const CACHE_EPS_Y = 0.4;

/**
 * Échantillonneur de sol unifié — évite des centaines de raycasts mesh par frame.
 * Mission : hauteur analytique (même formule que le sol procédural).
 * Base : BVH sur colliders sol (rapide) ; mesh en repli.
 */
export class GroundSampler {
  constructor({ mode = 'mesh', roots = [], collisionWorld = null } = {}) {
    this.mode = mode;
    this.roots = roots;
    this.collisionWorld = collisionWorld;
    this._cache = { x: NaN, z: NaN, feetY: NaN, maxStep: NaN, probe: '', y: 0 };
  }

  setRoots(roots) {
    this.roots = roots;
    this.invalidate();
  }

  setCollisionWorld(collisionWorld) {
    this.collisionWorld = collisionWorld;
    this.invalidate();
  }

  invalidate() {
    this._cache.x = NaN;
  }

  sample(x, feetY, z, maxStepUp = MAX_STEP_HEIGHT, probeMode = 'full') {
    if (this.mode === 'analytical') {
      return analyticalGroundHeight(x, z);
    }

    if (this.mode === 'bvh' && this.collisionWorld) {
      return this._sampleCached(
        x, feetY, z, maxStepUp, probeMode,
        () => this.collisionWorld.sampleWalkableFloor(x, feetY, z, maxStepUp, probeMode),
      );
    }

    return this._sampleCached(
      x, feetY, z, maxStepUp, probeMode,
      () => sampleWalkableSurface(x, feetY, z, this.roots, maxStepUp, probeMode),
    );
  }

  _sampleCached(x, feetY, z, maxStepUp, probeMode, compute) {
    const c = this._cache;
    if (
      Math.abs(x - c.x) < CACHE_EPS_XZ
      && Math.abs(z - c.z) < CACHE_EPS_XZ
      && Math.abs(feetY - c.feetY) < CACHE_EPS_Y
      && maxStepUp === c.maxStep
      && probeMode === c.probe
    ) {
      return c.y;
    }

    const y = compute();
    c.x = x;
    c.z = z;
    c.feetY = feetY;
    c.maxStep = maxStepUp;
    c.probe = probeMode;
    c.y = y;
    return y;
  }
}
