/** Réticule permanent au centre de l'écran. */
export function initCrosshair() {
  if (document.getElementById('crosshair')) return;

  const style = document.createElement('style');
  style.textContent = `
    #crosshair {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 22px;
      height: 22px;
      pointer-events: none;
      z-index: 50;
    }
    #crosshair .crosshair-line {
      position: absolute;
      background: rgba(255, 248, 220, 0.92);
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.65);
    }
    #crosshair .crosshair-h {
      left: 2px;
      right: 2px;
      top: 50%;
      height: 2px;
      margin-top: -1px;
    }
    #crosshair .crosshair-v {
      top: 2px;
      bottom: 2px;
      left: 50%;
      width: 2px;
      margin-left: -1px;
    }
    #crosshair .crosshair-dot {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 4px;
      height: 4px;
      margin: -2px 0 0 -2px;
      border-radius: 50%;
      background: rgba(255, 220, 120, 0.95);
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'crosshair';
  el.setAttribute('aria-hidden', 'true');

  const h = document.createElement('span');
  h.className = 'crosshair-line crosshair-h';
  const v = document.createElement('span');
  v.className = 'crosshair-line crosshair-v';
  const dot = document.createElement('span');
  dot.className = 'crosshair-dot';

  el.append(h, v, dot);
  document.getElementById('hud')?.appendChild(el);
}
