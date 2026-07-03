/** Plein écran mobile — masque la barre d’adresse (Chrome Android) et maximise la zone de jeu (iOS/Android). */

export function isMobileDevice() {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200)
  );
}

export function getViewportSize() {
  const vv = window.visualViewport;
  if (vv) {
    return {
      width: Math.max(1, Math.round(vv.width)),
      height: Math.max(1, Math.round(vv.height)),
    };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

export function applyViewportCssVars() {
  const { width, height } = getViewportSize();
  const root = document.documentElement;
  root.style.setProperty('--app-width', `${width}px`);
  root.style.setProperty('--app-height', `${height}px`);
  return { width, height };
}

export function requestAppFullscreen(element = document.documentElement) {
  const el = element;
  const fn =
    el.requestFullscreen
    || el.webkitRequestFullscreen
    || el.webkitEnterFullscreen
    || el.mozRequestFullScreen
    || el.msRequestFullscreen;
  if (!fn) return Promise.resolve(false);
  return Promise.resolve(fn.call(el))
    .then(() => true)
    .catch(() => false);
}

function hideMobileBrowserChrome() {
  // iOS Safari : scroll minimal pour replier la barre d’adresse
  window.scrollTo(0, 1);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

/**
 * @param {{ onResize?: (width: number, height: number) => void }} options
 * @returns {() => void} sync viewport
 */
export function initMobileFullscreen({ onResize } = {}) {
  document.documentElement.classList.add('hdm-mobile-ready');

  const sync = () => {
    const size = applyViewportCssVars();
    onResize?.(size.width, size.height);
  };

  sync();

  if (!isMobileDevice()) {
    window.addEventListener('resize', sync);
    return sync;
  }

  document.documentElement.classList.add('hdm-mobile');

  hideMobileBrowserChrome();
  window.addEventListener('load', hideMobileBrowserChrome);
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      hideMobileBrowserChrome();
      sync();
    }, 300);
  });

  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  let immersiveRequested = false;
  const enterImmersive = () => {
    hideMobileBrowserChrome();
    sync();
    if (immersiveRequested) return;
    immersiveRequested = true;
    requestAppFullscreen(document.documentElement).finally(() => {
      sync();
      // iOS ne supporte pas requestFullscreen sur document — on retente au prochain geste
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        immersiveRequested = false;
      }
    });
  };

  document.addEventListener('touchstart', enterImmersive, { passive: true });
  document.addEventListener('click', enterImmersive);

  return sync;
}

/** À appeler très tôt (inline dans index.html) avant le premier paint. */
export function bootstrapViewportEarly() {
  applyViewportCssVars();
  if (isMobileDevice()) hideMobileBrowserChrome();
}
