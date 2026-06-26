import manifest from './asset-manifest.json';
import { previewRenderer, queueAllThumbnails } from './PreviewRenderer.js';

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  category: 'all',
  query: '',
};

function formatCategoryStats() {
  const total = manifest.stats.total;
  return `${total} assets · ${manifest.categories.length} catégories`;
}

function renderSidebar() {
  const nav = $('#nav');
  const allCount = manifest.stats.total;

  const allBtn = document.createElement('button');
  allBtn.className = `nav-item${state.category === 'all' ? ' active' : ''}`;
  allBtn.dataset.category = 'all';
  const allLabel = document.createElement('span');
  allLabel.textContent = 'Tout voir';
  const allBadge = document.createElement('span');
  allBadge.className = 'badge';
  allBadge.textContent = String(allCount);
  allBtn.append(allLabel, allBadge);
  nav.appendChild(allBtn);

  for (const cat of manifest.categories) {
    const btn = document.createElement('button');
    btn.className = `nav-item${state.category === cat.id ? ' active' : ''}`;
    btn.dataset.category = cat.id;
    const label = document.createElement('span');
    label.textContent = cat.label;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = String(cat.count);
    btn.append(label, badge);
    nav.appendChild(btn);
  }

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    state.category = btn.dataset.category;
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.category === state.category);
    });
    renderGrid();
  });
}

function getVisibleItems() {
  const q = state.query.toLowerCase().trim();
  const cats = state.category === 'all'
    ? manifest.categories
    : manifest.categories.filter((c) => c.id === state.category);

  const items = [];
  for (const cat of cats) {
    for (const item of cat.items) {
      if (q && !`${item.name} ${item.filename} ${item.source}`.toLowerCase().includes(q)) continue;
      items.push({ ...item, categoryLabel: cat.label, categoryId: cat.id });
    }
  }
  return items;
}

function renderGrid() {
  const grid = $('#grid');
  const items = getVisibleItems();

  $('#result-count').textContent = `${items.length} élément${items.length > 1 ? 's' : ''}`;

  if (!items.length) {
    grid.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Aucun asset trouvé.';
    grid.appendChild(empty);
    $('#progress').textContent = '';
    return;
  }

  grid.textContent = '';
  const frag = document.createDocumentFragment();

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'asset-card';
    card.dataset.path = item.path;

    const previewWrap = document.createElement('div');
    previewWrap.className = 'preview-wrap is-loading';

    const img = document.createElement('img');
    img.className = 'preview-img';
    img.alt = item.name;
    img.dataset.path = item.path;

    const formatTag = document.createElement('span');
    formatTag.className = 'format-tag';
    formatTag.textContent = item.format.toUpperCase();

    const loader = document.createElement('span');
    loader.className = 'preview-loader';
    loader.textContent = '…';

    previewWrap.append(img, loader, formatTag);

    const body = document.createElement('div');
    body.className = 'card-body';

    const category = document.createElement('p');
    category.className = 'card-category';
    category.textContent = item.categoryLabel;

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = item.name;

    const file = document.createElement('p');
    file.className = 'card-file';
    file.textContent = item.filename;

    body.append(category, title, file);
    card.append(previewWrap, body);
    frag.appendChild(card);
  }

  grid.appendChild(frag);
  queueAllThumbnails(items);
}

function setupSearch() {
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderGrid();
  });
}

function setupProgress() {
  previewRenderer.onProgress((done, total) => {
    const el = $('#progress');
    if (!total) {
      el.textContent = '';
      return;
    }
    if (done >= total) {
      el.textContent = `${total} aperçus générés`;
      return;
    }
    el.textContent = `Génération des aperçus… ${done}/${total}`;
  });
}

function init() {
  $('#stats').textContent = formatCategoryStats();
  $('#generated').textContent = `MAJ ${new Date(manifest.generatedAt).toLocaleString('fr-FR')}`;
  setupProgress();
  renderSidebar();
  renderGrid();
  setupSearch();
}

init();
