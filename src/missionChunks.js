import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadMecha01, initEnemy } from './enemy.js';
import { snapObjectBaseToSurface } from './terrain.js';
import { loadWithTimeout } from './loadUtils.js';
import {
  BUILDING_MODELS,
  BUILDING_LAYOUT,
  PLANT_MODELS,
  PLANT_LAYOUT,
  MOUNTAIN_MODELS,
  MOUNTAIN_LAYOUT,
} from './prefabs.js';

export const CHUNK_SIZE = 35;
export const CHUNK_LOAD_RADIUS = 1;
export const CHUNK_UNLOAD_RADIUS = 2;
const DEFAULT_MAP_HALF = 68;
const PROCEDURAL_PLANTS_PER_CHUNK = 5;
const BUILDING_EXCLUSION_RADIUS = 14;
const MOUNTAIN_BUILDING_PADDING = 10;

const ENEMY_LAYOUT = [
  { x: 28, z: -18, rot: Math.PI * 0.8 },
  { x: 34, z: 10, rot: Math.PI * 0.65 },
  { x: -30, z: 24, rot: Math.PI * 1.2 },
];

const _overlapBoxA = new THREE.Box3();
const _overlapBoxB = new THREE.Box3();

function hashChunk(cx, cz) {
  return ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
}

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function worldToChunk(x, z, mapHalf = DEFAULT_MAP_HALF) {
  const origin = -mapHalf;
  return {
    cx: Math.floor((x - origin) / CHUNK_SIZE),
    cz: Math.floor((z - origin) / CHUNK_SIZE),
  };
}

export function chunkCount(mapHalf = DEFAULT_MAP_HALF) {
  const span = mapHalf * 2;
  return Math.ceil(span / CHUNK_SIZE);
}

function bucketLayout(layout) {
  const buckets = new Map();
  for (const placement of layout) {
    const { cx, cz } = worldToChunk(placement.x, placement.z);
    const key = chunkKey(cx, cz);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(placement);
  }
  return buckets;
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function proceduralPlantsForChunk(cx, cz) {
  const rng = seededRng(hashChunk(cx, cz) ^ 0x9e3779b9);
  const origin = chunkWorldOrigin(cx, cz);
  const plants = [];
  for (let i = 0; i < PROCEDURAL_PLANTS_PER_CHUNK; i++) {
    const x = origin.x + 4 + rng() * (CHUNK_SIZE - 8);
    const z = origin.z + 4 + rng() * (CHUNK_SIZE - 8);
    if (isNearBuilding(x, z)) continue;
    plants.push({
      x,
      z,
      model: Math.floor(rng() * PLANT_MODELS.length),
      rot: rng() * Math.PI * 2,
      scale: 0.85 + rng() * 0.45,
      procedural: true,
    });
  }
  return plants;
}

function chunkWorldOrigin(cx, cz, mapHalf = DEFAULT_MAP_HALF) {
  const origin = -mapHalf;
  return {
    x: origin + cx * CHUNK_SIZE,
    z: origin + cz * CHUNK_SIZE,
  };
}

const buildingExclusion = BUILDING_LAYOUT.map((b) => ({
  minX: b.x - BUILDING_EXCLUSION_RADIUS,
  maxX: b.x + BUILDING_EXCLUSION_RADIUS,
  minZ: b.z - BUILDING_EXCLUSION_RADIUS,
  maxZ: b.z + BUILDING_EXCLUSION_RADIUS,
}));

function isNearBuilding(x, z) {
  return buildingExclusion.some(
    (box) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ,
  );
}

function mountainOverlapsBuilding(x, z) {
  const pad = MOUNTAIN_BUILDING_PADDING;
  _overlapBoxB.min.set(x - 8, -10, z - 8);
  _overlapBoxB.max.set(x + 8, 30, z + 8);
  return buildingExclusion.some((box) => {
    _overlapBoxA.min.set(box.minX - pad, -10, box.minZ - pad);
    _overlapBoxA.max.set(box.maxX + pad, 30, box.maxZ + pad);
    return _overlapBoxA.intersectsBox(_overlapBoxB);
  });
}

function prepareFbxModel(fbx, texture, { castShadow = true } = {}) {
  fbx.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = castShadow;
    child.receiveShadow = true;
    if (texture) {
      child.material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.02,
      });
    }
  });
  return fbx;
}

class ModelCache {
  constructor(basePath, models, texture, unitScale, tolerateErrors = false) {
    this.basePath = basePath;
    this.models = models;
    this.texture = texture;
    this.unitScale = unitScale;
    this.tolerateErrors = tolerateErrors;
    this.loader = new FBXLoader();
    this.cache = new Map();
  }

  async ensure(filename, castShadow = true) {
    if (this.cache.has(filename)) return this.cache.get(filename);
    try {
      const fbx = await loadWithTimeout(
        this.loader.loadAsync(`${this.basePath}/${filename}`),
        120000,
        `${this.basePath}/${filename}`,
      );
      const prepared = prepareFbxModel(fbx, this.texture, { castShadow });
      this.cache.set(filename, prepared);
      return prepared;
    } catch (err) {
      if (!this.tolerateErrors) throw err;
      console.warn(`[chunks] modèle ignoré: ${this.basePath}/${filename}`, err);
      this.cache.set(filename, null);
      return null;
    }
  }

  async preload(filenames, castShadow = true) {
    const unique = [...new Set(filenames)];
    await Promise.all(unique.map((f) => this.ensure(f, castShadow)));
  }
}

function spawnInstance(source, placement, unitScale) {
  const instance = source.clone();
  instance.position.set(placement.x, 0, placement.z);
  instance.rotation.y = placement.rot ?? 0;
  instance.scale.setScalar((placement.scale ?? 1) * unitScale);
  return instance;
}

/**
 * Charge / décharge les bâtiments, montagnes et végétation par zone (chunk).
 */
export class MissionChunkManager {
  constructor({
    root,
    groundMesh,
    collisionWorld,
    textures,
    buildingsGroup,
    mountainsGroup,
    plantsGroup,
    enemies,
    onEditorEntries,
    mapHalf = DEFAULT_MAP_HALF,
  }) {
    this.root = root;
    this.groundMesh = groundMesh;
    this.collisionWorld = collisionWorld;
    this.buildingsGroup = buildingsGroup;
    this.mountainsGroup = mountainsGroup;
    this.plantsGroup = plantsGroup;
    this.enemies = enemies;
    this.onEditorEntries = onEditorEntries;

    this.buildingCache = new ModelCache(
      '/batiment/map1/fbx',
      BUILDING_MODELS,
      textures.building,
      0.01,
    );
    this.mountainCache = new ModelCache(
      '/environement/montagne/Fbx',
      MOUNTAIN_MODELS,
      textures.mountain,
      0.022,
      true,
    );
    this.plantCache = new ModelCache(
      '/solmap1/Fbx',
      PLANT_MODELS,
      textures.plant,
      0.01,
    );

    this.buildingBuckets = bucketLayout(BUILDING_LAYOUT);
    this.mountainBuckets = bucketLayout(MOUNTAIN_LAYOUT);
    this.plantBuckets = bucketLayout(PLANT_LAYOUT);
    this.enemyBuckets = bucketLayout(ENEMY_LAYOUT);

    this.loadedChunks = new Map();
    this._loading = new Set();
    this._lastCenterX = NaN;
    this._lastCenterZ = NaN;
    this._updateCooldown = 0;
    this._modelsReady = false;
    this._chunkCount = chunkCount(mapHalf);
  }

  async preloadModels() {
    if (this._modelsReady) return;
    const buildingFiles = [...new Set(BUILDING_LAYOUT.map((p) => BUILDING_MODELS[p.model]))];
    const plantFiles = [...new Set(PLANT_MODELS)];
    const mountainFiles = [...new Set(MOUNTAIN_LAYOUT.map((p) => MOUNTAIN_MODELS[p.model]))];
    await Promise.all([
      this.buildingCache.preload(buildingFiles),
      this.plantCache.preload(plantFiles, false),
      this.mountainCache.preload(mountainFiles, false),
      loadMecha01(),
    ]);
    this._modelsReady = true;
  }

  async update(playerX, playerZ, dt = 0, force = false) {
    await this.preloadModels();

    const { cx: pcx, cz: pcz } = worldToChunk(playerX, playerZ);
    this._updateCooldown -= dt;

    if (!force && pcx === this._lastCenterX && pcz === this._lastCenterZ && this._updateCooldown > 0) {
      return;
    }

    this._lastCenterX = pcx;
    this._lastCenterZ = pcz;
    this._updateCooldown = 0.25;

    const wanted = new Set();
    for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS; dx++) {
      for (let dz = -CHUNK_LOAD_RADIUS; dz <= CHUNK_LOAD_RADIUS; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (cx < 0 || cz < 0 || cx >= this._chunkCount || cz >= this._chunkCount) continue;
        wanted.add(chunkKey(cx, cz));
      }
    }

    const unload = [];
    for (const key of this.loadedChunks.keys()) {
      if (!wanted.has(key)) {
        const [cx, cz] = key.split(',').map(Number);
        const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
        if (dist > CHUNK_UNLOAD_RADIUS) unload.push(key);
      }
    }

    for (const key of unload) this.unloadChunk(key);

    const loadJobs = [];
    for (const key of wanted) {
      if (!this.loadedChunks.has(key) && !this._loading.has(key)) {
        loadJobs.push(this.loadChunk(key));
      }
    }

    if (loadJobs.length > 0) {
      await Promise.all(loadJobs);
      this.collisionWorld.finalize();
    }
  }

  async loadChunk(key) {
    if (this.loadedChunks.has(key) || this._loading.has(key)) return;
    this._loading.add(key);

    try {
      const [cx, cz] = key.split(',').map(Number);
      const state = { entries: [], enemies: [] };
      const surface = [this.groundMesh];

      await this.spawnCategory({
        state,
        placements: this.buildingBuckets.get(key) ?? [],
        cache: this.buildingCache,
        models: BUILDING_MODELS,
        parent: this.buildingsGroup,
        categoryId: 'buildings',
        yOffset: 0.03,
        collision: 'full',
        castShadow: true,
        surface,
      });

      await this.spawnCategory({
        state,
        placements: (this.mountainBuckets.get(key) ?? []).filter(
          (p) => !mountainOverlapsBuilding(p.x, p.z),
        ),
        cache: this.mountainCache,
        models: MOUNTAIN_MODELS,
        parent: this.mountainsGroup,
        categoryId: 'mountains',
        yOffset: 0.01,
        collision: 'steep',
        castShadow: false,
        surface,
      });

      const handPlants = this.plantBuckets.get(key) ?? [];
      const procPlants = handPlants.length < 3 ? proceduralPlantsForChunk(cx, cz) : [];
      await this.spawnCategory({
        state,
        placements: [...handPlants, ...procPlants],
        cache: this.plantCache,
        models: PLANT_MODELS,
        parent: this.plantsGroup,
        categoryId: 'plants',
        yOffset: 0.02,
        collision: 'none',
        castShadow: false,
        surface,
      });

      for (const placement of this.enemyBuckets.get(key) ?? []) {
        const enemy = await loadMecha01();
        initEnemy(enemy, placement.x, placement.z, placement.rot, this.groundMesh);
        this.root.add(enemy);
        this.enemies.push(enemy);
        this.collisionWorld.addDynamic(enemy, 0.1);
        state.enemies.push(enemy);
      }

      this.loadedChunks.set(key, state);
      if (this.onEditorEntries) this.onEditorEntries(state.entries);
    } finally {
      this._loading.delete(key);
    }
  }

  async spawnCategory({
    state,
    placements,
    cache,
    models,
    parent,
    categoryId,
    yOffset,
    collision,
    castShadow,
    surface,
  }) {
    for (const placement of placements) {
      const filename = models[placement.model];
      const source = await cache.ensure(filename, castShadow);
      if (!source) continue;

      const object = spawnInstance(source, placement, cache.unitScale);
      parent.add(object);
      snapObjectBaseToSurface(object, surface, yOffset);

      let collider = null;
      if (collision === 'full') {
        collider = this.collisionWorld.addStaticFromObject(object);
      } else if (collision === 'steep') {
        collider = this.collisionWorld.addStaticFromObject(object, { steepOnly: true });
      }

      const entry = {
        object,
        categoryId,
        model: placement.model,
        scale: placement.scale ?? 1,
        collider,
      };
      state.entries.push(entry);
    }
  }

  unloadChunk(key) {
    const state = this.loadedChunks.get(key);
    if (!state) return;

    for (const entry of state.entries) {
      entry.object.removeFromParent();
      if (entry.collider) this.collisionWorld.removeStaticFromObject(entry.object);
    }

    for (const enemy of state.enemies) {
      enemy.removeFromParent();
      this.collisionWorld.removeDynamic(enemy);
      const idx = this.enemies.indexOf(enemy);
      if (idx >= 0) this.enemies.splice(idx, 1);
    }

    state.group?.removeFromParent();
    this.loadedChunks.delete(key);
    this.collisionWorld.finalize();
  }

  getLoadedChunkCount() {
    return this.loadedChunks.size;
  }
}
