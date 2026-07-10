/** Réglages des objets tenus par le joueur. */
export const HELD_ITEM_DEFS = {
  ak47: {
    id: 'ak47',
    label: 'AK-47',
    attachBone: 'handR',
    meshLength: 0.95,
    gripRatio: 0.15,
    forestockRatio: 0.82,
    magazineLocalDir: { x: 0, y: -1, z: 0 },
    barrelRollOffsetDeg: -35,
  },
};

export function getHeldItemDef(itemId) {
  return HELD_ITEM_DEFS[itemId] ?? null;
}
