// The "Other coders" panel: imported codings, with visibility, rename and remove.

import { removeCoderInteractive, renameCoderInteractive, setCoderVisible } from '../controller/comparison';
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
          checked: !ui.hiddenExternal.includes(x.id),
          title: 'Show as a column next to the text',
          onChange: (e: Event) => setCoderVisible(x.id, (e.target as HTMLInputElement).checked),
        }),
        h('span', { class: 'tree-name', title: `Imported ${new Date(x.importedAt).toLocaleString()}` }, x.coderName),
        h('span', { class: 'badge', title: 'Coded segments' }, String(x.segments.length)),
        h('button', { class: 'icon-btn', title: 'Rename', onClick: () => renameCoderInteractive(x) }, '✎'),
        h('button', { class: 'icon-btn', title: 'Remove this coder', onClick: () => removeCoderInteractive(x) }, '✕'),
      ),
    ),
  );
}
