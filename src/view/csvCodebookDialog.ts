// Choosing how a CSV file maps to a codebook: which columns hold codes (parent › child ›
// sub-child, left to right), which describe the codes of a level, and which holds the color.

import {
  csvCodebookEntries,
  descriptionTarget,
  guessCsvMapping,
  type CsvCodebookMapping,
  type CsvColumnRole,
} from '../model/formats/csvCodebook';
import { h } from './dom';

const LEVEL_NAMES = ['parent', 'child', 'sub-child'];
const PREVIEW_ROWS = 12;

/** Shows the column mapping dialog. Resolves with the chosen mapping, or undefined if cancelled. */
export function askCsvCodebookMapping(fileName: string, rows: string[][]): Promise<CsvCodebookMapping | undefined> {
  return new Promise((resolve) => {
    const mapping = guessCsvMapping(rows);
    let result: CsvCodebookMapping | undefined;
    const dlg = h('dialog', { class: 'modal csv-dialog' });
    const close = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });

    const headerBox = h('input', { type: 'checkbox', checked: mapping.headerRow });
    const table = h('div', { class: 'csv-map' });
    const preview = h('div', { class: 'csv-preview' });
    const previewLabel = h('label', { class: 'label' });
    const importBtn = h('button', {
      class: 'btn primary',
      onClick: () => {
        result = mapping;
        close();
      },
    });

    const setRole = (i: number, role: CsvColumnRole) => {
      // Several columns can describe codes, but only one holds the color.
      if (role === 'color') mapping.roles = mapping.roles.map((r) => (r === role ? 'ignore' : r));
      mapping.roles[i] = role;
      render();
    };

    const render = () => {
      const width = mapping.roles.length;
      const head = mapping.headerRow ? rows[0] : [];
      const body = mapping.headerRow ? rows.slice(1) : rows;
      const colName = (i: number) => head[i]?.trim() || `Column ${i + 1}`;
      const codeCols = mapping.roles.flatMap((r, i) => (r === 'code' ? [i] : []));
      // A description of a level that no longer exists describes the last code instead.
      mapping.roles = mapping.roles.map((r) => {
        const target = descriptionTarget(r);
        return typeof target === 'number' && target >= codeCols.length ? 'description' : r;
      });
      const roleOptions: [CsvColumnRole, string][] = [
        ['ignore', 'Ignore'],
        ['code', 'Code'],
        ...codeCols.map((_, k): [CsvColumnRole, string] => [`description:${k}`, `Description of level ${k + 1}`]),
        ['description', 'Description of last code'],
        ['color', 'Color'],
      ];
      let level = 0;
      table.replaceChildren(
        h('div', { class: 'csv-map-head' }, h('span', {}, 'Column'), h('span', {}, 'Examples'), h('span', {}, 'Use as')),
        ...Array.from({ length: width }, (_, i) => {
          const role = mapping.roles[i];
          const name = colName(i);
          const samples = body.map((r) => r[i]?.trim()).filter(Boolean).slice(0, 3).join(' · ');
          const target = descriptionTarget(role);
          const levelText =
            role === 'code'
              ? `Level ${level + 1}${LEVEL_NAMES[level] ? ` · ${LEVEL_NAMES[level]}` : ''}`
              : target === 'last'
                ? 'of each row’s last code'
                : target !== null
                  ? `of “${colName(codeCols[target])}”`
                  : '';
          if (role === 'code') level++;
          const select = h(
            'select',
            { class: 'field', onChange: (e: Event) => setRole(i, (e.target as HTMLSelectElement).value as CsvColumnRole) },
            ...roleOptions.map(([value, label]) => h('option', { value, selected: role === value }, label)),
          );
          return h(
            'div',
            { class: 'csv-map-row' + (role === 'ignore' ? ' ignored' : '') },
            h('span', { class: 'csv-col-name', title: name }, name),
            h('span', { class: 'csv-samples muted', title: samples }, samples || '(empty)'),
            h('span', { class: 'csv-role' }, select, levelText ? h('span', { class: 'csv-level' }, levelText) : null),
          );
        }),
      );

      const entries = csvCodebookEntries(rows, mapping);
      const n = entries.length;
      previewLabel.textContent = `Preview · ${n} code${n === 1 ? '' : 's'}`;
      const more = n > PREVIEW_ROWS ? [h('div', { class: 'muted csv-preview-more' }, `…and ${n - PREVIEW_ROWS} more`)] : [];
      preview.replaceChildren(
        ...(n
          ? entries.slice(0, PREVIEW_ROWS).map((e) =>
              h(
                'div',
                { class: 'csv-preview-row' },
                e.color ? h('span', { class: 'swatch', style: { background: e.color } }) : null,
                h('span', { class: 'csv-preview-path' }, (e.path ?? [e.name]).join(' > ')),
                e.description ? h('span', { class: 'muted csv-preview-desc' }, e.description) : null,
              ),
            )
          : [h('p', { class: 'muted' }, 'Choose at least one column with codes.')]),
        ...more,
      );
      importBtn.textContent = n ? `Import ${n} code${n === 1 ? '' : 's'}` : 'Import';
      importBtn.disabled = !n;
    };

    headerBox.addEventListener('change', () => {
      mapping.headerRow = headerBox.checked;
      render();
    });

    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h(
          'div',
          { class: 'modal-head' },
          h('strong', { class: 'grow' }, `Import codebook from “${fileName}”`),
          h('button', { class: 'btn', onClick: close }, 'Cancel'),
          importBtn,
        ),
        h(
          'div',
          { class: 'modal-body' },
          h('label', { class: 'check-row' }, headerBox, ' First row contains column names'),
          h(
            'p',
            { class: 'muted csv-hint' },
            'Code columns are read from left to right as parent › child › sub-child. A cell may also hold a whole path like “Parent > Child”. ' +
              'Empty code cells at the start of a row continue the codes of the row above. ' +
              'Each description column describes the codes of one level (or the last code of each row); texts from several columns are combined. The color belongs to the last code in the row.',
          ),
          table,
          previewLabel,
          preview,
        ),
      ),
    );
    render();
    document.body.append(dlg);
    dlg.showModal();
    importBtn.focus();
  });
}
