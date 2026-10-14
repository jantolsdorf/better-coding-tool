// The dialog for merging copies of the same document: it shows which copies there are and who
// coded each, and lets you keep, rename or merge authors, choose whose coding becomes yours,
// and where the merged copies go.

import { folderChain, folderPath } from '../model/documents';
import { authorsOf, type CopyGroup, type MergeOptions } from '../model/mergeDocs';
import { project } from '../model/state';
import { h } from './dom';
import { currentDocument } from './windows';

const NEW_FOLDER = '__new__';
const TOP = '__top__';

/** Resolves with the chosen options, or undefined if cancelled. */
export function askMergeOptions(groups: CopyGroup[]): Promise<MergeOptions | undefined> {
  return new Promise((resolve) => {
    let result: MergeOptions | undefined;
    const dlg = h('dialog', { class: 'modal merge-dialog' });
    const close = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });

    // Everyone who worked on any of the copies, with their total work.
    const totals = new Map<string, { segments: number; memos: number }>();
    for (const g of groups) {
      for (const d of g.copies) {
        for (const a of authorsOf(d.id)) {
          const t = totals.get(a.name) ?? { segments: 0, memos: 0 };
          t.segments += a.segments;
          t.memos += a.memos;
          totals.set(a.name, t);
        }
      }
    }
    const authors = [...totals.keys()].sort((a, b) => a.localeCompare(b));
    const names = new Map(authors.map((a) => [a, a]));
    let me = authors.includes(project.coderName) ? project.coderName : (authors[0] ?? project.coderName);

    const authorRows = h('div', { class: 'merge-authors' });
    const meSelect = h('select', { class: 'field', title: 'Whose coding you can edit in the merged copy; everyone else becomes another coder' });
    const resultNote = h('p', { class: 'muted merge-note' });
    const targets = () => [...new Set(authors.map((a) => names.get(a)!.trim() || a))];

    const renderAuthors = () => {
      const list = targets();
      if (!list.includes(me)) me = list.includes(project.coderName) ? project.coderName : list[0];
      meSelect.replaceChildren(...list.map((t) => h('option', { value: t, selected: t === me }, t)));
      const merged = list.filter((t) => authors.filter((a) => (names.get(a)!.trim() || a) === t).length > 1);
      resultNote.textContent =
        `The merged copy will have ${list.length} author${list.length === 1 ? '' : 's'}: ${list.join(', ')}.` +
        (merged.length ? ` Merged: ${merged.map((t) => `${authors.filter((a) => (names.get(a)!.trim() || a) === t).join(' + ')} → ${t}`).join('; ')}.` : '') +
        ` Your coding: ${me}; ${list.length > 1 ? 'the others appear as other coders (to compare and consolidate).' : 'there are no other coders.'}`;
    };
    meSelect.addEventListener('change', () => {
      me = meSelect.value;
      renderAuthors();
    });

    authorRows.append(
      h('div', { class: 'merge-author head' }, h('span', {}, 'Author'), h('span', {}, 'Work on these copies'), h('span', {}, 'Name in the merged copy')),
      ...authors.map((a) => {
        const t = totals.get(a)!;
        const input = h('input', { type: 'text', class: 'field', value: a, list: 'merge-author-names', spellcheck: 'false' });
        input.addEventListener('input', () => {
          names.set(a, input.value);
          renderAuthors();
        });
        return h(
          'div',
          { class: 'merge-author' },
          h('strong', {}, a),
          h('span', { class: 'muted' }, `${t.segments} coded segment${t.segments === 1 ? '' : 's'}${t.memos ? `, ${t.memos} memo${t.memos === 1 ? '' : 's'}` : ''}`),
          input,
        );
      }),
      h('datalist', { id: 'merge-author-names' }, ...authors.map((a) => h('option', { value: a }))),
    );

    const allIntoOne = h(
      'button',
      {
        class: 'btn small',
        title: 'Give every author the same name, so all codes become one author’s',
        onClick: () => {
          const target = me || authors[0];
          for (const a of authors) names.set(a, target);
          authorRows.querySelectorAll<HTMLInputElement>('.merge-author input').forEach((i) => (i.value = target));
          renderAuthors();
        },
      },
      'Merge all into one author',
    );
    const keepAll = h(
      'button',
      {
        class: 'btn small',
        title: 'Every author keeps their own name',
        onClick: () => {
          for (const a of authors) names.set(a, a);
          authorRows.querySelectorAll<HTMLInputElement>('.merge-author input').forEach((i, n) => (i.value = authors[n]));
          renderAuthors();
        },
      },
      'Keep all names',
    );

    const folderSelect = h(
      'select',
      { class: 'field' },
      h('option', { value: NEW_FOLDER }, 'New folder “Merged copies”'),
      h('option', { value: TOP }, '(top level)'),
      ...project.folders
        .map((f): [string, string] => [f.id, folderChain(f.id).join(' / ')])
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, label]) => h('option', { value: id }, label)),
    );
    const removeBox = h('input', { type: 'checkbox' });

    const copies = groups.map((g) =>
      h(
        'div',
        { class: 'merge-group' },
        h('div', { class: 'merge-group-title' }, `${g.copies[0].name}`, h('span', { class: 'muted' }, ` · ${g.copies.length} identical copies`)),
        ...g.copies.map((d) => {
          const who = authorsOf(d.id);
          const path = folderPath(d.folderId);
          return h(
            'div',
            { class: 'merge-copy' },
            h('span', { class: 'merge-copy-name' }, path ? `${path} / ${d.name}` : d.name),
            h(
              'span',
              { class: 'muted' },
              who.length ? `coded by ${who.map((w) => `${w.name} (${w.segments}${w.memos ? ` + ${w.memos} memo${w.memos === 1 ? '' : 's'}` : ''})`).join(', ')}` : 'not coded',
            ),
          );
        }),
      ),
    );

    const merge = () => {
      const folder = folderSelect.value;
      result = {
        rename: new Map(authors.map((a) => [a, names.get(a)!.trim() || a])),
        me,
        folderId: folder === NEW_FOLDER || folder === TOP ? null : folder,
        newFolder: folder === NEW_FOLDER ? 'Merged copies' : undefined,
        removeOriginals: removeBox.checked,
      };
      close();
    };

    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h(
          'div',
          { class: 'modal-head' },
          h('strong', { class: 'grow' }, `Merge ${groups.length === 1 ? 'copies of a document' : `copies of ${groups.length} documents`}`),
          h('button', { class: 'btn', onClick: close }, 'Cancel'),
          h('button', { class: 'btn primary', onClick: merge }, 'Merge into new copies'),
        ),
        h(
          'div',
          { class: 'modal-body' },
          h('p', { class: 'muted merge-note' }, 'Each group of documents with identical text becomes one new document with everyone’s coding and memos. Codes are matched by name and position (path).'),
          h('label', { class: 'label' }, 'Who worked on which copy'),
          ...copies,
          h('label', { class: 'label' }, 'Authors'),
          h('p', { class: 'muted merge-note' }, 'Keep each author’s name, rename it, or give several authors the same name to merge their codes into one author.'),
          authorRows,
          h('div', { class: 'row merge-quick' }, keepAll, allIntoOne),
          h('label', { class: 'label' }, 'Your coding in the merged copy'),
          meSelect,
          resultNote,
          h('label', { class: 'label' }, 'Put the merged copies into'),
          folderSelect,
          h('label', { class: 'check-row merge-remove' }, removeBox, ' Remove the original copies afterwards (Undo brings them back)'),
        ),
      ),
    );
    renderAuthors();
    currentDocument().body.append(dlg);
    dlg.showModal();
  });
}
