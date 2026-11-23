import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { screen } from 'electron';

const exec = promisify(execFile);
const platform = process.platform;
const ps = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Foreground {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
[void][Foreground]::SetThreadDpiAwarenessContext([IntPtr](-4))
while ($null -ne ($request = [Console]::ReadLine())) {
    $rect = New-Object Foreground+Rect
    if ([Foreground]::GetWindowRect([Foreground]::GetForegroundWindow(), [ref]$rect)) {
        [Console]::WriteLine("$request $($rect.Left) $($rect.Top) $($rect.Right) $($rect.Bottom)")
    } else { [Console]::WriteLine($request) }
}
`;
const macQuery = `
ObjC.import('AppKit')
ObjC.import('CoreGraphics')
const pid = Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)
const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(17, 0))
const window = windows.find(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 &&
  w.kCGWindowBounds.Width > 20 && w.kCGWindowBounds.Height > 20)
JSON.stringify(window ? window.kCGWindowBounds : null)
`;

let helper;
let sequence = 0;
const waiting = new Map();

export function prepareActiveMonitor() {
  if (platform !== 'win32' || helper) return;
  const bin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(bin, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  helper = child;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const [id, ...coords] = line.trim().split(' ').map(Number);
    waiting.get(id)?.(coords.length === 4 && coords.every(Number.isFinite) ? coords : null);
  });
  const stop = () => {
    if (helper !== child) return;
    helper = null;
    lines.close();
    for (const done of waiting.values()) done(null);
  };
  child.once('exit', stop);
  child.once('error', stop);
  child.stdin.on('error', stop);
}

export function stopActiveMonitor() {
  helper?.stdin.end();
  helper?.kill();
}

async function activeDisplay() {
  try {
    if (platform === 'darwin') {
      const { stdout } = await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macQuery], { timeout: 350 });
      const bounds = JSON.parse(stdout);
      if (bounds) return screen.getDisplayMatching({ x: bounds.X, y: bounds.Y, width: bounds.Width, height: bounds.Height });
    }
    if (platform === 'win32') {
      prepareActiveMonitor();
      const rect = await new Promise(resolve => {
        const id = ++sequence;
        const timer = setTimeout(() => waiting.get(id)?.(null), 110);
        waiting.set(id, coords => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(coords);
        });
        helper?.stdin.write(`${id}\n`);
      });
      if (rect) {
        const [left, top, right, bottom] = rect;
        const point = screen.screenToDipPoint({ x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) });
        return screen.getDisplayNearestPoint(point);
      }
    }
  } catch { /* Cursor is the fallback when the OS cannot provide a foreground window. */ }
  return null;
}

export async function chooseDisplay(settings) {
  if (settings.monitor === 'fixed') {
    const display = screen.getAllDisplays().find(item => String(item.id) === settings.monitorId);
    if (display) return display;
  }
  if (settings.monitor === 'active' && screen.getAllDisplays().length > 1) {
    const display = await activeDisplay();
    if (display) return display;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function anchoredBounds(area, dimensions, settings) {
  const { width, height } = dimensions;
  const [vertical, horizontal] = settings.anchor.split('-');
  const insetX = Math.min(settings.marginRight, Math.floor((area.width - width) / 2));
  const insetY = Math.min(settings.marginTop, Math.floor((area.height - height) / 2));
  return {
    width, height,
    x: area.x + (horizontal === 'left' ? insetX : horizontal === 'right' ? area.width - width - insetX : Math.floor((area.width - width) / 2)),
    y: area.y + (vertical === 'top' ? insetY : vertical === 'bottom' ? area.height - height - insetY : Math.floor((area.height - height) / 2))
  };
}
