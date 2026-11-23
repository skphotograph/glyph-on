import { ANCHORS, SHORTCUTS, SIZES, cleanShortcut, makeTablet, removeTablet, resizeGrid, uid } from './model.mjs';
import { banner, button, checkbox, el, field, input, select } from './dom.mjs';

const tabNames = ['customize', 'behavior', 'tablets', 'shortcuts', 'data', 'about'];
const shortcutNames = { toggle: 'toggle', previous: 'previous', next: 'nextShortcut' };

function heading(title, ...content) {
  return el('section', { class: 'settings-section' }, el('h2', {}, title), content);
}

function customize(ctx) {
  const { text: t, updateVisual } = ctx;
  const draft = ctx.draft();
  const settings = draft.settings;
  let example;
  const opts = keys => keys.map(key => [key, t(key)]);
  const number = (value, min, max, change) => el('input', { type: 'number', value, min, max, oninput: event => {
    if (event.target.validity.valid && event.target.value !== '') change(event.target.valueAsNumber);
  }, onblur: event => { if (!event.target.validity.valid || event.target.value === '') event.target.value = value; } });
  const gridNumber = key => number(draft.layout[key], 1, 8, value => { draft.layout[key] = value; });
  const variable = (key, min, max) => {
    const slider = el('input', { type: 'range', value: settings[key], min, max, 'aria-label': t(key), oninput: event => {
      settings[key] = event.target.valueAsNumber;
      out.value = String(settings[key]) + (key === 'opacity' ? '%' : '');
      updateVisual(settings);
    } });
    const out = el('output', { value: String(settings[key]) + (key === 'opacity' ? '%' : '') });
    return el('label', { class: 'field' }, el('span', { class: 'field-label range-label' }, t(key), out), slider);
  };
  const color = (key, initial) => el('input', { type: 'color', value: settings[key] || initial, oninput: event => {
    settings[key] = event.target.value;
    updateVisual(settings);
  } });
  const background = color('background', document.documentElement.dataset.scheme === 'dark' ? '#23212b' : '#f9f8fc');
  return [
    heading(t('layout'), el('div', { class: 'columns three' }, field(t('rows'), gridNumber('rows')), field(t('columns'), gridNumber('columns')),
      field(t('size'), select(opts(SIZES), draft.layout.size, value => { draft.layout.size = value; })))),
    heading(t('appearance'),
      field(t('theme'), select(opts(['system', 'light', 'dark']), settings.theme, value => {
        settings.theme = value;
        updateVisual(settings);
      })),
      el('div', { class: 'columns two' },
        el('div', { class: 'field' }, field(t('background'), background),
          button(t('themeDefault'), () => {
            settings.background = '';
            updateVisual(settings);
            background.value = document.documentElement.dataset.scheme === 'dark' ? '#23212b' : '#f9f8fc';
          }, { look: 'text-button' })),
        field(t('accent'), color('accent', '#7b61cf'))),
      el('div', { class: 'columns two' }, variable('opacity', 55, 100), variable('radius', 0, 36),
        variable('gap', 2, 16), variable('iconSize', 16, 48)),
      checkbox(t('labels'), settings.labels, value => { settings.labels = value; example.classList.toggle('without-labels', !value); }),
      checkbox(t('reducedMotion'), settings.reducedMotion, value => { settings.reducedMotion = value; updateVisual(settings); }),
      exampleTiles())
  ];

  function exampleTiles() {
    const types = ['app', 'folder', 'url'];
    const node = el('div', { class: `theme-demo${settings.labels ? '' : ' without-labels'}`, 'aria-label': t('previewTablet') });
    node.append(...types.map(type => el('div', { class: 'tile glyph-tile' }, ctx.glyphContent({ type, icon: { kind: 'preset', value: type } }),
      el('span', { class: 'glyph-label' }, t(type)))));
    example = node;
    return node;
  }
}

function behavior(ctx) {
  const { text: t } = ctx;
  const settings = ctx.draft().settings;
  const displays = ctx.information().displays;
  const monitor = el('div', { class: 'field' });
  const refresh = () => {
    const options = displays.map(entry => [entry.id, `${entry.label || entry.id} · ${entry.width} × ${entry.height}`]);
    if (settings.monitorId && !options.some(([id]) => id === settings.monitorId)) options.push([settings.monitorId, t('fixedMissing')]);
    monitor.replaceChildren(...(settings.monitor === 'fixed' ? [select(options, settings.monitorId || displays[0]?.id, value => {
      settings.monitorId = value;
    })] : []));
  };
  monitor.setAttribute('aria-label', t('fixed'));
  refresh();
  const margin = key => el('input', { type: 'number', min: 0, max: 160, value: settings[key], oninput: event => {
    if (event.target.validity.valid && event.target.value !== '') settings[key] = event.target.valueAsNumber;
  }, onblur: event => { event.target.value = settings[key]; } });
  return [
    heading(t('position'), el('div', { class: 'columns two' },
      field(t('position'), select(ANCHORS.map(key => [key, t(key)]), settings.anchor, value => { settings.anchor = value; })),
      field(t('monitor'), select(['cursor', 'active', 'fixed'].map(key => [key, t(key)]), settings.monitor, value => {
        settings.monitor = value;
        if (value === 'fixed' && !settings.monitorId) settings.monitorId = displays[0]?.id ?? '';
        refresh();
      }))),
      monitor, el('div', { class: 'columns two' }, field(t('marginTop'), margin('marginTop')), field(t('marginRight'), margin('marginRight')))),
    heading(t('behavior'), ['dismissOutside', 'closeAfterRun', 'floating', 'wheel', 'startup', 'advanced'].map(key =>
      checkbox(t(key), settings[key], value => { settings[key] = value; }))),
    heading(t('language'), field(t('language'),
      select([['system', t('system')], ['en', 'English'], ['ja', '日本語']], settings.language, value => { settings.language = value; })))
  ];
}

function tablets(ctx) {
  const { text: t, openModal, closeModal, confirm, render } = ctx;
  const draft = ctx.draft();
  const pages = draft.tablets;
  const editName = (tablet, copy = false) => {
    const name = input(tablet ? copy ? `${tablet.name} (2)`.slice(0, 150) : tablet.name : '', {
      maxLength: 150, autofocus: true
    });
    openModal(t(copy ? 'duplicate' : tablet ? 'renameTablet' : 'addTablet'), field(t('tabletName'), name), [
      button(t('cancel'), () => closeModal()),
      button(t(tablet && !copy ? 'save' : 'add'), () => {
        if (!name.value.trim() && tablet && !copy) { ctx.toast('required'); name.focus(); return; }
        const label = name.value.trim() || `Tablet ${pages.length + 1}`;
        if (!tablet) pages.push(makeTablet(label, ctx.state().layout));
        else if (!copy) tablet.name = label;
        else {
          const copy = { ...structuredClone(tablet), id: uid(), name: label };
          for (const glyph of copy.slots.filter(Boolean)) glyph.id = uid();
          pages.splice(pages.indexOf(tablet) + 1, 0, copy);
        }
        closeModal(false);
        render();
      }, { look: 'primary' })
    ]);
  };

  const remove = (tablet) => {
    let mode = 'overflow';
    const others = pages.filter(item => item.id !== tablet.id);
    let dest = others[0].id;
    const go = () => { removeTablet(draft, tablet.id, mode, dest); closeModal(false); render(); };
    const warning = el('p', { class: 'quiet' });
    const destination = select(others.map(item => [item.id, item.name]), dest, value => { dest = value; });
    const destinationField = field(t('selectTablet'), destination);
    destinationField.hidden = true;
    openModal(t('deleteTablet', { name: tablet.name }), [
      field(t('removeTablet'), select([['overflow', t('parkTablet')], ['move', t('moveToTablet')], ['delete', t('dropTablet')]], mode, value => {
        mode = value;
        destinationField.hidden = mode !== 'move';
        warning.textContent = mode === 'move' ? t('moveRemainder') : '';
      })), destinationField, warning
    ], [
      button(t('cancel'), () => closeModal()),
      button(t('removeTablet'), () => {
        if (mode === 'delete') confirm(t('deletePlaced'), t('canUndo'), t('delete'), go, true);
        else go();
      }, { look: 'danger' })
    ]);
  };
  const reorder = (index, by) => {
    const target = index + by;
    [pages[index], pages[target]] = [pages[target], pages[index]];
    render();
  };
  return heading(t('tablets'), el('ul', { class: 'item-list' }, pages.map((tablet, index) =>
    el('li', { class: 'line-item' },
      el('div', { class: 'line-label' }, el('strong', { title: tablet.name }, tablet.name),
        el('small', {}, t('glyphCount', { count: tablet.slots.filter(Boolean).length }))),
      el('div', { class: 'list-tools' },
        button(t('renameTablet'), () => editName(tablet), { glyph: 'edit', iconOnly: true }),
        button(t('duplicate'), () => editName(tablet, true), { glyph: 'plus', iconOnly: true, disabled: pages.length >= 100 }),
        button(t('moveUp'), () => reorder(index, -1), { glyph: 'previous', iconOnly: true, disabled: index === 0 }),
        button(t('moveDown'), () => reorder(index, 1), { glyph: 'next', iconOnly: true, disabled: index === pages.length - 1 }),
        button(t('delete'), () => remove(tablet), { look: 'danger-text', disabled: pages.length === 1 }))))),
    button(t('addTablet'), () => editName(), { glyph: 'plus', disabled: pages.length >= 100 }));
}

function pressedShortcut(event, mac) {
  const physical = event.code;
  const key = /^Key[A-Z]$/.test(physical) ? physical.slice(3) : /^Digit\d$/.test(physical) ? physical.slice(5) :
    physical === 'Space' ? 'Space' : event.key;
  const mods = [[event.metaKey, mac ? 'Command' : 'Super'], [event.ctrlKey, 'Control'],
    [event.altKey, 'Alt'], [event.shiftKey, 'Shift']].filter(([pressed]) => pressed).map(([, modifier]) => modifier);
  return cleanShortcut([...mods, key].join('+'));
}

function shortcuts(ctx) {
  const { text: t, openModal, closeModal, render } = ctx;
  const assigned = ctx.draft().settings.shortcuts;
  const info = ctx.information();
  const record = key => {
    const capture = input('', { readOnly: true, autofocus: true, placeholder: t('recording'), 'aria-label': t('assign'),
      onkeydown: event => {
        if (event.key === 'Escape' || event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
        event.preventDefault();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        try {
          const value = pressedShortcut(event, info.platform === 'darwin');
          if (SHORTCUTS.some(other => other !== key && value === (assigned[other] || info.shortcuts[other]))) {
            ctx.toast('duplicateShortcut'); return;
          }
          assigned[key] = value;
          closeModal(false);
          render();
        } catch (error) { ctx.errorToast(error); }
      } });
    openModal(t('assign'), [el('p', {}, t('pressKeys')), capture], [button(t('cancel'), () => closeModal())]);
  };
  return heading(t('shortcuts'), SHORTCUTS.map(key => {
    const issue = info.conflicts.find(item => item.key === key && item.accelerator === (assigned[key] || info.shortcuts[key]));
    return el('div', { class: 'shortcut-row' },
      el('strong', {}, t(shortcutNames[key])),
      el('div', { class: 'shortcut-buttons' }, button(assigned[key] || info.shortcuts[key], () => record(key), { look: 'key-button' }),
        button(t('resetDefault'), () => { assigned[key] = ''; render(); }, { look: 'text-button', disabled: !assigned[key] })),
      issue ? [banner(t('keyConflict', { key: issue.accelerator })), el('div', { class: 'shortcut-buttons' }, issue.candidates.map(value =>
        button(value, () => {
          if (SHORTCUTS.some(other => other !== key && value === (assigned[other] || info.shortcuts[other]))) ctx.toast('duplicateShortcut');
          else { assigned[key] = value; render(); }
        })))] : null);
  }));
}

function reviewImport(ctx, data) {
  const { text: t, openModal, closeModal, render, confirm } = ctx;
  const apply = async mode => {
    if (await ctx.commit(null, { saveAs: 'applyImport', extra: [data.token, mode] })) {
      ctx.showSettings('data');
      ctx.toast('imported');
    }
  };
  const body = [
    el('p', {}, t('importSummary', { tablets: data.tablets.length, glyphs: data.rows.length })),
    data.issues.map(key => banner(t(key))),
    el('ul', { class: 'item-list import-list' }, data.tablets.map(item => el('li', { class: 'line-item' },
      el('div', { class: 'line-label' }, el('strong', {}, item.name), el('small', {}, t('tablets'))),
      item.duplicate ? el('span', { class: 'pill' }, t('repeated')) : null))),
    el('ul', { class: 'item-list import-list' }, data.rows.map(item => el('li', { class: 'line-item' },
      el('div', { class: 'line-label' }, el('strong', {}, item.name),
        el('small', {}, [t(item.type), item.issue ? t(item.issue) : '', item.disabled ? t('reviewNeeded') : ''].filter(Boolean).join(' · '))),
      item.duplicate ? el('span', { class: 'pill' }, t('repeated')) : null)))
  ];
  openModal(t('reviewImport'), body, [
    button(t('cancel'), () => closeModal()),
    button(t('replace'), () => confirm(t('replaceTitle'), t('replaceHint'), t('replace'), () => apply('replace'), true), { look: 'danger-text' }),
    button(t('merge'), () => void apply('merge'), { look: 'primary' })
  ]);
}

function dataPage(ctx) {
  const { text: t, information, invoke, openModal, closeModal } = ctx;
  const info = information();
  const carryOut = (name, ...args) => invoke(name, ...args).catch(ctx.errorToast);
  const startImport = async legacy => {
    const discovered = await carryOut('inspectImport', legacy);
    if (discovered) reviewImport(ctx, discovered);
  };
  const recovery = info.recovery;
  const restore = async wants => {
    if (await ctx.commit(null, { saveAs: 'resolveRecovery', extra: [wants], history: false })) {
      ctx.showSettings('data');
      ctx.toast(wants ? 'restored' : 'preferencesSaved');
    }
  };
  return [
    recovery || info.quarantined ? heading(t('recoveryTitle'),
      info.quarantined ? banner(t('quarantine', { path: info.quarantined })) : null,
      recovery ? el('p', {}, t('recoveryFound', { time: new Date(recovery.at).toLocaleString(document.documentElement.lang) })) : null,
      recovery ? el('div', { class: 'inline-tools' }, button(t('restore'), () => void restore(true), { look: 'primary' }),
        button(t('fresh'), () => void restore(false))) : null) : null,
    heading(t('data'), el('div', { class: 'inline-tools' },
      button(t('importSettings'), () => void startImport(false), { disabled: Boolean(recovery) }),
      button(t('migrate'), () => void startImport(true), { disabled: Boolean(recovery) }),
      button(t('exportSettings'), () => {
        let include = false;
        openModal(t('exportSettings'), [el('p', {}, t('exportHint')), checkbox(t('includeImages'), false, value => { include = value; })], [
          button(t('cancel'), () => closeModal()),
          button(t('exportSettings'), async () => {
            if (await carryOut('exportSettings', include)) { closeModal(); ctx.toast('exported'); }
          }, { look: 'primary' })
        ]);
      }))),
    heading(t('dataPath'), el('code', { class: 'target-display' }, info.dataPath),
      el('div', { class: 'inline-tools' }, button(t('copyPath'), async () => {
        try { await invoke('copyPath'); ctx.toast('copied'); } catch (error) { ctx.errorToast(error); }
      }), button(t('openDataFolder'), () => void carryOut('openDataFolder'))))
  ];
}

function about(ctx) {
  const { text: t, invoke, openModal, closeModal, confirm } = ctx;
  const links = ['releases', 'feedback', 'security'].map(key =>
    button(t(key === 'releases' ? 'releaseNotes' : key), () => void invoke('openHelp', key).catch(ctx.errorToast)));
  const check = button(t('update'), async () => {
    check.disabled = true;
    check.textContent = t('checking');
    try {
      const release = await invoke('update', 'check');
      if (!release) { ctx.toast('currentVersion'); return; }
      const install = button(t('installUpdate'), async () => {
        install.disabled = true;
        later.disabled = true;
        install.textContent = t('updating');
        try { await invoke('update', 'install'); }
        catch (error) { ctx.errorToast(error); install.disabled = false; later.disabled = false; install.textContent = t('installUpdate'); }
      }, { look: 'primary' });
      const later = button(t('later'), () => closeModal());
      openModal(t('updateAvailable', release), el('pre', { class: 'release-notes' }, release.notes), [later, install]);
    } catch (error) { ctx.errorToast(error); }
    finally { check.disabled = false; check.textContent = t('update'); }
  }, { look: 'selected' });
  const uninstall = button(t('uninstall'), () => {
    const prepare = deleteSettings => invoke('prepareUninstall', deleteSettings).catch(ctx.errorToast);
    openModal(t('uninstall'), el('p', {}, t('uninstallHint')), [
      button(t('cancel'), () => closeModal()),
      button(t('uninstallDelete'), () => confirm(t('uninstallDelete'), t('uninstallDeleteHint'), t('uninstallDelete'),
        () => prepare(true), true), { look: 'danger-text' }),
      button(t('uninstallKeep'), () => void prepare(false), { look: 'primary' })
    ]);
  });
  return [
    heading('Glyph-on', el('p', { class: 'quiet' }, t('version', ctx.information())),
      el('div', { class: 'inline-tools' }, check, links,
        ctx.information().platform === 'darwin' && ctx.information().packaged ? uninstall : null)),
    heading(t('faq'), [1, 2, 3, 4].map(index => el('details', {},
      el('summary', {}, t(`help${index}Title`)), el('p', {}, t(`help${index}`)))))
  ];
}

export function settingsPage(ctx) {
  const { text: t, setTab, tab, showLauncher, state, commit, confirm } = ctx;
  const views = { customize, behavior, tablets, shortcuts, data: dataPage, about };
  async function save() {
    const next = structuredClone(ctx.draft());
    const dimensions = next.layout;
    next.layout = state().layout;
    const before = next.overflow.length;
    resizeGrid(next, dimensions);
    const moved = next.overflow.length - before;
    const submit = async () => {
      if (await commit(next)) {
        showLauncher();
        ctx.toast('preferencesSaved');
      }
    };
    if (moved > 0) confirm(t('shrinkTitle', { count: moved }), t('shrinkHint'), t('save'), submit);
    else await submit();
  }
  return el('main', { class: 'panel settings' },
    el('header', { class: 'launcher-toolbar' },
      el('div', { class: 'brand' }, el('img', { class: 'mark', src: '/mark.png', alt: '' }),
        el('div', { class: 'brand-text' }, el('h1', {}, t('settings')), el('span', {}, 'Glyph-on'))),
      button(t('close'), showLauncher, { glyph: 'close', iconOnly: true, look: 'ghost' })),
    el('nav', { class: 'settings-tabs', 'aria-label': t('settings') }, tabNames.map(name =>
      button(t(name), () => setTab(name), { id: `settings-${name}`, pressed: tab === name, look: tab === name ? 'selected' : 'ghost' }))),
    el('div', { class: 'settings-body', tabindex: 0 }, views[tab](ctx)),
    el('footer', { class: 'setup-footer' },
      button(t('cancel'), showLauncher), button(t('save'), () => void save(), { look: 'primary', disabled: Boolean(ctx.information().recovery) })));
}
