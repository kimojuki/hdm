import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CollisionWorld } from './collisions.js';
import { sampleTerrainHeightAtFeet } from './terrain.js';
import { GroundSampler } from './groundSampler.js';
import {
  BASE_NEON_FBX_PATH,
  BASE_NEON_TEXTURE_PATH,
  BASE_TARGET_SIZE,
  BASE_MAP_MARGIN,
  BASE_GROUND_MARGIN,
  BASE_SPAWN_CANDIDATES,
} from './basePrefabs.js';

const _ray = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, -1, 0);
const _rayUp = new THREE.Vector3(0, 1, 0);

const PIT_DEPTH_THRESHOLD = 0.85;
const PLAYER_HEADROOM = 1.75;
const DEPRESSION_PROBE = [
  [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14],
  [0.10, 0.10], [-0.10, 0.10], [0.10, -0.10], [-0.10, -0.10],
];
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

function prepareNeonMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat) continue;

      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = 2;
      }
      if (mat.emissiveMap) {
        mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.emissive = mat.emissive ?? new THREE.Color(0xffffff);
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 2.4);
      } else if (mat.emissive) {
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 1.2);
      }

      mat.roughness = mat.roughness ?? 0.55;
      mat.metalness = mat.metalness ?? 0.35;
      mat.envMapIntensity = 0.6;
    }
  });
}

function createInteriorLighting(model) {
  const group = new THREE.Group();
  group.name = 'InteriorLighting';

  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getCenter(_center);
  _box.getSize(_size);

  const midY = _box.min.y + _size.y * 0.5;
  const reach = Math.max(_size.x, _size.z) * 0.9;

  const hemi = new THREE.HemisphereLight(0x99bbff, 0x1a0828, 1.35);
  hemi.position.set(_center.x, midY, _center.z);
  group.add(hemi);

  const fill = new THREE.PointLight(0xaaccff, 4.5, reach * 1.8, 1.8);
  fill.position.set(_center.x, midY, _center.z);
  group.add(fill);

  return group;
}

function createSpawnMarker() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshBasicMaterial({
      color: 0x3dff6a,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  mesh.renderOrder = 1003;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 24),
    new THREE.MeshBasicMaterial({
      color: 0x3dff6a,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.renderOrder = 1003;
  mesh.add(ring);
  return mesh;
}

async function loadNeonBaseModel() {
  const loader = new FBXLoader();
  loader.setResourcePath(BASE_NEON_TEXTURE_PATH);

  const model = await loader.loadAsync(BASE_NEON_FBX_PATH);
  model.name = 'NeonBase';

  prepareNeonMaterials(model);

  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z);
  const scale = maxDim > 0 ? BASE_TARGET_SIZE / maxDim : 1;
  model.scale.setScalar(scale);

  return model;
}

function createMarsTerrain(flatCenter, groundSize) {
  const geo = new THREE.PlaneGeometry(groundSize, groundSize, 44, 44);
  const positions = geo.attributes.position;
  const padR = groundSize * 0.38;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);

    const dunes = Math.sin(x * 0.12) * Math.cos(y * 0.1) * 0.45;
    const ridge = Math.sin((x + y) * 0.045) * 0.3;
    const flatBase = Math.exp(-((x - flatCenter.x) ** 2 + (y - flatCenter.z) ** 2) / (padR * padR)) * 1.1;

    positions.setZ(i, dunes + ridge - flatBase);
  }

  geo.computeVertexNormals();

  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0xc04e28,
      roughness: 0.98,
      metalness: 0.02,
      flatShading: true,
    }),
  );
}

function alignOnGround(group) {
  group.updateMatrixWorld(true);
  _box.setFromObject(group);
  _box.getCenter(_center);

  group.position.x -= _center.x;
  group.position.z -= _center.z;
  group.updateMatrixWorld(true);

  _box.setFromObject(group);
  group.position.y -= _box.min.y;
  group.updateMatrixWorld(true);
}

function findWalkableFloorAt(model, x, z, box, size) {
  const probeY = box.min.y + size.y * 0.55;
  _rayOrigin.set(x, probeY, z);
  _ray.set(_rayOrigin, _rayDir);
  _ray.far = size.y * 0.95;

  const hits = _ray.intersectObject(model, true);
  let best = null;

  for (const hit of hits) {
    if (!hit.face) continue;
    const normalY = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y;
    if (normalY < 0.65) continue;
    // Plancher le plus bas = niveau principal (pas la mezzanine).
    if (!best || hit.point.y < best.y) best = hit.point.clone();
  }

  return best;
}

function isInDepression(model, x, z, floorY, box, size) {
  let higherNeighbors = 0;

  for (const [ox, oz] of DEPRESSION_PROBE) {
    const nx = x + size.x * 0.5 * ox;
    const nz = z + size.z * 0.5 * oz;
    const neighbor = findWalkableFloorAt(model, nx, nz, box, size);
    if (neighbor && neighbor.y > floorY + PIT_DEPTH_THRESHOLD) higherNeighbors++;
  }

  return higherNeighbors >= 4;
}

function hasHeadroom(model, point) {
  _rayOrigin.set(point.x, point.y + 0.15, point.z);
  _ray.set(_rayOrigin, _rayUp);
  _ray.far = PLAYER_HEADROOM + 0.4;
  const hits = _ray.intersectObject(model, true);
  return hits.length === 0 || hits[0].distance >= PLAYER_HEADROOM - 0.15;
}

function isValidSpawnFloor(model, point, box, size) {
  if (!point) return false;
  if (isInDepression(model, point.x, point.z, point.y, box, size)) return false;
  return hasHeadroom(model, point);
}

function getInteriorSpawnPoint(model) {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getSize(_size);
  _box.getCenter(_center);

  for (const candidate of BASE_SPAWN_CANDIDATES) {
    const x = _center.x + _size.x * 0.5 * candidate.x;
    const z = _center.z + _size.z * 0.5 * candidate.z;
    const floor = findWalkableFloorAt(model, x, z, _box, _size);
    if (isValidSpawnFloor(model, floor, _box, _size)) return floor;
  }

  // Balayage du périmètre intérieur — évite le centre (fosse/cadre).
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const radius = 0.34;
    const x = _center.x + Math.cos(angle) * _size.x * 0.5 * radius;
    const z = _center.z + Math.sin(angle) * _size.z * 0.5 * radius;
    const floor = findWalkableFloorAt(model, x, z, _box, _size);
    if (isValidSpawnFloor(model, floor, _box, _size)) return floor;
  }

  const fallbackX = _center.x + _size.x * 0.5 * BASE_SPAWN_CANDIDATES[0].x;
  const fallbackZ = _center.z + _size.z * 0.5 * BASE_SPAWN_CANDIDATES[0].z;
  return new THREE.Vector3(
    fallbackX,
    _box.min.y + Math.max(_size.y * 0.08, 1.2),
    fallbackZ,
  );
}

function getFootprintXZ(model) {
  _box.setFromObject(model);
  _box.getSize(_size);
  return Math.max(_size.x, _size.z);
}

/**
 * Base personnelle — modèle sci-fi neon (Landing Pad + Control Tower intégrés).
 */
export class PlayerBase {
  constructor(playerId) {
    this.playerId = playerId;
    this.mapHalf = BASE_TARGET_SIZE * 0.5 + BASE_MAP_MARGIN;

    this.root = new THREE.Group();
    this.root.name = `PlayerBase_${playerId}`;

    this.base = new THREE.Group();
    this.base.name = 'Base';

    this.spawnPoints = new THREE.Group();
    this.spawnPoints.name = 'SpawnPoints';

    this.interactiveObjects = new THREE.Group();
    this.interactiveObjects.name = 'InteractiveObjects';

    this.npc = new THREE.Group();
    this.npc.name = 'NPC';

    this.missionSelection = new THREE.Group();
    this.missionSelection.name = 'MissionSelection';

    this.equipment = new THREE.Group();
    this.equipment.name = 'Equipment';

    this.root.add(
      this.base,
      this.spawnPoints,
      this.interactiveObjects,
      this.npc,
      this.missionSelection,
      this.equipment,
    );

    this.collisionWorld = new CollisionWorld();
    this.groundMesh = null;
    this.baseScene = null;
    this.floorPickMesh = null;
    this.interiorLights = null;
    this._groundSampler = null;
    this.spawnEntries = [];
    this.debugGroup = null;
    this.loaded = false;
  }

  addSpawnPoint(localPosition, id = 'spawn_main') {
    const marker = createSpawnMarker();
    marker.position.copy(localPosition);
    marker.visible = false;
    this.spawnPoints.add(marker);
    this.spawnEntries.push({ id, position: localPosition.clone(), marker });
    return this.spawnEntries[this.spawnEntries.length - 1];
  }

  placeDefaultSpawns(spawnPoint) {
    this.spawnPoints.clear();
    this.spawnEntries = [];

    const y = spawnPoint.y + 0.12;
    this.addSpawnPoint(new THREE.Vector3(spawnPoint.x, y, spawnPoint.z), 'spawn_main');
    this.addSpawnPoint(new THREE.Vector3(spawnPoint.x + 2, y, spawnPoint.z + 1.5), 'spawn_alt_1');
    this.addSpawnPoint(new THREE.Vector3(spawnPoint.x - 2, y, spawnPoint.z - 1.5), 'spawn_alt_2');
  }

  /** Position monde du spawn intérieur — ne pas recalculer via le terrain extérieur. */
  getInteriorSpawnWorldPosition() {
    return this.getDefaultSpawnWorldPosition();
  }

  getDefaultSpawnWorldPosition() {
    const entry = this.spawnEntries.find((s) => s.id === 'spawn_main') ?? this.spawnEntries[0];
    if (!entry) return new THREE.Vector3(0, 0.2, 0);
    const world = entry.position.clone();
    this.spawnPoints.localToWorld(world);
    return world;
  }

  resolveSpawnHeight(worldPos, terrainRoots) {
    worldPos.y = sampleTerrainHeightAtFeet(worldPos.x, worldPos.y + 2, worldPos.z, terrainRoots);
    return worldPos;
  }

  getWalkRoots() {
    const roots = [];
    if (this.floorPickMesh) roots.push(this.floorPickMesh);
    if (this.baseScene) roots.push(this.baseScene);
    return roots;
  }

  getGroundSampler() {
    if (!this._groundSampler) {
      this._groundSampler = new GroundSampler({ mode: 'mesh', roots: this.getWalkRoots() });
    }
    this._groundSampler.setRoots(this.getWalkRoots());
    return this._groundSampler;
  }

  /** @deprecated utiliser getWalkRoots */
  getTerrainRoots() {
    return this.getWalkRoots();
  }

  createDebugGroup() {
    const group = new THREE.Group();
    group.name = 'base-debug';
    group.add(this.collisionWorld.createDebugGroup());

    const spawnDebug = new THREE.Group();
    spawnDebug.name = 'spawn-debug';
    for (const entry of this.spawnEntries) {
      const clone = entry.marker.clone();
      clone.visible = true;
      clone.position.copy(entry.position);
      spawnDebug.add(clone);
    }
    group.add(spawnDebug);

    this.debugGroup = group;
    return group;
  }

  setDebugVisible(visible) {
    if (this.debugGroup) this.debugGroup.visible = visible;
  }

  async load() {
    const model = await loadNeonBaseModel();
    alignOnGround(model);

    this.baseScene = model;
    this.base.add(model);

    const footprint = getFootprintXZ(model);
    this.mapHalf = footprint * 0.5 + BASE_MAP_MARGIN;
    const groundSize = footprint + BASE_GROUND_MARGIN;
    this.groundMesh = createMarsTerrain(new THREE.Vector3(0, 0, 0), groundSize);
    this.groundMesh.name = 'MarsTerrain';
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.root.add(this.groundMesh);

    this.base.updateMatrixWorld(true);
    const spawnWorld = getInteriorSpawnPoint(model);
    const spawnLocal = spawnWorld.clone();
    this.spawnPoints.worldToLocal(spawnLocal);

    // Murs verticaux + surfaces marchables (marches, ponts) séparés.
    this.collisionWorld.addStaticFromObject(model, { wallsOnly: true });
    const floorCollider = this.collisionWorld.addStaticFromObject(model, { floorsOnly: true });
    if (floorCollider) {
      this.floorPickMesh = new THREE.Mesh(
        floorCollider.geometry,
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      this.floorPickMesh.name = 'FloorPicker';
      this.root.add(this.floorPickMesh);
    }
    this.interiorLights = createInteriorLighting(model);
    this.base.add(this.interiorLights);
    this.placeDefaultSpawns(spawnLocal);

    this.collisionWorld.finalize();
    this._groundSampler = null;

    this.root.updateMatrixWorld(true);
    this.loaded = true;
    return this;
  }

  dispose() {
    this.root.removeFromParent();
    this.groundMesh?.geometry?.dispose();
    this.groundMesh?.material?.dispose();
    this.floorPickMesh?.material?.dispose();
    this.floorPickMesh = null;

    if (this.interiorLights) {
      this.interiorLights.traverse((child) => {
        if (child.isLight) child.dispose?.();
      });
      this.interiorLights = null;
    }

    for (const collider of this.collisionWorld.staticColliders) {
      collider.geometry?.dispose();
    }
    this.collisionWorld.staticColliders.length = 0;
    for (const collider of this.collisionWorld.floorColliders) {
      collider.geometry?.dispose();
    }
    this.collisionWorld.floorColliders.length = 0;
    this.collisionWorld.dynamicEntries.length = 0;
    this._groundSampler = null;
    this.loaded = false;
  }
}
