export const SCHEMA = 2;
export const TYPES = ['app', 'file', 'folder', 'url', 'command'];
export const ICONS = ['app', 'file', 'folder', 'url', 'command', 'star', 'spark', 'code', 'music'];
export const SIZES = ['small', 'medium', 'large'];
export const ANCHORS = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'];
export const SHORTCUTS = ['toggle', 'previous', 'next'];
const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift', 'Super'];
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Left|Right|Up|Down)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export const uid = () => globalThis.crypto.randomUUID();
export const blankSlots = (layout) => Array(layout.rows * layout.columns).fill(null);
export const makeTablet = (name, layout) => ({ id: uid(), name, slots: blankSlots(layout) });
export const defaultShortcuts = (platform) => platform === 'darwin'
  ? { toggle: 'Alt+Space', previous: 'Command+Control+Left', next: 'Command+Control+Right' }
  : { toggle: 'Control+Alt+Space', previous: 'Alt+PageUp', next: 'Alt+PageDown' };

export function makeState() {
  const layout = { rows: 3, columns: 4, size: 'medium' };
  return {
    schemaVersion: SCHEMA,
    layout,
    tablets: [makeTablet('Default', layout)],
    overflow: [],
    settings: {
      language: 'system', theme: 'system', background: '', accent: '#7b61cf',
      opacity: 98, radius: 20, gap: 8, iconSize: 30, labels: true, reducedMotion: false,
      anchor: 'top-right', marginTop: 24, marginRight: 24,
      monitor: 'cursor', monitorId: '', dismissOutside: true, closeAfterRun: true,
      floating: false, floatingPosition: null, wheel: false, startup: false,
      advanced: false, onboarded: false, shortcuts: { toggle: '', previous: '', next: '' }
    }
  };
}

export function glyphFields(type = 'app') {
  return {
    id: uid(), type, name: '', target: '', description: '', args: [],
    cwd: '', envNames: [], shell: 'system', confirm: type === 'command', disabled: false, icon: { kind: 'auto' }
  };
}

function ensure(value, code) {
  if (!value) throw new Error(code);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value, max, required = false) {
  ensure(typeof value === 'string' && value.length <= max && !value.includes('\0'), 'invalidData');
  ensure(!required || value.trim(), 'required');
  return value;
}

function choice(value, options) {
  ensure(options.includes(value), 'invalidData');
  return value;
}

function bounded(value, min, max) {
  ensure(Number.isInteger(value) && value >= min && value <= max, 'invalidData');
  return value;
}

export function allowedURL(value) {
  if (!/^(?:https?:\/\/|mailto:)/i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return Boolean(url.pathname);
    return Boolean(url.hostname && !url.username && !url.password);
  } catch {
    return false;
  }
}

export function cleanGlyph(value) {
  ensure(record(value) && record(value.icon), 'invalidData');
  const type = choice(value.type, TYPES);
  const kind = choice(value.icon.kind, ['auto', 'preset', 'image']);
  let icon = { kind };
  if (kind === 'preset') icon = { kind, value: choice(value.icon.value, ICONS) };
  if (kind === 'image') {
    const data = string(value.icon.value, 120_000);
    ensure(PNG.test(data) && data.startsWith('data:image/png;base64,iVBORw0KGgo'), 'invalidIcon');
    const header = atob(data.slice(22, 54));
    ensure(header.length === 24 && header.slice(12, 16) === 'IHDR', 'invalidIcon');
    const dimensions = new DataView(Uint8Array.from(header, byte => byte.charCodeAt(0)).buffer);
    const width = dimensions.getUint32(16);
    const height = dimensions.getUint32(20);
    ensure(width >= 1 && width <= 512 && height >= 1 && height <= 512, 'invalidIcon');
    icon = { kind, value: data };
  }
  const args = value.args ?? [];
  const envNames = value.envNames ?? [];
  ensure(Array.isArray(args) && args.length <= 64, 'invalidData');
  ensure(Array.isArray(envNames) && envNames.length <= 64 &&
    envNames.every(name => typeof name === 'string' && name.length <= 128 && ENV_NAME.test(name)), 'envNamesOnly');
  return {
    id: string(value.id, 128, true), type, name: string(value.name, 150, true).trim(),
    target: string(value.target, 16_384, true).trim(), description: string(value.description ?? '', 1000),
    args: ['app', 'command'].includes(type) ? args.map(arg => string(arg, 4096)) : [],
    cwd: type === 'command' ? string(value.cwd ?? '', 4096).trim() : '',
    envNames: type === 'command' ? [...new Set(envNames)] : [],
    shell: type === 'command' ? choice(value.shell ?? 'system', ['system', 'powershell', 'process']) : 'system',
    confirm: value.confirm === true, disabled: value.disabled === true, icon
  };
}

export function cleanShortcut(value) {
  if (value == null || value === '') return '';
  ensure(typeof value === 'string' && value.length <= 64, 'invalidShortcut');
  const terms = value.split('+').map(term => term.trim());
  const rawKey = terms.pop();
  const key = rawKey.replace(/^Arrow/, '');
  const mods = terms.map(term => ({
    Cmd: 'Command', Ctrl: 'Control', Option: 'Alt', Meta: 'Super', Win: 'Super'
  })[term] ?? term);
  ensure(KEY.test(key) && mods.length > 0 && mods.every(mod => MODIFIERS.includes(mod)) &&
    new Set(mods).size === mods.length, 'invalidShortcut');
  return [...MODIFIERS.filter(mod => mods.includes(mod)), key].join('+');
}

export function verifyShortcuts(shortcuts, platform) {
  const defaults = defaultShortcuts(platform);
  const resolved = SHORTCUTS.map(key => shortcuts[key] || defaults[key]);
  ensure(new Set(resolved).size === resolved.length, 'duplicateShortcut');
}

export function cleanState(value) {
  ensure(record(value) && value.schemaVersion === SCHEMA && record(value.layout) &&
    record(value.settings), 'invalidVersion');
  const layout = {
    rows: bounded(value.layout.rows, 1, 8),
    columns: bounded(value.layout.columns, 1, 8),
    size: choice(value.layout.size, SIZES)
  };
  const settings = makeState().settings;
  for (const key of ['labels', 'reducedMotion', 'dismissOutside', 'closeAfterRun', 'floating', 'wheel', 'startup', 'advanced', 'onboarded']) {
    if (key in value.settings) {
      ensure(typeof value.settings[key] === 'boolean', 'invalidData');
      settings[key] = value.settings[key];
    }
  }
  for (const [key, options] of Object.entries({
    language: ['system', 'en', 'ja'], theme: ['system', 'light', 'dark'], anchor: ANCHORS,
    monitor: ['cursor', 'active', 'fixed']
  })) {
    if (key in value.settings) settings[key] = choice(value.settings[key], options);
  }
  for (const [key, range] of Object.entries({
    opacity: [55, 100], radius: [0, 36], gap: [2, 16], iconSize: [16, 48],
    marginTop: [0, 160], marginRight: [0, 160]
  })) {
    if (key in value.settings) settings[key] = bounded(value.settings[key], ...range);
  }
  for (const key of ['background', 'accent']) {
    if (!(key in value.settings)) continue;
    const color = string(value.settings[key], 7);
    ensure(color === '' || HEX.test(color), 'invalidData');
    settings[key] = color;
  }
  settings.monitorId = string(value.settings.monitorId ?? '', 64);
  if (value.settings.floatingPosition != null) {
    const position = value.settings.floatingPosition;
    ensure(record(position), 'invalidData');
    settings.floatingPosition = {
      x: bounded(position.x, -1_000_000, 1_000_000),
      y: bounded(position.y, -1_000_000, 1_000_000)
    };
  }
  const shortcuts = value.settings.shortcuts ?? {};
  ensure(record(shortcuts), 'invalidShortcut');
  for (const key of SHORTCUTS) settings.shortcuts[key] = cleanShortcut(shortcuts[key]);

  ensure(Array.isArray(value.tablets) && value.tablets.length > 0 && value.tablets.length <= 100 &&
    Array.isArray(value.overflow) && value.overflow.length <= 6400, 'invalidData');
  const tabletIds = new Set();
  const glyphIds = new Set();
  const claimGlyph = (glyph) => {
    const clean = cleanGlyph(glyph);
    ensure(!glyphIds.has(clean.id), 'duplicateGlyph');
    glyphIds.add(clean.id);
    return clean;
  };
  const tablets = value.tablets.map(tablet => {
    ensure(record(tablet) && Array.isArray(tablet.slots) &&
      tablet.slots.length === layout.rows * layout.columns, 'invalidData');
    const id = string(tablet.id, 128, true);
    ensure(!tabletIds.has(id), 'invalidData');
    tabletIds.add(id);
    return { id, name: string(tablet.name, 150, true).trim(),
      slots: tablet.slots.map(glyph => glyph === null ? null : claimGlyph(glyph)) };
  });
  const overflow = value.overflow.map(item => {
    ensure(record(item), 'invalidData');
    const saved = {
      glyph: claimGlyph(item.glyph), tabletId: string(item.tabletId ?? '', 128),
      tabletName: string(item.tabletName ?? '', 150), slot: bounded(item.slot ?? -1, -1, 63),
      layout: choice(item.layout ?? 'grid', ['grid', 'triangle'])
    };
    if (saved.layout === 'triangle') saved.edge = bounded(item.edge, 3, 7);
    return saved;
  });
  return { schemaVersion: SCHEMA, settings, layout, tablets, overflow };
}

export function persistable(state, includeImages = true) {
  const clean = cleanState(state);
  if (!includeImages) {
    for (const glyph of allGlyphs(clean)) {
      if (glyph.icon.kind === 'image') glyph.icon = { kind: 'auto' };
    }
  }
  return clean;
}

export function allGlyphs(state) {
  return [...state.tablets.flatMap(tablet => tablet.slots.filter(Boolean)), ...state.overflow.map(item => item.glyph)];
}

function park(state, tablet, glyph, slot) {
  state.overflow.push({ glyph, tabletId: tablet.id, tabletName: tablet.name, slot, layout: 'grid' });
}

export function resizeGrid(state, layout) {
  const previous = state.layout;
  for (const tablet of state.tablets) {
    const newSlots = blankSlots(layout);
    tablet.slots.forEach((glyph, index) => {
      if (!glyph) return;
      const row = Math.floor(index / previous.columns);
      const column = index % previous.columns;
      if (row < layout.rows && column < layout.columns) newSlots[row * layout.columns + column] = glyph;
      else park(state, tablet, glyph, index);
    });
    tablet.slots = newSlots;
  }
  state.layout = layout;
}

export function removeTablet(state, tabletId, action, destination) {
  ensure(state.tablets.length > 1, 'lastTablet');
  ensure(['move', 'overflow', 'delete'].includes(action), 'invalidData');
  const source = state.tablets.find(item => item.id === tabletId);
  const target = state.tablets.find(item => item.id === destination && item.id !== tabletId);
  ensure(source && (action !== 'move' || target), 'invalidData');
  source.slots.forEach((glyph, index) => {
    if (!glyph || action === 'delete') return;
    const free = action === 'move' ? target.slots.indexOf(null) : -1;
    if (free >= 0) target.slots[free] = glyph;
    else park(state, source, glyph, index);
  });
  state.tablets = state.tablets.filter(tablet => tablet.id !== tabletId);
}

export function migrateLegacy(raw) {
  ensure(record(raw) && raw.schemaVersion === 1 && Array.isArray(raw.tablets), 'invalidVersion');
  const edge = bounded(raw.layout?.edgeN, 3, 7);
  const state = makeState();
  const issues = new Set(['legacyTriangle']);
  if (SIZES.includes(raw.layout.glyphSizePreset)) state.layout.size = raw.layout.glyphSizePreset;
  state.settings.onboarded = true;
  state.settings.closeAfterRun = false;
  state.settings.floating = raw.ui?.floatingIcon?.enabled ?? true;
  const floating = raw.ui?.floatingIcon?.position;
  if (Number.isInteger(floating?.x) && Number.isInteger(floating?.y)) {
    state.settings.floatingPosition = { x: floating.x, y: floating.y };
  }
  const altar = raw.ui?.altar;
  if (Number.isFinite(altar?.safeMarginTop)) state.settings.marginTop = Math.round(Math.min(160, Math.max(0, altar.safeMarginTop)));
  if (Number.isFinite(altar?.safeMarginRight)) state.settings.marginRight = Math.round(Math.min(160, Math.max(0, altar.safeMarginRight)));
  state.settings.opacity = { low: 70, medium: 88, high: 98 }[altar?.opacityLevel] ?? state.settings.opacity;
  for (const [key, oldKey] of Object.entries({ toggle: 'toggleAltar', previous: 'tabletPrev', next: 'tabletNext' })) {
    try {
      state.settings.shortcuts[key] = cleanShortcut(raw.shortcuts?.[oldKey]);
    } catch {
      issues.add('legacyShortcut');
    }
  }
  state.tablets = raw.tablets.map(tablet => {
    ensure(record(tablet) && Array.isArray(tablet.glyphSlots) &&
      tablet.glyphSlots.length === edge * (edge + 1) / 2, 'invalidData');
    const page = makeTablet(tablet.name, state.layout);
    page.id = tablet.id;
    tablet.glyphSlots.forEach((old, slot) => {
      if (old === null) return;
      ensure(record(old) && ['shell', 'powershell', 'url'].includes(old.type), 'invalidData');
      const glyph = {
        ...glyphFields(old.type === 'url' ? 'url' : 'command'), id: old.id, name: old.label,
        target: old.line, cwd: old.workingDir, shell: old.type === 'powershell' ? 'powershell' : 'system',
        confirm: old.confirm === true, disabled: old.type !== 'url'
      };
      if (record(old.env) && Object.keys(old.env).length) {
        issues.add('legacyEnvironment');
        glyph.envNames = Object.keys(old.env).filter(name => name.length <= 128 && ENV_NAME.test(name)).slice(0, 64);
      }
      if (typeof old.icon === 'string' && ICONS.includes(old.icon.slice(7)) && old.icon.startsWith('preset:')) {
        glyph.icon = { kind: 'preset', value: old.icon.slice(7) };
      } else if (old.icon) {
        issues.add('legacyIcon');
      }
      state.overflow.push({ glyph, tabletId: page.id, tabletName: page.name, slot, layout: 'triangle', edge });
    });
    return page;
  });
  return { state: cleanState(state), issues: [...issues] };
}

export function readImport(raw) {
  if (raw?.format === 'glyph-on') {
    ensure(raw.version === 1, 'invalidVersion');
    raw = raw.settings;
  }
  const imported = raw?.schemaVersion === 1 ? migrateLegacy(raw) : { state: cleanState(raw), issues: [] };
  for (const glyph of allGlyphs(imported.state)) {
    if (glyph.type === 'command' || glyph.type === 'app') glyph.disabled = true;
  }
  return imported;
}

export function mergeImport(current, incoming) {
  const state = structuredClone(current);
  const source = structuredClone(incoming);
  resizeGrid(source, state.layout);
  const names = new Set(state.tablets.map(tablet => tablet.name));
  const pages = new Map();
  for (const tablet of source.tablets) {
    const oldId = tablet.id;
    const originalName = tablet.name;
    let number = 2;
    while (names.has(tablet.name)) {
      const suffix = ` (${number++})`;
      tablet.name = originalName.slice(0, 150 - suffix.length) + suffix;
    }
    names.add(tablet.name);
    tablet.id = uid();
    pages.set(oldId, tablet);
    for (const glyph of tablet.slots.filter(Boolean)) glyph.id = uid();
    state.tablets.push(tablet);
  }
  for (const item of source.overflow) {
    const page = pages.get(item.tabletId);
    item.tabletId = page?.id ?? '';
    item.tabletName = page?.name ?? item.tabletName;
    item.glyph.id = uid();
    state.overflow.push(item);
  }
  return cleanState(state);
}
