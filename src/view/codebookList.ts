// The codebook panel: codes as an indented tree or as "Parent > Child" paths, with filtering,
// sorting, and dragging a code onto another to nest or merge it.

import { mergeDroppedCode, moveCode, recolorCode, setCodeCollapsed } from '../controller/codes';
import {
  childCodes,
  codeById,
  codeChain,
  codePath,
  codePathParts,
  isCodeInSubtree,
  lastEditedByCode,
  matchesCodeQuery,
  segmentCounts,
} from '../model/codes';
import { project, ui } from '../model/state';
import type { Code } from '../model/types';
import { byName } from '../model/util';
import { openCodeDialog } from './codeDialog';
import { h } from './dom';

// The dragged code's id; dataTransfer contents cannot be read during dragover.
let draggedCodeId: string | null = null;

// The filter is a transient view setting (not saved).
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
  container.replaceChildren(topLevel, ...rows);
}

/**
 * While a subcode is dragged, shows "Drop here to move to the top level" right above its level 1
 * code. If the strip can stay fully visible, the list scrolls by its height so the rows below it
 * stay under the cursor.
 */
function showTopLevelDrop(list: HTMLElement, dragged: Code) {
  const strip = list.querySelector<HTMLElement>('.code-top-drop');
  if (!strip) return;
  const rootId = codeChain(dragged)[0].id;
  const rootRow = list.querySelector<HTMLElement>(`.code-row[data-id="${rootId}"]`);
  (rootRow ?? list.firstElementChild)?.before(strip);
  list.classList.add('dragging-code');
  const style = getComputedStyle(strip);
  const height = strip.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  const stripTopInView = strip.getBoundingClientRect().top - list.getBoundingClientRect().top;
  if (stripTopInView - height >= 0) list.scrollTop += height;
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

  // Shown below this row while another code is dragged over it.
  const asSub = h('div', { class: 'drop-opt', title: `Make it a subcode of “${c.name}”` }, '⤷ Subcode');
  const asMerge = h('div', { class: 'drop-opt merge', title: `Merge it into “${c.name}”` }, '⇢ Merge into');
  onDrop(asSub, () => {
    if (draggedCodeId) moveCode(draggedCodeId, c.id);
  });
  onDrop(asMerge, () => {
    if (draggedCodeId) mergeDroppedCode(draggedCodeId, c.id);
  });

  const isContext = !!state.visible && !state.matches.has(c.id);
  const row = h(
    'div',
    { class: 'code-row' + (isContext ? ' context' : ''), 'data-id': c.id, draggable: true, style: { paddingLeft: `${6 + depth * 16}px` } },
    h(
      'div',
      { class: 'code-main' },
      h(
        'span',
        {
          class: 'caret',
          onClick: () => {
            if (hasChildren) setCodeCollapsed(c.id, !collapsed);
          },
        },
        hasChildren ? (collapsed ? '▸' : '▾') : '',
      ),
      h('input', {
        type: 'color',
        class: 'swatch-input',
        value: c.color,
        title: 'Change color',
        onChange: (e: Event) => recolorCode(c.id, (e.target as HTMLInputElement).value),
      }),
      h(
        'button',
        {
          class: 'code-name',
          title:
            (c.description ? c.description + '\n\n' : '') +
            `Last edited: ${formatDate(state.recent.get(c.id) ?? '')}\nClick for details · drag onto another code to nest or merge`,
          onClick: () => openCodeDialog(c.id),
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
      const list = row.closest<HTMLElement>('.panel-body');
      if (list && c.parentId) showTopLevelDrop(list, c);
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
