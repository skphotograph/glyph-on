import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  allGlyphs, allowedURL, cleanGlyph, cleanShortcut, glyphFields, makeState, makeTablet, mergeImport, persistable,
  readImport, removeTablet, resizeGrid, verifyShortcuts
} from '../src/model.mjs';
import { settingsStore } from '../src/store.mjs';

const link = name => ({ ...glyphFields('url'), name, target: 'https://example.org/' });

test('shrinking preserves grid coordinates and parks only out-of-bounds Glyphs', () => {
  const state = makeState();
  resizeGrid(state, { rows: 3, columns: 5, size: 'medium' });
  const panel = state.tablets[0];
  panel.slots = panel.slots.map((_, index) => index === 1 ? null : link(`Glyph ${index}`));
  resizeGrid(state, { rows: 2, columns: 3, size: 'medium' });
  assert.deepEqual(panel.slots.map(glyph => glyph?.name), ['Glyph 0', undefined, 'Glyph 2', 'Glyph 5', 'Glyph 6', 'Glyph 7']);
  assert.deepEqual(state.overflow.map(item => item.slot), [3, 4, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(allGlyphs(state).length, 14);
});

test('deleting a Tablet can move Glyphs and park those beyond the available slots', () => {
  const state = makeState();
  resizeGrid(state, { rows: 1, columns: 2, size: 'small' });
  const [source] = state.tablets;
  const target = makeTablet('Work', state.layout);
  source.slots = [link('A'), link('B')];
  target.slots[1] = link('C');
  state.tablets.push(target);
  removeTablet(state, source.id, 'move', target.id);
  assert.deepEqual(target.slots.map(glyph => glyph.name), ['A', 'C']);
  assert.equal(state.overflow[0].glyph.name, 'B');
  assert.throws(() => removeTablet(state, target.id, 'delete'), /lastTablet/);
});

test('legacy commands retain original triangle coordinates without copying environment values', () => {
  const raw = {
    schemaVersion: 1, layout: { edgeN: 3, glyphSizePreset: 'large' },
    ui: { floatingIcon: { enabled: true } },
    tablets: [{ id: 'old', name: 'Work', glyphSlots: [null, null, { id: 'command', label: 'Old action', type: 'powershell',
      line: 'Write-Output ok', env: { API_KEY: 'fixture-environment-value' } }, null, null, null] }]
  };
  const { state, issues } = readImport(raw);
  const [item] = state.overflow;
  assert.equal(item.layout, 'triangle');
  assert.equal(item.edge, 3);
  assert.equal(item.slot, 2);
  assert.equal(item.glyph.shell, 'powershell');
  assert.equal(item.glyph.disabled, true);
  assert.equal(state.settings.closeAfterRun, false);
  assert.equal(state.settings.floating, true);
  assert.ok(issues.includes('legacyEnvironment'));
  assert.deepEqual(item.glyph.envNames, ['API_KEY']);
  assert.ok(!JSON.stringify(persistable(state)).includes('fixture-environment-value'));
});

test('imports disable executable actions and re-key an added Tablet and its Glyphs', () => {
  const state = makeState();
  const app = { ...glyphFields('app'), name: 'App', target: '/Applications/App.app' };
  state.tablets[0].slots[0] = app;
  state.tablets[0].slots[1] = link('Link');
  const incoming = readImport({ format: 'glyph-on', version: 1, settings: state }).state;
  const merged = mergeImport(state, incoming);
  assert.equal(merged.tablets[1].name, 'Default (2)');
  assert.notEqual(merged.tablets[1].id, state.tablets[0].id);
  assert.notEqual(merged.tablets[1].slots[0].id, app.id);
  assert.equal(merged.tablets[1].slots[0].disabled, true);
  assert.equal(merged.tablets[1].slots[1].disabled, false);
});

test('only named environment references, supported URLs and unique modified shortcuts validate', () => {
  assert.throws(() => cleanGlyph({ ...link('A'), envNames: ['API_KEY=value'] }), /envNamesOnly/);
  for (const target of ['file:///tmp/other', 'https://user:password@example.org/', 'https:example.org', 'javascript:abc']) {
    assert.equal(allowedURL(target), false, target);
  }
  assert.ok(allowedURL('mailto:user@example.org'));
  assert.equal(cleanShortcut('Option+Ctrl+ArrowLeft'), 'Control+Alt+Left');
  assert.throws(() => cleanShortcut('Esc'), /invalidShortcut/);
  assert.throws(() => verifyShortcuts({ toggle: 'Alt+PageUp' }, 'win32'), /duplicateShortcut/);
});

test('three saved generations survive corrupt primary settings and recovery preserves the original', async () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const dir = await mkdtemp(path.join(temporaryRoot, 'glyph-on-'));
  try {
    const firstStore = settingsStore(dir);
    const { state } = await firstStore.load();
    for (const name of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) {
      state.tablets[0].name = name;
      await firstStore.save(state);
      if (name === 'First') assert.equal((await readdir(path.join(dir, 'backups'))).length, 1);
    }
    assert.equal((await readdir(path.join(dir, 'backups'))).length, 3);
    await writeFile(firstStore.file, '<corrupt>');
    const reopened = settingsStore(dir);
    const { recovery, quarantined } = await reopened.load();
    assert.ok(recovery);
    assert.equal(await readFile(quarantined, 'utf8'), '<corrupt>');
    await assert.rejects(reopened.save(makeState()), /recoveryPending/);
    const restored = await reopened.restore();
    assert.equal(restored.tablets[0].name, 'Fifth');
    assert.equal(JSON.parse(await readFile(reopened.file, 'utf8')).tablets[0].name, 'Fifth');
  } finally {
    assert.equal(path.dirname(dir), temporaryRoot);
    await rm(dir, { recursive: true, force: true });
  }
});
