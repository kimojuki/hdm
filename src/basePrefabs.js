/** Base personnelle — modèle sci-fi neon (GD55 / Reaktor). */

export const BASE_NEON_FBX_PATH = '/batiment/base/neon/source/1.fbx';
export const BASE_NEON_TEXTURE_PATH = '/batiment/base/neon/textures/';

/** Taille cible de la base sur le sol (mètres jeu). */
export const BASE_TARGET_SIZE = 38;

/** Marge autour de la bbox de la base pour la limite de map et le sol mars. */
export const BASE_MAP_MARGIN = 4;
export const BASE_GROUND_MARGIN = 8;

/**
 * Candidats de spawn intérieur (fraction de la demi-étendue bbox depuis le centre).
 * Ordre de préférence : plancher libre à droite du cadre central, loin de la fosse.
 */
export const BASE_SPAWN_CANDIDATES = [
  { x: 0.40, z: 0.20 },
  { x: 0.36, z: 0.26 },
  { x: 0.42, z: 0.14 },
  { x: -0.38, z: 0.28 },
  { x: 0.30, z: -0.32 },
];
