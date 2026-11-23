import { spawn } from 'node:child_process';
import { access, lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, nativeImage, shell } from 'electron';
import { allowedURL, glyphFields } from './model.mjs';

const WINDOWS = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const EXECUTABLE = /\.(?:exe|com|lnk|appref-ms|app)$/i;
const ACTIVE_FILE = /\.(?:app|appinstaller|appref-ms|application|appx|appxbundle|bat|cmd|com|command|cpl|desktop|exe|gadget|hta|inf|ins|isp|jar|js|jse|lnk|msc|msi|msix|msixbundle|msp|pif|pkg|ps1|reg|scf|scr|sh|url|vb|vbe|vbs|website|wsc|wsf|wsh)$/i;
const IMAGE = /\.(?:png|jpe?g|webp|ico)$/i;
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const BASIC_ENV = /^(?:PATH|PATHEXT|HOME|USERPROFILE|USER|USERNAME|LOGNAME|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|LOCALAPPDATA|APPDATA|TMP|TEMP|TMPDIR|LANG|LANGUAGE|LC_\w+|PSMODULEPATH)$/i;

function localPath(target) {
  if (!path.isAbsolute(target)) return false;
  return !WINDOWS || /^[a-z]:[\\/](?!.*:)/i.test(target);
}

export async function targetStatus(glyph) {
  const { type, target } = glyph;
  if (type === 'url') return allowedURL(target) ? '' : 'invalidURL';
  if (type === 'command' && glyph.shell !== 'process') {
    if (!glyph.cwd) return '';
    const info = localPath(glyph.cwd) && await stat(glyph.cwd).catch(() => null);
    return info?.isDirectory() ? '' : 'missing';
  }
  if (!localPath(target)) return 'invalidPath';
  const info = await stat(target).catch(() => null);
  if (!info) return 'missing';
  if (type === 'folder') return info.isDirectory() ? '' : 'wrongType';
  if (type === 'app') {
    return (MAC && info.isDirectory() && /\.app$/i.test(target)) ||
      (WINDOWS && info.isFile() && EXECUTABLE.test(target)) ? '' : 'wrongType';
  }
  if (!info.isFile()) return 'wrongType';
  if (type === 'file' && (ACTIVE_FILE.test(target) || (!WINDOWS && (info.mode & 0o111)))) return 'useAppType';
  if (type === 'command' && glyph.cwd) {
    const directory = localPath(glyph.cwd) && await stat(glyph.cwd).catch(() => null);
    if (!directory?.isDirectory()) return 'missing';
  }
  return '';
}

export async function describeDrop(target) {
  if (allowedURL(target)) return { ...glyphFields('url'), target, name: new URL(target).hostname || new URL(target).pathname };
  if (/^file:/i.test(target)) {
    try { target = fileURLToPath(target); } catch { throw new Error('invalidPath'); }
  }
  if (!localPath(target)) throw new Error('invalidPath');
  const info = await stat(target).catch(() => null);
  if (!info) throw new Error('missing');
  if (WINDOWS && /\.url$/i.test(target) && info.isFile() && info.size <= 65_536) {
    const source = await readFile(target);
    const windowsUnicode = source[0] === 0xff && source[1] === 0xfe;
    const content = source.toString(windowsUnicode ? 'utf16le' : 'utf8');
    const url = /^URL\s*=\s*([^\r\n]+)/im.exec(content)?.[1]?.trim();
    if (url && allowedURL(url)) return { ...glyphFields('url'), target: url, name: path.basename(target, path.extname(target)) };
  }
  const isApp = EXECUTABLE.test(target) && (info.isFile() && WINDOWS || info.isDirectory() && MAC);
  const type = isApp ? 'app' : info.isDirectory() ? 'folder' : 'file';
  const name = path.basename(target, isApp ? path.extname(target) : '') || target;
  return { ...glyphFields(type), name, target };
}

export async function imageIcon(file) {
  if (!localPath(file) || !IMAGE.test(file)) throw new Error('invalidIcon');
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.size > 8 * 1024 * 1024) throw new Error('invalidIcon');
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error('invalidIcon');
  return image.resize({ width: 96, height: 96, quality: 'better' }).toDataURL();
}

const iconCache = new Map();

export async function automaticIcon(glyph) {
  if (glyph.disabled || !['app', 'file', 'folder'].includes(glyph.type) || await targetStatus(glyph)) return '';
  let key = glyph.target;
  if (WINDOWS && /\.lnk$/i.test(key)) {
    try {
      const shortcut = shell.readShortcutLink(key);
      if (!localPath(shortcut.target)) return '';
      key = shortcut.target;
    } catch { return ''; }
  }
  let cached = iconCache.get(key);
  if (!cached) {
    if (iconCache.size >= 256) iconCache.delete(iconCache.keys().next().value);
    cached = app.getFileIcon(key, { size: MAC ? 'normal' : 'large' })
      .then(image => image.isEmpty() ? '' : image.toDataURL()).catch(() => '');
    iconCache.set(key, cached);
  }
  return cached;
}

export async function applicationCandidates() {
  const candidates = WINDOWS
    ? [
        ['Notepad', path.join(systemRoot, 'System32', 'notepad.exe')],
        ['File Explorer', path.join(systemRoot, 'explorer.exe')],
        ['Microsoft Paint', path.join(systemRoot, 'System32', 'mspaint.exe')]
      ]
    : [
        ['Safari', '/Applications/Safari.app'], ['Finder', '/System/Library/CoreServices/Finder.app'],
        ['Calculator', '/System/Applications/Calculator.app'], ['Notes', '/System/Applications/Notes.app']
      ];
  const available = await Promise.all(candidates.map(async ([name, target]) => {
    try {
      await access(target);
      return { ...glyphFields('app'), name, target };
    } catch { return null; }
  }));
  return available.filter(Boolean);
}

function commandEnvironment(envNames) {
  const names = new Set(envNames.map(name => WINDOWS ? name.toUpperCase() : name));
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^ELECTRON_|^NODE_OPTIONS$/i.test(name) &&
    (BASIC_ENV.test(name) || names.has(WINDOWS ? name.toUpperCase() : name))));
}

function startProcess(file, args, options, done) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(file, args, { stdio: 'ignore', windowsHide: true, ...options });
    } catch {
      resolve({ status: 'startFailed' });
      return;
    }
    let started = false;
    child.once('error', () => {
      if (started) done({ status: 'resultUnknown' });
      else resolve({ status: 'startFailed' });
    });
    child.once('spawn', () => {
      started = true;
      child.unref();
      resolve({ status: 'started' });
    });
    child.once('exit', (code, signal) => {
      if (started) done({ status: signal ? 'resultUnknown' : code === 0 ? 'completed' : 'exitFailed', code });
    });
  });
}

export async function runAction(glyph, done) {
  if (glyph.disabled) return { status: 'disabledAction' };
  const issue = await targetStatus(glyph);
  if (issue) return { status: issue };
  try {
    if (glyph.type === 'url') {
      await shell.openExternal(glyph.target);
      return { status: 'requested' };
    }
    if (glyph.type === 'app' && glyph.args.length) {
      if (MAC) {
        return startProcess('/usr/bin/open', ['-a', glyph.target, '--args', ...glyph.args], {},
          result => done(result.status === 'completed' ? { status: 'requested' } : result));
      }
      if (!/\.(?:exe|com)$/i.test(glyph.target)) return { status: 'shortcutArguments' };
      const launched = await startProcess(glyph.target, glyph.args, { windowsHide: false }, () => {});
      return launched.status === 'started' ? { status: 'requested' } : launched;
    }
    if (glyph.type !== 'command') {
      return { status: (await shell.openPath(glyph.target)) ? 'startFailed' : 'requested' };
    }
    // A detached Windows PowerShell process can exit without evaluating the encoded command.
    const options = { cwd: glyph.cwd || undefined, env: commandEnvironment(glyph.envNames), detached: !WINDOWS };
    if (glyph.shell === 'process') return startProcess(glyph.target, glyph.args, options, done);
    if (glyph.shell === 'powershell') {
      const binary = WINDOWS ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';
      const command = Buffer.from(glyph.target, 'utf16le').toString('base64');
      return startProcess(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], options, done);
    }
    const spec = WINDOWS
      ? [path.join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/s', '/c', `"${glyph.target}"`], { windowsVerbatimArguments: true }]
      : ['/bin/sh', ['-c', glyph.target], {}];
    return startProcess(spec[0], spec[1], { ...options, ...spec[2] }, done);
  } catch {
    return { status: 'startFailed' };
  }
}
