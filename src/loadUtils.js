/** Timeout + vérif HTTP avant chargement Three.js (évite spinner infini). */

export function loadWithTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout chargement: ${label}`)), ms);
    }),
  ]);
}

export async function assertAsset(url) {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) {
    throw new Error(`Asset manquant ${url} (HTTP ${res.status})`);
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    throw new Error(
      `Asset invalide ${url} — le serveur renvoie du HTML (vérifie le proxy Node / dist/)`,
    );
  }
}
