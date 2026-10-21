// Importing the coders of another project: for each coder in the file, add them as a new coder,
// or — when a coder with that name exists here (possibly you) — merge into or replace their coding.

import { coderExists, type CoderImport, type CodingData, type ImportAction } from '../model/coders';
import { project } from '../model/state';
import type { Doc } from '../model/types';
import { h } from './dom';
import { currentDocument } from './windows';

export interface CoderImportChoice {
  items: CoderImport[];
  /** Whether coded documents that are not in this project are added (in a folder). */
  addMissing: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Resolves with the choices, or undefined if cancelled. `missing`: the file's documents that are not in this project. */
export function askCoderImport(fileName: string, codings: CodingData[], missing: Doc[]): Promise<CoderImportChoice | undefined> {
  return new Promise((resolve) => {
    let result: CoderImportChoice | undefined;
    const dlg = h('dialog', { class: 'modal import-coders' });
    const close = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });

    const items: CoderImport[] = codings.map((coding) => {
      const name = coding.coderName.trim() || 'Unnamed coder';
      return { coding, name, action: coderExists(name) ? 'merge' : 'add' };
    });
    const missingIds = new Set(missing.map((d) => d.id));
    const missingBox = h('input', { type: 'checkbox', checked: true });
    const missingRow = h('label', { class: 'check-row' }, missingBox);
    const summary = h('p', { class: 'muted import-summary' });
    const importBtn = h('button', { class: 'btn primary' }, 'Import');

    const update = () => {
      const active = items.filter((i) => i.action !== 'skip');
      const docs = new Set(active.flatMap((i) => [...i.coding.segments, ...i.coding.memos].map((x) => x.docId)).filter((id) => missingIds.has(id)));
      missingRow.hidden = !docs.size;
      missingRow.replaceChildren(
        missingBox,
        ` Add ${plural(docs.size, 'coded document')} that ${docs.size === 1 ? 'is' : 'are'} not in this project (or whose text differs), in a folder “From ${fileName.replace(/\.[^.]+$/, '')}”. Otherwise their coding is skipped.`,
      );
      importBtn.disabled = !active.length;
      summary.textContent = active.length
        ? active
            .map((i) =>
              i.action === 'add'
                ? `“${i.name}” is added as a new coder`
                : i.action === 'merge'
                  ? `“${i.name}” is merged into ${i.name === project.coderName ? 'your coding' : `the existing “${i.name}”`}`
                  : `${i.name === project.coderName ? 'your coding' : `“${i.name}”’s coding`} is replaced`,
            )
            .join('; ') + '.'
        : 'Nothing will be imported.';
    };

    const rows = items.map((item) => {
      const select = h('select', { class: 'field' });
      const fillActions = () => {
        const exists = coderExists(item.name.trim());
        const me = item.name.trim() === project.coderName;
        const options: [ImportAction, string][] = exists
          ? [
              ['merge', me ? 'Merge into your coding' : 'Merge into the existing coder'],
              ['replace', me ? 'Replace your coding' : 'Replace their coding'],
              ['skip', 'Skip'],
            ]
          : [
              ['add', 'Add as a new coder'],
              ['skip', 'Skip'],
            ];
        if (!options.some(([v]) => v === item.action)) item.action = options[0][0];
        select.replaceChildren(...options.map(([v, label]) => h('option', { value: v, selected: v === item.action }, label)));
      };
      select.addEventListener('change', () => {
        item.action = select.value as ImportAction;
        update();
      });
      const input = h('input', { type: 'text', class: 'field', value: item.name, spellcheck: 'false' });
      const note = h('span', { class: 'muted import-note' });
      const showNote = () => {
        const n = item.name.trim();
        note.textContent = n === project.coderName ? 'this is you' : coderExists(n) ? 'already a coder here' : 'new';
      };
      input.addEventListener('input', () => {
        item.name = input.value;
        fillActions();
        showNote();
        update();
      });
      fillActions();
      showNote();
      const c = item.coding;
      return h(
        'div',
        { class: 'import-coder' },
        h('div', {}, input, note),
        h('span', { class: 'muted' }, `${plural(c.segments.length, 'coded segment')}${c.memos.length ? `, ${plural(c.memos.length, 'memo')}` : ''}`),
        select,
      );
    });

    importBtn.addEventListener('click', () => {
      result = { items: items.map((i) => ({ ...i, name: i.name.trim() || i.coding.coderName })), addMissing: missingBox.checked };
      close();
    });

    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h(
          'div',
          { class: 'modal-head' },
          h('strong', { class: 'grow' }, `Import coders from “${fileName}”`),
          h('button', { class: 'btn', onClick: close }, 'Cancel'),
          importBtn,
        ),
        h(
          'div',
          { class: 'modal-body' },
          h(
            'p',
            { class: 'muted' },
            'Each coder keeps their own coding. If a coder with the same name is already here (or it is you), merge their coding into it — codes are matched by name and position, identical codes are combined — or replace it. Change a name to import someone as a different coder.',
          ),
          h('div', { class: 'import-coder head' }, h('span', {}, 'Coder'), h('span', {}, 'In the file'), h('span', {}, 'What happens')),
          ...rows,
          missingRow,
          summary,
        ),
      ),
    );
    update();
    currentDocument().body.append(dlg);
    dlg.showModal();
    importBtn.focus();
  });
}
