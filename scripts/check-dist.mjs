import fs from 'node:fs';

const required = ['dist/index.html', 'dist/personnage.fbx', 'dist/assets'];
const missing = required.filter((p) => !fs.existsSync(p));

if (missing.length) {
  console.error('[HDM] Build incomplet — fichiers manquants :');
  for (const p of missing) console.error('  -', p);
  console.error('[HDM] Lance : npm install --include=dev && npm run build');
  process.exit(1);
}

console.log('[HDM] dist/ OK');
