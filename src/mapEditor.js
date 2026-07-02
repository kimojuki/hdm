import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PREFAB_CATEGORIES } from './prefabs.js';
import { snapObjectBaseToSurface } from './terrain.js';

const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

let nextPlacementId = 1;

function prepareFbxModel(fbx, texture) {
  fbx.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (texture) {
      child.material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.02,
      });
    }
  });
  return fbx;
}

function makeGhostMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x88ffcc,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
}

export class MapEditor {
  constructor({
    canvas,
    camera,
    scene,
    getTerrainRoots,
    getMapHalf,
    textures,
    collisionWorld,
    mountainsGroup,
  }) {
    this.canvas = canvas;
    this.camera = camera;
    this.scene = scene;
    this.getTerrainRoots = getTerrainRoots;
    this.getMapHalf = getMapHalf;
    this.textures = textures;
    this.collisionWorld = collisionWorld;
    this.mountainsGroup = mountainsGroup;

    this.active = false;
    this.toolMode = 'select';
    this.placedGroup = new THREE.Group();
    this.placedGroup.name = 'editor-placed';
    scene.add(this.placedGroup);

    this.placements = [];
    this.selected = null;
    this.categoryIndex = 0;
    this.modelIndex = 0;
    this.placementRot = 0;
    this.placementScale = PREFAB_CATEGORIES[0].defaultScale;

    this.loader = new FBXLoader();
    this.modelCache = new Map();
    this.ghost = null;
    this.ghostKey = '';

    this.pointerDown = null;
    this.drag = null;
    this.selectionHelper = new THREE.BoxHelper(new THREE.Mesh(), 0xe8a84b);
    this.selectionHelper.visible = false;
    scene.add(this.selectionHelper);

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);

    this._buildUI();
  }

  /** Enregistre les objets déjà présents sur la map (bâtiments, montagnes, plantes…). */
  registerExisting(entries) {
    for (const entry of entries) {
      const cat = PREFAB_CATEGORIES.find((c) => c.id === entry.categoryId);
      if (!cat) continue;
      this.placements.push({
        id: nextPlacementId++,
        categoryId: entry.categoryId,
        model: entry.model,
        scale: entry.scale,
        object: entry.object,
        collider: entry.collider ?? null,
        fromMap: true,
      });
    }
  }

  isActive() {
    return this.active;
  }

  toggle() {
    this.active = !this.active;
    this.panel.classList.toggle('visible', this.active);
    this.canvas.classList.toggle('editor-active', this.active);
    if (this.active) {
      this.canvas.addEventListener('pointerdown', this._onPointerDown);
      this.canvas.addEventListener('pointerup', this._onPointerUp);
      this.canvas.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('keydown', this._onKeyDown);
      this._syncPlacementDefaults();
      this._refreshGhost();
      this._setStatus('Mode sélection — clic sur un objet ou glisser pour déplacer');
    } else {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
      this.canvas.removeEventListener('pointerup', this._onPointerUp);
      this.canvas.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('keydown', this._onKeyDown);
      this._clearGhost();
      this._deselect();
      this.drag = null;
    }
  }

  update() {
    if (!this.active) return;

    if (this.selected) {
      this.selectionHelper.setFromObject(this.selected.object);
      this.selectionHelper.visible = true;
    } else {
      this.selectionHelper.visible = false;
    }

    if (this.toolMode !== 'place' || this.selected || !this.ghost) return;

    const hit = this._pickGround(this._lastPointer?.x, this._lastPointer?.y);
    if (!hit) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.set(hit.x, 0, hit.z);
    this.ghost.rotation.y = this.placementRot;
    snapObjectBaseToSurface(this.ghost, this.getTerrainRoots(), this._category().yOffset);
  }

  exportLayout() {
    return {
      version: 1,
      items: this.placements.map((p) => ({
        category: p.categoryId,
        model: p.model,
        x: +p.object.position.x.toFixed(2),
        z: +p.object.position.z.toFixed(2),
        rot: +p.object.rotation.y.toFixed(4),
        scale: p.scale,
      })),
    };
  }

  _getCategoryById(id) {
    return PREFAB_CATEGORIES.find((c) => c.id === id);
  }

  _category() {
    return PREFAB_CATEGORIES[this.categoryIndex];
  }

  _categoryForEntry(entry) {
    return this._getCategoryById(entry.categoryId);
  }

  _ghostCacheKey() {
    const cat = this._category();
    return `${cat.id}:${cat.models[this.modelIndex]}`;
  }

  async _loadModel(category, modelIndex) {
    const filename = category.models[modelIndex];
    const cacheKey = `${category.basePath}/${filename}`;
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);

    const fbx = await this.loader.loadAsync(`${category.basePath}/${filename}`);
    const texture = this.textures[category.textureKey] ?? null;
    const prepared = prepareFbxModel(fbx, texture);
    this.modelCache.set(cacheKey, prepared);
    return prepared;
  }

  async _refreshGhost() {
    if (this.toolMode !== 'place') {
      this._clearGhost();
      return;
    }

    const cat = this._category();
    const key = this._ghostCacheKey();
    if (this.ghostKey === key && this.ghost) return;

    this._clearGhost();
    try {
      const source = await this._loadModel(cat, this.modelIndex);
      this.ghost = source.clone();
      this.ghost.traverse((child) => {
        if (!child.isMesh) return;
        child.material = makeGhostMaterial();
      });
      this.ghost.scale.setScalar(this.placementScale * cat.unitScale);
      this.ghost.visible = false;
      this.scene.add(this.ghost);
      this.ghostKey = key;
    } catch (err) {
      console.warn('[editor] ghost load failed', err);
      this._setStatus('Erreur chargement prefab');
    }
  }

  _clearGhost() {
    if (this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = null;
      this.ghostKey = '';
    }
  }

  _setToolMode(mode) {
    this.toolMode = mode;
    this.placeBtn.classList.toggle('active', mode === 'place');
    this.selectBtn.classList.toggle('active', mode === 'select');
    if (mode === 'place') {
      this._refreshGhost();
      this._setStatus('Mode placement — clic sur le sol pour poser');
    } else {
      this._clearGhost();
      this._setStatus('Mode sélection — clic ou glisser un objet');
    }
  }

  _pickGround(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    _raycaster.setFromCamera(_ndc, this.camera);
    const hits = _raycaster.intersectObjects(this.getTerrainRoots(), true);
    if (hits.length === 0) return null;

    const mapHalf = this.getMapHalf();
    const p = hits[0].point;
    if (Math.abs(p.x) > mapHalf || Math.abs(p.z) > mapHalf) return null;
    return p;
  }

  _pickPlaced(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    _raycaster.setFromCamera(_ndc, this.camera);
    const roots = this.placements.map((p) => p.object);
    const hits = _raycaster.intersectObjects(roots, true);
    if (hits.length === 0) return null;

    let node = hits[0].object;
    while (node) {
      const found = this.placements.find((p) => p.object === node);
      if (found) return found;
      node = node.parent;
    }
    return null;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('#map-editor')) return;

    const picked = this._pickPlaced(e.clientX, e.clientY);
    if (picked) {
      this._select(picked);
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        moved: false,
        entry: picked,
      };
      return;
    }

    if (this.toolMode === 'select') {
      this._deselect();
      this.pointerDown = { x: e.clientX, y: e.clientY };
      return;
    }

    this.pointerDown = { x: e.clientX, y: e.clientY };
  }

  onPointerMove(e) {
    this._lastPointer = { x: e.clientX, y: e.clientY };

    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;

      if (this.drag.moved && this.selected) {
        const hit = this._pickGround(e.clientX, e.clientY);
        if (hit) this._moveSelected(hit.x, hit.z, false);
      }
    }
  }

  async onPointerUp(e) {
    if (e.button !== 0) return;

    if (this.drag) {
      const wasDrag = this.drag.moved;
      this.drag = null;
      if (wasDrag && this.selected) {
        this._finalizeMove(this.selected);
        this._setStatus('Objet déplacé');
      }
      return;
    }

    if (!this.pointerDown) return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    this.pointerDown = null;
    if (Math.hypot(dx, dy) > 6) return;

    if (this.toolMode !== 'place') return;

    const hit = this._pickGround(e.clientX, e.clientY);
    if (!hit) return;
    await this._placeAt(hit.x, hit.z);
  }

  onKeyDown(e) {
    if (!this.active) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'KeyQ') {
      this._adjustRotation(-Math.PI / 12);
      e.preventDefault();
    } else if (e.code === 'KeyR') {
      this._adjustRotation(Math.PI / 12);
      e.preventDefault();
    } else if (e.code === 'BracketLeft') {
      this._adjustScale(-0.05);
      e.preventDefault();
    } else if (e.code === 'BracketRight') {
      this._adjustScale(0.05);
      e.preventDefault();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      this._deleteSelected();
      e.preventDefault();
    } else if (e.code === 'Escape') {
      this._deselect();
      e.preventDefault();
    }
  }

  _adjustRotation(delta) {
    if (this.selected) {
      this.selected.object.rotation.y += delta;
      this.placementRot = this.selected.object.rotation.y;
      this.rotInput.value = +this.placementRot.toFixed(3);
      if (this.selected.collider) {
        this.collisionWorld.refreshStaticFromObject(this.selected.object);
      }
      return;
    }
    this.placementRot += delta;
    this.rotInput.value = +this.placementRot.toFixed(3);
    if (this.ghost) this.ghost.rotation.y = this.placementRot;
  }

  _adjustScale(delta) {
    const base = this.selected ? this.selected.scale : this.placementScale;
    const next = Math.max(0.1, +(base + delta).toFixed(2));
    this.placementScale = next;
    this.scaleInput.value = next;

    if (this.selected) {
      this._applyScaleToEntry(this.selected, next);
      return;
    }

    const cat = this._category();
    if (this.ghost) this.ghost.scale.setScalar(next * cat.unitScale);
  }

  _applyScaleToEntry(entry, scale) {
    const cat = this._categoryForEntry(entry);
    if (!cat) return;
    entry.scale = scale;
    entry.object.scale.setScalar(scale * cat.unitScale);
    snapObjectBaseToSurface(entry.object, this.getTerrainRoots(), cat.yOffset);
    if (entry.collider) {
      this.collisionWorld.refreshStaticFromObject(entry.object);
    }
  }

  _applyRotationToEntry(entry, rot) {
    entry.object.rotation.y = rot;
    if (entry.collider) {
      this.collisionWorld.refreshStaticFromObject(entry.object);
    }
  }

  _moveSelected(x, z, finalize = true) {
    if (!this.selected) return;
    const cat = this._categoryForEntry(this.selected);
    this.selected.object.position.set(x, 0, z);
    snapObjectBaseToSurface(this.selected.object, this.getTerrainRoots(), cat?.yOffset ?? 0.02);
    if (finalize) this._finalizeMove(this.selected);
  }

  _finalizeMove(entry) {
    if (entry.collider) {
      this.collisionWorld.refreshStaticFromObject(entry.object);
    }
  }

  async _placeAt(x, z) {
    const cat = this._category();
    try {
      const source = await this._loadModel(cat, this.modelIndex);
      const instance = source.clone();
      instance.position.set(x, 0, z);
      instance.rotation.y = this.placementRot;
      instance.scale.setScalar(this.placementScale * cat.unitScale);
      this.placedGroup.add(instance);
      snapObjectBaseToSurface(instance, this.getTerrainRoots(), cat.yOffset);

      const entry = {
        id: nextPlacementId++,
        categoryId: cat.id,
        model: this.modelIndex,
        scale: this.placementScale,
        object: instance,
        collider: null,
        fromMap: false,
      };

      if (cat.terrain && this.mountainsGroup) this.mountainsGroup.add(instance);
      if (cat.collision) {
        entry.collider = this.collisionWorld.addStaticFromObject(instance);
      } else if (cat.steepCollision) {
        entry.collider = this.collisionWorld.addStaticFromObject(instance, { steepOnly: true });
      }

      this.placements.push(entry);
      this._select(entry);
      this._setStatus(`Placé : ${cat.models[this.modelIndex]} (${this.placements.length} objets)`);
    } catch (err) {
      console.error('[editor] place failed', err);
      this._setStatus('Échec placement');
    }
  }

  _select(entry) {
    this._deselect();
    this.selected = entry;
    const cat = this._categoryForEntry(entry);
    this.selectionLabel.textContent = `${entry.categoryId} / ${cat?.models[entry.model] ?? '?'}`;

    this.placementScale = entry.scale;
    this.placementRot = entry.object.rotation.y;
    this.scaleInput.value = entry.scale;
    this.rotInput.value = +entry.object.rotation.y.toFixed(3);

    if (cat) {
      const catIdx = PREFAB_CATEGORIES.indexOf(cat);
      if (catIdx >= 0) {
        this.categoryIndex = catIdx;
        this.categorySelect.value = String(catIdx);
        this.modelIndex = entry.model;
        this._populateModelList();
      }
    }

    entry.object.traverse((child) => {
      if (!child.isMesh) return;
      child.material = child.material.clone();
      child.material.emissive = new THREE.Color(0x335533);
    });

    this._setStatus('Objet sélectionné — glisser pour déplacer, [ ] échelle, Q/R rotation');
  }

  _deselect() {
    if (!this.selected) return;
    this.selected.object.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      child.material.emissive?.setHex(0x000000);
    });
    this.selected = null;
    this.selectionLabel.textContent = 'Aucune';
    this.selectionHelper.visible = false;
  }

  _deleteSelected() {
    if (!this.selected) return;
    const entry = this.selected;
    const idx = this.placements.indexOf(entry);
    if (idx >= 0) this.placements.splice(idx, 1);

    if (entry.collider) {
      this.collisionWorld.removeStaticFromObject(entry.object);
    }

    entry.object.removeFromParent();
    this._setStatus(entry.fromMap ? 'Objet map supprimé' : 'Objet supprimé');
    this._deselect();
  }

  _syncPlacementDefaults() {
    const cat = this._category();
    if (!this.selected) {
      this.placementScale = cat.defaultScale;
      this.placementRot = 0;
      this.scaleInput.value = this.placementScale;
      this.rotInput.value = 0;
    }
    this._populateModelList();
    this._refreshGhost();
  }

  _populateModelList() {
    const cat = this._category();
    this.modelSelect.innerHTML = '';
    cat.models.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = name.replace('.fbx', '');
      this.modelSelect.appendChild(opt);
    });
    this.modelIndex = Math.min(this.modelIndex, cat.models.length - 1);
    this.modelSelect.value = String(this.modelIndex);
  }

  _exportJson() {
    const json = JSON.stringify(this.exportLayout(), null, 2);
    navigator.clipboard.writeText(json).then(() => {
      this._setStatus(`Export copié (${this.placements.length} objets)`);
    }).catch(() => {
      console.log(json);
      this._setStatus('Export dans la console (F12)');
    });
  }

  _setStatus(msg) {
    this.statusEl.textContent = msg;
  }

  _buildUI() {
    const panel = document.createElement('div');
    panel.id = 'map-editor';
    panel.innerHTML = `
      <div class="editor-header">
        <strong>Éditeur de map</strong>
        <span class="editor-badge">E</span>
      </div>
      <div class="editor-tool-row">
        <button type="button" id="editor-tool-select" class="editor-tool active">Sélection</button>
        <button type="button" id="editor-tool-place" class="editor-tool">Placer</button>
      </div>
      <label>Catégorie
        <select id="editor-category"></select>
      </label>
      <label>Prefab
        <select id="editor-model"></select>
      </label>
      <label>Échelle
        <input id="editor-scale" type="number" min="0.1" max="5" step="0.05" value="1" />
      </label>
      <label>Rotation (rad)
        <input id="editor-rot" type="number" step="0.1" value="0" />
      </label>
      <div class="editor-actions">
        <button type="button" id="editor-export">Exporter JSON</button>
        <button type="button" id="editor-delete">Supprimer</button>
      </div>
      <p class="editor-selection">Sélection : <span id="editor-selection-label">Aucune</span></p>
      <p class="editor-hints">
        Sélection : clic objet · glisser — déplacer<br/>
        Placer : mode Placer + clic sol · Q/R — rotation<br/>
        [ ] — échelle · Suppr — effacer · Échap — désélectionner
      </p>
      <p class="editor-status" id="editor-status"></p>
    `;
    document.getElementById('hud').appendChild(panel);
    this.panel = panel;

    this.placeBtn = panel.querySelector('#editor-tool-place');
    this.selectBtn = panel.querySelector('#editor-tool-select');
    this.categorySelect = panel.querySelector('#editor-category');
    this.modelSelect = panel.querySelector('#editor-model');
    this.scaleInput = panel.querySelector('#editor-scale');
    this.rotInput = panel.querySelector('#editor-rot');
    this.selectionLabel = panel.querySelector('#editor-selection-label');
    this.statusEl = panel.querySelector('#editor-status');

    PREFAB_CATEGORIES.forEach((cat, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = cat.label;
      this.categorySelect.appendChild(opt);
    });

    this.selectBtn.addEventListener('click', () => this._setToolMode('select'));
    this.placeBtn.addEventListener('click', () => this._setToolMode('place'));

    this.categorySelect.addEventListener('change', () => {
      this.categoryIndex = +this.categorySelect.value;
      this.modelIndex = 0;
      this._syncPlacementDefaults();
    });

    this.modelSelect.addEventListener('change', () => {
      this.modelIndex = +this.modelSelect.value;
      this._refreshGhost();
    });

    this.scaleInput.addEventListener('input', () => {
      const val = Math.max(0.1, +this.scaleInput.value || 1);
      this.placementScale = val;
      if (this.selected) {
        this._applyScaleToEntry(this.selected, val);
      } else {
        const cat = this._category();
        if (this.ghost) this.ghost.scale.setScalar(val * cat.unitScale);
      }
    });

    this.rotInput.addEventListener('input', () => {
      const val = +this.rotInput.value || 0;
      this.placementRot = val;
      if (this.selected) {
        this._applyRotationToEntry(this.selected, val);
      } else if (this.ghost) {
        this.ghost.rotation.y = val;
      }
    });

    panel.querySelector('#editor-export').addEventListener('click', () => this._exportJson());
    panel.querySelector('#editor-delete').addEventListener('click', () => this._deleteSelected());

    this._populateModelList();
    this._setToolMode('select');
  }
}
