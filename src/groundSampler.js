import {
  analyticalGroundHeight,
  sampleWalkableSurface,
  MAX_STEP_HEIGHT,
} from './terrain.js';

const CACHE_EPS_XZ = 0.04;
const CACHE_EPS_Y = 0.2;

/**
 * Échantillonneur de sol unifié — évite des centaines de raycasts mesh par frame.
 * Mission : hauteur analytique (même formule que le sol procédural).
 * Base : raycast sur mesh sol/marches dédié uniquement.
 */
export class GroundSampler {
  constructor({ mode = 'mesh', roots = [] } = {}) {
    this.mode = mode;
    this.roots = roots;
    this._cache = { x: NaN, z: NaN, feetY: NaN, maxStep: NaN, probe: '', y: 0 };
  }

  setRoots(roots) {
    this.roots = roots;
    this.invalidate();
  }

  invalidate() {
    this._cache.x = NaN;
  }

  sample(x, feetY, z, maxStepUp = MAX_STEP_HEIGHT, probeMode = 'full') {
    if (this.mode === 'analytical') {
      return analyticalGroundHeight(x, z);
    }

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

    const y = sampleWalkableSurface(x, feetY, z, this.roots, maxStepUp, probeMode);
    c.x = x;
    c.z = z;
    c.feetY = feetY;
    c.maxStep = maxStepUp;
    c.probe = probeMode;
    c.y = y;
    return y;
  }
}
