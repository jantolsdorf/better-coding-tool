// The "Other coders" panel: imported codings, with visibility, rename and remove.

import { removeCoderInteractive, renameCoderInteractive, setColumnVisible } from '../controller/comparison';
import { project, ui } from '../model/state';
import { h } from './dom';

export function renderCoderList(container: HTMLElement) {
  if (!project.externalCodings.length) {
    container.replaceChildren(
      h('p', { class: 'muted pad' }, 'Import another person’s exported project to compare their coding side by side.'),
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
        h('span', { class: 'tree-name', title: `Imported ${new Date(x.importedAt).toLocaleString()}` }, x.coderName),
        h('span', { class: 'badge', title: `${x.segments.length} coded segments, ${x.memos.length} memos` }, x.memos.length ? `${x.segments.length} · ${x.memos.length} memos` : String(x.segments.length)),
        h('button', { class: 'icon-btn', title: 'Rename', onClick: () => renameCoderInteractive(x) }, '✎'),
        h('button', { class: 'icon-btn', title: 'Remove this coder', onClick: () => removeCoderInteractive(x) }, '✕'),
      ),
    ),
  );
}
