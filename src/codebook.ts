import {
  childCodes,
  codeById,
  codePath,
  commitUI,
  createCode,
  deleteCode,
  findCodeByName,
  folderPath,
  getDoc,
  isCodeInSubtree,
  mergeCode,
  project,
  segmentCounts,
  setCodeParent,
  ui,
  updateCode,
} from './store';
import type { Code } from './types';
import { byName, h, hexToRgba, lineLabel, toast } from './util';
import { focusSegment } from './viewer';

export function addCodeUI() {
  const name = prompt('New code name:');
  if (!name?.trim()) return;
  if (findCodeByName(name)) return alert(`A code named “${name.trim()}” already exists.`);
  createCode(name);
}

// The dragged code's id; dataTransfer contents cannot be read during dragover.
let draggedCodeId: string | null = null;

export function renderCodebook(container: HTMLElement) {
  if (!draggedCodeId) container.classList.remove('dragging-code');
  if (!project.codes.length) {
    container.replaceChildren(h('p', { class: 'muted pad' }, 'No codes yet. Highlight text in a document to create one.'));
    return;
  }
  const counts = segmentCounts();
  const topLevel = h('div', { class: 'code-top-drop' }, 'Drop here to move to the top level');
  onDrop(topLevel, () => {
    if (draggedCodeId) setCodeParent(draggedCodeId, null);
  });
  container.replaceChildren(...codeRows(null, 0, counts), topLevel);
}

function codeRows(parentId: string | null, depth: number, counts: Map<string, number>): HTMLElement[] {
  if (depth > 50) return [];
  return childCodes(parentId)
    .sort(byName)
    .flatMap((c) => {
      const children = childCodes(c.id);
      const collapsed = ui.collapsedCodes.includes(c.id);
      const rows: HTMLElement[] = [codeRow(c, depth, children.length > 0, collapsed, counts)];
      if (!collapsed) rows.push(...codeRows(c.id, depth + 1, counts));
      return rows;
    });
}

function subtreeCount(id: string, counts: Map<string, number>, depth = 0): number {
  if (depth > 50) return 0;
  return (counts.get(id) ?? 0) + childCodes(id).reduce((n, c) => n + subtreeCount(c.id, counts, depth + 1), 0);
}

/** Calls `fn` when a dragged code is dropped on `el`. */
function onDrop(el: HTMLElement, fn: () => void) {
  el.addEventListener('dragover', (e) => {
    if (!draggedCodeId || el.classList.contains('disabled')) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over');
    fn();
  });
}

function codeRow(c: Code, depth: number, hasChildren: boolean, collapsed: boolean, counts: Map<string, number>) {
  const own = counts.get(c.id) ?? 0;
  const total = hasChildren ? subtreeCount(c.id, counts) : own;

  // Shown while another code is dragged over this row.
  const asSub = h('div', { class: 'drop-opt', title: `Make it a subcode of “${c.name}”` }, '⤷ Subcode');
  const asMerge = h('div', { class: 'drop-opt merge', title: `Merge it into “${c.name}”` }, '⇢ Merge');
  onDrop(asSub, () => {
    const id = draggedCodeId;
    if (id && !setCodeParent(id, c.id)) toast('A code cannot become a subcode of its own subcode.');
  });
  onDrop(asMerge, () => {
    const from = draggedCodeId ? codeById(draggedCodeId) : undefined;
    if (!from) return;
    const n = project.segments.filter((s) => s.codeId === from.id).length;
    if (confirm(`Merge “${from.name}” into “${c.name}”?\n\nIts ${n} segment(s) and any subcodes move to “${c.name}”, and “${from.name}” is removed.`)) {
      mergeCode(from.id, c.id);
    }
  });

  const row = h(
    'div',
    { class: 'code-row', draggable: true, style: { paddingLeft: `${6 + depth * 16}px` } },
    h('div', { class: 'code-main' },
      h(
        'span',
        {
          class: 'caret',
          onClick: () => {
            if (!hasChildren) return;
            ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== c.id);
            if (!collapsed) ui.collapsedCodes.push(c.id);
            commitUI();
          },
        },
        hasChildren ? (collapsed ? '▸' : '▾') : '',
      ),
      h('input', {
        type: 'color',
        class: 'swatch-input',
        value: c.color,
        title: 'Change color',
        onChange: (e: Event) => updateCode(c.id, { color: (e.target as HTMLInputElement).value }),
      }),
      h(
        'button',
        { class: 'code-name', title: (c.description ? c.description + '\n\n' : '') + 'Click for details · drag onto another code to nest or merge', onClick: () => openCodeModal(c.id) },
        c.name,
      ),
      h('span', { class: 'badge', title: hasChildren ? `${own} with this code, ${total} including subcodes` : 'Coded segments' }, hasChildren && total !== own ? `${own} · ${total}` : String(own)),
    ),
    h('div', { class: 'drop-opts' }, asSub, asMerge),
  );

  row.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    draggedCodeId = c.id;
    e.dataTransfer?.setData('text/plain', c.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // Deferred so the drag image is taken before the list changes appearance.
    requestAnimationFrame(() => {
      row.classList.add('dragging');
      row.closest('.panel-body')?.classList.add('dragging-code');
    });
  });
  row.addEventListener('dragend', () => {
    draggedCodeId = null;
    row.classList.remove('dragging');
    const list = row.closest('.panel-body');
    list?.classList.remove('dragging-code');
    list?.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });
  row.addEventListener('dragenter', () => {
    const id = draggedCodeId;
    if (!id || id === c.id) return;
    row.classList.add('drag-over');
    // A code cannot be nested inside its own subtree (merging is still possible).
    asSub.classList.toggle('disabled', isCodeInSubtree(c.id, id));
  });
  row.addEventListener('dragover', (e) => {
    if (draggedCodeId && draggedCodeId !== c.id) e.preventDefault();
  });
  row.addEventListener('dragleave', (e) => {
    if (!row.contains(e.relatedTarget as Node)) row.classList.remove('drag-over');
  });
  row.addEventListener('drop', (e) => e.preventDefault());
  return row;
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
    const name = nameInput.value.trim();
    if (!name) return alert('The code name cannot be empty.');
    const clash = findCodeByName(name);
    if (clash && clash.id !== codeId) return alert(`A code named “${name}” already exists. Use “Merge into…” to combine them.`);
    updateCode(codeId, {
      name,
      color: colorInput.value,
      description: desc.value.trim() || undefined,
      parentId: parentSelect.value || null,
    });
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
                if (confirm(`Merge “${code.name}” into “${target.name}”? All segments and subcodes move to “${target.name}” and “${code.name}” is removed.`)) {
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
