import * as THREE from 'three';
import { loadPlayer, updatePlayerAnimation } from './player.js';
import { InputManager } from './controls.js';
import { limitMovementBySlope, resolveGroundMovement, MAX_STEP_HEIGHT } from './terrain.js';
import { updateEnemy } from './enemy.js';
import { CameraController, bindCameraInput, getCameraRelativeMove } from './cameraController.js';
import { MapEditor } from './mapEditor.js';
import { SceneManager } from './sceneManager.js';
import { loadMissionMap } from './missionMap.js';
import { PlayerSession } from './playerSession.js';
import { PlayerBase } from './playerBase.js';
import { LocationMenu, LOCATION } from './locationMenu.js';
import { assertAsset } from './loadUtils.js';

const PLAYER_RADIUS = 0.42;
const SHOW_DEBUG = false;
const MOVE_SPEED = 8;
const JUMP_SPEED = 7.5;
const GRAVITY = 22;
const MAX_CLIMB_ANGLE = Math.PI / 3.2;
const GROUND_SNAP = 0.08;
const DPR_CAP = 1.25;
const SHADOW_MAP_SIZE = 1024;
const SHADOW_FOLLOW_HALF = 26;

const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const titleEl = document.getElementById('title');

function setLoadingStatus(text) {
  if (typeof window.__hdmSetLoading === 'function') window.__hdmSetLoading(text);
  const msg = loadingEl?.querySelector('p');
  if (msg) msg.textContent = text;
}

setLoadingStatus('Initialisation WebGL…');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  setLoadingStatus(`Erreur WebGL — ${err.message}`);
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9a86c);
scene.fog = new THREE.Fog(0xc9a86c, 70, 190);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

const ambient = new THREE.AmbientLight(0xffe8c0, 0.55);
scene.add(ambient);

const defaultSun = {
  offset: new THREE.Vector3(20, 35, 15),
  intensity: 1.4,
};
const baseSun = {
  offset: new THREE.Vector3(18, 28, 12),
  intensity: 0.85,
};
let activeSunProfile = defaultSun;

function applySunProfile(profile) {
  activeSunProfile = profile;
  sun.intensity = profile.intensity;
}

const sun = new THREE.DirectionalLight(0xfff4d6, defaultSun.intensity);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
applySunProfile(defaultSun);
scene.add(sun);
sun.target.position.set(0, 0, 0);
scene.add(sun.target);

function updateSunForPlayer(px, pz) {
  const off = activeSunProfile.offset;
  sun.position.set(px + off.x, off.y, pz + off.z);
  sun.target.position.set(px, 0, pz);
  const h = SHADOW_FOLLOW_HALF;
  sun.shadow.camera.left = -h;
  sun.shadow.camera.right = h;
  sun.shadow.camera.top = h;
  sun.shadow.camera.bottom = -h;
  sun.shadow.camera.updateProjectionMatrix();
}

const hemi = new THREE.HemisphereLight(0xffe8c0, 0x8b6914, 0.35);
scene.add(hemi);

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

const input = new InputManager(renderer.domElement);
const cameraCtrl = new CameraController({
  distance: 10.8,
  lookHeight: 1.1,
  initialPitch: 0.58,
});
bindCameraInput(renderer.domElement, cameraCtrl);
const clock = new THREE.Clock();

const sceneManager = new SceneManager(scene);
const playerSession = new PlayerSession();

let player;
let mapEditor = null;
let debugGroup = null;
let textures = null;
let currentLocation = null;
let switching = false;
let simFrame = 0;
const playerPhysics = { velocityY: 0, onGround: true };

function getCollisionWorld() {
  return sceneManager.getCollisionWorld();
}

function getGroundSampler() {
  return sceneManager.getGroundSampler();
}

function getMapHalf() {
  return sceneManager.getMapHalf();
}

function getEnemies() {
  return sceneManager.isInMissionMap() ? (sceneManager.missionMap?.enemies ?? []) : [];
}

function setTitle(location) {
  if (!titleEl) return;
  titleEl.textContent = location === LOCATION.BASE
    ? 'HDM — Base personnelle'
    : 'HDM — Sol Map 1';
}

async function ensureTextures() {
  if (textures) return textures;
  textures = {
    plant: await loadTexture('/solmap1/Textures/T_Desert_plants.png'),
    building: await loadTexture('/batiment/map1/texture/T_Spase.png'),
    mountain: await loadTexture('/environement/montagne/Textures/T_Mountains_desert.png'),
  };
  return textures;
}

async function ensureMissionMap() {
  if (sceneManager.missionMap) return sceneManager.missionMap;
  const missionMap = await loadMissionMap(await ensureTextures());
  sceneManager.missionMap = missionMap;
  return missionMap;
}

async function ensurePlayerBase() {
  const BASE_VERSION = 16;
  if (sceneManager.playerBase?.loaded && sceneManager.playerBase.layoutVersion === BASE_VERSION) {
    return sceneManager.playerBase;
  }
  if (sceneManager.playerBase) {
    sceneManager.playerBase.dispose();
    sceneManager.playerBase = null;
    playerSession.base = new PlayerBase(playerSession.playerId);
  }
  const base = await playerSession.connect();
  base.layoutVersion = BASE_VERSION;
  sceneManager.playerBase = base;

  if (!base.debugGroup) {
    const dbg = base.createDebugGroup();
    dbg.visible = SHOW_DEBUG;
    scene.add(dbg);
  }

  return base;
}

function ensureMapEditor(missionMap) {
  if (mapEditor) return mapEditor;
  mapEditor = new MapEditor({
    canvas: renderer.domElement,
    camera,
    scene,
    getTerrainRoots: () => missionMap.terrainRoots,
    getMapHalf: () => missionMap.mapHalf,
    textures,
    collisionWorld: missionMap.collisionWorld,
    mountainsGroup: missionMap.mountainsGroup,
  });
  mapEditor.registerExisting(missionMap.editorEntries);
  return mapEditor;
}

function spawnOnMissionMap(missionMap) {
  const sampler = sceneManager.getGroundSampler();
  const collisionWorld = missionMap.collisionWorld;
  const spawnY = sampler.sample(0, 0, 0, 0.35, 'snap');
  const safeSpawn = collisionWorld.findSafePosition(0, 0, PLAYER_RADIUS, spawnY);
  const safeSpawnY = sampler.sample(safeSpawn.x, spawnY, safeSpawn.z, 0.35, 'snap');
  player.position.set(safeSpawn.x, safeSpawnY, safeSpawn.z);
}

function spawnOnBase(base) {
  const spawnWorld = base.getInteriorSpawnWorldPosition();
  const sampler = base.getGroundSampler();
  const groundY = sampler.sample(spawnWorld.x, spawnWorld.y + 2, spawnWorld.z, 0.35, 'snap');
  player.position.set(spawnWorld.x, groundY, spawnWorld.z);
}

async function switchToLocation(location) {
  if (switching || location === currentLocation) return;
  switching = true;
  locationMenu.setBusy(true);

  if (mapEditor?.isActive()) {
    mapEditor.toggle();
  }

  const prevWorld = getCollisionWorld();
  if (prevWorld && player) {
    prevWorld.removeDynamic(player);
  }

  try {
    if (location === LOCATION.MISSION) {
      applySunProfile(defaultSun);
      ambient.intensity = 0.55;
      ambient.color.setHex(0xffe8c0);
      hemi.intensity = 0.35;
      hemi.color.setHex(0xffe8c0);
      hemi.groundColor.setHex(0x8b6914);
      renderer.toneMappingExposure = 1.1;
      const missionMap = await ensureMissionMap();
      await sceneManager.enterMissionMap(missionMap);
      ensureMapEditor(missionMap);
      spawnOnMissionMap(missionMap);
      debugGroup = missionMap.debugGroup;
      debugGroup.visible = SHOW_DEBUG;
    } else {
      applySunProfile(baseSun);
      ambient.intensity = 0.5;
      ambient.color.setHex(0xc8d8ff);
      hemi.intensity = 0.35;
      hemi.color.setHex(0x88aaff);
      hemi.groundColor.setHex(0x1a0828);
      renderer.toneMappingExposure = 1.35;
      const base = await ensurePlayerBase();
      await sceneManager.enterPlayerBase(base);
      spawnOnBase(base);
      debugGroup = base.debugGroup;
      if (debugGroup) debugGroup.visible = SHOW_DEBUG;
    }

    const collisionWorld = getCollisionWorld();
    collisionWorld.addDynamic(player, 0.06);
    playerPhysics.velocityY = 0;
    playerPhysics.onGround = true;

    currentLocation = location;
    locationMenu.setActive(location);
    setTitle(location);
    cameraCtrl.applyToCamera(camera, player.position, 1);
  } catch (err) {
    console.error(err);
    locationMenu.setBusy(false);
    switching = false;
    throw err;
  }

  locationMenu.setBusy(false);
  switching = false;
}

const locationMenu = new LocationMenu({
  onSelect: (location) => {
    switchToLocation(location).catch((err) => {
      console.error('[HDM] Changement de lieu échoué:', err);
    });
  },
});

async function initGame() {
  setLoadingStatus('Vérification des assets…');
  await assertAsset('/personnage.fbx');
  await assertAsset('/solmap1/Textures/T_Desert_plants.png');
  await assertAsset('/batiment/map1/fbx/Main_house_3lv.fbx');

  setLoadingStatus('Chargement du personnage…');
  player = await loadPlayer();
  scene.add(player);

  setLoadingStatus('Chargement de la map…');
  await switchToLocation(LOCATION.MISSION);

  loadingEl.classList.add('hidden');
  input.focus();
}

initGame().catch((err) => {
  console.error(err);
  setLoadingStatus(
    err.message?.includes('Root')
      ? 'Prefab base manquant — voir assets/batiment/base/'
      : `Erreur — ${err.message || 'chargement impossible'}`,
  );
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (player && !switching) {
    const editorActive = mapEditor?.isActive() && sceneManager.isInMissionMap();

    if (editorActive) {
      mapEditor.update();
      cameraCtrl.applyToCamera(camera, player.position, dt);
    } else {
      const moveInput = input.getMoveVector();
      const isMoving = moveInput.x !== 0 || moveInput.y !== 0;
      const collisionWorld = getCollisionWorld();
      const groundSampler = getGroundSampler();
      const mapHalf = getMapHalf();
      simFrame++;

      if (!collisionWorld) {
        if (player) updateSunForPlayer(player.position.x, player.position.z);
        renderer.render(scene, camera);
        return;
      }

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
            groundSampler,
            MAX_CLIMB_ANGLE,
            player.position.y,
          );
          dx = limited.dx;
          dz = limited.dz;

          const moved = resolveGroundMovement(
            player.position.x,
            player.position.z,
            player.position.y,
            dx,
            dz,
            PLAYER_RADIUS,
            groundSampler,
            collisionWorld,
            mapHalf,
            player,
            simFrame,
          );
          player.position.x = moved.x;
          player.position.z = moved.z;
          player.position.y = moved.y;
        } else {
          const resolved = collisionWorld.resolve(
            player.position.x,
            player.position.z,
            dx,
            dz,
            PLAYER_RADIUS,
            mapHalf,
            player.position.y,
            player,
            simFrame,
          );
          player.position.x = resolved.x;
          player.position.z = resolved.z;
        }
        player.rotation.y = Math.atan2(nx, nz);
      }

      const stepTolerance = isMoving && playerPhysics.onGround ? MAX_STEP_HEIGHT : 0.35;
      const groundY = groundSampler.sample(
        player.position.x,
        player.position.y,
        player.position.z,
        stepTolerance,
        isMoving ? 'move' : 'snap',
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
      cameraCtrl.applyToCamera(camera, player.position, dt);

      if (sceneManager.isInMissionMap()) {
        for (const enemy of getEnemies()) {
          updateEnemy(enemy, dt, groundSampler, mapHalf, collisionWorld, simFrame);
        }
      }

      updateSunForPlayer(player.position.x, player.position.z);
    }
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && debugGroup) {
    debugGroup.visible = !debugGroup.visible;
    sceneManager.playerBase?.setDebugVisible(debugGroup.visible);
  }

  if (e.code === 'KeyE' && mapEditor && sceneManager.isInMissionMap() && !e.repeat) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    mapEditor.toggle();
    e.preventDefault();
  }

  if (e.code === 'KeyM' && !e.repeat) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const next = currentLocation === LOCATION.MISSION ? LOCATION.BASE : LOCATION.MISSION;
    switchToLocation(next).catch(console.error);
    e.preventDefault();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

export { sceneManager, switchToLocation };
