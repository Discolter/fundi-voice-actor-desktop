export const requirements = {
  optional: 'Дополнительное',
  recommended: 'Рекомендуемое',
  required: 'Обязательное'
};

export function element(parent, tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

export function action(parent, label, run, primary = false) {
  const button = element(parent, 'button', primary ? 'fvr-button fvr-primary' : 'fvr-button', label);
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

export function selectOptions(select, options, value = '') {
  select.replaceChildren();
  for (const [key, label] of options) element(select, 'option', '', label).value = key;
  select.value = value;
}

export function contentPath(result) {
  const path = result?.downloadPath || '';
  if (!/^\/v1\/resources\/content\?/.test(path)) throw Error('Ссылка на файл недоступна.');
  return path;
}

function externalLink(parent, label, url) {
  let target;
  try { target = new URL(url); } catch { return; }
  if (target.protocol !== 'https:' || target.username || target.password) return;
  const link = element(parent, 'a', 'fvr-button', label);
  link.href = target.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
}

export async function openResourceFile(file, resolveUrl, parent, reportError) {
  try {
    const url = await resolveUrl(file.id);
    if (!parent.isConnected) return;
    const link = element(parent, 'a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener noreferrer';
    link.click();
    link.remove();
  } catch (error) {
    reportError(error.message || 'Файл не удалось открыть.');
  }
}

export function showScreenshots(parent, files, resolveUrl) {
  if (!files.length) return;
  element(parent, 'h3', '', 'Скриншоты');
  const gallery = element(parent, 'div', 'fvr-gallery');
  for (const file of files) {
    const wrap = element(gallery, 'figure');
    const image = element(wrap, 'img');
    const caption = element(wrap, 'figcaption', 'fvr-muted', file.name);
    image.alt = file.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.remove();
      caption.textContent = 'Скриншот недоступен';
    }, {once: true});
    resolveUrl(file.id).then(url => { image.src = url; }).catch(() => {
      image.remove();
      caption.textContent = 'Скриншот недоступен';
    });
  }
}

function softwareDetails(parent, item, resolveUrl, reportError) {
  const details = item.published;
  element(parent, 'h2', '', details.name);
  const meta = element(parent, 'div', 'fvr-actions');
  for (const text of [details.version && 'Версия ' + details.version, details.platform,
    details.category, requirements[details.requirement], details.inHouse && 'Наши разработки'].filter(Boolean))
    element(meta, 'span', 'fvr-badge', text);
  if (details.description) element(parent, 'p', 'fvr-text', details.description);
  const downloads = element(parent, 'div', 'fvr-actions');
  for (const file of item.files.filter(file => !file.screenshot)) {
    action(downloads, 'Скачать ' + file.name, async event => {
      const button = event.currentTarget;
      button.disabled = true;
      await openResourceFile(file, resolveUrl, downloads, reportError);
      button.disabled = false;
    }, true);
  }
  if (details.website) externalLink(downloads, 'Официальная ссылка', details.website);
  if (details.telegram) externalLink(downloads, 'Telegram', details.telegram);
  if (item.files.some(file => !file.screenshot))
    element(parent, 'p', 'fvr-muted', 'Скачиваний из каталога: ' + item.downloads);
  if (details.instructions) {
    element(parent, 'h3', '', 'Установка');
    element(parent, 'p', 'fvr-text', details.instructions);
  }
  showScreenshots(parent, item.files.filter(file => file.screenshot), resolveUrl);
  if (item.history.length) {
    element(parent, 'h3', '', 'История версий');
    for (const entry of item.history) {
      const row = element(parent, 'div', 'fvr-version');
      const when = new Date(entry.publishedAt);
      element(row, 'strong', '', entry.version);
      if (!Number.isNaN(when.getTime())) element(row, 'span', 'fvr-muted', when.toLocaleDateString('ru-RU'));
      if (entry.changes) element(row, 'p', 'fvr-text', entry.changes);
    }
  }
}

export function createSoftwareLibrary({identity, load, resolveUrl}) {
  let panel = null;
  let owner = null;
  let sequence = 0;
  let items = [];
  let selected = '';
  let query = '';
  let category = '';
  let requirement = '';
  let initialized = false;
  let loading = false;
  let lastAttempt = 0;

  function reset() {
    ++sequence;
    panel = null;
    owner = null;
    items = [];
    selected = query = category = requirement = '';
    initialized = false;
    loading = false;
    lastAttempt = 0;
  }

  function render() {
    if (!panel) return;
    panel.replaceChildren();
    const toolbar = element(panel, 'div', 'fvr-toolbar');
    element(toolbar, 'h1', '', 'Студийное ПО');
    action(toolbar, 'Обновить', () => { void refresh(); });
    const status = element(panel, 'p', 'fvr-status');
    status.setAttribute('role', 'status');
    const item = items.find(entry => entry.id === selected);
    if (item) {
      action(toolbar, 'К каталогу', () => { selected = ''; render(); });
      softwareDetails(element(panel, 'article', 'fvr-card'), item, resolveUrl,
        message => { status.textContent = message; });
      return;
    }
    if (!initialized) return;
    const filters = element(panel, 'div', 'fvr-actions');
    const search = element(filters, 'input');
    search.type = 'search';
    search.value = query;
    search.placeholder = 'Поиск по каталогу';
    search.setAttribute('aria-label', search.placeholder);
    const categories = element(filters, 'select');
    categories.setAttribute('aria-label', 'Категория');
    const allCategories = [...new Set(items.map(entry => entry.published.category).filter(Boolean))].sort();
    selectOptions(categories, [['', 'Все категории'], ['in-house', 'Наши разработки'],
      ...allCategories.map(name => ['category:' + name, name])], category);
    const levels = element(filters, 'select');
    levels.setAttribute('aria-label', 'Требования');
    selectOptions(levels, [['', 'Любое назначение'], ...Object.entries(requirements)], requirement);
    const list = element(panel, 'div', 'fvr-grid');
    function showResults() {
      list.replaceChildren();
      const needle = query.trim().toLocaleLowerCase('ru-RU');
      const filtered = items.filter(({published: p}) =>
        (!requirement || p.requirement === requirement) &&
        (!category || (category === 'in-house' ? p.inHouse : 'category:' + p.category === category)) &&
        [p.name, p.description, p.category, p.platform].join(' ').toLocaleLowerCase('ru-RU').includes(needle));
      if (!filtered.length) element(list, 'p', 'fvr-muted',
        items.length ? 'По заданным фильтрам ничего не найдено.' : 'В каталоге пока нет программ.');
      for (const entry of filtered) {
        const data = entry.published;
        const card = element(list, 'article', 'fvr-card');
        element(card, 'h2', '', data.name);
        element(card, 'p', 'fvr-muted', [data.version, data.platform, data.category,
          requirements[data.requirement]].filter(Boolean).join(' · '));
        if (data.description) element(card, 'p', 'fvr-preview', data.description);
        action(card, 'Открыть', () => { selected = entry.id; render(); });
      }
    }
    search.addEventListener('input', () => { query = search.value; showResults(); });
    categories.addEventListener('change', () => { category = categories.value; showResults(); });
    levels.addEventListener('change', () => { requirement = levels.value; showResults(); });
    showResults();
  }

  async function refresh({quiet = false} = {}) {
    if (!panel?.isConnected || loading || (quiet && Date.now() - lastAttempt < 30000)) return;
    if (quiet && panel.contains(document.activeElement) && document.activeElement?.matches('input, select')) return;
    const active = identity();
    const current = ++sequence;
    const status = panel?.querySelector('.fvr-status');
    loading = true;
    lastAttempt = Date.now();
    if (status && !quiet) status.textContent = 'Загружаем каталог…';
    try {
      const result = await load();
      if (current !== sequence || active !== identity()) return;
      const next = (result.software || []).filter(item => item.published);
      const changed = !initialized || JSON.stringify(items) !== JSON.stringify(next);
      items = next;
      initialized = true;
      if (!quiet || changed) render();
    } catch (error) {
      if (current === sequence && active === identity() && status && (!quiet || !initialized))
        status.textContent = error.message || 'Каталог временно недоступен.';
    } finally {
      if (current === sequence) loading = false;
    }
  }

  return {
    mount(root) {
      if (!root) return;
      if (owner !== identity()) reset();
      owner = identity();
      const fresh = !panel;
      if (fresh) panel = element(null, 'section', 'fv-resources');
      root.replaceChildren(panel);
      if (fresh) { render(); void refresh(); }
    },
    open(id) { selected = id; render(); if (panel) void refresh(); },
    refresh,
    reset
  };
}
