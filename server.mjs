import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.fbx': 'application/octet-stream',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safePath === path.sep ? 'index.html' : safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    const ext = path.extname(safePath).toLowerCase();
    // Ne jamais renvoyer index.html pour un asset manquant (FBX, textures, JS…)
    // sinon Three.js reste bloqué en parsant du HTML.
    if (ext && ext !== '.html') {
      send(res, 404, `Not found: ${safePath}`);
      return;
    }
    filePath = path.join(ROOT, 'index.html');
    if (!fs.existsSync(filePath)) {
      send(res, 404, 'Not found — run: npm run build');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 500, 'Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HDM server → http://${HOST}:${PORT} (dist/)`);
});
