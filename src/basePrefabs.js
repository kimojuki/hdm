/** Base personnelle — modèle sci-fi neon (GD55 / Reaktor). */

export const BASE_NEON_FBX_PATH = '/batiment/base/neon/source/1.fbx';
export const BASE_NEON_TEXTURE_PATH = '/batiment/base/neon/textures/';

/** Panorama ciel base — fantasy-sky-background/textures/background.jpg */
export const BASE_SKY_TEXTURE_PATH = '/batiment/base/fantasy-sky-background/textures/';

/** Taille cible de la base sur le sol (mètres jeu). */
export const BASE_TARGET_SIZE = 38;

/** Marge autour de la bbox de la base pour la limite de map et le sol mars. */
export const BASE_MAP_MARGIN = 4;
export const BASE_GROUND_MARGIN = 8;
/** Rayon sans sol mars sous la base (évite l’orange visible à travers le plancher). */
export const BASE_TERRAIN_CUTOUT_MARGIN = 3;
/** Rétrécissement proportionnel de la plaque par côté (aligné piliers intérieurs). */
export const BASE_GLASS_BRIDGE_SHRINK = 0.135;
/** Rétrécissement fixe additionnel par côté (mètres). */
export const BASE_GLASS_BRIDGE_INSET = 0.1;
/** @deprecated marge retirée — la plaque est réduite via SHRINK + INSET */
export const BASE_GLASS_BRIDGE_MARGIN = 0;
/** Fraction bbox pour le carré central si la détection auto échoue. */
export const BASE_CENTRAL_PIT_SPAN = 0.26;
/** Hauteur de la plaque de verre au-dessus de la dalle (mètres). */
export const BASE_GLASS_BRIDGE_Y_OFFSET = 0.02;

/**
 * Dalle basse conservée intacte (mesh Reaktor_0 dans le FBX).
 */
export const BASE_FLOOR_MESH_NAME = 'Reaktor_0Mesh';
/** Tolérance au-dessus du haut de la dalle pour détecter escaliers / plateformes. */
export const BASE_FLOOR_TOP_EPSILON = 0.08;
/** Normale Y au-dessus de laquelle une face compte comme horizontale (marche, dalle). */
export const BASE_HORIZONTAL_NORMAL_Y = 0.52;
/** Reaktor_8 = néons intérieurs — ne pas traiter pour les escaliers à bouts roses. */
export const BASE_PINK_STAIR_SKIP_MESHES = new Set(['Reaktor_0Mesh', 'Reaktor_8Mesh']);

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
