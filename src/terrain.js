import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _boxA = new THREE.Box3();
const _boxB = new THREE.Box3();
const raycaster = new THREE.Raycaster();

const WALL_NORMAL_Y = 0.62;
const BODY_CHECK_OFFSETS = [0.35, 0.95, 1.55];

export function sampleTerrainHeight(x, z, terrainRoots) {
  _origin.set(x, 80, z);
  raycaster.set(_origin, _down);
  const hits = raycaster.intersectObjects(terrainRoots, true);
  if (hits.length === 0) return analyticalGroundHeight(x, z);
  return hits[0].point.y;
}

/** Surface sous les pieds — évite de viser le sommet de la montagne depuis le ciel. */
export function sampleTerrainHeightAtFeet(x, feetY, z, terrainRoots) {
  return sampleWalkableSurface(x, feetY, z, terrainRoots, 0.35);
}

const WALK_SAMPLE_OFFSETS_FULL = [
  [0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25],
  [0.18, 0.18], [-0.18, -0.18],
];
const WALK_SAMPLE_OFFSETS_MOVE = [
  [0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25],
];
const WALK_SAMPLE_OFFSETS_SNAP = [[0, 0], [0.2, 0], [-0.2, 0]];

export function getProbeOffsets(probeMode) {
  if (probeMode === 'snap') return WALK_SAMPLE_OFFSETS_SNAP;
  if (probeMode === 'move') return WALK_SAMPLE_OFFSETS_MOVE;
  return WALK_SAMPLE_OFFSETS_FULL;
}

function raycastWalkableAt(x, feetY, z, terrainRoots, maxStepUp, searchDown = null) {
  if (!terrainRoots?.length) return -Infinity;

  const downReach = searchDown ?? (maxStepUp + 0.6);
  const startY = feetY + maxStepUp + 2.5;
  _origin.set(x, startY, z);
  raycaster.set(_origin, _down);
  raycaster.far = downReach + maxStepUp + 4;
  const hits = raycaster.intersectObjects(terrainRoots, true);
  if (hits.length === 0) return -Infinity;

  const minY = feetY - downReach;
  const maxY = feetY + maxStepUp + 0.12;
  let best = -Infinity;

  for (const hit of hits) {
    if (hit.point.y < minY || hit.point.y > maxY) continue;
    if (hit.face) {
      _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (_normal.y < 0.42) continue;
    }
    best = Math.max(best, hit.point.y);
  }

  return best;
}

/** Cherche le support le plus haut sous les pieds (snap au sol / chute). */
function raycastSupportBelow(x, feetY, z, terrainRoots, maxBelow = 18) {
  if (!terrainRoots?.length) return -Infinity;

  const startY = feetY + 2.5;
  _origin.set(x, startY, z);
  raycaster.set(_origin, _down);
  raycaster.far = maxBelow + 4;
  const hits = raycaster.intersectObjects(terrainRoots, true);
  if (hits.length === 0) return -Infinity;

  const minY = feetY - maxBelow;
  let best = -Infinity;

  for (const hit of hits) {
    if (hit.point.y > feetY + 0.4 || hit.point.y < minY) continue;
    if (hit.face) {
      _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (_normal.y < 0.42) continue;
    }
    best = Math.max(best, hit.point.y);
  }

  return best;
}

/**
 * Surface marchable sous un point, avec tolérance de montée (marches, rampes).
 * probeMode: 'full' | 'move' | 'snap' — contrôle le nombre de raycasts.
 */
export function sampleWalkableSurface(x, feetY, z, terrainRoots, maxStepUp = 0.65, probeMode = 'full') {
  if (!terrainRoots?.length) return analyticalGroundHeight(x, z);

  if (probeMode === 'snap') {
    const support = raycastSupportBelow(x, feetY, z, terrainRoots);
    if (support > -Infinity) return support;
  }

  const searchDown = probeMode === 'snap' ? 18 : maxStepUp + 0.6;
  let bestBelow = -Infinity;
  let bestStep = -Infinity;

  for (const [ox, oz] of getProbeOffsets(probeMode)) {
    const y = raycastWalkableAt(x + ox, feetY, z + oz, terrainRoots, maxStepUp, searchDown);
    if (y <= feetY + 0.25 && y >= feetY - searchDown) bestBelow = Math.max(bestBelow, y);
    if (y > feetY + 0.02 && y <= feetY + maxStepUp + 0.1) bestStep = Math.max(bestStep, y);
  }

  if (bestStep > feetY + 0.03 && bestStep >= bestBelow - 0.05) return bestStep;
  if (bestBelow > -Infinity) return bestBelow;
  if (bestStep > -Infinity) return bestStep;

  const fallback = raycastSupportBelow(x, feetY, z, terrainRoots);
  return fallback > -Infinity ? fallback : feetY;
}

/** Bloque le mouvement horizontal contre les parois raides des collines (saut inclus). */
export function sweepMovementAgainstHills(x, z, feetY, dx, dz, hillsGroup, radius) {
  if (!hillsGroup || (dx === 0 && dz === 0)) return { x: x + dx, z: z + dz };

  let cx = x;
  let cz = z;
  let rdx = dx;
  let rdz = dz;

  for (let step = 0; step < 5; step++) {
    const dist = Math.sqrt(rdx * rdx + rdz * rdz);
    if (dist < 1e-6) break;

    _dir.set(rdx / dist, 0, rdz / dist);
    let bestT = dist;
    let slideNx = 0;
    let slideNz = 0;
    let blocked = false;

    for (const offset of BODY_CHECK_OFFSETS) {
      _origin.set(cx, feetY + offset, cz);
      raycaster.set(_origin, _dir);
      raycaster.far = dist + radius + 0.2;

      const hits = raycaster.intersectObject(hillsGroup, true);
      for (const hit of hits) {
        if (!hit.face) continue;
        _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_normal.y > WALL_NORMAL_Y) continue;

        const t = hit.distance - radius;
        if (t < bestT) {
          bestT = t;
          slideNx = _normal.x;
          slideNz = _normal.z;
          blocked = true;
        }
      }
    }

    if (!blocked) {
      cx += rdx;
      cz += rdz;
      break;
    }

    const move = Math.max(0, bestT - 0.02);
    cx += _dir.x * move;
    cz += _dir.z * move;

    const remain = dist - move;
    const dot = _dir.x * slideNx + _dir.z * slideNz;
    const sx = _dir.x - slideNx * dot;
    const sz = _dir.z - slideNz * dot;
    const slideLen = Math.sqrt(sx * sx + sz * sz);
    if (slideLen < 1e-4 || remain < 1e-4) break;

    rdx = (sx / slideLen) * remain;
    rdz = (sz / slideLen) * remain;
  }

  return { x: cx, z: cz };
}

/** Repousse le joueur s'il est déjà à l'intérieur d'une colline. */
export function pushOutOfHills(x, z, feetY, hillsGroup, radius) {
  if (!hillsGroup) return { x, z };

  let px = x;
  let pz = z;

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;

    for (let a = 0; a < 12; a++) {
      const angle = (a / 12) * Math.PI * 2;
      _dir.set(Math.cos(angle), 0, Math.sin(angle));

      for (const offset of [0.45, 1.1]) {
        _origin.set(px, feetY + offset, pz);
        raycaster.set(_origin, _dir);
        raycaster.far = radius;
        const outHits = raycaster.intersectObject(hillsGroup, true);
        if (outHits.length > 0 && outHits[0].distance < radius - 0.03) {
          const pen = radius - outHits[0].distance;
          px -= _dir.x * pen;
          pz -= _dir.z * pen;
          moved = true;
        }

        _origin.set(px + _dir.x * (radius + 0.15), feetY + offset, pz + _dir.z * (radius + 0.15));
        _normal.set(-_dir.x, 0, -_dir.z);
        raycaster.set(_origin, _normal);
        raycaster.far = radius + 0.35;
        const inHits = raycaster.intersectObject(hillsGroup, true);
        if (inHits.length > 0 && inHits[0].distance < radius) {
          const pen = radius - inHits[0].distance + 0.04;
          px += _dir.x * pen;
          pz += _dir.z * pen;
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return { x: px, z: pz };
}

/** Hauteur du sol ondulé (même formule que createGround). */
export function analyticalGroundHeight(x, z) {
  const wave = Math.sin(x * 0.15) * Math.cos(z * 0.12) * 0.4;
  const dune = Math.sin((x + z) * 0.08) * 0.6;
  const longWave = Math.sin(x * 0.05 - z * 0.035) * 0.9;
  const ridge = Math.sin(x * 0.028 + z * 0.031) * 0.45;
  return wave + dune + longWave + ridge;
}

function isDescendantOf(child, ancestor) {
  let node = child;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
}

/** True si un rayon vertical touche une colline avant le sol. */
export function isUnderHill(x, z, hillsGroup, groundMesh) {
  _origin.set(x, 80, z);
  raycaster.set(_origin, _down);
  const hits = raycaster.intersectObjects([groundMesh, hillsGroup], true);
  if (hits.length === 0) return false;
  return isDescendantOf(hits[0].object, hillsGroup);
}

function getMeshWorldBounds(object) {
  const box = new THREE.Box3();
  let empty = true;

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    child.updateWorldMatrix(true, false);
    const meshBox = new THREE.Box3().setFromObject(child);
    if (empty) {
      box.copy(meshBox);
      empty = false;
    } else {
      box.union(meshBox);
    }
  });

  return empty ? null : box;
}

/** Aligne la base visible (bbox des meshes) sur la surface. */
export function snapObjectBaseToSurface(object, surfaceRoots, yOffset = 0.02) {
  object.updateMatrixWorld(true);
  const box = getMeshWorldBounds(object);
  if (!box) return;

  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const surfaceY = sampleTerrainHeight(cx, cz, surfaceRoots);
  object.position.y += surfaceY - box.min.y + yOffset;
  object.updateMatrixWorld(true);
}

/** @deprecated conservé si besoin futur — préférer isUnderHill */
export function objectIntersectsGroup(object, group) {
  object.updateMatrixWorld(true);
  _boxA.setFromObject(object);

  let intersects = false;
  group.traverse((child) => {
    if (intersects || !child.isMesh) return;
    _boxB.setFromObject(child);
    if (_boxA.intersectsBox(_boxB)) intersects = true;
  });

  return intersects;
}

export const MAX_STEP_HEIGHT = 0.9;
const SLOPE_LOOKAHEAD = 0.6;

export function limitMovementBySlope(x, z, dx, dz, sampler, maxClimbAngle, feetY = 0) {
  if (dx === 0 && dz === 0) return { dx, dz };

  const h0 = sampler.sample(x, feetY, z, MAX_STEP_HEIGHT, 'move');
  const dist = Math.sqrt(dx * dx + dz * dz);
  const dirX = dx / dist;
  const dirZ = dz / dist;

  const lookDist = Math.max(dist, SLOPE_LOOKAHEAD);
  const h1 = sampler.sample(x + dirX * lookDist, feetY, z + dirZ * lookDist, MAX_STEP_HEIGHT, 'move');

  if (Math.abs(h1 - h0) < 0.04) return { dx, dz };

  if (h1 > h0 + 0.03 && h1 <= h0 + MAX_STEP_HEIGHT + 0.08) {
    return { dx, dz };
  }

  const angle = Math.atan2(h1 - h0, lookDist);
  if (angle <= maxClimbAngle) return { dx, dz };

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 4; i++) {
    const m = (lo + hi) * 0.5;
    const hm = sampler.sample(x + dirX * lookDist * m, feetY, z + dirZ * lookDist * m, MAX_STEP_HEIGHT, 'move');
    const a = Math.atan2(hm - h0, lookDist * m);
    if (a <= maxClimbAngle) lo = m;
    else hi = m;
  }

  return { dx: dx * lo, dz: dz * lo };
}

/**
 * Déplacement au sol avec montée automatique des marches et murets bas.
 */
export function resolveGroundMovement(x, z, feetY, dx, dz, radius, sampler, collisionWorld, mapHalf, player, frameId = 0) {
  const moveDist = Math.hypot(dx, dz);
  if (moveDist < 1e-8) {
    return { x, z, y: sampler.sample(x, feetY, z, MAX_STEP_HEIGHT, 'snap') };
  }

  if (sampler.mode === 'analytical') {
    const resolved = collisionWorld.resolve(x, z, dx, dz, radius, mapHalf, feetY, player, frameId);
    const y = sampler.sample(resolved.x, feetY, resolved.z, 0.35, 'snap');
    return { x: resolved.x, z: resolved.z, y };
  }

  const dirX = dx / moveDist;
  const dirZ = dz / moveDist;

  let stepY = feetY;
  const probes = [0.1, radius + 0.08, radius + moveDist + 0.12];
  for (const pd of probes) {
    const sx = x + dirX * pd;
    const sz = z + dirZ * pd;
    const sy = sampler.sample(sx, feetY, sz, MAX_STEP_HEIGHT, 'move');
    if (sy > stepY + 0.02 && sy <= feetY + MAX_STEP_HEIGHT + 0.08) {
      stepY = Math.max(stepY, sy);
    }
  }

  const endY = sampler.sample(x + dx, feetY, z + dz, MAX_STEP_HEIGHT, 'move');
  if (endY > stepY + 0.02 && endY <= feetY + MAX_STEP_HEIGHT + 0.08) {
    stepY = Math.max(stepY, endY);
  }

  const collisionFeetY = stepY > feetY + 0.03 ? stepY : feetY;
  const resolved = collisionWorld.resolve(x, z, dx, dz, radius, mapHalf, collisionFeetY, player, frameId);
  const finalY = sampler.sample(resolved.x, collisionFeetY, resolved.z, 0.35, 'snap');

  return { x: resolved.x, z: resolved.z, y: finalY };
}
