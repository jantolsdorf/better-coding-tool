// Choosing a code (e.g. a parent, or the code to merge into): a search field that finds codes as
// the code box does when coding (by name, or by path "trust > dist"; Tab completes), with the
// codes listed as a tree (codeTree.ts). While searching, the matches are shown with their
// parents for context.

import { codeById, codePath } from '../model/codes';
import type { Code } from '../model/types';
import './codePicker.css';
import { codeTreeRows, treeRowClass, treeRowContent, type TreeRow } from './codeTree';
import { h } from './dom';

export interface CodePickerOptions {
  /** The code chosen at first (null: the top level, if offered). */
  value?: string | null;
  /** Codes that can be chosen (the others are shown, greyed, for the tree's sake). */
  allow?: (code: Code) => boolean;
  /** Label of a "no code" choice (e.g. "(top level)"); without it, there is none. */
  topLevel?: string;
  placeholder?: string;
  /** Called when a code (or the top level) is chosen. */
  onPick?: (id: string | null) => void;
  /** The list is always shown (in a dialog of its own) instead of only while the field has focus. */
  alwaysOpen?: boolean;
  /** Numbers of coded segments, shown next to the codes. */
  counts?: Map<string, number>;
}

export interface CodePicker {
  el: HTMLElement;
  /** The chosen code's id, null for the top level, undefined for nothing chosen. */
  value(): string | null | undefined;
  focus(): void;
}

interface Row {
  id: string | null;
  /** The code's row in the tree (none for the top level). */
  tree?: TreeRow;
  code?: Code;
  selectable: boolean;
  /** Matches what was typed (shown stronger than the parents listed for context). */
  match: boolean;
}

export function codePicker(opts: CodePickerOptions): CodePicker {
  let selected = opts.value;
  let query = '';
  let rows: Row[] = [];
  let active = -1;
  const searchHint = opts.placeholder ?? 'Type to search codes, e.g. “trust” or “trust > dist”';
  const input = h('input', {
    type: 'text',
    class: 'field code-picker-input',
    placeholder: searchHint,
    autocomplete: 'off',
    spellcheck: false,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
  });
  const list = h('ul', { class: 'code-picker-list', role: 'listbox', hidden: true });
  const el = h('div', { class: 'code-picker' + (opts.alwaysOpen ? ' always-open' : '') }, input, list);

  const label = () => (selected === null ? (opts.topLevel ?? '') : selected ? codePath(codeById(selected)!) : '');
  input.value = opts.alwaysOpen ? '' : label();

  function build() {
    const q = query.trim();
    const top = opts.topLevel !== undefined && (!q || opts.topLevel.toLowerCase().includes(q.toLowerCase()));
    rows = [
      ...(top ? [{ id: null, selectable: true, match: !!q } as Row] : []),
      ...codeTreeRows(q).map((t): Row => ({ id: t.code.id, tree: t, code: t.code, selectable: opts.allow?.(t.code) ?? true, match: t.match })),
    ];
    // Typing: the first match that can be chosen; else the chosen code.
    active = q ? rows.findIndex((r) => r.match && r.selectable) : rows.findIndex((r) => r.id === selected);
    render();
  }

  function render() {
    list.replaceChildren(
      ...rows.map((r, i) =>
        h(
          'li',
          {
            class: [i === active ? 'active' : '', r.selectable ? '' : 'disabled', r.tree ? treeRowClass(r.tree, query) : r.match ? 'tree-match' : '', r.id === selected ? 'chosen' : '']
              .filter(Boolean)
              .join(' '),
            role: 'option',
            'aria-selected': String(i === active),
            'aria-disabled': String(!r.selectable),
            title: r.code ? codePath(r.code) + (r.selectable ? '' : ' (cannot be chosen here)') : (opts.topLevel ?? ''),
            onMousedown: (e: MouseEvent) => {
              // Keep the focus in the field.
              e.preventDefault();
              if (r.selectable) pick(r);
            },
          },
          ...(r.tree ? treeRowContent(r.tree, opts.counts ? (opts.counts.get(r.tree.code.id) ?? 0) : undefined) : [h('span', { class: 'code-tree-name' }, opts.topLevel ?? '')]),
        ),
      ),
      ...(rows.length ? [] : [h('li', { class: 'empty muted' }, query.trim() ? `No code matches “${query.trim()}”.` : 'No codes yet.')]),
    );
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    build();
  }

  function close() {
    if (opts.alwaysOpen) return;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    query = '';
    input.value = label();
    input.placeholder = searchHint;
  }

  function pick(r: Row) {
    selected = r.id;
    close();
    opts.onPick?.(r.id);
  }

  /** The next row that can be chosen, from `from` in direction `step`. */
  const next = (from: number, step: number) => {
    for (let i = from + step; i >= 0 && i < rows.length; i += step) if (rows[i].selectable) return i;
    return from;
  };

  // Searching starts empty; the chosen code stays visible as the placeholder.
  input.addEventListener('focus', () => {
    query = '';
    if (label()) input.placeholder = `${label()} · type to search`;
    input.value = '';
    open();
  });
  input.addEventListener('input', () => {
    query = input.value;
    open();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) open();
      active = next(active, e.key === 'ArrowDown' ? 1 : -1);
      render();
    } else if (e.key === 'Enter') {
      // Choosing, not the dialog's Enter.
      e.preventDefault();
      e.stopPropagation();
      if (rows[active]?.selectable) pick(rows[active]);
    } else if (e.key === 'Escape' && !list.hidden && !opts.alwaysOpen) {
      // Closes the list only, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      close();
      input.select();
    } else if (e.key === 'Tab' && query.trim()) {
      // As when coding: Tab completes to the highlighted (or first) code's path.
      const r = rows[active] ?? rows.find((x) => x.match);
      if (!r?.code) return;
      e.preventDefault();
      input.value = query = codePath(r.code);
      build();
    }
  });
  if (opts.alwaysOpen) open();
  return { el, value: () => selected, focus: () => input.focus() };
}

/**
 * Asks for a code in a dialog of its own (in `doc`): a title, a line of explanation and the
 * code picker. Resolves with the chosen code's id, or undefined if cancelled.
 */
export function pickCode(doc: Document, title: string, message: string, opts: CodePickerOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    let result: string | undefined;
    const dlg = h('dialog', { class: 'modal pick-code-dialog' });
    const picker = codePicker({
      ...opts,
      alwaysOpen: true,
      onPick: (id) => {
        result = id ?? undefined;
        dlg.close();
      },
    });
    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h('div', { class: 'modal-head' }, h('strong', {}, title)),
        h('div', { class: 'modal-body' }, h('p', { class: 'muted' }, message), picker.el),
        h('div', { class: 'modal-foot' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onClick: () => dlg.close() }, 'Cancel')),
      ),
    );
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    doc.body.append(dlg);
    dlg.showModal();
    picker.focus();
  });
}
