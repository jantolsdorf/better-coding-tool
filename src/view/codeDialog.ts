// Code details: rename, recolor, describe, nest, merge, delete, and retrieve all coded segments.

import './codeDialog.css';
import {
  colorSubcodesLike,
  deleteCodeInteractive,
  goToSegment,
  mergeCodeInteractive,
  saveCodeDetails,
} from '../controller/codes';
import { codeById, codePath, isCodeInSubtree, subtreeOf } from '../model/codes';
import { folderPath, getDoc } from '../model/documents';
import { lineLabel } from '../model/lines';
import { project, subscribe } from '../model/state';
import { byName } from '../model/util';
import { textBody } from './document/textView';
import { confirmAction, toast } from './feedback';
import { closeToolWindow, openToolWindow } from './windows';
import { h, hexToRgba } from './dom';

/**
 * Opens the details of a code in its own window (one per code; opening it again brings that
 * window to the front). Closing the window or pressing Esc discards the changes.
 */
export function openCodeDialog(codeId: string) {
  const code = codeById(codeId);
  if (!code) return;
  const key = `code-${codeId}`;
  let stop = () => {};
  const root = openToolWindow(key, `Code: ${code.name}`, () => stop(), { width: 720, height: 820 });
  if (!root) return;
  // Closing through the window's own buttons (save, discard, delete, merge) never asks; closing
  // the window itself with unsaved changes does (see below).
  let closingOnPurpose = false;
  const close = () => {
    closingOnPurpose = true;
    closeToolWindow(key);
  };
  // The window closes by itself if the code disappears (e.g. deleted or merged in the main window).
  stop = subscribe(() => {
    if (!codeById(codeId)) close();
  });

  const nameInput = h('input', { type: 'text', class: 'field', value: code.name });
  const subcodeCount = subtreeOf(codeId).length - 1;
  const subcodeSwatch = h('span', { class: 'swatch', style: { background: code.color } });
  const colorInput = h('input', { type: 'color', class: 'swatch-input big', value: code.color });
  const desc = h('textarea', { class: 'field', rows: 3, placeholder: 'Definition / when to apply this code…' });
  desc.value = code.description ?? '';

  const segs = project.segments.filter((s) => s.codeId === codeId && getDoc(s.docId));
  const byDoc = new Map<string, typeof segs>();
  for (const s of segs) {
    if (!byDoc.has(s.docId)) byDoc.set(s.docId, []);
    byDoc.get(s.docId)!.push(s);
  }
  // Segments removed here are only deleted on "Save & close"; "Discard & close" keeps them.
  const removed = new Set<string>();
  const segLabel = h('label', { class: 'label' });
  const retrieval = h('div', { class: 'retrieval' });
  const expanded = new Set<string>();

  const renderSegments = () => {
    segLabel.textContent = `Coded segments (${segs.length - removed.size})` + (removed.size ? ` · ${removed.size} to be removed when you save` : '');
    retrieval.replaceChildren(
      ...[...byDoc].map(([docId, list]) => {
        const doc = getDoc(docId)!;
        const path = folderPath(doc.folderId);
        const left = list.filter((s) => !removed.has(s.id)).length;
        return h(
          'div',
          { class: 'retrieval-doc' },
          h('div', { class: 'retrieval-title' }, path ? `${path} / ${doc.name}` : doc.name, h('span', { class: 'badge' }, String(left))),
          ...list
            .sort((a, b) => a.start - b.start)
            .map((s) => {
              const gone = removed.has(s.id);
              const seg = h('div', {
                class: 'retrieval-seg' + (expanded.has(s.id) ? ' expanded' : '') + (gone ? ' removed' : ''),
                style: { borderLeftColor: code.color },
              });
              const jump = h(
                'button',
                {
                  class: 'seg-jump',
                  title: 'Show in document',
                  'aria-label': 'Show in document',
                  disabled: gone,
                  onClick: () => {
                    goToSegment(doc.id, s.start, s.end, s.id);
                    // The text may be in the main window or in its own window. A page cannot bring
                    // back a minimized window, so say where the passage is shown.
                    const textDoc = textBody.ownerDocument;
                    if (textDoc.visibilityState === 'hidden') {
                      toast('The passage is now shown in the window with the text, but that window is minimized. Bring it back to see it.', 6000);
                    } else textDoc.defaultView?.focus();
                  },
                },
                h('i', { class: 'fa-solid fa-arrow-up-right-from-square', 'aria-hidden': 'true' }),
              );
              const toggleRemove = h(
                'button',
                {
                  class: 'seg-jump',
                  title: gone ? 'Keep this segment' : 'Remove this segment (when you save; can be undone)',
                  'aria-label': gone ? 'Keep segment' : 'Remove segment',
                  onClick: () => {
                    if (gone) removed.delete(s.id);
                    else removed.add(s.id);
                    renderSegments();
                  },
                },
                h('i', { class: gone ? 'fa-solid fa-rotate-left' : 'fa-solid fa-trash', 'aria-hidden': 'true' }),
              );
              const body = h(
                'button',
                {
                  class: 'seg-body',
                  style: { background: hexToRgba(code.color, 0.04) }
                },
                h('span', { class: 'seg-lines' }, lineLabel(doc, s.start, s.end), jump, toggleRemove),
                h('span', {
                  class: 'seg-text', title: expanded.has(s.id) ? 'Collapse segment' : 'Show full segment',
                  'aria-expanded': String(expanded.has(s.id)),
                  onClick: () => {
                    if (expanded.has(s.id)) expanded.delete(s.id);
                    else expanded.add(s.id);
                    renderSegments();
                  },
                }, s.text),
              );              
              seg.append(body);
              return seg;
            }),
        );
      }),
    );
  };
  renderSegments();

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
    }, [...removed]);
    if (saved) close();
  };

  root.append(
    h(
      'div',
      { class: 'modal-inner tool-inner' },
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
        h('div', { class: 'row' }, h('label', { class: 'label' }, 'Color'), h('label', { class: 'label' }, 'Name')),
        h('div', { class: 'row' }, colorInput, nameInput),
        subcodeCount
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn small subcode-color',
                title: 'Applies the color chosen here to this code and all its subcodes right away',
                onClick: () => colorSubcodesLike(codeId, colorInput.value),
              },
              subcodeSwatch,
              ` Give ${subcodeCount} subcode${subcodeCount === 1 ? '' : 's'} this color`,
            )
          : null,
        h('label', { class: 'label' }, 'Parent code'),
        parentSelect,
        h('label', { class: 'label' }, 'Description'),
        desc,
        segLabel,
        segs.length ? retrieval : h('p', { class: 'muted' }, 'This code has not been applied yet.'),
      ),
      h(
        'div',
        { class: 'modal-foot' },
        h('button', {
          class: 'btn danger',
          onClick: async () => {
            if (await deleteCodeInteractive(code, segs.length)) close();
          },
        }, 'Delete code'),
        others.length ? mergeSelect : null,
        others.length
          ? h('button', {
              class: 'btn',
              onClick: async () => {
                if (mergeSelect.value && (await mergeCodeInteractive(code, mergeSelect.value))) close();
              },
            }, 'Merge')
          : null,
      ),
    ),
  );
  colorInput.addEventListener('input', () => (subcodeSwatch.style.background = colorInput.value));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  // Unsaved: anything changed since the window opened.
  const initial = { name: nameInput.value, color: colorInput.value, desc: desc.value, parent: parentSelect.value };
  const unsaved = () =>
    nameInput.value !== initial.name ||
    colorInput.value !== initial.color ||
    desc.value !== initial.desc ||
    parentSelect.value !== initial.parent ||
    removed.size > 0;
  const win = root.ownerDocument.defaultView!;
  // Closing the window itself (or the app) with unsaved changes: the browser asks first.
  win.addEventListener('beforeunload', (e) => {
    if (closingOnPurpose || !unsaved()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // Esc discards, as in a dialog (unless a dialog inside the window is open), after asking if anything changed.
  root.ownerDocument.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape' || root.ownerDocument.querySelector('dialog[open]')) return;
    if (!unsaved()) return close();
    const discard = await confirmAction('Your changes to this code are lost.', { title: 'Discard your changes?', confirm: 'Discard changes', cancel: 'Keep editing', danger: true });
    if (discard) close();
  });
  nameInput.focus();
}
