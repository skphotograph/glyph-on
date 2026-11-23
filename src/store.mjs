import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { cleanState, makeState } from './model.mjs';

const LIMIT = 24 * 1024 * 1024;
const GENERATIONS = 3;

export async function readJSON(file) {
  if ((await stat(file)).size > LIMIT) throw new Error('fileTooLarge');
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function writeJSON(file, value) {
  const data = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(data) > LIMIT) throw new Error('fileTooLarge');
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r').catch(() => null);
      if (directory) {
        try { await directory.sync(); } catch { /* Some filesystems cannot sync a directory. */ }
        finally { await directory.close().catch(() => {}); }
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export function settingsStore(root) {
  const file = path.join(root, 'settings.json');
  const backups = path.join(root, 'backups');
  let previous = null;
  let previousBackedUp = false;
  let recovery = null;
  let quarantined = null;

  async function versions() {
    const entries = await readdir(backups, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && /^\d{12,}-[a-f0-9-]+\.json$/.test(entry.name))
      .map(entry => entry.name).sort().reverse();
  }

  async function load() {
    await mkdir(backups, { recursive: true, mode: 0o700 });
    try {
      previous = cleanState(await readJSON(file));
      return { state: previous, recovery: null };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      if (error.code !== 'ENOENT') {
        quarantined = path.join(root, `settings.corrupt-${Date.now()}-${randomUUID()}.json`);
        await rename(file, quarantined);
      }
      for (const backup of await versions()) {
        try {
          recovery = { state: cleanState(await readJSON(path.join(backups, backup))), at: Number(backup.split('-')[0]) };
          break;
        } catch { /* Continue to an older intact generation. */ }
      }
      return { state: makeState(), recovery: recovery && { at: recovery.at }, quarantined };
    }
  }

  async function snapshot(state) {
    const latest = (await versions())[0];
    if (latest) {
      const saved = await readJSON(path.join(backups, latest)).catch(() => null);
      if (saved && JSON.stringify(saved) === JSON.stringify(state)) return;
    }
    const sequence = Math.max(Date.now(), latest ? Number(latest.split('-')[0]) + 1 : 0);
    await writeJSON(path.join(backups, `${sequence}-${randomUUID()}.json`), state);
  }

  async function save(state, { checkpoint = false, resolveRecovery = false } = {}) {
    if (recovery && !resolveRecovery) throw new Error('recoveryPending');
    const clean = cleanState(state);
    if (previous && !previousBackedUp) await snapshot(previous);
    if (checkpoint && !previous) await snapshot(clean);
    await writeJSON(file, clean);
    previous = clean;
    // A failed backup can be retried before the next write. The main file is already durable.
    previousBackedUp = await snapshot(clean).then(() => true, () => false);
    recovery = null;
    const prune = await versions().catch(() => []);
    await Promise.all(prune.slice(GENERATIONS).map(name => unlink(path.join(backups, name)).catch(() => {})));
    return clean;
  }

  async function restore() {
    if (!recovery) throw new Error('noRecovery');
    return save(recovery.state, { resolveRecovery: true });
  }

  return { file, load, save, restore };
}
