export const LOCATION = {
  BASE: 'base',
  MISSION: 'mission',
};

const LABELS = {
  [LOCATION.BASE]: 'Base',
  [LOCATION.MISSION]: 'Map 01',
};

export class LocationMenu {
  constructor({ onSelect }) {
    this.onSelect = onSelect;
    this.active = LOCATION.MISSION;
    this.busy = false;
    this._build();
  }

  _build() {
    const nav = document.createElement('nav');
    nav.id = 'location-menu';
    nav.setAttribute('aria-label', 'Changer de lieu');
    nav.innerHTML = `
      <span class="location-menu-label">Lieu</span>
      <div class="location-menu-tabs" role="tablist">
        <button type="button" class="location-tab" data-location="${LOCATION.MISSION}" role="tab">Map 01</button>
        <button type="button" class="location-tab" data-location="${LOCATION.BASE}" role="tab">Base</button>
      </div>
      <span class="location-menu-status" aria-live="polite"></span>
    `;

    const hud = document.getElementById('hud');
    hud.appendChild(nav);

    this.root = nav;
    this.tabs = [...nav.querySelectorAll('.location-tab')];
    this.statusEl = nav.querySelector('.location-menu-status');

    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        const location = tab.dataset.location;
        if (this.busy || location === this.active) return;
        this.onSelect(location);
      });
    }

    this.setActive(LOCATION.MISSION);
  }

  setActive(location) {
    this.active = location;
    for (const tab of this.tabs) {
      const selected = tab.dataset.location === location;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    this.statusEl.textContent = LABELS[location] ?? '';
  }

  setBusy(busy) {
    this.busy = busy;
    this.root.classList.toggle('busy', busy);
    for (const tab of this.tabs) {
      tab.disabled = busy;
    }
    this.statusEl.textContent = busy ? 'Chargement…' : (LABELS[this.active] ?? '');
  }
}
