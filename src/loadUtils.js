/** Timeout + vérif HTTP avant chargement Three.js (évite spinner infini). */

export function loadWithTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout chargement: ${label}`)), ms);
    }),
  ]);
}

export async function assertAsset(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (!res.ok) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    }
    if (!res.ok) {
      throw new Error(`Asset manquant ${url} (HTTP ${res.status})`);
    }
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) {
      throw new Error(`Asset invalide ${url} — le serveur renvoie du HTML`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout réseau: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
