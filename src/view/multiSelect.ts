// Selecting several rows of a list (documents and folders, or codes) to move, merge or delete
// them together. Cmd/Ctrl-click toggles a row, Shift-click selects a range; in select mode
// (the panel's "Select" button) a plain click toggles too. The selection is view state only.

import { h } from './dom';

export class Selection {
  readonly keys = new Set<string>();
  /** Select mode: rows show checkboxes and a plain click toggles. */
  mode = false;
  /** Keys of the rows in the order they are shown, for Shift-click ranges. */
  order: string[] = [];
  private anchor: string | null = null;

  constructor(private readonly onChange: () => void) {}

  get size() {
    return this.keys.size;
  }

  get active() {
    return this.mode || this.keys.size > 0;
  }

  has(key: string) {
    return this.keys.has(key);
  }

  clear() {
    if (!this.keys.size && !this.mode) return;
    this.keys.clear();
    this.mode = false;
    this.anchor = null;
    this.onChange();
  }

  toggleMode() {
    if (this.mode) this.clear();
    else {
      this.mode = true;
      this.onChange();
    }
  }

  /** Forgets keys whose rows no longer exist (e.g. after deleting or undoing). */
  prune(existing: Set<string>) {
    for (const k of this.keys) if (!existing.has(k)) this.keys.delete(k);
  }

  /**
   * Handles a click on a row. Returns true if it changed the selection (the row's normal click
   * action should then not run).
   */
  click(e: MouseEvent, key: string): boolean {
    if (e.shiftKey && this.anchor && this.order.includes(this.anchor)) {
      const [a, b] = [this.order.indexOf(this.anchor), this.order.indexOf(key)].sort((x, y) => x - y);
      for (const k of this.order.slice(a, b + 1)) this.keys.add(k);
    } else if (e.metaKey || e.ctrlKey || e.shiftKey || this.mode) {
      if (this.keys.has(key)) this.keys.delete(key);
      else this.keys.add(key);
      this.anchor = key;
    } else return false;
    this.mode = true;
    this.onChange();
    return true;
  }

  /** Intercepts clicks on a row (before its buttons react) while selecting; in select mode adds a checkbox to `checkboxIn`. */
  bindRow(row: HTMLElement, key: string, checkboxIn: HTMLElement = row, { hoverCheckbox = false } = {}) {
    row.classList.toggle('multi-selected', this.has(key));
    row.addEventListener(
      'click',
      (e) => {
        if ((e.target as Element).closest('.caret')) return;
        // Ticking a row's own checkbox selects it, even outside select mode.
        if ((e.target as Element).closest('.row-check')) {
          e.stopImmediatePropagation();
          this.toggle(key);
          return;
        }
        if (this.click(e, key)) {
          e.preventDefault();
          // Also stops the row's own click handler when the row itself was clicked.
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    // With `hoverCheckbox`, every row has a checkbox that shows on hover (always while selecting).
    if (this.mode || hoverCheckbox) {
      const box = h('input', { type: 'checkbox', class: 'row-check', checked: this.has(key), tabIndex: -1 });
      if (hoverCheckbox) box.classList.add('hover-check', ...(this.active ? ['shown'] : []));
      checkboxIn.prepend(box);
    }
  }

  /** Adds or removes one row, starting select mode. */
  toggle(key: string) {
    if (this.keys.has(key)) this.keys.delete(key);
    else this.keys.add(key);
    this.anchor = key;
    this.mode = true;
    this.onChange();
  }

  /** The bar with the selection count and the actions for the selected rows. */
  bar(actions: (HTMLElement | null)[], noun: [string, string]): HTMLElement {
    const n = this.size;
    const allSelected = n > 0 && n === this.order.length;
    return h(
      'div',
      { class: 'select-bar' },
      h(
        'button',
        {
          class: 'icon-btn',
          title: allSelected ? 'Select none' : 'Select all shown',
          onClick: () => {
            if (allSelected) this.keys.clear();
            else this.order.forEach((k) => this.keys.add(k));
            this.onChange();
          },
        },
        allSelected ? '☑' : '☐',
      ),
      h('span', { class: 'select-count' }, n ? `${n} ${n === 1 ? noun[0] : noun[1]}` : 'Select items'),
      h('span', { class: 'grow' }),
      ...(n ? actions : []),
      h('button', { class: 'icon-btn', title: 'Done (Esc)', onClick: () => this.clear() }, '✕'),
    );
  }
}

/** Option value for "top level" in move menus. */
export const TOP_LEVEL = '__top__';

/** A compact <select> that runs `fn` with the chosen value and then resets itself. */
export function actionSelect(label: string, title: string, options: [string, string][], fn: (value: string) => void): HTMLElement {
  const sel = h(
    'select',
    {
      class: 'select-action',
      title,
      onChange: () => {
        const v = sel.value;
        sel.value = '';
        if (v) fn(v);
      },
    },
    h('option', { value: '' }, label),
    ...options.map(([value, text]) => h('option', { value }, text)),
  );
  return sel;
}
