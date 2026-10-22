// The "Other coders" panel: every coder besides you (imported or of this project), with
// visibility, switching to them, rename and remove.

import { removeCoderInteractive, renameCoderInteractive, setColumnVisible } from '../controller/comparison';
import { switchCoderTo } from '../controller/preferences';
import { project, ui } from '../model/state';
import { h } from './dom';

export function renderCoderList(container: HTMLElement) {
  if (!project.externalCodings.length) {
    container.replaceChildren(
      h('p', { class: 'muted pad' }, 'Other coders appear here: add one under Coder ▾ at the top, or import another person’s exported project to compare their coding side by side.'),
    );
    return;
  }
  container.replaceChildren(
    ...project.externalCodings.map((x) =>
      h(
        'div',
        { class: 'coder-row' },
        h('input', {
          type: 'checkbox',
          checked: !ui.hiddenColumns.includes(x.id),
          title: 'Show their codes as a column next to the text (more choices under View ▾ above the text)',
          onChange: (e: Event) => setColumnVisible(x.id, (e.target as HTMLInputElement).checked),
        }),
        h('span', { class: 'tree-name', title: `Since ${new Date(x.importedAt).toLocaleString()}` }, x.coderName),
        h('span', { class: 'badge', title: `${x.segments.length} coded segments, ${x.memos.length} memos` }, x.memos.length ? `${x.segments.length} · ${x.memos.length} memos` : String(x.segments.length)),
        h(
          'button',
          { class: 'icon-btn', title: `Code as “${x.coderName}” (your coding becomes one of the other coders)`, onClick: () => switchCoderTo(x.coderName) },
          '↪',
        ),
        h('button', { class: 'icon-btn', title: 'Rename (an existing name merges the two)', onClick: () => renameCoderInteractive(x) }, '✎'),
        h('button', { class: 'icon-btn', title: 'Remove this coder', onClick: () => removeCoderInteractive(x) }, h('i', { class: 'fa-solid fa-trash', 'aria-hidden': 'true' }),),
      ),
    ),
  );
}
