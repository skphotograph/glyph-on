import { ANCHORS } from './model.mjs';
import { languageOf, translate } from './i18n.mjs';
import { icon } from './icons.mjs';
import { banner, button, el } from './dom.mjs';
import { glyphEditor, glyphMenu, moveGlyph, overflowMenu } from './editor.mjs';
import { settingsPage } from './settings.mjs';

const bridge = window.glyphOn;
const shell = document.querySelector('#shell');
const notification = document.querySelector('#notification');
const media = window.matchMedia('(prefers-color-scheme: dark)');
let info;
let mode = 'launcher';
let edit = false;
let pageId;
let step = 1;
let setupAnchor;
let setupApp;
let applications = [];
let tab = 'customize';
let draft;
let modal;
let saving = false;
let undo = [];
let redo = [];
let statusTimer;
let lastWheel = 0;
let drag;
let activeTarget;
const knownIssues = new Set(['missing', 'invalidURL', 'invalidPath', 'wrongType', 'useAppType']);

const text = (key, values) => translate(languageOf(info?.state.settings.language, info?.locale), key, values);
const state = () => info?.state;
const page = () => state().tablets.find(tablet => tablet.id === pageId) ?? state().tablets[0];
const applyInfo = next => { info = next; if (!pageId || !state().tablets.some(tablet => tablet.id === pageId)) pageId = page().id; };

async function invoke(name, ...args) {
  const result = await bridge[name](...args);
  if (result.error) throw new Error(result.error);
  return result.value;
}

function toast(key, values = {}) {
  notification.textContent = text(key, values);
  notification.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => notification.classList.remove('visible'), 4500);
}

function errorToast(error) {
  toast(error?.message ?? 'operationFailed');
}

function nativeView() {
  void invoke('view', mode, edit || Boolean(modal)).catch(errorToast);
}

function focusAction(preferred) {
  const target = preferred && document.getElementById(preferred);
  (target || shell.querySelector('[data-autofocus]') || shell.querySelector('button'))?.focus({ preventScroll: true });
}

function context() {
  return {
    text, state, page, invoke, toast, errorToast, render, commit, openModal, closeModal, confirm,
    information: () => info, glyphContent, glyphTitle, showSettings, showLauncher,
    draft: () => draft, setTab: value => { tab = value; render(); },
    copyState: () => structuredClone(state())
  };
}

async function commit(next, { history = true, saveAs = 'save', extra = [] } = {}) {
  if (saving) return false;
  saving = true;
  const before = state();
  try {
    const result = saveAs === 'save' ? await invoke('save', next, info.revision) :
      await invoke(saveAs, ...extra, ...(saveAs === 'applyImport' ? [info.revision] : []));
    if (history) {
      undo.push(before);
      undo = undo.slice(-10);
      redo = [];
    }
    applyInfo(result);
    return true;
  } catch (error) {
    errorToast(error);
    if (error.message === 'staleSettings') applyInfo(await invoke('initial'));
    return false;
  } finally {
    saving = false;
  }
}

async function historyStep(reverse) {
  if (saving || mode !== 'launcher' || modal) return;
  const source = reverse ? undo : redo;
  const target = reverse ? redo : undo;
  if (!source.length) return;
  const before = state();
  const next = structuredClone(source.at(-1));
  next.settings.floatingPosition = before.settings.floatingPosition;
  if (await commit(next, { history: false })) {
    source.pop();
    target.push(before);
    render();
    focusAction(reverse ? 'undo' : 'redo');
  }
}

function openModal(title, body, footer = []) {
  if (modal) closeModal(false);
  activeTarget = document.activeElement?.id;
  const header = el('header', { class: 'dialog-head' }, el('h2', { id: 'dialog-title' }, title),
    button(text('close'), () => closeModal(), { glyph: 'close', iconOnly: true, look: 'ghost' }));
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title', oncancel: event => {
    event.preventDefault();
    closeModal();
  } }, header, el('div', { class: 'dialog-body' }, body),
  footer.length ? el('footer', { class: 'dialog-foot' }, footer) : null);
  document.body.append(dialog);
  modal = dialog;
  nativeView();
  dialog.showModal();
  const target = dialog.querySelector('[autofocus]');
  if (target) target.focus();
  return dialog;
}

function closeModal(restore = true) {
  if (!modal) return;
  modal.close();
  modal.remove();
  modal = null;
  nativeView();
  if (restore) focusAction(activeTarget);
}

function confirm(title, message, label, accept, danger = false) {
  openModal(title, el('p', {}, message), [
    button(text('cancel'), () => closeModal()),
    button(label, async () => { closeModal(false); await accept(); },
      { look: danger ? 'danger' : 'primary' })
  ]);
}

function glyphTitle(glyph, issue = '') {
  return [glyph.name, text(glyph.type), glyph.description, issue ? text(issue) : '',
    glyph.disabled ? text('disabledAction') : ''].filter(Boolean).join(' · ');
}

function glyphContent(glyph) {
  const artwork = el('span', { class: `glyph-art ${glyph.type}` }, icon(glyph.icon.kind === 'preset' ? glyph.icon.value : glyph.type));
  if (glyph.icon.kind === 'image') {
    const image = el('img', { src: glyph.icon.value, alt: '', draggable: false });
    image.addEventListener('load', () => artwork.replaceChildren(image));
  } else if (glyph.icon.kind === 'auto' && ['app', 'file', 'folder'].includes(glyph.type)) {
    void invoke('icon', glyph).then(url => {
      if (url && artwork.isConnected) artwork.replaceChildren(el('img', { src: url, alt: '', draggable: false }));
    }).catch(() => {});
  }
  return artwork;
}

function visual(settings) {
  const dark = settings.theme === 'dark' || settings.theme === 'system' && media.matches;
  const base = settings.background || (dark ? '#23212b' : '#f9f8fc');
  const rgb = [1, 3, 5].map(index => parseInt(base.slice(index, index + 2), 16));
  const luminance = rgb.map(channel => channel / 255).map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  document.documentElement.dataset.scheme = luminance < 0.23 ? 'dark' : 'light';
  document.documentElement.dataset.reduced = String(settings.reducedMotion);
  const styles = document.documentElement.style;
  styles.setProperty('--panel-base', base);
  styles.setProperty('--panel-opacity', String(settings.opacity / 100));
  styles.setProperty('--accent', settings.accent || '#7b61cf');
  styles.setProperty('--radius', `${settings.radius}px`);
  styles.setProperty('--gap', `${settings.gap}px`);
  styles.setProperty('--icon-size', `${settings.iconSize}px`);
}

function brand(title = 'Glyph-on', subtitle = 'Altar') {
  return el('div', { class: 'brand' }, el('img', { class: 'mark', src: '/mark.png', alt: '' }),
    el('div', { class: 'brand-text' }, el('h1', {}, title), el('span', {}, subtitle)));
}

function navButton(label, action, glyph, opts = {}) {
  return button(label, action, { glyph, iconOnly: true, look: 'ghost', ...opts });
}

function changePage(direction) {
  if (mode !== 'launcher' || modal) return;
  const pages = state().tablets;
  const index = pages.indexOf(page());
  pageId = pages[(index + direction + pages.length) % pages.length].id;
  render();
  focusAction(direction < 0 ? 'previous-tablet' : 'next-tablet');
}

async function execute(glyph, issue = '') {
  if (edit || glyph.disabled || glyph.type === 'command' && !state().settings.advanced || knownIssues.has(issue)) {
    glyphEditor(context(), { glyph, tabletId: pageId, index: page().slots.indexOf(glyph) });
    return;
  }
  const perform = async (confirmed = false) => {
    try {
      const result = await invoke('run', glyph.id, confirmed);
      if (knownIssues.has(result.status)) glyphEditor(context(), { glyph, tabletId: pageId,
        index: page().slots.indexOf(glyph), initialIssue: result.status });
      if (result.status === 'confirmRequired') toast(result.status);
    } catch (error) { errorToast(error); }
  };
  if (glyph.confirm) {
    const description = glyph.type === 'command' ? [
      el('p', {}, text('cmdWarning')), el('p', { class: 'quiet' }, text('commandHidden')),
      el('p', { class: 'target-display' }, glyph.shell === 'process' ? glyph.target :
        [glyph.shell === 'powershell' ? 'PowerShell' : text('shellSystem'), glyph.cwd].filter(Boolean).join(' · '))
    ] : el('p', { class: 'target-display' }, glyph.target);
    openModal(text('runGlyph', { name: glyph.name }), description, [
      button(text('cancel'), () => closeModal()),
      button(text('run'), async () => { closeModal(false); await perform(true); }, { look: 'primary' })
    ]);
  } else await perform();
}

function moveByDrag(source, target) {
  const next = structuredClone(state());
  const sourcePage = next.tablets.find(item => item.id === source.tabletId);
  const targetPage = next.tablets.find(item => item.id === target.tabletId);
  if (!sourcePage?.slots[source.index] || !targetPage || source.index === target.index && sourcePage === targetPage) return;
  [sourcePage.slots[source.index], targetPage.slots[target.index]] = [targetPage.slots[target.index], sourcePage.slots[source.index]];
  void commit(next).then(saved => { if (saved) { render(); focusAction(`glyph-${target.index}`); } });
}

function decorateDrop(tile, tabletId, index, glyph) {
  tile.draggable = Boolean(edit && glyph);
  tile.addEventListener('dragstart', event => {
    drag = { tabletId, index };
    event.dataTransfer.setData('application/x-glyph-on-slot', String(index));
    event.dataTransfer.effectAllowed = 'move';
  });
  tile.addEventListener('dragend', () => { drag = undefined; });
  tile.addEventListener('dragover', event => {
    if (modal || (!drag && glyph) || (!drag && ![...event.dataTransfer.types].some(type => ['Files', 'text/uri-list', 'text/plain'].includes(type)))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drag ? 'move' : 'copy';
    tile.classList.add('drop-target');
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop-target'));
  tile.addEventListener('drop', async event => {
    event.preventDefault();
    tile.classList.remove('drop-target');
    if (drag) {
      moveByDrag(drag, { tabletId, index });
      drag = undefined;
      return;
    }
    if (glyph || modal) return;
    try {
      const files = bridge.filePaths([...event.dataTransfer.files]);
      if (files.length > 1) { toast('dropOne'); return; }
      const target = files[0] || event.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#')) ||
        event.dataTransfer.getData('text/plain').trim();
      const drop = await invoke('describe', target);
      glyphEditor(context(), { glyph: drop, tabletId, index, fresh: true });
    } catch (error) { errorToast(error); }
  });
}

function grid() {
  const tablet = page();
  const tiles = [];
  const grid = el('div', { class: `grid ${state().layout.size}`, role: 'group', 'aria-label': text('layout') });
  grid.style.setProperty('--columns', state().layout.columns);
  tablet.slots.forEach((glyph, index) => {
    let issue = glyph?.disabled ? 'disabledAction' : '';
    const label = glyph ? glyphTitle(glyph) : text('emptySlot', { number: index + 1 });
    const tile = el('button', {
      id: `glyph-${index}`, type: 'button', class: glyph ? 'tile glyph-tile' : 'tile vacant',
      'aria-label': label, title: label,
      ...(index === 0 ? { 'data-autofocus': 'true' } : {}),
      onclick: () => glyph ? void execute(glyph, issue) : glyphEditor(context(), { tabletId: tablet.id, index, fresh: true })
    }, glyph ? glyphContent(glyph) : icon('plus'),
    glyph && state().settings.labels ? el('span', { class: 'glyph-label' }, glyph.name) : null);
    if (glyph) {
      const open = () => glyphMenu(context(), glyph, tablet.id, index, knownIssues.has(issue) ? issue : '');
      tile.addEventListener('contextmenu', event => { event.preventDefault(); open(); });
      tile.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); open(); }
      });
    }
    const markIssue = value => {
      issue = value || (glyph?.disabled ? 'disabledAction' : '');
      if (!issue) return;
      const label = glyphTitle(glyph, issue === 'disabledAction' ? '' : issue);
      tile.title = label;
      tile.setAttribute('aria-label', label);
      tile.classList.add('needs-review');
      tile.append(el('span', { class: 'tile-warning' }, icon('warning')));
    };
    tiles.push({ tile, glyph, markIssue });
    decorateDrop(tile, tablet.id, index, glyph);
    tile.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -state().layout.columns, ArrowDown: state().layout.columns }[event.key];
      event.preventDefault();
      document.getElementById(`glyph-${index + by}`)?.focus();
    });
    grid.append(tile);
  });
  const occupied = tiles.filter(item => item.glyph);
  for (const item of occupied) if (item.glyph.disabled) item.markIssue('disabledAction');
  void invoke('statuses', occupied.map(item => item.glyph)).then(issues => {
    issues.forEach((issue, index) => { if (issue && !occupied[index].glyph.disabled) occupied[index].markIssue(issue); });
  }).catch(() => {});
  return grid;
}

function launcher() {
  const tablet = page();
  const index = state().tablets.indexOf(tablet);
  const count = state().tablets.length;
  const overflow = state().overflow.length;
  const noContent = !tablet.slots.some(Boolean);
  const overflowLabel = overflow ? `${text('overflow')} · ${overflow}` : text('overflow');
  const toolbar = el('div', { class: 'launcher-toolbar' },
    brand(), el('div', { class: 'tools' },
      navButton(text('undo'), () => void historyStep(true), 'undo', { disabled: !undo.length, id: 'undo' }),
      navButton(text('redo'), () => void historyStep(false), 'redo', { disabled: !redo.length, id: 'redo' }),
      navButton(text(edit ? 'exitEdit' : 'edit'), () => { edit = !edit; render(); focusAction('edit-mode'); nativeView(); }, 'edit',
        { pressed: edit, id: 'edit-mode' }),
      navButton(text('settings'), () => showSettings(), 'settings', { id: 'settings' }),
      el('span', { class: 'tool-divider' }),
      navButton(text('close'), () => void invoke('hide'), 'close')));
  const pager = el('div', { class: 'pager' },
    navButton(text('previousTablet'), () => changePage(-1), 'previous', { id: 'previous-tablet', disabled: count === 1 }),
    el('span', { class: 'pager-count', 'aria-label': text('page', { current: index + 1, total: count }), 'aria-live': 'polite' }, `${index + 1} / ${count}`),
    navButton(text('nextTablet'), () => changePage(1), 'next', { id: 'next-tablet', disabled: count === 1 }));
  const label = tablet.name === 'Default' ? text('defaultTablet') : tablet.name;
  return el('main', { class: 'panel launcher' }, toolbar,
    el('div', { class: 'tablet-bar' }, el('div', { class: 'tablet-name' }, icon('layers'), el('h2', { title: label }, label)), pager),
    el('div', { class: 'grid-scroll' }, grid()),
    el('footer', { class: 'launcher-footer' },
      button(overflowLabel, () => overflowMenu(context()), { look: overflow ? 'overflow has-items' : 'overflow', glyph: 'overflow', id: 'overflow' }),
      noContent ? el('span', { class: 'hint', title: text('emptyHint') }, text('firstGlyph')) : el('span', { class: 'hint' }),
      el('div', { class: 'escape' }, el('kbd', {}, 'Esc'), el('span', {}, text(edit ? 'done' : 'closeEsc')))),
    info.paused ? banner(text('paused')) : null);
}

function showSettings(openTab = 'customize') {
  closeModal(false);
  mode = 'settings';
  tab = openTab;
  draft = structuredClone(state());
  render();
  nativeView();
}

function showLauncher() {
  closeModal(false);
  mode = 'launcher';
  draft = undefined;
  render();
  nativeView();
  focusAction();
}

async function finishSetup() {
  const next = structuredClone(state());
  next.settings.onboarded = true;
  next.settings.anchor = setupAnchor;
  if (setupApp) next.tablets[0].slots[0] = setupApp;
  if (await commit(next)) showLauncher();
}

function keycaps(assignment) {
  const display = {
    Command: '⌘', Control: info.platform === 'darwin' ? '⌃' : 'Ctrl',
    Alt: info.platform === 'darwin' ? '⌥' : 'Alt', Shift: 'Shift', Super: 'Win',
    Left: '←', Right: '→', Up: '↑', Down: '↓'
  };
  return assignment.split('+').map(key => el('kbd', {}, display[key] || key));
}

function welcome() {
  const titles = ['welcome1', 'welcome2', 'welcome3'];
  const tablet = el('main', { class: 'panel welcome' },
    el('header', { class: 'launcher-toolbar' }, brand(text('welcome'), text('step', { step })),
      navButton(text('close'), () => void finishSetup(), 'close')),
    el('div', { class: 'setup-body' },
      el('div', { class: 'step-indicator', 'aria-hidden': 'true' }, [1, 2, 3].map(number =>
        el('span', { class: number <= step ? 'on' : '' }))),
      el('h2', {}, text(titles[step - 1])),
      step === 1 ? [
        el('p', {}, text('welcome1Body')),
        el('div', { class: 'shortcut-block' }, icon('layers'), ...keycaps(info.shortcuts.toggle)),
        info.conflicts.some(conflict => conflict.key === 'toggle') ? banner(text('keyConflict', { key: info.shortcuts.toggle })) : null
      ] : null,
      step === 2 ? el('div', { class: 'anchor-grid' }, ANCHORS.map(anchor =>
        button(text(anchor), () => { setupAnchor = anchor; render(); focusAction(`anchor-${anchor}`); },
          { look: setupAnchor === anchor ? 'selected' : '', id: `anchor-${anchor}`, pressed: setupAnchor === anchor }))) : null,
      step === 3 ? [
        el('p', {}, text('welcome3Body')),
        el('div', { class: 'suggested-apps' }, applications.map(glyph =>
          button(glyph.name, () => { setupApp = glyph; render(); focusAction(glyph.id); },
            { glyph: 'app', pressed: setupApp?.target === glyph.target, id: glyph.id, look: setupApp?.target === glyph.target ? 'selected' : '' }))),
        button(text('chooseApp'), async () => {
          try {
            const glyph = await invoke('pick', 'app');
            if (glyph) {
              setupApp = glyph;
              if (!applications.some(app => app.target === glyph.target)) applications.push(glyph);
              render();
              focusAction(glyph.id);
            }
          } catch (error) { errorToast(error); }
        })
      ] : null),
    el('footer', { class: 'setup-footer' },
      step > 1 ? button(text('back'), () => { step--; render(); focusAction('setup-next'); }, { look: 'ghost' }) :
        button(text('skip'), () => void finishSetup(), { look: 'ghost' }),
      button(text(step === 3 ? 'openAltar' : 'next'), () => {
        if (step === 3) void finishSetup();
        else { step++; render(); focusAction('setup-next'); }
      }, { look: 'primary', glyph: 'arrow', id: 'setup-next' })));
  return tablet;
}

function render() {
  if (!info) return;
  document.documentElement.lang = languageOf(state().settings.language, info.locale);
  visual(mode === 'settings' && draft ? draft.settings : state().settings);
  const previous = document.activeElement?.id;
  const scroll = mode === 'settings' ? shell.querySelector('.settings-body')?.scrollTop : null;
  shell.replaceChildren(mode === 'launcher' ? launcher() : mode === 'welcome' ? welcome() : settingsPage({
    ...context(), tab, updateVisual: visual
  }));
  if (mode === 'settings' && scroll != null) shell.querySelector('.settings-body').scrollTop = scroll;
  if (!modal && previous) document.getElementById(previous)?.focus({ preventScroll: true });
}

function receiveAction(action) {
  if (action === 'hidden') {
    closeModal(false);
    mode = 'launcher';
    edit = false;
    render();
    return;
  }
  if (action === 'previous' || action === 'next') {
    changePage(action === 'previous' ? -1 : 1);
    return;
  }
  if (action === 'welcome') {
    mode = 'welcome';
    setupAnchor = state().settings.anchor;
    render();
    nativeView();
    void invoke('candidates').then(items => { applications = items; if (mode === 'welcome' && step === 3) render(); }).catch(errorToast);
    focusAction('setup-next');
    return;
  }
  if (action === 'settings' || action === 'recovery') {
    showSettings(action === 'recovery' ? 'data' : 'customize');
    return;
  }
  focusAction();
}

function registerInput() {
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (modal) closeModal();
      else if (mode === 'settings') showLauncher();
      else if (mode === 'welcome') void finishSetup();
      else if (edit) { edit = false; render(); nativeView(); }
      else void invoke('hide');
      return;
    }
    if (modal || mode !== 'launcher') return;
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') {
      event.preventDefault();
      void historyStep(!event.shiftKey);
    } else if ((event.metaKey || event.ctrlKey) && event.code === 'KeyY') {
      event.preventDefault();
      void historyStep(false);
    } else if (['PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      changePage(event.key === 'PageUp' ? -1 : 1);
    }
  });
  document.addEventListener('wheel', event => {
    if (!info || mode !== 'launcher' || modal || !state().settings.wheel || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) < 3) return;
    if (performance.now() - lastWheel < 230) return;
    lastWheel = performance.now();
    changePage(event.deltaY < 0 ? -1 : 1);
  }, { passive: true });
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());
  media.addEventListener('change', () => visual(draft?.settings ?? state().settings));
}

const actionsBeforeReady = [];
bridge.onAction(action => info ? receiveAction(action) : actionsBeforeReady.push(action));
bridge.onState(next => {
  if (!info || saving) return;
  applyInfo(next);
  if (!modal && mode === 'launcher') render();
});
bridge.onStatus(result => toast(result.status, result));
try {
  applyInfo(await invoke('initial'));
  registerInput();
  render();
  for (const action of actionsBeforeReady) receiveAction(action);
} catch (error) {
  shell.replaceChildren(el('main', { class: 'panel' }, el('h1', {}, 'Glyph-on'), banner(text('operationFailed'))));
}
