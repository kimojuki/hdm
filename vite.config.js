import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    fs: { allow: [root] },
  },
  publicDir: resolve(root, 'assets'),
});
