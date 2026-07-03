import * as THREE from 'three';
import { CollisionWorld } from './collisions.js';
import { MissionChunkManager } from './missionChunks.js';

export const MISSION_MAP_SIZE = 140;
export const MISSION_MAP_HALF = MISSION_MAP_SIZE / 2 - 2;

export function createMissionGround(scene) {
  const groundGeo = new THREE.PlaneGeometry(MISSION_MAP_SIZE, MISSION_MAP_SIZE, 40, 40);
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

  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: 0xc4a060,
      roughness: 0.95,
      metalness: 0.0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}

/**
 * Map mission — sol procédural + streaming par chunks (bâtiments / montagnes / plantes).
 */
export async function loadMissionMap(textures) {
  const root = new THREE.Group();
  root.name = 'MissionMap';

  const collisionWorld = new CollisionWorld();
  const groundMesh = createMissionGround(root);
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'Buildings';
  const mountainsGroup = new THREE.Group();
  mountainsGroup.name = 'Mountains';
  const plantsGroup = new THREE.Group();
  plantsGroup.name = 'Plants';
  root.add(buildingsGroup, mountainsGroup, plantsGroup);

  const enemies = [];
  const editorEntries = [];

  const chunkManager = new MissionChunkManager({
    root,
    groundMesh,
    collisionWorld,
    textures,
    buildingsGroup,
    mountainsGroup,
    plantsGroup,
    enemies,
    mapHalf: MISSION_MAP_HALF,
    onEditorEntries: (entries) => editorEntries.push(...entries),
  });

  await chunkManager.update(0, 0, 0, true);
  collisionWorld.finalize();

  const debugGroup = collisionWorld.createDebugGroup();
  debugGroup.visible = false;
  root.add(debugGroup);

  return {
    root,
    mapHalf: MISSION_MAP_HALF,
    collisionWorld,
    terrainRoots: [groundMesh],
    groundMesh,
    mountainsGroup,
    enemies,
    debugGroup,
    editorEntries,
    chunkManager,
    updateStreaming(px, pz, dt = 0) {
      return chunkManager.update(px, pz, dt);
    },
  };
}
