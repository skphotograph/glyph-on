import { ICONS, TYPES, cleanGlyph, glyphFields, uid } from './model.mjs';
import { banner, button, checkbox, el, field, input, select } from './dom.mjs';
import { icon } from './icons.mjs';

const lines = value => value.split(/\r?\n/).filter(line => line.trim());
const iconNames = { star: 'iconStar', spark: 'iconSpark', code: 'iconCode', music: 'iconMusic' };

function identify(next, location) {
  if (location.overflow) {
    const index = next.overflow.findIndex(item => item.glyph.id === location.glyph.id);
    return {
      set: value => {
        if (value) next.overflow[index].glyph = value;
        else next.overflow.splice(index, 1);
      }
    };
  }
  const tablet = next.tablets.find(item => item.id === location.tabletId);
  return { set: value => { tablet.slots[location.index] = value; } };
}

export function glyphEditor(ctx, location) {
  const { text: t, invoke, openModal, closeModal, state, commit, render, errorToast } = ctx;
  const draft = structuredClone(location.glyph ?? glyphFields());
  const editing = !location.fresh;
  const advanced = state().settings.advanced;
  const content = el('div', { class: 'editor-form' });
  const validation = el('div', { role: 'alert' });
  const preview = el('div', { class: 'glyph-preview' });
  let generation = 0;
  const save = button(t(editing ? 'save' : 'add'), submit, { look: 'primary' });

  function previewGlyph() {
    const sample = { ...draft, name: draft.name.trim() || t(draft.type) };
    preview.replaceChildren(ctx.glyphContent(sample), el('div', { class: 'ellipsis' },
      el('small', {}, t('preview')), el('strong', { title: sample.name }, sample.name)));
  }

  function setIssue(issue) {
    validation.replaceChildren(...(issue ? [banner(t(issue))] : []));
  }

  async function submit() {
    try {
      const glyph = cleanGlyph(draft);
      if (glyph.type === 'command' && !advanced) return;
      const [issue] = await invoke('statuses', [glyph]);
      if (issue) { setIssue(issue); return; }
      const next = ctx.copyState();
      const tablet = next.tablets.find(item => item.id === location.tabletId);
      if (location.fresh && (!tablet || tablet.slots[location.index])) throw new Error('staleSettings');
      identify(next, location).set(glyph);
      if (await commit(next)) { closeModal(false); render(); }
    } catch (error) { setIssue(error.message); }
  }

  function redraw(focus) {
    generation++;
    const unavailable = draft.type === 'command' && !advanced;
    const choices = TYPES.filter(type => type !== 'command' || advanced || draft.type === 'command').map(type => [type, t(type)]);
    const needsFile = ['app', 'file', 'folder'].includes(draft.type) || draft.type === 'command' && draft.shell === 'process';
    const name = input(draft.name, { maxLength: 150, id: 'editor-name', autofocus: true, oninput: event => {
      draft.name = event.target.value;
      previewGlyph();
    } });
    const type = select(choices, draft.type, value => {
      if (value === 'command' && draft.type !== 'command') draft.confirm = true;
      draft.type = value;
      setIssue('');
      redraw('editor-type');
    });
    type.id = 'editor-type';
    const target = input(draft.target, {
      maxLength: 16384, spellcheck: false, disabled: unavailable,
      placeholder: draft.type === 'url' ? 'https://' : '', oninput: event => { draft.target = event.target.value; setIssue(''); },
      onchange: previewGlyph
    });
    const iconPicker = select([['auto', t('autoIcon')], ['preset', t('presetIcon')], ['image', t('image')]],
      draft.icon.kind, async kind => {
        if (kind === 'image') {
          const current = generation;
          try {
            const value = await invoke('pick', 'image');
            if (value && generation === current) draft.icon = { kind: 'image', value };
          } catch (error) { errorToast(error); }
        } else draft.icon = kind === 'preset' ? { kind, value: draft.type } : { kind };
        redraw('editor-icon');
      });
    iconPicker.id = 'editor-icon';
    const browse = button(t(location.initialIssue ? 'repair' : 'choose'), async () => {
      const current = generation;
      try {
        const picked = await invoke('pick', draft.type === 'command' ? 'process' : draft.type);
        if (picked && generation === current) {
          draft.target = picked.target;
          if (!draft.name.trim()) draft.name = picked.name;
          setIssue('');
          redraw('editor-name');
        }
      } catch (error) { setIssue(error.message); }
    }, { disabled: unavailable });
    const directory = input(draft.cwd, { oninput: event => { draft.cwd = event.target.value; } });
    const browseDirectory = button(t('choose'), async () => {
      try {
        const picked = await invoke('pick', 'folder');
        if (picked) { draft.cwd = picked.target; directory.value = picked.target; }
      } catch (error) { setIssue(error.message); }
    });
    const shellKind = select([['system', t('shellSystem')], ['powershell', 'PowerShell'], ['process', t('shellProcess')]], draft.shell,
      value => { draft.shell = value; redraw('editor-shell'); });
    shellKind.id = 'editor-shell';
    const targetField = el('div', { class: 'field' }, el('label', { htmlFor: 'editor-target', class: 'field-label' }, t('target')),
      el('div', { class: 'input-row' }, target, needsFile ? browse : null));
    target.id = 'editor-target';
    const iconOption = el('div', { class: 'columns two' }, field(t('icon'), iconPicker),
      draft.icon.kind === 'preset' ? field(t('iconChoice'), select(ICONS.map(key => [key, t(iconNames[key] ?? key)]), draft.icon.value,
        value => { draft.icon.value = value; previewGlyph(); })) : null,
      draft.icon.kind === 'image' ? button(t('chooseImage'), async () => {
        try {
          const value = await invoke('pick', 'image');
          if (value) { draft.icon.value = value; previewGlyph(); }
        } catch (error) { setIssue(error.message); }
      }) : null);

    content.replaceChildren(...[preview, validation,
      el('div', { class: 'columns two' }, field(t('name'), name), field(t('kind'), type)),
      unavailable ? banner(t('commandUnavailable')) : null,
      draft.type === 'command' && !unavailable ? [banner(t('cmdWarning')), field(t('shellType'), shellKind)] : null,
      targetField,
      draft.type === 'app' || draft.type === 'command' && draft.shell === 'process' && !unavailable
        ? field(t('chooseArgs'), el('textarea', { rows: 2, value: draft.args.join('\n'), oninput: event => {
          draft.args = lines(event.target.value);
        } })) : null,
      draft.type === 'command' && !unavailable ? [
        el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: 'editor-cwd' }, t('cwd')),
          el('div', { class: 'input-row' }, directory, browseDirectory)),
        field(t('envNames'), el('textarea', { rows: 2, value: draft.envNames.join('\n'), oninput: event => {
          draft.envNames = lines(event.target.value).map(line => line.trim());
        } }), t('envHint'))
      ] : null,
      field(t('description'), input(draft.description, { maxLength: 1000, oninput: event => { draft.description = event.target.value; } })),
      iconOption,
      checkbox(t('confirmRun'), draft.confirm, value => { draft.confirm = value; }),
      location.glyph?.disabled ? checkbox(t('reviewAction'), !draft.disabled, value => { draft.disabled = !value; }) : null
    ].flat(Infinity).filter(Boolean));
    directory.id = 'editor-cwd';
    save.disabled = unavailable;
    previewGlyph();
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }

  const close = button(t('cancel'), () => closeModal());
  setIssue(location.initialIssue || '');
  redraw();
  openModal(t(editing ? 'editGlyph' : 'addGlyph'), content, [close, save]);
}

function confirmDelete(ctx, location) {
  ctx.confirm(ctx.text('deleteGlyph', { name: location.glyph.name }), ctx.text('canUndo'), ctx.text('delete'), async () => {
    const next = ctx.copyState();
    identify(next, location).set(null);
    if (await ctx.commit(next)) ctx.render();
  }, true);
}

export function moveGlyph(ctx, location, duplicate = false) {
  const { text: t, page, state, openModal, closeModal, commit, render } = ctx;
  const tablets = state().tablets;
  let target = page().id;
  let index = -1;
  const body = el('div', { class: 'editor-form' }, el('p', {}, location.glyph.name));
  const choosePage = select(tablets.map(tablet => [tablet.id, tablet.name]), target, value => {
    target = value;
    drawSlots();
  });
  const slotLocation = el('div', {});
  const go = button(t(duplicate ? 'duplicate' : location.overflow ? 'placeGlyph' : 'move'), async () => {
    const next = ctx.copyState();
    const tablet = next.tablets.find(item => item.id === target);
    const replaced = tablet.slots[index];
    if (duplicate) tablet.slots[index] = { ...structuredClone(location.glyph), id: uid() };
    else {
      identify(next, location).set(replaced);
      tablet.slots[index] = location.glyph;
    }
    if (await commit(next)) { closeModal(false); render(); }
  }, { look: 'primary' });
  function drawSlots() {
    const tablet = tablets.find(item => item.id === target);
    const slots = [];
    tablet.slots.forEach((item, slot) => {
      const original = !location.overflow && target === location.tabletId && location.index === slot;
      if (original || ((duplicate || location.overflow) && item)) return;
      const label = [t('slot', { number: slot + 1 }), item ? t('swap', { name: item.name }) : ''].filter(Boolean).join(' · ');
      slots.push([String(slot), label]);
    });
    const free = slots.find(([slot]) => !tablet.slots[Number(slot)]);
    index = Number(free?.[0] ?? slots[0]?.[0] ?? -1);
    go.disabled = index < 0;
    slotLocation.replaceChildren(slots.length ? field(t('selectSlot'), select(slots, String(index), value => { index = Number(value); })) :
      el('p', { class: 'quiet' }, t('noFreeSlot')));
  }
  body.append(field(t('selectTablet'), choosePage), slotLocation);
  drawSlots();
  openModal(t(duplicate ? 'duplicate' : location.overflow ? 'placeGlyph' : 'moveGlyph'), body,
    [button(t('cancel'), () => closeModal()), go]);
}

export function glyphMenu(ctx, glyph, tabletId, index, initialIssue) {
  const { text: t, openModal, closeModal } = ctx;
  const location = { glyph, tabletId, index, initialIssue };
  const actions = [
    button(t(initialIssue ? 'repair' : 'editGlyph'), () => glyphEditor(ctx, location), { glyph: 'edit' }),
    button(t('moveGlyph'), () => moveGlyph(ctx, location), { glyph: 'arrow' }),
    button(t('duplicate'), () => moveGlyph(ctx, location, true), { glyph: 'plus' }),
    button(t('addToOverflow'), async () => {
      const next = ctx.copyState();
      const tablet = next.tablets.find(item => item.id === tabletId);
      tablet.slots[index] = null;
      next.overflow.push({ glyph, tabletId, tabletName: tablet.name, slot: index, layout: 'grid' });
      if (await ctx.commit(next)) { closeModal(false); ctx.render(); }
    }, { glyph: 'overflow' }),
    button(t('delete'), () => confirmDelete(ctx, location), { look: 'danger-text' })
  ];
  openModal(t('glyphActions'), [el('div', { class: 'glyph-preview' }, ctx.glyphContent(glyph),
    el('strong', {}, glyph.name)), el('div', { class: 'action-stack' }, actions)]);
}

export function overflowMenu(ctx) {
  const { state, text: t, openModal, closeModal } = ctx;
  const entries = state().overflow;
  const list = entries.map(item => {
    const location = { glyph: item.glyph, overflow: true };
    const savedPosition = [item.tabletName, item.slot >= 0 ? t('slot', { number: item.slot + 1 }) : ''].filter(Boolean).join(' · ');
    return el('li', { class: 'line-item' }, ctx.glyphContent(item.glyph), el('div', { class: 'line-label' },
      el('strong', { title: ctx.glyphTitle(item.glyph) }, item.glyph.name), el('small', {}, savedPosition)),
    button(t('editGlyph'), () => glyphEditor(ctx, location), { iconOnly: true, glyph: 'edit' }),
    button(t('placeGlyph'), () => moveGlyph(ctx, location), { iconOnly: true, glyph: 'arrow' }),
    button(t('delete'), () => confirmDelete(ctx, location), { look: 'danger-text' }));
  });
  openModal(t('overflow'),
    entries.length ? [el('p', { class: 'quiet' }, t('overflowHint')), el('ul', { class: 'item-list' }, list)] :
      el('div', { class: 'empty-state' }, icon('overflow'), el('p', {}, t('emptyOverflow'))),
    [button(t('done'), () => closeModal(), { look: 'primary' })]);
}
