import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadPlayer, updatePlayerAnimation } from './player.js';
import { InputManager } from './controls.js';
import {
  sampleTerrainHeightAtFeet,
  limitMovementBySlope,
  snapObjectBaseToSurface,
} from './terrain.js';
import { loadMecha01, initEnemy, updateEnemy, ENEMY_COLLISION_RADIUS } from './enemy.js';
import { CollisionWorld } from './collisions.js';
import { CameraController, bindCameraInput, getCameraRelativeMove } from './cameraController.js';

const ENEMY_LAYOUT = [
  { x: 8, z: 0, rot: Math.PI },
  { x: 12, z: 2, rot: Math.PI },
  { x: -6, z: 10, rot: 0.8 },
];

const PLANT_MODELS = [
  'Desert_plant_001.fbx',
  'Desert_plant_003.fbx',
  'Desert_plant_005.fbx',
  'Desert_plant_007.fbx',
  'Desert_plant_009.fbx',
  'Desert_plant_011.fbx',
  'Desert_plant_013.fbx',
  'Desert_plant_015.fbx',
  'Desert_plant_017.fbx',
  'Desert_plant_019.fbx',
];

const PLANT_LAYOUT = [
  { x: -18, z: -12, model: 0, rot: 0.4, scale: 1.1 },
  { x: -8, z: -20, model: 1, rot: 1.2, scale: 0.9 },
  { x: 4, z: -16, model: 2, rot: 2.1, scale: 1.3 },
  { x: 14, z: -10, model: 3, rot: 0.8, scale: 1.0 },
  { x: 22, z: -18, model: 4, rot: 3.5, scale: 1.2 },
  { x: -22, z: 2, model: 5, rot: 1.8, scale: 0.85 },
  { x: -12, z: 8, model: 6, rot: 4.2, scale: 1.15 },
  { x: 0, z: 6, model: 7, rot: 0.2, scale: 1.4 },
  { x: 10, z: 4, model: 8, rot: 2.7, scale: 0.95 },
  { x: 20, z: 10, model: 9, rot: 5.1, scale: 1.1 },
  { x: -16, z: 18, model: 0, rot: 3.0, scale: 1.0 },
  { x: -4, z: 22, model: 2, rot: 1.5, scale: 1.25 },
  { x: 8, z: 20, model: 4, rot: 0.6, scale: 0.9 },
  { x: 18, z: 16, model: 6, rot: 4.8, scale: 1.05 },
  { x: -24, z: -6, model: 8, rot: 2.3, scale: 1.2 },
  { x: 26, z: 0, model: 1, rot: 1.1, scale: 1.0 },
  { x: 6, z: -8, model: 3, rot: 3.9, scale: 0.8 },
  { x: -6, z: -4, model: 5, rot: 0.9, scale: 1.35 },
  { x: 16, z: -4, model: 7, rot: 2.0, scale: 1.1 },
  { x: -2, z: 14, model: 9, rot: 4.5, scale: 0.95 },
];

const MAP_SIZE = 60;
const MAP_HALF = MAP_SIZE / 2 - 2;
const PLAYER_RADIUS = 0.42;
const MOVE_SPEED = 8;
const JUMP_SPEED = 7.5;
const GRAVITY = 22;
const MAX_CLIMB_ANGLE = Math.PI / 3.2;
const GROUND_SNAP = 0.08;

const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9a86c);
scene.fog = new THREE.Fog(0xc9a86c, 40, 90);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

const ambient = new THREE.AmbientLight(0xffe8c0, 0.55);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff4d6, 1.4);
sun.position.set(20, 35, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
sun.shadow.bias = -0.0005;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0xffe8c0, 0x8b6914, 0.35);
scene.add(hemi);

function createGround() {
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 32, 32);
  const positions = groundGeo.attributes.position;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const wave = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 0.4;
    const dune = Math.sin((x + y) * 0.08) * 0.6;
    positions.setZ(i, wave + dune);
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

  const gridHelper = new THREE.GridHelper(MAP_SIZE, 30, 0x9a7a40, 0x9a7a40);
  gridHelper.position.y = 0.02;
  gridHelper.material.opacity = 0.15;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);

  return ground;
}

function loadTexture(url, nearest = true) {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        if (nearest) {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
        }
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function prepareFbxModel(fbx, texture) {
  fbx.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
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

async function loadFbxPlacements({ basePath, models, layout, texture, unitScale = 0.01, collisionMargin = 0.06 }) {
  const loader = new FBXLoader();
  const cache = new Map();
  const group = new THREE.Group();
  const instances = [];

  const loadModel = async (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const fbx = await loader.loadAsync(`${basePath}/${filename}`);
    const prepared = prepareFbxModel(fbx, texture);
    cache.set(filename, prepared);
    return prepared;
  };

  const uniqueModels = [...new Set(layout.map((p) => models[p.model]))];
  await Promise.all(uniqueModels.map(loadModel));

  for (const placement of layout) {
    const filename = models[placement.model];
    const instance = cache.get(filename).clone();
    instance.position.set(placement.x, 0, placement.z);
    instance.rotation.y = placement.rot;
    instance.scale.setScalar(placement.scale * unitScale);
    group.add(instance);
    instances.push({ object: instance, collisionMargin });
  }

  return { group, instances };
}

function placePlantsOnGround(instances, groundMesh) {
  const surface = [groundMesh];
  for (const { object } of instances) {
    snapObjectBaseToSurface(object, surface);
  }
}

async function loadPlants(texture) {
  return loadFbxPlacements({
    basePath: '/solmap1/Fbx',
    models: PLANT_MODELS,
    layout: PLANT_LAYOUT,
    texture,
    unitScale: 0.01,
    collisionMargin: 0.05,
  });
}

function updateCamera(playerPos, dt, cameraCtrl) {
  cameraCtrl.applyToCamera(camera, playerPos, dt);
}

const input = new InputManager(renderer.domElement);
const cameraCtrl = new CameraController();
bindCameraInput(renderer.domElement, cameraCtrl);
const clock = new THREE.Clock();
let player;
let terrainRoots = [];
let groundMesh;
const enemies = [];
const collisionWorld = new CollisionWorld();
const playerPhysics = { velocityY: 0, onGround: true };

groundMesh = createGround();
terrainRoots = [groundMesh];

Promise.all([
  loadTexture('/solmap1/Textures/T_Desert_plants.png'),
])
  .then(async ([plantTexture]) => {
    const plantsData = await loadPlants(plantTexture);

    placePlantsOnGround(plantsData.instances, groundMesh);
    scene.add(plantsData.group);

    terrainRoots = [groundMesh];
    plantsData.group.updateMatrixWorld(true);

    for (const placement of ENEMY_LAYOUT) {
      const enemy = await loadMecha01();
      initEnemy(enemy, placement.x, placement.z, placement.rot, groundMesh);
      scene.add(enemy);
      enemies.push(enemy);
      collisionWorld.addDynamic(enemy, 0.1);
    }

    player = await loadPlayer();
    const spawnY = sampleTerrainHeightAtFeet(0, 0, 0, terrainRoots);
    player.position.set(0, spawnY, 0);
    playerPhysics.velocityY = 0;
    playerPhysics.onGround = true;
    collisionWorld.addDynamic(player, 0.06);
    scene.add(player);

    cameraCtrl.applyToCamera(camera, player.position, 1);

    loadingEl.classList.add('hidden');
    input.focus();
  })
  .catch((err) => {
    console.error(err);
    loadingEl.querySelector('p').textContent = 'Erreur de chargement';
  });

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (player) {
    const moveInput = input.getMoveVector();
    const isMoving = moveInput.x !== 0 || moveInput.y !== 0;

    if (input.consumeJump() && playerPhysics.onGround) {
      playerPhysics.velocityY = JUMP_SPEED;
      playerPhysics.onGround = false;
    }

    playerPhysics.velocityY -= GRAVITY * dt;
    player.position.y += playerPhysics.velocityY * dt;

    if (isMoving) {
      const dir = getCameraRelativeMove(moveInput, cameraCtrl.getYaw());
      const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      const nx = dir.x / len;
      const nz = dir.z / len;
      let dx = nx * MOVE_SPEED * dt;
      let dz = nz * MOVE_SPEED * dt;

      if (playerPhysics.onGround) {
        const limited = limitMovementBySlope(
          player.position.x,
          player.position.z,
          dx,
          dz,
          terrainRoots,
          MAX_CLIMB_ANGLE,
        );
        dx = limited.dx;
        dz = limited.dz;
      }

      const resolved = collisionWorld.resolve(
        player.position.x,
        player.position.z,
        dx,
        dz,
        PLAYER_RADIUS,
        MAP_HALF,
        player.position.y,
        player,
      );

      player.position.x = resolved.x;
      player.position.z = resolved.z;
      player.rotation.y = Math.atan2(nx, nz);
    }

    const groundY = sampleTerrainHeightAtFeet(
      player.position.x,
      player.position.y,
      player.position.z,
      terrainRoots,
    );
    if (player.position.y <= groundY + GROUND_SNAP && playerPhysics.velocityY <= 0) {
      player.position.y = groundY;
      playerPhysics.velocityY = 0;
      playerPhysics.onGround = true;
    } else if (player.position.y < groundY - 0.12 && playerPhysics.velocityY <= 0) {
      player.position.y = groundY;
      playerPhysics.velocityY = 0;
      playerPhysics.onGround = true;
    } else {
      playerPhysics.onGround = false;
    }

    updatePlayerAnimation(player, dt, isMoving, 1);
    updateCamera(player.position, dt, cameraCtrl);

    for (const enemy of enemies) {
      updateEnemy(enemy, dt, terrainRoots, MAP_HALF, collisionWorld);
    }
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
