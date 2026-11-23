import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, globalShortcut,
  ipcMain, nativeImage, powerMonitor, protocol, screen, shell
} from 'electron';
import {
  SHORTCUTS, allGlyphs, cleanGlyph, cleanState, defaultShortcuts, mergeImport, persistable, readImport, verifyShortcuts
} from './model.mjs';
import { readJSON, settingsStore, writeJSON } from './store.mjs';
import { applicationCandidates, automaticIcon, describeDrop, imageIcon, runAction, targetStatus } from './actions.mjs';
import { anchoredBounds, chooseDisplay, prepareActiveMonitor, stopActiveMonitor } from './monitor.mjs';
import { languageOf, translate } from './ui/i18n.mjs';

const MAC = process.platform === 'darwin';
const WINDOW_ENTRY = 'glyph://local/index.html';
const FLOATING_ENTRY = 'glyph://local/floating.html';
const ROOT = import.meta.dirname;
const require = createRequire(import.meta.url);
const idleLogin = process.argv.includes('--login-hidden');
const repository = 'https://github.com/skphotograph/glyph-on';
const actions = new Set(['initial', 'save', 'view', 'hide', 'pick', 'describe', 'statuses', 'icon', 'run', 'candidates',
  'inspectImport', 'applyImport', 'exportSettings', 'resolveRecovery', 'openDataFolder', 'copyPath', 'openHelp', 'update',
  'prepareUninstall']);

protocol.registerSchemesAsPrivileged([{ scheme: 'glyph', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Glyph-on');
app.commandLine.appendSwitch('disable-background-networking');
if (process.platform === 'win32') {
  // Altar uses simple 2D surfaces. Software rendering reduces the idle GPU process footprint.
  app.disableHardwareAcceleration();
  app.setAppUserModelId('com.skphotograph.glyphon');
}
// An unpackaged smoke run uses isolated user data and never touches installed settings.
if (!app.isPackaged && process.env.GLYPH_ON_DEV_DATA) {
  app.setPath('userData', path.resolve(process.env.GLYPH_ON_DEV_DATA));
}

let altar;
let floating;
let tray;
let store;
let state;
let currentView = 'launcher';
let revision = 0;
let recovery;
let quarantined;
let settingsTask = Promise.resolve();
let paused = false;
let quitting = false;
let protectedView = false;
let nativeDialogs = 0;
let conflicts = [];
let activeDisplay;
let pendingImport;
let lastStatus;
let visibilityRequest = 0;
let floatingDrag;

const tr = (key, values) => translate(languageOf(state?.settings.language, app.getLocale()), key, values);
const alertIcon = () => nativeImage.createFromPath(path.join(ROOT, 'assets', 'glyph-on.png'));

function mainInfo() {
  return {
    state, revision, recovery, quarantined, conflicts, paused, lastStatus,
    shortcuts: defaultShortcuts(process.platform), platform: process.platform,
    locale: app.getLocale(), version: app.getVersion(), dataPath: store.file,
    packaged: app.isPackaged,
    displays: screen.getAllDisplays().map(display => ({
      id: String(display.id), label: display.label, width: display.bounds.width, height: display.bounds.height
    }))
  };
}

function send(channel, payload) {
  if (altar && !altar.isDestroyed() && !altar.webContents.isLoadingMainFrame()) altar.webContents.send(channel, payload);
}

const syncState = () => send('state', mainInfo());

function boundsFor(display) {
  const size = { small: [70, 69], medium: [86, 80], large: [104, 94] }[state.layout.size];
  const gap = state.settings.gap;
  const gridWidth = state.layout.columns * size[0] + (state.layout.columns - 1) * gap + 40;
  const gridHeight = state.layout.rows * size[1] + (state.layout.rows - 1) * gap + 155;
  const dimensions = {
    width: currentView === 'launcher' ? Math.max(348, gridWidth) : 616,
    height: currentView === 'launcher' ? Math.max(290, gridHeight) : 675
  };
  const area = display.workArea;
  dimensions.width = Math.min(dimensions.width, area.width);
  dimensions.height = Math.min(dimensions.height, area.height);
  return anchoredBounds(area, dimensions, state.settings);
}

function placeAltar() {
  const displays = screen.getAllDisplays();
  const display = displays.find(item => item.id === activeDisplay) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  altar.setBounds(boundsFor(display));
}

function overlayOptions() {
  return {
    frame: false, show: false, resizable: false, fullscreenable: false, maximizable: false,
    skipTaskbar: true, autoHideMenuBar: true, acceptFirstMouse: true, transparent: true,
    ...(MAC ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      partition: 'glyph-ui', spellcheck: false }
  };
}

function configureOverlay(window) {
  window.setAlwaysOnTop(true, MAC ? 'pop-up-menu' : 'floating');
  if (MAC) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
}

function makeAltar() {
  const window = new BrowserWindow({ ...overlayOptions(), width: 392, height: 395, title: 'Glyph-on' });
  configureOverlay(window);
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    hideAltar();
  });
  window.on('blur', () => {
    setTimeout(() => {
      if (window.isVisible() && !window.isFocused() && !nativeDialogs && !protectedView &&
        currentView === 'launcher' && state.settings.dismissOutside) hideAltar();
    }, 100);
  });
  window.loadURL(WINDOW_ENTRY);
  return window;
}

function placeFloating() {
  if (!floating) return;
  const saved = state.settings.floatingPosition;
  const display = screen.getDisplayNearestPoint(saved ?? screen.getCursorScreenPoint());
  const area = display.workArea;
  const position = saved ?? { x: area.x + area.width - 66, y: area.y + 24 };
  floating.setPosition(Math.max(area.x, Math.min(position.x, area.x + area.width - 48)),
    Math.max(area.y, Math.min(position.y, area.y + area.height - 48)));
}

function syncFloating() {
  if (!state.settings.floating || altar.isVisible() || paused) {
    floating?.hide();
    return;
  }
  if (floating) {
    placeFloating();
    floating.showInactive();
    return;
  }
  floating = new BrowserWindow({ ...overlayOptions(), width: 48, height: 48, hasShadow: false, title: 'Glyph-on' });
  configureOverlay(floating);
  floating.on('ready-to-show', () => {
    if (state.settings.floating && !altar.isVisible() && !paused) {
      placeFloating();
      floating.showInactive();
    }
  });
  floating.loadURL(FLOATING_ENTRY);
}

async function showAltar(action = 'show') {
  if (!altar) return;
  const request = ++visibilityRequest;
  const display = altar.isVisible() ? null : await chooseDisplay(state.settings);
  if (request !== visibilityRequest) return;
  if (display) activeDisplay = display.id;
  if (action === 'settings' || action === 'recovery') {
    currentView = 'settings';
    protectedView = true;
  } else if (action === 'welcome') {
    currentView = 'welcome';
    protectedView = true;
  }
  if (altar.webContents.isLoadingMainFrame()) await new Promise(resolve => altar.webContents.once('did-stop-loading', resolve));
  if (request !== visibilityRequest) return;
  placeAltar();
  floating?.hide();
  if (MAC) altar.showInactive();
  else altar.show();
  altar.focus();
  send('action', action);
}

function hideAltar() {
  visibilityRequest++;
  altar.hide();
  currentView = 'launcher';
  protectedView = false;
  send('action', 'hidden');
  syncFloating();
}

function toggleAltar() {
  if (altar.isVisible()) {
    if (!protectedView && !nativeDialogs) hideAltar();
  } else {
    void showAltar();
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  conflicts = [];
  if (paused) return;
  const defaults = defaultShortcuts(process.platform);
  const configured = state.settings.shortcuts;
  const handlers = {
    toggle: toggleAltar,
    previous: () => { if (altar.isVisible() && currentView === 'launcher') send('action', 'previous'); },
    next: () => { if (altar.isVisible() && currentView === 'launcher') send('action', 'next'); }
  };
  const candidates = process.platform === 'darwin'
    ? ['Command+Shift+Space', 'Control+Shift+Space', 'Command+Shift+F9', 'Command+Shift+F10', 'Command+Shift+F11']
    : ['Control+Shift+Space', 'Control+Alt+F8', 'Control+Alt+F9', 'Control+Alt+F10', 'Control+Alt+F11'];
  const keys = SHORTCUTS.map(key => configured[key] || defaults[key]);
  SHORTCUTS.forEach((key, index) => {
    const accelerator = keys[index];
    let registered = false;
    if (keys.indexOf(accelerator) === index) {
      try { registered = globalShortcut.register(accelerator, handlers[key]); } catch { /* Invalid or reserved. */ }
    }
    if (!registered) conflicts.push({ key, accelerator, candidates: candidates.filter(candidate => !keys.includes(candidate)).slice(0, 3) });
  });
}

function rebuildTray() {
  const menu = Menu.buildFromTemplate([
    { label: tr('show'), click: () => void showAltar() },
    { label: tr('settings'), click: () => void showAltar('settings') },
    { type: 'separator' },
    { label: tr(paused ? 'resume' : 'pause'), click: () => {
      paused = !paused;
      if (paused && !protectedView && altar.isVisible()) hideAltar();
      registerShortcuts();
      syncFloating();
      rebuildTray();
      syncState();
    } },
    { label: tr('quit'), click: () => app.quit() }
  ]);
  tray.setToolTip('Glyph-on');
  tray.setContextMenu(menu);
}

function updateState(next, resolveRecovery = false) {
  const old = state;
  state = next;
  revision++;
  if (resolveRecovery) recovery = null;
  if (JSON.stringify(old.settings.shortcuts) !== JSON.stringify(state.settings.shortcuts)) registerShortcuts();
  if (old.settings.startup !== state.settings.startup) syncStartup();
  if (old.settings.language !== state.settings.language) rebuildTray();
  if (state.settings.monitor === 'active') prepareActiveMonitor();
  else stopActiveMonitor();
  if (altar.isVisible()) {
    if (state.settings.monitor === 'fixed') {
      activeDisplay = screen.getAllDisplays().find(display => String(display.id) === state.settings.monitorId)?.id ?? activeDisplay;
    }
    placeAltar();
  }
  syncFloating();
  syncState();
  return mainInfo();
}

function syncStartup() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: state.settings.startup, args: ['--login-hidden'],
      ...(process.platform === 'win32' ? { name: 'Glyph-on' } : {})
    });
  } catch { report({ status: 'startupFailed' }); }
}

function queue(task) {
  const result = settingsTask.then(task);
  settingsTask = result.catch(() => {});
  return result;
}

function checkRevision(wanted) {
  if (wanted !== revision) throw new Error('staleSettings');
}

async function nativeDialog(task) {
  nativeDialogs++;
  try { return await task(); }
  finally { nativeDialogs--; }
}

function report(result) {
  const repeats = lastStatus?.status === result.status && lastStatus?.code === result.code &&
    Date.now() - lastStatus.at < 1400;
  lastStatus = { ...result, at: Date.now() };
  if (repeats) return;
  send('status', lastStatus);
  if (!altar?.isVisible() && ['startFailed', 'exitFailed', 'resultUnknown'].includes(result.status) && Notification.isSupported()) {
    new Notification({ title: 'Glyph-on', body: tr(result.status, result), icon: alertIcon() }).show();
  }
}

async function pick(type) {
  if (!['app', 'file', 'folder', 'image', 'process'].includes(type)) throw new Error('invalidData');
  const options = { title: tr(type === 'image' ? 'chooseImage' : 'chooseTarget'), properties: ['openFile'] };
  if (type === 'folder') options.properties = ['openDirectory'];
  if (type === 'app' && MAC) {
    options.defaultPath = '/Applications';
    options.filters = [{ name: tr('app'), extensions: ['app'] }];
  }
  if (type === 'app' && process.platform === 'win32') {
    options.defaultPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    options.filters = [{ name: tr('app'), extensions: ['exe', 'com', 'lnk', 'appref-ms'] }];
  }
  if (type === 'image') options.filters = [{ name: tr('image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico'] }];
  const result = await nativeDialog(() => dialog.showOpenDialog(altar, options));
  if (result.canceled || !result.filePaths.length) return null;
  if (type === 'image') return imageIcon(result.filePaths[0]);
  return describeDrop(result.filePaths[0]);
}

async function analyzeImport(legacy) {
  const defaultPath = legacy ? path.join(app.getPath('appData'), 'Glyph-on', 'glyphon.config.json') : undefined;
  const result = await nativeDialog(() => dialog.showOpenDialog(altar, {
    title: tr(legacy ? 'migrate' : 'importSettings'), defaultPath, properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }));
  if (result.canceled || !result.filePaths.length) return null;
  let raw;
  try { raw = await readJSON(result.filePaths[0]); }
  catch (error) { throw new Error(error.message === 'fileTooLarge' ? 'fileTooLarge' : 'invalidData'); }
  const imported = readImport(raw);
  const token = randomUUID();
  const already = new Set(allGlyphs(state).map(glyph => JSON.stringify([glyph.name, glyph.type, glyph.target])));
  const names = new Set(state.tablets.map(tablet => tablet.name));
  const items = allGlyphs(imported.state);
  const rows = [];
  for (let index = 0; index < items.length; index += 32) {
    const batch = await Promise.all(items.slice(index, index + 32).map(async glyph => ({
      name: glyph.name, type: glyph.type, disabled: glyph.disabled, issue: await targetStatus(glyph),
      duplicate: already.has(JSON.stringify([glyph.name, glyph.type, glyph.target]))
    })));
    rows.push(...batch);
  }
  pendingImport = { token, state: imported.state };
  return { token, legacy: raw.schemaVersion === 1, issues: imported.issues, rows,
    tablets: imported.state.tablets.map(tablet => ({ name: tablet.name, duplicate: names.has(tablet.name) })) };
}

let updater;
async function updateService() {
  if (!app.isPackaged) throw new Error('updatesUnavailable');
  if (updater) return updater;
  const file = path.join(process.resourcesPath, 'app-update.yml');
  const config = await readFile(file, 'utf8').catch(() => '');
  const { load } = require('js-yaml');
  const feed = load(config);
  if (feed?.provider !== 'github' || feed.owner !== 'skphotograph' || feed.repo !== 'glyph-on' ||
    (!MAC && !(Array.isArray(feed.publisherName) ? feed.publisherName.some(Boolean) : feed.publisherName))) {
    throw new Error('updatesUnavailable');
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = null;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', () => {});
  updater = autoUpdater;
  return updater;
}

let downloaded = false;
async function updates(action) {
  const service = await updateService();
  if (action === 'check') {
    const info = await service.checkForUpdates();
    if (!info?.isUpdateAvailable) return null;
    const { version, releaseNotes } = info.updateInfo;
    return { version, notes: (Array.isArray(releaseNotes)
      ? releaseNotes.map(note => `${note.version}\n${note.note ?? ''}`).join('\n\n') : releaseNotes ?? '').slice(0, 12_000) };
  }
  if (action === 'install') {
    if (!downloaded) {
      await queue(() => store.save(state, { checkpoint: true }));
      await service.downloadUpdate();
      downloaded = true;
    }
    service.quitAndInstall(false, true);
    return true;
  }
  throw new Error('invalidData');
}

async function prepareUninstall(deleteSettings) {
  if (!MAC || !app.isPackaged || typeof deleteSettings !== 'boolean') throw new Error('operationFailed');
  return queue(async () => {
    app.setLoginItemSettings({ openAtLogin: false, args: ['--login-hidden'] });
    if (deleteSettings) {
      const dir = path.dirname(store.file);
      const files = await readdir(dir);
      const settings = files.filter(file => file === 'backups' || file === 'settings.json' ||
        /^settings\.corrupt-\d+-[a-f0-9-]+\.json$/.test(file));
      for (const file of settings) await shell.trashItem(path.join(dir, file));
    }
    shell.showItemInFolder(path.resolve(process.execPath, '../../..'));
    app.quit();
  });
}

function registerIPC() {
  const handlers = {
    initial: mainInfo,
    save: (next, rev) => queue(async () => {
      checkRevision(rev);
      const cleaned = cleanState(next);
      if (JSON.stringify(cleaned.settings.shortcuts) !== JSON.stringify(state.settings.shortcuts)) {
        verifyShortcuts(cleaned.settings.shortcuts, process.platform);
      }
      return updateState(await store.save(cleaned));
    }),
    view: (view, protect) => {
      if (!['launcher', 'settings', 'welcome'].includes(view)) throw new Error('invalidData');
      currentView = view;
      protectedView = view !== 'launcher' || protect === true;
      if (altar.isVisible()) placeAltar();
    },
    hide: hideAltar,
    pick,
    describe: target => {
      if (typeof target !== 'string' || target.length > 16_384) throw new Error('invalidData');
      return describeDrop(target);
    },
    statuses: async glyphs => {
      if (!Array.isArray(glyphs) || glyphs.length > 64) throw new Error('invalidData');
      return Promise.all(glyphs.map(glyph => targetStatus(cleanGlyph(glyph))));
    },
    icon: glyph => automaticIcon(cleanGlyph(glyph)),
    run: async (id, confirmed) => {
      const glyph = state.tablets.flatMap(tablet => tablet.slots).find(item => item?.id === id);
      if (!glyph || paused || glyph.type === 'command' && !state.settings.advanced) return { status: 'disabledAction' };
      if (glyph.confirm && confirmed !== true) return { status: 'confirmRequired' };
      const result = await runAction(glyph, report);
      report(result);
      if (state.settings.closeAfterRun && ['requested', 'started'].includes(result.status)) hideAltar();
      return result;
    },
    candidates: applicationCandidates,
    inspectImport: analyzeImport,
    applyImport: (token, mode, rev) => queue(async () => {
      checkRevision(rev);
      if (!pendingImport || pendingImport.token !== token || !['merge', 'replace'].includes(mode)) throw new Error('invalidData');
      const next = mode === 'merge' ? mergeImport(state, pendingImport.state) : structuredClone(pendingImport.state);
      next.settings.startup = state.settings.startup;
      next.settings.onboarded = true;
      const result = updateState(await store.save(next));
      pendingImport = null;
      return result;
    }),
    exportSettings: async withImages => {
      const result = await nativeDialog(() => dialog.showSaveDialog(altar, {
        title: tr('exportSettings'), defaultPath: 'glyph-on-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }]
      }));
      if (result.canceled || !result.filePath) return false;
      if (path.resolve(result.filePath).toLowerCase() === path.resolve(store.file).toLowerCase()) throw new Error('invalidPath');
      await writeJSON(result.filePath, { format: 'glyph-on', version: 1, settings: persistable(state, withImages === true) });
      return true;
    },
    resolveRecovery: restore => queue(async () => {
      const next = restore === true ? await store.restore() : await store.save(state, { resolveRecovery: true });
      return updateState(next, true);
    }),
    openDataFolder: () => shell.openPath(path.dirname(store.file)),
    copyPath: () => clipboard.writeText(store.file),
    openHelp: kind => {
      const routes = { feedback: '/issues/new', releases: '/releases', security: '/security/advisories/new' };
      if (!Object.hasOwn(routes, kind)) throw new Error('invalidData');
      return shell.openExternal(repository + routes[kind]);
    },
    update: updates,
    prepareUninstall,
    floatingOpen: () => showAltar(),
    floatingDrag: async action => {
      if (action === 'start') {
        floatingDrag = { cursor: screen.getCursorScreenPoint(), original: floating.getBounds() };
        return;
      }
      if (!floatingDrag || !['move', 'end'].includes(action)) return;
      if (action === 'move') {
        const pointer = screen.getCursorScreenPoint();
        const { cursor, original } = floatingDrag;
        floating.setPosition(original.x + pointer.x - cursor.x, original.y + pointer.y - cursor.y);
        return;
      }
      floatingDrag = null;
      return queue(async () => {
        const [x, y] = floating.getPosition();
        const next = structuredClone(state);
        next.settings.floatingPosition = { x, y };
        updateState(await store.save(next));
      });
    }
  };
  for (const [key, handler] of Object.entries(handlers)) {
    ipcMain.handle(key, async (event, ...args) => {
      const isAltar = event.sender === altar?.webContents && event.senderFrame?.url === WINDOW_ENTRY && actions.has(key);
      const isFloating = event.sender === floating?.webContents && event.senderFrame?.url === FLOATING_ENTRY && key.startsWith('floating');
      if (!isAltar && !isFloating) return { error: 'invalidData' };
      try { return { value: await handler(...args) }; }
      catch (error) {
        const known = /^[a-z][a-zA-Z]+$/.test(error.message);
        return { error: known ? error.message : key === 'update' ? 'updateFailed' : 'operationFailed' };
      }
    });
  }
}

const resources = new Map([
  ['/index.html', ['ui/index.html', 'text/html']], ['/floating.html', ['ui/floating.html', 'text/html']],
  ['/style.css', ['ui/style.css', 'text/css']], ['/floating.mjs', ['ui/floating.mjs', 'text/javascript']],
  ['/renderer.mjs', ['ui/renderer.mjs', 'text/javascript']], ['/i18n.mjs', ['ui/i18n.mjs', 'text/javascript']],
  ['/dom.mjs', ['ui/dom.mjs', 'text/javascript']], ['/editor.mjs', ['ui/editor.mjs', 'text/javascript']],
  ['/settings.mjs', ['ui/settings.mjs', 'text/javascript']],
  ['/icons.mjs', ['ui/icons.mjs', 'text/javascript']], ['/model.mjs', ['model.mjs', 'text/javascript']],
  ['/mark.png', ['assets/glyph-on.png', 'image/png']]
]);

async function initialize() {
  if (MAC) app.setActivationPolicy('accessory');
  else Menu.setApplicationMenu(null);
  const { session } = await import('electron');
  session.fromPartition('glyph-ui').protocol.handle('glyph', async request => {
    const url = new URL(request.url);
    const entry = url.hostname === 'local' && !url.search && resources.get(url.pathname);
    if (!entry) return new Response(null, { status: 404 });
    const headers = {
      'Content-Type': entry[1],
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff'
    };
    return new Response(await readFile(path.join(ROOT, entry[0])), { headers });
  });
  store = settingsStore(app.getPath('userData'));
  ({ state, recovery, quarantined } = await store.load());
  registerIPC();
  altar = makeAltar();
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', MAC ? 'trayTemplate.png' : 'tray.png'));
  if (MAC) icon.setTemplateImage(true);
  tray = new Tray(icon);
  if (!MAC) tray.on('click', () => void showAltar());
  rebuildTray();
  registerShortcuts();
  if (state.settings.monitor === 'active') prepareActiveMonitor();
  const displaysChanged = () => {
    if (altar.isVisible()) placeAltar();
    syncFloating();
    syncState();
  };
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, displaysChanged);
  powerMonitor.on('resume', () => {
    registerShortcuts();
    displaysChanged();
  });
  syncFloating();
  if (recovery || quarantined) await showAltar('recovery');
  else if (!state.settings.onboarded && !idleLogin) await showAltar('welcome');
}

app.on('before-quit', () => {
  quitting = true;
  stopActiveMonitor();
  if (app.isReady()) globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => {});
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let ready;
  app.on('second-instance', () => { void ready?.then(() => showAltar()); });
  app.on('activate', () => { void ready?.then(() => showAltar()); });
  ready = app.whenReady().then(initialize).catch(() => {
    const ja = app.getLocale().startsWith('ja');
    dialog.showErrorBox('Glyph-on', ja ? '初期化できませんでした。ユーザーデータの保存先を確認してください。' :
      'Glyph-on could not initialize. Check that its user data folder is accessible.');
    app.quit();
  });
}
