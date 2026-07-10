import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadWithTimeout } from './loadUtils.js';

const fbxLoader = new FBXLoader();
const PACK_BASE = '/animation/personnage/Pro Rifle Pack';
const FIRE_CLIP_PATH = '/animation/personnage/tire%20arme%20rapide/Gunplay.fbx';
const FIRE_ANIM_SPEED = 0.72;

const DIRECTIONS = [
  'forward',
  'forwardRight',
  'right',
  'backwardRight',
  'backward',
  'backwardLeft',
  'left',
  'forwardLeft',
];

const DIR_TO_FILE = {
  forward: 'forward',
  forwardRight: 'forward right',
  right: 'right',
  backwardRight: 'backward right',
  backward: 'backward',
  backwardLeft: 'backward left',
  left: 'left',
  forwardLeft: 'forward left',
};

const ROOT_BONE_PREFIXES = ['metarig', 'mixamorig', 'root', 'hips'];

function packPath(filename) {
  return `${PACK_BASE}/${encodeURIComponent(filename)}`;
}

function sanitizeClip(clip) {
  const tracks = clip.tracks.filter((track) => {
    const bone = track.name.split('.')[0].toLowerCase();
    if (!ROOT_BONE_PREFIXES.some((prefix) => bone.startsWith(prefix))) return true;
    return !track.name.endsWith('.position') && !track.name.endsWith('.quaternion');
  });

  if (tracks.length === clip.tracks.length) return clip;
  const sanitized = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  sanitized.name = clip.name;
  return sanitized;
}

async function tryLoadClip(path) {
  try {
    const fbx = await loadWithTimeout(fbxLoader.loadAsync(path), 60000, path);
    const clip = fbx.animations?.[0];
    if (!clip) return null;
    return sanitizeClip(clip);
  } catch {
    return null;
  }
}

async function tryLoadPackClip(filename) {
  return tryLoadClip(packPath(filename));
}

async function loadLocomotionClip(mode, direction) {
  const segment = DIR_TO_FILE[direction];
  const candidates = [
    { file: `${mode} ${segment}.fbx`, timeScale: 1 },
    { file: `walk ${segment}.fbx`, timeScale: mode === 'run' ? 1.12 : 1 },
    { file: `run ${segment}.fbx`, timeScale: mode === 'walk' ? 0.58 : 1 },
  ];

  for (const { file, timeScale } of candidates) {
    const clip = await tryLoadPackClip(file);
    if (clip) return { clip, timeScale };
  }
  return null;
}

export async function loadPlayerAnimationClips() {
  const registry = {};

  const [idle, idleAiming, jumpLoop, fire, ...runClips] = await Promise.all([
    tryLoadPackClip('idle.fbx'),
    tryLoadPackClip('idle aiming.fbx'),
    tryLoadPackClip('jump loop.fbx'),
    tryLoadClip(FIRE_CLIP_PATH),
    ...DIRECTIONS.map((direction) => loadLocomotionClip('run', direction)),
  ]);

  if (idle) registry.idle = { clip: idle, timeScale: 1, loop: THREE.LoopRepeat };
  if (idleAiming) registry.idleAiming = { clip: idleAiming, timeScale: 1, loop: THREE.LoopRepeat };
  if (jumpLoop) registry.jumpLoop = { clip: jumpLoop, timeScale: 1, loop: THREE.LoopRepeat };
  if (fire) {
    registry.fire = {
      clip: fire,
      timeScale: FIRE_ANIM_SPEED,
      loop: THREE.LoopOnce,
      clamp: true,
    };
  }

  DIRECTIONS.forEach((direction, index) => {
    const run = runClips[index];
    if (run) registry[`run:${direction}`] = { ...run, loop: THREE.LoopRepeat };
  });

  return registry;
}

export function getMoveDirection(moveInput) {
  const forward = -moveInput.y;
  const strafe = moveInput.x;
  if (Math.hypot(forward, strafe) < 0.12) return null;

  if (Math.abs(forward) > Math.abs(strafe) * 1.65) {
    return forward >= 0 ? 'forward' : 'backward';
  }
  if (Math.abs(strafe) > Math.abs(forward) * 1.65) {
    return strafe >= 0 ? 'right' : 'left';
  }

  const angle = Math.atan2(strafe, forward);
  const sector = Math.round(angle / (Math.PI / 4));
  return DIRECTIONS[((sector % 8) + 8) % 8];
}

export class PlayerAnimationController {
  constructor(modelRoot, registry) {
    this.modelRoot = modelRoot;
    this.registry = registry;
    this.mixer = new THREE.AnimationMixer(modelRoot);
    this.actions = new Map();
    this.currentKey = null;
    this.wasOnGround = true;
    this.firePlaying = false;
    this.fireTime = 0;
    this.locomotionKey = 'idle';
    this.previewPose = null;
  }

  _getFireDuration() {
    const entry = this.registry.fire;
    if (!entry) return 0.2;
    return entry.clip.duration / (entry.timeScale || 1);
  }

  _getAction(key) {
    const entry = this.registry[key];
    if (!entry) return null;

    if (!this.actions.has(key)) {
      const action = this.mixer.clipAction(entry.clip);
      action.setLoop(entry.loop ?? THREE.LoopRepeat);
      if (entry.clamp) action.clampWhenFinished = true;
      this.actions.set(key, action);
    }

    const action = this.actions.get(key);
    if (entry.timeScale) action.setEffectiveTimeScale(entry.timeScale);
    return action;
  }

  _play(key, fade = 0.18) {
    if (!this.registry[key]) {
      key = this.registry.idle ? 'idle' : key;
      if (!this.registry[key]) return;
    }
    if (this.currentKey === key) return;

    const next = this._getAction(key);
    const prev = this.currentKey ? this._getAction(this.currentKey) : null;
    if (!next) return;

    next.reset();
    next.setEffectiveWeight(1);
    next.play();

    if (prev && prev !== next && prev !== this.actions.get('fire')) {
      prev.crossFadeTo(next, fade, false);
    }

    this.currentKey = key;
    if (key !== 'fire') this.locomotionKey = key;
  }

  setPreviewPose(poseKey) {
    this.previewPose = poseKey || null;
    if (this.previewPose) {
      this._play(this.previewPose, 0.05);
    }
  }

  triggerFire() {
    if (!this.registry.fire) return false;

    const fire = this._getAction('fire');
    if (!fire) return false;

    this.firePlaying = true;
    this.fireTime = 0;
    fire.reset();
    fire.setEffectiveWeight(1);
    fire.play();
    return true;
  }

  _updateLocomotion(moveInput, isMoving, onGround, isAiming) {
    if (!onGround) {
      this.wasOnGround = false;
      this._play('jumpLoop', 0.12);
      return;
    }

    if (!this.wasOnGround) {
      this.wasOnGround = true;
    }

    const aimPose = (isAiming || this.firePlaying) && !isMoving;

    if (isMoving) {
      const dir = getMoveDirection(moveInput) ?? 'forward';
      const runKey = `run:${dir}`;
      this._play(this.registry[runKey] ? runKey : 'run:forward', 0.18);
    } else if (aimPose && this.registry.idleAiming) {
      this._play('idleAiming', 0.15);
    } else {
      this._play('idle', 0.2);
    }
  }

  update(dt, {
    moveInput = { x: 0, y: 0 },
    isMoving = false,
    onGround = true,
    isAiming = false,
  } = {}) {
    if (this.previewPose) {
      if (this.previewPose === 'fire' && this.registry.fire) {
        const fireAction = this.actions.get('fire');
        if (fireAction && !fireAction.isRunning()) {
          fireAction.reset();
          fireAction.setEffectiveWeight(1);
          fireAction.play();
        }
      } else {
        this._play(this.previewPose, 0.05);
      }
      this.mixer.update(dt);
      return;
    }

    const fireAction = this.actions.get('fire');
    const fireDuration = this._getFireDuration();

    if (this.firePlaying && fireAction) {
      this.fireTime += dt;
      if (this.fireTime >= fireDuration || !fireAction.isRunning()) {
        this.firePlaying = false;
        fireAction.fadeOut(0.1);
      }
    }

    this._updateLocomotion(moveInput, isMoving, onGround, isAiming);

    if (this.firePlaying && fireAction) {
      const locomotion = this.currentKey ? this._getAction(this.currentKey) : null;
      if (locomotion && locomotion !== fireAction) {
        locomotion.setEffectiveWeight(isMoving ? 0.55 : 0.35);
      }
      fireAction.setEffectiveWeight(1);
    }

    this.mixer.update(dt);
  }
}

export async function createPlayerAnimationController(modelRoot) {
  const registry = await loadPlayerAnimationClips();
  return new PlayerAnimationController(modelRoot, registry);
}
