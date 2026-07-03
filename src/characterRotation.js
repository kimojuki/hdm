/** Rotation progressive du personnage vers la direction de la caméra (TPS). */
export function updateCharacterRotation(player, targetYaw, dt, turnSpeed = 10) {
  const current = player.rotation.y;
  const delta = Math.atan2(
    Math.sin(targetYaw - current),
    Math.cos(targetYaw - current),
  );
  player.rotation.y = current + delta * Math.min(1, turnSpeed * dt);
}
