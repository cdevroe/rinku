const state = {
  libraryRoot: localStorage.getItem('rinku.libraryRoot') || '',
  settings: null,
  filters: { status: 'active' },
  links: [],
  selectedId: '',
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function setStatus(message) {
  els.status.textContent = message || '';
}

function showError(error) {
  console.error(error);
  setStatus(error && error.message ? error.message : String(error));
}

function labelName(labelId) {
  const label = state.settings && state.settings.labels
    ? state.settings.labels.find((candidate) => candidate.id === labelId)
    : null;
  return label ? label.name : labelId;
}

function renderLabelOptions(selectEl, selectedValue) {
  selectEl.replaceChildren();
  if (!state.settings) return;
  for (const label of state.settings.labels) {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = label.name;
    option.selected = label.id === selectedValue;
    selectEl.appendChild(option);
  }
}

function renderFilters() {
  els.labelFilters.replaceChildren();
  if (!state.settings) return;

  const allButton = document.createElement('button');
  allButton.className = `filterRow${!state.filters.label ? ' active' : ''}`;
  allButton.textContent = 'All labels';
  allButton.addEventListener('click', () => {
    delete state.filters.label;
    refreshLinks();
  });
  els.labelFilters.appendChild(allButton);

  for (const label of state.settings.labels) {
    const button = document.createElement('button');
    button.className = `filterRow${state.filters.label === label.id ? ' active' : ''}`;
    button.textContent = label.name;
    button.style.setProperty('--label-color', label.color);
    button.addEventListener('click', () => {
      state.filters.label = label.id;
      refreshLinks();
    });
    els.labelFilters.appendChild(button);
  }
}

function renderQuickAdd() {
  renderLabelOptions(els.quickAddLabel, '');
  const unlabeled = Array.from(els.quickAddLabel.options).find((option) => option.value === 'unlabeled');
  if (unlabeled) unlabeled.selected = true;
}

function linkRow(link) {
  const button = document.createElement('button');
  button.className = `linkRow${link.id === state.selectedId ? ' active' : ''}`;
  button.dataset.id = link.id;

  const title = document.createElement('span');
  title.className = 'linkTitle';
  title.textContent = link.title;

  const meta = document.createElement('span');
  meta.className = 'linkMeta';
  const parts = [link.domain, labelName(link.label)];
  if (Array.isArray(link.contexts) && link.contexts.length) parts.push(link.contexts.join(', '));
  if (Array.isArray(link.tags) && link.tags.length) parts.push(`#${link.tags.join(' #')}`);
  meta.textContent = parts.filter(Boolean).join(' · ');

  button.append(title, meta);
  button.addEventListener('click', () => selectLink(link.id));
  return button;
}

function renderLinks() {
  els.linksList.replaceChildren();
  els.listCount.textContent = String(state.links.length);
  els.listTitle.textContent = state.filters.status === 'archived' ? 'Archive' : 'Links';

  for (const link of state.links) {
    els.linksList.appendChild(linkRow(link));
  }
}

async function refreshLinks() {
  if (!state.libraryRoot) return;
  const search = els.search.value.trim();
  const result = await window.rinku.listLinks(state.libraryRoot, {
    ...state.filters,
    search: search || undefined,
  });
  state.links = result.links;
  renderFilters();
  renderLinks();
  if (state.selectedId && !state.links.some((link) => link.id === state.selectedId)) {
    clearDetail();
  }
}

function clearDetail() {
  state.selectedId = '';
  els.emptyDetail.classList.remove('hidden');
  els.linkDetail.classList.add('hidden');
}

async function selectLink(id) {
  state.selectedId = id;
  renderLinks();
  const link = await window.rinku.readLink(state.libraryRoot, id);
  els.emptyDetail.classList.add('hidden');
  els.linkDetail.classList.remove('hidden');
  els.detailDomain.textContent = link.domain;
  els.detailTitle.textContent = link.title;
  els.detailUrl.textContent = link.url;
  els.detailOpen.onclick = () => window.rinku.openExternal(link.url);
  renderLabelOptions(els.detailLabel, link.label);
  els.detailContexts.value = (link.contexts || []).join(', ');
  els.detailTags.value = (link.tags || []).join(', ');
  els.detailBody.value = link.body || '';
  els.archiveDetail.textContent = link.status === 'archived' ? 'Restore' : 'Archive';
  els.archiveDetail.onclick = async () => {
    if (link.status === 'archived') {
      await window.rinku.restoreLink(state.libraryRoot, link.id);
    } else {
      await window.rinku.archiveLink(state.libraryRoot, link.id);
    }
    setStatus(link.status === 'archived' ? 'Link restored.' : 'Link archived.');
    clearDetail();
    await refreshLinks();
  };
}

function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function saveDetail() {
  if (!state.selectedId) return;
  const link = await window.rinku.updateLink(state.libraryRoot, state.selectedId, {
    label: els.detailLabel.value,
    contexts: splitCsv(els.detailContexts.value),
    tags: splitCsv(els.detailTags.value),
    body: els.detailBody.value,
  });
  setStatus('Link saved.');
  await refreshLinks();
  await selectLink(link.id);
}

async function openLibrary(libraryRoot) {
  state.libraryRoot = libraryRoot;
  localStorage.setItem('rinku.libraryRoot', libraryRoot);
  state.settings = await window.rinku.readSettings(libraryRoot);
  els.libraryPath.textContent = libraryRoot;
  els.importUnmark.disabled = false;
  renderQuickAdd();
  renderFilters();
  await refreshLinks();
}

async function chooseAndOpenLibrary() {
  const libraryRoot = await window.rinku.chooseLibraryDirectory();
  if (!libraryRoot) return;
  await openLibrary(libraryRoot);
}

async function chooseAndCreateLibrary() {
  const libraryRoot = await window.rinku.chooseLibraryDirectory();
  if (!libraryRoot) return;
  await window.rinku.createLibrary(libraryRoot);
  setStatus('Library created.');
  await openLibrary(libraryRoot);
}

async function importUnmark() {
  if (!state.libraryRoot) return;
  const filePath = await window.rinku.chooseUnmarkExport();
  if (!filePath) return;
  setStatus('Importing Unmark export...');
  const result = await window.rinku.importUnmark(state.libraryRoot, filePath);
  setStatus(`Imported ${result.added}/${result.total} links.`);
  await refreshLinks();
}

async function quickAdd(event) {
  event.preventDefault();
  if (!state.libraryRoot) return;
  const url = els.quickAddUrl.value.trim();
  if (!url) return;
  await window.rinku.createLink(state.libraryRoot, {
    url,
    title: els.quickAddTitle.value.trim() || url,
    label: els.quickAddLabel.value,
  });
  els.quickAddUrl.value = '';
  els.quickAddTitle.value = '';
  setStatus('Link added.');
  await refreshLinks();
}

function bindReviewButtons() {
  document.querySelectorAll('[data-review]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.review;
      state.filters = { status: 'active' };
      if (value === 'unlabeled') {
        state.filters.label = 'unlabeled';
      } else {
        state.filters.olderThanDays = Number(value);
      }
      refreshLinks().catch(showError);
    });
  });
}

function bindChromeButtons() {
  els.allLinksButton.addEventListener('click', () => {
    state.filters = { status: 'active' };
    refreshLinks().catch(showError);
  });
  els.archiveButton.addEventListener('click', () => {
    state.filters = { status: 'archived' };
    refreshLinks().catch(showError);
  });
}

function cacheElements() {
  [
    'archiveButton',
    'createLibrary',
    'detailBody',
    'detailContexts',
    'detailDomain',
    'detailLabel',
    'detailOpen',
    'detailTags',
    'detailTitle',
    'detailUrl',
    'emptyDetail',
    'importUnmark',
    'labelFilters',
    'libraryPath',
    'linkDetail',
    'linksList',
    'listCount',
    'listTitle',
    'openLibrary',
    'quickAddForm',
    'quickAddLabel',
    'quickAddTitle',
    'quickAddUrl',
    'saveDetail',
    'search',
    'status',
    'allLinksButton',
  ].forEach((id) => {
    els[id] = $(id);
  });
}

async function init() {
  cacheElements();
  els.openLibrary.addEventListener('click', () => chooseAndOpenLibrary().catch(showError));
  els.createLibrary.addEventListener('click', () => chooseAndCreateLibrary().catch(showError));
  els.importUnmark.addEventListener('click', () => importUnmark().catch(showError));
  els.quickAddForm.addEventListener('submit', (event) => quickAdd(event).catch(showError));
  els.saveDetail.addEventListener('click', () => saveDetail().catch(showError));
  els.search.addEventListener('input', () => refreshLinks().catch(showError));
  bindReviewButtons();
  bindChromeButtons();

  if (state.libraryRoot) {
    try {
      await openLibrary(state.libraryRoot);
    } catch (error) {
      showError(error);
      localStorage.removeItem('rinku.libraryRoot');
      state.libraryRoot = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(showError);
});

