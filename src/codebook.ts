import {
  codeById,
  commitUI,
  createCode,
  deleteCode,
  findCodeByName,
  folderPath,
  getDoc,
  mergeCode,
  project,
  segmentCounts,
  ui,
  updateCode,
} from './store';
import { byName, h, hexToRgba, lineLabel } from './util';
import { focusSegment } from './viewer';

export function addCodeUI() {
  const name = prompt('New code name:');
  if (!name?.trim()) return;
  if (findCodeByName(name)) return alert(`A code named “${name.trim()}” already exists.`);
  createCode(name);
}

export function renderCodebook(container: HTMLElement) {
  const counts = segmentCounts();
  const codes = [...project.codes].sort(byName);
  if (!codes.length) {
    container.replaceChildren(h('p', { class: 'muted pad' }, 'No codes yet. Highlight text in a document to create one.'));
    return;
  }
  container.replaceChildren(
    ...codes.map((c) =>
      h(
        'div',
        { class: 'code-row' },
        h('input', {
          type: 'color',
          class: 'swatch-input',
          value: c.color,
          title: 'Change color',
          onChange: (e: Event) => updateCode(c.id, { color: (e.target as HTMLInputElement).value }),
        }),
        h(
          'button',
          { class: 'code-name', title: c.description || 'Open code details', onClick: () => openCodeModal(c.id) },
          c.name,
        ),
        h('span', { class: 'badge' }, String(counts.get(c.id) ?? 0)),
      ),
    ),
  );
}

/** Code details: rename, recolor, describe, merge, delete, and retrieve all coded segments. */
export function openCodeModal(codeId: string) {
  const code = codeById(codeId);
  if (!code) return;
  const dlg = h('dialog', { class: 'modal' });
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());

  const nameInput = h('input', { type: 'text', class: 'field', value: code.name });
  const colorInput = h('input', { type: 'color', class: 'swatch-input big', value: code.color });
  const desc = h('textarea', { class: 'field', rows: 3, placeholder: 'Definition / when to apply this code…' });
  desc.value = code.description ?? '';

  const segs = project.segments.filter((s) => s.codeId === codeId && getDoc(s.docId));
  const byDoc = new Map<string, typeof segs>();
  for (const s of segs) {
    if (!byDoc.has(s.docId)) byDoc.set(s.docId, []);
    byDoc.get(s.docId)!.push(s);
  }
  const segList = [...byDoc].map(([docId, list]) => {
    const doc = getDoc(docId)!;
    const path = folderPath(doc.folderId);
    return h(
      'div',
      { class: 'retrieval-doc' },
      h('div', { class: 'retrieval-title' }, path ? `${path} / ${doc.name}` : doc.name, h('span', { class: 'badge' }, String(list.length))),
      ...list
        .sort((a, b) => a.start - b.start)
        .map((s) =>
          h(
            'button',
            {
              class: 'retrieval-seg',
              title: 'Show in document',
              style: { borderLeftColor: code.color },
              onClick: () => {
                close();
                ui.selectedDocId = doc.id;
                commitUI();
                requestAnimationFrame(() => focusSegment(s.start, s.end));
              },
            },
            h('span', { class: 'seg-lines' }, lineLabel(doc, s.start, s.end)),
            h('span', { class: 'seg-text' }, s.text),
          ),
        ),
    );
  });

  const others = project.codes.filter((c) => c.id !== codeId).sort(byName);
  const mergeSelect = h(
    'select',
    { class: 'field' },
    h('option', { value: '' }, 'Merge into…'),
    ...others.map((c) => h('option', { value: c.id }, c.name)),
  );

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) return alert('The code name cannot be empty.');
    const clash = findCodeByName(name);
    if (clash && clash.id !== codeId) return alert(`A code named “${name}” already exists. Use “Merge into…” to combine them.`);
    updateCode(codeId, { name, color: colorInput.value, description: desc.value.trim() || undefined });
    close();
  };

  dlg.append(
    h(
      'div',
      { class: 'modal-inner' },
      h('div', { class: 'modal-head' }, h('span', { class: 'swatch', style: { background: code.color } }), h('strong', {}, 'Code details'), h('span', { class: 'grow' }), h('button', { class: 'icon-btn', onClick: close }, '✕')),
      h(
        'div',
        { class: 'modal-body' },
        h('label', { class: 'label' }, 'Name'),
        h('div', { class: 'row' }, colorInput, nameInput),
        h('label', { class: 'label' }, 'Description'),
        desc,
        h('label', { class: 'label' }, `Coded segments (${segs.length})`),
        segList.length ? h('div', { class: 'retrieval', style: { background: hexToRgba(code.color, 0.04) } }, ...segList) : h('p', { class: 'muted' }, 'This code has not been applied yet.'),
      ),
      h(
        'div',
        { class: 'modal-foot' },
        h('button', {
          class: 'btn danger',
          onClick: () => {
            if (confirm(`Delete code “${code.name}” and remove it from ${segs.length} segment(s)?`)) {
              deleteCode(codeId);
              close();
            }
          },
        }, 'Delete code'),
        others.length ? mergeSelect : null,
        others.length
          ? h('button', {
              class: 'btn',
              onClick: () => {
                const target = codeById(mergeSelect.value);
                if (!target) return;
                if (confirm(`Merge “${code.name}” into “${target.name}”? All segments move to “${target.name}” and “${code.name}” is removed.`)) {
                  mergeCode(codeId, target.id);
                  close();
                }
              },
            }, 'Merge')
          : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onClick: close }, 'Cancel'),
        h('button', { class: 'btn primary', onClick: save }, 'Save'),
      ),
    ),
  );
  document.body.append(dlg);
  dlg.showModal();
  nameInput.focus();
}
