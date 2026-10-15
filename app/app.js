const state = {
  libraryRoot: localStorage.getItem('rinku.libraryRoot') || '',
  settings: null,
  captureStatus: null,
  filters: { status: 'active' },
  indexLinks: [],
  indexLoaded: false,
  links: [],
  facetLinks: [],
  selectedId: '',
  currentDetail: null,
  detailTags: [],
  captureReview: null,
  captureReviewTags: [],
  navMode: 'links',
  settingsTab: 'library',
  virtualListActive: false,
  sidebarExpanded: { links: false, contexts: false, tags: false },
  quickAddExpanded: false,
  quickAddPending: false,
  focusedLinkId: '',
};

const els = {};
let statusTimer = null;
let detailSaveTimer = null;
let detailSaveInFlight = null;
let captureReviewSaveTimer = null;
let captureReviewSaveInFlight = null;
let virtualRenderFrame = 0;
let virtualRenderKey = '';
let captureReviewReturnFocus = null;
let captureReviewClosing = null;
let refreshSafariCaptureStatus = null;
let libraryRefreshPending = false;
let libraryRefreshInFlight = false;

const LINK_ROW_HEIGHT = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--link-row-height')) || 98;
const LINK_ROW_OVERSCAN = 8;

const FEATHER_ICONS = {
  archive: '<polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line>',
  atSign: '<circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>',
  check: '<polyline points="20 6 9 17 4 12"></polyline>',
  chevronDown: '<polyline points="6 9 12 15 18 9"></polyline>',
  circle: '<circle cx="12" cy="12" r="10"></circle>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
  externalLink: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>',
  info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
  link: '<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path>',
  list: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
  rotateCcw: '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
  search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.37l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.63.76 1.08 1.43 1.08H21a2 2 0 1 1 0 4h-.09c-.67 0-1.24.44-1.51 1z"></path>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
  x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
};

function $(id) {
  return document.getElementById(id);
}

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(className);
  svg.innerHTML = FEATHER_ICONS[name] || FEATHER_ICONS.circle;
  return svg;
}

function setButtonIcon(button, name) {
  button.prepend(icon(name));
}

function setIconOnly(button, name) {
  button.replaceChildren(icon(name));
}

function setStatus(message) {
  window.clearTimeout(statusTimer);
  els.status.textContent = message || '';
  els.status.classList.toggle('visible', Boolean(message));
  if (message) {
    statusTimer = window.setTimeout(() => setStatus(''), 5000);
  }
}

function showError(error) {
  console.error(error);
  setStatus(error && error.message ? error.message : String(error));
}

function labelForId(labelId) {
  return state.settings && state.settings.labels
    ? state.settings.labels.find((candidate) => candidate.id === labelId)
    : null;
}

function labelName(labelId) {
  const label = labelForId(labelId);
  return label ? label.name : labelId;
}

function labelColor(labelId) {
  const label = labelForId(labelId);
  return label ? label.color : '#9aa6b2';
}

function countFormat(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function relativeDate(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffMs = timestamp - Date.now();
  const diffDays = Math.round(diffMs / 86400000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(diffDays) < 1) {
    return 'today';
  }
  if (Math.abs(diffDays) < 31) {
    return rtf.format(diffDays, 'day');
  }
  if (Math.abs(diffDays) < 365) {
    return rtf.format(Math.round(diffDays / 30), 'month');
  }
  return rtf.format(Math.round(diffDays / 365), 'year');
}

function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function slugValue(value) {
  const text = String(value || '').trim().replace(/^#/, '').toLowerCase();
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTag(value) {
  return slugValue(value);
}

function normalizeTags(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    output.push(tag);
  }
  return output;
}

function uniqueDisplayList(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) {
      continue;
    }
    const identity = text.toLowerCase();
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    output.push(text);
  }

  return output;
}

function linkMatchesLocalFilters(link, filters = {}, search = '') {
  if (filters.status && link.status !== filters.status) {
    return false;
  }

  if (filters.label && link.label !== filters.label) {
    return false;
  }

  if (filters.context) {
    const wanted = contextDisplay(filters.context).toLowerCase();
    if (!Array.isArray(link.contexts) || !link.contexts.some((item) => contextDisplay(item).toLowerCase() === wanted)) {
      return false;
    }
  }

  if (filters.tag) {
    const wanted = normalizeTag(filters.tag);
    if (!Array.isArray(link.tags) || !link.tags.some((item) => normalizeTag(item) === wanted)) {
      return false;
    }
  }

  if (search) {
    const haystack = `${link.title}\n${link.url}\n${link.domain}\n${(link.tags || []).join(' ')}\n${(link.contexts || []).join(' ')}`.toLowerCase();
    const tokens = String(search).toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => haystack.includes(token))) {
      return false;
    }
  }

  if (filters.olderThanDays) {
    const days = Number(filters.olderThanDays);
    const created = Date.parse(link.createdAt);
    if (!Number.isFinite(days) || !Number.isFinite(created)) {
      return false;
    }
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    if (created > cutoff) {
      return false;
    }
  }

  return true;
}

async function reloadIndex(options = {}) {
  if (!state.libraryRoot) {
    state.indexLinks = [];
    state.indexLoaded = false;
    return;
  }

  const libraryRoot = state.libraryRoot;
  const result = await window.rinku.listLinks(libraryRoot, {
    rebuild: options.rebuild === true,
  });
  if (libraryRoot !== state.libraryRoot) return;
  state.indexLinks = result.links;
  state.indexLoaded = true;
}

function contextDisplay(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.startsWith('@') ? text : `@${text}`;
}

function contextOptions(extraContexts = []) {
  const configured = state.settings && Array.isArray(state.settings.contexts)
    ? state.settings.contexts
    : [];
  const discovered = state.indexLinks.flatMap((link) => Array.isArray(link.contexts) ? link.contexts : []);
  const extras = Array.isArray(extraContexts) ? extraContexts : [];
  const configuredSet = new Set(configured.map((item) => item.toLowerCase()));
  const sortedDiscovered = uniqueDisplayList([...discovered, ...extras].map(contextDisplay))
    .filter((item) => !configuredSet.has(item.toLowerCase()))
    .sort((left, right) => left.localeCompare(right));

  return uniqueDisplayList([...configured.map(contextDisplay), ...sortedDiscovered]);
}

function tagOptions(extraTags = []) {
  const discovered = state.indexLinks.flatMap((link) => Array.isArray(link.tags) ? link.tags : []);
  return normalizeTags([...discovered, ...extraTags])
    .sort((left, right) => left.localeCompare(right));
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const values = selector(item);
    for (const value of values) {
      if (!value) {
        continue;
      }
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return counts;
}

function clearDetail(options = {}) {
  state.selectedId = '';
  state.currentDetail = null;
  state.detailTags = [];
  window.clearTimeout(detailSaveTimer);
  detailSaveTimer = null;
  els.content.classList.remove('detailOpen');
  els.detailPane.classList.add('hidden');
  if (options.render !== false) {
    renderLinks();
  }
}

function activeFilterCount(filters = state.filters) {
  return ['label', 'context', 'tag', 'olderThanDays']
    .filter((key) => filters[key] !== undefined && filters[key] !== '').length;
}

function cleanFilters(filters) {
  const next = { status: filters.status || 'active' };
  for (const key of ['label', 'context', 'tag', 'olderThanDays']) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      next[key] = filters[key];
    }
  }
  return next;
}

async function applyFilters(patch = {}, options = {}) {
  await flushDetailSave();
  state.filters = options.reset === true
    ? cleanFilters({ status: patch.status || state.filters.status || 'active', ...patch })
    : cleanFilters({ ...state.filters, ...patch });
  clearDetail({ render: false });
  await refreshLinks({ resetScroll: true });
}

async function toggleFilter(key, value) {
  await applyFilters({
    [key]: state.filters[key] === value ? undefined : value,
  });
}

function setQuickAddExpanded(expanded) {
  state.quickAddExpanded = expanded;
  els.quickAddForm.classList.toggle('expanded', expanded);
  els.quickAddUrl.classList.toggle('hidden', !expanded);
  els.quickAddSubmit.type = expanded ? 'submit' : 'button';
  els.quickAddSubmit.setAttribute('aria-expanded', String(expanded));
  if (expanded) {
    els.quickAddUrl.focus();
  }
}

function filterRow({ label, count, active, color, iconName, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `filterRow${active ? ' active' : ''}`;
  button.dataset.focusKey = `filter:${label}`;
  if (active !== undefined) button.setAttribute('aria-pressed', String(Boolean(active)));
  button.addEventListener('click', () => onClick().catch(showError));

  const main = document.createElement('span');
  main.className = 'filterMain';

  if (color) {
    const dot = document.createElement('span');
    dot.className = 'labelDot';
    dot.style.background = color;
    main.appendChild(dot);
  } else if (iconName) {
    main.appendChild(icon(iconName, 'filterIcon'));
  }

  const name = document.createElement('span');
  name.textContent = label;
  main.appendChild(name);
  button.appendChild(main);

  if (count !== undefined) {
    const countEl = document.createElement('span');
    countEl.className = 'filterCount';
    countEl.textContent = countFormat(count);
    button.appendChild(countEl);
  }

  return button;
}

function emptySidebar(text) {
  const empty = document.createElement('div');
  empty.className = 'sideEmpty';
  empty.textContent = text;
  return empty;
}

function filterSection(container, title) {
  const heading = document.createElement('h3');
  heading.className = 'filterSectionTitle';
  heading.textContent = title;
  container.appendChild(heading);
}

function filterDisclosure(container, key, { label, count, iconName, active, meta, heading }) {
  const details = document.createElement('details');
  details.className = 'filterDisclosure';
  details.dataset.disclosure = key;
  details.open = state.sidebarExpanded[key];
  details.addEventListener('toggle', () => {
    if (details.isConnected) state.sidebarExpanded[key] = details.open;
  });

  const summary = document.createElement('summary');
  summary.className = heading ? 'filterSectionTitle filterSectionToggle' : `filterRow${active ? ' active' : ''}`;
  summary.dataset.focusKey = `disclosure:${key}`;
  const main = document.createElement('span');
  main.className = 'filterMain';
  if (iconName) main.appendChild(icon(iconName, 'filterIcon'));
  const name = document.createElement('span');
  name.className = 'filterName';
  const text = document.createElement('span');
  text.textContent = label;
  name.appendChild(text);
  if (meta) {
    const status = document.createElement('span');
    status.className = 'filterMeta';
    status.textContent = meta;
    name.appendChild(status);
  }
  main.appendChild(name);

  const trailing = document.createElement('span');
  trailing.className = 'filterTrailing';
  if (count !== undefined) {
    const total = document.createElement('span');
    total.className = 'filterCount';
    total.textContent = countFormat(count);
    trailing.appendChild(total);
  }
  trailing.appendChild(icon('chevronDown', 'disclosureChevron'));
  summary.append(main, trailing);

  const choices = document.createElement('div');
  choices.className = 'filterChoices';
  details.append(summary, choices);
  container.appendChild(details);
  return choices;
}

async function chooseSidebarFilter(key, patch, options = {}) {
  state.sidebarExpanded[key] = false;
  await applyFilters(patch, options);
  els.sidebarContent.querySelector(`[data-disclosure="${key}"] summary`)?.focus();
}

function renderFilterChip(container, key, label) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'filterChip';
  chip.textContent = label;
  chip.appendChild(icon('x'));
  chip.addEventListener('click', () => applyFilters({ [key]: undefined }).catch(showError));
  container.appendChild(chip);
}

function renderActiveFilters(container) {
  const activeCount = activeFilterCount();
  if (!activeCount) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'activeFilters';
  if (state.filters.label) {
    renderFilterChip(wrapper, 'label', labelName(state.filters.label));
  }
  if (state.filters.context) {
    renderFilterChip(wrapper, 'context', state.filters.context);
  }
  if (state.filters.tag) {
    renderFilterChip(wrapper, 'tag', `#${state.filters.tag}`);
  }
  if (state.filters.olderThanDays) {
    renderFilterChip(wrapper, 'olderThanDays', `${state.filters.olderThanDays}+ days`);
  }

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'clearFilters';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => applyFilters({ status: state.filters.status }, { reset: true }).catch(showError));
  wrapper.appendChild(clear);
  container.appendChild(wrapper);
}

function renderLinksSwitcher(container) {
  const choices = filterDisclosure(container, 'links', {
    label: 'All links',
    count: state.facetLinks.length,
    active: activeFilterCount() === 0,
    iconName: 'list',
    meta: state.filters.status === 'archived' ? 'Archive' : 'Active',
  });
  const statusCounts = countBy(state.indexLinks, (link) => [link.status]);
  const status = state.filters.status === 'archived' ? 'active' : 'archived';
  choices.appendChild(filterRow({
    label: status === 'active' ? 'Active links' : 'Archive',
    count: statusCounts.get(status) || 0,
    iconName: status === 'active' ? 'list' : 'archive',
    onClick: () => chooseSidebarFilter('links', { status }, { reset: true }),
  }));
}

function renderLabelFilters(container) {
  const labelCounts = countBy(state.facetLinks, (link) => [link.label || 'unlabeled']);
  if (!state.settings) {
    return;
  }

  filterSection(container, 'Labels');
  for (const label of state.settings.labels) {
    const button = filterRow({
      label: label.name,
      count: labelCounts.get(label.id) || 0,
      active: state.filters.label === label.id,
      color: label.color,
      onClick: () => toggleFilter('label', label.id),
    });
    button.dataset.filterGroup = 'labels';
    container.appendChild(button);
  }
}

function renderContextFilters(container) {
  const contextCounts = countBy(state.facetLinks, (link) => (
    Array.isArray(link.contexts) ? link.contexts.map(contextDisplay) : []
  ));
  const contexts = contextOptions();

  if (!contexts.length) {
    return;
  }

  filterSection(container, 'Contexts');
  const choices = filterDisclosure(container, 'contexts', {
    label: state.filters.context || 'All contexts',
    iconName: 'atSign',
    active: Boolean(state.filters.context),
  });
  if (state.filters.context) {
    choices.appendChild(filterRow({
      label: 'All contexts',
      onClick: () => chooseSidebarFilter('contexts', { context: undefined }),
    }));
  }
  const selectedContext = contextDisplay(state.filters.context).toLowerCase();
  for (const context of contexts) {
    if (context.toLowerCase() === selectedContext) continue;
    choices.appendChild(filterRow({
      label: context,
      count: contextCounts.get(context) || 0,
      iconName: 'atSign',
      onClick: () => chooseSidebarFilter('contexts', { context }),
    }));
  }
}

function renderTagFilters(container) {
  const tagCounts = countBy(state.facetLinks, (link) => (
    Array.isArray(link.tags) ? link.tags : []
  ));
  const tags = Array.from(tagCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10);

  if (!tags.length) {
    return;
  }

  const choices = filterDisclosure(container, 'tags', { label: 'Tags', heading: true });
  for (const [tag, count] of tags) {
    choices.appendChild(filterRow({
      label: tag,
      count,
      active: state.filters.tag === tag,
      iconName: 'hash',
      onClick: () => toggleFilter('tag', tag),
    }));
  }
}

function renderReviewFilters(container) {
  filterSection(container, 'Review');
  for (const days of [30, 90]) {
    container.appendChild(filterRow({
      label: `Older than ${days} days`,
      active: state.filters.olderThanDays === days,
      iconName: 'circle',
      onClick: () => toggleFilter('olderThanDays', days),
    }));
  }
}

function renderLinksFilters(container) {
  renderActiveFilters(container);
  renderLinksSwitcher(container);
  renderLabelFilters(container);
  renderContextFilters(container);
  renderTagFilters(container);
  renderReviewFilters(container);
}

function labelSettingsRow(label) {
  const row = document.createElement('div');
  row.className = 'settingsRow';
  row.dataset.labelRow = 'true';
  row.dataset.labelId = label.id;
  row.dataset.labelName = label.name;

  const color = document.createElement('input');
  color.type = 'color';
  color.value = label.color;
  color.setAttribute('aria-label', `${label.name} color`);
  color.dataset.labelColor = 'true';

  const name = document.createElement('input');
  name.type = 'text';
  name.value = label.name;
  name.dataset.labelNameInput = 'true';
  name.setAttribute('aria-label', `${label.name} name`);

  row.append(color, name);
  return row;
}

function contextSettingsRow(context) {
  const row = document.createElement('div');
  row.className = 'settingsRow settingsRowSingle';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = context;
  input.dataset.contextInput = 'true';
  input.setAttribute('aria-label', `${context} context`);

  row.appendChild(input);
  return row;
}

async function saveSettingsForm(form) {
  const labels = Array.from(form.querySelectorAll('[data-label-row="true"]')).map((row) => {
    const nameInput = row.querySelector('[data-label-name-input="true"]');
    const colorInput = row.querySelector('[data-label-color="true"]');
    return {
      id: row.dataset.labelId,
      name: nameInput.value.trim() || row.dataset.labelName,
      color: colorInput.value,
    };
  });

  const newLabelName = form.querySelector('[data-new-label-name]').value.trim();
  const newLabelColor = form.querySelector('[data-new-label-color]').value;
  if (newLabelName) {
    labels.push({
      name: newLabelName,
      color: newLabelColor,
    });
  }

  const contexts = Array.from(form.querySelectorAll('[data-context-input="true"]'))
    .map((input) => input.value.trim())
    .filter(Boolean);
  const newContext = form.querySelector('[data-new-context]').value.trim();
  if (newContext) {
    contexts.push(newContext);
  }

  state.settings = await window.rinku.updateSettings(state.libraryRoot, {
    labels,
    contexts,
  });
  setStatus('Settings saved.');
  await refreshLinks({ reload: true });
}

function captureBookmarklet(status) {
  if (!status || !status.running || !status.baseUrl) {
    return '';
  }

  const endpoint = `${status.baseUrl}/capture`;
  return `javascript:(()=>{const e=${JSON.stringify(endpoint)};window.open(e+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'rinku-capture','width=700,height=650');})();`;
}

function protocolCaptureBookmarklet() {
  return "javascript:(()=>{location.href='rinku://capture?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);})();";
}

async function refreshCaptureStatus() {
  state.captureStatus = await window.rinku.captureStatus();
  return state.captureStatus;
}

async function startCapture() {
  if (!state.libraryRoot || !state.settings) return;
  const status = await window.rinku.startCaptureServer(state.libraryRoot, {
    port: state.settings.capture && state.settings.capture.localHttpPort,
  });
  state.settings = await window.rinku.updateSettings(state.libraryRoot, {
    capture: {
      ...(state.settings.capture || {}),
      localHttpEnabled: true,
      localHttpPort: status.port,
    },
  });
  state.captureStatus = status;
  setStatus('Capture server started.');
  renderSidebar();
}

async function stopCapture() {
  if (!state.libraryRoot || !state.settings) return;
  state.captureStatus = await window.rinku.stopCaptureServer();
  state.settings = await window.rinku.updateSettings(state.libraryRoot, {
    capture: {
      ...(state.settings.capture || {}),
      localHttpEnabled: false,
    },
  });
  setStatus('Capture server stopped.');
  renderSidebar();
}

async function copyBookmarklet(bookmarklet) {
  await navigator.clipboard.writeText(bookmarklet);
  setStatus('Bookmarklet copied.');
}

function renderCaptureSettings(form) {
  const section = (heading, description) => {
    const panel = document.createElement('section');
    panel.className = 'captureSettings';
    const title = document.createElement('h3');
    title.textContent = heading;
    const note = document.createElement('p');
    note.className = 'captureNote';
    note.textContent = description;
    panel.append(title, note);
    form.appendChild(panel);
    return panel;
  };
  const safari = section('Safari extension', 'Save the current page using Rinku’s Safari toolbar button or the “Save Page to Rinku” context-menu action. The link is saved immediately, then Rinku opens its editing dialog.');
  safari.dataset.captureSafari = 'true';
  const safariRow = document.createElement('div');
  safariRow.className = 'captureStatusRow';
  const safariStatus = document.createElement('span');
  safariStatus.setAttribute('role', 'status');
  safariStatus.textContent = 'Checking Safari extension…';
  const setup = document.createElement('button');
  setup.type = 'button';
  setup.className = 'iconTextButton primaryButton';
  setup.textContent = 'Enable in Safari';
  setup.disabled = true;
  setButtonIcon(setup, 'externalLink');
  const safariSteps = document.createElement('p');
  safariSteps.className = 'captureNote';
  safariSteps.textContent = 'In Safari → Settings → Extensions, enable Rinku. Allow website access when Safari asks, then click Save with Rinku in the toolbar on a page you want to save.';
  safariRow.append(safariStatus, setup);
  safari.append(safariRow, safariSteps);
  let checking = false;
  let openingSafari = false;
  refreshSafariCaptureStatus = async () => {
    if (!safari.isConnected || checking) return;
    checking = true;
    try {
      const status = await window.rinku.safariExtensionStatus();
      if (!safari.isConnected) return;
      safari.hidden = !status.supported;
      setup.disabled = !status.bundled || openingSafari;
      setup.replaceChildren(document.createTextNode(status.enabled ? 'Open Safari Settings' : 'Enable in Safari'));
      setButtonIcon(setup, 'externalLink');
      safariStatus.textContent = !status.bundled
        ? 'Included in installed macOS builds of Rinku.'
        : status.enabled ? 'Enabled in Safari' : 'Ready to enable in Safari';
      if (status.error) safariStatus.textContent = status.error;
    } catch {
      safariStatus.textContent = 'Could not check Safari. Open Safari → Settings → Extensions to enable Rinku.';
    } finally { checking = false; }
  };
  setup.addEventListener('click', async () => {
    if (openingSafari) return;
    openingSafari = true;
    setup.disabled = true;
    try {
      await window.rinku.setupSafariExtension();
      setStatus('Enable Rinku in Safari → Settings → Extensions.');
    } catch (error) { showError(error); }
    finally { openingSafari = false; setup.disabled = false; }
  });
  // Rendering happens before the settings page is attached to the document.
  queueMicrotask(() => refreshSafariCaptureStatus?.());

  const bookmarks = section('Browser bookmarklets', 'Save from other browsers, or use these as an alternative to the Safari extension. A bookmarklet is a browser bookmark that saves the page you are viewing.');
  const instructions = document.createElement('ol');
  instructions.className = 'captureInstructions';
  for (const text of [
    'Click Copy next to the method you want to use.',
    'Create a bookmark in your browser’s bookmarks bar. Edit its URL/address and paste the copied text, keeping the javascript: prefix.',
    'Visit a page you want to save and click that bookmark. You only need to create it once.',
  ]) {
    const step = document.createElement('li');
    step.textContent = text;
    instructions.appendChild(step);
  }
  bookmarks.appendChild(instructions);
  const addBookmarklet = (container, name, bookmarklet) => {
    const row = document.createElement('div');
    row.className = 'bookmarkletRow';
    const link = document.createElement('a');
    link.className = 'bookmarkletLink';
    link.href = bookmarklet;
    link.textContent = name;
    link.title = 'Copy this bookmarklet into a bookmark in your browser';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setStatus('Use Copy, then paste into a browser bookmark’s URL/address.');
    });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'iconTextButton';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', `Copy ${name} bookmarklet`);
    setButtonIcon(copy, 'check');
    copy.addEventListener('click', () => copyBookmarklet(bookmarklet).catch(showError));
    row.append(link, copy);
    container.appendChild(row);
  };
  const describe = (text) => {
    const note = document.createElement('p');
    note.className = 'captureNote';
    note.textContent = text;
    bookmarks.appendChild(note);
  };
  addBookmarklet(bookmarks, 'Save with Rinku', protocolCaptureBookmarklet());
  describe('Brings Rinku forward and opens the saved link for editing. Allow your browser to open Rinku if prompted.');
  describe('Save with Popup keeps editing in a small browser window. Start popup capture below, then copy its bookmarklet. Keep Rinku running while using it.');
  const popup = document.createElement('div');
  popup.className = 'capturePopupControls';
  bookmarks.appendChild(popup);
  const renderPopup = () => {
    popup.replaceChildren();
    const status = state.captureStatus || { running: false };
    const row = document.createElement('div');
    row.className = 'captureStatusRow';
    const note = document.createElement('span');
    note.textContent = status.running ? 'Popup capture is running' : 'Popup capture is stopped';
    note.setAttribute('role', 'status');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'iconTextButton';
    toggle.textContent = status.running ? 'Stop popup capture' : 'Start popup capture';
    setButtonIcon(toggle, status.running ? 'x' : 'plus');
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await (status.running ? stopCapture() : startCapture());
        if (popup.isConnected) {
          renderPopup();
          popup.querySelector('button')?.focus();
        }
      } catch (error) { toggle.disabled = false; showError(error); }
    });
    row.append(note, toggle);
    popup.appendChild(row);
    if (status.running) addBookmarklet(popup, 'Save with Popup', captureBookmarklet(status));
  };
  renderPopup();
}

function actionButton(label, iconName, onClick, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `iconTextButton${options.primary ? ' primaryButton' : ''}`;
  button.textContent = label;
  button.disabled = options.disabled === true;
  setButtonIcon(button, iconName);
  button.addEventListener('click', () => onClick().catch(showError));
  return button;
}

function renderLibraryActionGroup(container, options = {}) {
  const actions = document.createElement('div');
  actions.className = options.compact ? 'libraryActions compact' : 'libraryActions';
  actions.append(
    actionButton('Open', 'folder', chooseAndOpenLibrary),
    actionButton('Create', 'plus', chooseAndCreateLibrary),
    actionButton('Import', 'download', importUnmark)
  );
  container.appendChild(actions);
}

function renderLibrarySettings(container) {
  const section = document.createElement('section');
  section.className = 'settingsSection';

  const pathLabel = document.createElement('div');
  pathLabel.className = 'settingsKicker';
  pathLabel.textContent = 'Current Library';
  const pathValue = document.createElement('div');
  pathValue.className = 'settingsPathValue';
  pathValue.textContent = state.libraryRoot || 'No library open';

  section.append(pathLabel, pathValue);
  renderLibraryActionGroup(section);

  const note = document.createElement('p');
  note.className = 'settingsHelp';
  note.textContent = state.libraryRoot
    ? 'Open another library, create a new one, or import an Unmark export into the current library.'
    : 'Open an existing Rinku library or create a new one to start saving links.';
  section.appendChild(note);
  container.appendChild(section);
}

function renderOrganizationSettings(container) {
  if (!state.settings) {
    container.appendChild(emptySettingsMessage('Open or create a library before editing labels and contexts.'));
    return;
  }

  const form = document.createElement('form');
  form.className = 'settingsForm';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsForm(form).catch(showError);
  });

  const labelsTitle = document.createElement('h3');
  labelsTitle.textContent = 'Labels';
  form.appendChild(labelsTitle);

  for (const label of state.settings.labels) {
    form.appendChild(labelSettingsRow(label));
  }

  const newLabel = document.createElement('div');
  newLabel.className = 'settingsRow';
  const newLabelColor = document.createElement('input');
  newLabelColor.type = 'color';
  newLabelColor.value = '#38bdf8';
  newLabelColor.dataset.newLabelColor = 'true';
  newLabelColor.setAttribute('aria-label', 'New label color');
  const newLabelName = document.createElement('input');
  newLabelName.type = 'text';
  newLabelName.placeholder = 'New label';
  newLabelName.dataset.newLabelName = 'true';
  newLabel.append(newLabelColor, newLabelName);
  form.appendChild(newLabel);

  const contextsTitle = document.createElement('h3');
  contextsTitle.textContent = 'Contexts';
  form.appendChild(contextsTitle);

  for (const context of contextOptions()) {
    form.appendChild(contextSettingsRow(context));
  }

  const newContext = document.createElement('input');
  newContext.type = 'text';
  newContext.placeholder = 'New context';
  newContext.dataset.newContext = 'true';
  form.appendChild(newContext);

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'iconTextButton primaryButton settingsSave';
  saveButton.textContent = 'Save settings';
  setButtonIcon(saveButton, 'check');
  form.appendChild(saveButton);

  container.appendChild(form);
}

function emptySettingsMessage(text) {
  const empty = document.createElement('div');
  empty.className = 'settingsEmpty';
  empty.textContent = text;
  return empty;
}

function renderCaptureSettingsPage(container) {
  if (!state.settings) {
    container.appendChild(emptySettingsMessage('Open or create a library before configuring capture.'));
    return;
  }
  renderCaptureSettings(container);
}

function renderMcpSettings(container) {
  if (!state.libraryRoot) {
    container.appendChild(emptySettingsMessage('Open or create a library to connect your agents to Rinku.'));
    return;
  }

  const section = document.createElement('section');
  section.className = 'settingsSection';
  const heading = document.createElement('h3');
  heading.textContent = 'Connect your agents';
  const note = document.createElement('p');
  note.className = 'settingsHelp';
  note.textContent = 'Copy this configuration into an agent that supports local MCP servers, then reconnect the agent. It uses your installed Rinku app; no source code or separate Node.js installation is needed. Rinku’s window can stay closed.';
  const pathLabel = document.createElement('div');
  pathLabel.className = 'settingsKicker';
  pathLabel.textContent = 'Library';
  const pathValue = document.createElement('div');
  pathValue.className = 'settingsPathValue';
  pathValue.textContent = state.libraryRoot;

  const access = document.createElement('label');
  access.className = 'mcpWriteAccess';
  const allowWrites = document.createElement('input');
  allowWrites.type = 'checkbox';
  access.append(allowWrites, document.createTextNode('Allow agents to save, edit, and archive links'));
  const accessNote = document.createElement('p');
  accessNote.className = 'settingsHelp';
  accessNote.textContent = 'Read-only by default. This choice applies to the configuration you copy. To change an existing connection, replace its configuration and reconnect.';

  const preview = document.createElement('textarea');
  preview.className = 'mcpConfig';
  preview.readOnly = true;
  preview.spellcheck = false;
  preview.setAttribute('aria-label', 'MCP configuration');
  preview.rows = 14;
  const status = document.createElement('p');
  status.className = 'settingsHelp';
  status.setAttribute('role', 'status');
  const copy = actionButton('Copy configuration', 'copy', async () => {
    await navigator.clipboard.writeText(preview.value);
    status.textContent = 'Configuration copied.';
  }, { primary: true });
  let revision = 0;
  async function refresh() {
    const request = ++revision;
    copy.disabled = true;
    preview.value = '';
    status.textContent = 'Preparing configuration…';
    try {
      const config = await window.rinku.mcpConfig(allowWrites.checked);
      if (request !== revision) return;
      preview.value = JSON.stringify(config, null, 2);
      copy.disabled = false;
      status.textContent = '';
    } catch (error) {
      if (request === revision) status.textContent = error.message || 'Could not prepare MCP configuration.';
    }
  }
  allowWrites.addEventListener('change', refresh);
  const help = document.createElement('p');
  help.className = 'settingsHelp';
  help.textContent = 'Already have MCP servers configured? Add the rinku entry alongside them. Copy a new configuration if you move the app or library. When using several agents, coordinate edits to the same library.';
  section.append(heading, note, pathLabel, pathValue, access, accessNote, preview, copy, status, help);
  container.appendChild(section);
  refresh();
}

function renderUpdateSettings(container) {
  const section = document.createElement('section');
  section.className = 'settingsSection';

  const heading = document.createElement('h3');
  heading.textContent = 'Updates';
  const note = document.createElement('p');
  note.className = 'settingsHelp';
  note.textContent = 'Packaged Rinku builds check GitHub Releases for updates. Development runs report that updates are only available in packaged builds.';
  const checkButton = actionButton('Check for Updates', 'rotateCcw', async () => {
    if (!window.rinku.checkForUpdates) {
      setStatus('Update checks are not available in this build.');
      return;
    }
    await window.rinku.checkForUpdates();
  }, { primary: true });

  section.append(heading, note, checkButton);
  container.appendChild(section);
}

function renderAppearanceSettings(container) {
  const section = document.createElement('section');
  section.className = 'settingsSection';
  const heading = document.createElement('h3');
  heading.textContent = 'Appearance';
  const note = document.createElement('p');
  note.className = 'settingsHelp';
  note.textContent = 'Choose how Rinku looks. Your choice is saved automatically and applies to every library on this device.';

  const choices = document.createElement('fieldset');
  choices.className = 'themeChoices';
  const legend = document.createElement('legend');
  legend.textContent = 'Theme';
  choices.appendChild(legend);
  for (const [value, name, description] of [
    ['light', 'Light', 'Always use light colors.'],
    ['dark', 'Dark', 'Always use dark colors.'],
    ['auto', 'Auto', 'Follow your system appearance.'],
  ]) {
    const label = document.createElement('label');
    label.className = 'themeChoice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.value = value;
    input.checked = window.rinkuTheme.getPreference() === value;
    input.setAttribute('aria-label', name);
    input.addEventListener('change', () => {
      if (input.checked) window.rinkuTheme.setPreference(value);
    });
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = name;
    const help = document.createElement('span');
    help.className = 'settingsHelp';
    help.textContent = description;
    text.append(title, help);
    label.append(input, text);
    choices.appendChild(label);
  }
  section.append(heading, note, choices);
  container.appendChild(section);
}

function renderSettingsTabs(container) {
  const tabs = [
    { id: 'library', label: 'Library', iconName: 'folder' },
    { id: 'appearance', label: 'Appearance', iconName: 'circle' },
    { id: 'organization', label: 'Organization', iconName: 'tag', disabled: !state.libraryRoot },
    { id: 'capture', label: 'Capture', iconName: 'download', disabled: !state.libraryRoot },
    { id: 'mcp', label: 'MCP', iconName: 'link' },
    { id: 'updates', label: 'Updates', iconName: 'rotateCcw' },
  ];

  for (const tab of tabs) {
    container.appendChild(filterRow({
      label: tab.label,
      active: state.settingsTab === tab.id,
      iconName: tab.iconName,
      onClick: async () => {
        if (tab.disabled) {
          state.settingsTab = 'library';
        } else {
          state.settingsTab = tab.id;
        }
        renderSidebar();
        renderLinks();
      },
    }));
  }
}

function renderSettingsPage() {
  if (!state.libraryRoot && !['appearance', 'mcp', 'updates'].includes(state.settingsTab)) {
    state.settingsTab = 'library';
  }

  const titles = {
    library: 'Library',
    appearance: 'Appearance',
    organization: 'Organization',
    capture: 'Capture',
    mcp: 'MCP',
    updates: 'Updates',
  };

  els.listKicker.textContent = 'Settings';
  els.listTitle.textContent = titles[state.settingsTab] || 'Settings';
  els.listCount.classList.add('hidden');
  els.linksList.replaceChildren();
  els.linksList.classList.add('settingsPageList');

  const page = document.createElement('div');
  page.className = 'settingsPage';

  if (state.settingsTab === 'appearance') {
    renderAppearanceSettings(page);
  } else if (state.settingsTab === 'organization') {
    renderOrganizationSettings(page);
  } else if (state.settingsTab === 'capture') {
    renderCaptureSettingsPage(page);
  } else if (state.settingsTab === 'mcp') {
    renderMcpSettings(page);
  } else if (state.settingsTab === 'updates') {
    renderUpdateSettings(page);
  } else {
    renderLibrarySettings(page);
  }

  els.linksList.appendChild(page);
}

function setSidebarTitle(kicker, title) {
  els.sideKicker.textContent = kicker;
  els.sideTitle.textContent = title;
  els.sideTitle.classList.toggle('hidden', !title);
}

function renderSidebar() {
  const focusKey = els.sidebarContent.contains(document.activeElement) ? document.activeElement.dataset.focusKey : '';
  els.sidebarContent.replaceChildren();

  if (!state.libraryRoot) {
    if (state.navMode === 'settings') {
      setSidebarTitle('Library', 'Settings');
      renderSettingsTabs(els.sidebarContent);
    } else {
      setSidebarTitle('Library', 'Start');
      els.sidebarContent.appendChild(emptySidebar('Open or create a library'));
    }
    renderRail();
    return;
  }

  if (state.navMode === 'links') {
    setSidebarTitle('Browse', '');
    renderLinksFilters(els.sidebarContent);
  } else if (state.navMode === 'settings') {
    setSidebarTitle('Library', 'Settings');
    renderSettingsTabs(els.sidebarContent);
  }

  renderRail();
  if (focusKey) {
    Array.from(els.sidebarContent.querySelectorAll('[data-focus-key]'))
      .find((element) => element.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }
}

function renderRail() {
  const activeByMode = {
    allLinksButton: state.navMode === 'links',
    settingsButton: state.navMode === 'settings',
  };

  for (const [id, active] of Object.entries(activeByMode)) {
    els[id].classList.toggle('active', active);
    els[id].setAttribute('aria-pressed', String(active));
  }
}

function listTitle() {
  const filterCount = activeFilterCount();
  if (filterCount > 1) {
    return 'Filtered Links';
  }
  if (state.filters.label) {
    return labelName(state.filters.label);
  }
  if (state.filters.context) {
    return state.filters.context;
  }
  if (state.filters.tag) {
    return `#${state.filters.tag}`;
  }
  if (state.filters.olderThanDays) {
    return `Older than ${state.filters.olderThanDays} days`;
  }
  return state.filters.status === 'archived' ? 'Archive' : 'All Links';
}

function listKicker() {
  const status = state.filters.status === 'archived' ? 'Archived' : 'Active';
  const filterCount = activeFilterCount();
  return filterCount ? `${status} / ${filterCount} filter${filterCount === 1 ? '' : 's'}` : status;
}

function renderContextSelections(selectedContexts) {
  els.detailContexts.replaceChildren();
  const selected = new Set((selectedContexts || []).map((item) => contextDisplay(item).toLowerCase()));
  const options = contextOptions(selectedContexts);

  if (!options.length) {
    const empty = document.createElement('span');
    empty.className = 'contextEmpty';
    empty.textContent = 'No contexts';
    els.detailContexts.appendChild(empty);
    return;
  }

  for (const context of options) {
    const label = document.createElement('label');
    label.className = 'contextOption';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = context;
    input.checked = selected.has(context.toLowerCase());
    input.addEventListener('change', () => scheduleDetailSave(150));

    const text = document.createElement('span');
    text.textContent = context;
    label.append(input, text);
    els.detailContexts.appendChild(label);
  }
}

function selectedContextValues() {
  return Array.from(els.detailContexts.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

function renderLabelChooser(selectedValue) {
  const restoreFocus = els.detailLabel.contains(document.activeElement);
  els.detailLabel.replaceChildren();
  els.detailLabel.dataset.value = selectedValue || 'unlabeled';
  if (!state.settings) return;

  const choices = document.createElement('div');
  choices.className = 'labelChoices';

  const selectedText = document.createElement('span');
  selectedText.className = 'selectedLabelName';
  selectedText.textContent = labelName(els.detailLabel.dataset.value);

  for (const label of state.settings.labels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `labelChoice${label.id === els.detailLabel.dataset.value ? ' active' : ''}`;
    button.style.setProperty('--choice-color', label.color);
    button.title = label.name;
    button.setAttribute('aria-label', label.name);
    button.setAttribute('aria-pressed', label.id === els.detailLabel.dataset.value ? 'true' : 'false');
    button.addEventListener('click', () => {
      renderLabelChooser(label.id);
      scheduleDetailSave(150);
    });
    choices.appendChild(button);
  }

  els.detailLabel.append(choices, selectedText);
  if (restoreFocus) choices.querySelector('[aria-pressed="true"]')?.focus();
}

function selectedLabelValue() {
  return els.detailLabel.dataset.value || 'unlabeled';
}

function addDetailTag(value) {
  const tags = normalizeTags([...state.detailTags, ...splitCsv(value)]);
  state.detailTags = tags;
  renderTagEditor(tags);
  scheduleDetailSave(150);
}

function removeDetailTag(tag) {
  state.detailTags = state.detailTags.filter((candidate) => candidate !== tag);
  renderTagEditor(state.detailTags);
  scheduleDetailSave(150);
}

function renderTagEditor(tags) {
  const restoreFocus = els.detailTags.contains(document.activeElement);
  state.detailTags = normalizeTags(tags || []);
  els.detailTags.replaceChildren();

  const listId = 'detailTagSuggestions';
  for (const tag of state.detailTags) {
    const pill = document.createElement('span');
    pill.className = 'tagPill';
    pill.textContent = `#${tag}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tagRemove';
    remove.title = `Remove ${tag}`;
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.appendChild(icon('x'));
    remove.addEventListener('click', () => removeDetailTag(tag));

    pill.appendChild(remove);
    els.detailTags.appendChild(pill);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tagInput';
  input.placeholder = state.detailTags.length ? '' : 'Add a tag';
  input.setAttribute('list', listId);
  input.setAttribute('aria-label', 'Add tag');
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const value = input.value;
      input.value = '';
      addDetailTag(value);
    } else if (event.key === 'Backspace' && !input.value && state.detailTags.length) {
      event.preventDefault();
      removeDetailTag(state.detailTags[state.detailTags.length - 1]);
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addDetailTag(input.value);
    }
  });
  els.detailTags.appendChild(input);

  const datalist = document.createElement('datalist');
  datalist.id = listId;
  for (const tag of tagOptions(state.detailTags).filter((tag) => !state.detailTags.includes(tag))) {
    const option = document.createElement('option');
    option.value = tag;
    datalist.appendChild(option);
  }
  els.detailTags.appendChild(datalist);
  if (restoreFocus) input.focus();
}

function selectedTagValues() {
  return [...state.detailTags];
}

function renderCaptureReviewContexts(selectedContexts) {
  els.captureReviewContexts.replaceChildren();
  const selected = new Set((selectedContexts || []).map((item) => contextDisplay(item).toLowerCase()));
  const options = contextOptions(selectedContexts);

  if (!options.length) {
    const empty = document.createElement('span');
    empty.className = 'contextEmpty';
    empty.textContent = 'No contexts';
    els.captureReviewContexts.appendChild(empty);
    return;
  }

  for (const context of options) {
    const label = document.createElement('label');
    label.className = 'contextOption';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = context;
    input.checked = selected.has(context.toLowerCase());
    input.addEventListener('change', () => scheduleCaptureReviewSave(150));

    const text = document.createElement('span');
    text.textContent = context;
    label.append(input, text);
    els.captureReviewContexts.appendChild(label);
  }
}

function selectedCaptureReviewContexts() {
  return Array.from(els.captureReviewContexts.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

function renderCaptureReviewLabel(selectedValue) {
  const restoreFocus = els.captureReviewLabel.contains(document.activeElement);
  els.captureReviewLabel.replaceChildren();
  els.captureReviewLabel.dataset.value = selectedValue || 'unlabeled';
  if (!state.settings) return;

  const choices = document.createElement('div');
  choices.className = 'labelChoices';

  const selectedText = document.createElement('span');
  selectedText.className = 'selectedLabelName';
  selectedText.textContent = labelName(els.captureReviewLabel.dataset.value);

  for (const label of state.settings.labels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `labelChoice${label.id === els.captureReviewLabel.dataset.value ? ' active' : ''}`;
    button.style.setProperty('--choice-color', label.color);
    button.title = label.name;
    button.setAttribute('aria-label', label.name);
    button.setAttribute('aria-pressed', label.id === els.captureReviewLabel.dataset.value ? 'true' : 'false');
    button.addEventListener('click', () => {
      renderCaptureReviewLabel(label.id);
      scheduleCaptureReviewSave(150);
    });
    choices.appendChild(button);
  }

  els.captureReviewLabel.append(choices, selectedText);
  if (restoreFocus) choices.querySelector('[aria-pressed="true"]')?.focus();
}

function selectedCaptureReviewLabel() {
  return els.captureReviewLabel.dataset.value || 'unlabeled';
}

function addCaptureReviewTag(value) {
  const tags = normalizeTags([...state.captureReviewTags, ...splitCsv(value)]);
  state.captureReviewTags = tags;
  renderCaptureReviewTagEditor(tags);
  scheduleCaptureReviewSave(150);
}

function removeCaptureReviewTag(tag) {
  state.captureReviewTags = state.captureReviewTags.filter((candidate) => candidate !== tag);
  renderCaptureReviewTagEditor(state.captureReviewTags);
  scheduleCaptureReviewSave(150);
}

function renderCaptureReviewTagEditor(tags) {
  const restoreFocus = els.captureReviewTags.contains(document.activeElement);
  state.captureReviewTags = normalizeTags(tags || []);
  els.captureReviewTags.replaceChildren();

  const listId = 'captureReviewTagSuggestions';
  for (const tag of state.captureReviewTags) {
    const pill = document.createElement('span');
    pill.className = 'tagPill';
    pill.textContent = `#${tag}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tagRemove';
    remove.title = `Remove ${tag}`;
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.appendChild(icon('x'));
    remove.addEventListener('click', () => removeCaptureReviewTag(tag));

    pill.appendChild(remove);
    els.captureReviewTags.appendChild(pill);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tagInput';
  input.placeholder = state.captureReviewTags.length ? '' : 'Add a tag';
  input.setAttribute('list', listId);
  input.setAttribute('aria-label', 'Add tag');
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const value = input.value;
      input.value = '';
      addCaptureReviewTag(value);
    } else if (event.key === 'Backspace' && !input.value && state.captureReviewTags.length) {
      event.preventDefault();
      removeCaptureReviewTag(state.captureReviewTags[state.captureReviewTags.length - 1]);
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addCaptureReviewTag(input.value);
    }
  });
  els.captureReviewTags.appendChild(input);

  const datalist = document.createElement('datalist');
  datalist.id = listId;
  for (const tag of tagOptions(state.captureReviewTags).filter((tag) => !state.captureReviewTags.includes(tag))) {
    const option = document.createElement('option');
    option.value = tag;
    datalist.appendChild(option);
  }
  els.captureReviewTags.appendChild(datalist);
  if (restoreFocus) input.focus();
}

function captureReviewPatch() {
  return {
    title: els.captureReviewTitle.value.trim() || (state.captureReview && state.captureReview.title) || '',
    label: selectedCaptureReviewLabel(),
    contexts: selectedCaptureReviewContexts(),
    tags: [...state.captureReviewTags],
    body: els.captureReviewBody.value,
  };
}

function setCaptureReviewSaveState(message) {
  els.captureReviewSaveState.textContent = message || '';
}

function openCaptureReview(link, { duplicate = false } = {}) {
  if (!state.captureReview) captureReviewReturnFocus = document.activeElement;
  state.captureReview = link;
  state.captureReviewTags = Array.isArray(link.tags) ? link.tags : [];
  window.clearTimeout(captureReviewSaveTimer);
  captureReviewSaveTimer = null;

  els.captureReviewNotice.textContent = duplicate
    ? (link.status === 'archived' ? 'This link is already in your archive. You can edit it below.' : 'This link is already saved. You can edit it below.')
    : 'Link added to your library.';
  els.captureReviewTitle.value = link.title || link.url || '';
  els.captureReviewUrl.textContent = [link.domain, link.url].filter(Boolean).join(' - ');
  renderCaptureReviewLabel(link.label);
  renderCaptureReviewContexts(link.contexts || []);
  renderCaptureReviewTagEditor(link.tags || []);
  els.captureReviewBody.value = link.body || '';
  setCaptureReviewSaveState('');
  els.captureReviewModal.classList.remove('hidden');
  if (!els.captureReviewModal.open) els.captureReviewModal.showModal();
  els.captureReviewTitle.focus();
  els.captureReviewTitle.select();
}

async function closeCaptureReview() {
  if (captureReviewClosing) return captureReviewClosing;
  captureReviewClosing = (async () => {
    // Commit a draft tag before collecting the final patch.
    els.captureReviewTags.querySelector('input')?.blur();
    if (captureReviewSaveTimer) {
      window.clearTimeout(captureReviewSaveTimer);
      captureReviewSaveTimer = null;
      await saveCaptureReview();
    }
    await captureReviewSaveInFlight;
    state.captureReview = null;
    state.captureReviewTags = [];
    els.captureReviewModal.close();
    els.captureReviewModal.classList.add('hidden');
    setCaptureReviewSaveState('');
    if (captureReviewReturnFocus?.isConnected && captureReviewReturnFocus !== document.body && !captureReviewReturnFocus.closest('.hidden')) {
      captureReviewReturnFocus.focus();
    } else {
      els.quickAddSubmit.focus();
    }
  })();
  try { await captureReviewClosing; } finally { captureReviewClosing = null; }
}

function scheduleCaptureReviewSave(delay = 600) {
  if (!state.captureReview) return;
  window.clearTimeout(captureReviewSaveTimer);
  setCaptureReviewSaveState('Saving...');
  captureReviewSaveTimer = window.setTimeout(() => {
    saveCaptureReview().catch(showError);
  }, delay);
}

async function saveCaptureReview() {
  if (!state.captureReview) return null;
  const linkId = state.captureReview.id;
  const patch = captureReviewPatch();
  captureReviewSaveInFlight = (captureReviewSaveInFlight || Promise.resolve()).catch(() => {}).then(async () => {
    const link = await window.rinku.updateLink(state.libraryRoot, linkId, patch);
    updateCachedLink(link);
    if (state.captureReview && state.captureReview.id === linkId) {
      state.captureReview = link;
      setCaptureReviewSaveState('Saved');
      await refreshLinks();
      window.setTimeout(() => {
        if (state.captureReview && state.captureReview.id === linkId && els.captureReviewSaveState.textContent === 'Saved') {
          setCaptureReviewSaveState('');
        }
      }, 1800);
    }
    return link;
  });
  return captureReviewSaveInFlight;
}

function detailPatch() {
  return {
    label: selectedLabelValue(),
    contexts: selectedContextValues(),
    tags: selectedTagValues(),
    body: els.detailBody.value,
  };
}

function setDetailSaveState(message) {
  els.detailSaveState.textContent = message || '';
}

function updateCachedLink(link) {
  const index = state.indexLinks.findIndex((candidate) => candidate.id === link.id);
  const next = {
    id: link.id,
    url: link.url,
    urlHash: link.urlHash,
    title: link.title,
    domain: link.domain,
    label: link.label,
    tags: Array.isArray(link.tags) ? link.tags : [],
    contexts: Array.isArray(link.contexts) ? link.contexts : [],
    status: link.status,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    archivedAt: link.archivedAt || '',
    filePath: link.filePath,
    fileName: link.fileName,
  };

  if (index >= 0) {
    state.indexLinks[index] = next;
  } else {
    state.indexLinks.unshift(next);
  }
}

function scheduleDetailSave(delay = 600) {
  if (!state.selectedId || !state.currentDetail) return;
  window.clearTimeout(detailSaveTimer);
  setDetailSaveState('Saving...');
  detailSaveTimer = window.setTimeout(() => {
    saveDetail().catch(showError);
  }, delay);
}

function linkRow(link) {
  const row = document.createElement('article');
  row.className = `linkRow${link.id === state.selectedId ? ' active' : ''}`;
  row.dataset.id = link.id;
  row.setAttribute('role', 'listitem');
  row.style.setProperty('--label-color', labelColor(link.label));

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'linkRowMain';
  main.tabIndex = link.id === state.focusedLinkId ? 0 : -1;
  main.setAttribute('aria-label', `${link.title}. ${link.domain}. Open in browser`);
  main.setAttribute('aria-keyshortcuts', 'Enter O');
  main.addEventListener('click', () => window.rinku.openExternal(link.url).catch(showError));

  const text = document.createElement('span');
  text.className = 'linkText';

  const title = document.createElement('span');
  title.className = 'linkTitle';
  title.textContent = link.title;

  const meta = document.createElement('span');
  meta.className = 'linkMeta';
  const metaParts = [relativeDate(link.createdAt), link.domain, labelName(link.label)].filter(Boolean);
  meta.textContent = metaParts.join(' - ');

  const facets = document.createElement('span');
  facets.className = 'linkFacets';
  const facetParts = [
    ...(Array.isArray(link.contexts) ? link.contexts : []),
    ...(Array.isArray(link.tags) ? link.tags.map((tag) => `#${tag}`) : []),
  ];
  facets.textContent = facetParts.join(' ');
  facets.classList.toggle('hidden', facetParts.length === 0);

  text.append(title, meta, facets);
  main.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'rowActions';

  const archiveButton = document.createElement('button');
  archiveButton.type = 'button';
  archiveButton.className = 'archiveToggle';
  archiveButton.tabIndex = main.tabIndex;
  archiveButton.title = link.status === 'archived' ? 'Restore' : 'Archive';
  archiveButton.setAttribute('aria-label', archiveButton.title);
  archiveButton.setAttribute('aria-pressed', String(link.status === 'archived'));
  const archiveCircle = document.createElement('span');
  archiveCircle.className = 'archiveCircle';
  archiveCircle.appendChild(icon('check'));
  archiveButton.appendChild(archiveCircle);
  archiveButton.addEventListener('click', async () => {
    archiveButton.disabled = true;
    archiveButton.setAttribute('aria-pressed', String(link.status !== 'archived'));
    try {
      await toggleArchiveLink(link);
    } catch (error) {
      archiveButton.setAttribute('aria-pressed', String(link.status === 'archived'));
      showError(error);
    } finally {
      archiveButton.disabled = false;
    }
  });

  const infoButton = document.createElement('button');
  infoButton.type = 'button';
  infoButton.className = 'iconButton';
  infoButton.title = 'Info';
  infoButton.setAttribute('aria-label', 'Info');
  infoButton.setAttribute('aria-expanded', String(link.id === state.selectedId));
  infoButton.setAttribute('aria-controls', 'detailPane');
  infoButton.appendChild(icon('info'));
  infoButton.addEventListener('click', () => selectLink(link.id).catch(showError));

  actions.append(infoButton);
  for (const button of actions.children) button.tabIndex = main.tabIndex;
  row.append(main, archiveButton, actions);
  return row;
}

function resetVirtualList() {
  virtualRenderKey = '';
  state.virtualListActive = false;
  if (virtualRenderFrame) {
    window.cancelAnimationFrame(virtualRenderFrame);
    virtualRenderFrame = 0;
  }
}

function visibleLinkSignature(links) {
  return links.map((link) => [
    link.id,
    link.updatedAt,
    link.status,
    link.label,
    (link.contexts || []).join(','),
    (link.tags || []).join(','),
  ].join(':')).join('|');
}

function renderVirtualLinks() {
  if (state.navMode !== 'links' || !state.libraryRoot || !state.links.length) {
    return;
  }

  state.virtualListActive = true;
  const total = state.links.length;
  const viewportHeight = els.linksList.clientHeight || LINK_ROW_HEIGHT;
  const totalHeight = total * LINK_ROW_HEIGHT;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);

  if (els.linksList.scrollTop > maxScrollTop) {
    els.linksList.scrollTop = maxScrollTop;
  }

  const scrollTop = els.linksList.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / LINK_ROW_HEIGHT) - LINK_ROW_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / LINK_ROW_HEIGHT) + (LINK_ROW_OVERSCAN * 2);
  const end = Math.min(total, start + visibleCount);
  const visibleLinks = state.links.slice(start, end);
  const key = [
    start,
    end,
    total,
    state.selectedId,
    state.focusedLinkId,
    visibleLinkSignature(visibleLinks),
  ].join('/');

  if (key === virtualRenderKey && els.linksList.firstElementChild && els.linksList.firstElementChild.classList.contains('linksVirtualizer')) {
    return;
  }

  virtualRenderKey = key;
  const existingSpacer = els.linksList.firstElementChild && els.linksList.firstElementChild.classList.contains('linksVirtualizer')
    ? els.linksList.firstElementChild
    : null;
  const spacer = existingSpacer || document.createElement('div');
  spacer.className = 'linksVirtualizer';
  spacer.style.height = `${totalHeight}px`;
  spacer.dataset.totalRows = String(total);
  spacer.dataset.renderedRows = String(visibleLinks.length);
  spacer.dataset.startIndex = String(start);
  spacer.dataset.endIndex = String(end);

  const windowEl = document.createElement('div');
  windowEl.className = 'linksVirtualWindow';
  windowEl.style.transform = `translateY(${start * LINK_ROW_HEIGHT}px)`;

  const focusedRow = document.activeElement.closest('.linkRow');
  const focusedId = focusedRow?.dataset.id;
  const focusedAction = document.activeElement.classList.contains('linkRowMain') ? 'main' : document.activeElement.getAttribute('aria-label');
  for (const [offset, link] of visibleLinks.entries()) {
    const row = linkRow(link);
    row.setAttribute('aria-posinset', String(start + offset + 1));
    row.setAttribute('aria-setsize', String(total));
    windowEl.appendChild(row);
  }

  spacer.appendChild(windowEl);
  if (existingSpacer) {
    spacer.replaceChildren(windowEl);
  } else {
    els.linksList.replaceChildren(spacer);
  }
  if (focusedId && focusedId === state.focusedLinkId) {
    const row = Array.from(windowEl.children).find((element) => element.dataset.id === focusedId);
    const target = focusedAction === 'main' ? row?.querySelector('.linkRowMain')
      : Array.from(row?.querySelectorAll('button') || []).find((button) => button.getAttribute('aria-label') === focusedAction);
    target?.focus({ preventScroll: true });
  }
}

function scheduleVirtualRender() {
  if (!state.virtualListActive || virtualRenderFrame) {
    return;
  }
  virtualRenderFrame = window.requestAnimationFrame(() => {
    virtualRenderFrame = 0;
    renderVirtualLinks();
  });
}

function renderFirstRun() {
  resetVirtualList();
  els.listCount.classList.add('hidden');
  els.listKicker.textContent = 'Library';
  els.listTitle.textContent = 'Open Rinku';
  els.linksList.replaceChildren();
  els.linksList.classList.remove('settingsPageList');

  const panel = document.createElement('section');
  panel.className = 'firstRunPanel';
  const title = document.createElement('h3');
  title.textContent = 'Choose a library to continue';
  const copy = document.createElement('p');
  copy.textContent = 'Rinku stores links in a local folder. Open an existing library or create a new one before adding links.';
  panel.append(title, copy);
  renderLibraryActionGroup(panel);
  els.linksList.appendChild(panel);
}

function renderLinks(options = {}) {
  els.linksList.setAttribute('role', state.navMode === 'links' && state.libraryRoot ? 'list' : 'region');
  els.toolbar.classList.toggle('hidden', state.navMode === 'settings' || !state.libraryRoot);
  els.linksList.classList.remove('settingsPageList');

  if (state.navMode === 'settings') {
    resetVirtualList();
    renderSettingsPage();
    return;
  }

  if (options.resetScroll === true) {
    els.linksList.scrollTop = 0;
  }
  resetVirtualList();
  els.listCount.classList.remove('hidden');
  els.listCount.textContent = countFormat(state.links.length);
  els.listTitle.textContent = listTitle();
  els.listKicker.textContent = listKicker();

  if (!state.libraryRoot) {
    renderFirstRun();
    return;
  }

  if (!state.links.length) {
    const empty = document.createElement('div');
    empty.className = 'emptyList';
    empty.textContent = 'No links found';
    els.linksList.replaceChildren(empty);
    return;
  }

  renderVirtualLinks();
}

async function refreshLinks(options = {}) {
  if (!state.libraryRoot) {
    state.indexLinks = [];
    state.indexLoaded = false;
    state.links = [];
    state.facetLinks = [];
    renderSidebar();
    renderLinks({ resetScroll: true });
    return;
  }

  if (options.reload === true || !state.indexLoaded) {
    await reloadIndex({ rebuild: options.rebuild === true });
  }

  const search = els.search.value.trim();
  state.facetLinks = state.indexLinks.filter((link) => linkMatchesLocalFilters(link, { status: state.filters.status }));
  state.links = state.indexLinks.filter((link) => linkMatchesLocalFilters(link, state.filters, search));
  if (!state.links.some((link) => link.id === state.focusedLinkId)) state.focusedLinkId = state.links[0]?.id || '';
  renderSidebar();
  // Background changes must not replace a settings form while it is being edited.
  if (options.background !== true || state.navMode !== 'settings') {
    renderLinks({ resetScroll: options.resetScroll === true });
  }

  if (state.selectedId && !state.links.some((link) => link.id === state.selectedId)) {
    clearDetail();
  }
}

async function refreshChangedLibrary() {
  libraryRefreshPending = true;
  if (libraryRefreshInFlight) return;
  libraryRefreshInFlight = true;
  try {
    while (libraryRefreshPending) {
      libraryRefreshPending = false;
      const libraryRoot = state.libraryRoot;
      if (!libraryRoot) continue;
      const settings = await window.rinku.readSettings(libraryRoot);
      if (libraryRoot !== state.libraryRoot) continue;
      state.settings = settings;
      await refreshLinks({ reload: true, background: true });
    }
  } finally {
    libraryRefreshInFlight = false;
  }
}

async function selectLink(id) {
  await flushDetailSave();
  state.selectedId = id;
  renderLinks();
  const link = await window.rinku.readLink(state.libraryRoot, id);
  if (state.selectedId !== id) return;
  state.currentDetail = link;
  els.content.classList.add('detailOpen');
  els.detailPane.classList.remove('hidden');
  els.detailDomain.textContent = link.domain;
  els.detailTitle.textContent = link.title;
  els.detailUrl.textContent = link.url;
  renderLabelChooser(link.label);
  renderContextSelections(link.contexts || []);
  renderTagEditor(link.tags || []);
  els.detailBody.value = link.body || '';
  setDetailSaveState('');
  els.detailClose.focus();
}

async function toggleArchiveLink(link) {
  await flushDetailSave();
  const focusedIndex = state.links.findIndex((candidate) => candidate.id === link.id);
  const restoreFocus = els.linksList.contains(document.activeElement) || els.detailPane.contains(document.activeElement);
  if (link.status === 'archived') {
    await window.rinku.restoreLink(state.libraryRoot, link.id);
    setStatus('Link restored.');
  } else {
    await window.rinku.archiveLink(state.libraryRoot, link.id);
    setStatus('Link archived.');
  }

  if (state.selectedId === link.id) {
    clearDetail({ render: false });
  }
  await refreshLinks({ reload: true });
  if (restoreFocus) focusLinkIndex(Math.max(0, focusedIndex));
}

async function saveDetail() {
  if (!state.selectedId) return;
  const linkId = state.selectedId;
  const patch = detailPatch();
  detailSaveInFlight = (detailSaveInFlight || Promise.resolve()).catch(() => {}).then(async () => {
    const link = await window.rinku.updateLink(state.libraryRoot, linkId, patch);
    updateCachedLink(link);
    if (state.selectedId === linkId) {
      state.currentDetail = link;
      setDetailSaveState('Saved');
      await refreshLinks({ preserveScroll: true });
      window.setTimeout(() => {
        if (state.selectedId === linkId && els.detailSaveState.textContent === 'Saved') {
          setDetailSaveState('');
        }
      }, 1800);
    }
    return link;
  });
  return detailSaveInFlight;
}

async function openLibrary(libraryRoot) {
  state.libraryRoot = libraryRoot;
  localStorage.setItem('rinku.libraryRoot', libraryRoot);
  state.indexLoaded = false;
  state.indexLinks = [];
  state.settings = await window.rinku.readSettings(libraryRoot);
  await window.rinku.setCurrentLibrary(libraryRoot);
  if (state.settings.capture && state.settings.capture.localHttpEnabled) {
    state.captureStatus = await window.rinku.startCaptureServer(libraryRoot, {
      port: state.settings.capture.localHttpPort,
    });
    if (state.captureStatus.port !== state.settings.capture.localHttpPort) {
      state.settings = await window.rinku.updateSettings(libraryRoot, {
        capture: {
          ...state.settings.capture,
          localHttpPort: state.captureStatus.port,
        },
      });
    }
  } else {
    state.captureStatus = await window.rinku.stopCaptureServer();
  }
  els.libraryPath.textContent = libraryRoot.split(/[\\/]/).filter(Boolean).pop() || libraryRoot;
  els.libraryPath.title = `${libraryRoot}\nOpen library settings`;
  els.libraryPath.setAttribute('aria-label', `Library: ${els.libraryPath.textContent}. Open library settings`);
  state.sidebarExpanded = { links: false, contexts: false, tags: false };
  els.quickAddUrl.value = '';
  setQuickAddExpanded(false);
  await refreshLinks({ reload: true, resetScroll: true });
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
  if (!state.libraryRoot) {
    const libraryRoot = await window.rinku.chooseLibraryDirectory();
    if (!libraryRoot) return;
    await window.rinku.createLibrary(libraryRoot);
    await openLibrary(libraryRoot);
  }
  const filePath = await window.rinku.chooseUnmarkExport();
  if (!filePath) return;
  setStatus('Importing Unmark export...');
  const result = await window.rinku.importUnmark(state.libraryRoot, filePath);
  setStatus(`Imported ${result.added}/${result.total} links.`);
  state.settings = await window.rinku.readSettings(state.libraryRoot);
  await refreshLinks({ reload: true, resetScroll: true });
}

async function quickAdd(event) {
  event.preventDefault();
  if (!state.libraryRoot || state.quickAddPending) return;
  const url = els.quickAddUrl.value.trim();
  if (!url) return;
  state.quickAddPending = true;
  els.quickAddSubmit.disabled = true;
  els.quickAddUrl.disabled = true;
  try {
    await flushDetailSave();
    const result = await window.rinku.createLink(state.libraryRoot, { url });
    els.quickAddUrl.value = '';
    setQuickAddExpanded(false);
    setStatus(result.duplicate ? 'Link already saved.' : 'Link added.');
    await refreshLinks({ reload: true });
    if (result && result.link) {
      openCaptureReview(result.link, { duplicate: result.duplicate });
    }
  } finally {
    state.quickAddPending = false;
    els.quickAddSubmit.disabled = false;
    els.quickAddUrl.disabled = false;
  }
}

async function setNavMode(navMode) {
  await flushDetailSave();
  state.navMode = navMode;
  clearDetail({ render: false });
  if (navMode === 'settings') {
    renderSidebar();
    renderLinks();
  } else {
    await refreshLinks({ resetScroll: true });
  }
}

async function flushDetailSave() {
  if (!state.currentDetail) return;
  els.detailTags.querySelector('input')?.blur();
  if (detailSaveTimer) {
    window.clearTimeout(detailSaveTimer);
    detailSaveTimer = null;
    await saveDetail();
  }
  await detailSaveInFlight;
}

async function closeDetail() {
  const closingId = state.selectedId;
  await flushDetailSave();
  if (state.selectedId !== closingId) return;
  const restoreFocus = document.activeElement === document.body || els.detailPane.contains(document.activeElement)
    || els.linksList.contains(document.activeElement);
  clearDetail();
  if (restoreFocus) focusLinkIndex(state.links.findIndex((link) => link.id === state.focusedLinkId));
}

function focusLinkIndex(index = 0) {
  if (!state.links.length) {
    els.linksList.focus();
    return;
  }
  index = Math.max(0, Math.min(index, state.links.length - 1));
  state.focusedLinkId = state.links[index].id;
  const top = index * LINK_ROW_HEIGHT;
  const bottom = top + LINK_ROW_HEIGHT;
  if (top < els.linksList.scrollTop) els.linksList.scrollTop = top;
  else if (bottom > els.linksList.scrollTop + els.linksList.clientHeight) {
    els.linksList.scrollTop = bottom - els.linksList.clientHeight;
  }
  renderVirtualLinks();
  Array.from(els.linksList.querySelectorAll('.linkRow'))
    .find((row) => row.dataset.id === state.focusedLinkId)?.querySelector('.linkRowMain').focus({ preventScroll: true });
}

async function focusLinkList() {
  if (state.navMode !== 'links') await setNavMode('links');
  focusLinkIndex(state.links.findIndex((link) => link.id === state.focusedLinkId));
}

function keyboardLink() {
  const rowId = document.activeElement.closest('.linkRow')?.dataset.id;
  const id = rowId || (els.detailPane.contains(document.activeElement) ? state.selectedId : state.focusedLinkId) || state.selectedId;
  return state.links.find((link) => link.id === id) || state.links[0];
}

function focusSidebarDisclosure(key) {
  const disclosure = els.sidebarContent.querySelector(`[data-disclosure="${key}"]`);
  if (!disclosure) {
    setStatus(`No ${key} available.`);
    return;
  }
  state.sidebarExpanded[key] = true;
  disclosure.open = true;
  disclosure.querySelector('.filterChoices button')?.focus();
}

async function runKeyboardCommand(command) {
  if (command === 'shortcuts') {
    showKeyboardShortcuts();
    return;
  }
  // Modal editors own focus until their changes have been saved and closed.
  if (els.shortcutsDialog.open || state.captureReview) return;
  if (command === 'settings') {
    state.settingsTab = 'library';
    await setNavMode('settings');
    els.linksList.querySelector('button, input')?.focus();
    return;
  }
  if (!state.libraryRoot) {
    setStatus('Open or create a library first.');
    return;
  }
  if (state.navMode !== 'links') await setNavMode('links');
  switch (command) {
    case 'add-link':
      if (!state.quickAddPending) setQuickAddExpanded(true);
      break;
    case 'search':
      els.search.focus();
      els.search.select();
      break;
    case 'focus-list':
      await focusLinkList();
      break;
    case 'all-links':
      els.search.value = '';
      await applyFilters({ status: 'active' }, { reset: true });
      focusLinkIndex(0);
      break;
    case 'switch-status':
      await chooseSidebarFilter('links', { status: state.filters.status === 'archived' ? 'active' : 'archived' }, { reset: true });
      focusLinkIndex(0);
      break;
    case 'labels':
      els.sidebarContent.querySelector('[data-filter-group="labels"]')?.focus();
      break;
    case 'contexts':
    case 'tags':
      focusSidebarDisclosure(command);
      break;
    case 'link-info': {
      const link = keyboardLink();
      if (link) await selectLink(link.id);
      break;
    }
    case 'open-link': {
      const link = keyboardLink();
      if (link) await window.rinku.openExternal(link.url);
      break;
    }
    case 'archive-link': {
      const link = keyboardLink();
      if (link) await toggleArchiveLink(link);
      break;
    }
  }
}

function handleKeyboardNavigation(event) {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (state.captureReview || els.shortcutsDialog.open) return;
  const target = event.target;
  if (event.key === 'Escape') {
    const disclosure = target.closest('details[open]');
    if (disclosure) {
      disclosure.open = false;
      state.sidebarExpanded[disclosure.dataset.disclosure] = false;
      disclosure.querySelector('summary').focus();
    } else if (target === els.search) {
      els.search.value = '';
      refreshLinks({ resetScroll: true }).then(() => focusLinkIndex(0)).catch(showError);
    } else if (state.selectedId) {
      closeDetail().catch(showError);
    } else return;
    event.preventDefault();
    return;
  }
  if (event.key === 'F6') {
    event.preventDefault();
    const regions = [els.sidebarContent.querySelector('summary, button'), els.linksList,
      ...(!els.detailPane.classList.contains('hidden') ? [els.detailClose] : []),
      ...(!els.toolbar.classList.contains('hidden') ? [els.search] : [])].filter(Boolean);
    let index = regions.findIndex((element) => element === target || (element === els.linksList && element.contains(target))
      || (element === els.detailClose && els.detailPane.contains(target))
      || (element.closest('.sidebarContent') && els.sidebarContent.contains(target)));
    index = (index + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
    if (regions[index] === els.linksList && state.navMode === 'links') focusLinkIndex(state.links.findIndex((link) => link.id === state.focusedLinkId));
    else regions[index].focus();
    return;
  }
  if (target === els.search && event.key === 'ArrowDown') {
    event.preventDefault();
    focusLinkIndex(0);
    return;
  }
  if (target.matches('input, textarea, select') || target.isContentEditable) return;
  if (els.linksList.contains(target) && state.navMode === 'links') {
    const index = Math.max(0, state.links.findIndex((link) => link.id === state.focusedLinkId));
    const pageSize = Math.max(1, Math.floor(els.linksList.clientHeight / LINK_ROW_HEIGHT));
    const indices = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: state.links.length - 1, PageDown: index + pageSize, PageUp: index - pageSize };
    if (event.key in indices) {
      event.preventDefault();
      focusLinkIndex(indices[event.key]);
    } else {
      const command = { i: 'link-info', o: 'open-link', e: 'archive-link' }[event.key.toLowerCase()];
      const openWithEnter = event.key === 'Enter' && (target === els.linksList || target.classList.contains('linkRowMain'));
      if (command || openWithEnter) {
        event.preventDefault();
        if (!event.repeat) runKeyboardCommand(command || 'open-link').catch(showError);
      }
    }
  } else if (els.sidebarContent.contains(target)) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const controls = Array.from(els.sidebarContent.querySelectorAll('button, summary')).filter((element) => element.getClientRects().length);
      const index = controls.indexOf(target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
      controls[Math.max(0, Math.min(next, controls.length - 1))]?.focus();
      event.preventDefault();
    } else if (event.key === 'ArrowRight' && target.matches('summary')) {
      target.parentElement.open = true;
      state.sidebarExpanded[target.parentElement.dataset.disclosure] = true;
      target.parentElement.querySelector('button')?.focus();
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && target.closest('details[open]')) {
      const disclosure = target.closest('details');
      disclosure.open = false;
      state.sidebarExpanded[disclosure.dataset.disclosure] = false;
      disclosure.querySelector('summary').focus();
      event.preventDefault();
    }
  }
}

function shortcutText(accelerator) {
  const isMac = navigator.platform.startsWith('Mac');
  return accelerator.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace('Shift', isMac ? '⇧' : 'Shift').replaceAll('+', ' + ');
}

function initShortcutHints() {
  const targets = { 'add-link': els.quickAddSubmit, search: els.search, 'focus-list': els.linksList,
    settings: els.settingsButton, 'link-info': els.detailPane };
  for (const command of window.rinkuKeyboardCommands) {
    const element = targets[command.id];
    if (!element) continue;
    element.setAttribute('aria-keyshortcuts', command.accelerator.replace('CommandOrControl', navigator.platform.startsWith('Mac') ? 'Meta' : 'Control'));
    element.title = `${command.label} (${shortcutText(command.accelerator)})`;
  }
}

function showKeyboardShortcuts() {
  if (els.shortcutsDialog.open) return;
  const commandRows = (ids) => ids.map((id) => {
    const command = window.rinkuKeyboardCommands.find((candidate) => candidate.id === id);
    return [command.label, shortcutText(command.accelerator || command.shortcut)];
  });
  const categories = [
    ['Navigation', [
      ...commandRows(['search', 'focus-list']),
      ['Move through links or sidebar', '↑ / ↓'],
      ['First / last link', 'Home / End'],
      ['Move one page', 'Page Up / Down'],
      ['Next / previous region', 'F6 / Shift + F6'],
    ]],
    ['Link actions', [
      ...commandRows(['link-info', 'open-link', 'archive-link']),
      ['Information (in list)', 'I'],
      ['Open (in list)', 'Enter / O'],
      ['Archive / restore (in list)', 'E'],
    ]],
    ['Filters and views', commandRows(['all-links', 'switch-status', 'labels', 'contexts', 'tags'])],
    ['Capture and editing', [
      ...commandRows(['add-link']),
      ['Complete tag and keep typing', 'Comma / Enter'],
    ]],
    ['General', [
      ...commandRows(['settings', 'shortcuts']),
      ['Close panel or menu', 'Escape'],
    ]],
  ];
  els.shortcutsContent.replaceChildren();
  const columns = [document.createElement('div'), document.createElement('div')];
  for (const column of columns) column.className = 'shortcutColumn';
  for (const index of [0, 2, 1, 3, 4]) {
    const [category, shortcuts] = categories[index];
    const section = document.createElement('section');
    section.className = 'shortcutCategory';
    const heading = document.createElement('h3');
    heading.textContent = category;
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.className = 'visuallyHidden';
    caption.textContent = `${category} shortcuts`;
    table.appendChild(caption);
    const body = document.createElement('tbody');
    for (const [label, keys] of shortcuts) {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = label;
      const shortcut = document.createElement('td');
      const key = document.createElement('kbd');
      key.textContent = keys;
      shortcut.appendChild(key);
      row.append(name, shortcut);
      body.appendChild(row);
    }
    table.appendChild(body);
    section.append(heading, table);
    columns[index === 0 || index === 2 ? 0 : 1].appendChild(section);
  }
  els.shortcutsContent.append(...columns);
  els.shortcutsDialog.showModal();
}

function bindChromeButtons() {
  window.addEventListener('focus', () => {
    if (state.navMode === 'settings' && state.settingsTab === 'capture') refreshSafariCaptureStatus?.();
  });
  els.allLinksButton.addEventListener('click', () => setNavMode('links').catch(showError));
  els.settingsButton.addEventListener('click', () => setNavMode('settings').catch(showError));
  els.libraryPath.addEventListener('click', () => {
    state.settingsTab = 'library';
    setNavMode('settings').catch(showError);
  });
}

function initIcons() {
  setIconOnly(els.allLinksButton, 'list');
  setIconOnly(els.settingsButton, 'settings');
  els.quickAddSubmit.appendChild(icon('plus'));
  els.searchIcon.replaceChildren(icon('search'));
  setIconOnly(els.detailClose, 'x');
  setIconOnly(els.captureReviewDone, 'check');
}

function cacheElements() {
  [
    'allLinksButton',
    'captureReviewBody',
    'captureReviewContexts',
    'captureReviewDone',
    'captureReviewLabel',
    'captureReviewModal',
    'captureReviewNotice',
    'captureReviewSaveState',
    'captureReviewTags',
    'captureReviewTitle',
    'captureReviewUrl',
    'content',
    'detailBody',
    'detailClose',
    'detailContexts',
    'detailDomain',
    'detailLabel',
    'detailPane',
    'detailSaveState',
    'detailTags',
    'detailTitle',
    'detailUrl',
    'libraryPath',
    'linkDetail',
    'linksList',
    'listCount',
    'listKicker',
    'listTitle',
    'quickAddForm',
    'quickAddSubmit',
    'quickAddUrl',
    'search',
    'searchIcon',
    'settingsButton',
    'shortcutsDialog',
    'shortcutsContent',
    'sideKicker',
    'sideTitle',
    'sidebarContent',
    'status',
    'toolbar',
  ].forEach((id) => {
    els[id] = $(id);
  });
}

async function init() {
  cacheElements();
  initIcons();
  els.quickAddForm.addEventListener('submit', (event) => quickAdd(event).catch(showError));
  els.quickAddSubmit.addEventListener('click', (event) => {
    if (!state.quickAddExpanded) {
      event.preventDefault();
      setQuickAddExpanded(true);
    }
  });
  els.quickAddForm.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !state.quickAddPending) {
      event.preventDefault();
      setQuickAddExpanded(false);
      els.quickAddSubmit.focus();
    }
  });
  els.detailClose.addEventListener('click', () => closeDetail().catch(showError));
  els.detailBody.addEventListener('input', () => scheduleDetailSave(800));
  els.captureReviewDone.addEventListener('click', () => closeCaptureReview().catch(showError));
  els.captureReviewTitle.addEventListener('input', () => scheduleCaptureReviewSave(600));
  els.captureReviewBody.addEventListener('input', () => scheduleCaptureReviewSave(800));
  els.captureReviewModal.addEventListener('click', (event) => {
    if (event.target === els.captureReviewModal) {
      closeCaptureReview().catch(showError);
    }
  });
  els.captureReviewModal.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeCaptureReview().catch(showError);
  });
  document.addEventListener('keydown', handleKeyboardNavigation);
  els.linksList.addEventListener('focusin', (event) => {
    const row = event.target.closest('.linkRow');
    if (!row) return;
    state.focusedLinkId = row.dataset.id;
    for (const button of els.linksList.querySelectorAll('.linkRow button')) {
      button.tabIndex = button.closest('.linkRow').dataset.id === state.focusedLinkId ? 0 : -1;
    }
  });
  window.rinku.onCommand((command) => runKeyboardCommand(command).catch(showError));
  initShortcutHints();
  window.rinku.onLibraryChanged((payload) => {
    if (payload?.libraryRoot === state.libraryRoot) refreshChangedLibrary().catch(showError);
  });
  els.search.addEventListener('input', () => refreshLinks({ resetScroll: true }).catch(showError));
  els.linksList.addEventListener('scroll', scheduleVirtualRender, { passive: true });
  bindChromeButtons();
  window.rinku.onCaptureCreated((payload) => {
    if (!payload || payload.libraryRoot !== state.libraryRoot) {
      return;
    }
    const link = payload.link;
    if (link) {
      updateCachedLink(link);
    }
    setStatus(payload.updated ? 'Link updated.' : payload.duplicate ? 'Link already saved.' : 'Link captured.');
    refreshLinks({ reload: true }).then(async () => {
      if (payload.review && link) {
        await flushDetailSave();
        if (state.captureReview) await closeCaptureReview();
        const current = await window.rinku.readLink(state.libraryRoot, link.id);
        openCaptureReview(current, { duplicate: payload.duplicate });
      }
    }).catch(showError);
  });
  renderSidebar();
  renderLinks();

  if (state.libraryRoot) {
    try {
      await openLibrary(state.libraryRoot);
    } catch (error) {
      showError(error);
      localStorage.removeItem('rinku.libraryRoot');
      state.libraryRoot = '';
      state.settings = null;
      state.captureStatus = null;
      state.indexLoaded = false;
      state.indexLinks = [];
      els.libraryPath.textContent = 'No library open';
      els.libraryPath.title = 'Open library settings';
      els.libraryPath.setAttribute('aria-label', 'No library open. Open library settings');
      await refreshLinks();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(showError);
});
