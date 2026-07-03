import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CollisionWorld } from './collisions.js';
import { sampleTerrainHeightAtFeet } from './terrain.js';
import { GroundSampler } from './groundSampler.js';
import { loadBaseSkyTexture } from './baseSkyEnvironment.js';
import {
  BASE_NEON_FBX_PATH,
  BASE_NEON_TEXTURE_PATH,
  BASE_TARGET_SIZE,
  BASE_MAP_MARGIN,
  BASE_GROUND_MARGIN,
  BASE_TERRAIN_CUTOUT_MARGIN,
  BASE_GLASS_BRIDGE_INSET,
  BASE_GLASS_BRIDGE_MARGIN,
  BASE_GLASS_BRIDGE_SHRINK,
  BASE_CENTRAL_PIT_SPAN,
  BASE_GLASS_BRIDGE_Y_OFFSET,
  BASE_SPAWN_CANDIDATES,
  BASE_FLOOR_MESH_NAME,
  BASE_FLOOR_TOP_EPSILON,
  BASE_HORIZONTAL_NORMAL_Y,
  BASE_PINK_STAIR_SKIP_MESHES,
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
const _clipVertex = new THREE.Vector3();
const _triA = new THREE.Vector3();
const _triB = new THREE.Vector3();
const _triC = new THREE.Vector3();
const _triAb = new THREE.Vector3();
const _triAc = new THREE.Vector3();
const _triNormal = new THREE.Vector3();

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

  const hemi = new THREE.HemisphereLight(0x99bbff, 0x1a0828, 1.1);
  hemi.position.set(_center.x, midY, _center.z);
  group.add(hemi);

  const fill = new THREE.PointLight(0xaaccff, 2.8, reach * 1.5, 2);
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
  await waitForMeshTextures(model);

  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z);
  const scale = maxDim > 0 ? BASE_TARGET_SIZE / maxDim : 1;
  model.scale.setScalar(scale);
  clipUpperBaseGeometry(model);
  stripPinkAccentStairs(model);

  return model;
}

async function waitForMeshTextures(object) {
  const textures = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (mat?.map) textures.push(mat.map);
    }
  });

  await Promise.all(textures.map((tex) => new Promise((resolve) => {
    if (tex.image?.complete && tex.image?.naturalWidth) {
      resolve();
      return;
    }
    const done = () => resolve();
    tex.addEventListener?.('update', done, { once: true });
    if (tex.image) tex.image.addEventListener('load', done, { once: true });
    setTimeout(done, 4000);
  })));
}

/** Conserve la dalle Reaktor_0 + murs ancrés au sol ; retire escaliers et étages. */
function clipUpperBaseGeometry(model) {
  model.updateMatrixWorld(true);
  const floorTopY = getFloorTopY(model);
  if (!Number.isFinite(floorTopY)) return;

  let clipped = 0;
  model.traverse((child) => {
    if (!child.isMesh || child.name === BASE_FLOOR_MESH_NAME) return;
    if (filterMeshTrianglesAboveFloor(child, floorTopY)) clipped++;
  });

  if (clipped && import.meta.env?.DEV) {
    console.log(`[base] ${clipped} mesh(s) nettoyé(s) — dalle Y≤${floorTopY.toFixed(2)}`);
  }
}

function getFloorTopY(model) {
  let floorTop = -Infinity;
  model.traverse((child) => {
    if (!child.isMesh || child.name !== BASE_FLOOR_MESH_NAME) return;
    child.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(child);
    floorTop = Math.max(floorTop, box.max.y);
  });
  return floorTop;
}

function shouldRemoveTriangleAboveFloor(normalY, minY, maxY, avgY, floorTopY) {
  // Murs ancrés sous la dalle — triangle entier conservé (évite les trous).
  if (minY < floorTopY - BASE_FLOOR_TOP_EPSILON * 2) return false;
  // Marches et dalles horizontales au niveau de la dalle ou au-dessus.
  if (normalY > BASE_HORIZONTAL_NORMAL_Y) return minY >= floorTopY - 0.04;
  // Montants, piliers, faces d'escalier au-dessus de la dalle.
  if (minY >= floorTopY - 0.04) return true;
  // Rampes / escaliers inclinés dont le centre est au-dessus de la dalle.
  if (avgY > floorTopY && maxY > floorTopY + 0.08) return true;
  return false;
}

function isPinkPaletteColor(r, g, b) {
  return r > 0.55 && b > 0.45 && g < 0.45 && (r - g) > 0.2;
}

function createMeshPaletteSampler(mesh) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const image = mat?.map?.image;
  if (!image?.naturalWidth) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const uv = mesh.geometry.attributes.uv;
  if (!uv) return null;

  return {
    sample(vertexIndex) {
      const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(uv.getX(vertexIndex) * canvas.width)));
      const py = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - uv.getY(vertexIndex)) * canvas.height)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      return isPinkPaletteColor(d[0] / 255, d[1] / 255, d[2] / 255);
    },
  };
}

/** Retire uniquement les escaliers voxel noirs à bouts roses (pas les autres escaliers). */
function stripPinkAccentStairs(model) {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  const groundY = _box.min.y;
  const height = _box.max.y - _box.min.y;
  if (height <= 0) return;

  const removalZones = [];

  model.traverse((mesh) => {
    if (!mesh.isMesh || BASE_PINK_STAIR_SKIP_MESHES.has(mesh.name)) return;

    const sampler = createMeshPaletteSampler(mesh);
    if (!sampler) return;

    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position;
    const matrix = mesh.matrixWorld;
    const clusters = new Map();

    for (let i = 0; i < pos.count; i += 3) {
      let hasPink = false;
      for (let j = 0; j < 3; j++) {
        if (sampler.sample(i + j)) {
          hasPink = true;
          break;
        }
      }
      if (!hasPink) continue;

      let minY = Infinity;
      let maxY = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      for (let j = 0; j < 3; j++) {
        _clipVertex.fromBufferAttribute(pos, i + j).applyMatrix4(matrix);
        minY = Math.min(minY, _clipVertex.y);
        maxY = Math.max(maxY, _clipVertex.y);
        minX = Math.min(minX, _clipVertex.x);
        maxX = Math.max(maxX, _clipVertex.x);
        minZ = Math.min(minZ, _clipVertex.z);
        maxZ = Math.max(maxZ, _clipVertex.z);
      }

      const key = `${Math.round(minX / 2)}|${Math.round(minZ / 2)}`;
      const cluster = clusters.get(key) ?? {
        count: 0,
        minY,
        maxY,
        minX,
        maxX,
        minZ,
        maxZ,
      };
      cluster.count++;
      cluster.minY = Math.min(cluster.minY, minY);
      cluster.maxY = Math.max(cluster.maxY, maxY);
      cluster.minX = Math.min(cluster.minX, minX);
      cluster.maxX = Math.max(cluster.maxX, maxX);
      cluster.minZ = Math.min(cluster.minZ, minZ);
      cluster.maxZ = Math.max(cluster.maxZ, maxZ);
      clusters.set(key, cluster);
    }

    for (const cluster of clusters.values()) {
      const ySpan = cluster.maxY - cluster.minY;
      const relMax = (cluster.maxY - groundY) / height;
      if (cluster.count < 10 || ySpan < 0.75 || relMax > 0.32) continue;

      removalZones.push({
        mesh,
        minX: cluster.minX - 1.25,
        maxX: cluster.maxX + 1.25,
        minY: cluster.minY - 0.3,
        maxY: cluster.maxY + 0.3,
        minZ: cluster.minZ - 1.25,
        maxZ: cluster.maxZ + 1.25,
      });
    }
  });

  if (!removalZones.length) return;

  let stripped = 0;
  for (const zone of removalZones) {
    if (filterMeshTrianglesInBox(zone.mesh, zone)) stripped++;
  }

  if (stripped && import.meta.env?.DEV) {
    console.log(`[base] ${removalZones.length} escalier(s) rose(s) retiré(s) sur ${stripped} mesh(s)`);
  }
}

function triangleIntersectsBox(i0, i1, i2, pos, matrix, box) {
  for (const index of [i0, i1, i2]) {
    _clipVertex.fromBufferAttribute(pos, index).applyMatrix4(matrix);
    if (
      _clipVertex.x >= box.minX && _clipVertex.x <= box.maxX &&
      _clipVertex.y >= box.minY && _clipVertex.y <= box.maxY &&
      _clipVertex.z >= box.minZ && _clipVertex.z <= box.maxZ
    ) {
      return true;
    }
  }

  _triA.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
  _triB.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
  _triC.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
  _center.set(
    (_triA.x + _triB.x + _triC.x) / 3,
    (_triA.y + _triB.y + _triC.y) / 3,
    (_triA.z + _triB.z + _triC.z) / 3,
  );
  return (
    _center.x >= box.minX && _center.x <= box.maxX &&
    _center.y >= box.minY && _center.y <= box.maxY &&
    _center.z >= box.minZ && _center.z <= box.maxZ
  );
}

function filterMeshTrianglesInBox(mesh, box) {
  mesh.updateMatrixWorld(true);
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;
  if (!pos) return false;

  const matrix = mesh.matrixWorld;
  const keepTriangle = (i0, i1, i2) => !triangleIntersectsBox(i0, i1, i2, pos, matrix, box);

  if (geom.index) {
    const kept = [];
    const index = geom.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (keepTriangle(a, b, c)) kept.push(a, b, c);
    }
    if (kept.length === index.count) return false;
    if (kept.length === 0) {
      mesh.visible = false;
      return true;
    }
    geom.setIndex(kept);
  } else {
    const keptPos = [];
    const keptUv = [];
    for (let i = 0; i < pos.count; i += 3) {
      if (!keepTriangle(i, i + 1, i + 2)) continue;
      for (let j = 0; j < 3; j++) {
        const vi = i + j;
        keptPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        if (uv) keptUv.push(uv.getX(vi), uv.getY(vi));
      }
    }
    if (keptPos.length === pos.count * 3) return false;
    if (keptPos.length === 0) {
      mesh.visible = false;
      return true;
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(keptPos, 3));
    if (uv) geom.setAttribute('uv', new THREE.Float32BufferAttribute(keptUv, 2));
  }

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return true;
}

function triangleWorldNormal(i0, i1, i2, pos, matrix) {
  _triA.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
  _triB.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
  _triC.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
  _triAb.subVectors(_triB, _triA);
  _triAc.subVectors(_triC, _triA);
  return _triNormal.crossVectors(_triAb, _triAc).normalize().y;
}

function filterMeshTrianglesAboveFloor(mesh, floorTopY) {
  mesh.updateMatrixWorld(true);
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;
  if (!pos) return false;

  const matrix = mesh.matrixWorld;
  const worldY = (index) => _clipVertex.fromBufferAttribute(pos, index).applyMatrix4(matrix).y;

  const keepTriangle = (i0, i1, i2) => {
    const y0 = worldY(i0);
    const y1 = worldY(i1);
    const y2 = worldY(i2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const avgY = (y0 + y1 + y2) / 3;
    const normalY = triangleWorldNormal(i0, i1, i2, pos, matrix);
    return !shouldRemoveTriangleAboveFloor(normalY, minY, maxY, avgY, floorTopY);
  };

  if (geom.index) {
    const kept = [];
    const index = geom.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (keepTriangle(a, b, c)) kept.push(a, b, c);
    }
    if (kept.length === index.count) return false;
    if (kept.length === 0) {
      mesh.visible = false;
      return true;
    }
    geom.setIndex(kept);
  } else {
    const keptPos = [];
    const keptUv = [];
    for (let i = 0; i < pos.count; i += 3) {
      if (!keepTriangle(i, i + 1, i + 2)) continue;
      for (let j = 0; j < 3; j++) {
        const vi = i + j;
        keptPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        if (uv) keptUv.push(uv.getX(vi), uv.getY(vi));
      }
    }
    if (keptPos.length === pos.count * 3) return false;
    if (keptPos.length === 0) {
      mesh.visible = false;
      return true;
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(keptPos, 3));
    if (uv) geom.setAttribute('uv', new THREE.Float32BufferAttribute(keptUv, 2));
  }

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return true;
}

function cutTerrainUnderFootprint(geo, cutoutRadius) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const keptPos = [];
  const keptUv = [];

  for (let i = 0; i < pos.count; i += 3) {
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < 3; j++) {
      cx += pos.getX(i + j);
      cy += pos.getY(i + j);
    }
    cx /= 3;
    cy /= 3;
    if (Math.hypot(cx, cy) < cutoutRadius) continue;

    for (let j = 0; j < 3; j++) {
      const vi = i + j;
      keptPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      if (uv) keptUv.push(uv.getX(vi), uv.getY(vi));
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(keptPos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(keptUv, 2));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function createMarsTerrain(flatCenter, groundSize, cutoutRadius = 0) {
  const geo = new THREE.PlaneGeometry(groundSize, groundSize, 44, 44);
  const positions = geo.attributes.position;
  const padR = groundSize * 0.38;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);

    const dist = Math.hypot(x - flatCenter.x, y - flatCenter.z);
    const hillFalloff = THREE.MathUtils.smoothstep(dist, padR * 0.55, padR * 1.15);
    const dunes = Math.sin(x * 0.12) * Math.cos(y * 0.1) * 0.45 * hillFalloff;
    const ridge = Math.sin((x + y) * 0.045) * 0.3 * hillFalloff;
    const flatBase = Math.exp(-(dist ** 2) / (padR * padR)) * 1.1;

    positions.setZ(i, dunes + ridge - flatBase);
  }

  if (cutoutRadius > 0) cutTerrainUnderFootprint(geo, cutoutRadius);

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

function placeTerrainBelowBase(terrain, baseBottomY = 0, gap = 0.45) {
  terrain.updateMatrixWorld(true);
  _box.setFromObject(terrain);
  terrain.position.y = baseBottomY - _box.max.y - gap;
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

/** Vide central (carré intérieur) — zone sans dalle marchable au niveau du sol. */
function measureCentralPitBounds(model, floorTopY) {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getCenter(_center);
  _box.getSize(_size);
  if (_size.x < 1 || _size.z < 1) return null;

  const grid = 56;
  const span = 0.58;
  const cells = Array.from({ length: grid }, () => Array(grid));

  for (let ix = 0; ix < grid; ix++) {
    for (let iz = 0; iz < grid; iz++) {
      const x = _center.x + (ix / (grid - 1) - 0.5) * _size.x * span;
      const z = _center.z + (iz / (grid - 1) - 0.5) * _size.z * span;
      cells[ix][iz] = { x, z, ...classifyPitCell(model, x, z, floorTopY) };
    }
  }

  const startI = Math.floor(grid / 2);
  const startJ = Math.floor(grid / 2);
  if (!cells[startI][startJ].lacksWalkway) return null;

  const visited = new Set();
  const queue = [[startI, startJ]];
  visited.add(`${startI},${startJ}`);

  let pitMinX = Infinity;
  let pitMaxX = -Infinity;
  let pitMinZ = Infinity;
  let pitMaxZ = -Infinity;
  let pitCells = 0;

  while (queue.length > 0) {
    const [ix, iz] = queue.pop();
    const cell = cells[ix][iz];
    if (!cell.lacksWalkway) continue;

    pitCells++;
    pitMinX = Math.min(pitMinX, cell.x);
    pitMaxX = Math.max(pitMaxX, cell.x);
    pitMinZ = Math.min(pitMinZ, cell.z);
    pitMaxZ = Math.max(pitMaxZ, cell.z);

    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ix + di;
      const nj = iz + dj;
      if (ni < 0 || nj < 0 || ni >= grid || nj >= grid) continue;
      const key = `${ni},${nj}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push([ni, nj]);
    }
  }

  if (pitCells < 6) return null;

  return buildPitBounds(pitMinX, pitMaxX, pitMinZ, pitMaxZ, floorTopY);
}

/** Repli : carré central proportionnel à la bbox du modèle. */
function estimateCentralPitBounds(model, floorTopY) {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getCenter(_center);
  _box.getSize(_size);

  const w = _size.x * BASE_CENTRAL_PIT_SPAN;
  const d = _size.z * BASE_CENTRAL_PIT_SPAN;
  return buildPitBounds(
    _center.x - w * 0.5,
    _center.x + w * 0.5,
    _center.z - d * 0.5,
    _center.z + d * 0.5,
    floorTopY,
  );
}

function buildPitBounds(pitMinX, pitMaxX, pitMinZ, pitMaxZ, floorTopY) {
  const width = pitMaxX - pitMinX;
  const depth = pitMaxZ - pitMinZ;
  const shrinkX = width * BASE_GLASS_BRIDGE_SHRINK + BASE_GLASS_BRIDGE_INSET;
  const shrinkZ = depth * BASE_GLASS_BRIDGE_SHRINK + BASE_GLASS_BRIDGE_INSET;

  pitMinX += shrinkX;
  pitMaxX -= shrinkX;
  pitMinZ += shrinkZ;
  pitMaxZ -= shrinkZ;
  if (pitMaxX <= pitMinX || pitMaxZ <= pitMinZ) return null;

  return {
    minX: pitMinX,
    maxX: pitMaxX,
    minZ: pitMinZ,
    maxZ: pitMaxZ,
    centerX: (pitMinX + pitMaxX) * 0.5,
    centerZ: (pitMinZ + pitMaxZ) * 0.5,
    width: pitMaxX - pitMinX,
    depth: pitMaxZ - pitMinZ,
    y: floorTopY,
  };
}

function resolveCentralPitBounds(model, floorTopY) {
  const measured = measureCentralPitBounds(model, floorTopY);
  if (measured) return measured;

  const estimated = estimateCentralPitBounds(model, floorTopY);
  if (estimated) return estimated;

  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  _box.getCenter(_center);
  _box.getSize(_size);
  const w = Math.max(_size.x * 0.2, 4);
  const d = Math.max(_size.z * 0.2, 4);
  return {
    minX: _center.x - w * 0.5,
    maxX: _center.x + w * 0.5,
    minZ: _center.z - d * 0.5,
    maxZ: _center.z + d * 0.5,
    centerX: _center.x,
    centerZ: _center.z,
    width: w,
    depth: d,
    y: floorTopY,
  };
}

/** True si aucune surface marchable au niveau de la dalle (piliers en dessous ignorés). */
function classifyPitCell(model, x, z, floorTopY) {
  _rayOrigin.set(x, floorTopY + 6, z);
  _ray.set(_rayOrigin, _rayDir);
  _ray.far = 16;

  let hasWalkway = false;

  for (const hit of _ray.intersectObject(model, true)) {
    if (!hit.face) continue;
    const normalY = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y;
    if (normalY < 0.65) continue;

    if (hit.point.y >= floorTopY - 0.12 && hit.point.y <= floorTopY + 0.3) {
      hasWalkway = true;
      break;
    }
  }

  return { hasWalkway, lacksWalkway: !hasWalkway };
}

function createCentralGlassBridge(bounds) {
  const group = new THREE.Group();
  group.name = 'CentralGlassBridge';

  const width = Math.max(bounds.width, 2);
  const depth = Math.max(bounds.depth, 2);
  const geometry = new THREE.PlaneGeometry(width, depth);

  const material = new THREE.MeshStandardMaterial({
    color: 0xb8e8ff,
    emissive: 0x33aacc,
    emissiveIntensity: 0.22,
    metalness: 0.35,
    roughness: 0.04,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  new THREE.TextureLoader().load(
    `${BASE_NEON_TEXTURE_PATH}glass.png`,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, width / 5), Math.max(1, depth / 5));
      material.map = tex;
      material.needsUpdate = true;
    },
    undefined,
    () => {},
  );

  const plate = new THREE.Mesh(geometry, material);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(bounds.centerX, bounds.y + BASE_GLASS_BRIDGE_Y_OFFSET, bounds.centerZ);
  plate.receiveShadow = true;
  plate.castShadow = false;
  plate.renderOrder = 6;
  group.add(plate);

  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const edgeH = 0.06;
  const edgeT = 0.1;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const y = bounds.y + BASE_GLASS_BRIDGE_Y_OFFSET + 0.01;

  const edges = [
    [width + edgeT * 2, edgeH, edgeT, bounds.centerX, y, bounds.centerZ - halfD - edgeT * 0.5],
    [width + edgeT * 2, edgeH, edgeT, bounds.centerX, y, bounds.centerZ + halfD + edgeT * 0.5],
    [edgeT, edgeH, depth + edgeT * 2, bounds.centerX - halfW - edgeT * 0.5, y, bounds.centerZ],
    [edgeT, edgeH, depth + edgeT * 2, bounds.centerX + halfW + edgeT * 0.5, y, bounds.centerZ],
  ];

  for (const [ew, eh, ed, ex, ey, ez] of edges) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, ed), edgeMat);
    edge.position.set(ex, ey, ez);
    edge.renderOrder = 7;
    group.add(edge);
  }

  return group;
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
    this.glassBridge = null;
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
    if (this.glassBridge) roots.push(this.glassBridge);
    return roots;
  }

  getGroundSampler() {
    if (!this._groundSampler) {
      this._groundSampler = new GroundSampler({
        mode: 'bvh',
        collisionWorld: this.collisionWorld,
      });
    }
    this._groundSampler.setCollisionWorld(this.collisionWorld);
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
    await loadBaseSkyTexture();

    const model = await loadNeonBaseModel();
    alignOnGround(model);

    this.baseScene = model;
    this.base.add(model);

    const footprint = getFootprintXZ(model);
    this.mapHalf = footprint * 0.5 + BASE_MAP_MARGIN;
    const groundSize = footprint + BASE_GROUND_MARGIN;
    const terrainCutout = footprint * 0.5 + BASE_TERRAIN_CUTOUT_MARGIN;
    this.groundMesh = createMarsTerrain(new THREE.Vector3(0, 0, 0), groundSize, terrainCutout);
    this.groundMesh.name = 'MarsTerrain';
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.groundMesh.castShadow = false;
    this.groundMesh.renderOrder = -10;
    this.root.add(this.groundMesh);
    placeTerrainBelowBase(this.groundMesh);

    this.base.updateMatrixWorld(true);
    const spawnWorld = getInteriorSpawnPoint(model);
    const spawnLocal = spawnWorld.clone();
    this.spawnPoints.worldToLocal(spawnLocal);

    // Murs verticaux + surfaces marchables (marches, ponts) séparés.
    this.collisionWorld.addStaticFromObject(model, { wallsOnly: true });
    this.collisionWorld.addStaticFromObject(model, { floorsOnly: true });

    const floorTopY = getFloorTopY(model);
    const pitBounds = resolveCentralPitBounds(model, floorTopY);
    if (pitBounds) {
      this.glassBridge = createCentralGlassBridge(pitBounds);
      this.base.add(this.glassBridge);
      this.collisionWorld.addStaticFromObject(this.glassBridge, { floorsOnly: true });
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
    this.glassBridge?.traverse((child) => {
      child.geometry?.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    this.glassBridge = null;

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
