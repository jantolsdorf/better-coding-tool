// Code occurrence across coders: for each document, which codes each coder used at all (with
// how often), regardless of where in the text. Codes that not every coder used stand out.

import './compareWindows.css';
import { exportOccurrenceCSV } from '../controller/comparison';
import { docsInTreeOrder, folderPath, getDoc } from '../model/documents';
import { codeOccurrence, occurrenceAgreement, type OccurrenceRow } from '../model/occurrence';
import { project, subscribe, ui } from '../model/state';
import type { Doc, TableColumn } from '../model/types';
import { h } from './dom';
import { closeToolWindow, openToolWindow } from './windows';

const ALL = '__all__';

/** The last choices, so reopening the dialog keeps them. */
const state = { docId: '', onlyDifferences: false, excluded: new Set<string>() };

/** Your coding and every other coder's, as columns to compare (the consolidated coding is left out). */
function coderColumns(): TableColumn[] {
  return [
    { key: 'me', kind: 'mine', name: project.coderName || 'You', codes: project.codes, segments: project.segments },
    ...project.externalCodings.map((x): TableColumn => ({ key: x.id, kind: 'external', name: x.coderName, codes: x.codes, segments: x.segments })),
  ];
}

const docLabel = (d: Doc) => {
  const path = folderPath(d.folderId);
  return path ? `${path} / ${d.name}` : d.name;
};

const percent = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);

export function openOccurrenceView() {
  let stop = () => {};
  const root = openToolWindow('occurrence', 'Code occurrence', () => stop());
  if (!root) return; // already open (now in front), or blocked (see openToolWindow)
  const tools = h('div', { class: 'review-tools' });
  const body = h('div', { class: 'modal-body occurrence-body' });
  const foot = h('div', { class: 'modal-foot' });

  const render = () => {
    const all = coderColumns();
    const cols = all.filter((c) => !state.excluded.has(c.key));
    const docs = docsInTreeOrder();
    if (state.docId !== ALL && !getDoc(state.docId)) state.docId = ui.selectedDocId && getDoc(ui.selectedDocId) ? ui.selectedDocId : (docs[0]?.id ?? ALL);
    const shown = state.docId === ALL ? docs : docs.filter((d) => d.id === state.docId);

    tools.replaceChildren(
      h('label', { class: 'review-label' }, 'Document'),
      h(
        'select',
        {
          class: 'field',
          onChange: (e: Event) => {
            state.docId = (e.target as HTMLSelectElement).value;
            render();
          },
        },
        h('option', { value: ALL, selected: state.docId === ALL }, 'All documents'),
        ...docs.map((d) => h('option', { value: d.id, selected: d.id === state.docId }, docLabel(d))),
      ),
      h('label', { class: 'review-label' }, 'Coders'),
      ...all.map((c) =>
        h(
          'button',
          {
            class: 'seg-toggle' + (state.excluded.has(c.key) ? '' : ' on'),
            title: state.excluded.has(c.key) ? `Include ${c.name}` : `Leave ${c.name} out`,
            onClick: () => {
              if (state.excluded.has(c.key)) state.excluded.delete(c.key);
              else state.excluded.add(c.key);
              render();
            },
          },
          c.name,
        ),
      ),
      h('span', { class: 'grow' }),
      h(
        'label',
        { class: 'review-check', title: 'Hide codes that every coder used' },
        h('input', {
          type: 'checkbox',
          checked: state.onlyDifferences,
          onChange: (e: Event) => {
            state.onlyDifferences = (e.target as HTMLInputElement).checked;
            render();
          },
        }),
        ' Only differences',
      ),
    );

    if (cols.length < 2) {
      body.replaceChildren(h('p', { class: 'muted pad' }, 'Choose at least two coders to compare.'));
    } else {
      const sections = shown
        .map((d) => ({ d, rows: codeOccurrence(d.id, cols) }))
        .filter((x) => x.rows.length);
      // Over all shown documents: share of (document, code) pairs that every coder used.
      const allRows = sections.flatMap((x) => x.rows);
      const summary =
        state.docId === ALL && sections.length
          ? h('p', { class: 'occ-summary' }, `Over ${sections.length} document${sections.length === 1 ? '' : 's'}: ${percent(occurrenceAgreement(allRows))} of the codes used in a document were used there by all coders.`)
          : null;
      body.replaceChildren(
        ...(summary ? [summary] : []),
        ...(sections.length ? sections.map(({ d, rows }) => occurrenceTable(d, rows, cols, state.docId === ALL)) : [h('p', { class: 'muted pad' }, 'No codes in this document yet.')]),
      );
    }
    foot.replaceChildren(
      h('span', { class: 'muted grow' }, 'Counts are coded segments per code; codes are matched across coders by name and position (path).'),
      h('button', { class: 'btn', onClick: () => exportOccurrenceCSV(shown, cols) }, 'Export CSV'),
    );
  };

  root.append(
    h(
      'div',
      { class: 'modal-inner tool-inner' },
      h('div', { class: 'modal-head' }, h('strong', { class: 'grow' }, 'Code occurrence across coders'), h('button', { class: 'btn', onClick: () => closeToolWindow('occurrence') }, 'Close')),
      tools,
      body,
      foot,
    ),
  );
  render();
  // Stays up to date with coding done in the main window.
  stop = subscribe(render);
}

function occurrenceTable(doc: Doc, rows: OccurrenceRow[], cols: TableColumn[], withTitle: boolean): HTMLElement {
  const agreed = rows.filter((r) => r.agreed).length;
  const visible = state.onlyDifferences ? rows.filter((r) => !r.agreed) : rows;
  return h(
    'section',
    { class: 'occ-section' },
    h(
      'div',
      { class: 'occ-head' },
      withTitle ? h('strong', { class: 'grow' }, docLabel(doc)) : h('span', { class: 'grow' }),
      h(
        'span',
        { class: 'occ-agreement', title: 'Codes used by all coders, of all codes used by anyone in this document' },
        `${agreed} of ${rows.length} codes used by all · ${percent(occurrenceAgreement(rows))}`,
      ),
    ),
    visible.length
      ? h(
          'table',
          { class: 'occ-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Code'), ...cols.map((c) => h('th', { class: 'num' }, c.name)))),
          h(
            'tbody',
            {},
            ...visible.map((r) =>
              h(
                'tr',
                { class: r.agreed ? 'agreed' : 'differs' },
                h(
                  'td',
                  {},
                  h('span', { class: 'swatch', style: { background: r.color } }),
                  h('span', { class: 'occ-mark' }, r.agreed ? '=' : '≠'),
                  r.path.join(' > '),
                ),
                ...r.counts.map((n) => h('td', { class: 'num' + (n ? '' : ' missing') }, n ? String(n) : '–')),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'All coders used the same codes in this document.'),
  );
}
