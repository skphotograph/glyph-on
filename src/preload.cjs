const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel, listener) => { ipcRenderer.on(channel, (_event, value) => listener(value)); };

contextBridge.exposeInMainWorld('glyphOn', {
  initial: () => call('initial'),
  save: (state, revision) => call('save', state, revision),
  view: (view, protect) => call('view', view, protect),
  hide: () => call('hide'),
  pick: (type) => call('pick', type),
  describe: (target) => call('describe', target),
  filePaths: (files) => files.map(file => webUtils.getPathForFile(file)).filter(Boolean),
  statuses: (glyphs) => call('statuses', glyphs),
  icon: (glyph) => call('icon', glyph),
  run: (id, confirmed) => call('run', id, confirmed),
  candidates: () => call('candidates'),
  inspectImport: (legacy) => call('inspectImport', legacy),
  applyImport: (token, mode, revision) => call('applyImport', token, mode, revision),
  exportSettings: (withImages) => call('exportSettings', withImages),
  resolveRecovery: (restore) => call('resolveRecovery', restore),
  openDataFolder: () => call('openDataFolder'),
  copyPath: () => call('copyPath'),
  openHelp: (kind) => call('openHelp', kind),
  update: (action) => call('update', action),
  prepareUninstall: (deleteSettings) => call('prepareUninstall', deleteSettings),
  floatingOpen: () => call('floatingOpen'),
  floatingDrag: (action) => call('floatingDrag', action),
  onState: (listener) => listen('state', listener),
  onAction: (listener) => listen('action', listener),
  onStatus: (listener) => listen('status', listener)
});
