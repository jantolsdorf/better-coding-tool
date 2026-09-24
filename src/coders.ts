import { project, removeExternal, renameExternal, setExternalVisible, ui } from './store';
import { h } from './util';

export function renderCoders(container: HTMLElement) {
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
          onChange: (e: Event) => setExternalVisible(x.id, (e.target as HTMLInputElement).checked),
        }),
        h('span', { class: 'tree-name', title: `Imported ${new Date(x.importedAt).toLocaleString()}` }, x.coderName),
        h('span', { class: 'badge', title: 'Coded segments' }, String(x.segments.length)),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Rename',
            onClick: () => {
              const name = prompt('Coder name:', x.coderName);
              if (name?.trim()) renameExternal(x.id, name);
            },
          },
          '✎',
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Remove this coder',
            onClick: () => {
              if (confirm(`Remove the imported coding of “${x.coderName}”?`)) removeExternal(x.id);
            },
          },
          '✕',
        ),
      ),
    ),
  );
}
