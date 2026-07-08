import { limitMovementBySlope, resolveGroundMovement, MAX_STEP_HEIGHT } from './terrain.js';
import { updateCharacterRotation } from './characterRotation.js';
import { updatePlayerAnimation } from './player.js';

function getCameraRelativeMove(move, cameraYaw) {
  const { x, y } = move;
  if (x === 0 && y === 0) return { x: 0, z: 0 };

  const inputForward = -y;
  const inputStrafe = x;

  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);

  // Direction avant caméra projetée au sol.
  const fx = -sin;
  const fz = -cos;
  // Droite caméra au sol.
  const rx = cos;
  const rz = -sin;

  const mx = fx * inputForward + rx * inputStrafe;
  const mz = fz * inputForward + rz * inputStrafe;

  const len = Math.hypot(mx, mz);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: mx / len, z: mz / len };
}

export class CharacterController {
  constructor({
    playerRadius = 0.42,
    moveSpeed = 8,
    jumpSpeed = 7.5,
    gravity = 22,
    maxClimbAngle = Math.PI / 3.2,
    groundSnap = 0.08,
    gravityOnGroundEps = 0.12,
    // Alignement temporel : quand la caméra utilise une inertie de rotation,
    // on ralentit légèrement la rotation du personnage pour éviter
    // l'impression que "personnage et caméra" se désolidarisent.
    turnSpeed = 10,
  } = {}) {
    this.playerRadius = playerRadius;
    this.moveSpeed = moveSpeed;
    this.jumpSpeed = jumpSpeed;
    this.gravity = gravity;
    this.maxClimbAngle = maxClimbAngle;
    this.groundSnap = groundSnap;
    this.gravityOnGroundEps = gravityOnGroundEps;
    this.turnSpeed = turnSpeed;

    this.playerPhysics = { velocityY: 0, onGround: true };
  }

  reset() {
    this.playerPhysics.velocityY = 0;
    this.playerPhysics.onGround = true;
  }

  getOnGround() {
    return this.playerPhysics.onGround;
  }

  update(dt, {
    player,
    moveInput,
    wantsJump,
    collisionWorld,
    groundSampler,
    mapHalf,
    cameraYaw,
    characterYaw,
    simFrame,
  }) {
    const pp = this.playerPhysics;

    if (wantsJump && pp.onGround) {
      pp.velocityY = this.jumpSpeed;
      pp.onGround = false;
    }

    pp.velocityY -= this.gravity * dt;
    player.position.y += pp.velocityY * dt;

    const isMoving = moveInput.x !== 0 || moveInput.y !== 0;

    if (isMoving) {
      const dir = getCameraRelativeMove(moveInput, cameraYaw);
      const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      const nx = len > 1e-6 ? dir.x / len : 0;
      const nz = len > 1e-6 ? dir.z / len : 0;

      let dx = nx * this.moveSpeed * dt;
      let dz = nz * this.moveSpeed * dt;

      if (pp.onGround) {
        const limited = limitMovementBySlope(
          player.position.x,
          player.position.z,
          dx,
          dz,
          groundSampler,
          this.maxClimbAngle,
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
          this.playerRadius,
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
          this.playerRadius,
          mapHalf,
          player.position.y,
          player,
          simFrame,
        );
        player.position.x = resolved.x;
        player.position.z = resolved.z;
      }
    }

    updateCharacterRotation(player, characterYaw, dt, this.turnSpeed);

    const stepTolerance = isMoving && pp.onGround ? MAX_STEP_HEIGHT : 0.35;
    const groundY = groundSampler.sample(
      player.position.x,
      player.position.y,
      player.position.z,
      stepTolerance,
      isMoving ? 'move' : 'snap',
    );

    if (player.position.y <= groundY + this.groundSnap && pp.velocityY <= 0) {
      player.position.y = groundY;
      pp.velocityY = 0;
      pp.onGround = true;
    } else if (player.position.y < groundY - this.gravityOnGroundEps && pp.velocityY <= 0) {
      player.position.y = groundY;
      pp.velocityY = 0;
      pp.onGround = true;
    } else {
      pp.onGround = false;
    }

    updatePlayerAnimation(player, dt, isMoving, 1);
    return { isMoving };
  }
}

