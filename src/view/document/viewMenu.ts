// The "View ▾" menu above the text: switches for codes and memos, and a checkbox for every column
// that can be shown. It stays open while boxes are ticked, so the layout can be changed quickly.

import { setCodesShown, setColumnVisible, setMemosShown } from '../../controller/comparison';
import { ui } from '../../model/state';
import { availableColumns } from '../../model/table';
import { h } from '../dom';

let open = false;

/** Closes the menu when clicking anywhere else. */
export function initViewMenu() {
  document.addEventListener('click', (e) => {
    if (!open || (e.target as Element).closest?.('.view-menu')) return;
    open = false;
    document.querySelector('.view-menu .menu-list')?.setAttribute('hidden', '');
  });
}

/** The menu button (and, while open, the menu), built from the current state. */
export function viewMenu(): HTMLElement {
  const list = h('div', { class: 'menu-list view-list', hidden: !open }, ...menuItems());
  const button = h(
    'button',
    {
      class: 'btn small',
      title: 'Show or hide codes, memos and columns',
      'aria-haspopup': 'true',
      onClick: () => {
        open = !open;
        list.hidden = !open;
      },
    },
    'View ▾',
  );
  return h('div', { class: 'menu view-menu' }, button, list);
}

function checkbox(label: string, detail: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
  return h(
    'label',
    { class: 'view-item' + (disabled ? ' disabled' : '') },
    h('input', { type: 'checkbox', checked, disabled, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', { class: 'grow' }, label),
    detail ? h('span', { class: 'muted' }, detail) : null,
  );
}

function menuItems(): HTMLElement[] {
  const columns = availableColumns();
  const off = (kind: 'codes' | 'memos') => (kind === 'codes' ? !ui.showCodes : !ui.showMemos);
  return [
    h('div', { class: 'view-title' }, 'Show'),
    checkbox('Codes', 'colors, brackets, list', ui.showCodes, setCodesShown),
    checkbox('Memos', 'sticky notes, underlines, list', ui.showMemos, setMemosShown),
    h('div', { class: 'view-title' }, 'Columns'),
    ...columns.map((c) =>
      checkbox(c.label, String(c.count), c.visible, (v) => setColumnVisible(c.key, v), off(c.kind)),
    ),
    h('div', { class: 'view-note muted' }, 'Hidden columns are also left out of the table CSV export.'),
  ];
}
