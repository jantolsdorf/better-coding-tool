// Code details: rename, recolor, describe, nest, merge, delete, and retrieve all coded segments.

import {
  deleteCodeInteractive,
  goToSegment,
  mergeCodeInteractive,
  saveCodeDetails,
} from '../controller/codes';
import { codeById, codePath, isCodeInSubtree } from '../model/codes';
import { folderPath, getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { project } from '../model/state';
import { byName } from '../model/util';
import { h, hexToRgba } from './dom';

export function openCodeDialog(codeId: string) {
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
                goToSegment(doc.id, s.start, s.end);
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
    { class: 'field merge-select', title: 'Merge this code into another code' },
    h('option', { value: '' }, 'Merge into…'),
    ...others.map((c) => h('option', { value: c.id }, codePath(c))),
  );
  // A code can be nested under any code outside its own subtree.
  const parentSelect = h(
    'select',
    { class: 'field', style: { width: '100%' } },
    h('option', { value: '' }, '(top level)'),
    ...others
      .filter((c) => !isCodeInSubtree(c.id, codeId))
      .sort((a, b) => codePath(a).localeCompare(codePath(b)))
      .map((c) => h('option', { value: c.id, selected: c.id === code.parentId }, codePath(c))),
  );

  const save = () => {
    const saved = saveCodeDetails(codeId, {
      name: nameInput.value,
      color: colorInput.value,
      description: desc.value,
      parentId: parentSelect.value || null,
    });
    if (saved) close();
  };

  dlg.append(
    h(
      'div',
      { class: 'modal-inner' },
      h(
        'div',
        { class: 'modal-head' },
        h('span', { class: 'swatch', style: { background: code.color } }),
        h('strong', {}, 'Code details'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', title: 'Close without saving changes (Esc)', onClick: close }, 'Discard & close'),
        h('button', { class: 'btn primary', title: 'Save changes and close (Enter in the name field)', onClick: save }, 'Save & close'),
      ),
      h(
        'div',
        { class: 'modal-body' },
        h('label', { class: 'label' }, 'Name'),
        h('div', { class: 'row' }, colorInput, nameInput),
        h('label', { class: 'label' }, 'Parent code'),
        parentSelect,
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
            if (deleteCodeInteractive(code, segs.length)) close();
          },
        }, 'Delete code'),
        others.length ? mergeSelect : null,
        others.length
          ? h('button', {
              class: 'btn',
              onClick: () => {
                if (mergeSelect.value && mergeCodeInteractive(code, mergeSelect.value)) close();
              },
            }, 'Merge')
          : null,
      ),
    ),
  );
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  nameInput.focus();
}
