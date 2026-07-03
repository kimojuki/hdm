import * as THREE from 'three';
import { BASE_SKY_TEXTURE_PATH } from './basePrefabs.js';

const SKY_IMAGE = `${BASE_SKY_TEXTURE_PATH}background.jpg`;

let skyTexture = null;
let loadPromise = null;

/** Charge la texture panorama fantasy-sky-background (4096×2048). */
export function loadBaseSkyTexture() {
  if (skyTexture) return Promise.resolve(skyTexture);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      SKY_IMAGE,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture = tex;
        resolve(tex);
      },
      undefined,
      (err) => {
        loadPromise = null;
        reject(new Error(`Ciel fantasy introuvable (${SKY_IMAGE})`));
      },
    );
  });

  return loadPromise;
}

/** Applique le ciel fantasy sur la scène Three.js (base personnelle). */
export async function applyBaseSkyEnvironment(scene) {
  const tex = await loadBaseSkyTexture();
  scene.background = tex;
  scene.environment = null;
  scene.fog = null;
}

/** Retire le ciel fantasy (retour map mission). */
export function clearBaseSkyEnvironment(scene) {
  scene.background = null;
  scene.environment = null;
}

export function disposeBaseSkyTexture() {
  skyTexture?.dispose();
  skyTexture = null;
  loadPromise = null;
}
