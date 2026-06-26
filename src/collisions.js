import * as THREE from 'three';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * Boîtes de collision monde par mesh — épouse la forme de chaque élément.
 */
export function buildCollidersFromObject(root, margin = 0.06) {
  const boxes = [];
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    _box.setFromObject(child);
    _box.getSize(_size);

    if (_size.x < 0.04 && _size.z < 0.04) return;
    if (_size.y < 0.02) return;

    boxes.push({
      minX: _box.min.x - margin,
      maxX: _box.max.x + margin,
      minZ: _box.min.z - margin,
      maxZ: _box.max.z + margin,
      minY: _box.min.y,
      maxY: _box.max.y + margin,
    });
  });

  return boxes;
}

function pushCircleOutOfBox(px, pz, radius, box) {
  const closestX = THREE.MathUtils.clamp(px, box.minX, box.maxX);
  const closestZ = THREE.MathUtils.clamp(pz, box.minZ, box.maxZ);

  let dx = px - closestX;
  let dz = pz - closestZ;
  let distSq = dx * dx + dz * dz;

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
    this.staticBoxes = [];
    this.dynamicEntries = [];
  }

  /** Obstacles fixes (bâtiments, collines…) — boîtes par mesh */
  addStaticFromObject(object, margin = 0.06) {
    this.staticBoxes.push(...buildCollidersFromObject(object, margin));
  }

  /** Entités mobiles (ennemis, joueur…) — une AABB globale recalculée chaque frame */
  addDynamic(object, margin = 0.1) {
    this.dynamicEntries.push({ object, margin });
  }

  /** @deprecated utiliser addStaticFromObject */
  addFromObject(object, margin) {
    this.addStaticFromObject(object, margin);
  }

  addFromGroup(group, margin) {
    group.children.forEach((child) => this.addStaticFromObject(child, margin));
  }

  getBoxes(excludeObject = null) {
    const boxes = [...this.staticBoxes];
    for (const entry of this.dynamicEntries) {
      if (entry.object === excludeObject) continue;
      boxes.push(buildSimpleColliderFromObject(entry.object, entry.margin));
    }
    return boxes;
  }

  resolve(x, z, dx, dz, radius, mapHalf, feetY = 0, excludeObject = null) {
    return resolveMovement(x, z, dx, dz, this.getBoxes(excludeObject), radius, mapHalf, feetY);
  }

  createDebugGroup() {
    const group = new THREE.Group();
    group.name = 'collision-debug';

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff1a1a,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const box of this.getBoxes()) {
      const w = box.maxX - box.minX;
      const d = box.maxZ - box.minZ;
      const h = Math.max(box.maxY - box.minY, 0.08);
      const cx = (box.minX + box.maxX) * 0.5;
      const cy = (box.minY + box.maxY) * 0.5;
      const cz = (box.minZ + box.maxZ) * 0.5;

      const boxGeo = new THREE.BoxGeometry(w, h, d);
      const fill = new THREE.Mesh(boxGeo, fillMat);
      fill.position.set(cx, cy, cz);
      fill.renderOrder = 999;

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat);
      edges.position.set(cx, cy, cz);
      edges.renderOrder = 1000;

      group.add(fill, edges);
    }

    return group;
  }
}

export function createPlayerRadiusDebug(radius) {
  const group = new THREE.Group();
  group.name = 'player-collision-debug';

  const points = [];
  const segments = 40;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0.14, Math.sin(a) * radius));
  }

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false }),
  );
  line.renderOrder = 1001;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.12;
  disc.renderOrder = 998;

  group.add(disc, line);
  return group;
}
