const shapes = {
  app: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18m-14-2.5h.01m3 0h.01"/>',
  file: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Zm0 0v6h6M8 14h8m-8 3h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  url: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18m-9-9a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  command: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-.6 2.3-1.8 1L4.3 6 3 8.3l1.6 1.8v3.8L3 15.7 4.3 18l2.3-.3 1.8 1L9 21h6l.6-2.3 1.8-1 2.3.3 1.3-2.3-1.6-1.8v-3.8L21 8.3 19.7 6l-2.3.3-1.8-1L15 3Z"/>',
  edit: '<path d="m14.5 5.5 4 4M4 20l1-5L16 4a2.8 2.8 0 1 1 4 4L9 19Zm9 0h7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  previous: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  overflow: '<path d="M4 9h16l1 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm1-1 2-4h10l2 4m-10 5h6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
  undo: '<path d="M9 6 4 11l5 5m-5-5h11a5 5 0 0 1 5 5v2"/>',
  redo: '<path d="m15 6 5 5-5 5m5-5H9a5 5 0 0 0-5 5v2"/>',
  warning: '<path d="M10.3 4.5 2.8 18a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L13.7 4.5a2 2 0 0 0-3.4 0ZM12 10v4m0 3h.01"/>',
  star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9Z"/>',
  spark: '<path d="M12 3a10 10 0 0 0 9 9 10 10 0 0 0-9 9 10 10 0 0 0-9-9 10 10 0 0 0 9-9Z"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
  music: '<path d="M9 18V6l11-3v12M9 18c0 1.1-1.4 2-3 2s-3-.9-3-2 1.4-2 3-2 3 .9 3 2Zm11-3c0 1.1-1.4 2-3 2s-3-.9-3-2 1.4-2 3-2 3 .9 3 2Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>'
};

export function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.6');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.innerHTML = shapes[name] ?? shapes.spark;
  return node;
}
