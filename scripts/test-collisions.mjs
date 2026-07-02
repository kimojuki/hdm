// Test hors-navigateur du moteur de collision : charge un bâtiment FBX réel,
// construit son collider mesh et vérifie repoussement/traversée/alignement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CollisionWorld, WALKABLE_NORMAL_Y } from '../src/collisions.js';

// Stub DOM minimal pour que FBXLoader puisse "charger" les textures sous Node.
globalThis.document = {
  createElementNS: () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {},
  }),
};
globalThis.self = globalThis;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FBX_DIR = path.resolve(__dirname, '../assets/batiment/map1/fbx');
const MOUNTAIN_DIR = path.resolve(__dirname, '../assets/environement/montagne/Fbx');

function loadFbx(file, dir = FBX_DIR) {
  const buffer = fs.readFileSync(path.join(dir, file));
  const loader = new FBXLoader();
  return loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const RADIUS = 0.42;

for (const file of ['Main_house_3lv.fbx', 'Section.fbx', 'Solar_panel.fbx']) {
  console.log(`\n=== ${file} ===`);
  const model = loadFbx(file);
  model.scale.setScalar(0.01);
  model.rotation.y = Math.PI * 0.3;
  model.position.set(5, 0, -3);
  model.updateMatrixWorld(true);

  const world = new CollisionWorld();
  world.addStaticFromObject(model);
  check('collider créé', world.staticColliders.length === 1);

  const { box, bvh } = world.staticColliders[0];
  const size = new THREE.Vector3();
  box.getSize(size);
  const visBox = new THREE.Box3().setFromObject(model, true); // precise = triangles réels
  const visSize = new THREE.Vector3();
  visBox.getSize(visSize);
  const diff = Math.max(
    Math.abs(size.x - visSize.x),
    Math.abs(size.y - visSize.y),
    Math.abs(size.z - visSize.z),
  );
  check('bbox collider = bbox visuelle précise (transformations OK)', diff < 1e-3, `écart max ${diff.toExponential(2)}`);

  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;

  // 1. Un point posé sur la surface réelle du mesh doit être en collision.
  const surf = bvh.closestPointToPoint(
    new THREE.Vector3(box.max.x + 1, 0.9, cz),
    { point: new THREE.Vector3(), distance: 0, faceIndex: 0 },
  );
  const onWall = world.collidesWithStaticMeshes(surf.point.x, surf.point.z, RADIUS, 0);
  check('point sur la surface du mur = collision détectée', onWall);

  // 2. Un point loin dehors ne doit pas être repoussé (aucune hitbox fantôme).
  const farX = box.max.x + 6;
  const far = world.resolveAgainstStaticMeshes(farX, cz, RADIUS, 0);
  check('point éloigné non modifié (pas de padding)', far.x === farX && far.z === cz);

  // 3. Marche vers le bâtiment : jamais enfoncé dans le mesh (glisser le long
  //    des murs est permis, pénétrer non).
  let px = box.max.x + 2;
  let pz = cz;
  let penetrated = false;
  for (let i = 0; i < 200; i++) {
    const r = world.resolve(px, pz, -0.12, 0, RADIUS, 100, 0);
    px = r.x;
    pz = r.z;
    if (world.collidesWithStaticMeshes(px, pz, RADIUS * 0.5, 0)) penetrated = true;
  }
  check('marche : jamais enfoncé dans le mesh', !penetrated, `position finale x=${px.toFixed(2)}`);

  // 4. Sprint rapide (grands pas) : anti-tunneling, jamais dans le mesh.
  let sx = box.max.x + 3;
  let sz = cz;
  let sprintPenetrated = false;
  for (let i = 0; i < 60; i++) {
    const r = world.resolve(sx, sz, -0.6, 0, RADIUS, 100, 0);
    sx = r.x;
    sz = r.z;
    if (world.collidesWithStaticMeshes(sx, sz, RADIUS * 0.5, 0)) sprintPenetrated = true;
  }
  check('sprint : pas de tunneling dans le mesh', !sprintPenetrated, `position finale x=${sx.toFixed(2)}`);
}

// === Montagnes : collider "parois raides uniquement" ===
for (const file of ['Mountain_desert_010.fbx', 'Hill_desert_001.fbx', 'Plateau_desert_003.fbx']) {
  console.log(`\n=== Montagne ${file} ===`);
  const mountain = loadFbx(file, MOUNTAIN_DIR);
  mountain.scale.setScalar(0.022 * 0.46); // échelle du jeu
  mountain.rotation.y = 0.7;
  mountain.position.set(0, 0, 0);
  mountain.updateMatrixWorld(true);

  const world = new CollisionWorld();
  const collider = world.addStaticFromObject(mountain, { steepOnly: true });
  check('collider parois créé', Boolean(collider));
  if (!collider) continue;

  // 1. Le collider ne contient AUCUN triangle marchable (pas de blocage invisible
  //    sur les pentes douces / sommets plats).
  const pos = collider.geometry.attributes.position;
  let steepOk = true;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    va.fromBufferAttribute(pos, t * 3);
    vb.fromBufferAttribute(pos, t * 3 + 1);
    vc.fromBufferAttribute(pos, t * 3 + 2);
    n.crossVectors(vb.clone().sub(va), vc.clone().sub(va)).normalize();
    if (n.y >= WALKABLE_NORMAL_Y) {
      steepOk = false;
      break;
    }
  }
  check('aucun triangle marchable dans le collider (pas de blocage invisible)', steepOk);

  // 2. Le nombre de triangles est réduit (optimisation : pentes douces exclues).
  const fullWorld = new CollisionWorld();
  const fullCollider = fullWorld.addStaticFromObject(mountain);
  const fullTris = fullCollider.geometry.index
    ? fullCollider.geometry.index.count / 3
    : fullCollider.geometry.attributes.position.count / 3;
  const steepTris = pos.count / 3;
  check(
    'collider allégé vs mesh complet',
    steepTris < fullTris,
    `${steepTris} tris raides / ${fullTris} total`,
  );

  // 3. Marcher vers une paroi raide : bloqué, jamais enfoncé dedans.
  const { box, bvh } = collider;
  const cz2 = (box.min.z + box.max.z) / 2;
  const surf = bvh.closestPointToPoint(
    new THREE.Vector3(box.max.x + 1, (box.min.y + box.max.y) / 2, cz2),
    { point: new THREE.Vector3(), distance: 0, faceIndex: 0 },
  );
  const feetY = Math.max(0, surf.point.y - 0.9);
  let mx = box.max.x + 2;
  let penetratedWall = false;
  for (let i = 0; i < 150; i++) {
    const r = world.resolve(mx, cz2, -0.12, 0, RADIUS, 100, feetY);
    mx = r.x;
    if (world.collidesWithStaticMeshes(mx, r.z, RADIUS * 0.5, feetY)) penetratedWall = true;
  }
  check('paroi raide : jamais enfoncé dans la falaise', !penetratedWall, `x final ${mx.toFixed(2)}`);

  // 4. Un point marchable (au-dessus du relief, loin des parois) n'est pas repoussé.
  const topY = box.max.y + 0.5;
  const rTop = world.resolveAgainstStaticMeshes(0, 0, RADIUS, topY);
  check('debout au-dessus du sommet : aucune poussée fantôme', rTop.x === 0 && rTop.z === 0);
}

// findSafePosition : spawn au centre de la base → position libre trouvée.
console.log('\n=== findSafePosition ===');
const model = loadFbx('Main_house_3lv.fbx');
model.scale.setScalar(0.0125);
model.updateMatrixWorld(true);
const world = new CollisionWorld();
world.addStaticFromObject(model);
const safe = world.findSafePosition(0, 0, RADIUS, 0);
const safeOk = !world.isInsideStaticFootprint(safe.x, safe.z, 0)
  && !world.collidesWithStaticMeshes(safe.x, safe.z, RADIUS, 0);
check('spawn sûr trouvé hors du bâtiment', safeOk, `(${safe.x.toFixed(2)}, ${safe.z.toFixed(2)})`);

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
