import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

const PREVIEW_W = 400;
const PREVIEW_H = 300;

const listeners = new Map();

function prepareMaterials(object, atlasTexture) {
  object.traverse((child) => {
    if (!child.isMesh) return;

    if (atlasTexture) {
      child.material = new THREE.MeshStandardMaterial({
        map: atlasTexture,
        roughness: 0.85,
        metalness: 0.05,
      });
      return;
    }

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (mat.normalMap) mat.normalMap.colorSpace = THREE.NoColorSpace;
      mat.needsUpdate = true;
    }
  });
}

function fitAndFrame(object, camera) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  let targetSize = 2.4;
  if (maxDim < 0.02) targetSize = 10;
  else if (maxDim < 0.1) targetSize = 6;
  else if (maxDim < 0.4) targetSize = 4;
  else if (maxDim < 1) targetSize = 3;

  const scale = targetSize / maxDim;
  object.scale.setScalar(scale);

  box.setFromObject(object);
  box.getCenter(center);
  object.position.sub(center);
  object.position.y -= box.min.y;

  box.setFromObject(object);
  const fittedSize = box.getSize(new THREE.Vector3());
  const fittedMax = Math.max(fittedSize.x, fittedSize.y, fittedSize.z);
  const dist = Math.max(fittedMax * 1.8, 1.5);

  camera.position.set(dist * 0.85, dist * 0.65, dist * 0.95);
  camera.lookAt(0, fittedSize.y * 0.45, 0);
  camera.near = 0.01;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
}

function dirPath(urlPath) {
  const parts = urlPath.split('/');
  parts.pop();
  return `${parts.join('/')}/`;
}

async function loadModel(item) {
  let atlasTexture = null;
  if (item.textures?.[0]) {
    try {
      atlasTexture = await textureLoader.loadAsync(item.textures[0]);
      atlasTexture.colorSpace = THREE.SRGBColorSpace;
    } catch {
      atlasTexture = null;
    }
  }

  let object;
  if (item.format === 'obj') {
    const base = dirPath(item.path);
    const mtlLoader = new MTLLoader();
    mtlLoader.setResourcePath(base);
    const mtlPath = item.mtl ?? item.path.replace(/\.obj$/i, '.mtl');
    const materials = await mtlLoader.loadAsync(mtlPath);
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    object = await objLoader.loadAsync(item.path);
  } else if (item.format === 'glb' || item.format === 'gltf') {
    const scene = await loadGltfScene(item.path);
    if (item.prefabNode) {
      const node = findPrefabNode(scene, item.prefabNode);
      if (!node) throw new Error(`Prefab « ${item.prefabNode} » introuvable`);
      object = node.clone(true);
      object.updateMatrixWorld(true);
    } else {
      object = scene.clone(true);
    }
  } else {
    if (item.path.includes('/base/neon/')) {
      fbxLoader.setResourcePath('/batiment/base/neon/textures/');
    }
    object = await fbxLoader.loadAsync(item.path);
  }

  prepareMaterials(object, atlasTexture);

  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.rotation.y = 0.55;

  return wrapper;
}

const gltfSceneCache = new Map();

async function loadGltfScene(path) {
  if (!gltfSceneCache.has(path)) {
    const gltf = await gltfLoader.loadAsync(path);
    gltfSceneCache.set(path, gltf.scene);
  }
  return gltfSceneCache.get(path);
}

function findPrefabNode(scene, prefabNode) {
  const root = scene.getObjectByName('Root');
  if (root) {
    const direct = root.children.find((child) => child.name === prefabNode);
    if (direct) return direct;
  }
  return scene.getObjectByName(prefabNode);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    // Ne pas disposer geometry/material — partagés via le cache GLTF et les clones.
  });
}

function assetKey(item) {
  return item.id ?? item.source ?? item.path;
}

class PreviewRenderer {
  constructor() {
    this.cache = new Map();
    this.inflight = new Map();
    this.queue = [];
    this.busy = false;
    this.progressDone = 0;
    this.progressTotal = 0;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PREVIEW_W, PREVIEW_H, false);
    this.renderer.setClearColor(0x2a2014, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, PREVIEW_W / PREVIEW_H, 0.01, 500);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const hemi = new THREE.HemisphereLight(0xfff0d0, 0x443322, 0.6);
    const key = new THREE.DirectionalLight(0xfff4d6, 1.4);
    key.position.set(4, 6, 5);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.55);
    fill.position.set(-5, 3, -3);
    const rim = new THREE.DirectionalLight(0xffe0a0, 0.4);
    rim.position.set(0, 2, -6);
    this.lights = new THREE.Group();
    this.lights.add(ambient, hemi, key, fill, rim);
    this.scene.add(this.lights);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);
  }

  onProgress(fn) {
    this.progressFn = fn;
  }

  _notifyProgress() {
    this.progressFn?.(this.progressDone, this.progressTotal);
  }

  getThumbnail(item) {
    const key = assetKey(item);
    if (this.cache.has(key)) {
      return Promise.resolve(this.cache.get(key));
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const promise = new Promise((resolve, reject) => {
      this.queue.push({ item, key, resolve, reject });
      this._processQueue();
    });

    this.inflight.set(key, promise);
    promise.finally(() => this.inflight.delete(key));
    return promise;
  }

  async _processQueue() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;

    const job = this.queue.shift();

    try {
      const dataUrl = await this._render(job.item);
      this.cache.set(job.key, dataUrl);
      this._emit(job.key, dataUrl);
      job.resolve(dataUrl);
    } catch (err) {
      this._emit(job.key, null, err);
      job.reject(err);
    } finally {
      this.progressDone += 1;
      this._notifyProgress();
      this.busy = false;
      this._processQueue();
    }
  }

  async _render(item) {
    while (this.modelRoot.children.length) {
      const child = this.modelRoot.children[0];
      this.modelRoot.remove(child);
      disposeObject(child);
    }

    const model = await loadModel(item);
    fitAndFrame(model, this.camera);
    this.modelRoot.add(model);
    this.renderer.render(this.scene, this.camera);

    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    this.modelRoot.remove(model);
    disposeObject(model);

    return dataUrl;
  }

  subscribe(path, fn) {
    if (!listeners.has(path)) listeners.set(path, new Set());
    listeners.get(path).add(fn);
    if (this.cache.has(path)) fn(this.cache.get(path), null);
    return () => listeners.get(path)?.delete(fn);
  }

  _emit(path, dataUrl, err = null) {
    for (const fn of listeners.get(path) ?? []) fn(dataUrl, err);
  }

  resetProgress(total) {
    this.progressTotal = total;
    this.progressDone = 0;
    this._notifyProgress();
  }
}

export const previewRenderer = new PreviewRenderer();

export function applyThumbnailToCard(assetId, dataUrl) {
  for (const img of document.querySelectorAll('.preview-img')) {
    if (img.dataset.assetId !== assetId) continue;
    const wrap = img.closest('.preview-wrap');
    if (dataUrl) {
      img.src = dataUrl;
      img.classList.add('is-loaded');
      wrap?.classList.remove('is-loading', 'preview-error');
    } else {
      wrap?.classList.remove('is-loading');
      wrap?.classList.add('preview-error');
    }
  }
}

export function queueThumbnail(item) {
  const key = assetKey(item);
  const wrap = document.querySelector(`.preview-img[data-asset-id="${CSS.escape(key)}"]`)?.closest('.preview-wrap');
  wrap?.classList.add('is-loading');

  const unsub = previewRenderer.subscribe(key, (dataUrl, err) => {
    applyThumbnailToCard(key, err ? null : dataUrl);
    unsub();
  });

  return previewRenderer.getThumbnail(item).catch(() => null);
}

export function queueAllThumbnails(items) {
  let cachedCount = 0;
  const toRender = [];

  for (const item of items) {
    const key = assetKey(item);
    if (previewRenderer.cache.has(key)) {
      applyThumbnailToCard(key, previewRenderer.cache.get(key));
      cachedCount += 1;
    } else {
      toRender.push(item);
    }
  }

  previewRenderer.resetProgress(items.length);
  previewRenderer.progressDone = cachedCount;
  previewRenderer._notifyProgress();

  for (const item of toRender) {
    queueThumbnail(item);
  }
}
