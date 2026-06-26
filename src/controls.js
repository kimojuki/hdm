const KEYS = {
  KeyW: [0, -1],
  KeyZ: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyQ: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export class InputManager {
  constructor(target) {
    this.keys = new Set();
    this.joystick = { x: 0, y: 0, active: false };
    this._jumpQueued = false;
    this.target = target;

    const onKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this._jumpQueued = true;
        return;
      }
      if (!KEYS[e.code]) return;
      e.preventDefault();
      this.keys.add(e.code);
    };

    const onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    const onBlur = () => this.keys.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    if (target) {
      target.tabIndex = 0;
      target.style.outline = 'none';
      target.addEventListener('keydown', onKeyDown);
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('click', () => target.focus());
    }

    this._setupJoystick();
    this._setupJumpButton();
  }

  consumeJump() {
    const jump = this._jumpQueued;
    this._jumpQueued = false;
    return jump;
  }

  queueJump() {
    this._jumpQueued = true;
  }

  focus() {
    this.target?.focus();
  }

  _setupJoystick() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const stick = document.getElementById('joystick-stick');
    if (!zone || !base || !stick) return;

    const radius = () => base.clientWidth / 2;
    const stickRadius = () => stick.clientWidth / 2;
    let touchId = null;
    let centerX = 0;
    let centerY = 0;

    const reset = () => {
      touchId = null;
      this.joystick.x = 0;
      this.joystick.y = 0;
      this.joystick.active = false;
      stick.style.transform = 'translate(-50%, -50%)';
      stick.classList.remove('active');
    };

    const update = (clientX, clientY) => {
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = radius() - stickRadius();
      const clamped = Math.min(dist, maxDist);
      const angle = Math.atan2(dy, dx);

      const sx = Math.cos(angle) * clamped;
      const sy = Math.sin(angle) * clamped;
      stick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
      stick.classList.add('active');

      this.joystick.x = (sx / maxDist);
      this.joystick.y = (sy / maxDist);
      this.joystick.active = true;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchId !== null) return;
      const touch = e.changedTouches[0];
      touchId = touch.identifier;
      const rect = base.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      update(touch.clientX, touch.clientY);
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          update(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    zone.addEventListener('touchend', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) reset();
      }
    });

    zone.addEventListener('touchcancel', reset);
  }

  _setupJumpButton() {
    const btn = document.getElementById('jump-btn');
    if (!btn) return;

    const queue = (e) => {
      e.preventDefault();
      this.queueJump();
    };

    btn.addEventListener('touchstart', queue, { passive: false });
    btn.addEventListener('mousedown', queue);
  }

  getMoveVector() {
    let x = 0;
    let y = 0;

    for (const code of this.keys) {
      const [kx, ky] = KEYS[code];
      x += kx;
      y += ky;
    }

    if (this.joystick.active) {
      x += this.joystick.x;
      y += this.joystick.y;
    }

    const len = Math.sqrt(x * x + y * y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    return { x, y };
  }
}
