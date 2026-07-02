import { readdir, stat, writeFile } from 'fs/promises';
import { join, relative, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { BASE_NEON_FBX_PATH } from '../src/basePrefabs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS_DIR = join(ROOT, 'assets');
const OUT_FILE = join(ROOT, 'src', 'admin', 'asset-manifest.json');

const TEXTURE_MAP = {
  plantes: '/solmap1/Textures/T_Desert_plants.png',
  montagnes: '/environement/montagne/Textures/T_Mountains_desert.png',
  batiments: '/batiment/map1/texture/T_Spase.png',
};

function cleanName(filename) {
  return basename(filename, extname(filename))
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUrlPath(absPath) {
  const rel = relative(ASSETS_DIR, absPath).split('\\').join('/');
  return `/${rel.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/')}`;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      files.push(...await walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function categorize(filePath) {
  const rel = relative(ASSETS_DIR, filePath).split('\\').join('/');
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);

  if (!['.fbx', '.glb', '.gltf', '.obj'].includes(ext)) return null;
  if (rel.includes('zEmission version')) return null;

  if (name === 'personnage.fbx' || rel.startsWith('personnage/')) {
    return { category: 'personnages', textures: [] };
  }
  if (rel.startsWith('guns/')) {
    if (ext === '.fbx') return null;
    return { category: 'armes', textures: [] };
  }
  if (rel.startsWith('batiment/')) {
    if (rel === 'batiment/base/scene.gltf' || rel === 'batiment/base.fbx') return null;
    if (rel.startsWith('batiment/base/neon/')) return null;
    return { category: 'batiments', textures: [TEXTURE_MAP.batiments] };
  }
  if (rel.startsWith('solmap1/')) {
    return { category: 'plantes', textures: [TEXTURE_MAP.plantes] };
  }
  if (rel.startsWith('environement/montagne/')) {
    const preview = rel.replace('/Fbx/', '/Preview/').replace(/\.fbx$/i, '.jpg');
    return {
      category: 'montagnes',
      textures: [TEXTURE_MAP.montagnes],
      previewFallback: preview,
    };
  }
  if (
    rel.startsWith('ennemie/')
    || rel.startsWith('ennemi/')
    || rel.toLowerCase().includes('enemy')
    || rel.toLowerCase().includes('ennem')
    || rel.toLowerCase().includes('mecha')
  ) {
    const base = filePath.slice(0, -ext.length);
    return {
      category: 'ennemis',
      textures: [],
      mtl: ext === '.obj' ? toUrlPath(`${base}.mtl`) : null,
    };
  }

  return { category: 'autres', textures: [] };
}

const CATEGORIES = [
  { id: 'personnages', label: 'Personnages', description: 'Soldats et personnages jouables' },
  { id: 'armes', label: 'Armes & équipement', description: 'Fusils, explosifs, munitions' },
  { id: 'base', label: 'Base personnelle', description: 'Modèle sci-fi neon (batiment/base/neon/)' },
  { id: 'batiments', label: 'Bâtiments', description: 'Structures de la colonie spatiale' },
  { id: 'plantes', label: 'Végétation désert', description: 'Plantes et props de sol' },
  { id: 'montagnes', label: 'Relief & montagnes', description: 'Collines, montagnes et plateaux' },
  { id: 'ennemis', label: 'Ennemis', description: 'Unités hostiles' },
  { id: 'autres', label: 'Autres', description: 'Assets non classés' },
];

async function expandBasePrefabs(buckets) {
  const fbxPath = join(ASSETS_DIR, 'batiment/base/neon/source/1.fbx');
  try {
    await stat(fbxPath);
  } catch {
    return;
  }

  buckets.base.push({
    id: 'base-neon-reaktor',
    name: 'Neon Base (Reaktor)',
    filename: '1.fbx',
    path: BASE_NEON_FBX_PATH,
    format: 'fbx',
    textures: [],
    mtl: null,
    previewFallback: null,
    source: 'batiment/base/neon/source/1.fbx',
  });
}

async function main() {
  const allFiles = await walk(ASSETS_DIR);
  const buckets = Object.fromEntries(CATEGORIES.map((c) => [c.id, []]));

  for (const file of allFiles) {
    const meta = categorize(file);
    if (!meta) continue;

    const rel = relative(ASSETS_DIR, file).split('\\').join('/');
    const ext = extname(file).slice(1).toLowerCase();

    buckets[meta.category].push({
      id: rel.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
      name: cleanName(file),
      filename: basename(file),
      path: toUrlPath(file),
      format: ext,
      textures: meta.textures,
      mtl: meta.mtl ?? null,
      previewFallback: meta.previewFallback ?? null,
      source: rel,
    });
  }

  await expandBasePrefabs(buckets);

  for (const list of Object.values(buckets)) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    categories: CATEGORIES.map((cat) => ({
      ...cat,
      count: buckets[cat.id].length,
      items: buckets[cat.id],
    })),
    stats: {
      total: Object.values(buckets).reduce((n, arr) => n + arr.length, 0),
    },
  };

  await writeFile(OUT_FILE, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest: ${manifest.stats.total} assets → ${OUT_FILE}`);
  for (const cat of manifest.categories) {
    console.log(`  ${cat.label}: ${cat.count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
