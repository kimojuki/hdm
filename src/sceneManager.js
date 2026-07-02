import * as THREE from 'three';
import { GroundSampler } from './groundSampler.js';

/**
 * Gère les scènes actives : Base personnelle et map mission.
 * Les deux instances restent en cache pour basculer sans recharger.
 */
export class SceneManager {
  constructor(scene) {
    this.scene = scene;
    this.playerBase = null;
    this.missionMap = null;
    this.activeLocation = null;
    this._missionSampler = new GroundSampler({ mode: 'analytical' });
  }

  detachAll() {
    this.playerBase?.root.removeFromParent();
    this.missionMap?.root.removeFromParent();
  }

  async enterPlayerBase(playerBase) {
    this.detachAll();
    this.scene.add(playerBase.root);
    playerBase.root.visible = true;
    playerBase.root.updateMatrixWorld(true);
    this.playerBase = playerBase;
    this.activeLocation = 'base';
    this.applyBaseEnvironment();
    return playerBase;
  }

  async enterMissionMap(missionMap) {
    this.detachAll();
    this.scene.add(missionMap.root);
    missionMap.root.visible = true;
    missionMap.root.updateMatrixWorld(true);
    this.missionMap = missionMap;
    this.activeLocation = 'mission';
    this.applyMissionEnvironment();
    return missionMap;
  }

  applyBaseEnvironment() {
    this.scene.background = new THREE.Color(0x12081f);
    this.scene.fog = new THREE.FogExp2(0x1a0e2e, 0.018);
  }

  applyMissionEnvironment() {
    this.scene.background = new THREE.Color(0xc9a86c);
    this.scene.fog = new THREE.Fog(0xc9a86c, 70, 190);
  }

  getCollisionWorld() {
    if (this.activeLocation === 'base') return this.playerBase?.collisionWorld ?? null;
    if (this.activeLocation === 'mission') return this.missionMap?.collisionWorld ?? null;
    return null;
  }

  getTerrainRoots() {
    if (this.activeLocation === 'base') return this.playerBase?.getWalkRoots() ?? [];
    if (this.activeLocation === 'mission') return this.missionMap?.terrainRoots ?? [];
    return [];
  }

  getGroundSampler() {
    if (this.activeLocation === 'base' && this.playerBase) {
      return this.playerBase.getGroundSampler();
    }
    return this._missionSampler;
  }

  getMapHalf() {
    if (this.activeLocation === 'base') return this.playerBase?.mapHalf ?? 40;
    if (this.activeLocation === 'mission') return this.missionMap?.mapHalf ?? 40;
    return 40;
  }

  getDebugGroup() {
    if (this.activeLocation === 'base') return this.playerBase?.debugGroup ?? null;
    if (this.activeLocation === 'mission') return this.missionMap?.debugGroup ?? null;
    return null;
  }

  isInPlayerBase() {
    return this.activeLocation === 'base';
  }

  isInMissionMap() {
    return this.activeLocation === 'mission';
  }
}
