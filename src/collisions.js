import * as THREE from 'three';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';

const _box = new THREE.Box3();
const _sample = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _cpResult = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/**
 * Hauteurs d'échantillonnage de la capsule joueur (pieds → tête, pour 1.8 m).
 * Espacées de moins de 2×rayon pour ne laisser aucun trou vertical.
 */
const CAPSULE_SAMPLE_HEIGHTS = [0.3, 0.85, 1.4];

/** Hauteur max franchissable à pied sans sauter (marches, murets). */
const LOW_LEDGE_MAX_HEIGHT = 0.9;

const SPATIAL_CELL = 14;
const STATIC_RESOLVE_PASSES = 2;
const MAX_MOVE_SUBSTEPS = 5;

/**
 * Seuil de marchabilité : cos de l'angle de pente max (aligné sur
 * MAX_CLIMB_ANGLE ≈ 56° du jeu). normale.y >= seuil → pente marchable,
 * normale.y < seuil → paroi bloquante.
 */
export const WALKABLE_NORMAL_Y = 0.55;

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Ne garde que les triangles raides (parois/falaises) d'une géométrie monde.
 * Les triangles marchables (dessus des plateaux, pentes douces) sont exclus :
 * ils sont gérés par le raycast terrain, pas par la collision horizontale.
 */
export function filterSteepTriangles(geometry, maxWalkableNormalY = WALKABLE_NORMAL_Y) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const kept = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _va.fromBufferAttribute(pos, i0);
    _vb.fromBufferAttribute(pos, i1);
    _vc.fromBufferAttribute(pos, i2);

    _e1.subVectors(_vb, _va);
    _e2.subVectors(_vc, _va);
    _n.crossVectors(_e1, _e2);
    const len = _n.length();
    if (len < 1e-10) continue;

    // Pente marchable (normale presque verticale) → pas de collision murale.
    if (_n.y / len >= maxWalkableNormalY) continue;

    kept.push(
      _va.x, _va.y, _va.z,
      _vb.x, _vb.y, _vb.z,
      _vc.x, _vc.y, _vc.z,
    );
  }

  if (kept.length === 0) return null;

  const filtered = new THREE.BufferGeometry();
  filtered.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  return filtered;
}

/**
 * Ne garde que les parois quasi verticales (murs).
 * Exclut sols et plafonds — utile pour les bâtiments creux où le joueur
 * marche à l'intérieur (hauteur via raycast terrain, pas collision horizontale).
 */
export function filterWallTriangles(geometry, maxHorizontalNormalY = 0.42) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const kept = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _va.fromBufferAttribute(pos, i0);
    _vb.fromBufferAttribute(pos, i1);
    _vc.fromBufferAttribute(pos, i2);

    _e1.subVectors(_vb, _va);
    _e2.subVectors(_vc, _va);
    _n.crossVectors(_e1, _e2);
    const len = _n.length();
    if (len < 1e-10) continue;

    if (Math.abs(_n.y / len) >= maxHorizontalNormalY) continue;

    kept.push(
      _va.x, _va.y, _va.z,
      _vb.x, _vb.y, _vb.z,
      _vc.x, _vc.y, _vc.z,
    );
  }

  if (kept.length === 0) return null;

  const filtered = new THREE.BufferGeometry();
  filtered.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  return filtered;
}

/**
 * Ne garde que les surfaces marchables (sols, marches, ponts).
 * Exclut murs verticaux et plafonds (normale vers le bas).
 */
export function filterFloorTriangles(geometry, minWalkableNormalY = 0.45) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const kept = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _va.fromBufferAttribute(pos, i0);
    _vb.fromBufferAttribute(pos, i1);
    _vc.fromBufferAttribute(pos, i2);

    _e1.subVectors(_vb, _va);
    _e2.subVectors(_vc, _va);
    _n.crossVectors(_e1, _e2);
    const len = _n.length();
    if (len < 1e-10) continue;

    if (_n.y / len < minWalkableNormalY) continue;

    kept.push(
      _va.x, _va.y, _va.z,
      _vb.x, _vb.y, _vb.z,
      _vc.x, _vc.y, _vc.z,
    );
  }

  if (kept.length === 0) return null;

  const filtered = new THREE.BufferGeometry();
  filtered.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  filtered.computeVertexNormals();
  return filtered;
}

function getTriangleNormal(geometry, faceIndex, target) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const i0 = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const i1 = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const i2 = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

  _va.fromBufferAttribute(pos, i0);
  _vb.fromBufferAttribute(pos, i1);
  _vc.fromBufferAttribute(pos, i2);

  _e1.subVectors(_vb, _va);
  _e2.subVectors(_vc, _va);
  return target.crossVectors(_e1, _e2).normalize();
}

function getTriangleYRange(geometry, faceIndex) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const i0 = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const i1 = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const i2 = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

  _va.fromBufferAttribute(pos, i0);
  _vb.fromBufferAttribute(pos, i1);
  _vc.fromBufferAttribute(pos, i2);

  return {
    minY: Math.min(_va.y, _vb.y, _vc.y),
    maxY: Math.max(_va.y, _vb.y, _vc.y),
  };
}

/** Marche / muret bas — franchissable sans bloquer horizontalement. */
function isLowClimbableLedge(geometry, faceIndex, feetY) {
  getTriangleNormal(geometry, faceIndex, _n);
  if (Math.abs(_n.y) >= 0.42) return false;

  const { minY, maxY } = getTriangleYRange(geometry, faceIndex);
  const top = maxY - feetY;
  const bottom = minY - feetY;
  return top > 0.02 && top <= LOW_LEDGE_MAX_HEIGHT + 0.12 && bottom >= -0.3;
}

function buildSpatialGrid(colliders, cellSize = SPATIAL_CELL) {
  const grid = new Map();
  for (const collider of colliders) {
    const box = collider.box;
    const minCx = Math.floor(box.min.x / cellSize);
    const maxCx = Math.floor(box.max.x / cellSize);
    const minCz = Math.floor(box.min.z / cellSize);
    const maxCz = Math.floor(box.max.z / cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(collider);
      }
    }
  }
  return grid;
}

function querySpatialGrid(grid, x, z, radius, cellSize = SPATIAL_CELL) {
  if (!grid || grid.size === 0) return null;

  const minCx = Math.floor((x - radius) / cellSize);
  const maxCx = Math.floor((x + radius) / cellSize);
  const minCz = Math.floor((z - radius) / cellSize);
  const maxCz = Math.floor((z + radius) / cellSize);
  const seen = new Set();
  const result = [];

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const bucket = grid.get(`${cx},${cz}`);
      if (!bucket) continue;
      for (const collider of bucket) {
        if (seen.has(collider)) continue;
        seen.add(collider);
        result.push(collider);
      }
    }
  }

  return result;
}

/**
 * Construit un collider mesh précis pour tout un objet :
 * géométrie fusionnée en espace monde (position/rotation/scale appliqués) + BVH.
 * Aucune marge ajoutée — la hitbox est exactement la surface visible.
 *
 * Options :
 * - steepOnly : ne garder que les parois raides (terrain marchable type
 *   montagne — les pentes douces restent gérées par le raycast terrain).
 * - wallsOnly : ne garder que les murs verticaux (bâtiments intérieurs —
 *   sols/plafonds exclus, marche via raycast terrain).
 * - floorsOnly : surfaces horizontales (marches, ponts, sols) pour le raycast sol.
 */
export function buildMeshCollider(object, { steepOnly = false, wallsOnly = false, floorsOnly = false } = {}) {
  object.updateMatrixWorld(true);

  const generator = new StaticGeometryGenerator(object);
  generator.attributes = ['position'];
  let geometry = generator.generate();

  if (!geometry.attributes.position || geometry.attributes.position.count === 0) {
    return null;
  }

  if (steepOnly) {
    const filtered = filterSteepTriangles(geometry);
    geometry.dispose();
    if (!filtered) return null;
    geometry = filtered;
  } else if (wallsOnly) {
    const filtered = filterWallTriangles(geometry);
    geometry.dispose();
    if (!filtered) return null;
    geometry = filtered;
  } else if (floorsOnly) {
    const filtered = filterFloorTriangles(geometry);
    geometry.dispose();
    if (!filtered) return null;
    geometry = filtered;
  }

  const bvh = new MeshBVH(geometry, { maxLeafSize: 8 });
  const box = new THREE.Box3();
  bvh.getBoundingBox(box);

  return { bvh, geometry, box, steepOnly, wallsOnly, floorsOnly };
}

function pushCircleOutOfBox(px, pz, radius, box) {
  const closestX = THREE.MathUtils.clamp(px, box.minX, box.maxX);
  const closestZ = THREE.MathUtils.clamp(pz, box.minZ, box.maxZ);

  let dx = px - closestX;
  let dz = pz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) return null;

  if (distSq < 1e-8) {
    const penLeft = px - box.minX;
    const penRight = box.maxX - px;
    const penFront = pz - box.minZ;
    const penBack = box.maxZ - pz;
    const minPen = Math.min(penLeft, penRight, penFront, penBack);

    if (minPen === penLeft) return { x: box.minX - radius, z: pz };
    if (minPen === penRight) return { x: box.maxX + radius, z: pz };
    if (minPen === penFront) return { x: px, z: box.minZ - radius };
    return { x: px, z: box.maxZ + radius };
  }

  const dist = Math.sqrt(distSq);
  const push = radius - dist;
  return {
    x: px + (dx / dist) * push,
    z: pz + (dz / dist) * push,
  };
}

export function buildSimpleColliderFromObject(root, margin = 0.08) {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);

  return {
    minX: _box.min.x - margin,
    maxX: _box.max.x + margin,
    minZ: _box.min.z - margin,
    maxZ: _box.max.z + margin,
    minY: _box.min.y,
    maxY: _box.max.y + margin,
  };
}

function blocksHorizontally(box, feetY, clearance = 0.15) {
  return feetY < box.maxY - clearance;
}

export function resolveMovement(x, z, dx, dz, colliders, radius, mapHalf, feetY = 0) {
  let nx = THREE.MathUtils.clamp(x + dx, -mapHalf, mapHalf);
  let nz = THREE.MathUtils.clamp(z + dz, -mapHalf, mapHalf);

  for (let pass = 0; pass < 6; pass++) {
    let corrected = false;

    for (const box of colliders) {
      if (!blocksHorizontally(box, feetY)) continue;

      const out = pushCircleOutOfBox(nx, nz, radius, box);
      if (!out) continue;
      nx = out.x;
      nz = out.z;
      corrected = true;
    }

    nx = THREE.MathUtils.clamp(nx, -mapHalf, mapHalf);
    nz = THREE.MathUtils.clamp(nz, -mapHalf, mapHalf);

    if (!corrected) break;
  }

  return { x: nx, z: nz };
}

export class CollisionWorld {
  constructor() {
    this.staticColliders = [];
    this.floorColliders = [];
    this.dynamicEntries = [];
    this._spatialGrid = null;
    this._dynamicCache = null;
    this._dynamicCacheFrame = -1;
    this._dynamicCacheExclude = null;
  }

  finalize() {
    this._spatialGrid = buildSpatialGrid(this.staticColliders);
  }

  _getNearbyStaticColliders(x, z, radius) {
    if (this._spatialGrid) {
      const nearby = querySpatialGrid(this._spatialGrid, x, z, radius + 2);
      if (nearby) return nearby;
    }
    return this.staticColliders;
  }

  /**
   * Obstacle fixe — collider mesh exact (BVH), zéro padding.
   * options.steepOnly : pour le terrain marchable (montagnes), ne bloquer
   * que les parois raides et laisser les pentes douces au raycast terrain.
   */
  addStaticFromObject(object, options = {}) {
    const collider = buildMeshCollider(object, options);
    if (!collider) return null;
    collider.sourceObject = object;
    collider.buildOptions = options;
    if (options.floorsOnly) {
      this.floorColliders.push(collider);
    } else {
      this.staticColliders.push(collider);
      this._spatialGrid = null;
    }
    return collider;
  }

  removeStaticFromObject(object) {
    let idx = this.staticColliders.findIndex((c) => c.sourceObject === object);
    if (idx >= 0) {
      const [removed] = this.staticColliders.splice(idx, 1);
      removed.geometry?.dispose();
      return removed;
    }
    idx = this.floorColliders.findIndex((c) => c.sourceObject === object);
    if (idx < 0) return false;
    const [removed] = this.floorColliders.splice(idx, 1);
    removed.geometry?.dispose();
    return removed;
  }

  refreshStaticFromObject(object) {
    const removed = this.removeStaticFromObject(object);
    return this.addStaticFromObject(object, removed ? removed.buildOptions : {});
  }

  /** Entités mobiles (ennemis, joueur…) — une AABB globale recalculée chaque frame */
  addDynamic(object, margin = 0.1) {
    this.dynamicEntries.push({ object, margin });
  }

  removeDynamic(object) {
    const idx = this.dynamicEntries.findIndex((entry) => entry.object === object);
    if (idx >= 0) this.dynamicEntries.splice(idx, 1);
  }

  getDynamicBoxes(excludeObject = null, frameId = 0) {
    if (
      this._dynamicCache
      && this._dynamicCacheFrame === frameId
      && this._dynamicCacheExclude === excludeObject
    ) {
      return this._dynamicCache;
    }

    const boxes = [];
    for (const entry of this.dynamicEntries) {
      if (entry.object === excludeObject) continue;
      boxes.push(buildSimpleColliderFromObject(entry.object, entry.margin));
    }

    this._dynamicCache = boxes;
    this._dynamicCacheFrame = frameId;
    this._dynamicCacheExclude = excludeObject;
    return boxes;
  }

  /**
   * Repousse une capsule (échantillons sphériques multi-hauteurs) hors des
   * surfaces mesh statiques. Distances 3D exactes contre les triangles.
   */
  resolveAgainstStaticMeshes(x, z, radius, feetY, playerHeight = 1.8) {
    if (this.staticColliders.length === 0) return { x, z };

    let px = x;
    let pz = z;
    const heightScale = playerHeight / 1.8;
    const nearby = this._getNearbyStaticColliders(px, pz, radius);

    for (let pass = 0; pass < STATIC_RESOLVE_PASSES; pass++) {
      let corrected = false;

      for (const collider of nearby) {
        const box = collider.box;
        if (collider.floorsOnly) continue;
        if (
          px + radius < box.min.x || px - radius > box.max.x
          || pz + radius < box.min.z || pz - radius > box.max.z
          || feetY > box.max.y || feetY + playerHeight < box.min.y
        ) continue;

        for (const h of CAPSULE_SAMPLE_HEIGHTS) {
          _sample.set(px, feetY + h * heightScale, pz);

          const hit = collider.bvh.closestPointToPoint(_sample, _cpResult, 0, radius);
          if (!hit || hit.distance >= radius) continue;

          if (collider.wallsOnly && hit.faceIndex !== undefined && collider.geometry) {
            if (isLowClimbableLedge(collider.geometry, hit.faceIndex, feetY)) continue;
          }

          _delta.subVectors(_sample, hit.point);

          // Ne repousser que si le joueur est du bon côté du mur (pénétration réelle).
          if (hit.faceIndex !== undefined && collider.geometry) {
            getTriangleNormal(collider.geometry, hit.faceIndex, _n);
            if (_delta.dot(_n) <= 0) continue;
          }

          _delta.y = 0;
          let len = _delta.length();
          if (len < 1e-6) {
            // Aligné verticalement sur un mur/sol : pas de correction horizontale.
            if (collider.wallsOnly || collider.steepOnly) continue;
            _delta.set(px - (box.min.x + box.max.x) * 0.5, 0, pz - (box.min.z + box.max.z) * 0.5);
            len = _delta.length();
            if (len < 1e-6) continue;
          }

          const push = (radius - hit.distance + 0.002) / len;
          px += _delta.x * push;
          pz += _delta.z * push;
          corrected = true;
        }
      }

      if (!corrected) break;
    }

    return { x: px, z: pz };
  }

  /** True si la capsule au point donné touche une surface mesh statique. */
  collidesWithStaticMeshes(x, z, radius, feetY, playerHeight = 1.8) {
    const heightScale = playerHeight / 1.8;
    const nearby = this._getNearbyStaticColliders(x, z, radius);

    for (const collider of nearby) {
      const box = collider.box;
      if (
        x + radius < box.min.x || x - radius > box.max.x
        || z + radius < box.min.z || z - radius > box.max.z
      ) continue;

      for (const h of CAPSULE_SAMPLE_HEIGHTS) {
        _sample.set(x, feetY + h * heightScale, z);
        const hit = collider.bvh.closestPointToPoint(_sample, _cpResult, 0, radius);
        if (hit && hit.distance < radius) return true;
      }
    }

    return false;
  }

  /**
   * True si le point est dans l'emprise au sol (bbox XZ) d'un collider statique.
   * Les mesh colliders étant des surfaces creuses, ce test sert au spawn pour
   * éviter d'apparaître à l'intérieur d'un bâtiment.
   */
  isInsideStaticFootprint(x, z, feetY, playerHeight = 1.8) {
    for (const collider of this.staticColliders) {
      // Terrain (pentes) et murs verticaux seuls : pas un volume fermé.
      if (collider.steepOnly || collider.wallsOnly || collider.floorsOnly) continue;
      const box = collider.box;
      if (
        x >= box.min.x && x <= box.max.x
        && z >= box.min.z && z <= box.max.z
        && feetY < box.max.y && feetY + playerHeight > box.min.y
      ) return true;
    }
    return false;
  }

  /** Cherche la position libre la plus proche (spirale) — pour le spawn. */
  findSafePosition(startX, startZ, radius, feetY, maxSearchRadius = 42, ringStep = 1.4) {
    const isSafe = (x, z) =>
      !this.isInsideStaticFootprint(x, z, feetY)
      && !this.collidesWithStaticMeshes(x, z, radius, feetY);

    if (isSafe(startX, startZ)) {
      return { x: startX, z: startZ };
    }

    for (let r = ringStep; r <= maxSearchRadius; r += ringStep) {
      const count = Math.max(8, Math.ceil((Math.PI * 2 * r) / ringStep));
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const x = startX + Math.cos(a) * r;
        const z = startZ + Math.sin(a) * r;
        if (isSafe(x, z)) {
          return { x, z };
        }
      }
    }

    return { x: startX, z: startZ };
  }

  /**
   * Déplacement avec sous-étapes (anti-tunneling) :
   * AABB dynamiques (entités) puis surfaces mesh statiques exactes.
   */
  resolve(x, z, dx, dz, radius, mapHalf, feetY = 0, excludeObject = null, frameId = 0) {
    const dist = Math.hypot(dx, dz);
    const maxStep = Math.max(0.08, radius * 0.55);
    const steps = Math.max(1, Math.min(MAX_MOVE_SUBSTEPS, Math.ceil(dist / maxStep)));
    const sdx = dx / steps;
    const sdz = dz / steps;

    let px = x;
    let pz = z;
    const dynamicBoxes = this.getDynamicBoxes(excludeObject, frameId);

    for (let i = 0; i < steps; i++) {
      const moved = resolveMovement(px, pz, sdx, sdz, dynamicBoxes, radius, mapHalf, feetY);
      const precise = this.resolveAgainstStaticMeshes(moved.x, moved.z, radius, feetY);
      px = THREE.MathUtils.clamp(precise.x, -mapHalf, mapHalf);
      pz = THREE.MathUtils.clamp(precise.z, -mapHalf, mapHalf);
    }

    return { x: px, z: pz };
  }

  /** Wireframe rouge des colliders exacts — coïncide avec la hitbox réelle. */
  createDebugGroup() {
    const group = new THREE.Group();
    group.name = 'collision-debug';

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff1a1a,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
    });

    for (const collider of this.staticColliders) {
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(collider.geometry),
        edgeMat,
      );
      wire.renderOrder = 1002;
      group.add(wire);
    }

    const floorMat = new THREE.LineBasicMaterial({
      color: 0x22ff88,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
    });
    for (const collider of this.floorColliders) {
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(collider.geometry),
        floorMat,
      );
      wire.renderOrder = 1001;
      group.add(wire);
    }

    return group;
  }
}