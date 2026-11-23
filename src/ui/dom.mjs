import { icon } from './icons.mjs';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function button(label, handler, { glyph, iconOnly = false, look = '', disabled = false, id, pressed } = {}) {
  return el('button', {
    type: 'button', class: ['button', look, iconOnly ? 'icon-button' : ''].filter(Boolean).join(' '),
    onclick: handler, disabled, id: id ?? '', title: iconOnly ? label : '', 'aria-label': iconOnly ? label : null,
    'aria-pressed': pressed == null ? null : String(pressed)
  }, glyph ? icon(glyph) : null, iconOnly ? null : label);
}

export function field(label, input, hint = '') {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input,
    hint ? el('small', {}, hint) : null);
}

export function select(choices, value, onChange) {
  const node = el('select', { onchange: event => onChange?.(event.target.value) });
  for (const [key, label] of choices) node.append(el('option', { value: key }, label));
  node.value = value;
  return node;
}

export function checkbox(label, checked, onChange) {
  return el('label', { class: 'checkbox' },
    el('input', { type: 'checkbox', checked, onchange: event => onChange?.(event.target.checked) }), el('span', {}, label));
}

export function input(value, props = {}) {
  return el('input', { type: 'text', value, ...props });
}

export function banner(message) {
  return el('div', { class: 'banner' }, icon('warning'), el('span', {}, message));
}
