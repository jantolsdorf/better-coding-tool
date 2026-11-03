// A checklist of documents (with their folder paths) and an "All documents" checkbox, used by
// auto-coding and AI coding. By default the open document is chosen, or all if none is open.

import { currentDoc, docsInTreeOrder, folderPath } from '../model/documents';
import { h } from './dom';

export interface DocPicker {
  chosen: Set<string>;
  /** The "All documents" checkbox, for the section's heading. */
  allBox: HTMLInputElement;
  list: HTMLElement;
}

export function docPicker(onChange: () => void): DocPicker {
  const docs = docsInTreeOrder();
  const open = currentDoc();
  const chosen = new Set(open ? [open.id] : docs.map((d) => d.id));
  const allBox = h('input', { type: 'checkbox' });
  const list = h('div', { class: 'ac-docs' });
  const render = () => {
    allBox.checked = chosen.size === docs.length && docs.length > 0;
    allBox.indeterminate = chosen.size > 0 && chosen.size < docs.length;
    list.replaceChildren(
      ...docs.map((d) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(d.id) });
        box.addEventListener('change', () => {
          if (box.checked) chosen.add(d.id);
          else chosen.delete(d.id);
          render();
          onChange();
        });
        const path = folderPath(d.folderId);
        return h('label', { class: 'ac-doc' }, box, ` ${path ? `${path} / ${d.name}` : d.name}`);
      }),
    );
  };
  allBox.addEventListener('change', () => {
    chosen.clear();
    if (allBox.checked) docs.forEach((d) => chosen.add(d.id));
    render();
    onChange();
  });
  render();
  return { chosen, allBox, list };
}
