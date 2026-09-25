import {
  childCodes,
  codeById,
  codePath,
  codePathParts,
  commitUI,
  createCode,
  deleteCode,
  findChildCode,
  findCodeByPath,
  matchesCodeQuery,
  folderPath,
  getDoc,
  isCodeInSubtree,
  lastEditedByCode,
  mergeCode,
  project,
  segmentCounts,
  setCodeParent,
  splitCodePath,
  ui,
  updateCode,
} from './store';
import type { Code } from './types';
import { byName, h, hexToRgba, lineLabel, toast } from './util';
import { focusSegment } from './viewer';

export function addCodeUI() {
  const name = prompt('New code name (use “Parent > Child” to create a subcode):');
  const parts = splitCodePath(name ?? '');
  if (!parts.length) return;
  if (findCodeByPath(parts)) return alert(`“${parts.join(' > ')}” already exists.`);
  createCode(name!);
}

/** Moves a code and explains why when that is not possible. */
function moveCode(id: string, parentId: string | null) {
  const res = setCodeParent(id, parentId);
  if (res === 'cycle') toast('A code cannot become a subcode of its own subcode.');
  if (res === 'duplicate') {
    const where = parentId ? `“${codeById(parentId)?.name}” already has a subcode` : 'There is already a top-level code';
    toast(`${where} named “${codeById(id)?.name}”. Drop on “Merge” to combine them instead.`, 5000);
  }
}

// The dragged code's id; dataTransfer contents cannot be read during dragover.
let draggedCodeId: string | null = null;

let filterText = '';
let lastContainer: HTMLElement | null = null;

/**
 * Shows only codes matching `text`: by name or description, or by path ("trust > dist").
 * Their parent codes stay visible for context.
 */
export function setCodebookFilter(text: string) {
  filterText = text.trim().toLowerCase();
  if (lastContainer) renderCodebook(lastContainer);
}

interface ListState {
  counts: Map<string, number>;
  /** Latest edit within each code's subtree, so a parent with recently used subcodes sorts up too. */
  recent: Map<string, string>;
  /** When filtering: codes to show, and which of them actually match. */
  visible: Set<string> | null;
  matches: Set<string>;
}

export function renderCodebook(container: HTMLElement) {
  lastContainer = container;
  if (!draggedCodeId) container.classList.remove('dragging-code');
  if (!project.codes.length) {
    container.replaceChildren(h('p', { class: 'muted pad' }, 'No codes yet. Highlight text in a document to create one.'));
    return;
  }
  const edited = lastEditedByCode();
  const recent = new Map<string, string>();
  const subtreeRecent = (id: string, depth = 0): string => {
    if (recent.has(id)) return recent.get(id)!;
    let latest = edited.get(id) ?? '';
    if (depth < 50) for (const c of childCodes(id)) latest = [latest, subtreeRecent(c.id, depth + 1)].sort().pop()!;
    recent.set(id, latest);
    return latest;
  };
  project.codes.forEach((c) => subtreeRecent(c.id));

  const matches = new Set<string>();
  let visible: Set<string> | null = null;
  if (filterText) {
    visible = new Set();
    const isPath = /[>›]/.test(filterText);
    for (const c of project.codes) {
      const inDescription = !isPath && (c.description ?? '').toLowerCase().includes(filterText);
      if (!matchesCodeQuery(c, filterText) && !inDescription) continue;
      matches.add(c.id);
      for (let p: Code | undefined = c, d = 0; p && d < 100; p = p.parentId ? codeById(p.parentId) : undefined, d++) visible.add(p.id);
    }
    if (!matches.size) {
      container.replaceChildren(h('p', { class: 'muted pad' }, `No codes match “${filterText}”.`));
      return;
    }
  }

  const state: ListState = { counts: segmentCounts(), recent, visible, matches };
  const topLevel = h('div', { class: 'code-top-drop' }, 'Drop here to move to the top level');
  onDrop(topLevel, () => {
    if (draggedCodeId) moveCode(draggedCodeId, null);
  });
  const rows = ui.codeView === 'path' ? pathRows(state, edited) : codeRows(null, 0, state);
  container.replaceChildren(...rows, topLevel);
}

function codeRows(parentId: string | null, depth: number, state: ListState): HTMLElement[] {
  if (depth > 50) return [];
  const byRecent = (a: Code, b: Code) =>
    (state.recent.get(b.id) ?? '').localeCompare(state.recent.get(a.id) ?? '') || byName(a, b);
  return childCodes(parentId)
    .filter((c) => !state.visible || state.visible.has(c.id))
    .sort(ui.codeSort === 'recent' ? byRecent : byName)
    .flatMap((c) => {
      const children = childCodes(c.id);
      // While filtering, everything that matches is shown, even inside collapsed codes.
      const collapsed = !state.visible && ui.collapsedCodes.includes(c.id);
      const rows: HTMLElement[] = [codeRow(c, depth, children.length > 0, collapsed, state, false)];
      if (!collapsed) rows.push(...codeRows(c.id, depth + 1, state));
      return rows;
    });
}

/** Flat list with each code written as its path, e.g. "Trust > Distrust". */
function pathRows(state: ListState, edited: Map<string, string>): HTMLElement[] {
  const byPath = (a: Code, b: Code) =>
    codePath(a).localeCompare(codePath(b), undefined, { numeric: true, sensitivity: 'base' });
  // In this view each code sorts by its own last edit, since parents are not grouped.
  const byRecent = (a: Code, b: Code) => (edited.get(b.id) ?? '').localeCompare(edited.get(a.id) ?? '') || byPath(a, b);
  return project.codes
    .filter((c) => !state.visible || state.matches.has(c.id))
    .sort(ui.codeSort === 'recent' ? byRecent : byPath)
    .map((c) => codeRow(c, 0, false, false, state, true));
}

/** The code name with the filter text (or the last part of a path filter) marked. */
function nameWithMatch(name: string): (string | HTMLElement)[] {
  const q = filterText.split(/[>›]/).pop()!.trim();
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  if (i === -1) return [name];
  return [name.slice(0, i), h('mark', {}, name.slice(i, i + q.length)), name.slice(i + q.length)];
}

function formatDate(iso: string): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown';
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

function codeRow(c: Code, depth: number, hasChildren: boolean, collapsed: boolean, state: ListState, showPath: boolean) {
  const own = state.counts.get(c.id) ?? 0;
  const total = hasChildren ? subtreeCount(c.id, state.counts) : own;
  const parents = showPath ? codePathParts(c).slice(0, -1) : [];

  // Shown while another code is dragged over this row.
  const asSub = h('div', { class: 'drop-opt', title: `Make it a subcode of “${c.name}”` }, '⤷ Subcode');
  const asMerge = h('div', { class: 'drop-opt merge', title: `Merge it into “${c.name}”` }, '⇢ Merge');
  onDrop(asSub, () => {
    if (draggedCodeId) moveCode(draggedCodeId, c.id);
  });
  onDrop(asMerge, () => {
    const from = draggedCodeId ? codeById(draggedCodeId) : undefined;
    if (!from) return;
    const n = project.segments.filter((s) => s.codeId === from.id).length;
    if (confirm(`Merge “${from.name}” into “${c.name}”?\n\nIts ${n} segment(s) and any subcodes move to “${c.name}”, and “${from.name}” is removed.`)) {
      mergeCode(from.id, c.id);
    }
  });

  const isContext = !!state.visible && !state.matches.has(c.id);
  const row = h(
    'div',
    { class: 'code-row' + (isContext ? ' context' : ''), draggable: true, style: { paddingLeft: `${6 + depth * 16}px` } },
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
        {
          class: 'code-name',
          title:
            (c.description ? c.description + '\n\n' : '') +
            `Last edited: ${formatDate(state.recent.get(c.id) ?? '')}\nClick for details · drag onto another code to nest or merge`,
          onClick: () => openCodeModal(c.id),
        },
        parents.length ? h('span', { class: 'code-parent' }, `${parents.join(' > ')} > `) : null,
        ...nameWithMatch(c.name),
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
    const name = nameInput.value.trim();
    if (!name) return alert('The code name cannot be empty.');
    if (/[>›]/.test(name)) return alert('A code name cannot contain “>”; it separates a code from its subcodes.');
    // Names only need to be unique among the codes with the same parent.
    const parentId = parentSelect.value || null;
    const clash = findChildCode(parentId, name);
    if (clash && clash.id !== codeId) {
      const where = parentId ? `under “${codeById(parentId)?.name}”` : 'at the top level';
      return alert(`A code named “${name}” already exists ${where}. Use “Merge into…” to combine them.`);
    }
    updateCode(codeId, { name, color: colorInput.value, description: desc.value.trim() || undefined, parentId });
    close();
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
