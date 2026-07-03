import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadMecha01, initEnemy } from './enemy.js';
import { CollisionWorld } from './collisions.js';
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

export const MISSION_MAP_SIZE = 140;
export const MISSION_MAP_HALF = MISSION_MAP_SIZE / 2 - 2;

const ENEMY_LAYOUT = [
  { x: 28, z: -18, rot: Math.PI * 0.8 },
  { x: 34, z: 10, rot: Math.PI * 0.65 },
  { x: -30, z: 24, rot: Math.PI * 1.2 },
];

const _overlapBoxA = new THREE.Box3();
const _overlapBoxB = new THREE.Box3();

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

async function loadFbxPlacements({
  basePath,
  models,
  layout,
  texture,
  unitScale = 0.01,
  tolerateModelLoadErrors = false,
  castShadow = true,
}) {
  const loader = new FBXLoader();
  const cache = new Map();
  const group = new THREE.Group();
  const instances = [];

  const loadModel = async (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    try {
      const fbx = await loadWithTimeout(
        loader.loadAsync(`${basePath}/${filename}`),
        120000,
        `${basePath}/${filename}`,
      );
      const prepared = prepareFbxModel(fbx, texture, { castShadow });
      cache.set(filename, prepared);
      return prepared;
    } catch (err) {
      if (!tolerateModelLoadErrors) throw err;
      console.warn(`[assets] modèle ignoré: ${basePath}/${filename}`, err);
      cache.set(filename, null);
      return null;
    }
  };

  const uniqueModels = [...new Set(layout.map((p) => models[p.model]))];
  await Promise.all(uniqueModels.map(loadModel));

  for (const placement of layout) {
    const filename = models[placement.model];
    const source = cache.get(filename);
    if (!source) continue;
    const instance = source.clone();
    instance.position.set(placement.x, 0, placement.z);
    instance.rotation.y = placement.rot;
    instance.scale.setScalar(placement.scale * unitScale);
    group.add(instance);
    instances.push({ object: instance });
  }

  return { group, instances };
}

function layoutToEditorEntries(instances, layout, categoryId, colliders = []) {
  return instances.map((inst, i) => ({
    object: inst.object,
    categoryId,
    model: layout[i]?.model ?? 0,
    scale: layout[i]?.scale ?? 1,
    collider: colliders[i] ?? null,
  }));
}

function placeObjectsOnGround(instances, groundMesh, yOffset = 0.02) {
  const surface = [groundMesh];
  for (const { object } of instances) {
    snapObjectBaseToSurface(object, surface, yOffset);
  }
}

function removeMountainsOverlappingBuildings(mountainInstances, buildingsGroup, padding = 8) {
  const buildingBoxes = [];
  buildingsGroup.updateMatrixWorld(true);
  buildingsGroup.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    _overlapBoxA.setFromObject(child);
    _overlapBoxA.expandByScalar(padding);
    buildingBoxes.push(_overlapBoxA.clone());
  });

  for (const { object } of mountainInstances) {
    object.updateMatrixWorld(true);
    _overlapBoxB.setFromObject(object);
    const overlaps = buildingBoxes.some((box) => box.intersectsBox(_overlapBoxB));
    if (overlaps) object.removeFromParent();
  }
}

export function createMissionGround(scene) {
  const groundGeo = new THREE.PlaneGeometry(MISSION_MAP_SIZE, MISSION_MAP_SIZE, 56, 56);
  const positions = groundGeo.attributes.position;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const wave = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 0.4;
    const dune = Math.sin((x + y) * 0.08) * 0.6;
    const longWave = Math.sin(x * 0.05 - y * 0.035) * 0.9;
    const ridge = Math.sin(x * 0.028 + y * 0.031) * 0.45;
    positions.setZ(i, wave + dune + longWave + ridge);
  }
  groundGeo.computeVertexNormals();

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xc4a060,
    roughness: 0.95,
    metalness: 0.0,
  });

  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return ground;
}

/**
 * Map mission désert — instance indépendante, ajoutée à la scène par SceneManager.
 */
export async function loadMissionMap(textures) {
  const { plant: plantTexture, building: buildingTexture, mountain: mountainTexture } = textures;
  const root = new THREE.Group();
  root.name = 'MissionMap';

  const collisionWorld = new CollisionWorld();
  const groundMesh = createMissionGround(root);
  let mountainsGroup = null;
  const enemies = [];

  const buildingsData = await loadFbxPlacements({
    basePath: '/batiment/map1/fbx',
    models: BUILDING_MODELS,
    layout: BUILDING_LAYOUT,
    texture: buildingTexture,
    unitScale: 0.01,
  });
  placeObjectsOnGround(buildingsData.instances, groundMesh, 0.03);
  root.add(buildingsData.group);
  buildingsData.group.updateMatrixWorld(true);

  const buildingColliders = [];
  for (const { object } of buildingsData.instances) {
    buildingColliders.push(collisionWorld.addStaticFromObject(object));
  }

  const mountainsData = await loadFbxPlacements({
    basePath: '/environement/montagne/Fbx',
    models: MOUNTAIN_MODELS,
    layout: MOUNTAIN_LAYOUT,
    texture: mountainTexture,
    unitScale: 0.022,
    tolerateModelLoadErrors: true,
    castShadow: false,
  });
  mountainsGroup = mountainsData.group;
  placeObjectsOnGround(mountainsData.instances, groundMesh, 0.01);
  removeMountainsOverlappingBuildings(mountainsData.instances, buildingsData.group, 10);
  root.add(mountainsGroup);
  mountainsGroup.updateMatrixWorld(true);

  const mountainColliders = new Map();
  for (const { object } of mountainsData.instances) {
    if (!object.parent) continue;
    mountainColliders.set(object, collisionWorld.addStaticFromObject(object, { steepOnly: true }));
  }

  const plantsData = await loadFbxPlacements({
    basePath: '/solmap1/Fbx',
    models: PLANT_MODELS,
    layout: PLANT_LAYOUT,
    texture: plantTexture,
    unitScale: 0.01,
    castShadow: false,
  });
  placeObjectsOnGround(plantsData.instances, groundMesh);
  root.add(plantsData.group);
  plantsData.group.updateMatrixWorld(true);

  for (const placement of ENEMY_LAYOUT) {
    const enemy = await loadMecha01();
    initEnemy(enemy, placement.x, placement.z, placement.rot, groundMesh);
    root.add(enemy);
    enemies.push(enemy);
    collisionWorld.addDynamic(enemy, 0.1);
  }

  collisionWorld.finalize();

  const terrainRoots = [groundMesh];
  const debugGroup = collisionWorld.createDebugGroup();
  debugGroup.visible = false;
  root.add(debugGroup);

  const mountainEntries = [];
  for (let i = 0; i < mountainsData.instances.length; i++) {
    const inst = mountainsData.instances[i];
    if (!inst.object.parent) continue;
    const layout = MOUNTAIN_LAYOUT[i];
    if (!layout) continue;
    mountainEntries.push({
      object: inst.object,
      categoryId: 'mountains',
      model: layout.model,
      scale: layout.scale,
      collider: mountainColliders.get(inst.object) ?? null,
    });
  }

  return {
    root,
    mapHalf: MISSION_MAP_HALF,
    collisionWorld,
    terrainRoots,
    groundMesh,
    mountainsGroup,
    enemies,
    debugGroup,
    editorEntries: [
      ...layoutToEditorEntries(buildingsData.instances, BUILDING_LAYOUT, 'buildings', buildingColliders),
      ...mountainEntries,
      ...layoutToEditorEntries(plantsData.instances, PLANT_LAYOUT, 'plants'),
    ],
  };
}
