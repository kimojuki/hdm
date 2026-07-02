/** Catalogues de modèles et layouts initiaux de la map. */

export const BUILDING_MODELS = [
  'Main_house_3lv.fbx',
  'Research_center.fbx',
  'Resource_warehouse.fbx',
  'Reactor.fbx',
  'Solar_generator.fbx',
  'Drone_control_center.fbx',
  'Farm.fbx',
  'Section.fbx',
  'Section_door.fbx',
  'Connecting_gateway_long.fbx',
  'Connecting_gateway_corner.fbx',
  'Solar_panel.fbx',
];

export const BUILDING_LAYOUT = [
  { x: 0, z: 0, model: 0, rot: Math.PI * 0.5, scale: 1.25 },
  { x: -10, z: -8, model: 1, rot: Math.PI * 0.25, scale: 1.05 },
  { x: 12, z: -10, model: 2, rot: -Math.PI * 0.2, scale: 1.1 },
  { x: -12, z: 12, model: 3, rot: Math.PI * 0.4, scale: 1.0 },
  { x: 10, z: 12, model: 5, rot: -Math.PI * 0.35, scale: 1.05 },
  { x: 0, z: 18, model: 6, rot: Math.PI, scale: 1.0 },
  { x: -5, z: 7, model: 7, rot: 0, scale: 1.0 },
  { x: 5, z: 7, model: 8, rot: 0, scale: 1.0 },
  { x: 0, z: -8, model: 7, rot: 0, scale: 1.0 },
  { x: -16, z: 2, model: 9, rot: Math.PI * 0.5, scale: 1.0 },
  { x: 16, z: 2, model: 9, rot: Math.PI * 0.5, scale: 1.0 },
  { x: -16, z: 14, model: 10, rot: Math.PI * 0.5, scale: 1.0 },
  { x: 16, z: 14, model: 10, rot: Math.PI, scale: 1.0 },
  { x: -24, z: -16, model: 4, rot: Math.PI * 0.15, scale: 1.0 },
  { x: 24, z: -16, model: 4, rot: -Math.PI * 0.1, scale: 1.0 },
  { x: -29, z: -24, model: 11, rot: Math.PI * 0.5, scale: 1.0 },
  { x: -20, z: -25, model: 11, rot: Math.PI * 0.5, scale: 1.0 },
  { x: 20, z: -25, model: 11, rot: Math.PI * 0.5, scale: 1.0 },
  { x: 29, z: -24, model: 11, rot: Math.PI * 0.5, scale: 1.0 },
];

export const PLANT_MODELS = [
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

export const MOUNTAIN_MODELS = [
  'Hill_desert_001.fbx',
  'Hill_desert_003.fbx',
  'Hill_desert_005.fbx',
  'Plateau_desert_001.fbx',
  'Plateau_desert_003.fbx',
  'Plateau_desert_005.fbx',
  'Mountain_desert_001.fbx',
  'Mountain_desert_003.fbx',
  'Mountain_desert_004.fbx',
  'Mountain_desert_006.fbx',
  'Mountain_desert_007.fbx',
  'Mountain_desert_009.fbx',
  'Mountain_desert_010.fbx',
];

/** Anneau(s) de montagnes — double mur pour fermer visuellement le terrain. */
function addRingSides(items, radius, spacing, scale, pick, offset = 0) {
  for (let x = -radius + spacing; x <= radius - spacing; x += spacing) {
    const px = x + offset;
    if (Math.abs(px) > radius - 4) continue;
    items.push({ x: px, z: radius, model: pick(), rot: Math.PI * 0.5, scale });
    items.push({ x: px, z: -radius, model: pick(), rot: -Math.PI * 0.5, scale });
  }
  for (let z = -radius + spacing; z <= radius - spacing; z += spacing) {
    const pz = z + offset;
    if (Math.abs(pz) > radius - 4) continue;
    items.push({ x: radius, z: pz, model: pick(), rot: Math.PI, scale });
    items.push({ x: -radius, z: pz, model: pick(), rot: 0, scale });
  }
}

function addCorners(items, radius, scale, heavy = false) {
  const m = heavy ? 12 : 6;
  items.push(
    { x: -radius, z: radius, model: m, rot: 0.55, scale },
    { x: radius, z: radius, model: m === 12 ? 6 : 12, rot: -0.55, scale },
    { x: radius, z: -radius, model: m, rot: 2.5, scale },
    { x: -radius, z: -radius, model: m === 12 ? 6 : 12, rot: -2.5, scale },
  );
}

function buildMountainRingLayout() {
  const items = [];
  const models = [0, 1, 2, 3, 4, 5, 7, 8, 10, 12];
  let mi = 0;
  const pick = () => models[mi++ % models.length];

  // Mur extérieur (limite de la carte)
  const outerR = 64;
  addCorners(items, outerR, 0.5, true);
  addRingSides(items, outerR, 10, 0.46, pick);

  // Mur intérieur décalé (comble les trous)
  const innerR = 55;
  addCorners(items, innerR, 0.44, false);
  addRingSides(items, innerR, 10, 0.4, pick, 5);

  // Lisière intermédiaire sur les diagonales (renforce les angles)
  const diag = 60;
  const diagOffsets = [
    { x: -diag, z: 0, rot: Math.PI * 0.5 },
    { x: diag, z: 0, rot: -Math.PI * 0.5 },
    { x: 0, z: diag, rot: Math.PI },
    { x: 0, z: -diag, rot: 0 },
    { x: -diag * 0.72, z: diag * 0.72, rot: 0.8 },
    { x: diag * 0.72, z: diag * 0.72, rot: -0.8 },
    { x: diag * 0.72, z: -diag * 0.72, rot: 2.3 },
    { x: -diag * 0.72, z: -diag * 0.72, rot: -2.3 },
  ];
  for (const d of diagOffsets) {
    items.push({
      x: +d.x.toFixed(1),
      z: +d.z.toFixed(1),
      model: pick(),
      rot: d.rot,
      scale: 0.42,
    });
  }

  return items;
}

export const MOUNTAIN_LAYOUT = buildMountainRingLayout();

export const PLANT_LAYOUT = [
  { x: -42, z: -36, model: 0, rot: 0.4, scale: 1.2 },
  { x: -30, z: -40, model: 1, rot: 1.2, scale: 0.95 },
  { x: -14, z: -38, model: 2, rot: 2.1, scale: 1.25 },
  { x: 2, z: -42, model: 3, rot: 0.8, scale: 1.0 },
  { x: 18, z: -39, model: 4, rot: 3.5, scale: 1.2 },
  { x: 34, z: -35, model: 5, rot: 1.8, scale: 0.9 },
  { x: 44, z: -26, model: 6, rot: 4.2, scale: 1.1 },
  { x: -46, z: -8, model: 7, rot: 0.2, scale: 1.35 },
  { x: -43, z: 8, model: 8, rot: 2.7, scale: 1.0 },
  { x: -39, z: 24, model: 9, rot: 5.1, scale: 1.1 },
  { x: -33, z: 38, model: 0, rot: 3.0, scale: 1.05 },
  { x: 40, z: -10, model: 2, rot: 1.5, scale: 1.2 },
  { x: 45, z: 6, model: 4, rot: 0.6, scale: 0.95 },
  { x: 41, z: 22, model: 6, rot: 4.8, scale: 1.1 },
  { x: 35, z: 36, model: 8, rot: 2.3, scale: 1.15 },
  { x: -20, z: 44, model: 1, rot: 1.1, scale: 1.0 },
  { x: -6, z: 41, model: 3, rot: 3.9, scale: 0.9 },
  { x: 8, z: 43, model: 5, rot: 0.9, scale: 1.3 },
  { x: 24, z: 40, model: 7, rot: 2.0, scale: 1.05 },
  { x: -26, z: 6, model: 9, rot: 4.5, scale: 0.95 },
  { x: 28, z: 8, model: 4, rot: 2.2, scale: 0.9 },
  { x: -22, z: -22, model: 6, rot: 1.4, scale: 1.0 },
  { x: 23, z: -24, model: 2, rot: 5.0, scale: 1.1 },
];

/** Catégories disponibles dans le mode éditeur de map. */
export const PREFAB_CATEGORIES = [
  {
    id: 'buildings',
    label: 'Bâtiments',
    basePath: '/batiment/map1/fbx',
    textureKey: 'building',
    unitScale: 0.01,
    defaultScale: 1,
    collision: true,
    yOffset: 0.03,
    models: BUILDING_MODELS,
  },
  {
    id: 'mountains',
    label: 'Montagnes',
    basePath: '/environement/montagne/Fbx',
    textureKey: 'mountain',
    unitScale: 0.022,
    defaultScale: 0.5,
    collision: false,
    steepCollision: true,
    yOffset: 0.01,
    terrain: true,
    models: MOUNTAIN_MODELS,
  },
  {
    id: 'plants',
    label: 'Végétation',
    basePath: '/solmap1/Fbx',
    textureKey: 'plant',
    unitScale: 0.01,
    defaultScale: 1,
    collision: false,
    yOffset: 0.02,
    models: PLANT_MODELS,
  },
];
