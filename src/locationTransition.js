const DESTINATION_LABELS = {
  base: 'Base personnelle',
  mission: 'Map 01',
};

let loadingEl;
let titleEl;
let statusEl;
let shownAt = 0;

const MIN_VISIBLE_MS = 450;

function ensureElements() {
  if (!loadingEl) {
    loadingEl = document.getElementById('loading');
    titleEl = document.getElementById('loading-destination');
    statusEl = loadingEl?.querySelector('p');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function showLocationTransition(locationOrLabel, status = 'Chargement…') {
  ensureElements();
  if (!loadingEl) return;

  const label = DESTINATION_LABELS[locationOrLabel] ?? locationOrLabel;
  shownAt = performance.now();
  loadingEl.classList.remove('hidden');
  loadingEl.classList.add('transition');

  if (titleEl) titleEl.textContent = label;
  if (statusEl) statusEl.textContent = status;
}

export function setLocationTransitionStatus(status) {
  ensureElements();
  if (statusEl) statusEl.textContent = status;
}

export async function hideLocationTransition() {
  ensureElements();
  if (!loadingEl) return;

  const elapsed = performance.now() - shownAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  if (wait > 0) await delay(wait);

  loadingEl.classList.add('hidden');
  loadingEl.classList.remove('transition');
}
